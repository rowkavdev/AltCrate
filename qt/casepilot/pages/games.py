from __future__ import annotations
import math
import time
from PySide6.QtCore import Qt, QTimer, QRectF
from PySide6.QtGui import QBrush, QColor, QPen, QFont
from PySide6.QtWidgets import (QWidget, QLabel, QComboBox, QLineEdit, QSpinBox, QDoubleSpinBox,
    QCheckBox, QGridLayout, QGraphicsScene, QGraphicsView, QDialog, QFormLayout)
from ..widgets import Page, Card, DataTable, AccountSelection, ReviewDialog, button, row, t, number
from .progression import display

GAMES = [("casebattle", "Casebattle"), ("jackpot", "Jackpot"), ("coinflip", "Coinflip"), ("upgrade", "Upgrade"), ("dice", "Dice"), ("guesstherank", "Guess the Rank"), ("blackjack", "Blackjack"), ("plinko", "Plinko"), ("crash", "Crash")]
MOVES = {"hit": "Pedir carta", "stand": "Parar", "double": "Dobrar", "split": "Dividir"}
SUITS = {"S": "♠", "H": "♥", "D": "♦", "C": "♣", "SPADES": "♠", "HEARTS": "♥", "DIAMONDS": "♦", "CLUBS": "♣"}


def cards_text(cards):
    return " ".join(card["rank"] + SUITS.get(card.get("suit"), card.get("suit", "")) for card in cards)


