"""Synthetic controller responses for native UI tests; never contacts the game."""
from copy import deepcopy
from PySide6.QtCore import QObject, Signal, QTimer

CASE_ID = "a" * 24
ITEM_ID = "b" * 24
STORAGE_ID = "c" * 24
ACCOUNTS = [{"id": "alpha", "label": "Principal", "partition": "persist:caseclicker-alpha", "email": "fixture-alpha@example.invalid"},
            {"id": "beta", "label": "Storage", "partition": "persist:caseclicker-beta", "email": "fixture-beta@example.invalid"}]
CONFIG = {"favoriteLowFloats": True, "favoriteHighFloats": False, "favoriteCustomFloats": False, "favoritePatterns": False, "autosellActivated": False,
          "autosellAmount": 5, "autosellVariant": "tokens", "customLowFloat": 0.01, "customHighFloat": 0.5, "customSelectedFloats": [], "patternBlacklist": []}


class FixtureBridge(QObject):
    ready = Signal(list)
    event = Signal(dict)
    failed = Signal(str)
    def __init__(self):
        super().__init__()
        self.calls = []
        self.held = []
        self.deferred = set()
        self.responses = {}
        self.channels = []
        self.initialized = True

    def invoke(self, channel, args=None, done=None, error=None):
        args = args or []
        self.calls.append((channel, deepcopy(args)))
        identifier = str(len(self.calls))
        if channel in self.deferred:
            self.held.append((channel, args, done, error))
        else:
            value = self.response(channel, args)
            QTimer.singleShot(0, lambda: done(deepcopy(value)))
        return identifier

    def response(self, channel, args):
        if channel in self.responses:
            response = self.responses[channel]
            return response(args) if callable(response) else deepcopy(response)
        account = args[0] if args and isinstance(args[0], str) else "alpha"
        if channel == "accounts:list":
            return ACCOUNTS
        if channel == "accounts:refresh":
            return {"money": 1000, "tokens": 120, "casesTotal": 10, "cases": [{"id": CASE_ID, "name": "Revolver Case", "amount": 10}]}
        if channel == "workspace:read":
            return {"version": 1, "groups": [{"id": "main", "name": "Principal"}], "accountGroups": {"alpha": "main"}, "profiles": []}
        if channel == "preferences:read":
            return {"enableSiteOpening": True}
        if channel == "preferences:update":
            return args[0]
        if channel in ("farm:status", "farm:start", "farm:modes"):
            return {"phase": "running" if channel == "farm:start" else "idle", "accounts": [{"id": value["id"], "label": value["label"], "modes": {"case": True, "money": True, "vault": True}} for value in ACCOUNTS], "budget": {}, "execution": {"kind": "local"}}
        if channel in ("open:status", "open:start", "converter:status", "accounts:login-status", "progression-batch:status", "blackjack:qt-status"):
            return {"phase": "idle", "rows": []}
        if channel in ("inventory-action:list", "inventory-batch:list", "storage-management:list", "progression-batch:list", "extensions:capabilities", "blackjack:history"):
            return []
        if channel == "local-ai:status":
            return {"phase": "missing", "message": "Modelo de teste indisponível"}
        if channel == "requests:metrics":
            return {"pending": 0, "active": 0}
        if channel == "farm:server-config":
            return {"enabled": False}
        if channel == "progression:status":
            return {"state": "idle"}
        if channel == "progression:rewards":
            return {"tracks": [{"id": 1, "title": account + " · Cliques", "description": "+10 tokens", "eligible": True, "complete": False, "current": 100, "target": 100}]}
        if channel == "progression:missions":
            return {"missions": [{"id": "mission-1", "title": "Jogar Blackjack", "eligible": True, "current": 10, "target": 10, "redeemed": False, "duration": "day", "validTill": "2099-10-14T23:00:00Z"}], "pass": {"points": 10, "endsAt": "2099-10-31T23:00:00Z", "track": [{"tier": 1, "freeReward": "+10 tokens", "premiumReward": "+20 tokens"}]}}
        if channel == "progression:skills":
            return {"money": 1000, "skillPoints": 2, "rank": 10, "ownedIds": [], "map": {"name": args[1], "skills": [
                {"id": "a1", "name": "Primeira skill", "cost": 100, "owned": False, "available": True, "effects": [{"description": "Dinheiro por clique", "amount": 0.1}], "requiredPrevSkillId": None, "waypointX": 5, "waypointY": 10},
                {"id": "a2", "name": "Segunda skill", "cost": 200, "owned": False, "available": False, "effects": [], "requiredPrevSkillId": "a1", "waypointX": 20, "waypointY": 40}]}}
        if channel == "progression:presets":
            return {"presets": [{"id": "case", "name": "Caixas", "goal": "Geração de caixas", "description": "Fixture", "summary": {"totalCost": 100, "totalPoints": 1, "missingCost": 100, "missingPoints": 1}}]}
        if channel == "progression:autoopen":
            return {"config": CONFIG, "activePresetId": None, "presets": [{"id": "preset-1", "name": "Guardado", "config": CONFIG}]}
        if channel == "progression:diagnostics":
            return {"before": {"money": 100, "tokens": 1}, "after": {"money": 105, "tokens": 2}, "changes": [{"field": "money", "before": 100, "after": 105}]}
        if channel == "storage:list":
            return [{"id": STORAGE_ID, "name": "Arquivo", "count": 1, "index": 0}]
        if channel in ("inventory:read", "storage:read"):
            page = args[2] if channel == "storage:read" else args[1]
            return {"pages": 3, "count": 3, "skins": [{"id": ITEM_ID if page == 1 else str(page) * 24, "name": f"Skin {account} {page}", "price": 5, "float": 0.01, "patternId": "42", "isFavorite": False, "image": None, "stickers": []}]}
        if channel == "inventory:summary":
            return {"value": 100, "floatCoverage": {"percent": 50}, "events": [{"label": "Evento", "value": "Atlanta 2017"}], "errors": []}
        if channel in ("ranking:read", "ranking:refresh"):
            return {"items": [{"itemId": identifier, "state": "fresh", "rank": 10, "observedAt": 1791993000000, "sourceUpdatedAt": 1791993000000} for identifier in args[0]["itemIds"]]}
        if channel == "cases:showcase":
            return [{"id": CASE_ID, "name": "Revolver Case"}]
        if channel == "cases:details":
            return {"id": CASE_ID, "items": [{"name": "AK-47 | Case Hardened"}]}
        if channel == "history:query":
            return {"rows": [{"id": "history-1", "type": "progression", "kind": "skill-preset", "at": "2026-10-14T12:00:00Z", "accountId": "alpha", "result": "confirmed"}], "total": 1}
        if channel == "games:load":
            return {"tokens": 120, "money": 1000, "supported": True, "availability": {"disabled": False, "remaining": 10, "limitKnown": True}, "socket": {"connected": True, "events": {}}}
        if channel == "blackjack:research":
            return {"rows": [], "payouts": {}, "coverage": {}, "simulation": {}, "engine": {"rows": []}}
        if channel == "blackjack:self-check":
            return [{"name": "Fixture", "passed": True, "latencyMs": 1}]
        if channel == "progression:prepare":
            return {"previewId": "preview-1", "title": "Rever alteração", "steps": [{"kind": args[1]}], "cost": 0}
        if channel == "progression:confirm":
            return {"operationId": "operation-1", "state": "completed", "verified": True, "message": "Confirmada", "completed": 1, "total": 1}
        return None
