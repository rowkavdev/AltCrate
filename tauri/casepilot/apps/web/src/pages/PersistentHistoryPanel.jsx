import { accountIndex } from "../workspaceViewModel.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getLocale, t } from "../language.js";
const outcomes = {
  confirmed: "Confirmado",
  failed: "Falhado",
  cancelled: "Cancelado",
  unconfirmed: "Por confirmar",
  running: "Em curso",
};
const kinds = {
  reward: "Recompensa",
  mission: "Missão",
  pass: "Passe mensal",
  "skill-buy": "Comprar habilidade",
  "skill-sell": "Vender habilidade",
  "skill-preset": "Preset de habilidades",
  autoopen: "Preferências do site",
  sell: "Venda",
  withdraw: "Retirada",
  transfer: "Envio",
  "move-to-storage": "Mover para storage",
  convert: "Conversão",
  conversion: "Conversão",
  case: "Caixas",
  money: "Dinheiro",
  open: "Abertura",
  vault: "Cofre",
  boost: "Boost",
  purchase: "Compra",
  game: "Jogo",
  "inventory-action": "Inventário",
  progression: "Progressão",
  "token-converter": "Conversor",
  "opening-item": "Regra local",
  cooldown: "Limite da API",
  "account-error": "Erro de conta",
};
export default function PersistentHistoryPanel({ model }) {
  const [filters, setFilters] = useState({
      accountId: "all",
      kind: "all",
      result: "all",
      from: "",
      to: "",
      offset: 0,
    }),
    [data, setData] = useState({ rows: [], total: 0 }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (!model.bridge?.queryOperationHistory) return;
    const n = ++seq.current;
    setBusy(true);
    model.bridge
      .queryOperationHistory({
        ...filters,
        from: filters.from
          ? new Date(filters.from + "T00:00:00").toISOString()
          : undefined,
        to: filters.to
          ? new Date(filters.to + "T23:59:59.999").toISOString()
          : undefined,
        limit: 100,
      })
      .then((v) => {
        if (seq.current === n) {
          setData(v);
          setError("");
        }
      })
      .catch((e) => {
        if (seq.current === n) setError(e.message);
      })
      .finally(() => {
        if (seq.current === n) setBusy(false);
      });
    return () => {
      seq.current++;
    };
  }, [model.bridge, JSON.stringify(filters), revision]);
  const accountsById = useMemo(
    () => accountIndex(model.accounts),
    [model.accounts],
  );
  const patch = (value) =>
    setFilters((old) => ({ ...old, ...value, offset: 0 }));
  return (
    <section className="panel persistent-history">
      <div className="section-heading">
        <div>
          <h2>{t("Histórico entre sessões")}</h2>
          <p className="form-note">
            {t("Retenção: ")}
            {data.retentionDays || 90} {t("dias, até ")}
            {data.maxEntries || 20000}{" "}
            {t(
              "eventos. Valores observados não representam lucro atribuído à operação.",
            )}
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={!model.bridge?.exportOperationHistory || busy}
          onClick={() =>
            model.bridge
              .exportOperationHistory()
              .then((path) => {
                if (path) model.setNotice("Histórico exportado para " + path);
              })
              .catch((e) => setError(e.message))
          }
        >
          {t("Exportar histórico")}
        </button>
      </div>
      <div className="toolbar">
        <label>
          {t("Conta")}
          <select
            value={filters.accountId}
            onChange={(e) => patch({ accountId: e.target.value })}
          >
            <option value="all">{t("Todas as contas")}</option>
            {model.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Operação")}
          <select
            value={filters.kind}
            onChange={(e) => patch({ kind: e.target.value })}
          >
            <option value="all">{t("Todas as operações")}</option>
            {Object.entries(kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Resultado")}
          <select
            value={filters.result}
            onChange={(e) => patch({ result: e.target.value })}
          >
            <option value="all">{t("Todos os resultados")}</option>
            {Object.entries(outcomes).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Desde")}
          <input
            type="date"
            value={filters.from}
            onChange={(e) => patch({ from: e.target.value })}
          />
        </label>
        <label>
          {t("Até")}
          <input
            type="date"
            value={filters.to}
            onChange={(e) => patch({ to: e.target.value })}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRevision((v) => v + 1)}
        >
          {t("Atualizar histórico")}
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <p role="status">
        {busy ? t("A consultar…") : data.total + " " + t("eventos encontrados")}
      </p>
      {data.rows.length ? (
        <div className="progression-table-wrap">
          <table className="progression-table">
            <thead>
              <tr>
                <th>{t("Observação")}</th>
                <th>{t("Conta")}</th>
                <th>{t("Operação")}</th>
                <th>{t("Resultado")}</th>
                <th>{t("Valores observados")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {new Date(row.at).toLocaleString(getLocale())}
                    {row.durationMs != null && (
                      <small>{row.durationMs} ms</small>
                    )}
                  </td>
                  <td>
                    {accountsById.get(row.accountId)?.label ||
                      row.accountId ||
                      "—"}
                  </td>
                  <td>{t(kinds[row.kind] || kinds[row.type] || "Operação")}</td>
                  <td>
                    {t(outcomes[row.result] || "Por confirmar")}
                    {row.interrupted && (
                      <small>
                        {t("Aplicação interrompida; verificar operação.")}
                      </small>
                    )}
                    {row.httpStatus && <small>HTTP {row.httpStatus}</small>}
                  </td>
                  <td>
                    {Object.entries(row.values || {}).map(([key, value]) => (
                      <small key={key}>
                        {t(
                          {
                            sold: "Caixas vendidas",
                            bought: "Cápsulas compradas",
                            opened: "Cápsulas abertas",
                            converted: "Itens convertidos",
                            reviewedCost: "Custo revisto",
                            cost: "Custo",
                            price: "Preço",
                            refund: "Reembolso",
                            pointCost: "Pontos",
                            completed: "Passos concluídos",
                            total: "Passos",
                            observedMoney: "Saldo observado",
                            observedTokens: "Tokens observados",
                            moneyDelta: "Diferença de saldo",
                            tokenDelta: "Diferença de tokens",
                            verifiedDelta: "Diferença observada",
                            confirmedDelta: "Crédito observado",
                            openedCount: "Aberturas",
                            skinCount: "Itens",
                            clicks: "Cliques",
                            quantity: "Quantidade",
                            acceptedCount: "Aceites",
                            confirmedCount: "Confirmadas",
                            unconfirmedCount: "Por confirmar",
                            requestedCount: "Pedidos",
                            selectedCaseDelta: "Diferença de stock",
                            observedCaseDelta: "Diferença de caixas",
                            awardedCount: "Caixas recebidas",
                            sentTokens: "Tokens enviados",
                          }[key] || "Valor",
                        )}
                        : {value}{" "}
                      </small>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-history">
          <strong>{t("Sem operações para estes filtros")}</strong>
          <p>{t("Atualiza o histórico ou escolhe outro intervalo.")}</p>
        </div>
      )}
      {data.total > 100 && (
        <div className="run-actions">
          <button
            type="button"
            disabled={busy || !filters.offset}
            onClick={() =>
              setFilters((f) => ({ ...f, offset: Math.max(0, f.offset - 100) }))
            }
          >
            {t("Anterior")}
          </button>
          <button
            type="button"
            disabled={busy || filters.offset + 100 >= data.total}
            onClick={() =>
              setFilters((f) => ({ ...f, offset: f.offset + 100 }))
            }
          >
            {t("Seguinte")}
          </button>
        </div>
      )}
    </section>
  );
}
