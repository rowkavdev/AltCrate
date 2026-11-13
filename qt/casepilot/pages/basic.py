from __future__ import annotations
import json
from PySide6.QtCore import Qt, QSettings, Signal
from PySide6.QtWidgets import QLabel, QLineEdit, QCheckBox, QComboBox, QDoubleSpinBox, QFormLayout, QInputDialog, QMessageBox, QDialog
from ..widgets import Page, Card, DataTable, AccountSelection, AccountPicker, ReviewDialog, TileGrid, button, row, number, t
from .opening_rules import OpeningRules
from .profiles import ProfilePanel
from .history import HistoryPanel


class OverviewPage(Page):
    navigate_requested = Signal(str)

    def __init__(self, model):
        super().__init__(model, "Visão geral", "O estado das tuas contas e operações, num só lugar.")
        self.header.layout().addWidget(button("Atualizar", model.refresh_accounts))
        self.metrics = {}
        cards = []
        for label, key, note in (("Contas ligadas", "connected", "Contas registadas"), ("Caixas nas contas", "cases", "Último estado observado"), ("Saldo virtual", "money", "Soma das contas ligadas"), ("Tokens nas contas", "tokens", "Soma das contas ligadas"), ("Contas a farmar", "active", "Espera indicada abaixo")):
            card = Card()
            caption = QLabel(t(label))
            caption.setObjectName("muted")
            card.body.addWidget(caption)
            value = QLabel("—")
            value.setObjectName("metric")
            value.setWordWrap(True)
            card.body.addWidget(value)
            hint = QLabel(t(note))
            hint.setObjectName("brandNote")
            hint.setWordWrap(True)
            card.body.addWidget(hint)
            self.metrics[key] = value
            cards.append(card)
        self.body.addWidget(TileGrid(cards, minimum=150))
        self.shortcuts = {}
        for identifier, title, description in (("automation", "Automação", "Caixas, dinheiro e cofre"), ("opening", "Abrir caixas", "Escolher a caixa e rever as regras"), ("inventory", "Inventário", "Consultar e gerir os itens")):
            control = button(title + "  ↗\n" + t(description), lambda identifier=identifier: self.navigate_requested.emit(identifier))
            control.setObjectName("shortcut")
            self.shortcuts[identifier] = control
        self.body.addWidget(TileGrid(list(self.shortcuts.values()), minimum=220, columns=3))
        self.status = Card("Estado da automação")
        self.status_label = QLabel()
        self.status_label.setWordWrap(True)
        self.summary_values = {}
        summaries = []
        for key, title in (("active", "Em curso"), ("queued", "Na fila"), ("waiting", "Em espera"), ("resolve", "Por resolver")):
            field = Card()
            value = QLabel("0")
            value.setObjectName("metric")
            field.body.addWidget(value)
            field.body.addWidget(QLabel(t(title)))
            self.summary_values[key] = value
            summaries.append(field)
        self.status.body.addWidget(TileGrid(summaries, minimum=120, columns=4))
        self.status.body.addWidget(row(self.status_label, button("Gerir automação ↗", lambda: self.navigate_requested.emit("automation"))))
        self.body.addWidget(self.status)
        recent = Card("Atividade recente")
        recent.body.addWidget(button("Ver tudo ↗", lambda: self.navigate_requested.emit("activity")))
        self.activity = DataTable([("Operação", "type"), ("Conta", "accountId"), ("Resultado", lambda event: event.get("message", event.get("state", "")))])
        recent.body.addWidget(self.activity)
        awards = Card("Caixas recebidas")
        self.awards = DataTable([("Caixa", "name"), ("Conta", "account"), ("Quantidade", "count"), ("Sem confirmação", "unverified")])
        awards.body.addWidget(self.awards)
        self.body.addWidget(TileGrid([recent, awards], minimum=390, columns=2))
        self.body.addStretch()
        model.changed.connect(self.update)
        self.update()

    def update(self):
        from ..workspace_view import farm_summary, case_awards
        summary = farm_summary(self.model.farm)
        totals = {**self.model.totals(), "active": summary["active"]}
        for key, value in totals.items():
            self.metrics[key].setText(("$" if key == "money" else "") + number(value, 2 if key in ("money", "tokens") else 0))
        for key, field in self.summary_values.items():
            field.setText(number(summary["paused"] + summary["login"] if key == "resolve" else summary[key], 0))
        running = self.model.farm.get("phase") in ("running", "stopping")
        self.status_label.setText(t("Em execução" if running else "Escolhe as contas e os modos para começar."))
        labels = {account["id"]: account["label"] for account in self.model.accounts}
        self.activity.set_records([{**event, "accountId": labels.get(event.get("accountId"), event.get("accountId", "—"))} for event in self.model.events[:5]])
        self.awards.set_records(case_awards(self.model.events, self.model.accounts, self.model.snapshots)[:6])


