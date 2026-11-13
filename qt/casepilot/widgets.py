"""Reusable native desktop controls, with no HTML or embedded React UI."""
from __future__ import annotations
import json
from pathlib import Path
from PySide6.QtCore import Qt, QLocale, Signal, QSettings, QItemSelectionModel, QSize, QRect
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTableWidget, QTableWidgetItem, QHeaderView, QAbstractItemView, QListWidget,
    QListWidgetItem, QLineEdit, QComboBox, QDialog, QDialogButtonBox, QFormLayout,
    QScrollArea, QFrame, QGridLayout, QSizePolicy, QLayout)

TRANSLATIONS = json.loads((Path(__file__).parent / "locales/en.json").read_text())


def t(value):
    return TRANSLATIONS.get(value, value) if QSettings().value("language", "pt") == "en" else value


def number(value, precision=2):
    if not isinstance(value, (int, float)):
        return "—"
    locale = QLocale("en_GB" if QSettings().value("language", "pt") == "en" else "pt_PT")
    return locale.toString(float(value), "f", precision)


def button(label, action, *, primary=False):
    widget = QPushButton(t(label))
    widget.setProperty("primary", primary)
    widget.setCursor(Qt.PointingHandCursor)
    widget.clicked.connect(lambda: action())
    return widget


class FlowLayout(QLayout):
    def __init__(self, parent):
        super().__init__(parent)
        self.items = []
        self.setContentsMargins(0, 0, 0, 0)
        self.setSpacing(10)

    def addItem(self, item):
        self.items.append(item)

    def count(self):
        return len(self.items)

    def itemAt(self, index):
        return self.items[index] if 0 <= index < len(self.items) else None

    def takeAt(self, index):
        return self.items.pop(index) if 0 <= index < len(self.items) else None

    def hasHeightForWidth(self):
        return True

    def heightForWidth(self, width):
        return self.arrange(QRect(0, 0, width, 0), measure=True)

    def sizeHint(self):
        return self.minimumSize()

    def minimumSize(self):
        return QSize(max((min(240, item.minimumSize().width()) for item in self.items), default=0), max((item.sizeHint().height() for item in self.items), default=0))

    def setGeometry(self, rect):
        super().setGeometry(rect)
        self.arrange(rect)

    def arrange(self, rect, measure=False):
        lines, line, used = [], [], 0
        for item in self.items:
            if item.isEmpty():
                continue
            hint = item.sizeHint()
            width = min(max(hint.width(), item.minimumSize().width()), rect.width())
            if line and used + self.spacing() + width > rect.width():
                lines.append(line)
                line, used = [], 0
            line.append((item, width, hint.height()))
            used += width + (self.spacing() if len(line) > 1 else 0)
        if line:
            lines.append(line)
        y = rect.y()
        rtl = self.parentWidget().layoutDirection() == Qt.RightToLeft
        for line in lines:
            height = max(entry[2] for entry in line)
            remaining = max(0, rect.width() - sum(entry[1] for entry in line) - self.spacing() * (len(line) - 1))
            flexible = [entry[0] for entry in line if entry[0].expandingDirections() & Qt.Horizontal]
            x = rect.x()
            for item, width, _ in line:
                width += remaining // len(flexible) if item in flexible else 0
                if not measure:
                    item.setGeometry(QRect(rect.right() - (x - rect.x()) - width + 1 if rtl else x, y, width, height))
                x += width + self.spacing()
            y += height + self.spacing()
        return max(0, y - rect.y() - self.spacing())


def row(*widgets):
    widget = QWidget()
    widget.setObjectName("controlRow")
    layout = FlowLayout(widget)
    for child in widgets:
        layout.addWidget(child)
    return widget


class Card(QFrame):
    def __init__(self, title="", parent=None):
        super().__init__(parent)
        self.setObjectName("card")
        self.body = QVBoxLayout(self)
        self.body.setContentsMargins(20, 18, 20, 18)
        self.body.setSpacing(12)
        if title:
            label = QLabel(t(title))
            label.setObjectName("cardTitle")
            self.body.addWidget(label)


