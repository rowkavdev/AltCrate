const ID = /^[a-f0-9]{24}$/i
const WEAR =
  /\s*\((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i

export function canonicalSkinName(value) {
  return String(value || "")
    .trim()
    .replace(/^★\s*/, "")
    .replace(/^(?:StatTrak™\s*|Souvenir\s*)+/i, "")
    .replace(WEAR, "")
    .trim()
    .replace(/\s+'[^\r\n]+'$/, "")
    .trim()
    .toLocaleLowerCase("en-US")
}

const CONDITION_KEYS = [
  "floatMin",
  "floatMax",
  "patterns",
  "statTrak",
  "souvenir",
  "eventName",
  "topN",
]
export function normalizeOpeningRule(rule) {
  const name = typeof rule?.name === "string" ? rule.name.trim() : ""
  if (
    /\s+'[^\r\n]+'$/.test(name.replace(WEAR, "").trim()) &&
    !rule?.conditions?.patterns?.length
  )
    throw Error(
      "Escolhe a variante no catálogo para preservar o padrão da regra"
    )
  if (
    !name ||
    name.length > 130 ||
    /[\x00-\x1f]/.test(name) ||
    !["sell", "keep", "storage"].includes(rule?.action)
  )
    throw Error("Regra de item inválida")
  const result = { name, action: rule.action }
  if (rule.id !== undefined) {
    if (typeof rule.id !== "string" || !rule.id || rule.id.length > 80)
      throw Error("Identificador de regra inválido")
    result.id = rule.id
  }
  if (rule.conditions !== undefined) {
    const c = rule.conditions
    if (
      !c ||
      typeof c !== "object" ||
      Array.isArray(c) ||
      Object.keys(c).some((key) => !CONDITION_KEYS.includes(key))
    )
      throw Error("Atributos de regra inválidos")
    const conditions = {}
    for (const key of ["floatMin", "floatMax"])
      if (c[key] !== undefined) {
        if (!Number.isFinite(c[key]) || c[key] < 0 || c[key] > 1)
          throw Error("Limite de float inválido")
        conditions[key] = c[key]
      }
    if (
      conditions.floatMin !== undefined &&
      conditions.floatMax !== undefined &&
      conditions.floatMin > conditions.floatMax
    )
      throw Error("Intervalo de float inválido")
    if (c.patterns !== undefined) {
      if (
        !Array.isArray(c.patterns) ||
        !c.patterns.length ||
        c.patterns.length > 100 ||
        c.patterns.some(
          (value) =>
            typeof value !== "string" ||
            !value.trim() ||
            value.length > 40 ||
            /[\x00-\x1f]/.test(value)
        )
      )
        throw Error("Padrões inválidos")
      conditions.patterns = [
        ...new Set(c.patterns.map((value) => value.trim())),
      ].sort()
    }
    for (const key of ["statTrak", "souvenir"])
      if (c[key] !== undefined) {
        if (typeof c[key] !== "boolean") throw Error("Variante inválida")
        conditions[key] = c[key]
      }
    if (c.eventName !== undefined) {
      if (
        typeof c.eventName !== "string" ||
        !c.eventName.trim() ||
        c.eventName.length > 130 ||
        /[\x00-\x1f]/.test(c.eventName)
      )
        throw Error("Evento inválido")
      conditions.eventName = c.eventName.trim()
    }
    if (c.topN !== undefined) {
      if (!Number.isSafeInteger(c.topN) || c.topN < 1 || c.topN > 10000000)
        throw Error("Top N inválido")
      conditions.topN = c.topN
    }
    if (Object.keys(conditions).length) result.conditions = conditions
  }
  if (rule.action === "storage") {
    if (
      typeof rule.destinationAccountId !== "string" ||
      !rule.destinationAccountId ||
      rule.destinationAccountId.length > 180 ||
      !ID.test(rule.storageUnitId)
    )
      throw Error("Seleciona um storage válido")
    result.destinationAccountId = rule.destinationAccountId
    result.storageUnitId = rule.storageUnitId
  }
  return result
}

// Browser validation mirrors the policy; parity tests keep the two contracts aligned.
export function validateRuleSet(input, skins = []) {
  if (!Array.isArray(input) || input.length > 500)
    return {
      valid: false,
      errors: [{ index: -1, message: "Regras de abertura inválidas" }],
      rules: [],
    }
  const names = new Set(
    skins
      .flatMap((item) =>
        item.specialItems?.length ? item.specialItems : [item]
      )
      .map((item) => canonicalSkinName(item?.name))
      .filter(Boolean)
  )
  const seen = new Set(),
    ids = new Set(),
    errors = [],
    rules = []
  input.forEach((value, index) => {
    try {
      const rule = normalizeOpeningRule(value)
      const key = canonicalSkinName(rule.name),
        signature = key + JSON.stringify(rule.conditions || {})
      if (seen.has(signature) || (rule.id && ids.has(rule.id)))
        throw Error("Regra duplicada para a mesma skin e atributos")
      seen.add(signature)
      if (rule.id) ids.add(rule.id)
      if (!names.has(key)) throw Error("A skin não consta do catálogo da caixa")
      rules.push(rule)
    } catch (error) {
      errors.push({ index, message: error.message })
    }
  })
  return { valid: errors.length === 0, errors, rules }
}

export function ruleDraft(source) {
  const rule = source && typeof source === "object" ? source : {}
  const c = rule.conditions || {}
  const fields = {
    floatMin: c.floatMin ?? "",
    floatMax: c.floatMax ?? "",
    patterns: Array.isArray(c.patterns) ? c.patterns.join(", ") : "",
    statTrak: c.statTrak === undefined ? "any" : String(c.statTrak),
    souvenir: c.souvenir === undefined ? "any" : String(c.souvenir),
    eventName: String(c.eventName ?? ""),
    topN: c.topN ?? "",
  }
  return { ...rule, ...fields, initialFields: fields, editedFields: [] }
}

export function patchRuleDraft(draft, changes) {
  return {
    ...draft,
    ...changes,
    editedFields: [
      ...new Set([...draft.editedFields, ...Object.keys(changes)]),
    ],
  }
}

export function validateRuleCandidate(rules, index, candidate, skins) {
  // Put the candidate last for duplicate detection, even when editing an earlier rule.
  const others = rules.filter((_, i) => i !== index)
  return validateRuleSet([...others, candidate], skins).errors.filter(
    (error) => error.index === others.length || error.index === -1
  )
}
export function draftRule(draft) {
  const result = { id: draft.id, name: draft.name, action: draft.action },
    conditions = { ...draft.conditions }
  // Preserve unrecognised constraints so an edit cannot broaden a rejected rule.
  for (const key of CONDITION_KEYS) delete conditions[key]
  for (const key of ["floatMin", "floatMax"])
    if (String(draft[key]).trim() !== "") conditions[key] = Number(draft[key])
  if (draft.patterns.trim())
    conditions.patterns = draft.patterns.split(",").map((value) => value.trim())
  for (const key of ["statTrak", "souvenir"])
    if (draft[key] !== "any")
      conditions[key] = ["true", "false"].includes(draft[key])
        ? draft[key] === "true"
        : draft[key]
  if (draft.eventName.trim()) conditions.eventName = draft.eventName.trim()
  if (String(draft.topN).trim() !== "") conditions.topN = Number(draft.topN)
  for (const key of CONDITION_KEYS) {
    if (
      Object.hasOwn(draft.conditions || {}, key) &&
      !draft.editedFields.includes(key) &&
      draft[key] === draft.initialFields[key]
    )
      conditions[key] = draft.conditions[key]
  }
  if (Object.keys(conditions).length) result.conditions = conditions
  if (
    draft.conditions !== undefined &&
    (!draft.conditions ||
      typeof draft.conditions !== "object" ||
      Array.isArray(draft.conditions)) &&
    !draft.editedFields.some((key) => CONDITION_KEYS.includes(key))
  )
    result.conditions = draft.conditions
  if (draft.action === "storage")
    for (const key of [
      "destinationAccountId",
      "storageUnitId",
      "accountLabel",
      "storageName",
    ])
      if (draft[key] !== undefined) result[key] = draft[key]
  return result
}
export function moveRule(rules, index, offset) {
  const next = [...rules],
    target = index + offset
  if (target < 0 || target >= next.length || index < 0 || index >= next.length)
    return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
export function replaceRule(rules, index, rule) {
  return index === null
    ? [...rules, rule]
    : rules.map((value, i) => (i === index ? rule : value))
}
export function conditionSummary(
  conditions = {},
  translate = (value) => value
) {
  if (!conditions || typeof conditions !== "object") conditions = {}
  const parts = []
  if (conditions.floatMin !== undefined || conditions.floatMax !== undefined)
    parts.push(
      "Float " + (conditions.floatMin ?? 0) + "–" + (conditions.floatMax ?? 1)
    )
  if (Array.isArray(conditions.patterns))
    parts.push(translate("Padrões") + ": " + conditions.patterns.join(", "))
  for (const [key, label] of [
    ["statTrak", "StatTrak"],
    ["souvenir", "Souvenir"],
  ])
    if (conditions[key] !== undefined)
      parts.push(label + ": " + translate(conditions[key] ? "Sim" : "Não"))
  if (conditions.eventName !== undefined)
    parts.push(translate("Evento") + ": " + conditions.eventName)
  if (conditions.topN !== undefined)
    parts.push("Top " + conditions.topN + " · Overall")
  return parts.length ? parts.join(" · ") : translate("Qualquer variante")
}
