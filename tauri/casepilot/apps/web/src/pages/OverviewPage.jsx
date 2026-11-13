import React, { useMemo } from "react"
import {
  Users,
  Boxes,
  Wallet,
  Coins,
  Zap,
  ArrowUpRight,
  RefreshCw,
  CircleCheck,
  CircleAlert,
  Square,
  Activity,
} from "lucide-react"
import { accountIndex } from "../workspaceViewModel.js"
import { useOverviewRefresh } from "../useOverviewRefresh.js"
import { t } from "../language.js"
import { formatMoney, formatNumber, formatTime } from "../format.js"
import EventRow from "../components/EventRow.jsx"
import { Card } from "@workspace/ui/components/card"
import { Button } from "@workspace/ui/components/button"
import OperationSummary from "../components/OperationSummary.jsx"
import "./overview.css"

function ReadingStatus({ model, readings, automatic, onNavigate }) {
  const status = model.refreshStatus || { phase: "idle" }
  const running = ["running", "stopping"].includes(status.phase)
  const paused = status.phase === "paused"
  const remaining = Math.max(
    0,
    Math.ceil(((status.retryAt || 0) - (model.now || Date.now())) / 1000)
  )
  const locked = model.loading || model.busy || model.running
  const canRead = model.accounts.some(
    (account) => !account.session || account.session.reusable
  )
  const Icon = running
    ? RefreshCw
    : paused || readings.failed
      ? CircleAlert
      : readings.read
        ? CircleCheck
        : RefreshCw
  const title = running
    ? t(`A atualizar ${status.processed || 0} de ${status.total} contas`)
    : paused
      ? t("Atualização em pausa")
      : status.phase === "stopped"
        ? t("Atualização interrompida")
        : readings.read
          ? t(`Dados de ${readings.read} de ${readings.total} contas`)
          : t("Carrega os totais das tuas contas")
  return (
    <div className={"overview-reading-status" + (paused ? " is-paused" : "")}>
      <span
        className={"overview-reading-icon" + (running ? " is-reading" : "")}
      >
        <Icon size={17} aria-hidden="true" />
      </span>
      <div className="overview-reading-copy">
        <strong role="status" aria-live="polite">
          {title}
        </strong>
        <p>
          {running ? (
            t("As leituras aparecem à medida que ficam prontas.")
          ) : paused ? (
            t(status.error || "Aguarda antes de voltar a atualizar.")
          ) : status.failed ? (
            t(
              `${status.succeeded || 0} atualizadas · ${status.failed} sem leitura. Os últimos valores foram conservados.`
            )
          ) : readings.latestAt ? (
            <>
              {t("Última leitura")} {formatTime(readings.latestAt)}
              {status.phase !== "complete"
                ? ` · ${t("Valores guardados neste dispositivo")}`
                : ""}
            </>
          ) : readings.read ? (
            t("Valores guardados neste dispositivo")
          ) : (
            t("Consulta caixas, saldo e tokens nas sessões já guardadas.")
          )}
        </p>
        <span className="overview-auto-refresh">
          {t(automatic.paused ? "Atualização automática em pausa" : "Atualização automática · a cada 5 min, com esta página visível")}
        </span>
        {running && (
          <div
            className="overview-progress"
            role="progressbar"
            aria-label={t("Progresso da atualização")}
            aria-valuemin={0}
            aria-valuemax={status.total || 1}
            aria-valuenow={status.processed || 0}
          >
            <span
              style={{
                width:
                  Math.min(
                    100,
                    ((status.processed || 0) / (status.total || 1)) * 100
                  ) + "%",
              }}
            />
          </div>
        )}
        {remaining > 0 && (
          <small>
            {t("Nova leitura disponível em")} {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, "0")}
          </small>
        )}
      </div>
      {running ? (
        <Button
          variant="outline"
          size="sm"
          disabled={status.phase === "stopping"}
          onClick={model.actions.stopRefresh}
        >
          <Square size={12} />
          {t(status.phase === "stopping" ? "A parar…" : "Parar leitura")}
        </Button>
      ) : paused && status.errorStatus === 403 ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate("accounts")}
        >
          {t("Ver contas")}
        </Button>
      ) : paused || status.phase === "stopped" ? (
        <Button
          variant="outline"
          size="sm"
          disabled={locked || remaining > 0 || !canRead}
          onClick={() => model.actions.refreshAccounts({ remaining: true })}
        >
          {t("Retomar leitura")}
        </Button>
      ) : !readings.read && model.accounts.length ? (
        <Button
          variant="outline"
          size="sm"
          disabled={locked || !canRead}
          onClick={() => model.actions.refreshAccounts()}
        >
          {t("Carregar totais")}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNavigate("accounts")}
        >
          {t("Ver contas")}
          <ArrowUpRight size={14} />
        </Button>
      )}
    </div>
  )
}