class AccountsPage(Page):
    def __init__(self, model):
        super().__init__(model, "Contas", "Gere sessões, saldos e caixas das contas ligadas.")
        self.search = QLineEdit()
        self.search.setPlaceholderText(t("Pesquisar conta…"))
        self.search.textChanged.connect(self.update)
        self.group_filter = QComboBox()
        self.session_filter = QComboBox()
        for key, label in (("all", "Todas as sessões"), ("connected", "Ligadas"), ("login", "Pedem login"), ("error", "Com erro")):
            self.session_filter.addItem(t(label), key)
        self.session_filter.setCurrentIndex(max(0, self.session_filter.findData(QSettings().value("accounts/status", "all"))))
        accounts = Card("As tuas contas")
        self.body.addWidget(accounts)
        accounts.body.addWidget(row(self.search, button("Atualizar", model.refresh_accounts)))
        self.selection = AccountSelection(model)
        accounts.body.addWidget(row(self.group_filter, self.session_filter))
        self.session_filter.currentIndexChanged.connect(self.filters_changed)
        self.group_filter.currentIndexChanged.connect(self.filters_changed)
        
        self.table = DataTable([("Conta", "label"), ("Email", "email"), ("Estado", "state"), ("Saldo virtual", "money"), ("Tokens", "tokens"), ("Caixas", "casesTotal")])
        accounts.body.addWidget(self.table)
        self.connect_button = button("Ligar conta", self.connect)
        self.connect_all_button = button("Ligar contas selecionadas", self.connect_all)
        self.remove_button = button("Remover conta", self.remove)
        accounts.body.addWidget(row(self.connect_button, self.connect_all_button, button("Parar logins", lambda: model.call("accounts:login-stop")), self.remove_button))
        self.detail_button = button("Ver detalhes", self.details)
        self.table.itemDoubleClicked.connect(lambda _: self.details())
        accounts.body.addWidget(self.detail_button)
        self.secondary("Adicionar e importar contas", row(button("Adicionar conta", self.add), button("Importar contas", self.import_accounts)))
        groups = Card("Grupos de contas")
        self.group = QComboBox()
        groups.body.addWidget(row(self.group, button("Selecionar grupo", self.select_group), button("Atribuir ao grupo", self.assign_group), button("Criar grupo", self.create_group)))
        self.groups = DataTable([("Nome", "name"), ("Contas", lambda group: sum(self.model.workspace.get("accountGroups", {}).get(account["id"]) == group["id"] for account in self.model.accounts))])
        groups.body.addWidget(self.groups)
        self.group_actions = [button("Renomear", self.rename_group), button("Subir grupo", lambda: self.move_group(-1)), button("Descer grupo", lambda: self.move_group(1)), button("Apagar grupo", self.delete_group)]
        groups.body.addWidget(row(*self.group_actions))
        self.groups.itemSelectionChanged.connect(self.buttons)
        self.secondary("Grupos e seleção", self.selection, groups)
        self.profiles = ProfilePanel(model)
        self.secondary("Perfis de operação", self.profiles)
        self.login_label = QLabel()
        self.login_label.setWordWrap(True)
        self.body.addWidget(self.login_label)
        self.body.addStretch()
        self.fingerprint = None
        self.table.itemSelectionChanged.connect(self.buttons)
        model.changed.connect(self.update)
        self.update()

    def update(self):
        groups = self.model.workspace.get("groups", [])
        options = [("all", t("Todos os grupos")), ("ungrouped", t("Sem grupo"))] + [(g["id"], g["name"]) for g in groups]
        if options != [(self.group_filter.itemData(i), self.group_filter.itemText(i)) for i in range(self.group_filter.count())]:
            current_filter = self.group_filter.currentData() or QSettings().value("accounts/group", "all")
            self.group_filter.blockSignals(True)
            self.group_filter.clear()
            for key, label in options:
                self.group_filter.addItem(label, key)
            self.group_filter.setCurrentIndex(max(0, self.group_filter.findData(current_filter)))
            self.group_filter.blockSignals(False)
        needle = self.search.text().casefold()
        rows = []
        for account in self.model.accounts:
            if needle not in (account["label"] + " " + account["id"] + " " + account.get("email", "")).casefold():
                continue
            group = self.model.workspace.get("accountGroups", {}).get(account["id"])
            selected_group = self.group_filter.currentData()
            if selected_group != "all" and (bool(group) if selected_group == "ungrouped" else group != selected_group):
                continue
            snapshot = self.model.snapshots.get(account["id"], {})
            operation = next((a for a in self.model.farm.get("accounts", []) if a["id"] == account["id"]), {})
            state_filter = self.session_filter.currentData()
            if state_filter == "connected" and (not snapshot or snapshot.get("error") or operation.get("needsLogin")):
                continue
            if state_filter == "error" and not snapshot.get("error"):
                continue
            if state_filter == "login" and not (operation.get("needsLogin") or account.get("email") and (not snapshot or snapshot.get("error"))):
                continue
            rows.append({**account, **snapshot, "state": snapshot.get("error") or ("Ligada" if snapshot else "A aguardar")})
        current = self.table.current_record()
        fingerprint = json.dumps(rows, sort_keys=True)
        if fingerprint != self.fingerprint:
            self.fingerprint = fingerprint
            self.table.set_records(rows)
            if current:
                for index, item in enumerate(rows):
                    if item["id"] == current["id"]:
                        self.table.selectRow(index)
        self.groups.set_records(groups)
        if [(self.group.itemData(index), self.group.itemText(index)) for index in range(self.group.count())] != [(None, t("Sem grupo"))] + [(g["id"], g["name"]) for g in groups]:
            current_group = self.group.currentData()
            self.group.clear()
            self.group.addItem(t("Sem grupo"), None)
            for group in groups:
                self.group.addItem(group["name"], group["id"])
            self.group.setCurrentIndex(max(0, self.group.findData(current_group)))
        self.login_label.setText(t("Logins") + ": " + self.model.login.get("phase", "idle") + " · " + self.model.login.get("message", ""))
        self.buttons()

    def filters_changed(self, *_):
        QSettings().setValue("accounts/group", self.group_filter.currentData())
        QSettings().setValue("accounts/status", self.session_filter.currentData())
        self.update()

    def buttons(self):
        ready = self.model.available and self.model.login.get("phase") not in ("running", "stopping")
        self.connect_button.setEnabled(ready and self.table.current_record() is not None)
        self.remove_button.setEnabled(ready and self.table.current_record() is not None)
        self.connect_all_button.setEnabled(ready and bool(self.model.selected))
        self.detail_button.setEnabled(self.table.current_record() is not None)
        for control in self.group_actions:
            control.setEnabled(self.model.available and "workspace:command" not in self.model.pending and self.groups.current_record() is not None)

    def details(self):
        record = self.table.current_record()
        if record:
            from .account_details import AccountDetailsDialog
            dialog = AccountDetailsDialog(self.model, record["id"], self)
            dialog.show()
            return dialog

    def add(self):
        label, ok = QInputDialog.getText(self, t("Adicionar conta"), t("Nome local da conta"))
        if ok and label.strip():
            self.model.call("accounts:login", [label.strip()], lambda _: self.model.reload_accounts())

    def import_accounts(self):
        def imported(value):
            if value:
                self.model.accounts = value["accounts"]
                self.model.notice.emit(f"{value['added']} " + t("contas importadas"))
                self.model.changed.emit()
        self.model.call("accounts:import", done=imported)

    def connect(self):
        record = self.table.current_record()
        if record:
            self.model.call("accounts:connect", [record["id"]], lambda _: self.model.refresh_accounts([record["id"]]))

    def connect_all(self):
        self.model.call("accounts:connect-all", [self.model.selected_ids()], lambda value: setattr(self.model, "login", value))

    def remove(self):
        record = self.table.current_record()
        if record and QMessageBox.question(self, t("Remover conta"), record["label"] + "\n" + t("A sessão local será removida.")) == QMessageBox.Yes:
            self.model.call("accounts:remove", [record["id"]], lambda _: self.model.reload_accounts())

    def create_group(self):
        name, ok = QInputDialog.getText(self, t("Criar grupo"), t("Nome"))
        if ok:
            self.model.workspace_command("createGroup", {"name": name})

    def assign_group(self):
        self.model.workspace_command("assignAccounts", {"groupId": self.group.currentData(), "accountIds": self.model.selected_ids()})

    def select_group(self):
        self.model.workspace_command("selectGroup", {"groupId": self.group.currentData()}, lambda value: self.model.select(value["accountIds"]))

    def rename_group(self):
        group = self.groups.current_record()
        if group:
            name, ok = QInputDialog.getText(self, t("Renomear"), t("Nome"), text=group["name"])
            if ok and name.strip():
                self.model.workspace_command("updateGroup", {"id": group["id"], "name": name.strip()})

    def move_group(self, direction):
        index = self.groups.currentRow()
        identifiers = [group["id"] for group in self.model.workspace.get("groups", [])]
        target = index + direction
        if index >= 0 and 0 <= target < len(identifiers):
            identifiers[index], identifiers[target] = identifiers[target], identifiers[index]
            self.model.workspace_command("reorderGroups", {"groupIds": identifiers})

    def delete_group(self):
        group = self.groups.current_record()
        if group:
            count = sum(value == group["id"] for value in self.model.workspace.get("accountGroups", {}).values())
            review = ReviewDialog("Apagar grupo", [("Nome", group["name"]), ("Contas", count)], ["As contas ficam sem grupo e mantêm as suas sessões."], self)
            if review.exec() == QDialog.Accepted:
                self.model.workspace_command("deleteGroup", {"id": group["id"]})


