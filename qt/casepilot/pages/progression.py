"""Native reward, mission, skill, opening preference and diagnostic workflows."""
from __future__ import annotations
import json
import math
import re
from datetime import datetime, timezone
from PySide6.QtCore import Qt, QSettings, Signal
from PySide6.QtGui import QColor, QPen, QBrush
from PySide6.QtWidgets import (QLabel, QComboBox, QCheckBox, QDoubleSpinBox, QLineEdit,
    QPlainTextEdit, QFormLayout, QDialog, QTabWidget, QWidget, QVBoxLayout,
    QGraphicsScene, QGraphicsView, QGraphicsRectItem, QGraphicsSimpleTextItem)
from ..widgets import Page, Card, AccountPicker, AccountSelection, DataTable, ReviewDialog, button, row, number, t
from ..theme import appearance, colors
from ..reward_claims import ClaimAllRunner

MAP_NAMES = ["Dust II", "Mirage", "Inferno", "Ancient", "Anubis", "Cobblestone"]


def display(value):
    if value is None:
        return "—"
    if isinstance(value, bool):
        return t("Sim" if value else "Não")
    if isinstance(value, (int, float)):
        return number(value, 4).rstrip("0").rstrip(",.") if value else "0"
    if isinstance(value, list):
        return " · ".join(display(item) for item in value)
    if isinstance(value, dict):
        return " · ".join(f"{t(str(key))}: {display(item)}" for key, item in value.items())
    return str(value)


def step_label(step):
    if isinstance(step, str):
        return step
    labels = {"skill-buy": "Comprar habilidade", "skill-sell": "Vender habilidade", "reward": "Recolher recompensa", "mission": "Recolher missão", "pass": "Recolher recompensa do passe", "autoopen": "Guardar preferências de abertura"}
    result = t(labels.get(step.get("kind"), "Alteração revista"))
    for key in ("name", "mapName"):
        if step.get(key):
            result += " · " + str(step[key])
    for key, label in (("cost", "Custo"), ("refund", "Reembolso")):
        if step.get(key) is not None:
            result += " · " + t(label) + ": " + display(step[key])
    return result


