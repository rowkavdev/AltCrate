import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Play,
  Square,
  SlidersHorizontal,
  ChevronRight,
  ChevronLeft,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { NativeSelect } from "@workspace/ui/components/native-select"
import { DisclosurePanel } from "./components/WorkspaceSection.jsx"
import { t } from "./language.js"
import {
  farmAccountState,
  farmCaseProgress,
  farmPerformanceSummary,
  farmRunSummary,
  filterFarmAccounts,
  farmAccountsPage,
  formatVirtualMoney,
} from "./farmViewModel.js"
import { applyModesToAccounts } from "./farmActions.js"
import AccountDetails from "./components/AccountDetails.jsx"
import FarmModesDialog from "./components/FarmModesDialog.jsx"
import FarmAccountCard from "./components/FarmAccountCard.jsx"
import { formatNumber, formatTime } from "./format.js"
import "./farmControls.css"

const MODES = [
  ["case", "Caixas"],
  ["money", "Dinheiro"],
  ["vault", "Cofre"],
]
function RunResults({ results }) {
  return (
    <div className="farm-results">
      <span title={t("Caixas ganhas e confirmadas")}>
        <b>{formatNumber(results?.case || 0)}</b> {t("caixas")}
      </span>
      <span title={t("Dinheiro confirmado por cliques")}>
        {t("Dinheiro")} <b>{formatVirtualMoney(results?.money || 0)}</b>
      </span>
      <span title={t("Dinheiro confirmado do cofre")}>
        {t("Cofre")} <b>{formatVirtualMoney(results?.vault || 0)}</b>
      </span>
    </div>
  )
}
function SelectAll({ checked, partial, disabled, onChange }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial
  }, [partial])
  return (
    <label className="farm-select-all">
      <input
        ref={ref}
        type="checkbox"
        aria-label={t("Selecionar todas as contas")}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span>{t("Todas as contas")}</span>
    </label>
  )
}

