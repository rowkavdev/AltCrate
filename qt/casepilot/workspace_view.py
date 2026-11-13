"""Read-only presentation rules matching the Electron workspace."""
import math
import time


def farm_state(entry, status, now):
    if entry.get("needsLogin"):
        return "login"
    if entry.get("paused") and entry.get("networkRetryAt", 0) > 0:
        return "waiting"
    if entry.get("paused"):
        return "paused"
    if status.get("phase") in ("running", "stopping") and entry.get("inFlight"):
        return "active"
    modes = entry.get("modes") or {}
    if status.get("phase") != "running" or not entry.get("selected") or not any(modes.values()):
        return "ready"
    if entry.get("retryAt", 0) > now:
        return "waiting"
    budget = entry.get("budget", status.get("budget"))
    values = budget or {}
    if max(values.get("cooldownUntil", 0), (status.get("budget") or {}).get("cooldownUntil", 0)) > now:
        return "waiting"
    both = modes.get("case") and modes.get("money")
    def available(key, limit, other):
        observed = values.get(key + "ClicksAvailable")
        if isinstance(observed, (int, float)) and math.isfinite(observed):
            return observed > 0
        return budget is None or values.get(key + "Used", 0) < limit and (not (both or values.get(other + "Used", 0) > 0) or values.get("combinedRemaining", 0) > 0)
    case = modes.get("case") and entry.get("caseNextAt", 0) <= now and available("case", 950 if both else 2400, "money")
    money = modes.get("money") and available("money", 950 if both else 1900, "case")
    vault = modes.get("vault") and entry.get("vaultNextAt", 0) <= now
    return "queued" if case or money or vault else "waiting"


def farm_summary(status):
    summary = dict.fromkeys(("active", "queued", "waiting", "paused", "login", "ready"), 0)
    now = time.time() * 1000
    for entry in status.get("accounts", []):
        summary[farm_state(entry, status, now)] += 1
    return summary


def case_awards(events, accounts, snapshots):
    names = {item["id"]: item.get("name", item["id"]) for snapshot in snapshots.values() for item in snapshot.get("cases", [])}
    labels = {account["id"]: account["label"] for account in accounts}
    groups = {}
    for event in events:
        count = event.get("awardedCount")
        if event.get("type") != "request" or event.get("kind") != "case" or not 200 <= (event.get("httpStatus") or 0) < 300:
            continue
        if not isinstance(count, (int, float)) or not math.isfinite(count) or count <= 0:
            continue
        identifier = event.get("caseId") or event.get("caseName") or "unknown"
        key = (event.get("accountId"), identifier)
        group = groups.setdefault(key, {"name": event.get("caseName") or names.get(identifier, "Caixas sem tipo identificado"), "account": labels.get(key[0], "Conta removida"), "count": 0, "unverified": 0, "at": ""})
        group["count"] += count
        group["unverified"] += event.get("verifiedDelta", False) is None
        group["at"] = max(group["at"], event.get("at") or "")
    return sorted(groups.values(), key=lambda item: item["at"], reverse=True)