class AutomationPage(Page):
    def __init__(self, model):
        super().__init__(model, "Automação", "Caixas, dinheiro e cofre nas contas que selecionares.")
        self.body.addWidget(AccountSelection(model))
        controls = Card("Modos de farm")
        self.modes = {}
        boxes = []
        for label, key in (("Caixas", "case"), ("Dinheiro", "money"), ("Cofre", "vault")):
            check = QCheckBox(t(label))
            check.setChecked(True)
            self.modes[key] = check
            boxes.append(check)
            check.toggled.connect(lambda *_: model.config_changed.emit())
        controls.body.addWidget(row(*boxes, button("Aplicar às contas selecionadas", self.apply_modes)))
        self.start = button("Iniciar automação", lambda: model.call("farm:start", [model.selected_ids()], self.set_status), primary=True)
        self.stop = button("Parar automação", lambda: model.call("farm:stop", done=self.set_status))
        controls.body.addWidget(row(self.start, self.stop, button("Executar no servidor", self.server), button("Regressar ao Mac", lambda: model.call("farm:local", done=self.set_status))))
        self.status = QLabel()
        controls.body.addWidget(self.status)
        self.body.addWidget(controls)
        self.table = DataTable([("Conta", "label"), ("Estado", lambda item: "Pausa" if item.get("paused") else "Login" if item.get("needsLogin") else item.get("phase", "")),
                                ("Caixas", lambda item: item.get("results", {}).get("cases", item.get("casesClicked"))),
                                ("Dinheiro", lambda item: item.get("results", {}).get("money", item.get("moneyClicked"))), ("Erro", "error")])
        self.body.addWidget(self.table)
        self.body.addWidget(row(button("Pausar conta", lambda: self.account_action("farm:pause")), button("Retomar conta", lambda: self.account_action("farm:resume")), button("Recuperar transição", lambda: model.call("farm:server-recover", done=self.set_status))))
        self.body.addStretch()
        model.changed.connect(self.update)
        model.profile_loaded.connect(self.apply_profile)
        self.update()

    def set_status(self, value):
        self.model.farm = value

    def apply_profile(self, config):
        if "farm" in config:
            for key, check in self.modes.items():
                check.setChecked(config["farm"].get(key, False))

    def update(self):
        status = self.model.farm
        running = status.get("phase") in ("running", "stopping")
        self.start.setEnabled(self.model.available and bool(self.model.selected) and not running and "farm:start" not in self.model.pending)
        self.stop.setEnabled(self.model.available and running)
        self.status.setText(status.get("phase", "idle") + " · " + status.get("execution", {}).get("kind", "local"))
        self.table.set_records(status.get("accounts", []))

    def apply_modes(self):
        modes = {key: check.isChecked() for key, check in self.modes.items()}
        for identifier in self.model.selected_ids():
            self.model.call("farm:modes", [identifier, modes], self.set_status, busy_key="modes:" + identifier)

    def account_action(self, channel):
        record = self.table.current_record()
        if record:
            self.model.call(channel, [record["id"]], self.set_status)

    def server(self):
        self.model.call("farm:server", [self.model.selected_ids()], self.set_status)


