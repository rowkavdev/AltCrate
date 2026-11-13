from __future__ import annotations
import json
import uuid
from PySide6.QtCore import QSettings, Signal
from PySide6.QtWidgets import QComboBox, QCheckBox, QDoubleSpinBox, QSpinBox, QLineEdit, QDialog, QVBoxLayout, QFormLayout, QDialogButtonBox, QLabel
from ..widgets import Card, DataTable, button, row, t
from .inventory import DestinationDialog
from .progression import display

LABELS = {"keep": "Inventário", "sell": "Vender", "storage": "Storage"}


class RuleDialog(QDialog):
    def __init__(self, model, skins, rule=None, parent=None):
        super().__init__(parent)
        self.model = model
        self.original = rule or {}
        self.destination = {key: self.original[key] for key in ("destinationAccountId", "storageUnitId") if key in self.original}
        self.setWindowTitle(t("Rever regra"))
        self.resize(590, 590)
        layout = QVBoxLayout(self)
        form = QFormLayout()
        self.skin = QComboBox()
        names = sorted({item["name"] for item in skins if item.get("name")})
        if self.original.get("name") and self.original["name"] not in names:
            names.insert(0, self.original["name"])
        self.skin.addItems(names)
        self.skin.setCurrentIndex(max(0, self.skin.findText(self.original.get("name", ""))))
        form.addRow(t("Skin"), self.skin)
        self.action = QComboBox()
        for key, label in LABELS.items():
            self.action.addItem(t(label), key)
        self.action.setCurrentIndex(max(0, self.action.findData(self.original.get("action", "keep"))))
        form.addRow(t("Destino"), self.action)
        conditions = self.original.get("conditions") or {}
        self.numeric = {}
        for key, label, minimum, maximum in (("floatMin", "Float mínimo", 0, 1), ("floatMax", "Float máximo", 0, 1), ("topN", "Top N · Overall menor float", 1, 10000000)):
            enabled = QCheckBox(t("Aplicar"))
            value = QSpinBox() if key == "topN" else QDoubleSpinBox()
            value.setRange(minimum, maximum)
            if isinstance(value, QDoubleSpinBox):
                value.setDecimals(8)
            value.setValue(conditions.get(key, maximum if key == "floatMax" else minimum))
            enabled.setChecked(key in conditions)
            value.setEnabled(enabled.isChecked())
            enabled.toggled.connect(value.setEnabled)
            self.numeric[key] = (enabled, value)
            form.addRow(t(label), row(enabled, value))
        self.patterns = QLineEdit(", ".join(conditions.get("patterns", [])))
        form.addRow(t("Padrões"), self.patterns)
        self.variants = {}
        for key, label in (("statTrak", "StatTrak"), ("souvenir", "Souvenir")):
            combo = QComboBox()
            for title, value in (("Qualquer", None), ("Sim", True), ("Não", False)):
                combo.addItem(t(title), value)
            combo.setCurrentIndex(max(0, combo.findData(conditions.get(key))))
            self.variants[key] = combo
            form.addRow(label, combo)
        self.event_name = QLineEdit(conditions.get("eventName", ""))
        form.addRow(t("Evento"), self.event_name)
        form.addRow(button("Escolher storage de destino", self.choose_storage))
        self.destination_label = QLabel(display(self.destination))
        self.destination_label.setWordWrap(True)
        form.addRow(self.destination_label)
        layout.addLayout(form)
        self.error = QLabel()
        self.error.setWordWrap(True)
        layout.addWidget(self.error)
        controls = QDialogButtonBox(QDialogButtonBox.Cancel | QDialogButtonBox.Save)
        controls.accepted.connect(self.validate_and_accept)
        controls.rejected.connect(self.reject)
        layout.addWidget(controls)

    def choose_storage(self):
        source = next(iter(self.model.selected), "")
        dialog = DestinationDialog(self.model, "move-to-storage", source, self)
        if dialog.exec() == QDialog.Accepted:
            result = dialog.destination()
            self.destination = {"destinationAccountId": result["destinationAccountId"], "storageUnitId": result["destinationStorageUnitId"]}
            self.destination_label.setText(dialog.account.currentText() + " · " + dialog.storage.currentText())

    def value(self):
        rule = {"id": self.original.get("id") or "rule-" + str(uuid.uuid4()), "name": self.skin.currentText(), "action": self.action.currentData()}
        conditions = {key: field.value() for key, (enabled, field) in self.numeric.items() if enabled.isChecked()}
        patterns = [value.strip() for value in self.patterns.text().split(",") if value.strip()]
        if patterns:
            conditions["patterns"] = patterns
        for key, field in self.variants.items():
            if field.currentData() is not None:
                conditions[key] = field.currentData()
        if self.event_name.text().strip():
            conditions["eventName"] = self.event_name.text().strip()
        if conditions:
            rule["conditions"] = conditions
        if rule["action"] == "storage":
            rule.update(self.destination)
        return rule

    def validate_and_accept(self):
        rule = self.value()
        conditions = rule.get("conditions", {})
        if not rule["name"]:
            self.error.setText(t("Escolhe uma skin"))
        elif conditions.get("floatMin", 0) > conditions.get("floatMax", 1):
            self.error.setText(t("Intervalo de floats inválido"))
        elif len(conditions.get("patterns", [])) > 100:
            self.error.setText(t("Escolhe até 100 padrões"))
        elif rule["action"] == "storage" and not all(rule.get(key) for key in ("destinationAccountId", "storageUnitId")):
            self.error.setText(t("Escolhe o storage de destino"))
        else:
            self.accept()


