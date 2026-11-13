"""AltCrate native Qt entry point; run without Electron or React."""
from __future__ import annotations
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description="AltCrate Qt")
parser.add_argument("--data-dir", type=Path)
parser.add_argument("--fixture", action="store_true", help="Use an isolated empty account store and ephemeral credentials")
parser.add_argument("--verify-ui", type=Path, help="Save native page screenshots and an empty-state verification report, then exit")
args = parser.parse_args()
if args.verify_ui and not args.fixture:
    parser.error("--verify-ui requires --fixture to prevent using real account data")

from PySide6.QtCore import Qt, QCoreApplication, QStandardPaths, QSettings, QTimer, QLockFile
QCoreApplication.setAttribute(Qt.AA_ShareOpenGLContexts)
from PySide6.QtWidgets import QApplication, QMessageBox
from casepilot.bridge import EngineBridge
from casepilot.model import WorkspaceModel
from casepilot.security import vault_key, EncryptedStore
from casepilot.network import NetworkBroker
from casepilot.native import NativeHost
from casepilot.theme import apply_appearance
from casepilot.window import MainWindow

app = QApplication(sys.argv[:1])
app.setOrganizationName("CasePilot")
app.setApplicationName("CasePilot Qt")
app.setApplicationDisplayName("AltCrate Qt")
app.setApplicationVersion("0.4.0-dev")
temporary = tempfile.TemporaryDirectory(prefix="casepilot-qt-ui-") if args.fixture and not args.data_dir else None
directory = args.data_dir or (Path(temporary.name) if temporary else Path(QStandardPaths.writableLocation(QStandardPaths.AppLocalDataLocation)))
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
if args.fixture:
    QSettings.setDefaultFormat(QSettings.IniFormat)
    QSettings.setPath(QSettings.IniFormat, QSettings.UserScope, str(directory / "settings"))
apply_appearance()
lock = QLockFile(str(directory / "casepilot-qt.lock"))
lock.setStaleLockTime(0)
if not lock.tryLock(0):
    QMessageBox.information(None, "AltCrate Qt", "A aplicação já está aberta com esta pasta de dados.")
    sys.exit(0)
try:
    key = vault_key(fixture=args.fixture)
except Exception as error:
    QMessageBox.critical(None, "AltCrate Qt", str(error))
    sys.exit(1)

root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
bridge = EngineBridge(root, directory, key)
model = WorkspaceModel(bridge)
model.fixture = args.fixture
window = MainWindow(model, fixture=args.fixture)
network = NetworkBroker(bridge, EncryptedStore(directory / "sessions", key))
host = NativeHost(bridge, network, window)
window.closing.connect(bridge.shutdown)
bridge.focus_requested.connect(lambda: (window.showNormal(), window.raise_(), window.activateWindow()))
restart = {"requested": False}
bridge.restart_requested.connect(lambda: restart.update(requested=True))


def stopped():
    host.close()
    window.allow_close = True
    window.close()
    app.quit()


bridge.stopped.connect(stopped)

def language_changed():
    global window
    previous = window
    window = MainWindow(model, fixture=args.fixture)
    window.resize(previous.size())
    host.parent = window
    window.closing.connect(bridge.shutdown)
    window.language_changed.connect(language_changed)
    window.show()
    previous.allow_close = True
    previous.close()
    previous.deleteLater()

window.language_changed.connect(language_changed)
window.show()
verification = {"fixture": "isolated empty account store", "nativeQt": True, "pages": [], "errors": []}
if args.verify_ui:
    args.verify_ui.mkdir(parents=True, exist_ok=True)
    bridge.failed.connect(lambda message: verification["errors"].append(message))
    def capture(index=0):
        if index >= len(window.page_ids):
            verification["channels"] = len(bridge.channels)
            verification["passed"] = not verification["errors"]
            (args.verify_ui / "empty-state-report.json").write_text(json.dumps(verification, ensure_ascii=False, indent=2))
            window.close()
            return
        identifier = window.page_ids[index]
        window.navigate(identifier)
        def save():
            target = args.verify_ui / (identifier + ".png")
            if not window.grab().save(str(target)):
                verification["errors"].append("Failed to save screenshot for " + identifier)
            verification["pages"].append(identifier)
            capture(index + 1)
        QTimer.singleShot(250, save)
    bridge.ready.connect(lambda _: QTimer.singleShot(500, capture))
    QTimer.singleShot(20000, lambda: (verification["errors"].append("UI verification timed out"), window.close()))
bridge.start()
exit_code = app.exec()
lock.unlock()
if temporary:
    temporary.cleanup()
if restart["requested"]:
    from PySide6.QtCore import QProcess
    QProcess.startDetached(sys.executable, [str(Path(__file__).resolve()), "--data-dir", str(directory)])
sys.exit(1 if verification["errors"] else exit_code)