export default function FarmControlPanel({
  accounts,
  snapshots,
  status,
  bridge,
  onNotice,
  selectedIds,
  setSelectedIds,
  onRefresh,
  ui,
  onUiChange,
  operationPending,
  onInvoke,
  profileControls,
  children,
}) {
  const [local, setLocal] = useState({
    query: "",
    filter: "all",
    page: 1,
    pageSize: 6,
    detailId: null,
    bulkModes: { case: true, money: true, vault: true },
  })
  const controls = ui || local
  const update = (patch) =>
    onUiChange ? onUiChange(patch) : setLocal((old) => ({ ...old, ...patch }))
  const [localPending, setPending] = useState(false),
    [modesOpen, setModesOpen] = useState(false)
  const pending = operationPending ?? localPending
  const busy = useRef(false)
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts]
  )
  const states = useMemo(
    () => new Map((status?.accounts || []).map((item) => [item.id, item])),
    [status]
  )
  const filtered = useMemo(
    () => filterFarmAccounts(accounts, controls.query, controls.filter, status),
    [accounts, controls.query, controls.filter, status]
  )
  const view = useMemo(
    () => farmAccountsPage(filtered, controls.page, controls.pageSize),
    [filtered, controls.page, controls.pageSize]
  )
  const running = ["running", "stopping"].includes(status?.phase)
  const summary = useMemo(() => farmRunSummary(status), [status])
  const performance = useMemo(() => farmPerformanceSummary(status), [status])
  const detail = accountsById.get(controls.detailId),
    detailEntry = states.get(detail?.id)
  const selectedCount = useMemo(
    () =>
      accounts.reduce(
        (count, account) => count + Number(selectedSet.has(account.id)),
        0
      ),
    [accounts, selectedSet]
  )
  const server = status?.execution?.kind === "server"

  useEffect(() => {
    if (controls.page !== view.page) update({ page: view.page })
  }, [controls.page, view.page])

  async function invoke(action) {
    if (onInvoke) return onInvoke(action)
    if (busy.current) return
    busy.current = true
    setPending(true)
    try {
      await action()
    } catch (error) {
      onNotice(error.message || String(error))
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  function changeMode(entry, kind, checked = !entry.modes[kind]) {
    return invoke(() =>
      bridge.farmSetModes(entry.id, {
        ...entry.modes,
        [kind]: checked,
      })
    )
  }
  function applyGroup(modes = controls.bulkModes) {
    return invoke(async () => {
      const result = await applyModesToAccounts(bridge, selectedIds, modes)
      const failed = result.failures.map(
        (item) =>
          (accountsById.get(item.accountId)?.label || t("Conta")) +
          ": " +
          item.message
      )
      onNotice(
        result.appliedIds.length +
          " " +
          t(
            result.appliedIds.length === 1
              ? "conta configurada"
              : "contas configuradas"
          ) +
          (failed.length ? " · " + failed.join(" · ") : ".")
      )
    })
  }
  function setFilter(patch) {
    update({ ...patch, page: 1 })
  }
  const cooldown =
    status?.budget?.cooldownUntil > Date.now() ? status.budget.cooldownUntil : 0
  const windowWait = Boolean(
    running &&
    status?.budget?.waitUntil > Date.now() &&
    (summary.waiting > 0 || cooldown)
  )
  const limited =
    running && !cooldown
      ? (status?.accounts || []).filter(
          (entry) => entry.selected && entry.budget?.cooldownUntil > Date.now()
        )
      : []

  return (
    <div className="farm-control">
      <header className="farm-commandbar">
        <div className="farm-command-copy">
          <span className={"farm-run-state" + (running ? " is-running" : "")}>
            <i aria-hidden="true" />
            {t(
              status?.phase === "stopping"
                ? "A parar…"
                : running
                  ? "Em curso"
                  : "Parada"
            )}
          </span>
          <span className="farm-selection-count">
            {selectedCount} {t("de")} {accounts.length}{" "}
            {t(selectedCount === 1 ? "selecionada" : "selecionadas")}
          </span>
        </div>
        <div className="farm-command-actions">
          <Button
            type="button"
            variant="outline"
            onClick={() => setModesOpen(true)}
          >
            <SlidersHorizontal aria-hidden="true" />
            {t("Modos")}
          </Button>
          {running ? (
            <Button
              type="button"
              variant="destructive"
              className="stop-button"
              disabled={pending || status?.phase === "stopping"}
              onClick={() => invoke(() => bridge.farmStop())}
            >
              <Square aria-hidden="true" />
              {t(status.phase === "stopping" ? "A parar…" : "Parar tudo")}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={
                pending ||
                !bridge ||
                !selectedIds.length ||
                status?.execution?.restartRequired ||
                Boolean(status?.execution?.transition)
              }
              onClick={() => invoke(() => bridge.farmStart(selectedIds))}
            >
              <Play aria-hidden="true" />
              {t("Iniciar automação")}
            </Button>
          )}
        </div>
      </header>
      <div className="farm-summary-line" aria-label={t("Ganhos confirmados")}>
        <span className="farm-summary-label">{t("Ganhos confirmados")}</span>
        <RunResults results={summary} />
        {summary.unconfirmedRequests > 0 && (
          <small className="farm-unconfirmed">
            {summary.unconfirmedRequests}{" "}
            {t(
              summary.unconfirmedRequests === 1
                ? "pedido por confirmar"
                : "pedidos por confirmar"
            )}
          </small>
        )}
      </div>

      {server && !status.execution.connected && (
        <p className="farm-window" role="status">
          {t(
            "Sem ligação à app. Último estado conhecido; o farm pode continuar no servidor."
          )}
        </p>
      )}
      {status?.network?.configured && status.network.unavailableProxies > 0 && (
        <p className="farm-window" role="status">
          {status.network.unavailableProxies}{" "}
          {t(
            status.network.unavailableProxies === 1
              ? "ligação indisponível"
              : "ligações indisponíveis"
          )}
          {t(". A execução usa as ligações verificadas.")}
        </p>
      )}
      {status?.limitCheck && (
        <p className="farm-window" role="status">
          {t("A verificar se outras contas podem continuar…")}
        </p>
      )}
      {!status?.limitCheck && limited.length > 0 && (
        <p className="farm-window" role="status">
          {limited.length}{" "}
          {t(limited.length === 1 ? "conta aguarda" : "contas aguardam")}
          {t(" o servidor")}
          {t(
            limited.length <
              (status?.accounts || []).filter((entry) => entry.selected).length
              ? "; as restantes continuam."
              : "."
          )}
          {t(" Próxima retoma às ")}
          <strong>
            {formatTime(
              Math.min(...limited.map((entry) => entry.budget.cooldownUntil))
            )}
          </strong>
        </p>
      )}
      {windowWait && !status?.limitCheck && !limited.length && (
        <p className="farm-window" role="status">
          {t(
            cooldown
              ? "Limite do servidor: pedidos retomam às "
              : "Contas em espera retomam às "
          )}
          <strong>{formatTime(cooldown || status.budget.waitUntil)}</strong>
          {t(!cooldown && " · Os cofres continuam no seu horário.")}
        </p>
      )}
      {performance.stalled > 0 && (
        <p className="farm-window" role="status">
          {performance.stalled}{" "}
          {t("contas sem ganhos recentes; consulta os detalhes.")}
        </p>
      )}

      <section
        className="farm-account-list"
        aria-label={t("Gerir contas da automação")}
      >
        <div className="farm-search">
          <Input
            aria-label={t("Pesquisar contas")}
            placeholder={t("Pesquisar por nome ou email…")}
            value={controls.query}
            onChange={(event) => setFilter({ query: event.target.value })}
          />
          <NativeSelect
            aria-label={t("Filtrar contas")}
            value={controls.filter}
            onChange={(event) => setFilter({ filter: event.target.value })}
          >
            <option value="all">{t("Todas")}</option>
            <option value="active">{t("Em curso")}</option>
            <option value="queued">{t("Na fila")}</option>
            <option value="waiting">{t("Em espera")}</option>
            <option value="error">{t("Com erro")}</option>
            <option value="paused">{t("Pausadas")}</option>
            <option value="login">{t("Pedem login")}</option>
          </NativeSelect>
          <SelectAll
            checked={accounts.length > 0 && selectedCount === accounts.length}
            partial={selectedCount > 0 && selectedCount < accounts.length}
            disabled={pending || running || !accounts.length}
            onChange={() =>
              setSelectedIds(
                selectedCount === accounts.length
                  ? []
                  : accounts.map((account) => account.id)
              )
            }
          />
        </div>
        {view.total ? (
          <div className="farm-card-grid" aria-label={t("Contas da automação")}>
            {view.items.map((account) => {
              const entry = states.get(account.id)
              return (
                <FarmAccountCard
                  key={account.id}
                  account={account}
                  entry={entry}
                  status={status}
                  selected={selectedSet.has(account.id)}
                  selectionLocked={pending || running}
                  pending={pending}
                  onSelect={() =>
                    setSelectedIds((old) =>
                      old.includes(account.id)
                        ? old.filter((id) => id !== account.id)
                        : [...old, account.id]
                    )
                  }
                  onPause={() =>
                    invoke(() =>
                      entry.paused
                        ? bridge.farmResume(account.id)
                        : bridge.farmPause(account.id)
                    )
                  }
                  onDetails={() => update({ detailId: account.id })}
                  onModeChange={(kind, checked) =>
                    changeMode(entry, kind, checked)
                  }
                />
              )
            })}
          </div>
        ) : (
          <div className="empty-state">
            <h2>
              {t(
                accounts.length
                  ? "Nenhuma conta neste filtro"
                  : "Adiciona uma conta para começar"
              )}
            </h2>
            <p>
              {t(
                accounts.length
                  ? "Ajusta a pesquisa ou o estado selecionado."
                  : "A página Contas permite ligar e validar as sessões."
              )}
            </p>
          </div>
        )}
        <footer className="farm-pagination">
          <span>
            <b>
              {view.start}–{view.end}
            </b>{" "}
            {t("de")} {view.total} {t("contas")}
          </span>
          <div className="farm-pagination-controls">
            <label>
              <span>{t("Por página")}</span>
              <NativeSelect
                aria-label={t("Contas por página")}
                value={view.pageSize}
                onChange={(event) =>
                  setFilter({ pageSize: Number(event.target.value) })
                }
              >
                {[6, 12, 24].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <nav aria-label={t("Paginação da automação")}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("Página anterior")}
                disabled={view.page === 1}
                onClick={() => update({ page: view.page - 1 })}
              >
                <ChevronLeft className="farm-page-arrow" aria-hidden="true" />
              </Button>
              {view.navigation.map((number, index) =>
                number === null ? (
                  <span
                    className="farm-page-gap"
                    key={"gap-" + index}
                    aria-hidden="true"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={number}
                    type="button"
                    variant={number === view.page ? "secondary" : "ghost"}
                    size="icon-sm"
                    aria-label={t("Página") + " " + number}
                    aria-current={number === view.page ? "page" : undefined}
                    onClick={() => update({ page: number })}
                  >
                    {number}
                  </Button>
                )
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("Página seguinte")}
                disabled={view.page === view.pages}
                onClick={() => update({ page: view.page + 1 })}
              >
                <ChevronRight className="farm-page-arrow" aria-hidden="true" />
              </Button>
            </nav>
          </div>
        </footer>
      </section>

      <DisclosurePanel title="Mais detalhes" className="farm-advanced">
        <div className="farm-overview" aria-label={t("Resumo da automação")}>
          <span>
            <strong>{summary.active}</strong>
            {t(" em curso")}
          </span>
          <span>
            <strong>{summary.queued}</strong>
            {t(" na fila")}
          </span>
          <span>
            <strong>{summary.waiting}</strong>
            {t(" em espera")}
          </span>
          <span>
            <strong>{summary.login + summary.paused}</strong>
            {t(" por resolver")}
          </span>
        </div>
        <div className="farm-performance" aria-label={t("Rendimento do farm")}>
          <span>
            <strong>
              {performance.available
                ? formatNumber(performance.casesPerMinute5, 2)
                : "—"}
            </strong>{" "}
            {t("caixas/min · 5 min")}
          </span>
          <span>
            <strong>
              {performance.available
                ? formatNumber(performance.casesPerMinute30, 2)
                : "—"}
            </strong>{" "}
            {t("caixas/min · 30 min")}
          </span>
          <small>
            {t(
              performance.stale
                ? "Última medição; servidor sem ligação à app."
                : !performance.available
                  ? "A recolher dados de ganhos confirmados."
                  : performance.observedSeconds30 < 1800
                    ? "Média parcial desde o início da medição."
                    : "Médias incluem períodos sem ganhos."
            )}
          </small>
        </div>
        {running && (
          <p className="form-note">
            {formatNumber(
              status.clicksAvailable ?? status.budget?.combinedRemaining
            )}{" "}
            {t("cliques disponíveis")}
          </p>
        )}
        {server ? (
          <p className="form-note">
            <strong>
              {t("Farm no servidor")}
              {status.execution.name && " · " + status.execution.name}
            </strong>{" "}
            ·{" "}
            {t(
              status.execution.connected
                ? "Ligado. Continua com a app fechada."
                : "Sem ligação à app. Último estado conhecido; o farm pode continuar no servidor."
            )}
            {status.execution.updatedAt && (
              <>
                {t(" Atualizado às ")}
                {formatTime(status.execution.updatedAt)}.
              </>
            )}
          </p>
        ) : (
          bridge?.farmMoveToServer && (
            <div className="farm-server-tools">
              {status?.execution?.configuredServer ? (
                <>
                  <p className="form-note">
                    {t("Servidor escolhido: ")}
                    <strong>
                      {status.execution.configuredServer.name}
                    </strong> · {status.execution.configuredServer.host}
                    {t(
                      ". Ao enviar, as sessões das contas selecionadas ficam neste servidor."
                    )}
                  </p>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={
                      pending ||
                      !selectedIds.length ||
                      status.execution.restartRequired ||
                      Boolean(status.execution.transition)
                    }
                    onClick={() =>
                      invoke(() => bridge.farmMoveToServer(selectedIds))
                    }
                  >
                    {t("Enviar contas para o servidor")}
                  </Button>
                </>
              ) : (
                <a href="#settings">
                  {t("Configura o teu servidor nas Definições.")}
                </a>
              )}
            </div>
          )
        )}
        {!server && status?.network?.connections > 1 && (
          <p className="form-note">
            {status.network.connections}
            {t(" ligações verificadas · ")}
            {status.network.proxiedAccounts}
            {t(
              " contas distribuídas por proxies. Os lotes avançam ao longo da janela de cliques."
            )}
          </p>
        )}
        {children}
      </DisclosurePanel>

      <FarmModesDialog
        open={modesOpen}
        onOpenChange={setModesOpen}
        modes={controls.bulkModes}
        onModesChange={(bulkModes) => update({ bulkModes })}
        onApply={applyGroup}
        pending={pending}
        disabled={!bridge || !selectedIds.length}
        selectedCount={selectedCount}
        running={running}
      >
        {profileControls}
      </FarmModesDialog>
      {detail && (
        <AccountDetails
          account={detail}
          snapshot={snapshots[detail.id]}
          operation={detailEntry}
          onClose={() => update({ detailId: null })}
        >
          <div className="farm-detail-controls">
            <fieldset className="bulk-modes">
              <legend>
                {t("Modos de ")}
                {detail.label}
              </legend>
              <div>
                {MODES.map(([kind, label]) => (
                  <label key={kind}>
                    <input
                      type="checkbox"
                      checked={detailEntry?.modes?.[kind] === true}
                      disabled={pending || !detailEntry}
                      onChange={() => changeMode(detailEntry, kind)}
                    />
                    {t(label)}
                  </label>
                ))}
              </div>
            </fieldset>
            {detailEntry?.clicksPerCase && (
              <p>
                {formatNumber(detailEntry.casesPerClick, 2)}
                {t("% por clique · ")}
                {detailEntry.clicksPerCase}
                {t(" cliques por caixa. Os lotes usam caixas completas.")}
                {detailEntry.caseLotClicks > 0 && (
                  <>
                    {t(" Até ")}
                    {detailEntry.caseLotClicks}
                    {t(" cliques por lote, com ")}
                    {formatNumber(detailEntry.caseLotIntervalMs / 1000, 1)}
                    {t(" s de intervalo.")}
                  </>
                )}
              </p>
            )}
            <RunResults results={detailEntry?.results} />
            {detailEntry?.performance && (
              <div className="farm-performance">
                <span>
                  {Number.isFinite(detailEntry.performance.casesPerMinute5)
                    ? formatNumber(detailEntry.performance.casesPerMinute5, 2)
                    : "—"}{" "}
                  {t("caixas/min · 5 min")}
                </span>
                <span>
                  {Number.isFinite(detailEntry.performance.casesPerMinute30)
                    ? formatNumber(detailEntry.performance.casesPerMinute30, 2)
                    : "—"}{" "}
                  {t("caixas/min · 30 min")}
                </span>
                {farmCaseProgress(detailEntry, status) === "stalled" && (
                  <small className="farm-stalled">
                    {t("Sem ganhos recentes")}
                  </small>
                )}
              </div>
            )}
            <p>
              {t("Último ganho de caixas confirmado: ")}
              {detailEntry?.performance?.lastCaseAt
                ? formatTime(detailEntry.performance.lastCaseAt)
                : t("Ainda sem confirmação nesta medição.")}
            </p>
            <p>
              {t("Stock observado: ")}
              {formatNumber(snapshots[detail.id]?.casesTotal)}
              {t(
                " caixas. Abrir caixas reduz o stock; não apaga os ganhos do farm."
              )}
            </p>
            <p>{t(farmAccountState(detailEntry, status).reason)}</p>
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={() => invoke(() => onRefresh(detail.id))}
            >
              {t("Atualizar conta")}
            </Button>
          </div>
        </AccountDetails>
      )}
    </div>
  )
}