class ProgressionPage(Page):
    def __init__(self, model, title, description):
        super().__init__(model, title, description)
        self.account = AccountPicker(model)
        self.account.changed.connect(self.scope_changed)
        self.body.addWidget(row(self.account, button("Atualizar", self.load)))
        self.state = QLabel(t("Seleciona uma conta"))
        self.state.setWordWrap(True)
        self.body.addWidget(self.state)
        self.data = None
        self.scope_revision = 0
        self.operation = None
        self.operation_card = Card("Estado da operação")
        self.operation_message = QLabel()
        self.operation_message.setWordWrap(True)
        self.operation_card.body.addWidget(self.operation_message)
        self.verify = button("Verificar estado", self.verify_operation)
        self.stop = button("Parar operação", self.stop_operation)
        self.operation_card.body.addWidget(row(self.verify, self.stop))
        self.operation_card.hide()
        self.body.addWidget(self.operation_card)
        model.bridge.event.connect(self.receive_event)

    def scope_changed(self, *_):
        self.scope_revision += 1
        self.data = None
        self.operation = None
        self.operation_card.hide()
        self.clear_data()
        if self.account.currentData():
            self.load()
            self.scoped_call("progression:status", [self.account.currentData()], self.set_operation)
        else:
            self.state.setText(t("Seleciona uma conta"))

    def scoped_call(self, channel, args, done):
        identifier, revision = self.account.currentData(), self.scope_revision
        self.state.setText(t("A carregar…"))
        def result(value):
            if identifier != self.account.currentData() or revision != self.scope_revision:
                return
            self.state.setText(t("Último estado observado"))
            done(value)
        def error(message):
            if identifier == self.account.currentData() and revision == self.scope_revision:
                self.state.setText(str(message))
        self.model.call(channel, args, result, busy_key=channel + ":" + str(identifier) + ":" + str(revision), error=error)

    def prepare(self, kind, payload):
        if self.model.claim_busy:
            self.state.setText(t("Aguarda o fim da recolha em curso."))
            return
        identifier = self.account.currentData()
        if not identifier:
            return
        def review(preview):
            fields = [("Conta", self.account.currentText()), ("Custo", display(preview.get("cost"))),
                      ("Reembolso", display(preview.get("refund"))), ("Pontos", display(preview.get("pointCost"))),
                      ("Perda virtual", display(preview.get("loss")))]
            dialog = ReviewDialog(preview.get("title", "Rever alteração"), fields, [step_label(step) for step in preview.get("steps", [])], self)
            if dialog.exec() == QDialog.Accepted:
                self.scoped_call("progression:confirm", [preview["previewId"]], self.after_operation)
        self.scoped_call("progression:prepare", [identifier, kind, payload], review)

    def set_operation(self, value):
        self.operation = value
        if not isinstance(value, dict) or value.get("state") in (None, "idle"):
            self.operation_card.hide()
            return
        self.operation_card.show()
        self.operation_message.setText(t(value.get("message", value.get("state", ""))) + "\n" +
                                       t("Passos") + ": " + str(value.get("completed", 0)) + " / " + str(value.get("total", 0)))
        self.verify.setEnabled(value.get("state") == "unconfirmed")
        self.stop.setEnabled(value.get("state") in ("running", "stopping"))

    def after_operation(self, value):
        self.set_operation(value)
        if value.get("state") not in ("running", "stopping", "unconfirmed"):
            self.load()
            self.model.refresh_accounts([self.account.currentData()])

    def verify_operation(self):
        if self.operation and self.operation.get("operationId"):
            self.scoped_call("progression:verify", [self.operation["operationId"]], self.after_operation)

    def stop_operation(self):
        self.scoped_call("progression:stop", [self.account.currentData()], self.set_operation)

    def receive_event(self, event):
        if event.get("type") == "progression" and event.get("accountId") == self.account.currentData():
            self.set_operation(event)

    def clear_data(self):
        pass

    def load(self):
        pass


