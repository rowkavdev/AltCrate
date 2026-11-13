"""Render native Qt pages with clearly labelled synthetic account data."""
import json
import os
import sys
import tempfile
from pathlib import Path
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from PySide6.QtCore import QSettings, QTimer
from PySide6.QtWidgets import QApplication
from casepilot.model import WorkspaceModel
from casepilot.window import MainWindow
from casepilot.theme import apply_appearance
from ui_fixture import FixtureBridge, ACCOUNTS, CASE_ID

destination = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "evidence" / "native-preview"
destination.mkdir(parents=True, exist_ok=True)
temporary = tempfile.TemporaryDirectory(prefix="casepilot-qt-preview-")
app = QApplication([])
app.setOrganizationName("CasePilotQtPreview")
app.setApplicationName("CasePilotQtPreview")
QSettings.setDefaultFormat(QSettings.IniFormat)
QSettings.setPath(QSettings.IniFormat, QSettings.UserScope, temporary.name)
QSettings().setValue("appearance/theme", os.environ.get("CASEPILOT_PREVIEW_THEME", "dark"))
QSettings().setValue("appearance/rtl", os.environ.get("CASEPILOT_PREVIEW_RTL", "1") == "1")
apply_appearance()
report = {"fixture": True, "nativeQt": True, "gameRequests": 0, "preset": "bKsI1x32", "theme": QSettings().value("appearance/theme"), "rtl": QSettings().value("appearance/rtl", type=bool), "pages": [], "callbackErrors": []}
sys.excepthook = lambda kind, value, trace: report["callbackErrors"].append(str(value))
bridge = FixtureBridge()
model = WorkspaceModel(bridge)
model.fixture = True
model.available = True
model.accounts = ACCOUNTS.copy()
model.selected = {"alpha", "beta"}
model.preferences = {"enableSiteOpening": True}
model.workspace = bridge.response("workspace:read", [])
profile_config = {"farm": {"case": True, "money": False, "vault": True}, "targetCase": CASE_ID, "itemRules": [
    {"id": "low-float", "name": "AK-47 | Case Hardened", "action": "keep", "conditions": {"floatMax": .1, "statTrak": False, "topN": 10}},
    {"id": "archive", "name": "AK-47 | Case Hardened", "action": "storage", "destinationAccountId": "beta", "storageUnitId": "c" * 24}],
    "destinations": [{"accountId": "beta", "storageUnitId": "c" * 24}]}
model.workspace["profiles"] = [{"id": "profile-fixture", "name": "Caixas e arquivo", "config": profile_config}]
model.snapshots = {account["id"]: bridge.response("accounts:refresh", [account["id"]]) for account in ACCOUNTS}
model.farm = bridge.response("farm:status", [])
model.events = [{"type": "progression", "accountId": "alpha", "kind": "skill-preset", "title": "Preset de caixas", "state": "completed", "message": "Fixture · 1 passo confirmado", "at": "2026-10-14T12:00:00Z"}]
window = MainWindow(model, fixture=True)
window.show_notice("PRÉ-VISUALIZAÇÃO QT · dados fictícios · sem ligação ao jogo")
window.show()
model.apply_profile(profile_config)
window.show_notice("PRÉ-VISUALIZAÇÃO QT · dados fictícios · sem ligação ao jogo")
model.changed.emit()


def capture(index=0):
    if index >= len(window.page_ids):
        (destination / "preview-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
        window.allow_close = True
        window.close()
        app.quit()
        return
    identifier = window.page_ids[index]
    window.navigate(identifier)
    page = window.page_widgets[identifier]
    if hasattr(page, "account"):
        page.account.setCurrentIndex(page.account.findData("alpha"))
    if identifier == "opening":
        page.catalog()
    elif identifier == "activity":
        page.load()
    elif identifier == "games":
        for card in page.cards.values():
            card.load()
        QTimer.singleShot(20, lambda: bridge.event.emit({"type": "socket-game-update", "accountId": "alpha", "game": "blackjack", "event": "blackjackTableState", "data": {
            "tableId": "fixture-table", "code": "FIXTURE", "phase": "acting", "roundNumber": 1, "dealerValue": 10, "dealerCards": [{"rank": "10", "suit": "S"}], "dealerHoleCardHidden": True,
            "seats": [{"mine": True, "turnId": "fixture-turn", "activeHandIndex": 0, "bet": 10, "hands": [{"status": "playing", "value": 16, "bet": 10, "cards": [{"rank": "8", "suit": "H"}, {"rank": "8", "suit": "D"}]}]}]}}))
    def save():
        if identifier == "opening":
            page.cases.setCurrentIndex(page.cases.findData(CASE_ID))
        window.grab().save(str(destination / f"{index:02d}-{identifier}.png"))
        if identifier in ("games", "inventory", "opening", "skills", "settings", "rewards", "accounts", "activity"):
            page.scroll.verticalScrollBar().setValue(550)
            app.processEvents()
            window.grab().save(str(destination / f"{index:02d}-{identifier}-details.png"))
            if identifier == "accounts":
                page.scroll.verticalScrollBar().setValue(1100)
                app.processEvents()
                window.grab().save(str(destination / f"{index:02d}-{identifier}-profiles.png"))
            page.scroll.verticalScrollBar().setValue(0)
        report["pages"].append(identifier)
        QTimer.singleShot(50, lambda: capture(index + 1))
    QTimer.singleShot(250, save)

QTimer.singleShot(300, capture)
app.exec()
temporary.cleanup()
if report["callbackErrors"]:
    print(json.dumps(report["callbackErrors"]))
    sys.exit(1)
