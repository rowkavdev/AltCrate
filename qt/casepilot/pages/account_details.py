from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QVBoxLayout, QFormLayout, QLabel
from ..widgets import DataTable, button, row, number, t


class AccountDetailsDialog(QDialog):
    def __init__(self, model, identifier, parent):
        super().__init__(parent)
        self.model = model
        self.identifier = identifier
        self.setModal(True)
        self.setAttribute(Qt.WA_DeleteOnClose)
        self.resize(650, 520)
        self.setWindowTitle(t("Detalhes da conta"))
        layout = QVBoxLayout(self)
        self.heading = QLabel()
        self.heading.setObjectName("pageTitle")
        layout.addWidget(self.heading)
        form = QFormLayout()
        self.fields = {}
        for key, label in (("id", "Identificador"), ("email", "Email"), ("money", "Saldo virtual"), ("tokens", "Tokens"), ("casesTotal", "Caixas observadas"), ("last", "Última operação")):
            value = QLabel()
            value.setWordWrap(True)
            value.setTextInteractionFlags(Qt.TextSelectableByMouse)
            self.fields[key] = value
            form.addRow(t(label), value)
        layout.addLayout(form)
        self.state = QLabel()
        self.state.setWordWrap(True)
        layout.addWidget(self.state)
        note = QLabel(t("Resumo da última leitura. Os itens do inventário não são apresentados nesta lista."))
        note.setWordWrap(True)
        layout.addWidget(note)
        self.cases = DataTable([("Caixa", "name"), ("Quantidade", "amount")])
        layout.addWidget(self.cases)
        self.refresh = button("Atualizar", lambda: model.refresh_accounts([identifier]))
        layout.addWidget(row(self.refresh, button("Fechar", self.close)))
        model.changed.connect(self.update_details)
        self.update_details()

    def update_details(self):
        account = next((account for account in self.model.accounts if account["id"] == self.identifier), None)
        if account is None:
            self.state.setText(t("Conta removida"))
            self.refresh.setEnabled(False)
            return
        snapshot = self.model.snapshots.get(self.identifier, {})
        operation = next((value for value in self.model.farm.get("accounts", []) if value["id"] == self.identifier), {})
        self.heading.setText(account["label"])
        self.fields["id"].setText(self.identifier)
        self.fields["email"].setText(account.get("email") or "—")
        for key in ("money", "tokens", "casesTotal"):
            self.fields[key].setText(number(snapshot.get(key), 0 if key == "casesTotal" else 2))
        last = operation.get("last") or {}
        self.fields["last"].setText(str(last.get("kind", "—")) + " · " + (number(last["confirmedDelta"]) + " " + t("Confirmado") if last.get("confirmedDelta") is not None else t("Por confirmar")))
        self.state.setText(str(snapshot.get("error") or operation.get("error") or t("Último estado observado")))
        self.cases.set_records(snapshot.get("cases", []))
        self.refresh.setEnabled(self.model.available and "refresh:" + self.identifier not in self.model.pending)
