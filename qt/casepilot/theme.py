"""The shadcn bKsI1x32 appearance rendered with native Qt widgets."""
from pathlib import Path
import json
from PySide6.QtCore import QByteArray, QEvent, QObject, QSettings, QSize, Qt, Signal
from PySide6.QtGui import QColor, QFont, QFontDatabase, QIcon, QPainter, QPalette, QPixmap
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import QAbstractButton, QApplication

ASSETS = Path(__file__).parent / "assets"
PRESET = json.loads((ASSETS / "preset.json").read_text())
NAV_ICONS = dict(zip(
    ("overview", "accounts", "automation", "opening", "converter", "inventory", "games", "rewards", "skills", "autoopen", "diagnostics", "settings", "activity"),
    ("layout-dashboard", "users", "gauge", "boxes", "arrow-right-left", "package", "coins", "gift", "map", "settings-2", "scan-line", "settings-2", "activity")))


def colors(mode="dark"):
    return PRESET["palette"][mode if mode in ("dark", "light") else "dark"]


def stylesheet(mode="dark"):
    c = colors(mode)
    # Large radii use the preset scale, clamped to half the control height.
    return f"""
QWidget {{ background:{c['background']}; color:{c['foreground']}; font-family:Inter; font-size:13px; }}
QMainWindow, QScrollArea, QScrollArea>QWidget>QWidget {{ background:{c['background']}; }}
QLabel {{ background:transparent; }}
QLabel#pageTitle {{ font-size:27px; font-weight:650; }}
QLabel#cardTitle {{ font-size:16px; font-weight:600; }}
QLabel#muted {{ color:{c['muted-foreground']}; }}
QLabel#metric {{ font-size:29px; font-weight:600; }}
QLabel#brand {{ font-size:21px; font-weight:700; }}
QLabel#notice {{ background:{c['muted']}; color:{c['foreground']}; padding:12px 24px; border-bottom:1px solid {c['border']}; }}
QWidget#sidebar {{ background:{c['sidebar']}; border:1px solid {c['border']}; }}
QWidget#navigationEntry, QWidget#brandRow, QWidget#disclosureContent {{ background:transparent; }}
QLabel#brandNote {{ font-size:11px; color:{c['muted-foreground']}; }}
QLabel#navGroup {{ font-size:10px; font-weight:650; color:{c['muted-foreground']}; padding:10px 12px 2px; }}
QWidget#topbar {{ background:{c['background']}; border-bottom:1px solid {c['border']}; }}
QLabel#breadcrumb {{ font-weight:600; }}
QLabel#executionStatus {{ color:{c['muted-foreground']}; font-size:12px; }}
QLabel#executionStatus[running=true] {{ color:{c['sidebar-primary']}; }}
QWidget#noticeBar {{ background:{c['muted']}; border-bottom:1px solid {c['border']}; }}
QFrame#disclosure {{ background:{c['card']}; border:1px solid {c['border']}; border-radius:12px; }}
QPushButton#disclosureToggle {{ background:transparent; border:0; padding:8px 4px; text-align:left; font-weight:600; }}
QPushButton#disclosureToggle:checked {{ color:{c['sidebar-primary']}; }}
QPushButton#navButton {{ background:transparent; border:0; border-radius:7px; padding:8px 12px; text-align:left; font-size:12px; color:{c['muted-foreground']}; }}
QPushButton#navButton:hover {{ background:{c['accent']}; color:{c['foreground']}; }}
QPushButton#navButton[active=true] {{ background:{c['accent']}; color:{c['sidebar-primary']}; font-weight:600; }}
QPushButton#navButton:focus {{ border:1px solid {c['ring']}; }}
QPushButton#themeToggle {{ background:transparent; border:0; padding:6px; }}
QFrame#card {{ background:{c['card']}; border:1px solid {c['border']}; border-radius:12px; }}
QWidget#controlRow {{ background:transparent; }}
QPushButton {{ background:{c['secondary']}; color:{c['secondary-foreground']}; border:1px solid {c['border']}; padding:10px 16px; border-radius:7px; font-weight:500; }}
QPushButton:hover {{ background:{c['accent']}; border-color:{c['ring']}; }}
QPushButton:focus {{ border:2px solid {c['ring']}; padding:9px 15px; }}
QPushButton:disabled {{ color:{c['muted-foreground']}; background:{c['muted']}; border-color:{c['border']}; }}
QPushButton[primary=true] {{ background:{c['primary']}; border-color:{c['primary']}; color:{c['primary-foreground']}; }}
QPushButton[primary=true]:hover {{ background:{c['sidebar-primary']}; border-color:{c['sidebar-primary']}; }}
QPushButton[primary=true]:disabled {{ background:{c['muted']}; border-color:{c['border']}; color:{c['muted-foreground']}; }}
QLineEdit, QComboBox, QSpinBox, QDoubleSpinBox, QPlainTextEdit, QTextEdit {{ background:{c['card']}; border:1px solid {c['input']}; padding:9px 12px; border-radius:7px; selection-background-color:{c['primary']}; selection-color:{c['primary-foreground']}; }}
QLineEdit:focus, QComboBox:focus, QSpinBox:focus, QDoubleSpinBox:focus, QPlainTextEdit:focus {{ border-color:{c['ring']}; }}
QComboBox::drop-down {{ width:24px; border:0; }}
QComboBox::down-arrow {{ image:url("{(ASSETS / 'chevron-down.svg').as_posix()}"); width:14px; height:14px; }}
QSpinBox::up-arrow, QDoubleSpinBox::up-arrow {{ image:url("{(ASSETS / 'chevron-up.svg').as_posix()}"); width:12px; height:12px; }}
QSpinBox::down-arrow, QDoubleSpinBox::down-arrow {{ image:url("{(ASSETS / 'chevron-down.svg').as_posix()}"); width:12px; height:12px; }}
QListWidget, QTableWidget {{ background:{c['card']}; alternate-background-color:{c['muted']}; border:1px solid {c['border']}; border-radius:8px; outline:0; selection-background-color:{c['accent']}; selection-color:{c['foreground']}; gridline-color:{c['border']}; }}
QListWidget::item {{ padding:11px 13px; border:0; border-radius:7px; }}
QListWidget::item:hover {{ background:{c['accent']}; }}
QListWidget::item:selected {{ background:{c['accent']}; color:{c['foreground']}; font-weight:600; }}
QListWidget#navigation {{ border:0; background:transparent; }}
QListWidget#navigation::item {{ padding:0; margin:0; border:0; background:transparent; }}
QTableWidget::item {{ padding:7px; }}
QTableWidget::item:selected {{ background:{c['accent']}; color:{c['foreground']}; }}
QHeaderView::section {{ background:{c['muted']}; color:{c['muted-foreground']}; border:0; border-bottom:1px solid {c['border']}; padding:10px; font-weight:600; }}
QCheckBox, QRadioButton {{ spacing:9px; background:transparent; }}
QCheckBox::indicator {{ width:16px; height:16px; border:1px solid {c['ring']}; background:{c['card']}; border-radius:5px; }}
QCheckBox::indicator:checked {{ background:{c['primary']}; border-color:{c['primary']}; image:url("{(ASSETS / 'check.svg').as_posix()}"); }}
QListWidget::indicator {{ width:16px; height:16px; border:1px solid {c['ring']}; background:{c['card']}; border-radius:5px; }}
QListWidget::indicator:checked {{ background:{c['primary']}; border-color:{c['primary']}; image:url("{(ASSETS / 'check.svg').as_posix()}"); }}
QRadioButton::indicator {{ width:16px; height:16px; border:1px solid {c['ring']}; border-radius:8px; background:{c['card']}; }}
QRadioButton::indicator:checked {{ background:{c['primary']}; border:3px solid {c['card']}; }}
QScrollBar:vertical {{ background:transparent; width:10px; margin:5px 0; }}
QScrollBar::handle:vertical {{ background:{c['border']}; border-radius:5px; min-height:25px; }}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height:0; }}
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{ background:transparent; }}
QSplitter::handle {{ background:{c['border']}; width:1px; }}
QToolTip, QMenu {{ background:{c['popover']}; border:1px solid {c['border']}; color:{c['popover-foreground']}; padding:6px; border-radius:12px; }}
QMenu::item {{ padding:8px 20px; border-radius:10px; }}
QMenu::item:selected {{ background:{c['accent']}; }}
QMenu::item:disabled {{ color:{c['muted-foreground']}; }}
QMenu::separator {{ height:1px; background:{c['border']}; margin:5px; }}
QTabWidget::pane {{ border:1px solid {c['border']}; border-radius:8px; background:{c['card']}; }}
QTabBar::tab {{ background:{c['muted']}; color:{c['muted-foreground']}; padding:10px 18px; border-radius:7px; margin:3px; }}
QTabBar::tab:selected {{ background:{c['card']}; color:{c['foreground']}; }}
QProgressBar {{ border:0; background:{c['muted']}; border-radius:8px; text-align:center; }}
QProgressBar::chunk {{ background:{c['primary']}; border-radius:8px; }}
"""