class GameCard(Card):
    def __init__(self, model, account, parent=None):
        super().__init__(account["label"], parent)
        self.model = model
        self.account = account
        self.state = None
        self.pending = False
        self.revision = 0
        self.auto_state = {}
        self.game = QComboBox()
        for identifier, label in GAMES:
            self.game.addItem(label, identifier)
        self.game.setCurrentIndex(self.game.findData(model.settings.value("game:" + account["id"], "blackjack")))
        self.balance = QLabel(t("Sem leitura"))
        self.body.addWidget(row(self.game, button("Atualizar", self.load)))
        self.body.addWidget(self.balance)
        self.scene = QGraphicsScene(self)
        self.visual = QGraphicsView(self.scene)
        self.visual.setMinimumHeight(205)
        self.visual.setMaximumHeight(300)
        self.visual.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.body.addWidget(self.visual)
        self.controls = QWidget()
        self.control_layout = QFormLayout(self.controls)
        self.body.addWidget(self.controls)
        self.bet = QDoubleSpinBox()
        self.bet.setDecimals(2)
        self.bet.setRange(0.01, 10000000)
        self.bet.setValue(float(model.settings.value("bet:" + account["id"], 100)))
        self.control_layout.addRow(t("Aposta em tokens"), self.bet)
        self.status = QLabel()
        self.status.setWordWrap(True)
        self.body.addWidget(self.status)
        self.result = QLabel()
        self.result.setWordWrap(True)
        self.body.addWidget(self.result)
        self.buttons = []
        self.fields = {}
        self.game.currentIndexChanged.connect(self.game_changed)
        self.bet.valueChanged.connect(lambda value: model.settings.setValue("bet:" + account["id"], value))
        model.bridge.event.connect(self.receive_event)
        self.build_controls()

    def build_controls(self):
        while self.control_layout.rowCount() > 1:
            self.control_layout.removeRow(1)
        self.buttons = []
        self.fields = {}
        game = self.game.currentData()
        def spin(key, label, minimum, maximum, value, *, decimal=False):
            field = QDoubleSpinBox() if decimal else QSpinBox()
            field.setRange(minimum, maximum)
            field.setValue(value)
            self.fields[key] = field
            self.control_layout.addRow(t(label), field)
            return field
        def combo(key, label, options):
            field = QComboBox()
            for label_, value in options:
                field.addItem(t(label_), value)
            self.fields[key] = field
            self.control_layout.addRow(t(label), field)
            return field
        def action(label, name, payload=lambda: {}):
            control = button(label, lambda: self.act(name, payload()), primary=True)
            self.buttons.append((name, control))
            self.control_layout.addRow(control)
        if game == "blackjack":
            self.bet.setDecimals(0)
            self.bet.setMinimum(1)
            self.fields["code"] = QLineEdit()
            self.control_layout.addRow(t("Código da mesa"), self.fields["code"])
            action("Abrir mesa privada", "create")
            action("Entrar", "join", lambda: {"code": self.fields["code"].text().strip()})
            spin("seat", "Lugar", 1, 10, 1)
            action("Ocupar lugar", "sit", self.seat_payload)
            action("Apostar", "bet", lambda: {"bet": int(self.bet.value())})
            moves = []
            for move, label in MOVES.items():
                control = button(label, lambda move=move: self.play(move))
                self.buttons.append((move, control))
                moves.append(control)
            self.control_layout.addRow(row(*moves))
            self.control_layout.addRow(button("Deixar mesa", self.leave))
        elif game == "dice":
            self.bet.setDecimals(0)
            self.bet.setMinimum(100)
            self.bet.setValue(max(100, self.bet.value()))
            spin("target", "Alvo", 1, 99, 50)
            combo("choice", "Escolha", [("Acima", "over"), ("Abaixo", "under")])
            action("Lançar dados", "roll", lambda: {"bet": int(self.bet.value()), "targetNumber": self.fields["target"].value(), "playerChoice": self.fields["choice"].currentData()})
        elif game == "plinko":
            self.bet.setDecimals(0)
            self.bet.setMinimum(1)
            combo("risk", "Risco", [(value, value) for value in ("Low", "Medium", "High", "Extreme")])
            action("Soltar", "drop", lambda: {"bet": int(self.bet.value()), "risk": self.fields["risk"].currentData()})
        elif game == "guesstherank":
            self.bet.setDecimals(0)
            self.bet.setMinimum(1)
            combo("version", "Versão", [("CS2", "cs2"), ("CS:GO", "csgo")])
            spin("rank", "Rank", 0, 8, 1)
            action("Iniciar ronda", "start", lambda: {"bet": int(self.bet.value()), "game": self.fields["version"].currentData()})
            self.control_layout.addRow(button("Ver vídeo da ronda", self.open_video))
            action("Enviar palpite", "guess", lambda: {"rankId": self.fields["rank"].value()})
        elif game == "upgrade":
            self.bet.setDecimals(2)
            self.bet.setMinimum(0.01)
            spin("price", "Preço alvo ($ virtual)", 0.01, 10000000, 110, decimal=True)
            self.fields["target"] = QComboBox()
            self.control_layout.addRow(t("Item alvo"), self.fields["target"])
            self.control_layout.addRow(button("Procurar itens alvo", self.find_targets))
            self.fields["price"].valueChanged.connect(lambda _: self.fields["target"].clear())
            self.bet.valueChanged.connect(lambda _: self.fields["target"].clear() if self.game.currentData() == "upgrade" else None)
            action("Tentar upgrade", "attempt", lambda: {"tokens": self.bet.value(), "targetId": self.fields["target"].currentData(), "targetPrice": self.fields["price"].value()})
        elif game == "crash":
            self.bet.setDecimals(0)
            self.bet.setMinimum(1)
            spin("cashout", "Cashout automático", 1.01, 1000, 2, decimal=True)
            self.fields["automaticCashout"] = QCheckBox(t("Usar cashout automático"))
            self.control_layout.addRow(self.fields["automaticCashout"])
            action("Apostar", "bet", lambda: {"bet": int(self.bet.value()), "autoCashout": self.fields["cashout"].value() if self.fields["automaticCashout"].isChecked() else None})
            action("Levantar aposta agora", "cashout")
        elif game == "jackpot":
            spin("time", "Duração (s)", 10, 300, 60)
            spin("maxDeposit", "Depósito máximo", 1, 10000000, 1000)
            action("Criar Jackpot privado", "create", lambda: {"time": self.fields["time"].value(), "maxDeposit": self.fields["maxDeposit"].value(), "isPrivate": True})
            note = QLabel(t("A criação pode exigir uma subscrição. Depositar itens ainda não está disponível."))
            note.setWordWrap(True)
            self.control_layout.addRow(note)
        if game in ("coinflip", "jackpot", "casebattle"):
            self.fields["lobby"] = DataTable([("Jogo", "id"), ("Aposta", "bet"), ("Preço", "price"), ("Estado", "status"), ("Jogadores", "players")])
            self.fields["lobby"].setMinimumHeight(180)
            self.control_layout.addRow(self.fields["lobby"])
            if game != "jackpot":
                note = QLabel(t("As ações deste jogo ainda não têm um contrato verificado na app atual."))
                note.setWordWrap(True)
                self.control_layout.addRow(note)
        self.update_controls()

    def game_changed(self, *_):
        self.revision += 1
        self.model.call("blackjack:auto-stop", [[self.account["id"]]], busy_key="auto-stop:" + self.account["id"])
        self.model.settings.setValue("game:" + self.account["id"], self.game.currentData())
        self.state = None
        self.auto_state = {}
        self.result.clear()
        self.build_controls()
        self.load()

    def invoke(self, channel, args, done):
        game, revision = self.game.currentData(), self.revision
        self.pending = True
        self.update_controls()
        def success(value):
            self.pending = False
            if game == self.game.currentData() and revision == self.revision:
                done(value)
                self.update_controls()
        def failure(message):
            self.pending = False
            if game == self.game.currentData() and revision == self.revision:
                self.status.setText(str(message))
                self.update_controls()
        self.model.call(channel, args, success, busy_key="game:" + self.account["id"] + ":" + channel + ":" + str(revision), error=failure)

    def load(self):
        self.invoke("games:load", [self.account["id"], self.game.currentData(), {"resume": True}], self.loaded)

    def loaded(self, value):
        self.state = value
        self.balance.setText(number(value.get("tokens")) + " " + t("tokens") + " · " + number(value.get("money")) + " $")
        availability = value.get("availability") or {}
        self.status.setText(availability.get("message", ""))
        self.update_controls()
        self.render()

    def events(self):
        return ((self.state or {}).get("socket") or {}).get("events", {})

    def table(self):
        return self.events().get("blackjackTableState") or {}

    def seat(self):
        return next((seat for seat in self.table().get("seats", []) if seat and seat.get("mine")), {})

    def seat_payload(self):
        table = self.table()
        joined = self.events().get("blackjackTableJoined") or self.events().get("blackjackMySeat") or {}
        return {"tableId": table.get("tableId") or joined.get("tableId"), "code": table.get("code") or joined.get("code"), "seatIndex": self.fields["seat"].value() - 1}

    def play(self, move):
        self.act("play", {"move": move, "turnId": self.seat().get("turnId")})

    def act(self, action, payload):
        if self.pending or self.auto_state.get("active"):
            return
        def done(value):
            self.result.setText(t("Ação enviada; aguarda confirmação no estado do jogo") if value.get("sent") else t("Resultado confirmado pelo servidor") if value.get("verified") else t("Pedido aceite; resultado por confirmar"))
            if value.get("verified"):
                values = {key: item for key, item in value.items() if key in ("diceRoll", "tokensWonOrLost", "bet", "multiplier", "won", "skinName", "tokensWon", "rank")}
                self.result.setText(self.result.text() + "\n" + display(values))
            if self.game.currentData() == "guesstherank" and value.get("state"):
                self.state["state"] = value["state"]
            self.render(value)
        self.invoke("games:action", [self.account["id"], self.game.currentData(), action, payload], done)

    def leave(self):
        self.model.call("blackjack:auto-stop", [[self.account["id"]]], busy_key="auto-stop:" + self.account["id"])
        self.invoke("games:leave", [self.account["id"], self.game.currentData()], lambda _: self.loaded({"socket": {"connected": False, "events": {}}}))

    def find_targets(self):
        def done(values):
            self.fields["target"].clear()
            for value in values:
                self.fields["target"].addItem(value["name"] + " · " + number(value["price"]), value["id"])
        self.invoke("games:options", [self.account["id"], "upgrade", self.bet.value(), self.fields["price"].value()], done)

    def open_video(self):
        video = (self.state or {}).get("state", {}).get("videoId")
        if isinstance(video, str) and __import__("re").fullmatch(r"[A-Za-z0-9_-]{11}", video):
            from PySide6.QtGui import QDesktopServices
            from PySide6.QtCore import QUrl
            QDesktopServices.openUrl(QUrl("https://www.youtube-nocookie.com/embed/" + video))

    def update_controls(self):
        loaded = self.state or {}
        events = self.events()
        game = self.game.currentData()
        connected = loaded.get("socket", {}).get("connected") is True if game in ("blackjack", "coinflip", "jackpot", "casebattle", "crash") else bool(loaded.get("supported"))
        active = self.auto_state.get("active") is True
        table, seat = self.table(), self.seat()
        hand = (seat.get("hands") or [])[seat.get("activeHandIndex", -1)] if isinstance(seat.get("activeHandIndex"), int) and 0 <= seat["activeHandIndex"] < len(seat.get("hands", [])) else {}
        funded = isinstance(loaded.get("tokens"), (int, float)) and loaded["tokens"] >= (hand.get("bet") or seat.get("bet") or math.inf)
        turn = table.get("phase") == "acting" and seat.get("turnId") is not None and hand.get("status") == "playing"
        for action, control in self.buttons:
            enabled = connected and not self.pending and not active
            if game == "blackjack":
                if action in ("create", "join"):
                    enabled &= not bool(table.get("tableId") or events.get("blackjackTableJoined", {}).get("tableId"))
                elif action == "sit":
                    enabled &= bool(table.get("tableId")) and not bool(seat)
                elif action == "bet":
                    enabled &= table.get("phase") == "betting" and seat.get("status") == "betting"
                elif action in MOVES:
                    enabled &= turn
                    if action in ("double", "split"):
                        enabled &= funded and len(hand.get("cards", [])) == 2 and not hand.get("splitAces")
                        if action == "split":
                            ranks = [10 if card["rank"] in ("10", "J", "Q", "K") else card["rank"] for card in hand.get("cards", [])]
                            enabled &= len(ranks) == 2 and ranks[0] == ranks[1] and len(seat.get("hands", [])) < 4
            elif game == "crash":
                phase = events.get("crashState", {}).get("phase")
                for event in ("crashNewRound", "crashStarted", "crashRoundEnd"):
                    if events.get(event):
                        phase = events[event].get("phase", phase)
                enabled &= phase == ("betting" if action == "bet" else "running")
            elif game == "guesstherank":
                round_ = loaded.get("state") or {}
                enabled &= bool(round_.get("active") and round_.get("videoId")) if action == "guess" else not round_.get("active", False)
            elif game == "upgrade":
                enabled &= bool(self.fields["target"].currentData())
            control.setEnabled(enabled)
        self.game.setEnabled(not self.pending and not active)

    def render(self, result=None):
        self.scene.clear()
        self.scene.setSceneRect(0, 0, 440, 230)
        table = self.table()
        if self.game.currentData() == "blackjack" and table:
            self.scene.setBackgroundBrush(QBrush(QColor("#153b32")))
            self.text(t("Dealer") + " · " + str(table.get("dealerValue") or "—"), 15, 8, 12)
            self.draw_cards(table.get("dealerCards", []), 15, 32)
            if table.get("dealerHoleCardHidden"):
                hidden = self.scene.addRect(15 + 49 * len(table.get("dealerCards", [])), 32, 42, 58, QPen(QColor("#76a7d9")), QBrush(QColor("#254769")))
            seat = self.seat()
            for index, hand in enumerate(seat.get("hands", [])):
                self.draw_cards(hand.get("cards", []), 15 + index * 108, 130)
                self.text(str(hand.get("value", "")) + " · " + str(hand.get("status", "")), 15 + index * 108, 196, 10)
            self.text(t(table.get("phase", "")) + " · " + t("Ronda") + " " + str(table.get("roundNumber", "—")), 15, 104, 12)
        else:
            self.scene.setBackgroundBrush(QBrush(QColor("#141b26")))
            title = self.game.currentText()
            if self.game.currentData() == "crash":
                value = self.events().get("crashTick", {}).get("multiplier", self.events().get("crashState", {}).get("multiplier"))
                title = number(value) + "×" if value is not None else "Crash"
            elif result and result.get("diceRoll") is not None:
                title = str(result["diceRoll"])
            elif result and result.get("multiplier") is not None:
                title = number(result["multiplier"]) + "×"
            self.text(title, 30, 60, 30)
            self.text(t("Estado recebido do servidor") if self.state else t("Atualiza para ligar o jogo"), 30, 125, 12)
        if "lobby" in self.fields:
            event = "gamesJackpot" if self.game.currentData() == "jackpot" else "games"
            self.fields["lobby"].set_records(self.events().get(event, {}).get("games", []))
        self.scene.setSceneRect(self.scene.itemsBoundingRect().united(QRectF(0, 0, 440, 230)))
        self.visual.fitInView(self.scene.sceneRect(), Qt.KeepAspectRatio)

    def text(self, text, x, y, size):
        item = self.scene.addSimpleText(str(text), QFont("Inter", size))
        item.setBrush(QBrush(QColor("#e8ebef")))
        item.setPos(x, y)

    def draw_cards(self, cards, x, y):
        for index, card in enumerate(cards):
            position = x + index * 49
            self.scene.addRect(position, y, 42, 58, QPen(QColor("#c2cbd6")), QBrush(QColor("#f3f5f8")))
            label = self.scene.addSimpleText(card["rank"] + SUITS.get(card.get("suit"), ""), QFont("Inter", 14))
            label.setBrush(QBrush(QColor("#bb263c" if card.get("suit") in ("H", "D", "HEARTS", "DIAMONDS") else "#17202c")))
            label.setPos(position + 5, y + 12)

    def receive_event(self, event):
        if event.get("accountId") != self.account["id"]:
            return
        if event.get("type") == "blackjack-qt":
            self.auto_state = event["state"]
            if self.game.currentData() == "blackjack":
                self.status.setText(t(event["state"].get("reason") or ("Automático em execução" if event["state"].get("active") else "Automático parado")) + "\n" + t("Dica") + ": " + t(MOVES.get(event["state"].get("reference"), "—")))
                self.update_controls()
        elif event.get("type") == "socket-game-update" and event.get("game") == self.game.currentData():
            self.state = self.state or {}
            socket = self.state.setdefault("socket", {"events": {}})
            if event.get("event") in ("connect", "disconnect", "connect_error"):
                socket["connected"] = event["event"] == "connect"
            else:
                socket.setdefault("events", {})[event["event"]] = event["data"]
            if event["event"] == "userstats":
                self.state.update(event["data"])
                self.balance.setText(number(self.state.get("tokens")) + " " + t("tokens"))
            if event["data"].get("error"):
                self.status.setText(event["data"]["error"])
            self.update_controls()
            self.render()


