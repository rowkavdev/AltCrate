from __future__ import annotations
import json
from PySide6.QtCore import QSettings, Signal
from PySide6.QtWidgets import QCheckBox, QComboBox, QLabel, QLineEdit, QSpinBox, QFormLayout, QDialog
from ..widgets import Page, Card, DataTable, ReviewDialog, TileGrid, button, row, t
from ..theme import apply_appearance

DEFAULT_PROFILE = {"name": "", "host": "", "user": "", "port": 22, "keyPath": "", "nodePath": "/usr/bin/node", "controlPath": "/opt/casepilot-farm/serverFarmControl.cjs", "dataDirectory": "/var/lib/casepilot-farm", "serviceName": "casepilot-farm"}


class SettingsPage(Page):
    language_changed = Signal()
    def __init__(self, model):
        super().__init__(model, "Definições", "Idioma e funcionalidades opcionais da aplicação.")
        self.config = {}
        self.tested = None
        self.busy = False
        language_card = Card("Idioma")
        self.language = QComboBox()
        self.language.addItem("Português", "pt")
        self.language.addItem("English", "en")
        self.language.setCurrentIndex(max(0, self.language.findData(QSettings().value("language", "pt"))))
        self.language.currentIndexChanged.connect(self.change_language)
        language_card.body.addWidget(self.language)
        self.site_opening = QCheckBox(t("Ativar preferências de abertura do site"))
        self.site_opening.toggled.connect(self.update_preference)
        language_card.body.addWidget(self.site_opening)
        
        look = Card("Aspeto")
        self.theme = QComboBox()
        self.theme.addItem(t("Escuro"), "dark")
        self.theme.addItem(t("Claro"), "light")
        self.theme.setCurrentIndex(max(0, self.theme.findData(QSettings().value("appearance/theme", "dark"))))
        self.rtl = QCheckBox(t("Da direita para a esquerda (RTL)"))
        self.rtl.setChecked(QSettings().value("appearance/rtl", True, type=bool))
        look.body.addWidget(self.theme)
        look.body.addWidget(self.rtl)
        self.theme.currentIndexChanged.connect(self.change_appearance)
        self.rtl.toggled.connect(self.change_appearance)
        self.body.addWidget(TileGrid([language_card, look], minimum=300, columns=2))
        server = Card("Onde executar o farm")
        note = QLabel(t("Usa o teu computador, uma VPS ou um servidor em casa. As contas ficam no destino que escolheres."))
        note.setWordWrap(True)
        server.body.addWidget(note)
        self.form = QFormLayout()
        self.fields = {}
        labels = {"name": "Nome do servidor", "host": "Endereço do servidor", "user": "Utilizador SSH", "port": "Porta SSH", "keyPath": "Chave SSH", "nodePath": "Caminho do Node", "controlPath": "Caminho do controlo", "dataDirectory": "Pasta de dados", "serviceName": "Nome do serviço"}
        for key, label in labels.items():
            if key == "port":
                field = QSpinBox()
                field.setRange(1, 65535)
                field.setValue(22)
                field.valueChanged.connect(self.draft_changed)
            else:
                field = QLineEdit(DEFAULT_PROFILE[key])
                field.textChanged.connect(self.draft_changed)
            self.fields[key] = field
            self.form.addRow(t(label), field)
        server.body.addLayout(self.form)
        server.body.addWidget(button("Escolher chave", self.choose_key))
        self.install = button("Configurar servidor", self.install_server)
        self.identity_button = button("Ver identidade SSH", self.identify)
        self.test_button = button("Testar ligação", self.test)
        self.save_button = button("Guardar servidor", self.save, primary=True)
        server.body.addWidget(row(self.install, self.identity_button, self.test_button, self.save_button))
        self.identities = DataTable([("Tipo", "type"), ("Impressão digital", "fingerprint")])
        self.identities.setMinimumHeight(125)
        server.body.addWidget(self.identities)
        self.trust = button("Confirmar esta identidade", self.trust_identity)
        server.body.addWidget(self.trust)
        self.network_routes = DataTable([("Ligação", "routeId"), ("Estado", "message"), ("Tempo", "latencyMs")])
        self.network_routes.setMinimumHeight(120)
        server.body.addWidget(self.network_routes)
        self.server_status = QLabel()
        self.server_status.setWordWrap(True)
        server.body.addWidget(self.server_status)
        self.local = button("Passar para este computador", self.move_local)
        self.recover = button("Recuperar transferência", lambda: self.server_action("farm:server-recover", [], lambda _: self.load()))
        self.restart = button("Reiniciar app", lambda: self.server_action("farm:restart", []))
        server.body.addWidget(row(self.local, self.recover, self.restart, button("Atualizar", self.load)))
        self.body.addWidget(server)
        self.capabilities = DataTable([("Funcionalidade", lambda item: item.get("title", item.get("name", item.get("id")))), ("Estado", lambda item: item.get("state", item.get("available"))), ("Detalhe", lambda item: item.get("reason", item.get("description")))])
        self.secondary("Integrações e disponibilidade", self.capabilities)
        self.body.addStretch()
        model.changed.connect(self.update)
        model.bridge.ready.connect(lambda _: self.load())
        model.bridge.event.connect(self.receive_event)
        self.update()

    def change_language(self, *_):
        QSettings().setValue("language", self.language.currentData())
        self.language_changed.emit()

    def change_appearance(self, *_):
        QSettings().setValue("appearance/theme", self.theme.currentData())
        QSettings().setValue("appearance/rtl", self.rtl.isChecked())
        apply_appearance()

    def update(self):
        self.site_opening.blockSignals(True)
        self.site_opening.setChecked(self.model.preferences.get("enableSiteOpening") is True)
        self.site_opening.blockSignals(False)
        values = self.model.capabilities
        if isinstance(values, dict):
            values = values.get("capabilities", values.get("items", []))
        self.capabilities.set_records(values)
        self.save_button.setEnabled(not self.busy and self.tested == self.profile())
        self.local.setEnabled(not self.busy and self.config.get("enabled") is True)
        self.recover.setEnabled(not self.busy and bool(self.config.get("transition")))
        self.restart.setEnabled(not self.busy and self.config.get("restartRequired") is True)
        self.trust.setEnabled(not self.busy and self.identities.current_record() is not None)
        for field in self.fields.values():
            field.setEnabled(not self.busy)
        for button_ in (self.install, self.test_button, self.identity_button):
            button_.setEnabled(not self.busy and self.model.available)

    def update_preference(self, checked):
        self.model.call("preferences:update", [{"enableSiteOpening": checked}], lambda value: setattr(self.model, "preferences", value))

    def profile(self):
        return {key: field.value() if isinstance(field, QSpinBox) else field.text().strip() for key, field in self.fields.items()}

    def draft_changed(self, *_):
        self.tested = None
        self.identities.set_records([])
        self.network_routes.set_records([])
        self.update()

    def fill(self, profile):
        for key, field in self.fields.items():
            field.blockSignals(True)
            value = profile.get(key, DEFAULT_PROFILE[key])
            field.setValue(value) if isinstance(field, QSpinBox) else field.setText(str(value))
            field.blockSignals(False)

    def load(self):
        def loaded(config):
            self.config = config
            self.fill(config.get("profile") or DEFAULT_PROFILE)
            self.server_status.setText(config.get("error") or t("No meu servidor" if config.get("enabled") else "Neste computador"))
            self.update()
        self.model.call("farm:server-config", done=loaded)

    def server_action(self, channel, args, done=None):
        if self.busy:
            return
        self.busy = True
        self.server_status.setText(t("A verificar…"))
        self.update()
        def success(value):
            self.busy = False
            if done:
                done(value)
            self.update()
        def failure(message):
            self.busy = False
            self.server_status.setText(str(message))
            self.update()
        self.model.call(channel, args, success, error=failure)

    def choose_key(self):
        def chosen(value):
            if value:
                self.fields["keyPath"].setText(value)
        self.server_action("farm:server-key", [], chosen)

    def identify(self):
        def done(identities):
            self.identities.set_records(identities)
            self.server_status.setText(t("Compara esta impressão digital com a apresentada no teu servidor antes de confirmar."))
        self.server_action("farm:server-identity", [self.profile()], done)

    def trust_identity(self):
        identity = self.identities.current_record()
        if not identity:
            return
        review = ReviewDialog("Confirma a identidade do teu servidor", [("Endereço do servidor", self.profile()["host"]), ("Impressão digital", identity["fingerprint"])], ["Compara esta impressão digital com a apresentada no teu servidor antes de confirmar."], self)
        if review.exec() == QDialog.Accepted:
            self.server_action("farm:server-trust", [self.profile(), identity["fingerprint"]], lambda _: self.server_status.setText(t("Identidade confirmada. Testa agora a ligação.")))

    def show_test(self, value):
        self.tested = self.profile()
        self.server_status.setText(t("Ligação verificada. Podes guardar este servidor."))
        self.network_routes.set_records((value.get("networkCheck") or {}).get("routes", []))

    def test(self):
        self.tested = None
        self.server_action("farm:server-test", [self.profile()], self.show_test)

    def install_server(self):
        review = ReviewDialog("Configurar servidor", [("Endereço do servidor", self.profile()["host"]), ("Utilizador SSH", self.profile()["user"]), ("Pasta de dados", self.profile()["dataDirectory"])], ["Instalar e verificar o worker no servidor escolhido.", "O farm deve estar parado antes de atualizar o worker."], self)
        if review.exec() == QDialog.Accepted:
            def done(value):
                self.fill(value.get("profile") or self.profile())
                self.show_test(value)
            self.server_action("farm:server-setup", [self.profile()], done)

    def save(self):
        if self.tested != self.profile():
            return
        def done(value):
            self.config = value
            self.server_status.setText(t("Ligação guardada. Envia as contas na página Automação."))
        self.server_action("farm:server-configure", [self.profile()], done)

    def move_local(self):
        review = ReviewDialog("Passar para este computador", [("Servidor", (self.config.get("profile") or {}).get("name"))], ["A app vai parar o farm no servidor e recuperar as sessões, os resultados e os limites atuais para este computador."], self)
        if review.exec() == QDialog.Accepted:
            def done(value):
                self.config = value
                self.server_status.setText(t("Sessões e limites recuperados. Reinicia a app para continuar."))
            self.server_action("farm:local", [], done)

    def receive_event(self, event):
        if event.get("type") == "server-setup":
            labels = {"checking": "A verificar o servidor…", "downloading": "A preparar o Node para o servidor…", "installing": "A instalar e verificar o worker…", "network": "A verificar a ligação do servidor ao jogo…", "ready": "Servidor configurado. Guarda a ligação e envia as contas na página Automação."}
            self.server_status.setText(t(labels.get(event.get("stage"), "A verificar…")))
