from __future__ import annotations
from PySide6.QtCore import Qt, QSettings, Signal, QSize
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (QMainWindow, QWidget, QHBoxLayout, QVBoxLayout,
    QListWidget, QListWidgetItem, QLabel, QStackedWidget, QPushButton, QStyledItemDelegate)
from .widgets import button, t
from .theme import appearance, icon, apply_appearance
from .pages.basic import OverviewPage, AccountsPage, AutomationPage, OpeningPage, ConverterPage, ActivityPage
from .pages.progression import RewardsPage, SkillsPage, AutoOpenPage, DiagnosticsPage
from .pages.settings import SettingsPage
from .pages.inventory import InventoryPage
from .pages.games import GamesPage

PAGE_FACTORIES = [
    ("overview", "Visão geral", OverviewPage),
    ("accounts", "Contas", AccountsPage),
    ("automation", "Automação", AutomationPage),
    ("opening", "Abrir caixas", OpeningPage),
    ("converter", "Conversor de tokens", ConverterPage),
    ("inventory", "Inventário", InventoryPage),
    ("games", "Jogos", GamesPage),
    ("rewards", "Recompensas", RewardsPage),
    ("skills", "Mapas de skills", SkillsPage),
    ("autoopen", "Preferências de abertura", AutoOpenPage),
    ("diagnostics", "Diagnóstico", DiagnosticsPage),
    ("settings", "Definições", SettingsPage),
    ("activity", "Atividade", ActivityPage),
]
NAV_GROUPS = [
    ("Workspace", ("overview", "accounts")),
    ("Operações", ("automation", "opening", "converter", "inventory", "games")),
    ("Progressão", ("rewards", "skills", "autoopen")),
    ("Acompanhamento", ("diagnostics", "settings", "activity")),
]


class NavigationDelegate(QStyledItemDelegate):
    def paint(self, painter, option, index):
        # Item widgets paint the grouped navigation; avoid duplicate decorations.
        pass

    def updateEditorGeometry(self, editor, option, index):
        editor.setGeometry(option.rect)


