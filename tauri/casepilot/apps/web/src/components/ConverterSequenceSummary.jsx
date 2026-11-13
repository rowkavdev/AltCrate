import React from "react"
import {
  ArrowRight,
  Coins,
  CornerDownRight,
  LoaderCircle,
  Package,
  Users,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import ConverterStepIcon from "./ConverterStepIcon.jsx"
import { converterSteps } from "../converterViewModel.js"
import { formatNumber } from "../format.js"
import { t } from "../language.js"

export default function ConverterSequenceSummary({
  steps,
  routing,
  totals,
  excludedCount = 0,
  accounts,
  destination,
  needsDestination,
  continuing,
  repeating,
  locked,
  disabled,
  pending,
  reason,
  reviewButton,
  recovery,
  pendingCount = 0,
  onDestinationChange,
  onReview,
  onOpenResults,
}) {
  const selected = new Set(steps)
  const route = converterSteps.filter((step) => selected.has(step.id))
  return (
    <aside className="converter-setup" aria-label={t("Resumo da conversão")}>
      <header className="converter-summary-heading">
        <h3>
          <span className="converter-section-number">3</span>
          {t("Rever sequência")}
        </h3>
        <span>
          {steps.length} {t(steps.length === 1 ? "etapa" : "etapas")}
        </span>
      </header>
      <dl className="converter-summary-totals">
        <div>
          <dt>
            <Users size={14} aria-hidden="true" />
            {t("Contas selecionadas")}
          </dt>
          <dd>{formatNumber(totals.selected)}</dd>
        </div>
        <div>
          <dt>
            <Coins size={14} aria-hidden="true" />
            {t("Tokens observados")}
          </dt>
          <dd>{formatNumber(totals.tokens, 0)}</dd>
        </div>
      </dl>
      {excludedCount > 0 && (
        <p className="converter-summary-hint">
          {excludedCount}{" "}
          {t(
            excludedCount === 1
              ? "conta excluída por resultado por confirmar"
              : "contas excluídas por resultados por confirmar"
          )}
          <Button size="sm" variant="link" onClick={onOpenResults}>
            {t("Ver resultados")}
          </Button>
        </p>
      )}
      <div className="converter-summary-route" aria-live="polite">
        <div className="converter-summary-label">
          {t(
            continuing
              ? "Continuação dos itens guardados"
              : repeating
                ? "Repetição com dados atuais"
                : "O teu percurso"
          )}
        </div>
        {route.length ? (
          <ol>
            {route.map((step, index) => (
              <li key={step.id}>
                <span className="converter-route-icon">
                  <ConverterStepIcon step={step.id} size={15} />
                </span>
                <span>
                  <strong>{t(step.label)}</strong>
                  {index === route.length - 1 && (
                    <small>{t("Termina aqui")}</small>
                  )}
                </span>
                <span className="converter-route-order" aria-hidden="true">
                  {index + 1}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="converter-summary-empty">
            <CornerDownRight size={17} aria-hidden="true" />
            {t("Seleciona pelo menos uma etapa para rever.")}
          </p>
        )}
      </div>
      {routing === "auto" && steps.includes("transfer") && (
        <p className="converter-summary-hint">
          {t(
            "Pro pode enviar tokens diretamente. Vês o percurso de cada conta na revisão."
          )}
        </p>
      )}
      <div className="converter-summary-destination">
        {needsDestination ? (
          <label className="converter-main-select">
            <span>
              <ArrowRight size={14} aria-hidden="true" />
              {t("Conta principal")}
            </span>
            <NativeSelect
              aria-label={t("Conta principal")}
              value={destination?.id || ""}
              disabled={locked}
              onChange={(event) => onDestinationChange(event.target.value)}
            >
              <NativeSelectOption value="">
                {t("Escolher conta…")}
              </NativeSelectOption>
              {accounts.map((account) => (
                <NativeSelectOption key={account.id} value={account.id}>
                  {account.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ) : (
          <div className="converter-local-note">
            <Package size={17} aria-hidden="true" />
            <div>
              <strong>{t("Fica nas contas de origem")}</strong>
              <small>{t("Sem envio para a Main.")}</small>
            </div>
          </div>
        )}
      </div>
      {recovery}
      <div className="converter-main-action">
        <span className="converter-mobile-review-context">
          <strong>
            {formatNumber(totals.selected)}{" "}
            {t(totals.selected === 1 ? "conta" : "contas")}
          </strong>
          <small>
            {steps.length} {t(steps.length === 1 ? "etapa" : "etapas")}
          </small>
        </span>
        {pendingCount > 0 && <Button className="converter-pending-link" variant="link" size="sm" onClick={onOpenResults}>{pendingCount} {t("pendências e operações ativas")}</Button>}
        {reason && (
          <p className="converter-summary-reason" role="status">
            {reason}
          </p>
        )}
        <Button ref={reviewButton} disabled={disabled} onClick={onReview}>
          {pending ? (
            <LoaderCircle
              size={16}
              className="animate-spin"
              aria-hidden="true"
            />
          ) : (
            <ArrowRight size={16} aria-hidden="true" />
          )}
          {t(continuing ? "Rever próximas etapas" : "Rever etapas")}
        </Button>
        <small>{t("Confirma os detalhes antes de iniciar.")}</small>
      </div>
    </aside>
  )
}