def icon(identifier, mode="dark", *, active=False):
    if identifier == "brand":
        source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" fill="currentColor"><path d="M8 23 29 11 43 19 36 27 29 23 18 29v15l11 6 11-6v-9l10-10v25L29 62 8 50Z"/><path d="M39 4h25v25H54V21L40 35l-7-7 14-14h-8Z"/></svg>'
    else:
        source = (ASSETS / "icons" / (NAV_ICONS.get(identifier, identifier) + ".svg")).read_text()
    result = QIcon()
    for state, color in ((QIcon.Normal, colors(mode)["sidebar-primary" if active or identifier == "brand" else "muted-foreground"]), (QIcon.Selected, colors(mode)["sidebar-primary"])):
        renderer = QSvgRenderer(QByteArray(source.replace("currentColor", color).encode()))
        for size in (20, 40):
            pixmap = QPixmap(size, size)
            pixmap.fill(Qt.transparent)
            painter = QPainter(pixmap)
            renderer.render(painter)
            painter.end()
            result.addPixmap(pixmap, state)
    return result


class Appearance(QObject):
    changed = Signal(str)

    def eventFilter(self, target, event):
        if event.type() == QEvent.Polish and isinstance(target, QAbstractButton):
            target.setCursor(Qt.PointingHandCursor)
        return False

    def apply(self):
        app = QApplication.instance()
        mode = QSettings().value("appearance/theme", "dark")
        c = colors(mode)
        palette = QPalette()
        for role, token in ((QPalette.Window, "background"), (QPalette.WindowText, "foreground"), (QPalette.Base, "card"), (QPalette.AlternateBase, "muted"), (QPalette.Text, "foreground"), (QPalette.Button, "secondary"), (QPalette.ButtonText, "secondary-foreground"), (QPalette.Highlight, "accent"), (QPalette.HighlightedText, "foreground"), (QPalette.ToolTipBase, "popover"), (QPalette.ToolTipText, "popover-foreground")):
            palette.setColor(role, QColor(c[token]))
        app.setPalette(palette)
        app.setStyleSheet(stylesheet(mode))
        rtl = QSettings().value("appearance/rtl", True, type=bool)
        app.setLayoutDirection(Qt.RightToLeft if rtl else Qt.LeftToRight)
        self.changed.emit(mode)


def appearance():
    app = QApplication.instance()
    if not hasattr(app, "casepilot_appearance"):
        app.casepilot_appearance = Appearance(app)
        app.installEventFilter(app.casepilot_appearance)
        app.setStyle("Fusion")
        identifier = QFontDatabase.addApplicationFont(str(ASSETS / "Inter.ttf"))
        families = QFontDatabase.applicationFontFamilies(identifier)
        app.setFont(QFont(families[0] if families else "Inter", 10))
    return app.casepilot_appearance


def apply_appearance():
    appearance().apply()
