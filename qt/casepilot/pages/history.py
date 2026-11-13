"""Filtered persistent operation history, with bounded pagination and stale guards."""
import json
from datetime import date, datetime, time, timezone
from PySide6.QtCore import QSettings, QTimer
from PySide6.QtWidgets import QComboBox, QLineEdit, QLabel, QFormLayout, QDialog, QVBoxLayout
from ..widgets import Card, DataTable, button, row, number, t

KINDS = {"reward": "Recompensa", "mission": "Missão", "pass": "Passe mensal", "skill-buy": "Comprar habilidade", "skill-sell": "Vender habilidade", "skill-preset": "Preset de habilidades", "autoopen": "Preferências do site", "sell": "Venda", "withdraw": "Retirada", "transfer": "Envio", "move-to-storage": "Mover para storage", "convert": "Conversão", "conversion": "Conversão", "case": "Caixas", "money": "Dinheiro", "open": "Abertura", "vault": "Cofre", "boost": "Boost", "purchase": "Compra", "game": "Jogo", "inventory-action": "Inventário", "progression": "Progressão", "token-converter": "Conversor", "opening-item": "Regra local", "cooldown": "Limite da API", "account-error": "Erro de conta"}
RESULTS = {"confirmed": "Confirmado", "failed": "Falhado", "cancelled": "Cancelado", "unconfirmed": "Por confirmar", "running": "Em curso"}
VALUE_LABELS = {"sold": "Caixas vendidas", "bought": "Cápsulas compradas", "opened": "Cápsulas abertas", "converted": "Itens convertidos", "reviewedCost": "Custo revisto", "cost": "Custo", "price": "Preço", "refund": "Reembolso", "pointCost": "Pontos", "completed": "Passos concluídos", "total": "Passos", "observedMoney": "Saldo observado", "observedTokens": "Tokens observados", "moneyDelta": "Diferença de saldo", "tokenDelta": "Diferença de tokens", "verifiedDelta": "Diferença observada", "confirmedDelta": "Crédito observado", "openedCount": "Aberturas", "skinCount": "Itens", "clicks": "Cliques", "quantity": "Quantidade", "acceptedCount": "Aceites", "confirmedCount": "Confirmadas", "unconfirmedCount": "Por confirmar", "requestedCount": "Pedidos", "selectedCaseDelta": "Diferença de stock", "observedCaseDelta": "Diferença de caixas", "awardedCount": "Caixas recebidas", "sentTokens": "Tokens enviados"}


def observed_values(values):
    return " · ".join(t(VALUE_LABELS.get(key, key)) + ": " + number(value) for key, value in values.items())