class Disclosure(QFrame):
    """Native equivalent of the workspace's secondary, expandable sections."""
    def __init__(self, title, description="", *, expanded=False, parent=None):
        super().__init__(parent)
        self.setObjectName("disclosure")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 8, 14, 8)
        layout.setSpacing(4)
        self.caption = t(title)
        self.toggle = QPushButton(self.caption)
        self.toggle.setObjectName("disclosureToggle")
        self.toggle.setCursor(Qt.PointingHandCursor)
        self.toggle.setCheckable(True)
        self.toggle.setAccessibleName(t(title))
        layout.addWidget(self.toggle)
        if description:
            note = QLabel(t(description))
            note.setObjectName("muted")
            note.setWordWrap(True)
            layout.addWidget(note)
        self.content = QWidget()
        self.content.setObjectName("disclosureContent")
        self.body = QVBoxLayout(self.content)
        self.body.setContentsMargins(0, 10, 0, 6)
        self.body.setSpacing(12)
        layout.addWidget(self.content)
        self.toggle.toggled.connect(self.set_expanded)
        self.toggle.setChecked(expanded)
        self.set_expanded(expanded)

    def set_expanded(self, expanded):
        self.content.setVisible(expanded)
        self.toggle.setChecked(expanded)
        self.toggle.setProperty("expanded", expanded)
        self.toggle.setText(self.caption + ("   ⌃" if expanded else "   ⌄"))
        self.toggle.style().unpolish(self.toggle)
        self.toggle.style().polish(self.toggle)
        self.toggle.setAccessibleDescription(t("Fechar secção" if expanded else "Abrir secção"))