class ProgressionBatchPanel(Card):
    completed = Signal()
    def __init__(self, model, account_picker, parent=None, *, skills=False):
        super().__init__("Lotes de contas", parent)
        self.model = model
        self.account_picker = account_picker
        self.skills = skills
        self.batch = None
        self.rows = []
        self.runner = None
        self.busy = False
        self.scope = QComboBox()
        self.scope.addItem(t("Conta atual"), "one")
        self.scope.addItem(t("Contas selecionadas"), "selected")
        self.scope.setCurrentIndex(1 if model.selected else 0)
        self.body.addWidget(self.scope)
        self.body.addWidget(AccountSelection(model))
        self.table = DataTable([("Conta", lambda item: item.get("label", item.get("accountLabel"))), ("Ação", lambda item: item.get("title", item.get("kind"))), ("Estado", "state"), ("Resultado", "message")])
        self.body.addWidget(self.table)
        self.status = QLabel()
        self.status.setWordWrap(True)
        self.body.addWidget(self.status)
        self.preset = QComboBox()
        self.reset = QCheckBox(t("Incluir venda das habilidades atuais antes de aplicar o preset"))
        if skills:
            self.body.addWidget(row(self.preset, self.reset))
        self.scan = button("Consultar recompensas disponíveis", self.discover)
        self.claim_all = button("Resgatar todas", self.claim_all_rewards, primary=True)
        self.review = button("Rever lote", self.prepare)
        self.confirm = button("Confirmar lote", self.confirm_batch, primary=True)
        self.stop = button("Parar lote", self.stop_batch)
        self.verify = button("Verificar lote", lambda: self.action("verify"))
        if not skills:
            self.body.addWidget(self.claim_all)
        self.body.addWidget(row(*([self.scan] if not skills else []), self.review, self.confirm, self.stop, self.verify))
        model.bridge.event.connect(self.receive_event)
        model.bridge.ready.connect(lambda _: model.call("progression-batch:status", done=self.show_batch))
        self.preset.currentIndexChanged.connect(self.update_buttons)
        self.scope.currentIndexChanged.connect(self.scope_changed)
        self.account_picker.changed.connect(self.scope_changed)
        self.scope_ids = self.identifiers()
        self.table.itemChanged.connect(self.update_buttons)
        model.changed.connect(self.scope_changed)
        self.update_buttons()

    def identifiers(self):
        return self.model.selected_ids() if self.scope.currentData() == "selected" else [self.account_picker.currentData()] if self.account_picker.currentData() else []

    def scope_changed(self, *_):
        identifiers = self.identifiers()
        if identifiers != self.scope_ids:
            self.scope_ids = identifiers
            self.rows = []
            if self.runner and not self.runner.terminal:
                self.runner.stop()
            elif not self.batch or self.batch.get("phase") not in ("review", "running", "stopping", "blocked"):
                self.table.set_records([])
        self.update_buttons()

    def set_presets(self, presets):
        current = self.preset.currentData()
        self.preset.clear()
        self.preset.addItem(t("Escolher preset…"), "")
        for preset in presets:
            self.preset.addItem(t(preset["name"]), preset["id"])
        self.preset.setCurrentIndex(max(0, self.preset.findData(current)))

    def discover(self):
        if not self.scan.isEnabled():
            return
        def done(rows):
            self.rows = rows
            self.batch = None
            self.table.set_records(rows)
            self.table.blockSignals(True)
            for index, value in enumerate(rows):
                if value.get("eligible") is True:
                    item = self.table.item(index, 0)
                    item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
                    item.setCheckState(Qt.Checked)
            self.table.blockSignals(False)
            self.status.setText(str(sum(row.get("eligible") is True for row in rows)) + " " + t("Disponíveis"))
            self.update_buttons()
        self.busy = True
        self.update_buttons()
        identifiers = self.identifiers()
        def result(rows):
            self.busy = False
            if identifiers == self.identifiers():
                done(rows)
            self.update_buttons()
        self.model.call("progression-batch:discover", [{"accountIds": identifiers, "kinds": ["reward", "mission", "pass"]}], result, error=self.batch_error)

    def prepare(self):
        if not self.review.isEnabled():
            return
        if self.skills:
            actions = [{"accountId": identifier, "kind": "skill-preset", "payload": {"presetId": self.preset.currentData(), "reset": self.reset.isChecked()}} for identifier in self.identifiers()]
        else:
            actions = [{"accountId": item["accountId"], "kind": item["kind"], "payload": item["payload"]} for index, item in enumerate(self.rows) if item.get("eligible") is True and self.table.item(index, 0).checkState() == Qt.Checked]
        if not actions:
            self.status.setText(t("Sem ações disponíveis"))
            return
        self.busy = True
        self.update_buttons()
        self.model.call("progression-batch:prepare", [{"actions": actions}], lambda value: (setattr(self, "busy", False), self.show_batch(value)), error=self.batch_error)

    def show_batch(self, value):
        self.batch = value
        self.table.set_records(value.get("rows", []))
        self.status.setText(t(value.get("phase", "idle")))
        self.update_buttons()

    def update_buttons(self, *_):
        phase = (self.batch or {}).get("phase", "idle")
        own_claim = self.runner is not None and not self.runner.terminal
        ready = self.model.available and not self.busy and not self.model.claim_busy
        free = phase not in ("review", "running", "stopping", "blocked")
        self.confirm.setEnabled(ready and phase == "review")
        self.stop.setEnabled(own_claim or self.model.available and phase in ("review", "running", "stopping"))
        self.verify.setEnabled(ready and phase == "blocked")
        selected = any(value.get("eligible") and self.table.item(index, 0) is not None and self.table.item(index, 0).checkState() == Qt.Checked for index, value in enumerate(self.rows)) if not self.batch else False
        self.review.setEnabled(ready and free and bool(self.identifiers()) and (bool(self.preset.currentData()) if self.skills else selected))
        self.scan.setEnabled(ready and free and bool(self.identifiers()))
        self.claim_all.setEnabled(ready and free and bool(self.identifiers()) and not self.skills)
        self.scope.setEnabled(not self.busy and not own_claim)

    def confirm_batch(self):
        if not self.batch:
            return
        fields = [("Contas", len({item["accountId"] for item in self.batch["rows"]})),
                  ("Ações", sum(item.get("state") == "ready" for item in self.batch["rows"])),
                  ("Custo", display(sum(item.get("cost", 0) or 0 for item in self.batch["rows"])))]
        dialog = ReviewDialog("Rever lote", fields, ["Cada ação volta a ser validada antes de enviar.", "O lote para se um resultado ficar por confirmar."], self)
        if dialog.exec() == QDialog.Accepted:
            self.action("confirm")

    def action(self, action):
        if self.batch and self.batch.get("batchId"):
            self.busy = action != "stop"
            self.update_buttons()
            self.model.call("progression-batch:" + action, [self.batch["batchId"]], lambda value: (setattr(self, "busy", False), self.show_batch(value)), error=self.batch_error)

    def stop_batch(self):
        if self.runner and not self.runner.terminal:
            self.runner.stop()
        else:
            self.action("stop")

    def batch_error(self, message):
        self.busy = False
        self.status.setText(str(message))
        self.update_buttons()

    def claim_all_rewards(self):
        if not self.claim_all.isEnabled():
            return
        self.rows = []
        self.runner = ClaimAllRunner(self.model, self.identifiers())
        self.runner.batch_changed.connect(self.show_batch)
        self.runner.failed.connect(self.batch_error)
        self.runner.finished.connect(self.claim_finished)
        self.destroyed.connect(self.runner.stop)
        self.status.setText(t("A consultar todas as recompensas…"))
        self.runner.start()
        self.update_buttons()

    def claim_finished(self, value):
        self.status.setText(t("Confirmadas") + ": " + str(value["confirmed"]) + (" · " + t("Parado") if value["stopped"] else ""))
        self.update_buttons()
        if value["confirmed"]:
            self.model.refresh_accounts(self.runner.identifiers)
        self.completed.emit()

    def receive_event(self, event):
        if event.get("type") == "progression-batch":
            self.show_batch(event["batch"])