class OpeningRules(Card):
    changed = Signal()
    def __init__(self, model, cases, parent=None):
        super().__init__("Regras locais ordenadas", parent)
        self.model = model
        self.cases = cases
        self.skins = []
        self.detail_case = None
        try:
            self.rules_by_case = json.loads(QSettings().value("opening-rules", "{}"))
        except (ValueError, TypeError):
            self.rules_by_case = {}
        self.table = DataTable([("Skin", "name"), ("Destino", lambda item: t(LABELS[item["action"]])), ("Condições", lambda item: display(item.get("conditions"))), ("Storage", "storageUnitId")])
        self.body.addWidget(self.table)
        self.add = button("Adicionar regra", self.add_rule)
        self.body.addWidget(row(self.add, button("Editar regra", self.edit_rule), button("Eliminar regra", self.delete_rule), button("Subir regra", lambda: self.move(-1)), button("Descer regra", lambda: self.move(1))))
        self.note = QLabel(t("Aplica-se a primeira regra correspondente, de cima para baixo. Sem os dados necessários, o item fica no inventário. Favoritos ficam sempre protegidos."))
        self.note.setWordWrap(True)
        self.body.addWidget(self.note)
        self.cases.currentIndexChanged.connect(self.case_changed)
        self.case_changed()

    def current_rules(self):
        return self.rules_by_case.get(self.cases.currentData(), [])

    def case_changed(self, *_):
        identifier = self.cases.currentData()
        self.skins = []
        self.detail_case = None
        self.add.setEnabled(False)
        self.table.set_records(self.current_rules())
        if identifier and self.model.available:
            def loaded(value):
                if self.cases.currentData() != identifier:
                    return
                self.skins = value.get("items", [])
                self.detail_case = identifier
                self.add.setEnabled(bool(self.skins) and len(self.current_rules()) < 500)
            self.model.call("cases:details", [identifier], loaded, busy_key="case-details:" + identifier, error=self.note.setText)

    def save(self, rules):
        identifier = self.cases.currentData()
        self.rules_by_case[identifier] = rules
        QSettings().setValue("opening-rules", json.dumps(self.rules_by_case))
        self.table.set_records(rules)
        self.changed.emit()
        self.add.setEnabled(bool(self.skins) and len(rules) < 500)

    def add_rule(self):
        if self.skins:
            dialog = RuleDialog(self.model, self.skins, parent=self)
            if dialog.exec() == QDialog.Accepted:
                self.save(self.current_rules() + [dialog.value()])

    def edit_rule(self):
        record = self.table.current_record()
        if record:
            index = self.table.currentRow()
            dialog = RuleDialog(self.model, self.skins, record, self)
            if dialog.exec() == QDialog.Accepted:
                rules = list(self.current_rules())
                rules[index] = dialog.value()
                self.save(rules)

    def delete_rule(self):
        index = self.table.currentRow()
        if index >= 0:
            self.save([rule for position, rule in enumerate(self.current_rules()) if position != index])

    def move(self, change):
        index = self.table.currentRow()
        rules = list(self.current_rules())
        target = index + change
        if index >= 0 and 0 <= target < len(rules):
            rules[index], rules[target] = rules[target], rules[index]
            self.save(rules)
            self.table.selectRow(target)