class TileGrid(QWidget):
    """Keep dashboard cards readable when the native window is narrowed."""
    def __init__(self, widgets, *, minimum=180, columns=5):
        super().__init__()
        self.widgets = widgets
        self.minimum = minimum
        self.maximum_columns = columns
        self.columns = 0
        self.grid = QGridLayout(self)
        self.grid.setContentsMargins(0, 0, 0, 0)
        self.grid.setSpacing(12)
        for widget in widgets:
            widget.setSizePolicy(QSizePolicy.Ignored, QSizePolicy.Preferred)
        self.reflow()

    def reflow(self):
        columns = max(1, min(self.maximum_columns, (self.width() + 12) // (self.minimum + 12)))
        if self.columns == columns:
            return
        for index in range(self.maximum_columns):
            self.grid.setColumnStretch(index, 0)
        for widget in self.widgets:
            self.grid.removeWidget(widget)
        for index, widget in enumerate(self.widgets):
            self.grid.addWidget(widget, index // columns, index % columns)
        for index in range(columns):
            self.grid.setColumnStretch(index, 1)
        self.columns = columns

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.reflow()


class Page(QWidget):
    def __init__(self, model, title, description, parent=None):
        super().__init__(parent)
        self.model = model
        self.title = title
        self.outer = QVBoxLayout(self)
        self.outer.setContentsMargins(28, 24, 28, 24)
        self.outer.setSpacing(16)
        self.header = QWidget()
        header_layout = QHBoxLayout(self.header)
        header_layout.setContentsMargins(0, 0, 0, 0)
        heading = QLabel(t(title))
        heading.setObjectName("pageTitle")
        header_layout.addWidget(heading, 1)
        self.outer.addWidget(self.header)
        subtitle = QLabel(t(description))
        subtitle.setObjectName("muted")
        subtitle.setWordWrap(True)
        self.outer.addWidget(subtitle)
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.NoFrame)
        self.content = QWidget()
        self.body = QVBoxLayout(self.content)
        self.body.setContentsMargins(0, 8, 0, 8)
        self.body.setSpacing(16)
        self.scroll.setWidget(self.content)
        self.outer.addWidget(self.scroll, 1)

    def secondary(self, title, *widgets, description=""):
        section = Disclosure(title, description)
        for widget in widgets:
            self.body.removeWidget(widget)
            section.body.addWidget(widget)
        self.body.addWidget(section)
        return section

    def empty(self, message):
        label = QLabel(t(message))
        label.setWordWrap(True)
        label.setObjectName("muted")
        self.body.addWidget(label)
        return label


class DataTable(QTableWidget):
    def __init__(self, columns, parent=None):
        super().__init__(0, len(columns), parent)
        self.columns = columns
        self.records = []
        self.setHorizontalHeaderLabels([t(label) for label, key in columns])
        self.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.verticalHeader().hide()
        self.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.setAlternatingRowColors(True)
        self.setMinimumHeight(230)
        self.setSortingEnabled(False)

    def selectRow(self, row):
        # Select through the model so RTL tables also work before first layout.
        if 0 <= row < self.rowCount() and self.columnCount():
            index = self.model().index(row, 0)
            selection = self.selectionModel()
            selection.setCurrentIndex(index, QItemSelectionModel.NoUpdate)
            selection.select(index, QItemSelectionModel.ClearAndSelect | QItemSelectionModel.Rows)

    def set_records(self, records):
        if records == self.records:
            return
        current = self.current_record()
        current_id = (current or {}).get("id", (current or {}).get("operationId"))
        blocked = self.blockSignals(True)
        self.clearSelection()
        self.setCurrentCell(-1, -1)
        self.records = records
        self.setRowCount(len(records))
        for index, record in enumerate(records):
            for column, (label, key) in enumerate(self.columns):
                value = key(record) if callable(key) else record.get(key)
                text = "—" if value is None else number(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else str(value)
                item = QTableWidgetItem(text)
                item.setData(Qt.UserRole, record)
                self.setItem(index, column, item)
            if current_id is not None and record.get("id", record.get("operationId")) == current_id:
                self.selectRow(index)
        self.blockSignals(blocked)
        if not blocked:
            self.itemSelectionChanged.emit()

    def current_record(self):
        index = self.currentRow()
        return self.records[index] if 0 <= index < len(self.records) else None


class AccountPicker(QComboBox):
    changed = Signal(str)
    def __init__(self, model, *, empty=True, parent=None):
        super().__init__(parent)
        self.model = model
        self.empty_option = empty
        self.fingerprint = None
        model.changed.connect(self.update_accounts)
        self.currentIndexChanged.connect(lambda _: self.changed.emit(self.currentData() or ""))
        self.update_accounts()

    def update_accounts(self):
        fingerprint = [(a["id"], a["label"]) for a in self.model.accounts]
        if fingerprint == self.fingerprint:
            return
        self.fingerprint = fingerprint
        current = self.currentData()
        self.blockSignals(True)
        self.clear()
        if self.empty_option:
            self.addItem(t("Seleciona uma conta"), "")
        for account in self.model.accounts:
            self.addItem(account["label"], account["id"])
        index = self.findData(current)
        self.setCurrentIndex(index if index >= 0 else 0)
        self.blockSignals(False)


class AccountSelection(Disclosure):
    def __init__(self, model, parent=None):
        super().__init__("Contas abrangidas", parent=parent)
        self.model = model
        self.fingerprint = None
        self.search = QLineEdit()
        self.search.setPlaceholderText(t("Pesquisar conta…"))
        self.list = QListWidget()
        self.list.setMinimumHeight(150)
        self.list.setMaximumHeight(240)
        self.count = QLabel()
        self.body.addWidget(row(self.search, button("Selecionar todas", self.select_all), button("Limpar", lambda: model.select([]))))
        self.body.addWidget(self.list)
        self.body.addWidget(self.count)
        self.search.textChanged.connect(self.filter)
        self.list.itemChanged.connect(self.selection_changed)
        model.changed.connect(self.update_accounts)
        self.update_accounts()

    def update_accounts(self):
        fingerprint = (tuple((a["id"], a["label"]) for a in self.model.accounts), tuple(sorted(self.model.selected)))
        if self.fingerprint == fingerprint:
            return
        self.fingerprint = fingerprint
        self.list.blockSignals(True)
        self.list.clear()
        for account in self.model.accounts:
            item = QListWidgetItem(account["label"])
            item.setData(Qt.UserRole, account["id"])
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            item.setCheckState(Qt.Checked if account["id"] in self.model.selected else Qt.Unchecked)
            self.list.addItem(item)
        self.list.blockSignals(False)
        self.filter()
        self.count.setText(f"{len(self.model.selected)} / {len(self.model.accounts)} " + t("Contas"))
        self.caption = f"{len(self.model.selected)} " + t("contas selecionadas")
        self.set_expanded(self.toggle.isChecked())

    def filter(self):
        needle = self.search.text().casefold()
        for index in range(self.list.count()):
            item = self.list.item(index)
            item.setHidden(needle not in item.text().casefold())

    def select_all(self):
        identifiers = set(self.model.selected)
        for index in range(self.list.count()):
            item = self.list.item(index)
            if not item.isHidden():
                identifiers.add(item.data(Qt.UserRole))
        self.model.select(identifiers)

    def selection_changed(self, item):
        identifiers = set(self.model.selected)
        identifier = item.data(Qt.UserRole)
        if item.checkState() == Qt.Checked:
            identifiers.add(identifier)
        else:
            identifiers.discard(identifier)
        self.model.select(identifiers)


class ReviewDialog(QDialog):
    def __init__(self, title, fields, steps, parent=None, *, confirm="Confirmar"):
        super().__init__(parent)
        self.setWindowTitle(t(title))
        self.resize(560, 430)
        layout = QVBoxLayout(self)
        heading = QLabel(t(title))
        heading.setObjectName("cardTitle")
        layout.addWidget(heading)
        form = QFormLayout()
        for label, value in fields:
            widget = QLabel(str(value) if value is not None else "—")
            widget.setWordWrap(True)
            widget.setTextInteractionFlags(Qt.TextSelectableByMouse)
            form.addRow(t(label), widget)
        layout.addLayout(form)
        for index, step in enumerate(steps):
            label = QLabel(f"{index + 1}. " + t(str(step)))
            label.setWordWrap(True)
            layout.addWidget(label)
        layout.addStretch()
        buttons = QDialogButtonBox(QDialogButtonBox.Cancel)
        buttons.button(QDialogButtonBox.Cancel).setText(t("Voltar"))
        accept = buttons.addButton(t(confirm), QDialogButtonBox.AcceptRole)
        accept.setProperty("primary", True)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)


from .theme import stylesheet
STYLE = stylesheet("dark")
