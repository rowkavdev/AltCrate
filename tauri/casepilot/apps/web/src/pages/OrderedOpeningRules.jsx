import React, { useMemo, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Dialog, DialogContent } from "@workspace/ui/components/dialog"
import VisualOpeningRuleEditor from "./VisualOpeningRuleEditor.jsx"
import {
  normalizeSelectedSkinNames,
  prepareSkinOptions,
  prepareSkinRuleBatch,
} from "../openingSkinSelection.js"
import {
  canonicalSkinName,
  conditionSummary,
  patchRuleDraft,
  ruleDraft,
  validateRuleSet,
} from "../openingRulesViewModel.js"
import { t } from "../language.js"
import {
  groupOpeningRules,
  moveRuleGroup,
  removeRuleGroup,
  ruleSelectionKey,
  sharedRuleDraftSource,
} from "../openingRuleGroups.js"
import "./orderedOpeningRules.css"

const actionLabel = (action) =>
  t(
    { keep: "Inventário", sell: "Vender", storage: "Storage" }[action] ||
      "Destino inválido"
  )

export default function OrderedOpeningRules({
  caseName,
  siteEvent,
  rules,
  skins,
  onChange,
  onChooseStorage,
  accounts = [],
  disabled = false,
  Artwork,
  loadSkinMetadata,
}) {
  const [editor, setEditor] = useState(null),
    [submitted, setSubmitted] = useState(false),
    [page, setPage] = useState(1)
  const options = useMemo(
    () => [...new Map(skins.map((item) => [item.name, item])).values()],
    [skins]
  )
  const accountNames = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.label])),
    [accounts]
  )
  const validation = useMemo(
    () => validateRuleSet(rules, options),
    [rules, options]
  )
  const groups = useMemo(() => groupOpeningRules(rules), [rules])
  const choices = useMemo(
    () => new Map(prepareSkinOptions(options).map((item) => [item.key, item])),
    [options]
  )
  const pageCount = Math.max(1, Math.ceil(groups.length / 12)),
    currentPage = Math.min(page, pageCount),
    offset = (currentPage - 1) * 12
  const batch = editor
    ? prepareSkinRuleBatch(
        rules,
        editor.index,
        editor.draft,
        editor.selectedNames,
        options,
        editor.groupIndices
      )
    : null
  const errors = batch?.errors || []
  function openEditor(index = null) {
    if (disabled) return
    const group = index === null ? null : groups[index]
    const rule = group
      ? group.rules[0]
      : {
          id: "rule-" + globalThis.crypto.randomUUID(),
          name: (options.find((item) => item.image) || options[0])?.name || "",
          action: "keep",
        }
    const draft = ruleDraft(sharedRuleDraftSource(rule))
    const keys = group ? group.rules.map(ruleSelectionKey) : [draft.name]
    const known = normalizeSelectedSkinNames(keys, options)
    // A missing saved variant must remain invalid until explicitly removed.
    const selectedNames = keys
      .map(
        (key) =>
          known.find(
            (name) => canonicalSkinName(name) === canonicalSkinName(key)
          ) || key
      )
      .filter(Boolean)
    setEditor({
      index: group?.index ?? null,
      groupIndex: index,
      groupIndices: group?.indices || [],
      draft,
      selectedNames,
    })
    setSubmitted(false)
  }
  function update(changes) {
    setEditor(
      (current) =>
        current && { ...current, draft: patchRuleDraft(current.draft, changes) }
    )
  }
  function save(event, blocked = false) {
    event.preventDefault()
    if (disabled) return
    setSubmitted(true)
    if (errors.length || blocked) return
    const previous = editor.groupIndices.map((index) => rules[index])
    const existing = new Map(
      previous
        .filter(Boolean)
        .map((rule) => [canonicalSkinName(ruleSelectionKey(rule)), rule])
    )
    const groupId =
      previous[0]?.groupId || "group-" + globalThis.crypto.randomUUID()
    const saved = batch.candidates.map((rule) => ({
      ...rule,
      id:
        existing.get(canonicalSkinName(ruleSelectionKey(rule)))?.id ||
        "rule-" + globalThis.crypto.randomUUID(),
      groupId,
    }))
    const removed = new Set(editor.groupIndices)
    const at = editor.index === null ? rules.length : editor.index
    onChange([
      ...rules.slice(0, at),
      ...saved,
      ...rules.slice(at).filter((_, i) => !removed.has(at + i)),
    ])
    setPage(Math.floor((editor.groupIndex ?? groups.length) / 12) + 1)
    setEditor(null)
  }
  function destination(rule) {
    return rule.action === "storage"
      ? [
          rule.storageName || t("Seleciona um storage válido"),
          rule.accountLabel || accountNames.get(rule.destinationAccountId),
        ]
          .filter(Boolean)
          .join(" · ")
      : actionLabel(rule.action)
  }
  return (
    <section
      className="ordered-opening-rules"
      aria-label={t("Regras locais ordenadas")}
    >
      <div className="opening-rules-toolbar">
        <div>
          <h3>{t("Regras locais ordenadas")}</h3>
          <p>{t("A primeira regra correspondente decide o destino.")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !options.length || rules.length >= 500}
          onClick={() => openEditor()}
        >
          <Plus />
          {t("Adicionar regra")}
        </Button>
      </div>
      {!rules.length ? (
        <div className="opening-rules-empty">
          <ShieldCheck size={20} />
          <div>
            <strong>{t("Tudo fica no inventário")}</strong>
            <p>
              {t(
                "Adiciona uma regra para definir exceções por skin ou atributos."
              )}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="opening-rule-columns" aria-hidden="true">
            <span>#</span>
            <span>{t("Skin e condições")}</span>
            <span>{t("Destino")}</span>
            <span>{t("Ações")}</span>
          </div>
          <ol className="opening-ordered-list" start={offset + 1}>
            {groups.slice(offset, offset + 12).map((group, localIndex) => {
              const index = offset + localIndex,
                rule = group.rules[0],
                error = validation.errors.find((value) =>
                  group.indices.includes(value.index)
                )
              return (
                <li
                  className="opening-ordered-row"
                  key={rule?.id || index}
                  data-rule-index={index}
                >
                  <span
                    className="opening-rule-priority"
                    aria-label={t("Prioridade") + " " + (index + 1)}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="opening-rule-description">
                    <div className="opening-rule-group-skins">
                      {group.rules.slice(0, 3).map((member, i) => {
                        const option = choices.get(ruleSelectionKey(member))
                        return (
                          <span key={member?.id || i}>
                            {Artwork && option?.image && (
                              <Artwork src={option.image} name={option.label} />
                            )}
                            <span>
                              {option?.label ||
                                member?.name ||
                                t("Skin inválida")}
                            </span>
                          </span>
                        )
                      })}
                      {group.rules.length > 3 && (
                        <small>
                          +{group.rules.length - 3} {t("skins")}
                        </small>
                      )}
                    </div>
                    <small>
                      {conditionSummary(
                        sharedRuleDraftSource(rule)?.conditions,
                        t
                      )}
                    </small>
                    {error && (
                      <small className="inline-error">{t(error.message)}</small>
                    )}
                  </div>
                  <div className="opening-rule-target">
                    <Badge variant="secondary">
                      {actionLabel(rule?.action)}
                    </Badge>
                    {rule?.action === "storage" && (
                      <small>{destination(rule)}</small>
                    )}
                  </div>
                  <div className="opening-ordered-actions">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("Editar regra") + " " + (index + 1)}
                      aria-label={t("Editar regra") + " " + (index + 1)}
                      disabled={disabled}
                      onClick={() => openEditor(index)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("Subir regra") + " " + (index + 1)}
                      aria-label={t("Subir regra") + " " + (index + 1)}
                      disabled={disabled || index === 0}
                      onClick={() =>
                        onChange(moveRuleGroup(rules, groups, index, -1))
                      }
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("Descer regra") + " " + (index + 1)}
                      aria-label={t("Descer regra") + " " + (index + 1)}
                      disabled={disabled || index === groups.length - 1}
                      onClick={() =>
                        onChange(moveRuleGroup(rules, groups, index, 1))
                      }
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("Eliminar regra") + " " + (index + 1)}
                      aria-label={t("Eliminar regra") + " " + (index + 1)}
                      disabled={disabled}
                      onClick={() => onChange(removeRuleGroup(rules, group))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ol>
          {pageCount > 1 && (
            <nav
              className="opening-rules-pagination"
              aria-label={t("Paginação das regras")}
            >
              <span>
                {t("Página")} {currentPage} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t("Página anterior de regras")}
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t("Página seguinte de regras")}
                disabled={currentPage === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight />
              </Button>
            </nav>
          )}
        </>
      )}
      <p className="opening-rules-protection">
        <ShieldCheck size={14} />
        {t(
          "Favoritos protegidos. Sem os atributos necessários, o item fica no inventário."
        )}
      </p>
      <details className="opening-rules-help">
        <summary>{t("Como se aplicam as regras?")}</summary>
        <p>
          {t(
            "Coloca as variantes específicas antes da regra geral. Sem correspondência, o item fica no inventário. Estas regras são locais e não alteram o autosell do site."
          )}
        </p>
        <p>
          {t(
            "Top N usa a posição individual Overall de menor float. Sem uma posição individual atual, o item é conservado."
          )}
        </p>
      </details>
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) setEditor(null)
        }}
      >
        {editor && (
          <DialogContent
            className="opening-rule-editor visual-opening-rule-editor"
            container={document.querySelector(".cp-shell")}
            showCloseButton={false}
          >
            <VisualOpeningRuleEditor
              loadSkinMetadata={loadSkinMetadata}
              siteEvent={siteEvent}
              caseName={caseName}
              editor={editor}
              options={options}
              accountNames={accountNames}
              onUpdate={update}
              onSelectionChange={(names) =>
                setEditor(
                  (current) =>
                    current && {
                      ...current,
                      selectedNames: names,
                      draft: patchRuleDraft(current.draft, {
                        name: choices.get(names[0])?.name || names[0] || "",
                      }),
                    }
                )
              }
              maxSelection={500 - rules.length + editor.groupIndices.length}
              onSave={save}
              onCancel={() => setEditor(null)}
              onChooseStorage={onChooseStorage}
              errors={errors}
              submitted={submitted}
              disabled={disabled}
              Artwork={Artwork}
            />
          </DialogContent>
        )}
      </Dialog>
    </section>
  )
}
