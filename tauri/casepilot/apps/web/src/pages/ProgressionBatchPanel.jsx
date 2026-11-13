import { DisclosurePanel } from "../components/WorkspaceSection.jsx";
import { accountIndex } from "../workspaceViewModel.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../language.js";
import { claimAllRewards } from "./claimAllRewards.js";
const labels = {
  reward: "Recompensa",
  mission: "Missão",
  pass: "Passe mensal",
  "skill-preset": "Preset de habilidades",
  ready: "Revista",
  available: "Disponível",
  unavailable: "Indisponível",
  expired: "Expirada",
  failed: "Falhada",
  sending: "A enviar",
  confirmed: "Concluída",
  cancelled: "Cancelada",
  unconfirmed: "Por confirmar",
};
export default function ProgressionBatchPanel({
  model,
  accountId,
  mode = "claims",
  presets = [],
  disabled = false,
  onBusyChange,
  onComplete,
}) {
  const bridge = model.bridge,
    [scope, setScope] = useState(
      model.selectedIds?.length ? "selected" : "one",
    ),
    [rows, setRows] = useState([]),
    [chosen, setChosen] = useState([]),
    [batch, setBatch] = useState(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [presetId, setPreset] = useState(""),
    [reset, setReset] = useState(false);
  const active = ["running", "stopping"].includes(batch?.phase),
    mounted = useRef(true),
    ticket = useRef(0);
  const claiming = useRef(false),
    cancelClaim = useRef(false),
    [claimingAll, setClaimingAll] = useState(false),
    [claimResult, setClaimResult] = useState(null);
  const ids =
    scope === "one" ? [accountId].filter(Boolean) : model.selectedIds || [];
  useEffect(() => {
    mounted.current = true;
    bridge
      ?.progressionBatchStatus?.()
      .then((value) => {
        if (mounted.current) setBatch(value);
      })
      .catch((e) => {
        if (mounted.current) setError(e.message);
      });
    const off = bridge?.onEvent?.((e) => {
      if (e.type === "progression-batch") setBatch(e.batch);
    });
    return () => {
      mounted.current = false;
      cancelClaim.current = true;
      ticket.current++;
      off?.();
    };
  }, [bridge]);
  useEffect(() => {
    cancelClaim.current = true;
    ticket.current++;
    setRows([]);
    setChosen([]);
    setReset(false);
  }, [ids.join("|"), mode]);
  async function work(fn) {
    if (pending) return;
    const n = ++ticket.current;
    setPending(true);
    setError("");
    try {
      const value = await fn();
      return mounted.current && ticket.current === n ? value : null;
    } catch (e) {
      if (mounted.current) setError(String(e.message || e));
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  async function scan() {
    const value = await work(() =>
      bridge.discoverProgressionBatch({
        accountIds: ids,
        kinds: ["reward", "mission", "pass"],
      }),
    );
    if (value) {
      setRows(value);
      setChosen(value.flatMap((r, i) => (r.eligible ? [i] : [])));
    }
  }
  async function review() {
    const actions =
      mode === "skills"
        ? ids.map((id) => ({
            accountId: id,
            kind: "skill-preset",
            payload: { presetId, reset },
          }))
        : chosen.map((i) => ({
            accountId: rows[i].accountId,
            kind: rows[i].kind,
            payload: rows[i].payload,
          }));
    const value = await work(() => bridge.prepareProgressionBatch({ actions }));
    if (value) setBatch(value);
  }
  async function claimAll() {
    if (claiming.current || pending || blocked || !ids.length) return;
    claiming.current = true;
    cancelClaim.current = false;
    setClaimingAll(true);
    setPending(true);
    setError("");
    setClaimResult(null);
    setRows([]);
    setChosen([]);
    onBusyChange?.(true);
    try {
      const result = await claimAllRewards({
        bridge,
        accountIds: [...ids],
        shouldStop: () => cancelClaim.current || !mounted.current,
        onBatch: (value) => {
          if (mounted.current) setBatch(value);
        },
      });
      if (mounted.current) setClaimResult(result);
    } catch (e) {
      if (mounted.current) setError(String(e.message || e));
    } finally {
      claiming.current = false;
      if (mounted.current) {
        setClaimingAll(false);
        setPending(false);
        onBusyChange?.(false);
        onComplete?.();
      }
    }
  }
  function stopAll() {
    cancelClaim.current = true;
    if (
      batch?.batchId &&
      ["review", "running", "stopping"].includes(batch.phase)
    )
      bridge
        .stopProgressionBatch(batch.batchId)
        .then((value) => {
          if (mounted.current) setBatch(value);
        })
        .catch((e) => {
          if (mounted.current) setError(e.message);
        });
  }
  const accountsById = useMemo(
    () => accountIndex(model.accounts),
    [model.accounts],
  );
  const available = !!bridge?.prepareProgressionBatch,
    blocked = active || batch?.phase === "blocked" || disabled;
  return (
    <DisclosurePanel
      title={
        mode === "skills"
          ? "Presets em várias contas"
          : "Recolhas em várias contas"
      }
      badge={ids.length + " " + t("contas")}
      forceOpen={
        active || claimingAll || ["review", "blocked"].includes(batch?.phase)
      }
      description="Selecionar contas, rever o lote e acompanhar a confirmação."
    >
      <section
        className="panel progression-batch"
        aria-label={t(
          mode === "skills" ? "Presets em várias contas" : "Recolhas em lote",
        )}
      >
        <div className="section-heading">
          <div>
            <h3>
              {t(
                mode === "skills"
                  ? "Presets em várias contas"
                  : "Recolhas em lote",
              )}
            </h3>
            <p className="form-note">
              {t(
                "Cada conta é revista com os seus requisitos. A execução é sequencial e verifica cada alteração.",
              )}
            </p>
          </div>
          <span className="status-tag">
            {ids.length} {t("contas")}
          </span>
        </div>
        <div className="toolbar">
          <label>
            {t("Âmbito")}
            <select
              value={scope}
              disabled={pending || blocked}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="selected">
                {t("Contas selecionadas em Contas")}
              </option>
              <option value="one">{t("Só a conta apresentada")}</option>
            </select>
          </label>
          {ids.length ? (
            <details className="progression-scope-accounts">
              <summary>
                {t("Ver contas abrangidas")} ({ids.length})
              </summary>
              <ul>
                {ids.map((id) => (
                  <li key={id}>{accountsById.get(id)?.label || id}</li>
                ))}
              </ul>
            </details>
          ) : (
            <span>{t("Seleciona contas na página Contas.")}</span>
          )}
        </div>
        {mode === "claims" && (
          <>
            <div className="toolbar">
              <button
                type="button"
                className="primary-button"
                disabled={
                  !available ||
                  !bridge?.discoverProgressionBatch ||
                  !bridge?.confirmProgressionBatch ||
                  !ids.length ||
                  pending ||
                  blocked
                }
                onClick={claimAll}
              >
                {t(claimingAll ? "A resgatar…" : "Resgatar todas")}
              </button>
              {claimingAll && (
                <button type="button" className="stop-button" onClick={stopAll}>
                  {t("Parar resgate")}
                </button>
              )}
            </div>
            <p className="form-note">
              {t(
                "Resgata todas as recompensas disponíveis, missões diárias e semanais e passe mensal gratuito e Premium ativo nas contas deste âmbito.",
              )}
            </p>
            {claimResult && (
              <p role="status">
                {t("Recompensas resgatadas: ")}
                {claimResult.confirmed}
                {claimResult.confirmed === 0 &&
                  !claimResult.batch &&
                  " · " + t("Sem recompensas disponíveis.")}
              </p>
            )}
          </>
        )}
        {mode === "skills" ? (
          <>
            <label>
              {t("Preset de habilidades")}
              <select
                value={presetId}
                disabled={pending || blocked}
                onChange={(e) => setPreset(e.target.value)}
              >
                <option value="">{t("Escolher preset…")}</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={reset}
                disabled={pending || blocked}
                onChange={(e) => setReset(e.target.checked)}
              />
              {t(
                "Incluir venda das habilidades atuais antes de aplicar o preset",
              )}
            </label>
            {reset && (
              <p className="progression-notice">
                {t(
                  "Cada venda devolve metade do custo. A revisão mostra perda e dependências por conta.",
                )}
              </p>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="secondary-button"
              disabled={!available || !ids.length || pending || blocked}
              onClick={scan}
            >
              {t(
                pending
                  ? "A consultar…"
                  : "Consultar recompensas, missões e passe",
              )}
            </button>
            {rows.length > 0 && (
              <>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={
                      chosen.length === rows.filter((r) => r.eligible).length &&
                      chosen.length > 0
                    }
                    disabled={pending || blocked}
                    onChange={(e) =>
                      setChosen(
                        e.target.checked
                          ? rows.flatMap((r, i) => (r.eligible ? [i] : []))
                          : [],
                      )
                    }
                  />
                  {t("Selecionar todas as elegíveis")}
                </label>
                <ul className="skill-node-list">
                  {rows.map((row, i) => (
                    <li key={i}>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={chosen.includes(i)}
                          disabled={!row.eligible || pending || blocked}
                          onChange={(e) =>
                            setChosen((old) =>
                              e.target.checked
                                ? [...old, i]
                                : old.filter((n) => n !== i),
                            )
                          }
                        />
                        <span>
                          <strong>
                            {row.label} · {t(labels[row.kind] || row.kind)} ·{" "}
                            {row.title}
                          </strong>
                          <small>
                            {t(labels[row.state] || row.state)}
                            {row.message ? " · " + row.message : ""}
                          </small>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <button
          type="button"
          className="secondary-button"
          disabled={
            !available ||
            pending ||
            blocked ||
            !ids.length ||
            (mode === "skills" ? !presetId : !chosen.length)
          }
          onClick={review}
        >
          {t("Rever lote antes de executar")}
        </button>
        {batch?.rows?.length > 0 && (
          <div className="progression-table-wrap">
            <h4>
              {t(
                batch.phase === "review"
                  ? "Revisão do lote"
                  : "Resultado do lote",
              )}
            </h4>
            <p>
              {t("Contas afetadas: ")}
              {[
                ...new Set(
                  batch.rows.map((r) => r.accountLabel || r.accountId),
                ),
              ].join(", ")}
            </p>
            <table className="progression-table">
              <thead>
                <tr>
                  <th>{t("Conta e ação")}</th>
                  <th>{t("Custos observados")}</th>
                  <th>{t("Estado")}</th>
                </tr>
              </thead>
              <tbody>
                {batch.rows.map((row) => (
                  <tr key={row.rowId}>
                    <td>
                      {row.accountLabel}
                      <br />
                      {row.title || t(labels[row.kind])}
                      {row.preview?.steps?.length > 0 && (
                        <details>
                          <summary>
                            {row.preview.steps.length} {t("passos revistos")}
                          </summary>
                          <ol>
                            {row.preview.steps.map((step, i) => (
                              <li key={i}>
                                {step.name || step.key || t(labels[step.kind])}
                                {step.requiredPrevSkillId
                                  ? " · Requer " + step.requiredPrevSkillId
                                  : ""}
                                {Number.isFinite(step.cost)
                                  ? " · Custo " + step.cost
                                  : ""}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </td>
                    <td>
                      {row.cost ?? "—"} {t("dinheiro virtual")}
                      <br />
                      {row.pointCost ?? "—"} {t("pontos")}
                      {row.refund > 0 && (
                        <>
                          <br />
                          {t("Reembolso: ")}
                          {row.refund} · {t("Perda: ")}
                          {row.loss}
                        </>
                      )}
                    </td>
                    <td>
                      {t(labels[row.state] || row.state)}
                      {row.message && <small>{t(row.message)}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {batch.phase === "review" && !claimingAll && (
              <>
                <p className="form-note">
                  {t(
                    "A revisão tem validade de cinco minutos. Só a confirmação envia as ações acima; os requisitos voltam a ser verificados.",
                  )}
                </p>
                <button
                  type="button"
                  className="primary-button"
                  disabled={
                    pending || !batch.rows.some((r) => r.state === "ready")
                  }
                  onClick={() =>
                    work(() =>
                      bridge.confirmProgressionBatch(batch.batchId),
                    ).then((v) => {
                      if (v) setBatch(v);
                    })
                  }
                >
                  {t("Confirmar execução do lote")}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pending}
                  onClick={() =>
                    bridge
                      .stopProgressionBatch(batch.batchId)
                      .then(setBatch)
                      .catch((e) => setError(e.message))
                  }
                >
                  {t("Cancelar revisão")}
                </button>
              </>
            )}
            {active && (
              <button
                type="button"
                className="stop-button"
                onClick={() =>
                  bridge
                    .stopProgressionBatch(batch.batchId)
                    .then(setBatch)
                    .catch((e) => setError(e.message))
                }
              >
                {t("Parar novos envios e verificar o atual")}
              </button>
            )}
            {batch.phase === "blocked" && (
              <button
                type="button"
                className="secondary-button"
                disabled={pending}
                onClick={() =>
                  work(() => bridge.verifyProgressionBatch(batch.batchId)).then(
                    (v) => {
                      if (v) setBatch(v);
                    },
                  )
                }
              >
                {t("Verificar resultados pendentes")}
              </button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {t(error)}
          </p>
        )}
      </section>
    </DisclosurePanel>
  );
}
