import converterSteps from "../../../../shared/converter-steps.json" with { type: "json" }
export { converterSteps }
export function converterStepSelection({
  steps,
  legacyAction = "consolidate",
} = {}) {
  const legacy = {
    consolidate: ["convert-inventory", "mint", "transfer", "convert-received"],
    full: ["sell", "buy", "open", "convert-stickers", "transfer"],
    sell: ["sell"],
    buy: ["buy"],
    open: ["open", "convert-stickers"],
    trade: ["transfer"],
  }
  const selected = new Set(
      Array.isArray(steps) ? steps : legacy[legacyAction] || legacy.consolidate
    ),
    ordered = converterSteps.filter((s) => selected.has(s.id)).map((s) => s.id)
  return {
    steps: ordered,
    count: ordered.length,
    needsDestination: ordered.some((id) =>
      ["transfer", "convert-received"].includes(id)
    ),
  }
}
export const converterSequenceScope = ({
  sourceIds,
  destinationAccountId,
  steps,
  routing,
  resumeOperationIds = [],
  repeatOperationIds = [],
}) =>
  JSON.stringify([
    sourceIds,
    destinationAccountId || null,
    steps,
    routing,
    resumeOperationIds,
    repeatOperationIds,
  ])
const fold = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
function observedMembership(snapshot) {
  if (!snapshot?.observedAt || !Number.isFinite(Date.parse(snapshot.observedAt)))
    return "unknown"
  return snapshot.membership === "pro"
    ? "pro"
    : ["basic", "free"].includes(snapshot.membership)
      ? "free"
      : "unknown"
}
export function converterMembership(snapshot, now = Date.now()) {
  if (
    !snapshot ||
    snapshot.error ||
    snapshot.refreshError ||
    !snapshot.observedAt ||
    !Number.isFinite(Date.parse(snapshot.observedAt)) ||
    now - Date.parse(snapshot.observedAt) > 300000
  )
    return "unknown"
  return observedMembership(snapshot)
}
export function converterViewModel({
  accounts = [],
  snapshots = {},
  selectedIds = [],
  destinationAccountId,
  transfer = true,
  query = "",
  membershipFilter = "all",
  page = 1,
  pageSize = 10,
  now = Date.now(),
}) {
  const selected = new Set(selectedIds),
    needle = fold(query),
    sourceIds = [],
    totals = { selected: 0, pro: 0, free: 0, unknown: 0, tokens: 0 },
    filtered = []
  for (const account of accounts) {
    if (transfer && account.id === destinationAccountId) continue
    const snapshot = snapshots[account.id],
      membership = converterMembership(snapshot, now),
      isSelected = selected.has(account.id)
    if (isSelected) {
      sourceIds.push(account.id)
      totals.selected++
      totals[membership]++
      if (Number.isFinite(snapshot?.tokens) && snapshot.tokens >= 0)
        totals.tokens += snapshot.tokens
    }
    if (
      (membershipFilter === "all" || membershipFilter === membership) &&
      (!needle || fold(account.label).includes(needle))
    )
      filtered.push({
        ...account,
        membership,
        observedMembership: observedMembership(snapshot),
        membershipStale: membership === "unknown" && observedMembership(snapshot) !== "unknown",
        selected: isSelected,
        tokens: Number.isFinite(snapshot?.tokens) ? snapshot.tokens : null,
        inventoryCount: Number.isSafeInteger(snapshot?.inventoryCount)
          ? snapshot.inventoryCount
          : null,
        route:
          membership === "pro"
            ? "tokens"
            : membership === "free"
              ? "skins"
              : "unknown",
      })
  }
  const size = [10, 20, 50].includes(pageSize) ? pageSize : 10,
    pages = Math.max(1, Math.ceil(filtered.length / size)),
    current = Math.max(
      1,
      Math.min(Number.isSafeInteger(page) ? page : 1, pages)
    )
  return {
    rows: filtered.slice((current - 1) * size, current * size),
    filteredIds: filtered.map((row) => row.id),
    filteredCount: filtered.length,
    sourceIds,
    totals,
    page: current,
    pages,
    pageSize: size,
  }
}

