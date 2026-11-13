import React from "react"
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react"
import { formatNumber, formatTime } from "../format.js"
import { t } from "../language.js"

export default function ConverterVerificationFeedback({
  verification,
  closed,
}) {
  if (!verification) return null
  const running = verification.phase === "running"
  const confirmed = verification.outcome === "confirmed"
  const missing =
    verification.outcome === "pending" &&
    verification.errorStatus === 0 &&
    Number.isFinite(verification.found) &&
    verification.found < verification.expected
  const Icon = running ? LoaderCircle : confirmed ? CircleCheck : CircleAlert
  const heading = running
    ? "A verificar resultado…"
    : verification.phase === "interrupted"
      ? "Verificação interrompida"
      : confirmed
        ? "Resultado confirmado"
        : verification.outcome === "failed"
          ? "Verificação terminada · Operação não concluída"
          : closed
            ? "Encerrada sem confirmação · Podes iniciar novas etapas"
            : missing
              ? "Verificação concluída · Stickers em falta"
              : "Verificação terminada · Continua por confirmar"
  const inventory = verification.inventory
  return (
    <div
      className="converter-result-message space-y-1"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex flex-wrap items-center gap-2 text-foreground">
        <Icon
          size={14}
          className={running ? "animate-spin" : undefined}
          aria-hidden="true"
        />
        <strong className="font-medium">{t(heading)}</strong>
        {verification.finishedAt && (
          <time
            className="text-muted-foreground"
            dateTime={verification.finishedAt}
            title={new Date(verification.finishedAt).toLocaleString()}
          >
            {formatTime(verification.finishedAt)}
          </time>
        )}
      </div>
      {running && !inventory && <p>{t("A consultar o estado da conta…")}</p>}
      {running && inventory && (
        <p>
          {t("A ler o inventário")}: {formatNumber(inventory.read)} /{" "}
          {formatNumber(inventory.total)} {t("itens")} · {inventory.page} /{" "}
          {inventory.pages} {t("páginas")}
        </p>
      )}
      {!running &&
        Number.isFinite(verification.found) &&
        Number.isFinite(verification.expected) && (
          <p>
            {formatNumber(verification.found)} {t("de")}{" "}
            {formatNumber(verification.expected)}{" "}
            {t("stickers esperados encontrados")}
            {inventory
              ? ` · ${formatNumber(inventory.read)} ${t("itens consultados")}`
              : ""}
          </p>
        )}
      {!running && verification.message && <p>{t(verification.message)}</p>}
    </div>
  )
}
