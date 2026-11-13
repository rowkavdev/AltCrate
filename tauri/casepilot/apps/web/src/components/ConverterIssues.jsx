import React, { useState } from "react"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { t } from "../language.js"
const titles = {
  "mode-scope": "A seleção mudou",
  autosell: "Venda automática ativa",
  "inventory-full": "Inventário cheio",
  membership: "Tipo de conta por verificar",
  "read-failed": "Não foi possível verificar a conta",
  "account-missing": "Conta indisponível",
  "rate-limit": "Limite do site",
  unconfirmed: "Resultados por confirmar",
  "saved-items": "Itens guardados para continuar",
  busy: "Outra operação em curso",
  "no-steps": "Faltam etapas",
  "no-accounts": "Faltam contas",
  "no-main": "Falta a conta principal",
}
const labels = {
  "reset-mode": "Usar a nova seleção",
  preferences: "Abrir preferências",
  "remove-open": "Retirar etapa de abertura",
  "saved-stickers": "Rever stickers guardados",
  refresh: "Verificar novamente",
  accounts: "Abrir contas",
  continue: "Continuar contas aptas",
  verify: "Verificar resultados",
  steps: "Escolher etapas",
  "select-accounts": "Selecionar contas",
  main: "Escolher principal",
}
export default function ConverterIssues({
  issues,
  checking,
  paused,
  checkedAt,
  disabled,
  onAction,
  onRefresh,
  focusRef,
}) {
  const [preferenceAccounts, setPreferenceAccounts] = useState({})
  const hasBlocking = issues.some((issue) => issue.blocking !== false)
  const grouped = new Map()
  for (const issue of issues) {
    const group = grouped.get(issue.code) || {
      ...issue,
      accounts: [],
      perAccount: [],
    }
    if (issue.label) {
      group.accounts.push(issue.label)
      group.perAccount.push(issue)
    }
    grouped.set(issue.code, group)
  }
  return (
    <section
      ref={focusRef}
      tabIndex={-1}
      id="converter-issues"
      className="converter-issues"
      aria-label={t("Verificação antes de iniciar")}
    >
      <header>
        <div>
          {checking ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : hasBlocking ? (
            <AlertTriangle size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}
          <strong>
            {t(
              paused
                ? "Leitura automática parada"
                : checking
                  ? "A verificar as contas…"
                  : hasBlocking
                    ? "Antes de iniciar"
                    : "Podes continuar"
            )}
          </strong>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || checking}
          onClick={onRefresh}
        >
          <RefreshCw size={13} />
          {t("Verificar novamente")}
        </Button>
      </header>
      {paused && (
        <p>
          {t(
            "Podes escolher outras etapas. A revisão confirma os dados antes de iniciar."
          )}
        </p>
      )}
      {checking && !issues.length && (
        <p>
          {t(
            "A consultar as condições das etapas escolhidas. Não são executadas operações."
          )}
        </p>
      )}
      {[...grouped.values()].map((issue) => (
        <div className="converter-issue" key={issue.code}>
          <strong>
            {t(titles[issue.code] || "Verificação necessária")}
            {issue.accounts.length > 1 && (
              <span>
                {" "}
                · {issue.accounts.length} {t("contas")}
              </span>
            )}
          </strong>
          <p>{t(issue.message)}</p>
          {!!issue.accounts.length && (
            <details>
              <summary>
                {issue.accounts.length === 1
                  ? issue.accounts[0]
                  : `${issue.accounts.length} ${t("contas afetadas")}`}
              </summary>
              {issue.accounts.map((label) => (
                <p key={label}>{label}</p>
              ))}
            </details>
          )}
          <div className="converter-issue-actions">
            {issue.actions?.map((action) =>
              action === "preferences" && issue.perAccount.length > 1 ? (
                <React.Fragment key={action}>
                  <NativeSelect
                    aria-label={t("Conta para abrir preferências")}
                    value={preferenceAccounts[issue.code] || ""}
                    onChange={(event) =>
                      setPreferenceAccounts({
                        ...preferenceAccounts,
                        [issue.code]: event.target.value,
                      })
                    }
                  >
                    <NativeSelectOption value="">
                      {t("Escolher conta…")}
                    </NativeSelectOption>
                    {issue.perAccount.map((account) => (
                      <NativeSelectOption
                        key={account.accountId}
                        value={account.accountId}
                      >
                        {account.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      disabled ||
                      !issue.perAccount.some(
                        (account) =>
                          account.accountId === preferenceAccounts[issue.code]
                      )
                    }
                    onClick={() =>
                      onAction(
                        action,
                        issue.perAccount.find(
                          (account) =>
                            account.accountId === preferenceAccounts[issue.code]
                        )
                      )
                    }
                  >
                    {t(labels[action])}
                  </Button>
                </React.Fragment>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  key={action}
                  onClick={() => onAction(action, issue)}
                >
                  {t(labels[action] || action)}
                </Button>
              )
            )}
          </div>
        </div>
      ))}
      {!checking && !issues.length && checkedAt && (
        <p>
          {t(
            "Condições verificadas. A revisão confirma os dados atuais antes de iniciar."
          )}
        </p>
      )}
    </section>
  )
}