class OpeningPage(Page):
    def __init__(self, model):
        super().__init__(model, "Abrir caixas", "Escolhe as contas, abre caixas e acompanha os resultados.")
        self.body.addWidget(AccountSelection(model))
        controls = Card("Caixa a abrir")
        self.cases = QComboBox()
        self.convert = QCheckBox(t("Converter automaticamente"))
        self.mode = QComboBox()
        self.mode.addItem(t("Tokens"), "tokens")
        self.mode.addItem(t("Dinheiro virtual"), "money")
        self.price = QDoubleSpinBox()
        self.price.setRange(0, 1000)
        self.price.setValue(5)
        controls.body.addWidget(row(self.cases, button("Atualizar", self.catalog)))
        controls.body.addWidget(row(self.convert, self.mode, self.price))
        self.start = button("Iniciar abertura", lambda: self.open(False), primary=True)
        self.test = button("Testar uma caixa", lambda: self.open(True))
        self.stop = button("Parar abertura", lambda: model.call("open:stop", done=lambda value: setattr(model, "opening", value)))
        controls.body.addWidget(row(self.start, self.test, self.stop))
        self.status = QLabel()
        controls.body.addWidget(self.status)
        self.body.addWidget(controls)
        self.rules = OpeningRules(model, self.cases, self)
        self.rules.changed.connect(model.config_changed.emit)
        self.cases.currentIndexChanged.connect(lambda *_: model.config_changed.emit())
        self.results = DataTable([("Conta", "accountId"), ("Confirmadas", "confirmedCount"), ("Por confirmar", "unconfirmedCount"), ("Resultado", "message")])
        results = Card("Resultados da abertura")
        results.body.addWidget(self.results)
        self.body.addWidget(results)
        self.secondary("Conteúdo e regras dos itens", self.rules)
        self.body.addStretch()
        self.catalog_items = []
        self.rules_by_case = self.rules.rules_by_case
        self.catalog_loaded = False
        model.changed.connect(self.update)
        model.profile_loaded.connect(self.apply_profile)
        self.update()

    def catalog(self):
        def done(value):
            self.catalog_items = value if isinstance(value, list) else value.get("cases", value.get("items", []))
            self.catalog_loaded = True
            self.update_cases()
        self.model.call("cases:showcase", done=done)

    def apply_profile(self, config):
        identifier = config.get("targetCase") or self.cases.currentData()
        if identifier:
            if self.cases.findData(identifier) < 0:
                self.cases.addItem(t("Caixa guardada (validar disponibilidade)"), identifier)
            self.cases.setCurrentIndex(self.cases.findData(identifier))
        if "itemRules" in config:
            from copy import deepcopy
            self.rules.save(deepcopy(config["itemRules"]))
            self.convert.setChecked(False)

    def update_cases(self):
        items = {item["id"]: item for item in self.catalog_items if item.get("id")}
        for identifier in self.model.selected_ids():
            for item in self.model.snapshots.get(identifier, {}).get("cases", []):
                items[item["id"]] = item
        current = self.cases.currentData()
        if current and current not in items and (self.model.loaded_profile or {}).get("targetCase") == current:
            items[current] = {"id": current, "name": t("Caixa guardada (validar disponibilidade)")}
        fingerprint = tuple((key, item.get("name")) for key, item in items.items())
        if getattr(self, "case_fingerprint", None) == fingerprint:
            return
        self.case_fingerprint = fingerprint
        current = self.cases.currentData()
        self.cases.clear()
        self.cases.addItem(t("Escolher caixa…"), "")
        for identifier, item in items.items():
            self.cases.addItem(item.get("name", identifier), identifier)
        self.cases.setCurrentIndex(max(0, self.cases.findData(current)))

    def update(self):
        self.update_cases()
        status = self.model.opening
        running = status.get("phase") in ("running", "stopping")
        enabled = self.model.available and bool(self.model.selected) and not running
        self.start.setEnabled(enabled)
        self.test.setEnabled(enabled and len(self.model.selected) == 1)
        self.stop.setEnabled(running)
        self.status.setText(status.get("phase", "idle") + " · " + t("Confirmadas") + ": " + str(status.get("confirmed", 0)) + " · " + t("Por confirmar") + ": " + str(status.get("unconfirmed", 0)))
        self.results.set_records([event for event in self.model.events if event.get("type") == "open"][:30])

    def open(self, test):
        convert = self.convert.isChecked() and not self.rules.current_rules()
        self.model.call("open:start", [{"accountIds": self.model.selected_ids(), "caseId": self.cases.currentData(), "convert": convert,
                                        "conversionMode": self.mode.currentData(), "maxPrice": self.price.value() if convert else 0, "testOnce": test,
                                        "itemRules": self.rules.current_rules()}],
                        lambda value: setattr(self.model, "opening", value))


