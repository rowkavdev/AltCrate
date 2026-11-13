"""Qt host integration: login windows, file pickers and external links."""
from __future__ import annotations
from urllib.parse import urlsplit
from PySide6.QtCore import QUrl, QTimer, Qt, QProcess
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QDialog, QVBoxLayout, QFileDialog
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from .network import ORIGIN


class LoginPage(QWebEnginePage):
    def acceptNavigationRequest(self, url, kind, is_main_frame):
        if is_main_frame:
            parsed = urlsplit(url.toString())
            return parsed.scheme == "https" and parsed.hostname == "case-clicker.com" and parsed.port in (None, 443) and not parsed.username
        return True

    def createWindow(self, window_type):
        return None


class NativeHost:
    def __init__(self, bridge, network, parent):
        self.bridge = bridge
        self.network = network
        self.parent = parent
        self.windows = {}
        self.loads = {}
        bridge.native_request.connect(self.handle)
        bridge.native_cancel.connect(network.cancel)

    def event(self, identifier, event, **payload):
        if self.bridge.process.state() == QProcess.Running:
            self.bridge.send({"type": "native-event", "id": identifier, "event": event, **payload})

    def handle(self, message):
        identifier, method, args = message["id"], message["method"], message.get("args", {})
        try:
            if method.startswith(("session.", "cookies.", "socket.")):
                self.network.handle(message)
            elif method.startswith("login."):
                self.login(identifier, method, args)
            elif method == "dialog.open":
                options = args.get("options", {})
                file, _ = QFileDialog.getOpenFileName(self.parent, options.get("title", "Escolher ficheiro"), "", self.file_filter(options))
                self.bridge.reply_native(identifier, {"canceled": not bool(file), "filePaths": [file] if file else []})
            elif method == "dialog.save":
                options = args.get("options", {})
                file, _ = QFileDialog.getSaveFileName(self.parent, options.get("title", "Guardar ficheiro"), options.get("defaultPath", ""), self.file_filter(options))
                self.bridge.reply_native(identifier, {"canceled": not bool(file), "filePath": file or None})
            elif method == "desktop.open":
                self.network.allowed(args["url"])
                self.bridge.reply_native(identifier, QDesktopServices.openUrl(QUrl(args["url"])))
            else:
                raise ValueError("Integração Qt desconhecida: " + method)
        except Exception as error:
            self.bridge.reply_native(identifier, error=str(error))

    @staticmethod
    def file_filter(options):
        return ";;".join(f"{filter_['name']} ({' '.join('*.' + extension for extension in filter_['extensions'])})"
                         for filter_ in options.get("filters", [])) or "Todos os ficheiros (*)"

    def login(self, identifier, method, args):
        window_id = args["id"]
        if method == "login.create":
            session = self.network.session(args["partition"])
            if session.proxy.type() not in (session.proxy.DefaultProxy, session.proxy.NoProxy):
                raise ValueError("O login Qt com proxy por conta ainda precisa de validação. Usa a ligação direta para iniciar sessão.")
            dialog = QDialog(self.parent)
            dialog.setAttribute(Qt.WA_DeleteOnClose)
            dialog.setWindowTitle(args["title"])
            dialog.resize(args.get("width", 1050), args.get("height", 800))
            layout = QVBoxLayout(dialog)
            layout.setContentsMargins(0, 0, 0, 0)
            view = QWebEngineView(dialog)
            page = LoginPage(session.profile(), view)
            page.settings().setAttribute(QWebEngineSettings.JavascriptCanOpenWindows, False)
            page.settings().setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, False)
            view.setPage(page)
            layout.addWidget(view)
            self.windows[window_id] = (dialog, view)
            view.loadFinished.connect(lambda ok: self._loaded(window_id, ok))
            view.urlChanged.connect(lambda url: self.event(window_id, "did-navigate", url=url.toString()))
            dialog.finished.connect(lambda _: self._closed(window_id))
            dialog.show()
            self.bridge.reply_native(identifier)
        elif window_id not in self.windows:
            raise ValueError("A janela de login foi fechada.")
        elif method == "login.load":
            self.network.allowed(args["url"])
            self.loads[window_id] = identifier
            self.windows[window_id][1].load(QUrl(args["url"]))
        elif method == "login.script":
            self.windows[window_id][1].page().runJavaScript(args["script"], lambda result: self.bridge.reply_native(identifier, result))
        elif method == "login.close":
            self.windows[window_id][0].close()
            self.bridge.reply_native(identifier)
        else:
            raise ValueError("Operação de login desconhecida.")

    def _loaded(self, window_id, ok):
        pending = self.loads.pop(window_id, None)
        if pending:
            self.bridge.reply_native(pending, True if ok else None, None if ok else "Não foi possível abrir o site.")
        if ok:
            self.event(window_id, "did-finish-load")

    def _closed(self, window_id):
        self.windows.pop(window_id, None)
        pending = self.loads.pop(window_id, None)
        if pending:
            self.bridge.reply_native(pending, error="A janela de login foi fechada.")
        self.event(window_id, "closed")

    def close(self):
        for dialog, view in list(self.windows.values()):
            dialog.close()
