import React from "react"
import { Check, Clock3, History, RotateCcw } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { converterSteps } from "../converterViewModel.js"
import { t } from "../language.js"
export default function ConverterHistory({
  rows,
  previous,
  disabled,
  onRestore,
  onRepeat,
  onContinue,
}) {
  if (!rows.length && !previous) return null
  return (
    <section className="converter-history" aria-label={t("Etapas anteriores")}>
      <header>
        <strong>
          <History size={15} />
          {t("Etapas anteriores")}
        </strong>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !previous}
          onClick={onRestore}
        >
          <RotateCcw size={13} />
          {t("Usar última seleção")}
        </Button>
      </header>
      <p>
        {t(
          "O histórico não obriga a terminar o percurso. Escolhe qualquer etapa para a próxima execução."
        )}
      </p>
      {!!rows.length && (
        <details>
          <summary>
            {t("Ver progresso das contas desta página")} · {rows.length}
          </summary>
          {rows.map((row) => (
            <div className="converter-history-account" key={row.operationId}>
              <strong>{row.sourceLabel}</strong>
              <div className="converter-history-steps">
                {converterSteps
                  .filter(
                    (s) =>
                      (row.selectedSteps || row.steps || []).includes(s.id) ||
                      row.completedSteps?.includes(s.id)
                  )
                  .map((step) => {
                    const done = row.completedSteps?.includes(step.id),
                      uncertain =
                        row.state === "unconfirmed" && row.stage === step.id
                    return (
                      <span
                        key={step.id}
                        data-state={
                          uncertain ? "uncertain" : done ? "done" : "pending"
                        }
                      >
                        {done ? <Check size={12} /> : <Clock3 size={12} />}
                        {t(step.label)}
                        <small>
                          {t(
                            uncertain
                              ? "Por confirmar"
                              : done
                                ? "Concluída"
                                : "Por executar (opcional)"
                          )}
                        </small>
                      </span>
                    )
                  })}
              </div>
              {!!row.history?.length && (
                <details>
                  <summary>
                    {t("Execuções anteriores")} · {row.history.length}
                  </summary>
                  {row.history.map((entry) => (
                    <p key={entry.operationId}>
                      {entry.completedSteps
                        .map((id) =>
                          t(
                            converterSteps.find((step) => step.id === id)
                              ?.label || id
                          )
                        )
                        .join(" · ") || t("Sem etapas concluídas")}
                    </p>
                  ))}
                </details>
              )}
              {!row.canRepeat && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    "Verifica o resultado desta conta antes de iniciar outra ação."
                  )}
                </p>
              )}
              <div className="converter-issue-actions">
                {row.canReviewNext && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => onContinue([row])}
                  >
                    {t("Continuar pendentes")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled || !row.canRepeat}
                  onClick={() => onRepeat(row)}
                >
                  <RotateCcw size={13} />
                  {t("Escolher outras etapas")}
                </Button>
              </div>
            </div>
          ))}
        </details>
      )}
    </section>
  )
}