export default function OverviewPage({ model, onNavigate }) {
  const automatic = useOverviewRefresh(model)
  const { accounts, snapshots, farmStatus, events, awards, loading } = model
  const accountsById = useMemo(() => accountIndex(accounts), [accounts])
  const readings = model.readings
  const connected = readings.connected
  const countNote = (field) =>
    !accounts.length
      ? t("Ainda sem contas")
      : !field.count
        ? t("À espera da primeira leitura")
        : t(`Dados de ${field.count} de ${accounts.length} contas`)
  const metrics = [
    {
      id: "connected",
      label: "Sessões guardadas",
      value: formatNumber(connected),
      note: t(`${accounts.length} contas registadas`),
      Icon: Users,
    },
    {
      id: "cases",
      label: "Caixas nas contas",
      value:
        !accounts.length || readings.fields.casesTotal.count
          ? formatNumber(readings.fields.casesTotal.value)
          : "—",
      note: countNote(readings.fields.casesTotal),
      Icon: Boxes,
    },
    {
      id: "money",
      label: "Saldo virtual",
      value:
        !accounts.length || readings.fields.money.count
          ? formatMoney(readings.fields.money.value)
          : "—",
      note: countNote(readings.fields.money),
      Icon: Wallet,
    },
    {
      id: "tokens",
      label: "Tokens nas contas",
      value:
        !accounts.length || readings.fields.tokens.count
          ? formatNumber(readings.fields.tokens.value, 2)
          : "—",
      note: countNote(readings.fields.tokens),
      Icon: Coins,
    },
  ]
  const shortcuts = [
    ["automation", "Automação", "Gerir contas e modos de execução", Zap],
    ["opening", "Abrir caixas", "Escolher a caixa e rever as regras", Boxes],
    ["inventory", "Inventário", "Consultar e gerir os itens", Coins],
  ]
  return (
    <div className="overview-page page-stack">
      <div className="metrics overview-metrics">
        {metrics.map(({ id, label, value, note, Icon }) => (
          <Card className="metric overview-metric" data-metric={id} key={id}>
            <div className="metric-label">
              <span>{t(label)}</span>
              <Icon size={17} aria-hidden="true" />
            </div>
            <strong style={{ "--metric-width": Math.max(1, value.length * 0.65) }}>
              {loading || model.loadError ? "—" : value}
            </strong>
            <small>{model.loadError ? t("Dados indisponíveis") : note}</small>
          </Card>
        ))}
      </div>
      {!loading && accounts.length > 0 && (
        <ReadingStatus
          model={model}
          readings={readings}
          automatic={automatic}
          onNavigate={onNavigate}
        />
      )}
      {model.loadError && (
        <Card className="panel overview-onboarding" role="alert">
          <CircleAlert size={24} />
          <div>
            <h2>{t("Não foi possível carregar as contas")}</h2>
            <p>{t(model.loadError)}</p>
          </div>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t("Tentar novamente")}
          </Button>
        </Card>
      )}
      {!accounts.length && !loading && !model.loadError && (
        <Card className="panel overview-onboarding">
          <Users size={24} />
          <div>
            <h2>{t("Começa pela tua primeira conta")}</h2>
            <p>
              {t(
                "Adiciona uma sessão para veres os saldos e configurares as operações."
              )}
            </p>
          </div>
          <Button onClick={() => onNavigate("accounts")}>
            {t("Adicionar conta")}
          </Button>
        </Card>
      )}
      <div className="overview-middle">
        <OperationSummary status={farmStatus} onNavigate={onNavigate} />
        <Card className="panel overview-shortcuts-panel">
          <div className="section-heading">
            <h2>{t("Atalhos")}</h2>
          </div>
          <div className="overview-action-list">
            {shortcuts.map(([id, title, description, Icon]) => (
              <Button variant="ghost" asChild key={id}>
                <a
                  href={"#" + id}
                  onClick={(event) => {
                    event.preventDefault()
                    onNavigate(id)
                  }}
                >
                  <span className="overview-shortcut-icon">
                    <Icon size={18} />
                  </span>
                  <span>
                    <strong>{t(title)}</strong>
                    <small>{t(description)}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </a>
              </Button>
            ))}
          </div>
        </Card>
      </div>
      <div className="two-column overview-history">
        <Card className="panel">
          <div className="section-heading">
            <h2>{t("Atividade recente")}</h2>
            <Button variant="ghost" size="sm" asChild>
              <a
                href="#activity"
                onClick={(event) => {
                  event.preventDefault()
                  onNavigate("activity")
                }}
              >
                {t("Ver tudo")}
                <ArrowUpRight size={14} />
              </a>
            </Button>
          </div>
          <div className="event-list">
            {events.length ? (
              events
                .slice(0, 5)
                .map((event, index) => (
                  <EventRow
                    key={index}
                    event={event}
                    label={accountsById.get(event.accountId)?.label}
                  />
                ))
            ) : (
              <div className="overview-empty">
                <Activity size={20} />
                <div>
                  <strong>{t("Ainda sem atividade")}</strong>
                  <p>
                    {t(
                      "Os resultados aparecem aqui quando iniciares uma operação."
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
        <Card className="panel">
          <div className="section-heading">
            <h2>{t("Caixas recebidas")}</h2>
            <span>{t("Esta execução")}</span>
          </div>
          <div className="awards-grid">
            {awards.length ? (
              awards.slice(0, 6).map((award) => (
                <article
                  className="award-row"
                  key={award.accountId + award.caseId}
                >
                  <div>
                    <strong>{award.name}</strong>
                    <small>
                      {accountsById.get(award.accountId)?.label ||
                        t("Conta removida")}{" "}
                      · {formatTime(award.lastAt)}
                    </small>
                    {award.unverified > 0 && (
                      <small className="award-warning">
                        {award.unverified}
                        {t(" pedidos sem leitura de confirmação")}
                      </small>
                    )}
                  </div>
                  <b>×{formatNumber(award.count)}</b>
                </article>
              ))
            ) : (
              <div className="overview-empty">
                <Boxes size={20} />
                <div>
                  <strong>{t("Ainda sem caixas recebidas")}</strong>
                  <p>{t("As caixas geradas nesta execução aparecem aqui.")}</p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
