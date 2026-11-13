from __future__ import annotations
import json
from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (QLabel, QComboBox, QLineEdit, QSpinBox, QFormLayout, QGridLayout,
    QDialog, QDialogButtonBox, QVBoxLayout, QMenu, QApplication, QAbstractItemView)
from ..widgets import Page, Card, DataTable, AccountPicker, ReviewDialog, button, row, t, number
from ..images import ImageLoader
from .progression import display

FILTERS = {
    "sort": ("Ordenar", [("Mais recentes", "true"), ("Preço", "price"), ("Float", "float"), ("Ranking", "rank")]),
    "favorites": ("Favoritos", [("Todos", "all"), ("Sem favoritos", "none"), ("Só favoritos", "only")]),
    "rarity": ("Raridade", [("Todas", "")] + [(value, value) for value in ["Consumer Grade", "Industrial Grade", "Mil-Spec Grade", "Restricted", "Classified", "Covert", "Contraband", "Base Grade", "High Grade", "Remarkable", "Exotic", "Extraordinary", "Distinguished", "Exceptional", "Superior", "Master"]]),
    "exterior": ("Exterior", [("Todos", "")] + [(value, value) for value in ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"]]),
    "quality": ("Qualidade", [("Todas", ""), ("0", "0"), ("1", "1"), ("2", "2"), ("3", "3")]),
    "statTrakSouvenir": ("Variante", [("Todas", "None"), ("Sem StatTrak", "Non ST"), ("Sem Souvenir", "Non SV"), ("StatTrak", "Only ST"), ("Souvenir", "Only SV")]),
}
ACTION_LABELS = {"sell": "Vender por dinheiro virtual", "convert": "Converter em tokens", "favorite": "Atualizar favorito", "withdraw": "Retirar para inventário", "transfer": "Enviar para outra conta", "move-to-storage": "Mover para storage"}


class DestinationDialog(QDialog):
    def __init__(self, model, kind, source, parent=None):
        super().__init__(parent)
        self.model = model
        self.kind = kind
        self.setWindowTitle(t(ACTION_LABELS[kind]))
        self.resize(500, 270)
        self.layout = QVBoxLayout(self)
        self.account = AccountPicker(model)
        if kind == "transfer":
            index = self.account.findData(source)
            if index >= 0:
                self.account.removeItem(index)
        self.storage = QComboBox()
        self.status = QLabel(t("Escolhe a conta de destino"))
        self.status.setWordWrap(True)
        form = QFormLayout()
        form.addRow(t("Conta de destino"), self.account)
        if kind == "move-to-storage":
            form.addRow(t("Storage de destino"), self.storage)
        self.layout.addLayout(form)
        self.layout.addWidget(self.status)
        buttons = QDialogButtonBox(QDialogButtonBox.Cancel)
        self.accept_button = buttons.addButton(t("Rever envio"), QDialogButtonBox.AcceptRole)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        self.layout.addWidget(buttons)
        self.account.changed.connect(self.changed)
        self.storage.currentIndexChanged.connect(self.update_enabled)
        self.changed()

    def changed(self, *_):
        self.storage.clear()
        identifier = self.account.currentData()
        if self.kind == "move-to-storage" and identifier:
            self.status.setText(t("A carregar…"))
            def loaded(units):
                if identifier != self.account.currentData():
                    return
                for unit in units:
                    self.storage.addItem(unit["name"] + " · " + str(unit["count"]), unit["id"])
                self.status.setText(t("Esta conta não tem storages.") if not units else "")
                self.update_enabled()
            self.model.call("storage:list", [identifier], loaded, busy_key="destination:" + identifier, error=self.status.setText)
        self.update_enabled()

    def update_enabled(self, *_):
        self.accept_button.setEnabled(bool(self.account.currentData()) and (self.kind != "move-to-storage" or bool(self.storage.currentData())))

    def destination(self):
        result = {"destinationAccountId": self.account.currentData()}
        if self.kind == "move-to-storage":
            result["destinationStorageUnitId"] = self.storage.currentData()
        return result


class InventoryPage(Page):
    def __init__(self, model):
        super().__init__(model, "Inventário", "Os itens das tuas contas, com fotografias e detalhes.")
        self.account = AccountPicker(model)
        self.storage = QComboBox()
        self.storage.addItem(t("Inventário"), "")
        self.body.addWidget(row(self.account, self.storage, button("Atualizar", self.reload)))
        self.search = QLineEdit()
        self.search.setPlaceholderText(t("Pesquisar skin…"))
        self.search.returnPressed.connect(self.filter_changed)
        filters = Card("Filtros")
        self.body.addWidget(row(self.search, button("Pesquisar", self.filter_changed), button("Limpar seleção", self.clear_selection)))
        grid = QGridLayout()
        self.filters = {}
        for index, (key, (label, options)) in enumerate(FILTERS.items()):
            combo = QComboBox()
            for title, value in options:
                combo.addItem(t(title), value)
            combo.currentIndexChanged.connect(self.filter_changed)
            self.filters[key] = combo
            grid.addWidget(QLabel(t(label)), (index // 3) * 2, index % 3)
            grid.addWidget(combo, (index // 3) * 2 + 1, index % 3)
        self.events = QComboBox()
        self.events.addItem(t("Todos os eventos"), "")
        self.events.currentIndexChanged.connect(self.filter_changed)
        grid.addWidget(QLabel(t("Evento")), 4, 0)
        grid.addWidget(self.events, 5, 0, 1, 3)
        filters.body.addLayout(grid)
        self.secondary("Filtros", filters)
        self.summary = QLabel(t("Seleciona uma conta"))
        self.summary.setWordWrap(True)
        self.body.addWidget(self.summary)
        self.items = DataTable([("Item", "name"), ("Preço", "price"), ("Float", "float"), ("Padrão", "patternId"), ("Variante", lambda item: "StatTrak" if item.get("statTrak") else "Souvenir" if item.get("souvenir") else item.get("exterior")), ("Favorito", lambda item: t("Sim" if item.get("isFavorite") else "Não"))])
        self.items.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.items.setIconSize(__import__("PySide6.QtCore", fromlist=["QSize"]).QSize(72, 58))
        self.items.setContextMenuPolicy(Qt.CustomContextMenu)
        self.items.customContextMenuRequested.connect(self.context_menu)
        self.items.itemDoubleClicked.connect(lambda _: self.details())
        self.items.itemSelectionChanged.connect(self.selection_changed)
        self.body.addWidget(self.items)
        self.page = QSpinBox()
        self.page.setRange(1, 1)
        self.page.valueChanged.connect(self.page_changed)
        self.selected_label = QLabel()
        self.body.addWidget(row(button("Página anterior", lambda: self.page.setValue(self.page.value() - 1)), self.page,
                                button("Página seguinte", lambda: self.page.setValue(self.page.value() + 1)), button("Selecionar itens desta página", self.items.selectAll), self.selected_label))
        self.action = QComboBox()
        for key, label in ACTION_LABELS.items():
            self.action.addItem(t(label), key)
        self.body.addWidget(row(self.action, button("Rever ação", self.prepare_action, primary=True), button("Ver detalhes", self.details)))
        self.operations = DataTable([("Item", lambda item: (item.get("item") or {}).get("name")), ("Estado", "state"), ("Localização", "location"), ("Resultado", "message")])
        operations = Card("Operações de inventário")
        operations.body.addWidget(self.operations)
        operations.body.addWidget(row(button("Verificar estado", lambda: self.recover_operation("verify")), button("Continuar armazenamento", lambda: self.recover_operation("resume")), button("Cancelar envio", lambda: self.recover_operation("cancel"))))
        self.operations_section = self.secondary("Operações de inventário", operations)
        self.batch = None
        self.batch_status = QLabel()
        self.batch_items = DataTable([("Item", lambda item: (item.get("preview", {}).get("item") or {}).get("name")), ("Estado", "state"), ("Resultado", "message")])
        batch_controls = Card()
        batch_controls.body.addWidget(self.batch_status)
        batch_controls.body.addWidget(self.batch_items)
        batch_controls.body.addWidget(row(button("Executar lote", lambda: self.batch_action("start")), button("Parar lote", lambda: self.batch_action("stop")), button("Verificar lote", lambda: self.batch_action("verify")), button("Retomar lote", lambda: self.batch_action("resume"))))
        self.batch_section = self.secondary("Ações em lote", batch_controls)
        ranking = Card("Ranking individual")
        self.rankings = DataTable([("Item", "itemId"), ("Posição", "rank"), ("Estado", "state"), ("Observação local", "observedAt"), ("Atualização na origem", "sourceUpdatedAt"), ("Detalhe", "reason")])
        ranking.body.addWidget(self.rankings)
        ranking.body.addWidget(row(button("Consultar selecionados", self.refresh_ranking), button("Parar consulta", lambda: setattr(self, "ranking_stopped", True))))
        self.secondary("Ranking dos itens", ranking)
        management = Card("Gerir cofres")
        self.storage_kind = QComboBox()
        for key, label in (("create", "Criar cofre"), ("rename", "Mudar nome"), ("clear", "Esvaziar cofre"), ("delete", "Apagar cofre")):
            self.storage_kind.addItem(t(label), key)
        self.storage_name = QLineEdit()
        self.storage_name.setMaxLength(20)
        self.storage_name.setPlaceholderText(t("Novo nome"))
        management.body.addWidget(row(self.storage_kind, self.storage_name, button("Rever alteração do cofre", self.manage_storage)))
        self.storage_operations = DataTable([("Ação", "kind"), ("Estado", "state"), ("Resultado", "message")])
        management.body.addWidget(self.storage_operations)
        management.body.addWidget(button("Verificar alteração do cofre", self.verify_storage))
        self.secondary("Gerir cofres", management)
        self.body.addStretch()
        self.chosen = {}
        self.revision = 0
        self.images = ImageLoader(self)
        self.images.loaded.connect(lambda _: self.render_images())
        self.units = []
        self.ranking_stopped = True
        self.account.changed.connect(self.account_changed)
        self.storage.currentIndexChanged.connect(self.scope_changed)
        model.bridge.event.connect(self.receive_event)

    def scoped_call(self, channel, args, done):
        scope = (self.account.currentData(), self.storage.currentData(), self.revision)
        def result(value):
            if scope == (self.account.currentData(), self.storage.currentData(), self.revision):
                done(value)
        def error(message):
            if scope == (self.account.currentData(), self.storage.currentData(), self.revision):
                self.summary.setText(str(message))
        self.model.call(channel, args, result, busy_key=channel + ":" + repr(scope), error=error)

    def account_changed(self, *_):
        self.revision += 1
        self.ranking_stopped = True
        self.chosen.clear()
        self.items.set_records([])
        self.units = []
        self.storage.blockSignals(True)
        self.storage.clear()
        self.storage.addItem(t("Inventário"), "")
        self.storage.blockSignals(False)
        if self.account.currentData():
            self.reload()
        else:
            self.summary.setText(t("Seleciona uma conta"))

    def scope_changed(self, *_):
        self.revision += 1
        self.chosen.clear()
        self.ranking_stopped = True
        self.page.blockSignals(True)
        self.page.setValue(1)
        self.page.blockSignals(False)
        self.load()

    def page_changed(self, *_):
        self.revision += 1
        self.load()

    def filter_changed(self, *_):
        self.revision += 1
        self.page.blockSignals(True)
        self.page.setValue(1)
        self.page.blockSignals(False)
        self.load()

    def reload(self):
        identifier = self.account.currentData()
        if not identifier:
            return
        def units(value):
            self.units = value
            current = self.storage.currentData()
            self.storage.blockSignals(True)
            self.storage.clear()
            self.storage.addItem(t("Inventário"), "")
            for unit in value:
                self.storage.addItem(unit["name"] + " · " + str(unit["count"]), unit["id"])
            self.storage.setCurrentIndex(max(0, self.storage.findData(current)))
            self.storage.blockSignals(False)
        def summary(value):
            self.summary.setText(t("Valor do inventário") + ": " + number(value.get("value")) + " · " + t("Cobertura de float") + ": " + display((value.get("floatCoverage") or {}).get("percent")) + "%" + "\n" + " · ".join(value.get("errors", [])))
            current = self.events.currentData()
            self.events.blockSignals(True)
            self.events.clear()
            self.events.addItem(t("Todos os eventos"), "")
            for event in value.get("events", []):
                self.events.addItem(event["label"], event["value"])
            self.events.setCurrentIndex(max(0, self.events.findData(current)))
            self.events.blockSignals(False)
        self.scoped_call("storage:list", [identifier], units)
        self.scoped_call("inventory:summary", [identifier], summary)
        self.load()
        self.load_operations()
        self.model.call("inventory-batch:list", done=lambda values: self.show_batch(next((value for value in reversed(values) if any(item["ref"]["accountId"] == identifier for item in value["items"])), None)))
        self.model.call("storage-management:list", done=self.show_storage_operations)

    def load(self):
        identifier = self.account.currentData()
        if not identifier:
            return
        filters = {key: combo.currentData() for key, combo in self.filters.items()}
        filters.update(search=self.search.text().strip(), eventName=self.events.currentData() or "")
        args = [identifier, self.page.value(), filters]
        channel = "inventory:read"
        if self.storage.currentData():
            args.insert(1, self.storage.currentData())
            channel = "storage:read"
        self.summary.setText(t("A carregar…"))
        def done(value):
            self.page.blockSignals(True)
            self.page.setMaximum(value["pages"])
            self.page.blockSignals(False)
            self.items.blockSignals(True)
            self.items.clearSelection()
            self.items.set_records(value["skins"])
            for index, item in enumerate(value["skins"]):
                self.items.setRowHeight(index, 70)
                if item["id"] in self.chosen:
                    self.items.selectionModel().select(self.items.model().index(index, 0), self.items.selectionModel().SelectionFlag.Select | self.items.selectionModel().SelectionFlag.Rows)
            self.items.blockSignals(False)
            self.summary.setText(str(value.get("count", 0)) + " " + t("itens") + " · " + t("Página") + " " + str(self.page.value()) + " / " + str(value["pages"]))
            self.render_images()
            self.update_selected()
            if value["skins"]:
                self.scoped_call("ranking:read", [{"accountId": identifier, "itemIds": [item["id"] for item in value["skins"]]}], lambda result: self.rankings.set_records(result.get("items", [])))
        self.scoped_call(channel, args, done)

    def render_images(self):
        if getattr(self.model, "fixture", False):
            return
        for index, item in enumerate(self.items.records):
            image = self.images.get(item.get("image"))
            if image:
                self.items.item(index, 0).setIcon(QIcon(image))

    def ref(self, item):
        return {"accountId": self.account.currentData(), "itemId": item["id"], "storageUnitId": self.storage.currentData() or None, "page": self.page.value(), "name": item["name"]}

    def selection_changed(self):
        selected = {index.row() for index in self.items.selectionModel().selectedRows()}
        for index, item in enumerate(self.items.records):
            if index in selected:
                self.chosen[item["id"]] = self.ref(item)
            else:
                self.chosen.pop(item["id"], None)
        self.update_selected()

    def update_selected(self):
        self.selected_label.setText(str(len(self.chosen)) + " " + t("Selecionados"))

    def clear_selection(self):
        self.chosen.clear()
        self.items.clearSelection()
        self.update_selected()

    def context_menu(self, point):
        item = self.items.itemAt(point)
        if not item:
            return
        self.items.setCurrentItem(item)
        menu = QMenu(self)
        menu.addAction(t("Ver detalhes"), self.details)
        record = self.items.current_record()
        for kind, label in ACTION_LABELS.items():
            action = menu.addAction(t(label), lambda kind=kind: self.prepare_action(kind))
            action.setEnabled(not (kind in ("sell", "convert") and record.get("isFavorite")) and not (kind == "withdraw" and not self.storage.currentData()))
        menu.addAction(t("Copiar nome"), lambda: QApplication.clipboard().setText(record["name"]))
        menu.exec(self.items.viewport().mapToGlobal(point))

    def details(self):
        item = self.items.current_record()
        if not item:
            return
        fields = [(label, display(item.get(key))) for label, key in (("Nome", "name"), ("Preço", "price"), ("Float", "float"), ("Padrão", "patternId"), ("Exterior", "exterior"), ("Raridade", "rarity"), ("StatTrak", "statTrak"), ("Souvenir", "souvenir"), ("Evento", "eventName"), ("Origem", "origin"))]
        accessories = [value.get("name", "") for value in item.get("stickers", [])] + ([(item.get("charm") or {}).get("name", "")] if item.get("charm") else [])
        dialog = ReviewDialog(item["name"], fields, accessories, self, confirm="Fechar")
        image = self.images.get(item.get("image"))
        if image:
            label = QLabel()
            label.setPixmap(image)
            dialog.layout().insertWidget(1, label)
        dialog.exec()

    def prepare_action(self, kind=None):
        kind = kind or self.action.currentData()
        refs = list(self.chosen.values())
        item = self.items.current_record()
        if not refs and item:
            refs = [self.ref(item)]
        if not refs:
            self.summary.setText(t("Seleciona um item"))
            return
        if kind == "favorite" and len(refs) > 1:
            self.summary.setText(t("Escolhe um item para atualizar o favorito."))
            return
        destination = {}
        if kind in ("transfer", "move-to-storage"):
            dialog = DestinationDialog(self.model, kind, self.account.currentData(), self)
            if dialog.exec() != QDialog.Accepted:
                return
            destination = dialog.destination()
        if len(refs) > 1:
            self.scoped_call("inventory-batch:prepare", [{"kind": kind, "refs": refs, **destination}], self.show_batch)
        else:
            favorite = next((item for item in self.items.records if item["id"] == refs[0]["itemId"]), None)
            request = {"kind": kind, "ref": refs[0], **destination}
            if kind == "favorite":
                request["isFavorite"] = not (favorite or {}).get("isFavorite", False)
            self.scoped_call("inventory-action:prepare", [request], self.review_item)

    def review_item(self, preview):
        item = preview["item"]
        review = ReviewDialog(ACTION_LABELS[preview["kind"]], [("Item", item["name"]), ("Conta de origem", preview["sourceLabel"]), ("Conta de destino", preview.get("destinationLabel")), ("Storage de destino", preview.get("destinationStorageName")), ("Valor virtual do item", number(item.get("price")))], preview["steps"], self)
        if review.exec() == QDialog.Accepted:
            self.scoped_call("inventory-action:confirm", [preview["previewId"]], self.confirmed_item)

    def confirmed_item(self, result):
        if result.get("reviewRequired"):
            self.review_item(result["reviewRequired"])
        else:
            self.summary.setText(result.get("operation", {}).get("message", ""))
            self.clear_selection()
            self.load_operations()
            self.load()

    def load_operations(self):
        def loaded(values):
            self.model.inventory_operations = values
            identifier = self.account.currentData()
            self.operations.set_records([item for item in values if identifier in (item.get("accountId"), item.get("destinationAccountId"))])
            if self.operations.records:
                self.operations_section.set_expanded(True)
        self.scoped_call("inventory-action:list", [], loaded)

    def recover_operation(self, action):
        record = self.operations.current_record()
        if record:
            self.scoped_call("inventory-action:" + action, [record["operationId"]], lambda _: (self.load_operations(), self.load()))

    def show_batch(self, value):
        self.batch = value
        if value:
            self.batch_section.set_expanded(True)
        self.batch_status.setText(t("Lote") + ": " + t(value["state"]) + "\n" + t(value.get("limitation", "")) if value else "")
        self.batch_items.set_records(value.get("items", []) if value else [])

    def batch_action(self, action):
        if not self.batch:
            return
        if action in ("start", "resume"):
            review = ReviewDialog("Executar lote", [("Itens", len(self.batch["items"]))], [self.batch.get("limitation", ""), "Cada item volta a ser validado antes de enviar."], self)
            if review.exec() != QDialog.Accepted:
                return
        self.scoped_call("inventory-batch:" + action, [self.batch["batchId"]], self.show_batch)

    def refresh_ranking(self):
        ids = list(self.chosen) or [item["id"] for item in self.items.records]
        if not ids:
            return
        revision = self.revision
        identifier = self.account.currentData()
        self.ranking_stopped = False
        records = {item["itemId"]: item for item in self.rankings.records}
        def next_(index=0):
            if self.ranking_stopped or revision != self.revision or index >= len(ids):
                return
            def done(value):
                for item in value.get("items", []):
                    records[item["itemId"]] = item
                self.rankings.set_records(list(records.values()))
                next_(index + 1)
            self.scoped_call("ranking:refresh", [{"accountId": identifier, "itemIds": [ids[index]]}], done)
        next_()

    def manage_storage(self):
        kind = self.storage_kind.currentData()
        request = {"accountId": self.account.currentData(), "kind": kind}
        if kind != "create":
            request["storageUnitId"] = self.storage.currentData()
        if kind == "rename":
            request["name"] = self.storage_name.text().strip()
        def review(preview):
            dialog = ReviewDialog(self.storage_kind.currentText(), [("Conta", preview["accountLabel"]), ("Cofre", (preview.get("unit") or {}).get("name")), ("Itens", (preview.get("unit") or {}).get("count")), ("Novo nome", preview.get("name"))], ["As skins regressam ao inventário da mesma conta." if kind in ("clear", "delete") else "Aplicar a alteração revista."], self)
            if dialog.exec() == QDialog.Accepted:
                self.scoped_call("storage-management:confirm", [preview["previewId"]], lambda _: self.reload())
        self.scoped_call("storage-management:prepare", [request], review)

    def show_storage_operations(self, values):
        identifier = self.account.currentData()
        self.storage_operations.set_records([value for value in values if value.get("accountId") == identifier or value.get("state") in ("sending", "unconfirmed")])

    def verify_storage(self):
        record = self.storage_operations.current_record()
        if record:
            self.scoped_call("storage-management:verify", [record["operationId"]], lambda _: self.reload())

    def receive_event(self, event):
        if event.get("type") == "inventory-batch" and self.batch and event["batch"]["batchId"] == self.batch["batchId"]:
            self.show_batch(event["batch"])
        elif event.get("type") in ("inventory-action", "storage-management") and self.account.currentData() in (event.get("accountId"), event.get("destinationAccountId")):
            self.load_operations()
