import React, { useMemo, useState } from "react"
import {
  Archive,
  ArrowRight,
  Check,
  Filter,
  Hash,
  Package,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Search,
  Tag,
  Trophy,
  Wallet,
  X,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Badge } from "@workspace/ui/components/badge"
import { Slider } from "@workspace/ui/components/slider"
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  activeConditionGroups,
  changeConditionGroup,
  conditionGroupErrors,
} from "../openingRuleEditorModel.js"
import { conditionSummary, draftRule } from "../openingRulesViewModel.js"
import { t } from "../language.js"
import { prepareSkinOptions } from "../openingSkinSelection.js"
import OpeningSkinPicker from "./OpeningSkinPicker.jsx"

const groups = [
  ["float", "Float", SlidersHorizontal],
  ["patterns", "Padrões", Hash],
  ["statTrak", "StatTrak", Sparkles],
  ["souvenir", "Souvenir", Tag],
  ["event", "Evento", Tag],
  ["ranking", "Top N", Trophy],
]
const destinations = [
  ["keep", "Inventário", "Guardar o item", Package],
  ["sell", "Vender", "Vender quando sair", Wallet],
  ["storage", "Storage", "Enviar para um cofre", Archive],
]
const named = (template, label) => t(template.replace("{0}", t(label)))