class GamesPage(Page):
    def __init__(self, model):
        super().__init__(model, "Jogos", "Mesas e jogos das tuas contas, com controlos independentes.")
        self.body.addWidget(AccountSelection(model))
        controls = Card("Blackjack automático")
        self.amount = QSpinBox()
        self.amount.setRange(1, 5000000)
        self.amount.setValue(10)
        self.mode = QComboBox()
        for label, value in (("Composição finita", "math"), ("Estratégia básica", "table"), ("Comparar IA local", "compare"), ("IA com validação matemática", "hybrid"), ("IA local experimental", "laya")):
            self.mode.addItem(t(label), value)
        self.progression = QComboBox()
        for label, value in (("Aposta por vantagem", "edge"), ("Aposta fixa", "fixed"), ("Vitória ×2 · derrota ÷2", "win-double-loss-half")):
            self.progression.addItem(t(label), value)
        self.columns = QSpinBox()
        self.columns.setRange(1, 5)
        self.columns.setValue(2)
        self.columns.valueChanged.connect(self.reflow)
        controls.body.addWidget(row(self.amount, self.mode, self.progression, self.columns))
        controls.body.addWidget(row(button("Iniciar automático", self.start, primary=True), button("Parar automático", self.stop), button("Apostar nas contas selecionadas", self.batch_bet)))
        self.local_status = QLabel()
        controls.body.addWidget(self.local_status)
        controls.body.addWidget(button("Preparar IA local", lambda: model.call("local-ai:prepare", done=self.show_local_ai)))
        self.body.addWidget(controls)
        self.grid_widget = QWidget()
        self.grid = QGridLayout(self.grid_widget)
        self.grid.setContentsMargins(0, 0, 0, 0)
        self.body.addWidget(self.grid_widget)
        research = Card("Análise das jogadas")
        research.body.addWidget(row(button("Atualizar análise", self.research), button("Exportar análise", lambda: model.call("run:export")), button("Verificar cálculo sem apostar", self.self_check)))
        self.research_status = QLabel()
        self.research_status.setWordWrap(True)
        research.body.addWidget(self.research_status)
        self.history = DataTable([("Conta", "accountId"), ("Ronda", "roundNumber"), ("Dealer", lambda value: cards_text(value.get("dealerCards", []))), ("Resultado", "netProfit"), ("Turnos sem comando", "turnsWithoutCommand")])
        self.history.itemDoubleClicked.connect(lambda _: self.show_round())
        research.body.addWidget(self.history)
        self.checks = DataTable([("Verificação", "name"), ("Passou", "passed"), ("Detalhe", "reason"), ("Tempo", "latencyMs")])
        research.body.addWidget(self.checks)
        self.secondary("Análise das jogadas", research)
        self.body.addStretch()
        self.cards = {}
        model.changed.connect(self.update_accounts)
        model.bridge.ready.connect(lambda _: model.call("local-ai:status", done=self.show_local_ai))
        self.update_accounts()

    def update_accounts(self):
        accounts = self.model.accounts[:20]
        known = {account["id"] for account in accounts}
        for identifier in list(self.cards):
            if identifier not in known:
                self.cards.pop(identifier).deleteLater()
        for account in accounts:
            if account["id"] not in self.cards:
                self.cards[account["id"]] = GameCard(self.model, account, self)
        self.reflow()

    def reflow(self, *_):
        while self.grid.count():
            self.grid.takeAt(0)
        fit = max(1, (max(320, self.scroll.viewport().width()) + 16) // 470)
        columns = min(self.columns.value(), fit)
        for index, account in enumerate(self.model.accounts[:20]):
            self.grid.addWidget(self.cards[account["id"]], index // columns, index % columns, Qt.AlignTop)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        QTimer.singleShot(0, self.reflow)

    def start(self):
        identifiers = self.model.selected_ids()
        review = ReviewDialog("Iniciar Blackjack automático", [("Contas", len(identifiers)), ("Aposta / teto por ronda", self.amount.value()), ("Motor", self.mode.currentText()), ("Progressão", self.progression.currentText())], ["O automático cria ou usa uma mesa e envia apostas e jogadas nas contas selecionadas.", "Ganhar uma ronda não comprova as hipóteses do cálculo."], self)
        if identifiers and review.exec() == QDialog.Accepted:
            self.model.call("blackjack:auto-start", [{"accountIds": identifiers, "amount": self.amount.value(), "mode": self.mode.currentData(), "progression": self.progression.currentData()}])

    def stop(self):
        self.model.call("blackjack:auto-stop")

    def on_hide(self):
        self.stop()

    def batch_bet(self):
        if self.progression.currentData() == "edge":
            self.model.notice.emit(t("Escolhe aposta fixa para apostar manualmente em lote."))
            return
        for identifier in self.model.selected_ids():
            card = self.cards.get(identifier)
            if card and card.game.currentData() == "blackjack":
                card.act("bet", {"bet": self.amount.value()})

    def show_local_ai(self, value):
        self.local_status.setText(t(value.get("message", value.get("phase", ""))))
        ready = value.get("phase") == "ready"
        for index in range(self.mode.count()):
            if self.mode.itemData(index) in ("compare", "hybrid", "laya"):
                item = self.mode.model().item(index)
                item.setEnabled(ready)

    def research(self):
        def show(value):
            self.history.set_records(value["rows"])
            payouts = value["payouts"]
            coverage = value["coverage"]
            self.research_status.setText(t("Blackjacks naturais") + ": " + str(payouts.get("naturals", 0)) + " · " + t("Pagamentos a 3:2") + ": " + str(payouts.get("exact", 0)) + "\n" + t("Decisões por composição") + ": " + str(coverage.get("computed", 0)) + " · " + t("Estratégia básica") + ": " + str(coverage.get("reference", 0)) + "\n" + t("A comparação offline tem intervalos que incluem zero e não demonstra superioridade.") + "\n" + t("As regras e o embaralhamento reais continuam por confirmar."))
        self.model.call("blackjack:research", done=show)

    def self_check(self):
        self.model.call("blackjack:self-check", done=self.checks.set_records)

    def show_round(self):
        value = self.history.current_record()
        if not value:
            return
        fields = [("Conta", value["accountId"]), ("Ronda", value["roundNumber"]), ("Dealer", cards_text(value.get("dealerCards", []))), ("Resultado", display(value.get("netProfit"))), ("Motivo", value.get("reason"))]
        steps = [t(MOVES.get(action.get("move"), action.get("action", ""))) + " · " + cards_text(action.get("cards", [])) + " · " + t("Motor") + ": " + str(action.get("decisionEngine", "manual")) for action in value.get("actions", [])]
        ReviewDialog("O que aconteceu em cada mão", fields, steps, self, confirm="Fechar").exec()
