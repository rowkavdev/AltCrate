import { patchRuleDraft } from "./openingRulesViewModel.js"
const fields = {
  float: ["floatMin", "floatMax"],
  patterns: ["patterns"],
  statTrak: ["statTrak"],
  souvenir: ["souvenir"],
  event: ["eventName"],
  ranking: ["topN"],
}
const empty = {
  floatMin: "",
  floatMax: "",
  patterns: "",
  statTrak: "any",
  souvenir: "any",
  eventName: "",
  topN: "",
}
const defaults = {
  floatMin: "0",
  floatMax: "1",
  patterns: "",
  statTrak: "true",
  souvenir: "true",
  eventName: "",
  topN: "10",
}
export function activeConditionGroups(draft) {
  return Object.entries(fields)
    .filter(([, keys]) =>
      keys.some((key) => Object.hasOwn(draft.conditions || {}, key))
    )
    .map(([group]) => group)
}
export function changeConditionGroup(draft, group, enabled) {
  return patchRuleDraft(
    draft,
    Object.fromEntries(
      fields[group].map((key) => [key, (enabled ? defaults : empty)[key]])
    )
  )
}
export function conditionGroupErrors(draft, groups) {
  const errors = []
  for (const group of groups) {
    if (
      group === "float" &&
      !String(draft.floatMin).trim() &&
      !String(draft.floatMax).trim()
    )
      errors.push({
        message: "Define um limite de float ou remove esta condição.",
      })
    if (group === "patterns" && !draft.patterns.trim())
      errors.push({ message: "Preenche os padrões ou remove esta condição." })
    if (group === "event" && !draft.eventName.trim())
      errors.push({ message: "Preenche o evento ou remove esta condição." })
    if (group === "ranking" && !String(draft.topN).trim())
      errors.push({ message: "Define o Top N ou remove esta condição." })
  }
  return errors
}
