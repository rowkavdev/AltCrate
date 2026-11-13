import {
  canonicalSkinName,
  normalizeOpeningRule,
} from "./openingRulesViewModel.js"
export function ruleSelectionKey(rule) {
  return rule?.selectionVariant?.id
    ? `${rule.name}::${rule.selectionVariant.id}`
    : rule?.name || ""
}
export function sharedRuleDraftSource(rule) {
  if (!rule || typeof rule !== "object") return rule
  const source = { ...rule }
  if (
    rule.selectionVariant?.id &&
    rule.conditions?.patterns?.length === 1 &&
    rule.conditions.patterns[0] === rule.selectionVariant.id
  ) {
    const { patterns: _patterns, ...conditions } = rule.conditions
    if (Object.keys(conditions).length) source.conditions = conditions
    else delete source.conditions
  }
  return source
}
function signature(rule) {
  try {
    const normalized = normalizeOpeningRule(sharedRuleDraftSource(rule))
    const { name: _name, id: _id, ...config } = normalized
    return JSON.stringify([rule.groupId || null, config])
  } catch {
    return null
  }
}
export function groupOpeningRules(rules) {
  const groups = []
  rules.forEach((rule, index) => {
    const key = signature(rule),
      prior = groups.at(-1),
      selection = canonicalSkinName(ruleSelectionKey(rule))
    if (key && prior?.signature === key && !prior.selections.has(selection)) {
      prior.indices.push(index)
      prior.rules.push(rule)
      prior.selections.add(selection)
    } else
      groups.push({
        index,
        indices: [index],
        rules: [rule],
        signature: key,
        selections: new Set([selection]),
      })
  })
  return groups
}
export function removeRuleGroup(rules, group) {
  const indices = new Set(group.indices)
  return rules.filter((_, index) => !indices.has(index))
}
export function moveRuleGroup(rules, groups, index, offset) {
  const target = index + offset
  if (target < 0 || target >= groups.length) return rules
  const next = [...groups]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next.flatMap((group) => group.rules)
}