class HistoryPanel(Card):
    def __init__(self, model):
        super().__init__("Histórico entre sessões")
        self.model = model
        self.offset = 0
        self.total = 0
        self.revision = 0
        self.busy = False
        self.loaded = False
        try:
            self.saved = json.loads(QSettings().value("history/filters", "{}"))
        except (ValueError, TypeError):
            self.saved = {}
        self.account = QComboBox()
        self.kind = QComboBox()
        self.result = QComboBox()
        for control, all_label, options, key in ((self.kind, "Todas as operações", KINDS, "kind"), (self.result, "Todos os resultados", RESULTS, "result")):
            control.addItem(t(all_label), "all")
            for value, label in options.items():
                control.addItem(t(label), value)
            control.setCurrentIndex(max(0, control.findData(self.saved.get(key, "all"))))
        self.from_date = QLineEdit(self.saved.get("from", ""))
        self.to_date = QLineEdit(self.saved.get("to", ""))
        self.from_date.setPlaceholderText("AAAA-MM-DD")
        self.to_date.setPlaceholderText("AAAA-MM-DD")
        form = QFormLayout()
        for label, control in (("Conta", self.account), ("Operação", self.kind), ("Resultado", self.result), ("Desde", self.from_date), ("Até", self.to_date)):
            form.addRow(t(label), control)
        self.body.addLayout(form)
        self.note = QLabel(t("Os valores observados não representam lucro atribuído à operação."))
        self.note.setWordWrap(True)
        self.body.addWidget(self.note)
        self.status = QLabel()
        self.status.setWordWrap(True)
        self.body.addWidget(self.status)
        self.refresh = button("Atualizar histórico", self.load)
        self.body.addWidget(row(self.refresh, button("Exportar histórico", lambda: model.call("history:export"))))
        self.table = DataTable([("Observação", "at"), ("Conta", lambda value: self.account_label(value.get("accountId"))), ("Operação", lambda value: t(KINDS.get(value.get("kind") or value.get("type"), "Operação"))), ("Resultado", lambda value: t(RESULTS.get(value.get("result"), "Por confirmar"))), ("Valores observados", lambda value: observed_values(value.get("values", {})))])
        self.body.addWidget(self.table)
        self.previous = button("Anterior", lambda: self.page(-1))
        self.next = button("Seguinte", lambda: self.page(1))
        self.body.addWidget(row(self.previous, self.next, button("Ver detalhes", self.details)))
        self.debounce = QTimer(self)
        self.debounce.setSingleShot(True)
        self.debounce.setInterval(200)
        self.debounce.timeout.connect(self.load)
        self.update_accounts()
        for control in (self.account, self.kind, self.result):
            control.currentIndexChanged.connect(self.filter_changed)
        for control in (self.from_date, self.to_date):
            control.textChanged.connect(self.filter_changed)
        model.changed.connect(self.update_accounts)
        self.table.itemDoubleClicked.connect(lambda _: self.details())
        self.buttons()

    def account_label(self, identifier):
        return next((a["label"] for a in self.model.accounts if a["id"] == identifier), identifier or "—")

    def update_accounts(self):
        options = [("all", t("Todas as contas"))] + [(a["id"], a["label"]) for a in self.model.accounts]
        if options == [(self.account.itemData(i), self.account.itemText(i)) for i in range(self.account.count())]:
            return
        current = self.account.currentData() or self.saved.get("accountId", "all")
        self.account.blockSignals(True)
        self.account.clear()
        for identifier, label in options:
            self.account.addItem(label, identifier)
        self.account.setCurrentIndex(max(0, self.account.findData(current)))
        self.account.blockSignals(False)

    def filter_changed(self, *_):
        self.offset = 0
        self.revision += 1
        self.debounce.start()

    def filters(self):
        result = {"accountId": self.account.currentData(), "kind": self.kind.currentData(), "result": self.result.currentData(), "offset": self.offset, "limit": 100}
        dates = {}
        for key, control, end in (("from", self.from_date, False), ("to", self.to_date, True)):
            value = control.text().strip()
            if value:
                try:
                    parsed = date.fromisoformat(value)
                except ValueError:
                    raise ValueError("Data inválida. Usa AAAA-MM-DD.") from None
                if parsed.isoformat() != value:
                    raise ValueError("Data inválida. Usa AAAA-MM-DD.")
                dates[key] = parsed
                result[key] = datetime.combine(parsed, time.max if end else time.min).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        if "from" in dates and "to" in dates and dates["from"] > dates["to"]:
            raise ValueError("O início do período deve ser anterior ao fim.")
        return result

    def load(self):
        self.debounce.stop()
        if not self.model.available:
            return
        self.revision += 1
        revision = self.revision
        try:
            filters = self.filters()
        except ValueError as error:
            self.busy = False
            self.status.setText(t(str(error)))
            self.buttons()
            return
        QSettings().setValue("history/filters", json.dumps({"accountId": filters["accountId"], "kind": filters["kind"], "result": filters["result"], "from": self.from_date.text().strip(), "to": self.to_date.text().strip()}))
        self.busy = True
        self.status.setText(t("A consultar…"))
        self.buttons()
        def done(value):
            if revision != self.revision:
                return
            self.busy = False
            self.loaded = True
            self.total = value["total"]
            self.table.set_records(value["rows"])
            self.status.setText(f"{self.total} " + t("eventos encontrados") + f" · {self.offset + 1 if self.total else 0}–{min(self.offset + len(value['rows']), self.total)}")
            self.note.setText(t("Retenção") + f": {value.get('retentionDays', 90)} " + t("dias") + f" · {value.get('maxEntries', 20000)} " + t("eventos") + ". " + t("Os valores observados não representam lucro atribuído à operação."))
            self.buttons()
        def error(message):
            if revision == self.revision:
                self.busy = False
                self.status.setText(str(message))
                self.buttons()
        self.model.call("history:query", [filters], done, busy_key="history:" + str(revision), error=error)

    def buttons(self):
        self.previous.setEnabled(not self.busy and self.offset > 0)
        self.next.setEnabled(not self.busy and self.offset + 100 < self.total)
        self.refresh.setEnabled(not self.busy and self.model.available)

    def page(self, direction):
        target = max(0, self.offset + direction * 100)
        if not self.busy and target < self.total:
            self.offset = target
            self.load()

    def details(self):
        value = self.table.current_record()
        if not value:
            return
        dialog = QDialog(self)
        dialog.setWindowTitle(t("Detalhes da operação"))
        dialog.resize(600, 430)
        layout = QVBoxLayout(dialog)
        form = QFormLayout()
        for label, text in (("Conta", self.account_label(value.get("accountId"))), ("Conta de destino", self.account_label(value.get("destinationAccountId"))), ("Observação", value.get("at")), ("Operação", value.get("operationId")), ("Resultado", t(RESULTS.get(value.get("result"), "Por confirmar"))), ("Estado", value.get("state")), ("HTTP", value.get("httpStatus")), ("Duração (ms)", value.get("durationMs")), ("Valores observados", observed_values(value.get("values", {})))):
            field = QLabel(str(text) if text is not None else "—")
            field.setWordWrap(True)
            form.addRow(t(label), field)
        layout.addLayout(form)
        if value.get("interrupted"):
            layout.addWidget(QLabel(t("Aplicação interrompida; verificar operação.")))
        layout.addWidget(button("Fechar", dialog.accept))
        dialog.exec()
