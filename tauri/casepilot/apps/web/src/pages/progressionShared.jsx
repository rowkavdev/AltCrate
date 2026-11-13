import { t } from "../language.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, X, Square } from "lucide-react";
import {
  createScopeGuard,
  createScopedActions,
  AUTOOPEN_LABELS,
  DIAGNOSTIC_FIELDS,
  previewStepLabel,
  displayValue,
  observedAt,
} from "./progressionHelpers.js";
import "./progression.css";
export function useProgressionAccount(model, ui = {}) {
  return (
    model.accounts?.find((account) => account.id === ui.accountId) ||
    model.accounts?.[0] ||
    null
  );
}
export function useProgression({ bridge, accountId, scope, load }) {
  const guardRef = useRef(null);
  if (!guardRef.current) guardRef.current = createScopeGuard();
  const guard = guardRef.current;
  guard.setScope(`${accountId || ""}:${scope || ""}`);
  const key = `${accountId || ""}:${scope || ""}`;
  const actionsRef = useRef(null);
  if (!actionsRef.current) actionsRef.current = createScopedActions();
  const actions = actionsRef.current;
  actions.setScope(key);
  const [stopPending, setStopPending] = useState(false),
    [confirming, setConfirming] = useState(false),
    [resource, setResource] = useState(null),
    [loading, setLoading] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(null),
    [operation, setOperation] = useState(null),
    [status, setStatus] = useState(null);
  const loader = useRef(load);
  loader.current = load;
  const refresh = useCallback(async () => {
    if (!accountId) return;
    const ticket = guard.ticket("read");
    setPreview(null);
    setLoading(true);
    setError("");
    try {
      const data = await loader.current();
      if (guard.current(ticket)) setResource({ key, data });
    } catch (e) {
      if (guard.current(ticket)) setError(String(e.message || e));
    } finally {
      if (guard.current(ticket)) setLoading(false);
    }
  }, [accountId, key, guard]);
  useEffect(() => {
    setResource(null);
    setPreview(null);
    setOperation(null);
    setStatus(null);
    setPending(false);
    setStopPending(false);
    setConfirming(false);
    setError("");
    refresh();
    return () => {
      guard.invalidate();
      actions.invalidate();
    };
  }, [refresh, guard]);
  const perform = (work, onSuccess) =>
    actions.run("action", work, {
      onStart: () => {
        setPending(true);
        setError("");
      },
      onSuccess,
      onError: (e) => setError(String(e.message || e)),
      onEnd: () => {
        setPending(false);
        setConfirming(false);
      },
    });
  const prepare = (kind, payload) =>
    perform(
      async () => {
        if (!bridge?.prepareProgression)
          throw new Error(
            "Esta versão não disponibiliza a revisão de alterações.",
          );
        const result = await bridge.prepareProgression(
          accountId,
          kind,
          payload,
        );
        if (!result?.previewId || result.accountId !== accountId)
          throw new Error(
            "A revisão não corresponde à conta selecionada. Atualiza os dados.",
          );
        return result;
      },
      (value) => setPreview({ key, ...value }),
    );
  const confirm = () => {
    const reviewed = preview;
    if (!reviewed || reviewed.key !== key) return;
    return perform(
      () => {
        setConfirming(true);
        setPreview(null);
        return bridge.confirmProgression(reviewed.previewId);
      },
      (value) => {
        setPreview(null);
        setOperation({ key, ...value });
        setStatus(value);
        if (value?.verified === true) refresh();
      },
    );
  };
  const verify = () =>
    perform(
      () => bridge.verifyProgression(operation.operationId),
      (value) => {
        setOperation({ key, ...value });
        setStatus(value);
        if (value?.verified === true) refresh();
      },
    );
  const stop = () =>
    actions.run("stop", () => bridge.stopProgression(accountId), {
      onStart: () => {
        setStopPending(true);
        setError("");
      },
      onEnd: () => setStopPending(false),
      onError: (e) => setError(String(e.message || e)),
      onSuccess: (value) =>
        setStatus(
          value || {
            state: "stopping",
            message: "A parar antes da próxima alteração…",
          },
        ),
    });
  useEffect(() => {
    if (!accountId || !bridge?.progressionStatus) return;
    let active = true,
      timer;
    const poll = async () => {
      const ticket = guard.ticket("status");
      try {
        const next = await bridge.progressionStatus(accountId);
        if (active && guard.current(ticket)) {
          setStatus(next);
          if (next?.operationId) setOperation({ key, ...next });
          if (
            confirming ||
            ["running", "stopping", "preparing"].includes(next?.state)
          ) {
            timer = setTimeout(poll, 1200);
          } else if (
            next?.verified === true &&
            ["completed", "confirmed", "stopped"].includes(next?.state) &&
            ["running", "stopping"].includes(status?.state)
          )
            refresh();
        }
      } catch (e) {
        if (active && guard.current(ticket)) setError(String(e.message || e));
      }
    };
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [accountId, key, bridge, guard, status?.state, confirming, refresh]);
  const writeDisabled =
    pending ||
    confirming ||
    ["running", "stopping", "preparing", "blocked", "unconfirmed"].includes(
      status?.state,
    );
  return {
    accountId,
    writeDisabled,
    data: resource?.key === key ? resource.data : null,
    loading: loading || (!resource && !error && !!accountId),
    pending,
    stopPending,
    confirming,
    error,
    preview: preview?.key === key ? preview : null,
    operation: operation?.key === key ? operation : null,
    status,
    refresh,
    prepare,
    confirm,
    verify,
    stop,
    closePreview: () => setPreview(null),
  };
}
export function ProgressionHeader({
  title,
  description,
  accounts,
  account,
  controller,
  onUiChange,
}) {
  return (
    <section
      className="panel progression-header progression-toolbar"
      aria-label={t(title)}
    >
      <div className="progression-account">
        <label>
          {t("Conta")}
          <select
            value={account?.id || ""}
            disabled={controller.pending}
            onChange={(e) => onUiChange?.({ accountId: e.target.value })}
          >
            {!accounts?.length && <option value="">{t("Sem contas")}</option>}
            {accounts?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary-button"
          type="button"
          disabled={!account || controller.loading || controller.pending}
          onClick={controller.refresh}
        >
          <RefreshCw size={15} />
          {t(controller.loading && account ? "A consultar…" : "Atualizar")}
        </button>
      </div>
      <small className="read-status">
        {t(controller.data?.readAt ? "Observado: " : "Consulta por conta")}
        {controller.data?.readAt && observedAt(controller.data.readAt)}
      </small>
    </section>
  );
}
export function ProgressionState({ controller, account, model }) {
  const { error, status, pending, stopPending, confirming, operation } =
      controller,
    running =
      confirming ||
      ["running", "stopping", "preparing"].includes(status?.state);
  const interlocked =
    ["running", "stopping"].includes(model?.farmStatus?.phase) ||
    ["running", "stopping"].includes(model?.opening?.phase) ||
    ["preparing", "revalidating", "running", "stopping"].includes(model?.converter?.phase);
  return (
    <>
      {!account && (
        <div className="panel empty-state">
          <h3>{t("Adiciona uma conta")}</h3>
          <p>
            {t("As consultas e alterações ficam associadas à conta escolhida.")}
          </p>
          <a href="#accounts">{t("Gerir contas")}</a>
        </div>
      )}
      {interlocked && (
        <p className="progression-notice">
          {t(
            "Há outra operação em curso. As consultas continuam disponíveis; para alterar a progressão, termina ou para essa operação.",
          )}
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {t(error)}
        </p>
      )}
      {((status?.message && status?.state !== "idle") || confirming) && (
        <div className="panel progression-status" role="status">
          <span>
            <strong>
              {t(
                status?.state === "blocked" || status?.state === "unconfirmed"
                  ? "Resultado por confirmar"
                  : running
                    ? "Operação em curso"
                    : "Estado da operação",
              )}
            </strong>
            <p>{t(status?.message || "A confirmar a sequência revista…")}</p>
            {Number.isFinite(status?.total) && (
              <small>
                {t(status.completed || 0)}
                {t(" de ")}
                {t(status.total)}
                {t(" alterações")}
              </small>
            )}
          </span>
          {running && (
            <button
              className="stop-button"
              type="button"
              disabled={stopPending || status?.state === "stopping"}
              onClick={controller.stop}
            >
              <Square size={15} />
              {t(
                stopPending || status?.state === "stopping"
                  ? "A parar…"
                  : "Parar sequência",
              )}
            </button>
          )}
          {operation?.operationId &&
            operation.verified !== true &&
            !running && (
              <button
                className="secondary-button"
                disabled={pending}
                onClick={controller.verify}
              >
                {t("Verificar resultado")}
              </button>
            )}
        </div>
      )}
    </>
  );
}
export function ReadTime({ value }) {
  return (
    <p className="form-note">
      {t("Observado: ")}
      {t(observedAt(value))}
      {t(
        ". O servidor volta a validar os requisitos antes de qualquer alteração.",
      )}
    </p>
  );
}
export function PreviewDialog({
  preview,
  pending,
  error,
  onClose,
  onConfirm,
  accountLabel,
}) {
  const ref = useRef(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector("button")?.focus();
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const items = [
            ...ref.current.querySelectorAll(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
            ),
          ],
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="detail-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <section
        className="account-details progression-review"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="progression-review-title"
      >
        <header>
          <div>
            <span className="kicker">{t("REVER ANTES DE ALTERAR")}</span>
            <h2 id="progression-review-title">
              {t(preview.title || "Confirmar alteração")}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("Fechar revisão")}
            disabled={pending}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <p>
          {t("Conta: ")}
          <strong>{accountLabel}</strong>
        </p>
        <dl className="progression-totals">
          {[
            ["Dinheiro virtual a gastar", preview.cost],
            ["Pontos a gastar", preview.pointCost],
            ["Reembolso virtual", preview.refund],
            ["Perda virtual do reset", preview.loss],
          ]
            .filter(([, value]) => value != null)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{t(label)}</dt>
                <dd>{t(displayValue(value))}</dd>
              </div>
            ))}
        </dl>
        {preview.steps?.length > 0 && (
          <>
            <h3>{t("Sequência revista")}</h3>
            <ol className="progression-preview-steps">
              {preview.steps.map((step, index) => (
                <li key={index}>{t(previewStepLabel(step))}</li>
              ))}
            </ol>
          </>
        )}
        {preview.changes?.length > 0 && (
          <ChangesTable changes={preview.changes} />
        )}{" "}
        {preview.kind === "autoopen" && !preview.changes?.length && (
          <p>{t("Sem diferenças nos campos documentados.")}</p>
        )}
        <div className="progression-warnings">
          {preview.warnings?.map((warning, index) => (
            <p key={index}>{t(displayValue(warning))}</p>
          ))}
        </div>
        {error && (
          <p role="alert" className="inline-error">
            {t(error)}
          </p>
        )}
        <p className="form-note">
          {t(
            "Só esta confirmação envia a alteração. Uma resposta inconclusiva exige verificação antes de continuar.",
          )}
        </p>
        <footer>
          <button
            className="secondary-button"
            disabled={pending}
            onClick={onClose}
          >
            {t("Voltar")}
          </button>
          <button
            className="primary-button"
            disabled={pending}
            onClick={onConfirm}
          >
            {t(pending ? "A confirmar…" : "Confirmar alteração")}
          </button>
        </footer>
      </section>
    </div>
  );
}
export function ChangesTable({ changes }) {
  return (
    <div className="progression-table-wrap">
      <table className="progression-table">
        <thead>
          <tr>
            <th>{t("Campo")}</th>
            <th>{t("Antes")}</th>
            <th>{t("Depois")}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change, index) => (
            <tr key={index}>
              <th>
                {t(
                  change.label ||
                    AUTOOPEN_LABELS[change.field] ||
                    DIAGNOSTIC_FIELDS[change.field] ||
                    "Configuração revista",
                )}
              </th>
              <td>{t(displayValue(change.before))}</td>
              <td>{t(displayValue(change.after))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