export function previousConverterSelection(status = {}) {
  const previous =
    status.lastSelection ||
    (status.rows || []).reduce(
      (latest, row) =>
        (row.selectedSteps?.length || row.steps?.length) &&
        (!latest ||
          String(row.updatedAt || "") > String(latest.updatedAt || ""))
          ? row
          : latest,
      null
    )
  if (!previous) return null
  const steps = converterStepSelection({
    steps: previous.selectedSteps || previous.steps,
  }).steps
  return steps.length
    ? {
        steps,
        routing: previous.routing || "selected",
        destinationAccountId: previous.destinationAccountId || "",
        accountIds: [
          ...new Set(
            (Array.isArray(previous.accountIds)
              ? previous.accountIds
              : (status.rows || []).map((row) => row.accountId)
            ).filter((id) => typeof id === "string" && id)
          ),
        ],
      }
    : null
}

export function converterGuidance({
  status = {},
  independent = false,
  steps = [],
  sourceIds = [],
  resumeIds = [],
  repeatIds = [],
  needsDestination,
  destination,
  busy,
  running,
  pending,
  now = Date.now(),
} = {}) {
  const selected = new Set(sourceIds),
    rows = status.rows || [],
    issues = []
  const continuable = rows.filter(
    (row) =>
      selected.has(row.accountId) &&
      row.canReviewNext &&
      row.state !== "unconfirmed"
  )
  const add = (code, message, actions = []) =>
    issues.push({ code, message, actions })
  if (running || pending || busy)
    add(
      "busy",
      running
        ? "Há uma operação em curso. Aguarda ou para-a antes de preparar outra."
        : "Aguarda a leitura ou operação atual."
    )
  if (status.retryAt > now)
    add(
      "rate-limit",
      "O site limitou os pedidos. Os resultados estão guardados até poderes voltar a verificar."
    )
  if (!steps.length)
    add("no-steps", "Escolhe pelo menos uma etapa para iniciar.", ["steps"])
  if (!sourceIds.length)
    add("no-accounts", "Seleciona as contas que queres usar.", [
      "select-accounts",
    ])
  if (needsDestination && !destination)
    add(
      "no-main",
      "Escolhe a conta principal para receber os tokens ou skins.",
      ["main"]
    )
  const modeIds = [...resumeIds, ...repeatIds],
    byOperation = new Map(rows.map((row) => [row.operationId, row]))
  if (
    modeIds.length &&
    (modeIds.length !== sourceIds.length ||
      modeIds.some((id) => !selected.has(byOperation.get(id)?.accountId)))
  )
    add(
      "mode-scope",
      "A seleção de contas mudou. Sai da continuação ou repetição antes de preparar outras contas.",
      ["reset-mode"]
    )
  const locked = new Set(
      rows
        .filter(
          (row) =>
            (row.state === "unconfirmed" || (row.state === "unresolved" && row.lockedAccountIds?.length > 0)) &&
            !(
              independent &&
              !resumeIds.length &&
              steps.length &&
              steps.every((step) => row.allowedIndependentSteps?.includes(step))
            )
        )
        .flatMap(
          (row) =>
            row.lockedAccountIds ||
            [row.accountId, row.destinationAccountId].filter(Boolean)
        )
    ),
    eligibleSourceIds = sourceIds
  if (independent && !resumeIds.length) {
    const affected = sourceIds.filter((id) => locked.has(id)).length,
      mainLocked = needsDestination && destination && locked.has(destination.id)
    if (affected || mainLocked)
      issues.push({
        code: "unconfirmed",
        blocking: true,
        message: mainLocked
          ? "A conta principal tem um resultado por confirmar. Verifica-o ou escolhe outra principal."
          : "Há contas selecionadas com operações por confirmar. Resolve a pendência para iniciarem todas nas etapas escolhidas. Nenhuma conta foi excluída.",
        actions: ["verify"],
        affectedCount: affected,
      })
  } else if (!resumeIds.length && !repeatIds.length) {
    if (rows.some((row) => row.state === "unconfirmed"))
      add(
        "unconfirmed",
        "Há resultados por confirmar. Verifica-os ou continua apenas as outras contas com itens guardados.",
        ["verify", ...(continuable.length ? ["continue"] : [])]
      )
    else if (
      rows.some(
        (row) =>
          row.pendingStickers ||
          row.pendingItems ||
          row.handoffCounts?.source ||
          row.handoffCounts?.destination
      )
    )
      add(
        "saved-items",
        "Há itens guardados da execução anterior. Continua-os antes de repetir numa nova execução.",
        continuable.length ? ["continue"] : []
      )
  }
  return { issues, continuable, eligibleSourceIds }
}
