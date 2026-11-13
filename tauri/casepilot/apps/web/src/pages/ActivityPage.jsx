import { DisclosurePanel } from "../components/WorkspaceSection.jsx";
import "./progression.css";
import { accountIndex } from "../workspaceViewModel.js";
import { t } from "../language.js";
import React, { useMemo } from "react";
import PersistentHistoryPanel from "./PersistentHistoryPanel.jsx";
import { ArrowDownToLine } from "lucide-react";
import EventRow from "../components/EventRow.jsx";
import { filterActivityEvents } from "../activityViewModel.js";
export default function ActivityPage({ model, ui, onUiChange }) {
  const labels = useMemo(
    () =>
      Object.fromEntries(
        [...accountIndex(model.accounts)].map(([id, account]) => [
          id,
          account.label,
        ]),
      ),
    [model.accounts],
  );
  const events = useMemo(
    () => filterActivityEvents(model.events, ui, labels),
    [model.events, ui.query, ui.accountId, ui.operation, ui.result, labels],
  );
  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{t("Registo desta sessão")}</h2>
            <small className="muted">
              {t(
                "Últimos 150 eventos em memória · exporta para guardar o relatório.",
              )}
            </small>
          </div>
          <button
            className="secondary-button"
            onClick={model.actions.exportResults}
            disabled={
              (!model.events.length &&
                !Object.keys(model.inventoryOperations || {}).length) ||
              !model.bridge
            }
          >
            <ArrowDownToLine size={16} />
            <span>{t("Exportar")}</span>
          </button>
        </div>
        <div className="toolbar activity-toolbar">
          <input
            className="search"
            aria-label={t("Pesquisar atividade")}
            placeholder={t("Pesquisar atividade")}
            value={ui.query}
            onChange={(event) => onUiChange({ query: event.target.value })}
          />
          <select
            aria-label={t("Conta da atividade")}
            value={ui.accountId}
            onChange={(event) => onUiChange({ accountId: event.target.value })}
          >
            <option value="all">{t("Todas as contas")}</option>
            {model.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Operação da atividade")}
            value={ui.operation}
            onChange={(event) => onUiChange({ operation: event.target.value })}
          >
            {[
              ["all", "Todas as operações"],
              ["case", "Caixas"],
              ["money", "Dinheiro"],
              ["vault", "Cofre"],
              ["open", "Abertura"],
              ["conversion", "Conversão"],
              ["game", "Jogos"],
              ["progression", "Recompensas e skills"],
              ["sell", "Venda"],
              ["favorite", "Favorito"],
              ["withdraw", "Retirada"],
              ["transfer", "Envio"],
              ["move-to-storage", "Mover para storage"],
            ].map(([id, name]) => (
              <option key={id} value={id}>
                {t(name)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Resultado da atividade")}
            value={ui.result}
            onChange={(event) => onUiChange({ result: event.target.value })}
          >
            {[
              ["all", "Todos os resultados"],
              ["accepted", "Aceites"],
              ["confirmed", "Confirmados"],
              ["failed", "Falhados"],
              ["unconfirmed", "Por confirmar"],
            ].map(([id, name]) => (
              <option key={id} value={id}>
                {t(name)}
              </option>
            ))}
          </select>
          <span className="count">
            {t(events.length)}
            {t(" eventos")}
          </span>
        </div>
        <div className="event-list">
          {events.length ? (
            events.map((event, index) => (
              <EventRow
                key={index}
                event={event}
                label={labels[event.accountId]}
                destinationLabel={labels[event.destinationAccountId]}
              />
            ))
          ) : (
            <div className="empty-state">
              <h2>
                {t(
                  model.events.length
                    ? "Sem resultados para estes filtros"
                    : "Ainda não há atividade",
                )}
              </h2>
              <p>
                {t("Os eventos das operações iniciadas aparecem nesta página.")}
              </p>
            </div>
          )}
        </div>
      </section>
      <DisclosurePanel
        title="Histórico guardado"
        description="Consultar e exportar operações de outras sessões."
      >
        <PersistentHistoryPanel model={model} />
      </DisclosurePanel>
    </div>
  );
}