class ConverterPage(Page):
    def __init__(self, model):
        super().__init__(model, "Conversor de tokens", "Converte caixas em tokens e envia-os para a conta que escolheres.")
        self.body.addWidget(AccountSelection(model))
        card = Card("Conta de destino")
        self.destination = AccountPicker(model)
        card.body.addWidget(self.destination)
        card.body.addWidget(QLabel(t("Vender caixas → comprar cápsulas → abrir e converter → enviar tokens")))
        self.start = button("Iniciar conversão", lambda: self.run("full"), primary=True)
        self.transfer = button("Enviar tokens existentes", lambda: self.run("trade"))
        self.stop = button("Parar conversor", lambda: model.call("converter:stop", done=self.set_status))
        card.body.addWidget(row(self.start, self.transfer, self.stop))
        self.status = QLabel()
        card.body.addWidget(self.status)
        self.body.addWidget(card)
        self.table = DataTable([("Conta", "sourceLabel"), ("Estado", "state"), ("Tokens", "sentTokens"), ("Etapa", "stage"), ("Resultado", "message")])
        self.body.addWidget(self.table)
        self.body.addWidget(row(button("Verificar estado", lambda: self.recover("converter:verify")), button("Cancelar envio", lambda: self.recover("converter:cancel")), button("Rever operação", lambda: self.recover("converter:acknowledge"))))
        self.body.addStretch()
        self.destination.changed.connect(self.update)
        model.changed.connect(self.update)
        self.update()

    def set_status(self, value):
        self.model.converter = value

    def update(self, *_):
        status = self.model.converter
        running = status.get("phase") in ("preparing", "running", "stopping")
        sources = [identifier for identifier in self.model.selected_ids() if identifier != self.destination.currentData()]
        enabled = self.model.available and bool(sources) and bool(self.destination.currentData()) and not running and status.get("phase") != "blocked"
        self.start.setEnabled(enabled)
        self.transfer.setEnabled(enabled)
        self.stop.setEnabled(running)
        self.status.setText(status.get("phase", "idle") + " · " + t("Tokens enviados") + ": " + number(status.get("sentTokens", 0)))
        self.table.set_records(status.get("rows", []))

    def run(self, action):
        sources = [identifier for identifier in self.model.selected_ids() if identifier != self.destination.currentData()]
        review = ReviewDialog("Rever conversão", [("Contas de origem", len(sources)), ("Conta de destino", self.destination.currentText())],
                              ["Vender caixas e converter" if action == "full" else "Enviar os tokens existentes", "Os pedidos são confirmados antes de continuar."], self)
        if review.exec() == QDialog.Accepted:
            self.model.call("converter:start", [{"action": action, "accountIds": sources, "destinationAccountId": self.destination.currentData()}], self.set_status)

    def recover(self, channel):
        record = self.table.current_record()
        if record:
            self.model.call(channel, [record["operationId"]], self.set_status)


class ActivityPage(Page):
    def __init__(self, model):
        super().__init__(model, "Atividade", "Pedidos, resultados e confirmações desta sessão.")
        self.search = QLineEdit()
        self.search.setPlaceholderText(t("Pesquisar…"))
        self.search.textChanged.connect(self.update)
        self.body.addWidget(row(self.search, button("Exportar histórico", lambda: model.call("history:export")), button("Exportar execução", lambda: model.call("run:export")), button("Atualizar", self.load)))
        self.table = DataTable([("Data", "at"), ("Operação", "type"), ("Conta", "accountId"), ("Estado", "state"), ("Resultado", "message")])
        self.body.addWidget(self.table)
        self.persistent = HistoryPanel(model)
        self.secondary("Histórico guardado", self.persistent)
        self.body.addStretch()
        model.changed.connect(self.update)

    def load(self):
        self.persistent.load()

    def on_show(self):
        if not self.persistent.loaded:
            self.load()

    def update(self):
        needle = self.search.text().casefold()
        records = self.model.events
        self.table.set_records([item for item in records if needle in json.dumps(item, ensure_ascii=False).casefold()][:500])
