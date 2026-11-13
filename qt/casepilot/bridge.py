"""Private stdin/stdout command transport; no local HTTP listener."""
from __future__ import annotations
import base64
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Callable
from PySide6.QtCore import QObject, QProcess, QProcessEnvironment, Signal, QTimer


class EngineBridge(QObject):
    ready = Signal(list)
    event = Signal(dict)
    failed = Signal(str)
    native_request = Signal(dict)
    native_cancel = Signal(str)
    focus_requested = Signal()
    restart_requested = Signal()
    stopped = Signal()

    def __init__(self, directory: Path, data_directory: Path, key: bytes, parent=None, *, node: str | None = None):
        super().__init__(parent)
        self.directory = directory
        self.data_directory = data_directory
        self.key = key
        self.process = QProcess(self)
        self.process.setWorkingDirectory(str(directory))
        environment = QProcessEnvironment.systemEnvironment()
        for name in ("ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "CASE_CLICKER_TEST_DATA_DIR", "VITE_DEV_SERVER_URL"):
            environment.remove(name)
        self.process.setProcessEnvironment(environment)
        self.process.setProcessChannelMode(QProcess.SeparateChannels)
        self.process.readyReadStandardOutput.connect(self._read)
        self.process.readyReadStandardError.connect(self._read_error)
        self.process.finished.connect(self._finished)
        self.process.errorOccurred.connect(lambda error: self.failed.emit("Não foi possível iniciar o serviço de operações: " + self.process.errorString()))
        self.process.started.connect(self._initialize)
        self.node = node or self._node_path()
        self.buffer = bytearray()
        self.callbacks: dict[str, tuple[Callable, Callable | None]] = {}
        self.sequence = 0
        self.channels: list[str] = []
        self.closing = False
        self.initialized = False

    def _node_path(self):
        bundled = self.directory / "runtime" / ("node.exe" if sys.platform == "win32" else "node")
        value = str(bundled) if bundled.is_file() else shutil.which("node")
        if not value:
            raise RuntimeError("O executável do serviço de operações não foi incluído na aplicação.")
        return value

    def start(self):
        self.process.start(self.node, [str(self.directory / "engine" / "worker.cjs")])

    def _initialize(self):
        self.send({"type": "initialize", "configuration": {
            "dataDirectory": str(self.data_directory),
            "appDataDirectory": str(self.data_directory.parent),
            "vaultKey": base64.b64encode(self.key).decode("ascii"),
        }})

    def send(self, value: dict):
        if self.process.state() != QProcess.Running:
            raise RuntimeError("O serviço de operações não está disponível.")
        self.process.write((json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n").encode())

    def invoke(self, channel: str, args=None, done: Callable | None = None, error: Callable | None = None) -> str:
        if not self.initialized:
            if error:
                error("O serviço de operações ainda está a iniciar.")
            return ""
        if channel not in self.channels:
            if error:
                error("Esta operação não está disponível na versão Qt.")
            return ""
        self.sequence += 1
        identifier = "qt-" + str(self.sequence)
        self.callbacks[identifier] = (done or (lambda value: None), error)
        self.send({"type": "command", "id": identifier, "channel": channel, "args": args or []})
        return identifier

    def reply_native(self, identifier: str, result=None, error: str | None = None):
        if self.process.state() == QProcess.Running:
            self.send({"type": "native-result", "id": identifier, "result": result, **({"error": error} if error else {})})

    def _read(self):
        self.buffer.extend(bytes(self.process.readAllStandardOutput()))
        if len(self.buffer) > 32 * 1024 * 1024:
            self.failed.emit("Resposta do serviço demasiado grande.")
            self.process.kill()
            return
        while b"\n" in self.buffer:
            line, _, rest = self.buffer.partition(b"\n")
            self.buffer = bytearray(rest)
            try:
                self._dispatch(json.loads(line))
            except (ValueError, KeyError, TypeError) as exc:
                self.failed.emit("Resposta inválida do serviço de operações.")

    def _dispatch(self, message):
        kind = message.get("type")
        if kind == "ready":
            self.channels = message["channels"]
            self.initialized = True
            self.ready.emit(self.channels)
        elif kind == "result":
            done, error = self.callbacks.pop(message["id"], (None, None))
            if message.get("error"):
                (error or self.failed.emit)(message["error"])
            elif done:
                done(message.get("result"))
        elif kind == "event":
            self.event.emit(message["payload"])
        elif kind == "native-request":
            self.native_request.emit(message)
        elif kind == "native-cancel":
            self.native_cancel.emit(message["id"])
        elif kind == "fatal":
            self.failed.emit(message["error"])
        elif kind == "focus":
            self.focus_requested.emit()
        elif kind == "relaunch":
            self.restart_requested.emit()

    def _read_error(self):
        # Do not surface raw stderr, which may contain session data from third-party code.
        self.process.readAllStandardError()

    def shutdown(self):
        if self.closing:
            return
        self.closing = True
        if self.process.state() == QProcess.Running:
            self.send({"type": "shutdown"})
            QTimer.singleShot(8000, self._force_stop)
        else:
            self.stopped.emit()

    def _force_stop(self):
        if self.process.state() != QProcess.NotRunning:
            self.process.kill()

    def _finished(self, code, status):
        self.initialized = False
        for done, error in list(self.callbacks.values()):
            if error:
                error("O serviço de operações terminou antes de responder.")
        self.callbacks.clear()
        if not self.closing:
            self.failed.emit("O serviço de operações terminou. Reinicia a aplicação para recuperar as operações guardadas.")
        self.stopped.emit()