class RewardsPage(ProgressionPage):
    def __init__(self, model):
        super().__init__(model, "Recompensas", "Recompensas, missões e passe mensal das tuas contas.")
        self.tabs = QTabWidget()
        self.rewards = DataTable([("Recompensa", "title"), ("Efeito", "description"), ("Progresso", lambda item: display(item.get("current")) + " / " + display(item.get("target"))), ("Estado", lambda item: t("Concluída" if item.get("complete") else "Disponível" if item.get("eligible") else "Em progresso"))])
        self.missions = DataTable([("Missão", "title"), ("Progresso", lambda item: display(item.get("current")) + " / " + display(item.get("target"))), ("Duração", "duration"), ("Validade", "validTill"), ("Estado", lambda item: t("Recolhida" if item.get("redeemed") else "Disponível" if item.get("eligible") else "Em progresso"))])
        self.passes = DataTable([("Escalão", "tier"), ("Gratuito", "freeReward"), ("Premium", "premiumReward")])
        for title, table, controls in (("Recompensas", self.rewards, [button("Rever recompensa", self.claim_reward)]), ("Missões", self.missions, [button("Rever missão", self.claim_mission)]), ("Passe mensal", self.passes, [button("Rever recompensa gratuita", lambda: self.claim_pass("free")), button("Rever recompensa Premium", lambda: self.claim_pass("premium"))])):
            widget = QWidget()
            layout = QVBoxLayout(widget)
            layout.addWidget(table)
            layout.addWidget(row(*controls))
            self.tabs.addTab(widget, t(title))
        self.body.addWidget(self.tabs)
        self.pass_status = QLabel()
        self.pass_status.setWordWrap(True)
        self.body.addWidget(self.pass_status)
        self.batch = ProgressionBatchPanel(model, self.account, self)
        self.batch.completed.connect(self.load)
        self.body.addWidget(self.batch)
        self.body.addStretch()

    def clear_data(self):
        for table in (self.rewards, self.missions, self.passes):
            table.set_records([])
        self.pass_status.clear()

    def load(self):
        identifier = self.account.currentData()
        if identifier:
            self.scoped_call("progression:rewards", [identifier], lambda value: self.rewards.set_records(value.get("tracks", [])))
            self.scoped_call("progression:missions", [identifier], self.show_missions)

    def show_missions(self, value):
        self.data = value
        self.missions.set_records(value.get("missions", []))
        pass_ = value.get("pass", {})
        self.passes.set_records(pass_.get("track", []))
        self.pass_status.setText(t("Passe mensal") + " · " + t("Pontos") + ": " + display(pass_.get("points", pass_.get("currentPoints"))) + " · " + t("Validade") + ": " + display(pass_.get("endsAt", pass_.get("validTill"))))

    def claim_reward(self):
        record = self.rewards.current_record()
        if record and record.get("eligible") is True and record.get("id") is not None:
            self.prepare("reward", {"id": record["id"]})

    def claim_mission(self):
        record = self.missions.current_record()
        if record and record.get("eligible") is True and not record.get("redeemed"):
            self.prepare("mission", {"id": record["id"]})

    def claim_pass(self, track):
        record = self.passes.current_record()
        if record:
            self.prepare("pass", {"tier": record["tier"], "track": track})


