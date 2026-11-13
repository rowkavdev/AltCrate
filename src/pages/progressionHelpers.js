import { getLocale } from "../language.js";
export const MAP_NAMES = [
  "Dust II",
  "Mirage",
  "Inferno",
  "Ancient",
  "Anubis",
  "Cobblestone",
];
export function createScopeGuard() {
  let scope = null,
    revision = 0;
  const requests = new Map();
  return {
    setScope(next) {
      if (next !== scope) {
        scope = next;
        revision++;
        requests.clear();
      }
    },
    invalidate() {
      revision++;
      requests.clear();
    },
    ticket(channel) {
      const sequence = (requests.get(channel) || 0) + 1;
      requests.set(channel, sequence);
      return { scope, revision, channel, sequence };
    },
    current(ticket) {
      return (
        ticket.scope === scope &&
        ticket.revision === revision &&
        requests.get(ticket.channel) === ticket.sequence
      );
    },
  };
}
export function skillIndex(data) {
  const owned = new Set((data.ownedIds || []).map(String)),
    byId = new Map(),
    ownedParents = new Set();
  for (const skill of data.map?.skills || []) {
    byId.set(String(skill.id), skill);
    if (owned.has(String(skill.id)) && skill.requiredPrevSkillId != null)
      ownedParents.add(String(skill.requiredPrevSkillId));
    if ((skill.nextSkillIds || []).some((id) => owned.has(String(id))))
      ownedParents.add(String(skill.id));
  }
  return { owned, byId, ownedParents };
}
export function skillAvailability(data, skill, index = skillIndex(data)) {
  const { owned, ownedParents } = index,
    isOwned = owned.has(String(skill.id));
  const dependency = skill.requiredPrevSkillId,
    hasDependency =
      dependency == null || dependency === 0 || owned.has(String(dependency));
  const rankId = Number(
      typeof data.rank === "object" ? data.rank?.id : data.rank,
    ),
    requiredRank = data.map?.requiredRankId,
    premierId = Number(
      typeof data.premierRank === "object"
        ? data.premierRank?.id
        : data.premierRank,
    ),
    requiredPremier = Number(data.map?.requiredPremierId || 0);
  const rankAllowed = data.map?.rankRequirementOptional === true || (
    data.rank != null &&
    Number.isFinite(rankId) &&
    requiredRank != null &&
    Number.isFinite(Number(requiredRank)) &&
    rankId >= Number(requiredRank));
  const premierAllowed =
    requiredPremier === 0 ||
    (data.premierRank != null &&
      Number.isFinite(premierId) &&
      premierId >= requiredPremier);
  const balancesKnown =
    typeof data.money === "number" &&
    Number.isFinite(data.money) &&
    typeof data.skillPoints === "number" &&
    Number.isFinite(data.skillPoints);
  const hasOwnedChildren = ownedParents.has(String(skill.id));
  const reason = isOwned
    ? hasOwnedChildren
      ? "Tem habilidades dependentes adquiridas."
      : ""
    : !rankAllowed
      ? "Rank insuficiente ou requisito indisponível."
      : !premierAllowed
        ? "Rank Premier insuficiente ou indisponível."
        : !balancesKnown
          ? "Saldo ou pontos indisponíveis."
          : !hasDependency
            ? "Adquire primeiro a habilidade anterior."
            : Number(data.skillPoints) < 1
              ? "Sem pontos disponíveis."
              : Number(data.money) < Number(skill.cost)
                ? "Dinheiro virtual insuficiente."
                : "";
  return {
    isOwned,
    canBuy: !isOwned && !reason,
    canSell: isOwned && !hasOwnedChildren,
    state: isOwned ? "Adquirida" : reason ? "Bloqueada" : "Disponível",
    reason,
  };
}
export function displayValue(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number")
    return Number.isFinite(value)
      ? value.toLocaleString(getLocale(), { maximumFractionDigits: 4 })
      : "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${displayValue(item)}`)
    .join(" · ");
}
export function observedAt(value) {
  if (!value) return "Sem observação";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Sem observação"
    : date.toLocaleString(getLocale());
}
export const DIAGNOSTIC_FIELDS = {
  money: "Dinheiro virtual",
  tokens: "Tokens",
  skillPoints: "Pontos de habilidade",
  inventoryCount: "Itens no inventário",
  stockCount: "Caixas em stock",
  caseCount: "Caixas em stock",
  boxCount: "Caixas em stock",
  clickCount: "Cliques",
  rankId: "Rank",
  inventoryCapacity: "Capacidade do inventário",
  vaultMoney: "Dinheiro no cofre",
  rank: "Rank",
  casesTotal: "Caixas em stock",
  caseKinds: "Tipos de caixa",
  casesWithStock: "Tipos com stock",
  moneyPerClick: "Dinheiro por clique",
  casesPerClick: "Caixas por clique",
  caseOpenCount: "Caixas abertas",
  maxCaseOpenMultiplier: "Multiplicador máximo de abertura",
  vaultCapacity: "Capacidade do cofre",
  vaultMoneyPerMinute: "Geração do cofre por minuto",
  eventTickets: "Bilhetes de evento",
  dailyTradesLeft: "Trocas restantes hoje",
};
export function createScopedActions() {
  const guard = createScopeGuard(),
    active = new Map();
  let scope;
  return {
    setScope(next) {
      if (next !== scope) {
        scope = next;
        guard.setScope(next);
        active.clear();
      }
    },
    invalidate() {
      guard.invalidate();
      active.clear();
    },
    async run(channel, work, { onStart, onSuccess, onError, onEnd } = {}) {
      if (active.has(channel)) return;
      const ticket = guard.ticket(channel);
      active.set(channel, ticket);
      onStart?.();
      try {
        const value = await work();
        if (guard.current(ticket)) {
          active.delete(channel);
          onEnd?.();
          onSuccess?.(value);
          return value;
        }
      } catch (error) {
        if (guard.current(ticket)) {
          active.delete(channel);
          onEnd?.();
          onError?.(error);
        }
      } finally {
        if (active.get(channel) === ticket) active.delete(channel);
      }
    },
  };
}
export const AUTOOPEN_LABELS = {
  favoriteLowFloats: "Marcar floats baixos como favoritos",
  favoriteHighFloats: "Marcar floats altos como favoritos",
  favoriteCustomFloats: "Marcar floats personalizados como favoritos",
  favoritePatterns: "Marcar padrões como favoritos",
  autosellActivated: "Ativar venda automática no site",
  autosellAmount: "Vender itens abaixo de",
  autosellVariant: "Receber venda em",
  customLowFloat: "Float personalizado mínimo",
  customHighFloat: "Float personalizado máximo",
  customSelectedFloats: "Floats personalizados",
  patternBlacklist: "Padrões excluídos",
  activePresetId: "Preset ativo",
};
export function previewStepLabel(step) {
  if (typeof step !== "object") return displayValue(step);
  const names = {
    "skill-buy": "Comprar habilidade",
    "skill-sell": "Vender habilidade",
    reward: "Recolher recompensa",
    mission: "Recolher missão",
    pass: "Recolher recompensa do passe",
    autoopen: "Guardar preferências de abertura",
  };
  return `${names[step.kind] || "Alteração revista"}${step.name ? " · " + step.name : ""}${step.mapName ? " · " + step.mapName : ""}${step.cost != null ? " · custo: " + displayValue(step.cost) : ""}${step.refund != null ? " · reembolso: " + displayValue(step.refund) : ""}`;
}
