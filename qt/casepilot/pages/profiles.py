"""Local operation profiles; loading drafts never starts an operation."""
from copy import deepcopy
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLabel, QLineEdit, QCheckBox, QComboBox, QDialog
from ..widgets import Card, DataTable, ReviewDialog, button, row, t


class ProfilePanel(Card):
    def __init__(self, model):
        super().__init__("Perfis locais de operação")
        self.model = model
        self.editing = None
        self.original = {}
        self.config_signature = None
        note = QLabel(t("Um perfil guarda modos, caixa, regras e destinos. Carregar configuração não inicia operações."))
        note.setWordWrap(True)
        self.body.addWidget(note)
        self.name = QLineEdit()
        self.name.setMaxLength(60)
        self.name.setPlaceholderText(t("Nome do perfil"))
        self.case = QComboBox()
        self.body.addWidget(row(self.name, self.case))
        self.modes = {}
        for key, label in (("case", "Caixas"), ("money", "Dinheiro virtual"), ("vault", "Cofres")):
            control = QCheckBox(t(label))
            self.modes[key] = control
        self.body.addWidget(row(*self.modes.values()))
        self.summary = QLabel()
        self.summary.setWordWrap(True)
        self.body.addWidget(self.summary)
        self.save_button = button("Guardar perfil", self.save)
        self.cancel_button = button("Cancelar edição", self.cancel)
        self.body.addWidget(row(self.save_button, self.cancel_button))
        self.table = DataTable([("Nome", "name"), ("Caixa alvo", lambda p: p.get("config", {}).get("targetCase")), ("Regras", lambda p: len(p.get("config", {}).get("itemRules", []))), ("Destinos", lambda p: len(p.get("config", {}).get("destinations", [])))])
        self.body.addWidget(self.table)
        self.load_button = button("Carregar configuração", self.load, primary=True)
        self.edit_button = button("Editar nome e modos", self.edit)
        self.delete_button = button("Apagar perfil", self.delete)
        self.body.addWidget(row(self.load_button, self.edit_button, self.delete_button))
        self.name.textChanged.connect(self.buttons)
        self.table.itemSelectionChanged.connect(self.buttons)
        model.changed.connect(self.update)
        model.config_changed.connect(self.update)
        self.update()

    def buttons(self, *_):
        running = self.model.farm.get("phase") in ("running", "stopping") or self.model.opening.get("phase") in ("running", "stopping")
        ready = self.model.available and not running and "workspace:command" not in self.model.pending
        selected = self.table.current_record() is not None
        for control in (self.load_button, self.edit_button, self.delete_button):
            control.setEnabled(ready and selected)
        self.save_button.setEnabled(ready and bool(self.name.text().strip()))
        self.cancel_button.setVisible(self.editing is not None)
        for control in (self.name, self.case, *self.modes.values()):
            control.setEnabled(ready)

    def update(self):
        self.table.set_records(self.model.workspace.get("profiles", []))
        if self.editing and not any(p["id"] == self.editing for p in self.model.workspace.get("profiles", [])):
            self.editing = None
            self.name.clear()
        config = self.original if self.editing else self.model.profile_config()
        target = self.case.currentData() if self.case.count() else config.get("targetCase")
        choices = {item["id"]: item.get("name", item["id"]) for snapshot in self.model.snapshots.values() for item in snapshot.get("cases", [])}
        if target and target not in choices:
            choices[target] = t("Caixa guardada (validar disponibilidade)")
        signature = [(None, t("Sem caixa alvo"))] + list(choices.items())
        if signature != [(self.case.itemData(i), self.case.itemText(i)) for i in range(self.case.count())]:
            self.case.clear()
            for identifier, label in signature:
                self.case.addItem(label, identifier)
            self.case.setCurrentIndex(max(0, self.case.findData(target)))
        signature = (config.get("targetCase"), tuple(sorted(config.get("farm", {}).items())))
        if not self.editing and signature != self.config_signature:
            self.config_signature = signature
            desired = config.get("targetCase")
            if desired and self.case.findData(desired) < 0:
                self.case.addItem(t("Caixa guardada (validar disponibilidade)"), desired)
            self.case.setCurrentIndex(max(0, self.case.findData(desired)))
            for key, control in self.modes.items():
                control.setChecked(config.get("farm", {}).get(key, False))
        self.summary.setText(f"{len(config.get('itemRules', []))} " + t("regras de itens") + f" · {len(config.get('destinations', []))} " + t("destinos"))
        self.buttons()

    def save(self):
        if not self.save_button.isEnabled():
            return
        config = deepcopy(self.original if self.editing else self.model.profile_config())
        config["farm"] = {key: control.isChecked() for key, control in self.modes.items()}
        config["targetCase"] = self.case.currentData()
        payload = {"name": self.name.text().strip(), "config": config}
        if self.editing:
            payload["id"] = self.editing
        self.model.workspace_command("saveProfile", payload, lambda _: self.cancel())

    def load(self):
        record = self.table.current_record()
        if record:
            self.model.workspace_command("loadProfile", {"id": record["id"]}, lambda value: self.model.apply_profile(value["config"]))

    def edit(self):
        record = self.table.current_record()
        if not record:
            return
        self.editing = record["id"]
        self.original = deepcopy(record["config"])
        self.name.setText(record["name"])
        for key, control in self.modes.items():
            control.setChecked(self.original.get("farm", {}).get(key, False))
        target = self.original.get("targetCase")
        if target and self.case.findData(target) < 0:
            self.case.addItem(t("Caixa guardada (validar disponibilidade)"), target)
        self.case.setCurrentIndex(max(0, self.case.findData(target)))
        self.update()

    def cancel(self):
        self.editing = None
        self.original = {}
        self.config_signature = None
        self.name.clear()
        self.update()

    def delete(self):
        record = self.table.current_record()
        if record and ReviewDialog("Apagar perfil", [("Nome", record["name"])], ["Remover apenas esta configuração local."], self).exec() == QDialog.Accepted:
            self.model.workspace_command("deleteProfile", {"id": record["id"]})