class MainWindow(QMainWindow):
    closing = Signal()
    language_changed = Signal()

    def __init__(self, model, *, fixture=False):
        super().__init__()
        self.model = model
        self.fixture = fixture
        self.allow_close = False
        self.setWindowTitle("AltCrate Qt" + (" · fixture" if fixture else " · em migração"))
        self.resize(1320, 860)
        self.setMinimumSize(780, 600)
        root = QWidget()
        outer = QVBoxLayout(root)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)
        self.banner_row = QWidget()
        self.banner_row.setObjectName("noticeBar")
        banner_layout = QHBoxLayout(self.banner_row)
        banner_layout.setContentsMargins(16, 4, 16, 4)
        self.banner = QLabel()
        self.banner.setWordWrap(True)
        banner_layout.addWidget(self.banner, 1)
        banner_layout.addWidget(button("×", lambda: self.show_notice("")))
        self.banner_row.hide()
        outer.addWidget(self.banner_row)
        shell = QHBoxLayout()
        shell.setContentsMargins(0, 0, 0, 0)
        shell.setSpacing(0)
        self.sidebar = QWidget()
        self.sidebar.setObjectName("sidebar")
        self.sidebar.setFixedWidth(232)
        layout = QVBoxLayout(self.sidebar)
        layout.setContentsMargins(12, 24, 12, 16)
        layout.setSpacing(6)
        brand = QWidget()
        brand.setObjectName("brandRow")
        brand_layout = QHBoxLayout(brand)
        brand_layout.setContentsMargins(5, 0, 5, 20)
        self.brand_icon = QLabel()
        brand_layout.addWidget(self.brand_icon)
        brand_text = QVBoxLayout()
        brand_text.setSpacing(2)
        name = QLabel("AltCrate")
        name.setObjectName("brand")
        brand_text.addWidget(name)
        note = QLabel(t("Centro de operações"))
        note.setObjectName("brandNote")
        brand_text.addWidget(note)
        brand_layout.addLayout(brand_text, 1)
        layout.addWidget(brand)
        self.navigation = QListWidget()
        self.navigation.setObjectName("navigation")
        self.navigation.setItemDelegate(NavigationDelegate(self.navigation))
        self.navigation.setAccessibleName(t("Menu principal"))
        self.navigation.setIconSize(QSize(18, 18))
        self.navigation.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.navigation.setTextElideMode(Qt.ElideRight)
        self.navigation.viewport().setCursor(Qt.PointingHandCursor)
        self.pages = QStackedWidget()
        self.page_ids = []
        self.page_widgets = {}
        self.nav_buttons = {}
        group_starts = {ids[0]: label for label, ids in NAV_GROUPS}
        for identifier, title, factory in PAGE_FACTORIES:
            item = QListWidgetItem()
            item.setToolTip(t(title))
            item.setData(Qt.UserRole, identifier)
            item.setData(Qt.AccessibleTextRole, t(title))
            self.navigation.addItem(item)
            entry = QWidget()
            entry.setObjectName("navigationEntry")
            entry_layout = QVBoxLayout(entry)
            entry_layout.setContentsMargins(0, 0, 0, 0)
            entry_layout.setSpacing(0)
            if identifier in group_starts:
                group = QLabel(t(group_starts[identifier]))
                group.setObjectName("navGroup")
                group.setFixedHeight(37)
                entry_layout.addWidget(group)
            control = QPushButton(t(title))
            control.setObjectName("navButton")
            control.setToolTip(t(title))
            control.setAccessibleName(t(title))
            control.setIconSize(QSize(17, 17))
            control.setCursor(Qt.PointingHandCursor)
            control.setFixedHeight(39)
            control.clicked.connect(lambda _, identifier=identifier: self.navigate(identifier))
            entry_layout.addWidget(control)
            item.setSizeHint(QSize(208, 76 if identifier in group_starts else 39))
            self.navigation.setItemWidget(item, entry)
            self.nav_buttons[identifier] = control
            page = factory(model)
            page.setObjectName("page-" + identifier)
            self.pages.addWidget(page)
            self.page_ids.append(identifier)
            self.page_widgets[identifier] = page
            if isinstance(page, SettingsPage):
                page.language_changed.connect(self.language_changed.emit)
        layout.addWidget(self.navigation, 1)
        self.connection = QLabel(t("Sessões isoladas"))
        self.connection.setObjectName("muted")
        self.connection.setWordWrap(True)
        layout.addWidget(self.connection)
        version = QLabel("Case Clicker · v0.4.0 · Qt")
        version.setObjectName("brandNote")
        layout.addWidget(version)
        shell.addWidget(self.sidebar)
        workspace = QWidget()
        workspace_layout = QVBoxLayout(workspace)
        workspace_layout.setContentsMargins(0, 0, 0, 0)
        workspace_layout.setSpacing(0)
        self.topbar = QWidget()
        self.topbar.setObjectName("topbar")
        self.topbar.setFixedHeight(56)
        top = QHBoxLayout(self.topbar)
        top.setContentsMargins(24, 0, 24, 0)
        self.menu_toggle = button("☰", self.toggle_menu)
        self.menu_toggle.setAccessibleName(t("Abrir menu"))
        self.menu_toggle.setFixedWidth(40)
        self.menu_toggle.hide()
        top.addWidget(self.menu_toggle)
        context = QLabel("AltCrate  ›")
        context.setObjectName("muted")
        top.addWidget(context)
        self.breadcrumb = QLabel()
        self.breadcrumb.setObjectName("breadcrumb")
        top.addWidget(self.breadcrumb, 1)
        self.execution = QLabel()
        self.execution.setObjectName("executionStatus")
        top.addWidget(self.execution)
        self.theme_toggle = button("", self.toggle_theme)
        self.theme_toggle.setObjectName("themeToggle")
        self.theme_toggle.setFixedSize(34, 34)
        top.addWidget(self.theme_toggle)
        workspace_layout.addWidget(self.topbar)
        workspace_layout.addWidget(self.pages, 1)
        shell.addWidget(workspace, 1)
        outer.addLayout(shell, 1)
        self.setCentralWidget(root)
        self.navigation.currentRowChanged.connect(self.navigate_index)
        self.page_widgets["overview"].navigate_requested.connect(self.navigate)

        def profile_config():
            from copy import deepcopy
            opening = self.page_widgets["opening"]
            allowed = ("id", "name", "action", "conditions", "destinationAccountId", "storageUnitId")
            rules = [{key: deepcopy(value) for key, value in rule.items() if key in allowed and (rule.get("action") == "storage" or key not in ("destinationAccountId", "storageUnitId"))} for rule in opening.rules.current_rules()]
            return {"farm": {key: check.isChecked() for key, check in self.page_widgets["automation"].modes.items()}, "targetCase": opening.cases.currentData() or None, "itemRules": rules, "destinations": deepcopy((model.loaded_profile or {}).get("destinations", []))}
        model.profile_config = profile_config
        model.config_changed.emit()
        appearance().changed.connect(self.update_icons)
        model.changed.connect(self.update_workspace)
        self.update_icons(QSettings().value("appearance/theme", "dark"))
        model.notice.connect(self.show_notice)
        model.bridge.ready.connect(lambda _: self.connection.setText(t("Sessões isoladas")))
        self.shortcut = QShortcut(QKeySequence("F5"), self)
        self.shortcut.activated.connect(model.refresh_accounts)
        self.escape = QShortcut(QKeySequence("Escape"), self)
        self.escape.activated.connect(self.close_menu)
        self.update_workspace()
        self.navigate(QSettings().value("page", "overview"))

    def update_workspace(self):
        enabled = self.model.preferences.get("enableSiteOpening") is True
        self.navigation.item(self.page_ids.index("autoopen")).setHidden(not enabled)
        if not enabled and self.pages.currentWidget() is self.page_widgets["autoopen"]:
            self.navigate("settings")
        converter = self.model.converter.get("phase") in ("preparing", "running", "stopping")
        running = self.model.farm.get("phase") in ("running", "stopping")
        self.execution.setText("●  " + t("Conversor em execução" if converter else "Automação em execução" if running else "Operações prontas"))
        self.execution.setProperty("running", converter or running)
        self.execution.style().unpolish(self.execution)
        self.execution.style().polish(self.execution)

    def navigate_index(self, index):
        if not 0 <= index < len(self.page_ids):
            return
        identifier = self.page_ids[index]
        if identifier == "autoopen" and self.model.preferences.get("enableSiteOpening") is not True:
            self.navigate("settings")
            return
        previous = self.pages.currentWidget()
        if previous is not self.pages.widget(index) and self.model.available and hasattr(previous, "on_hide"):
            previous.on_hide()
        self.pages.setCurrentIndex(index)
        QSettings().setValue("page", identifier)
        self.breadcrumb.setText(t(PAGE_FACTORIES[index][1]))
        for page_id, control in self.nav_buttons.items():
            control.setProperty("active", page_id == identifier)
            control.setIcon(icon(page_id, QSettings().value("appearance/theme", "dark"), active=page_id == identifier))
            control.setChecked(page_id == identifier)
            control.style().unpolish(control)
            control.style().polish(control)
        page = self.pages.widget(index)
        if previous is not page:
            page.scroll.verticalScrollBar().setValue(0)
        if self.model.available and hasattr(page, "on_show"):
            page.on_show()
        self.close_menu()

    def navigate(self, identifier):
        if identifier == "autoopen" and self.model.preferences.get("enableSiteOpening") is not True:
            identifier = "settings"
        if identifier not in self.page_ids:
            identifier = "overview"
        self.navigation.setCurrentRow(self.page_ids.index(identifier))

    def toggle_theme(self):
        settings = QSettings()
        settings.setValue("appearance/theme", "light" if settings.value("appearance/theme", "dark") == "dark" else "dark")
        apply_appearance()

    def update_icons(self, mode):
        self.brand_icon.setPixmap(icon("brand", mode).pixmap(32, 32))
        for index, identifier in enumerate(self.page_ids):
            image = icon(identifier, mode)
            self.navigation.item(index).setIcon(image)
            self.nav_buttons[identifier].setIcon(icon(identifier, mode, active=self.page_ids.index(identifier) == self.pages.currentIndex()))
        self.theme_toggle.setIcon(icon("sun" if mode == "dark" else "moon", mode))
        self.theme_toggle.setAccessibleName(t("Ativar modo claro" if mode == "dark" else "Ativar modo escuro"))
        settings_page = self.page_widgets["settings"]
        settings_page.theme.blockSignals(True)
        settings_page.theme.setCurrentIndex(settings_page.theme.findData(mode))
        settings_page.theme.blockSignals(False)

    def toggle_menu(self):
        self.sidebar.setVisible(self.sidebar.isHidden())
        self.menu_toggle.setAccessibleName(t("Fechar menu" if self.sidebar.isVisible() else "Abrir menu"))

    def close_menu(self):
        if self.width() < 1100:
            self.sidebar.hide()
            self.menu_toggle.setAccessibleName(t("Abrir menu"))

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if hasattr(self, "sidebar") and hasattr(self, "menu_toggle"):
            self.menu_toggle.setVisible(self.width() < 1100)
            self.sidebar.setVisible(self.width() >= 1100)

    def show_notice(self, message):
        self.banner.setText(t(str(message)))
        self.banner_row.setVisible(bool(message))

    def closeEvent(self, event):
        if self.allow_close:
            event.accept()
        else:
            event.ignore()
            self.setEnabled(False)
            self.show_notice("A guardar o estado das operações…")
            self.closing.emit()
