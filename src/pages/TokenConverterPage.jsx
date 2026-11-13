import { accountIndex } from "../workspaceViewModel.js";
import { t } from "../language.js";
import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowRightLeft,
  Check,
  Coins,
  Square,
  RefreshCw,
  ExternalLink,
  Boxes,
  ShoppingCart,
  PackageOpen,
} from "lucide-react";
import AccountSelection from "../components/AccountSelection.jsx";
import { formatNumber } from "../format.js";
import "./converter.css";

const steps = [
  {
    id: "sell",
    title: "Vender caixas",
    detail: "Todas as caixas normais",
    Icon: Boxes,
  },
  {
    id: "buy",
    title: "Comprar cápsulas",
    detail: "Atlanta 2017 · saldo disponível",
    Icon: ShoppingCart,
  },
  {
    id: "open",
    title: "Abrir e converter",
    detail: "Novos stickers → tokens",
    Icon: PackageOpen,
  },
  {
    id: "trade",
    title: "Enviar tokens",
    detail: "Aceitação nas duas contas",
    Icon: ArrowRightLeft,
  },
];
const states = {
  waiting: "A aguardar",
  running: "Em execução",
  confirmed: "Concluída",
  unconfirmed: "Por confirmar",
  failed: "Falhou",
  stopped: "Parada",
  cancelled: "Cancelada",
  skipped: "Não processada",
  reviewed: "Revista",
};
export default function TokenConverterPage({ model, ui = {}, onUiChange }) {
  const { bridge, accounts, selectedIds, snapshots } = model,
    status = model.converter || { phase: "idle", rows: [], sentTokens: 0 };
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [reviewId, setReviewId] = useState(null);
  const accountsById = useMemo(() => accountIndex(accounts), [accounts]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const destination = accountsById.get(ui.destinationAccountId);
  const origins = accounts.filter((a) => a.id !== destination?.id),
    sourceIds = origins.filter((a) => selectedSet.has(a.id)).map((a) => a.id);
  const running = ["preparing", "running", "stopping"].includes(status.phase),
    blocked = status.phase === "blocked";
  const farmRunning = ["running", "stopping"].includes(model.farmStatus?.phase),
    openingRunning = ["running", "stopping"].includes(model.opening?.phase);
  const disabled =
    pending ||
    running ||
    blocked ||
    model.busy ||
    model.loading ||
    !bridge?.startTokenConverter ||
    !sourceIds.length ||
    model.running ||
    farmRunning ||
    openingRunning;
  const disabledReason =
    running || blocked
      ? ""
      : model.loading
        ? "A carregar as contas…"
        : farmRunning
          ? model.farmStatus.phase === "stopping"
            ? "A aguardar a paragem do farm e a confirmação dos pedidos em curso."
            : "O farm está em execução. Para-o antes de converter para que os saldos não mudem durante a sequência."
          : openingRunning
            ? model.opening.phase === "stopping"
              ? "A aguardar a paragem da abertura de caixas."
              : "A abertura de caixas está em execução. Para-a antes de iniciar o conversor."
            : model.busy
              ? "Aguarda a conclusão da operação de contas em curso."
              : !bridge?.startTokenConverter
                ? "Esta versão da app não disponibiliza o conversor."
                : !sourceIds.length
                  ? "Seleciona pelo menos uma conta de origem."
                  : !destination
                    ? "Escolhe a conta de destino para receber os tokens."
                    : model.running
                      ? "Aguarda a conclusão da outra operação em curso."
                      : "";
  const readiness = running
    ? "Em execução"
    : blocked
      ? "Revisão pendente"
      : farmRunning || openingRunning || model.busy || model.loading
        ? "A aguardar"
        : !sourceIds.length || !destination
          ? "Por configurar"
          : "Pronta";
  async function invoke(work, updateConverter = true) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await work();
      if (result && updateConverter) model.setConverter(result);
    } catch (e) {
      setError(
        String(e.message || e).replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setPending(false);
    }
  }
  const start = (action) =>
    invoke(() =>
      bridge.startTokenConverter({
        action,
        accountIds: sourceIds,
        destinationAccountId: destination?.id,
      }),
    );
  return (
    <div className="page-stack converter-page">
      <section
        className="converter-route"
        aria-label={t("Contas do conversor")}
      >
        <div className="panel">
          <span className="kicker">{t("ORIGEM")}</span>
          <h2>{t("Contas a converter")}</h2>
          <p>
            {t(
              "Até 50 contas convertem em paralelo. Os tokens são enviados uma conta de cada vez.",
            )}
          </p>
          <AccountSelection
            accounts={origins}
            selectedIds={sourceIds}
            onChange={model.setSelectedIds}
            disabled={running || pending}
          />
        </div>
        <ArrowRight
          className="converter-route-arrow"
          size={22}
          aria-hidden="true"
        />
        <div className="panel converter-destination">
          <span className="kicker">{t("DESTINO")}</span>
          <h2>{t("Onde receber os tokens")}</h2>
          <label>
            {t("Conta de destino")}
            <select
              value={destination?.id || ""}
              disabled={running || pending}
              onChange={(e) =>
                onUiChange({ destinationAccountId: e.target.value })
              }
            >
              <option value="">{t("Escolher conta…")}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <p className="form-note">
            {destination ? (
              <>
                {t("Saldo observado: ")}
                {t(formatNumber(snapshots[destination.id]?.tokens, 2))}
                {t(" tokens. Esta conta recebe e aceita automaticamente.")}
              </>
            ) : (
              "Escolhe uma conta ligada à app. Será excluída das origens."
            )}
          </p>
        </div>
      </section>
      <section
        className="panel converter-sequence"
        aria-labelledby="converter-sequence-title"
      >
        <div className="section-heading">
          <div>
            <span className="kicker">{t("SEQUÊNCIA COMPLETA")}</span>
            <h2 id="converter-sequence-title">
              {t("Das caixas à conta de destino")}
            </h2>
          </div>
          <span
            className={
              "status-tag" +
              (running
                ? " good"
                : blocked || farmRunning || openingRunning
                  ? " waiting"
                  : "")
            }
          >
            {t(readiness)}
          </span>
        </div>
        <details className="converter-step-details">
          <summary>{t("Ver as quatro etapas")}</summary>
          <ol className="converter-steps">
            {steps.map(({ id, title, detail, Icon }, index) => (
              <li key={id}>
                <span className="converter-step-number">{t(index + 1)}</span>
                <Icon size={21} aria-hidden="true" />
                <strong>{t(title)}</strong>
                <small>{t(detail)}</small>
              </li>
            ))}
          </ol>
        </details>
        <p className="converter-scope">
          {t(
            "A sequência vende todas as caixas normais das origens, usa o dinheiro disponível para comprar cápsulas e converte os stickers obtidos em tokens. Envia todos os tokens inteiros de cada conta; a parte decimal fica na origem.",
          )}
        </p>
        <div className="converter-run">
          <div>
            {running ? (
              <button
                type="button"
                className="stop-button"
                disabled={pending || status.phase === "stopping"}
                onClick={() => invoke(() => bridge.stopTokenConverter())}
              >
                <Square size={16} />
                {t(
                  status.phase === "stopping" ? "A parar…" : "Parar conversor",
                )}
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                disabled={disabled || !destination}
                title={t(disabledReason || undefined)}
                aria-describedby={
                  disabledReason ? "converter-prerequisites" : undefined
                }
                onClick={() => start("full")}
              >
                <ArrowRightLeft size={17} />
                {t(
                  pending && !farmRunning && !openingRunning
                    ? "A preparar…"
                    : "Iniciar sequência",
                )}
              </button>
            )}
            <small>
              {t(
                "O envio exige Pro na origem e trocas desbloqueadas nas duas contas.",
              )}
            </small>
          </div>
          <div className="converter-total">
            <Coins size={21} />
            <span>
              <strong>{t(formatNumber(status.sentTokens || 0))}</strong>
              <small>{t("tokens recebidos e verificados")}</small>
            </span>
          </div>
        </div>
        {disabledReason && (
          <div
            id="converter-prerequisites"
            className="converter-prerequisites"
            role="status"
          >
            <p>{t(disabledReason)}</p>
            {farmRunning && model.actions?.stopFarm && (
              <button
                type="button"
                className="secondary-button converter-stop-farm"
                disabled={
                  pending || model.busy || model.farmStatus.phase === "stopping"
                }
                onClick={() => invoke(() => model.actions.stopFarm(), false)}
              >
                <Square size={15} />
                {t(
                  model.farmStatus.phase === "stopping"
                    ? "A parar farm…"
                    : "Parar farm",
                )}
              </button>
            )}
            {!farmRunning && openingRunning && model.actions?.stopOpening && (
              <button
                type="button"
                className="secondary-button"
                disabled={
                  pending || model.busy || model.opening.phase === "stopping"
                }
                onClick={() => invoke(() => model.actions.stopOpening(), false)}
              >
                <Square size={15} />
                {t("Parar abertura")}
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {t(error)}
          </p>
        )}
        {blocked && (
          <p className="converter-pending-note" role="status">
            {t(
              "Há uma operação por confirmar. Verifica o resultado abaixo antes de iniciar outra execução.",
            )}
          </p>
        )}
        <details className="converter-individual">
          <summary>{t("Executar uma etapa individual")}</summary>
          <div>
            {steps.map(({ id, title, Icon }) => (
              <button
                type="button"
                key={id}
                disabled={disabled || (id === "trade" && !destination)}
                onClick={() => start(id)}
              >
                <Icon size={16} />
                {t(title)}
              </button>
            ))}
          </div>
        </details>
      </section>
      <section
        className="panel converter-results"
        aria-labelledby="converter-results-title"
      >
        <div className="section-heading">
          <h2 id="converter-results-title">{t("Progresso por conta")}</h2>
          <span>
            {t(status.rows.length)}
            {t(" contas")}
          </span>
        </div>
        <div aria-live="polite" className="converter-run-message">
          {t(status.message || "Escolhe as origens e o destino para começar.")}
        </div>
        {status.rows.length ? (
          <div className="converter-result-list">
            {status.rows.map((row) => (
              <article className="converter-result" key={row.operationId}>
                <div className="converter-result-heading">
                  <strong>
                    {t(
                      row.sourceLabel || accountsById.get(row.accountId)?.label,
                    )}
                  </strong>
                  <span
                    className={
                      "status-tag" +
                      (row.state === "confirmed"
                        ? " good"
                        : row.state === "unconfirmed"
                          ? " waiting"
                          : row.state === "failed"
                            ? " error"
                            : "")
                    }
                  >
                    {row.state === "confirmed" && <Check size={12} />}{" "}
                    {t(states[row.state] || row.state)}
                  </span>
                </div>
                <p>{t(row.message)}</p>
                <dl className="converter-counts">
                  <div>
                    <dt>{t("Caixas vendidas")}</dt>
                    <dd>{t(formatNumber(row.sold || 0))}</dd>
                  </div>
                  <div>
                    <dt>{t("Cápsulas compradas")}</dt>
                    <dd>{t(formatNumber(row.bought || 0))}</dd>
                  </div>
                  <div>
                    <dt>{t("Cápsulas abertas")}</dt>
                    <dd>{t(formatNumber(row.opened || 0))}</dd>
                  </div>
                  <div>
                    <dt>{t("Stickers convertidos")}</dt>
                    <dd>{t(formatNumber(row.converted || 0))}</dd>
                  </div>
                  <div className="converter-sent">
                    <dt>{t("Tokens recebidos")}</dt>
                    <dd>
                      {t(
                        formatNumber(
                          row.state === "confirmed" ? row.sentTokens || 0 : 0,
                        ),
                      )}
                    </dd>
                  </div>
                </dl>
                {row.state === "unconfirmed" && (
                  <div className="converter-review-actions">
                    <button
                      type="button"
                      disabled={pending || running}
                      onClick={() =>
                        invoke(() =>
                          bridge.verifyTokenConversion(row.operationId),
                        )
                      }
                    >
                      <RefreshCw size={14} />
                      {t("Verificar resultado")}
                    </button>
                    {row.canCancel && (
                      <button
                        type="button"
                        disabled={pending || running}
                        onClick={() =>
                          invoke(() => bridge.cancelTokenTrade(row.operationId))
                        }
                      >
                        {t("Cancelar troca")}
                      </button>
                    )}
                    <a
                      className="text-link"
                      href={
                        row.tradeId
                          ? `https://case-clicker.com/trading/${row.tradeId}`
                          : "https://case-clicker.com/inventory"
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} />
                      {t("Ver no jogo")}
                    </a>
                    <button
                      type="button"
                      disabled={pending || running}
                      onClick={() => setReviewId(row.operationId)}
                    >
                      {t("Já revi no jogo")}
                    </button>
                  </div>
                )}
                {reviewId === row.operationId &&
                  row.state === "unconfirmed" && (
                    <div className="converter-review-note">
                      <p>
                        {t(
                          "Marca apenas depois de verificares a conta e resolveres qualquer troca pendente no jogo. Esta revisão desbloqueia a próxima execução; os tokens não são contabilizados como enviados.",
                        )}
                      </p>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          invoke(() =>
                            bridge.acknowledgeTokenConversion(row.operationId),
                          )
                        }
                      >
                        {t("Marcar como revisto")}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setReviewId(null)}
                      >
                        {t("Voltar")}
                      </button>
                    </div>
                  )}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <ArrowRightLeft size={28} />
            <h3>{t("Ainda não há conversões")}</h3>
            <p>
              {t("O progresso e a confirmação de cada envio aparecem aqui.")}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