class SkillNode(QGraphicsRectItem):
    def __init__(self, skill, owned, select):
        super().__init__(0, 0, 156, 66)
        self.skill = skill
        self.select = select
        self.owned = owned
        self.setFlag(QGraphicsRectItem.ItemIsSelectable)
        label = QGraphicsSimpleTextItem(skill.get("name", skill["id"])[:22], self)
        label.setPos(10, 10)
        cost = QGraphicsSimpleTextItem(t("Adquirida") if owned else display(skill.get("cost")), self)
        cost.setPos(10, 36)
        self.update_colors(QSettings().value("appearance/theme", "dark"))
        self.setToolTip(skill.get("name", "") + "\n" + "\n".join(display(effect) for effect in skill.get("effects", [])))

    def mousePressEvent(self, event):
        self.select(self.skill["id"])
        super().mousePressEvent(event)

    def update_colors(self, mode):
        c = colors(mode)
        self.setBrush(QBrush(QColor(c["primary"] if self.owned else c["card"] if self.skill.get("available") else c["muted"])))
        self.setPen(QPen(QColor(c["primary"] if self.skill.get("available") else c["border"])))
        for child in self.childItems():
            child.setBrush(QBrush(QColor(c["primary-foreground"] if self.owned else c["foreground"])))


class SkillsPage(ProgressionPage):
    def __init__(self, model):
        super().__init__(model, "Mapas de skills", "Planeia as skills, revê os custos e acompanha cada alteração.")
        self.maps = QComboBox()
        self.maps.addItems(MAP_NAMES)
        self.maps.currentTextChanged.connect(lambda _: self.scope_changed())
        self.body.addWidget(self.maps)
        self.balances = QLabel()
        self.body.addWidget(self.balances)
        self.scene = QGraphicsScene(self)
        self.map = QGraphicsView(self.scene)
        self.map.setMinimumHeight(320)
        self.map.setDragMode(QGraphicsView.ScrollHandDrag)
        self.body.addWidget(self.map)
        self.table = DataTable([("Habilidade", "name"), ("Custo", "cost"), ("Efeito", lambda item: " · ".join(effect.get("description", "") + " +" + display(effect.get("amount")) for effect in item.get("effects", []))), ("Requer", "requiredPrevSkillId"), ("Estado", lambda item: t("Adquirida" if item.get("owned") else "Disponível" if item.get("available") else "Bloqueada"))])
        self.body.addWidget(self.table)
        self.body.addWidget(row(button("Rever compra", lambda: self.skill_action("skill-buy")), button("Rever venda", lambda: self.skill_action("skill-sell"))))
        card = Card("Presets por objetivo")
        self.preset = QComboBox()
        self.reset = QCheckBox(t("Incluir venda das habilidades atuais antes de aplicar o preset"))
        card.body.addWidget(row(self.preset, button("Atualizar comparação", self.load_presets)))
        self.preset_description = QLabel()
        self.preset_description.setWordWrap(True)
        card.body.addWidget(self.preset_description)
        card.body.addWidget(self.reset)
        card.body.addWidget(button("Rever preset", self.apply_preset, primary=True))
        self.body.addWidget(card)
        self.batch = ProgressionBatchPanel(model, self.account, self, skills=True)
        self.body.addWidget(self.batch)
        self.body.addStretch()
        self.presets = []
        self.preset.currentIndexChanged.connect(self.show_preset)
        appearance().changed.connect(self.update_map_colors)

    def clear_data(self):
        self.scene.clear()
        self.table.set_records([])
        self.balances.clear()
        self.presets = []
        self.preset.clear()
        self.preset_description.clear()

    def load(self):
        if self.account.currentData():
            self.scoped_call("progression:skills", [self.account.currentData(), self.maps.currentText()], self.show_map)
            self.load_presets()

    def show_map(self, value):
        self.data = value
        self.balances.setText(t("Dinheiro virtual") + ": " + display(value.get("money")) + " · " + t("Pontos disponíveis") + ": " + display(value.get("skillPoints")) + " · " + t("Rank") + ": " + display(value.get("rank")))
        skills = value.get("map", {}).get("skills", [])
        self.table.set_records(skills)
        self.scene.clear()
        nodes = {}
        for index, skill in enumerate(skills):
            node = SkillNode(skill, skill.get("owned"), self.select_skill)
            x, y = skill.get("waypointX"), skill.get("waypointY")
            node.setPos(float(x) * 9 if isinstance(x, (int, float)) else (index % 5) * 185,
                        float(y) * 6 if isinstance(y, (int, float)) else (index // 5) * 100)
            self.scene.addItem(node)
            nodes[skill["id"]] = node
        for skill in skills:
            parent = nodes.get(skill.get("requiredPrevSkillId"))
            child = nodes[skill["id"]]
            if parent:
                line = self.scene.addLine(parent.x() + 78, parent.y() + 66, child.x() + 78, child.y(), QPen(QColor(colors(QSettings().value("appearance/theme", "dark"))["ring"]), 2))
                line.setZValue(-1)
        self.scene.setSceneRect(self.scene.itemsBoundingRect().adjusted(-30, -30, 30, 30))

    def update_map_colors(self, mode):
        for item in self.scene.items():
            if isinstance(item, SkillNode):
                item.update_colors(mode)
            elif hasattr(item, "line"):
                item.setPen(QPen(QColor(colors(mode)["ring"]), 2))

    def select_skill(self, identifier):
        for index, skill in enumerate(self.table.records):
            if skill["id"] == identifier:
                self.table.selectRow(index)
                self.table.scrollToItem(self.table.item(index, 0))

    def skill_action(self, kind):
        record = self.table.current_record()
        if record:
            self.prepare(kind, {"mapName": self.maps.currentText(), "skillId": record["id"]})

    def load_presets(self):
        if self.account.currentData():
            self.scoped_call("progression:presets", [self.account.currentData()], self.show_presets)

    def show_presets(self, value):
        self.presets = value if isinstance(value, list) else value.get("presets", [])
        self.preset.clear()
        self.preset.addItem(t("Escolher preset…"), "")
        for preset in self.presets:
            self.preset.addItem(t(preset["name"]), preset["id"])
        self.batch.set_presets(self.presets)

    def show_preset(self, *_):
        preset = next((preset for preset in self.presets if preset["id"] == self.preset.currentData()), None)
        if not preset:
            self.preset_description.clear()
            return
        summary = preset.get("summary", {})
        self.preset_description.setText(t(preset.get("goal", "")) + "\n" + t(preset.get("description", "")) + "\n" +
                                        t("Custo completo") + ": " + display(summary.get("totalCost")) + " · " + t("Pontos") + ": " + display(summary.get("totalPoints")) + "\n" +
                                        t("Em falta nesta conta") + ": " + display(summary.get("missingPoints")) + " · " + display(summary.get("missingCost")) + "\n" +
                                        " · ".join(t(warning) for warning in summary.get("warnings", [])))

    def apply_preset(self):
        if self.preset.currentData():
            self.prepare("skill-preset", {"presetId": self.preset.currentData(), "reset": self.reset.isChecked()})


class AutoOpenPage(ProgressionPage):
    def __init__(self, model):
        super().__init__(model, "Preferências de abertura", "Escolhe os favoritos e a venda automática nas aberturas do jogo.")
        self.form_card = Card("Preferências do site")
        self.form = QFormLayout()
        self.fields = {}
        for key, label in (("favoriteLowFloats", "Marcar floats baixos como favoritos"), ("favoriteHighFloats", "Marcar floats altos como favoritos"), ("favoriteCustomFloats", "Marcar floats personalizados como favoritos"), ("favoritePatterns", "Marcar padrões como favoritos"), ("autosellActivated", "Ativar venda automática no site")):
            check = QCheckBox()
            self.fields[key] = check
            self.form.addRow(t(label), check)
        for key, label, maximum in (("autosellAmount", "Vender itens abaixo de", 10000000), ("customLowFloat", "Float personalizado mínimo", 1), ("customHighFloat", "Float personalizado máximo", 1)):
            spin = QDoubleSpinBox()
            spin.setDecimals(8 if maximum == 1 else 2)
            spin.setRange(0, maximum)
            self.fields[key] = spin
            self.form.addRow(t(label), spin)
        self.currency = QComboBox()
        self.currency.addItem(t("Dinheiro virtual"), "money")
        self.currency.addItem(t("Tokens"), "tokens")
        self.form.addRow(t("Receber venda em"), self.currency)
        self.floats = QLineEdit()
        self.patterns = QPlainTextEdit()
        self.patterns.setMaximumHeight(120)
        self.form.addRow(t("Floats personalizados"), self.floats)
        self.form.addRow(t("Padrões excluídos"), self.patterns)
        self.presets = QComboBox()
        self.presets.currentIndexChanged.connect(self.select_preset)
        self.form.addRow(t("Preset guardado"), self.presets)
        self.form_card.body.addLayout(self.form)
        self.save = button("Rever preferências", self.save_config, primary=True)
        self.form_card.body.addWidget(self.save)
        self.form_card.setEnabled(False)
        self.body.addWidget(self.form_card)
        self.body.addStretch()

    def clear_data(self):
        self.form_card.setEnabled(False)

    def load(self):
        if self.account.currentData():
            if not self.model.preferences.get("enableSiteOpening"):
                self.state.setText(t("Ativa esta funcionalidade nas Definições."))
                return
            self.scoped_call("progression:autoopen", [self.account.currentData()], self.show_config)

    def show_config(self, value):
        self.data = value
        self.presets.blockSignals(True)
        self.presets.clear()
        self.presets.addItem(t("Personalizado"), "")
        for preset in value.get("presets", []):
            self.presets.addItem(preset["name"], preset["id"])
        self.presets.setCurrentIndex(max(0, self.presets.findData(value.get("activePresetId") or "")))
        self.presets.blockSignals(False)
        self.fill(value["config"])
        self.form_card.setEnabled(True)

    def fill(self, config):
        for key, field in self.fields.items():
            if isinstance(field, QCheckBox):
                field.setChecked(config.get(key) is True)
            else:
                field.setValue(config.get(key, 0))
        self.currency.setCurrentIndex(max(0, self.currency.findData(config.get("autosellVariant"))))
        self.floats.setText(", ".join(str(value) for value in config.get("customSelectedFloats", [])))
        self.patterns.setPlainText("\n".join(config.get("patternBlacklist", [])))

    def select_preset(self, *_):
        if self.data:
            preset = next((value for value in self.data.get("presets", []) if value["id"] == self.presets.currentData()), None)
            if preset:
                self.fill(preset["config"])

    def save_config(self):
        try:
            floats = [float(value) for value in re.split(r"[\s,;]+", self.floats.text()) if value]
            patterns = [value.strip() for value in re.split(r"[\n,;]+", self.patterns.toPlainText()) if value.strip()]
            if len(floats) > 500 or len(patterns) > 500 or any(not math.isfinite(value) or not 0 <= value <= 1 for value in floats):
                raise ValueError(t("Floats inválidos"))
            config = {key: field.isChecked() if isinstance(field, QCheckBox) else field.value() for key, field in self.fields.items()}
            config.update(autosellVariant=self.currency.currentData(), customSelectedFloats=floats, patternBlacklist=patterns)
            if config["customLowFloat"] > config["customHighFloat"]:
                raise ValueError(t("Intervalo de floats inválido"))
            self.prepare("autoopen", {"config": config, "activePresetId": self.presets.currentData() or None})
        except ValueError as error:
            self.state.setText(str(error))


DIAGNOSTIC_FIELDS = {"money": "Dinheiro virtual", "tokens": "Tokens", "skillPoints": "Pontos de habilidade", "inventoryCount": "Itens no inventário", "rank": "Rank", "casesTotal": "Caixas em stock", "caseKinds": "Tipos de caixa", "casesWithStock": "Tipos com stock", "moneyPerClick": "Dinheiro por clique", "casesPerClick": "Caixas por clique", "caseOpenCount": "Caixas abertas", "maxCaseOpenMultiplier": "Multiplicador máximo de abertura", "vaultCapacity": "Capacidade do cofre", "vaultMoneyPerMinute": "Geração do cofre por minuto", "eventTickets": "Bilhetes de evento", "dailyTradesLeft": "Trocas restantes hoje"}


class DiagnosticsPage(ProgressionPage):
    def __init__(self, model):
        super().__init__(model, "Diagnóstico", "Compara os valores observados em duas leituras da conta.")
        self.changes = DataTable([("Valor", "label"), ("Antes", lambda item: display(item.get("before"))), ("Depois", lambda item: display(item.get("after")))])
        self.body.addWidget(self.changes)
        self.times = QLabel()
        self.times.setWordWrap(True)
        self.body.addWidget(self.times)
        self.empty("Uma diferença observada não atribui a alteração a uma ação específica. Os resultados de operações só ficam confirmados após reconciliação.")
        self.metrics = DataTable([("Pedido", "name"), ("Valor", "value")])
        self.body.addWidget(row(button("Atualizar métricas", self.load_metrics)))
        self.body.addWidget(self.metrics)
        self.body.addStretch()

    def clear_data(self):
        self.changes.set_records([])
        self.times.clear()

    def load(self):
        if self.account.currentData():
            self.scoped_call("progression:diagnostics", [self.account.currentData()], self.show_data)
        self.load_metrics()

    def show_data(self, value):
        self.data = value
        before, after = value.get("before") or {}, value.get("after") or {}
        self.changes.set_records([{"label": t(label), "before": before.get(key), "after": after.get(key)} for key, label in DIAGNOSTIC_FIELDS.items() if before.get(key) is not None or after.get(key) is not None])
        self.times.setText(t("Antes") + ": " + str(before.get("observedAt", "—")) + "\n" + t("Depois") + ": " + str(after.get("observedAt", "—")))

    def load_metrics(self):
        def done(value):
            self.metrics.set_records([{"name": t(key), "value": display(item)} for key, item in value.items()])
        self.model.call("requests:metrics", done=done)
