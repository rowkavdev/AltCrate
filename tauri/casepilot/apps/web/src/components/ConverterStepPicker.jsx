import React from "react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { ArrowRightLeft, Gem, PackageOpen, Route, X } from "lucide-react"
import ConverterStepIcon, { stepCaptions } from "./ConverterStepIcon.jsx"
import { converterSteps } from "../converterViewModel.js"
import { t } from "../language.js"
export default function ConverterStepPicker({
  selectedSteps,
  routing,
  disabled,
  onChange,
}) {
  const selected = new Set(selectedSteps)
  const labelFor = (step) => step.id === "convert-inventory"
    ? "Converter skins existentes"
    : step.id === "convert-stickers" && selected.has("open")
      ? "Converter após cada lote"
      : step.label
  const presets = [
    ["Tudo até à Main", converterSteps.map((s) => s.id), "auto", Route],
    ["Só criar skins", ["mint"], "selected", Gem],
    ["Criar + enviar", ["mint", "transfer"], "selected", ArrowRightLeft],
    [
      "Abrir + converter",
      ["open", "convert-stickers"],
      "selected",
      PackageOpen,
    ],
  ]
  return (
    <section
      className="converter-step-picker"
      aria-label={t("Etapas a executar")}
    >
      <div className="converter-steps-heading">
        <div>
          <h3>
            <span className="converter-section-number">1</span>
            {t("Escolher etapas")}
          </h3>
          <p>{t("Combina as ações ou começa com um atalho.")}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || !selected.size}
          onClick={() => onChange([], "selected")}
        >
          <X size={13} aria-hidden="true" />
          {t("Limpar etapas")}
        </Button>
      </div>
      <div className="converter-presets" aria-label={t("Atalhos de etapas")}>
        {presets.map(([label, steps, mode, Icon]) => (
          <Button
            key={label}
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-pressed={
              routing === mode &&
              steps.length === selected.size &&
              steps.every((s) => selected.has(s))
            }
            onClick={() => onChange(steps, mode)}
          >
            <Icon size={14} aria-hidden="true" />
            {t(label)}
          </Button>
        ))}
      </div>
      <div className="converter-step-groups">
        {[
          ["capsules", "Caixas e cápsulas"],
          ["tokens", "Inventário e tokens"],
        ].map(([group, label]) => (
          <fieldset key={group}>
            <legend>{t(label)}</legend>
            {converterSteps
              .filter((step) => step.group === group)
              .map((step) => (
                <label
                  key={step.id}
                  title={t(step.description)}
                  data-disabled={disabled || undefined}
                  className={
                    "converter-step-option" +
                    (selected.has(step.id) ? " is-selected" : "")
                  }
                >
                  <span className="converter-step-control">
                    <ConverterStepIcon step={step.id} size={19} />
                    <Checkbox
                      aria-label={t(labelFor(step))}
                      checked={selected.has(step.id)}
                      disabled={disabled}
                      onCheckedChange={(checked) => {
                        const next = new Set(selected)
                        if (checked) next.add(step.id)
                        else next.delete(step.id)
                        onChange(
                          converterSteps
                            .filter((s) => next.has(s.id))
                            .map((s) => s.id),
                          "selected"
                        )
                      }}
                    />
                  </span>
                  <span className="converter-step-copy">
                    <strong>{t(labelFor(step))}</strong>
                    <small>{t(step.id === "convert-inventory" ? "Todas as skins elegíveis → tokens" : step.id === "convert-stickers" && selected.has("open") ? "Abre → converte em tokens → repete" : stepCaptions[step.id])}</small>
                  </span>
                </label>
              ))}
          </fieldset>
        ))}
      </div>
      {(selected.has("buy") || selected.has("open")) && (
        <p className="converter-capsule-note">{t("Cápsula fixa do conversor:")} <strong>Atlanta2017</strong></p>
      )}
      {selected.has("open") && selected.has("convert-stickers") && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("Converte cada lote antes de abrir o seguinte.")}{" "}
          {t(selected.has("convert-inventory") ? "Inclui primeiro as skins existentes revistas." : "Para incluir o inventário atual, ativa «Converter skins existentes».")}
        </p>
      )}
    </section>
  )
}
