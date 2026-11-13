import React, { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { formatMoney, formatNumber } from "../format.js";
import { t } from "../language.js";
export default function AccountTable({ accounts, model, states, onUiChange }) {
  const selected = useMemo(
    () => new Set(model.selectedIds || []),
    [model.selectedIds],
  );
  const locked = model.busy || model.running;
  return (
    <div className="account-list">
      <table className="account-table">
        <thead>
          <tr>
            <th>{t("Conta")}</th>
            <th>{t("Saldo virtual")}</th>
            <th>{t("Caixas")}</th>
            <th>{t("Ações")}</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => {
            const snapshot = model.snapshots[account.id],
              needsLogin = states.get(account.id)?.needsLogin;
            const label = needsLogin
              ? "Precisa de login"
              : snapshot?.error
                ? account.email
                  ? "Importada · entrar para validar"
                  : "Leitura falhou"
                : snapshot
                  ? "Ligada"
                  : account.email
                    ? "Importada · sessão por validar"
                    : "A aguardar leitura";
            return (
              <tr className="account-row" key={account.id}>
                <td className="account-name-cell">
                  <label>
                    <input
                      type="checkbox"
                      aria-label={t("Selecionar " + account.label)}
                      checked={selected.has(account.id)}
                      disabled={locked || !model.setSelectedIds}
                      onChange={() =>
                        model.setSelectedIds((old) =>
                          old.includes(account.id)
                            ? old.filter((id) => id !== account.id)
                            : [...old, account.id],
                        )
                      }
                    />
                    <span>
                      <strong>{account.label}</strong>
                      <small
                        className={
                          "account-session " +
                          (needsLogin || snapshot?.error
                            ? "error"
                            : snapshot
                              ? "good"
                              : "")
                        }
                      >
                        {t(label)}
                      </small>
                      {snapshot?.error && (
                        <small className="account-error">
                          {t(snapshot.error)}
                        </small>
                      )}
                    </span>
                  </label>
                </td>
                <td className="account-money" data-label={t("Saldo virtual")}>
                  {t(formatMoney(snapshot?.money))}
                </td>
                <td className="account-cases" data-label={t("Caixas")}>
                  {t(formatNumber(snapshot?.casesTotal))}
                </td>
                <td className="account-actions">
                  <button
                    type="button"
                    disabled={locked || !model.bridge?.connectAccount}
                    onClick={() => model.actions.connectAccount?.(account)}
                  >
                    {t("Entrar")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onUiChange({ detailId: account.id })}
                  >
                    {t("Detalhes")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("Atualizar " + account.label)}
                    disabled={model.busy}
                    onClick={() => model.actions.refreshAccount?.(account.id)}
                  >
                    <RefreshCw size={15} />
                  </button>
                  <details className="row-more">
                    <summary aria-label={t("Mais ações de " + account.label)}>
                      ···
                    </summary>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => model.actions.removeAccount?.(account)}
                    >
                      {t("Remover")}
                    </button>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