export default function VisualOpeningRuleEditor({
  caseName,
  siteEvent,
  editor,
  options,
  accountNames,
  onUpdate,
  onSelectionChange,
  maxSelection,
  onSave,
  onCancel,
  onChooseStorage,
  errors,
  submitted,
  disabled,
  Artwork,
  loadSkinMetadata,
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [active, setActive] = useState(() =>
    activeConditionGroups(editor.draft)
  )
  const byName = useMemo(
    () => new Map(prepareSkinOptions(options).map((item) => [item.key, item])),
    [options]
  )
  const draft = editor.draft,
    item = byName.get(editor.selectedNames[0]),
    candidate = draftRule(draft),
    localErrors = conditionGroupErrors(draft, active)
  const label =
    destinations.find(([action]) => action === draft.action)?.[1] ||
    "Destino inválido"
  function toggle(group, enabled) {
    const next = changeConditionGroup(draft, group, enabled)
    onUpdate(
      Object.fromEntries(next.editedFields.map((key) => [key, next[key]]))
    )
    setActive((current) =>
      enabled ? [...current, group] : current.filter((key) => key !== group)
    )
  }
  const min = Math.min(1, Math.max(0, Number(draft.floatMin) || 0)),
    max = Math.min(
      1,
      Math.max(0, draft.floatMax === "" ? 1 : Number(draft.floatMax) || 0)
    )
  function block(group, title, Icon, children) {
    return (
      <section
        className="visual-rule-condition"
        key={group}
        aria-label={named("Filtro: {0}", title)}
      >
        <div className="visual-condition-heading">
          <span>
            <Icon size={15} />
            {t(title)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={named("Remover condição: {0}", title)}
            disabled={disabled}
            onClick={() => toggle(group, false)}
          >
            <X />
          </Button>
        </div>
        {children}
      </section>
    )
  }
  return (
    <>
      <DialogHeader className="visual-rule-header">
        <DialogTitle>
          {t(editor.index === null ? "Adicionar regra" : "Editar regra")}
        </DialogTitle>
        <DialogDescription>
          {t(
            "Escolhe as skins, filtra as variantes e define um destino comum."
          )}
        </DialogDescription>
      </DialogHeader>
      <DialogClose asChild>
        <Button
          className="opening-editor-close"
          variant="ghost"
          size="icon-sm"
          aria-label={t("Fechar editor")}
        >
          <X />
        </Button>
      </DialogClose>
      <datalist id="opening-site-events">
        {siteEvent?.name && <option value={siteEvent.name} />}
      </datalist>
      <form
        className="visual-rule-form"
        onSubmit={(event) => onSave(event, localErrors.length > 0)}
        noValidate
      >
        <div className="visual-rule-body">
          <aside className="visual-rule-item">
            <span className="visual-rule-eyebrow">
              {t("Se sair esta skin")}
            </span>
            <div className="opening-rule-hero">
              {item?.image && Artwork ? (
                <Artwork src={item.image} name={item.name} />
              ) : (
                <div className="visual-rule-no-art">
                  <Swords size={68} strokeWidth={1.2} />
                  <small>{t("Sem imagem no catálogo")}</small>
                </div>
              )}
            </div>
            {item?.rarity && (
              <Badge variant="secondary" className="visual-rule-rarity">
                {item.rarity}
              </Badge>
            )}
            <h3>
              {editor.selectedNames.length === 1
                ? item?.label || draft.name
                : named(
                    "{0} skins selecionadas",
                    String(editor.selectedNames.length)
                  )}
            </h3>
            {editor.selectedNames.length > 0 && (
              <div className="visual-rule-selected-names">
                {editor.selectedNames.map((key) => (
                  <span key={key}>
                    {byName.get(key)?.label || key}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        t("Remover skin") +
                        " · " +
                        (byName.get(key)?.label || key)
                      }
                      disabled={disabled}
                      onClick={() =>
                        onSelectionChange(
                          editor.selectedNames.filter((name) => name !== key)
                        )
                      }
                    >
                      <X size={12} />
                    </Button>
                  </span>
                ))}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              className="visual-rule-choose-skins"
              disabled={disabled}
              onClick={() => setPickerOpen(true)}
            >
              <Search />
              {t("Escolher skins")}
            </Button>
            <p className="visual-rule-protection">
              <ShieldCheck size={15} />
              {t("Favoritos ficam protegidos.")}
            </p>
          </aside>
          <div className="visual-rule-settings">
            <section className="visual-rule-filters">
              <div className="visual-rule-section-title">
                <Filter size={16} />
                <h3>{t("Filtrar variantes")}</h3>
                <small>
                  {active.length
                    ? active.length === 1
                      ? t("1 condição")
                      : named("{0} condições", String(active.length))
                    : t("Opcional")}
                </small>
              </div>
              <div
                className="visual-rule-filter-pills"
                role="group"
                aria-label={t("Condições da regra")}
              >
                {groups.map(([key, text, Icon]) => (
                  <Button
                    type="button"
                    variant={active.includes(key) ? "secondary" : "outline"}
                    size="sm"
                    key={key}
                    aria-pressed={active.includes(key)}
                    aria-label={named("Condição: {0}", text)}
                    disabled={disabled}
                    onClick={() => toggle(key, !active.includes(key))}
                  >
                    <Icon />
                    {t(text)}
                    {active.includes(key) ? (
                      <Check size={12} />
                    ) : (
                      <Plus size={12} />
                    )}
                  </Button>
                ))}
              </div>
              {!active.length && (
                <p className="visual-rule-any">
                  {t(
                    "Todas as variantes desta skin. Adiciona apenas os filtros de que precisas."
                  )}
                </p>
              )}
              <div className="visual-rule-active-conditions">
                {active.includes("float") &&
                  block(
                    "float",
                    "Float",
                    SlidersHorizontal,
                    <>
                      <div className="visual-rule-float-fields">
                        {[
                          ["floatMin", "Float mínimo"],
                          ["floatMax", "Float máximo"],
                        ].map(([key, text]) => (
                          <label key={key}>
                            {t(text)}
                            <Input
                              aria-label={t(text)}
                              type="number"
                              min="0"
                              max="1"
                              step="any"
                              placeholder={t("Qualquer")}
                              value={draft[key]}
                              disabled={disabled}
                              onChange={(event) =>
                                onUpdate({ [key]: event.target.value })
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <Slider
                        className="visual-rule-float-slider"
                        min={0}
                        max={1}
                        step={0.0001}
                        minStepsBetweenThumbs={0}
                        preserveThumbOrder
                        dir={
                          document.documentElement.dir === "rtl" ? "rtl" : "ltr"
                        }
                        value={[Math.min(min, max), Math.max(min, max)]}
                        thumbLabels={[
                          t("Limite inferior de float"),
                          t("Limite superior de float"),
                        ]}
                        disabled={disabled}
                        onValueChange={([low, high]) =>
                          onUpdate({
                            floatMin: String(low),
                            floatMax: String(high),
                          })
                        }
                      />
                      <div className="visual-rule-float-scale">
                        <span>0.0000</span>
                        <span>1.0000</span>
                      </div>
                    </>
                  )}
                {active.includes("patterns") &&
                  block(
                    "patterns",
                    "Padrões",
                    Hash,
                    <Input
                      aria-label={t("Padrões")}
                      placeholder={t("IDs separados por vírgula, ex.: 1, 2, 3")}
                      value={draft.patterns}
                      disabled={disabled}
                      onChange={(event) =>
                        onUpdate({ patterns: event.target.value })
                      }
                    />
                  )}
                {["statTrak", "souvenir"]
                  .filter((key) => active.includes(key))
                  .map((key) =>
                    block(
                      key,
                      key === "statTrak" ? "StatTrak" : "Souvenir",
                      key === "statTrak" ? Sparkles : Tag,
                      <div
                        className="visual-rule-variant"
                        role="group"
                        aria-label={
                          key === "statTrak" ? "StatTrak" : "Souvenir"
                        }
                      >
                        {[
                          ["true", "Sim"],
                          ["false", "Não"],
                        ].map(([value, text]) => (
                          <Button
                            type="button"
                            key={value}
                            variant={
                              draft[key] === value ? "secondary" : "outline"
                            }
                            size="sm"
                            aria-pressed={draft[key] === value}
                            disabled={disabled}
                            onClick={() => onUpdate({ [key]: value })}
                          >
                            {draft[key] === value && <Check />}
                            {t(text)}
                          </Button>
                        ))}
                      </div>
                    )
                  )}
                {active.includes("event") &&
                  block(
                    "event",
                    "Evento",
                    Tag,
                    <Input
                      aria-label={t("Evento")}
                      maxLength={130}
                      placeholder={t("Nome exato do evento")}
                      list="opening-site-events"
                      value={draft.eventName}
                      disabled={disabled}
                      onChange={(event) =>
                        onUpdate({ eventName: event.target.value })
                      }
                    />
                  )}
                {active.includes("ranking") &&
                  block(
                    "ranking",
                    "Top N",
                    Trophy,
                    <>
                      <label className="visual-rule-ranking">
                        {t("Top N · Overall menor float")}
                        <Input
                          aria-label={t("Top N · Overall menor float")}
                          type="number"
                          min="1"
                          max="10000000"
                          step="1"
                          value={draft.topN}
                          disabled={disabled}
                          onChange={(event) =>
                            onUpdate({ topN: event.target.value })
                          }
                        />
                      </label>
                      <small className="visual-rule-hint">
                        {t(
                          "Sem ranking individual atual, o item fica no inventário."
                        )}
                      </small>
                    </>
                  )}
              </div>
            </section>
            <section className="visual-rule-outcome">
              <div className="visual-rule-section-title">
                <ArrowRight size={16} />
                <h3>{t("Então, enviar para")}</h3>
              </div>
              <div
                className="visual-rule-destinations"
                role="group"
                aria-label={t("Destino da regra")}
              >
                {destinations.map(([action, text, help, Icon]) => (
                  <Button
                    type="button"
                    variant="outline"
                    className="visual-rule-destination"
                    aria-label={named("Destino: {0}", text)}
                    aria-pressed={draft.action === action}
                    disabled={disabled}
                    key={action}
                    onClick={() => onUpdate({ action })}
                  >
                    <Icon className="visual-destination-icon" />
                    {draft.action === action && (
                      <Check className="visual-destination-check" />
                    )}
                    <strong>{t(text)}</strong>
                    <small>{t(help)}</small>
                  </Button>
                ))}
              </div>
              {draft.action === "storage" && (
                <div className="opening-editor-storage">
                  <div>
                    <strong>
                      {draft.storageName || t("Seleciona o storage de destino")}
                    </strong>
                    <small>
                      {draft.accountLabel ||
                        accountNames.get(draft.destinationAccountId) ||
                        t("Podes escolher outra conta ligada.")}
                    </small>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() =>
                      onChooseStorage({ name: draft.name, onSelect: onUpdate })
                    }
                  >
                    <Archive />
                    {t("Escolher storage")}
                  </Button>
                </div>
              )}
            </section>
            {submitted && (errors.length > 0 || localErrors.length > 0) && (
              <div className="opening-editor-errors" role="alert">
                {[...errors, ...localErrors].map((error, index) => (
                  <p key={index}>{t(error.message)}</p>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="visual-rule-footer">
          <div className="visual-rule-summary">
            <span>{t("Resumo da regra")}</span>
            <strong>
              {editor.selectedNames.length === 1
                ? item?.label || draft.name
                : named("{0} skins", String(editor.selectedNames.length))}
              <ArrowRight size={13} />
              {t(label)}
            </strong>
            <small title={conditionSummary(candidate.conditions, t)}>
              {conditionSummary(candidate.conditions, t)}
            </small>
          </div>
          <div className="visual-rule-footer-actions">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" disabled={disabled}>
              <Check />
              {t("Guardar regra")}
            </Button>
          </div>
        </DialogFooter>
      </form>
      {pickerOpen && (
        <OpeningSkinPicker
          loadSkinMetadata={loadSkinMetadata}
          caseName={caseName}
          options={options}
          selectedNames={editor.selectedNames}
          onApply={(names) => {
            onSelectionChange(names)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
          disabled={disabled}
          maxSelection={maxSelection}
          Artwork={Artwork}
        />
      )}
    </>
  )
}
