import { t } from "../language.js";
import React from "react";
import { Activity, Check, Clock3, CircleAlert } from "lucide-react";
import {
  activityAccepted,
  activityConfirmed,
  activityFailed,
  activityHttpStatus,
} from "../activityViewModel.js";
import { formatNumber, formatMoney, formatTime } from "../format.js";
const titles = {
  "farm-started": "Automação iniciada",
  "farm-finished": "Automação terminada",
  "farm-stopping": "A parar automação",
  "open-started": "Abertura iniciada",
  "open-finished": "Abertura terminada",
  "account-error": "Erro na conta",
  "needs-login": "Precisa de login",
  cooldown: "Limite da API atingido",
  "budget-wait": "Janela de cliques esgotada",
};
export default function EventRow({ event, label, destinationLabel }) {
  const accepted = activityAccepted(event),
    confirmed = activityConfirmed(event),
    failed = activityFailed(event);
  const operation =
    event.type === "progression"
      ? event.title ||
        {
          reward: "Recompensa",
          mission: "Missão",
          pass: "Passe mensal",
          "skill-buy": "Comprar habilidade",
          "skill-sell": "Vender habilidade",
          "skill-preset": "Preset de habilidades",
          autoopen: "Preferências de abertura",
        }[event.kind] ||
        "Progressão"
      : event.type === "inventory-action"
        ? {
            sell: "Venda",
            convert: "Conversão",
            favorite: "Favorito",
            withdraw: "Retirada",
            transfer: "Envio",
            "move-to-storage": "Mover para storage",
          }[event.kind] || "Item"
        : event.type === "opening-item"
          ? {
              sell: "Venda após abertura",
              storage: "Storage após abertura",
              keep: "Item conservado",
            }[event.action] || "Item após abertura"
          : event.type === "request"
            ? event.kind === "money"
              ? "Dinheiro"
              : "Caixas"
            : event.type === "vault"
              ? "Cofre"
              : event.type === "open"
                ? "Abertura"
                : event.type === "conversion"
                  ? "Conversão"
                  : event.type === "game"
                    ? event.game
                    : event.type === "farm-finished" &&
                        event.reason === "accounts-unavailable"
                      ? "Automação interrompida"
                      : titles[event.type] || "Operação";
  const outcome = confirmed
    ? "confirmado"
    : accepted
      ? "aceite · por confirmar"
      : failed
        ? activityHttpStatus(event)
          ? "HTTP " + activityHttpStatus(event)
          : "falhou"
        : "";
  const title = [
    operation,
    outcome,
    label || (event.accountId ? "Conta removida" : ""),
  ]
    .filter(Boolean)
    .join(" · ");
  let detail = event.message || "";
  if (event.type === "progression")
    detail = [
      Number.isFinite(event.completed) && Number.isFinite(event.total)
        ? formatNumber(event.completed) +
          " de " +
          formatNumber(event.total) +
          " passos"
        : null,
      event.message,
    ]
      .filter(Boolean)
      .join(" · ");
  if (event.type === "inventory-action")
    detail = [
      event.item?.name,
      event.destinationAccountId
        ? "Para " + (destinationLabel || "Conta de destino")
        : "",
      event.destinationStorageName
        ? "Storage " + event.destinationStorageName
        : "",
      event.message,
    ]
      .filter(Boolean)
      .join(" · ");
  if (event.type === "opening-item")
    detail = [
      event.skinName,
      Number.isInteger(event.ruleIndex) ? "Regra " + (event.ruleIndex + 1) : "",
      event.reason,
      event.action === "storage" && event.destinationStorageName
        ? "Storage " + event.destinationStorageName
        : "",
      event.action === "storage" && event.destinationAccountId
        ? "Conta de destino: " +
          (destinationLabel || event.destinationAccountId)
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  if (event.type === "request")
    detail =
      formatNumber(event.clicks) +
      " cliques · " +
      (Number.isFinite(event.verifiedDelta)
        ? "Δ " +
          (event.kind === "money"
            ? formatMoney(event.verifiedDelta) + " saldo"
            : formatNumber(event.verifiedDelta) + " caixas")
        : "alteração não confirmada") +
      (event.caseName ? " · " + event.caseName : "");
  if (event.type === "vault")
    detail = confirmed
      ? "+" + formatMoney(event.confirmedDelta) + " de crédito observado"
      : "Recolha sem crédito confirmado";
  if (event.type === "open")
    detail =
      formatNumber(event.skinCount) +
      " IDs recebidos · " +
      (Number.isFinite(event.selectedCaseDelta)
        ? "Δ " + formatNumber(event.selectedCaseDelta) + " caixas selecionadas"
        : "stock selecionado indisponível") +
      " · " +
      (event.verified === true
        ? formatNumber(event.confirmedCount || event.openedCount) +
          " confirmadas"
        : "por confirmar; conta parada") +
      (event.message ? " · " + event.message : "");
  if (event.type === "conversion")
    detail =
      (event.skinName || "Item") +
      " · " +
      (event.conversionMode === "money"
        ? formatMoney(event.moneyDelta) + " dinheiro"
        : formatNumber(event.tokenDelta, 4) + " tokens") +
      (event.message ? " · " + event.message : "");
  if (event.type === "game")
    detail = confirmed
      ? "Resultado confirmado pela resposta do servidor"
      : accepted
        ? "Comando enviado; aguarda confirmação"
        : event.message || "Sem resultado confirmado";
  if (["cooldown", "budget-wait"].includes(event.type))
    detail = [
      event.type === "cooldown" ? event.message : "",
      "Nova tentativa após " + formatTime(event.until),
    ]
      .filter(Boolean)
      .join(" · ");
  const Icon = failed
    ? CircleAlert
    : accepted
      ? Check
      : event.type === "cooldown"
        ? Clock3
        : Activity;
  return (
    <article className="event-row">
      <span
        className={
          "event-icon" +
          (confirmed
            ? " success"
            : failed
              ? " error"
              : event.type === "cooldown"
                ? " waiting"
                : "")
        }
      >
        <Icon size={16} />
      </span>
      <div>
        <div className="event-title">
          <strong>{t(operation)}</strong>
          {outcome && (
            <span
              className={
                "event-outcome" +
                (confirmed ? " confirmed" : failed ? " failed" : "")
              }
            >
              {t(outcome)}
            </span>
          )}
        </div>
        {(label || event.accountId) && (
          <small className="event-account">
            {t(label || "Conta removida")}
          </small>
        )}
        {detail && <small>{t(detail)}</small>}
      </div>
      <time>{t(formatTime(event.at))}</time>
    </article>
  );
}
