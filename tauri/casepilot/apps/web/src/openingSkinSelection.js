import {
  canonicalSkinName,
  draftRule,
  normalizeOpeningRule,
  validateRuleSet,
} from "./openingRulesViewModel.js"
const searchText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]/g, "")
const quotedSelection = (value) =>
  typeof value === "string" &&
  /\s+'[^\r\n]+'(?:\s*\([^()]*\))?$/.test(value) &&
  !value.includes("::")
export function normalizeSelectedSkinNames(names, options) {
  const catalog = new Map(
    prepareSkinOptions(options).map((item) => [
      canonicalSkinName(item.key),
      item.key,
    ])
  )
  return [
    ...new Set(
      names
        .map((name) =>
          quotedSelection(name) ? null : catalog.get(canonicalSkinName(name))
        )
        .filter(Boolean)
    ),
  ]
}
export function prepareSkinOptions(skins) {
  const result = new Map()
  for (const item of skins.filter((s) => s?.name)) {
    const base = canonicalSkinName(item.name).split(" | ")[0]
    const category =
      item.weaponClass === "Gloves" || /gloves|hand wraps/.test(base)
        ? "gloves"
        : item.weaponClass === "Knife" ||
            /knife|bayonet|karambit|daggers/.test(base)
          ? "knives"
          : "weapons"
    const add = (option) =>
      result.set(canonicalSkinName(option.key), {
        ...option,
        category,
        search: searchText(option.label),
      })
    add({ ...item, key: item.name, label: item.name })
    for (const variant of (item.variants || []).slice(0, 100))
      if (
        /^[a-f0-9]{24}$/i.test(variant?.id) &&
        typeof variant.name === "string"
      )
        add({
          ...item,
          key: item.name + "::" + variant.id,
          label: item.name + " · " + variant.name,
          image: variant.image || item.image,
          variant,
        })
  }
  return [...result.values()]
}
export function skinSelectionPage(
  options,
  {
    query = "",
    category = "all",
    selectedOnly = false,
    selectedNames = [],
    page = 1,
    pageSize = 12,
  } = {}
) {
  const selected = new Set(selectedNames.map(canonicalSkinName)),
    tokens = query.trim().split(/\s+/).map(searchText).filter(Boolean)
  const filtered = options.filter(
    (item) =>
      (category === "all" || item.category === category) &&
      (!selectedOnly || selected.has(canonicalSkinName(item.key))) &&
      tokens.every((token) => item.search.includes(token))
  )
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    current = Math.max(
      1,
      Math.min(pages, Number.isSafeInteger(page) ? page : 1)
    )
  return {
    items: filtered.slice((current - 1) * pageSize, current * pageSize),
    matchingNames: filtered.map((s) => s.key),
    total: filtered.length,
    pages,
    page: current,
  }
}
export function prepareSkinRuleBatch(
  rules,
  index,
  draft,
  names,
  skins,
  groupIndices = index === null ? [] : [index]
) {
  const unique = [
    ...new Map(
      names
        .filter((n) => typeof n === "string")
        .map((name) => [canonicalSkinName(name), name])
    ).values(),
  ]
  if (!unique.length)
    return {
      valid: false,
      errors: [{ message: "Seleciona pelo menos uma skin." }],
      nextRules: null,
      candidates: [],
    }
  const options = new Map(
    prepareSkinOptions(skins).map((item) => [canonicalSkinName(item.key), item])
  )
  if (
    unique.some(
      (key) => quotedSelection(key) || !options.has(canonicalSkinName(key))
    )
  )
    return {
      valid: false,
      errors: [
        { message: "A skin ou variante não consta do catálogo desta caixa." },
      ],
      nextRules: null,
      candidates: [],
    }
  const base = draftRule(draft),
    candidates = unique.map((key, i) => {
      const option = options.get(canonicalSkinName(key))
      const value = { ...base, name: option.name }
      if (option.variant) {
        value.selectionVariant = {
          id: option.variant.id,
          name: option.variant.name,
          image: option.variant.image,
        }
        const c = value.conditions
        if (
          c === undefined ||
          (c && typeof c === "object" && !Array.isArray(c))
        ) {
          if (c?.patterns === undefined)
            value.conditions = { ...c, patterns: [option.variant.id] }
          else if (
            Array.isArray(c.patterns) &&
            c.patterns.length &&
            c.patterns.every(
              (pattern) => typeof pattern === "string" && pattern.trim()
            )
          )
            value.conditions = {
              ...c,
              patterns: c.patterns.includes(option.variant.id)
                ? [option.variant.id]
                : [],
            }
        }
      }
      if (i > 0) delete value.id
      return value
    })
  const removed = new Set(groupIndices)
  const remaining = rules.filter((_, i) => !removed.has(i))
  const errors = validateRuleSet(
    [...remaining, ...candidates],
    skins
  ).errors.filter((error) => error.index < 0 || error.index >= remaining.length)
  if (errors.length)
    return { valid: false, errors, nextRules: null, candidates }
  const normalized = candidates.map((candidate) => {
    const rule = normalizeOpeningRule(candidate)
    for (const key of ["accountLabel", "storageName", "selectionVariant"])
      if (candidate[key] !== undefined) rule[key] = candidate[key]
    return rule
  })
  const at = index === null ? rules.length : index
  return {
    valid: true,
    errors: [],
    candidates: normalized,
    nextRules: [
      ...rules.slice(0, at),
      ...normalized,
      ...rules.slice(at).filter((_, i) => !removed.has(at + i)),
    ],
  }
}
