import React, { useMemo, useState } from "react"
import {
  Upload,
  LogIn,
  Users,
  ChevronLeft,
  ChevronRight,
  Search,
  CheckCheck,
  ShieldCheck,
  CircleDashed,
  X,
  Folder,
} from "lucide-react"
import AccountTable from "../components/AccountTable.jsx"
import AccountGroupDialog from "../components/AccountGroupDialog.jsx"
import { accountListView, togglePageSelection } from "../accountList.js"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { NativeSelect } from "@workspace/ui/components/native-select"
import { t } from "../language.js"
import { Card } from "@workspace/ui/components/card"
import "./accounts.css"
function Filter({ label, children }) {
  return (
    <label className="account-filter-field">
      <span className="account-sr-only">{label}</span>
      <div className="account-select-wrap">{children}</div>
    </label>
  )
}
export default function AccountsPage({ model, ui, onUiChange }) {
  const [manual, setManual] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [destination, setDestination] = useState("")
  const workspace = model.accountWorkspace,
    groups = workspace?.groups || [],
    view = useMemo(() => accountListView(model.accounts, workspace, ui), [model.accounts, workspace, ui.query, ui.groupId, ui.status, ui.sort, ui.page, ui.pageSize])
  const accountIds = useMemo(() => new Set(model.accounts.map(account => account.id)), [model.accounts])
  const selection = useMemo(() => (ui.selection || []).filter(id => accountIds.has(id)), [ui.selection, accountIds])
  const selectionSet = useMemo(() => new Set(selection), [selection])
  const locked = model.busy || model.running || model.loading,
    groupLocked = pending || !workspace
  const login = model.accountLogin || {},
    ready = useMemo(() => model.accounts.filter(
      (account) =>
        account.session?.reusable && !account.session?.validationPending
    ).length, [model.accounts])
  const selectedPending = model.pendingLoginIds.filter((id) =>
    selectionSet.has(id)
  )
  const allSaved =
    !model.loading && model.accounts.length > 0 && !model.pendingLoginIds.length
  const statusFilters = [
    {
      value: "all",
      label: "Todas",
      name: "Todas as contas",
      count: view.counts.all,
    },
    {
      value: "ready",
      label: "Com sessão",
      name: "Com sessão guardada",
      count: view.counts.ready,
    },
    {
      value: "pending",
      label: "Por ligar",
      name: "Por ligar ou validar",
      count: view.counts.pending,
    },
    {
      value: "verification",
      label: "Verificação",
      name: "Verificação necessária",
      count: view.counts.verification,
    },
  ]
  const hasFilters = Boolean(
    ui.query ||
    (ui.groupId && ui.groupId !== "all") ||
    (ui.status && ui.status !== "all")
  )
  function filter(patch) {
    onUiChange({ ...patch, page: 1 })
  }
  async function command(action, payload) {
    if (pending) throw Error(t("A guardar alterações…"))
    setPending(true)
    setError("")
    try {
      const result = await model.actions.workspaceCommand(action, payload)
      if (action === "deleteGroup") {
        if (ui.groupId === payload.id) filter({ groupId: "all" })
        if (destination === payload.id) setDestination("")
      }
      return result
    } catch (error) {
      setError(error.message || String(error))
      throw error
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="page-stack accounts-page">
      <header className="section-heading account-manager-header">
        <div className="account-heading-copy">
          <h2 className="account-sr-only">{t("As tuas contas")}</h2>
          <div className="account-summary" aria-live="polite">
            <span>
              <Users size={13} aria-hidden="true" />
              <b>{model.accounts.length}</b> {t("contas")}
            </span>
            <span className="account-summary-saved">
              <ShieldCheck size={13} aria-hidden="true" />
              <b>{ready}</b> {t("com sessão guardada")}
            </span>
            {model.pendingLoginIds.length > 0 && (
              <span className="account-summary-pending">
                <CircleDashed size={13} aria-hidden="true" />
                <b>{model.pendingLoginIds.length}</b> {t("por ligar")}
              </span>
            )}
          </div>
        </div>
        <div className="run-actions account-login-actions">
          <Button
            variant="outline"
            size="sm"
            type="button"
            className="account-secondary-action"
            disabled={locked || !model.bridge?.importAccounts}
            onClick={() => model.actions.importAccounts()}
          >
            <Upload size={15} />
            {t("Importar JSON")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            className="account-secondary-action"
            aria-expanded={manual}
            disabled={locked || !model.bridge}
            onClick={() => setManual((value) => !value)}
          >
            <LogIn size={15} />
            {t("Login manual")}
          </Button>
          <Button
            variant={allSaved ? "ghost" : "default"}
            size="sm"
            type="button"
            className={
              "account-connect-all" + (allSaved ? " account-all-saved" : "")
            }
            aria-label={
              t("Entrar nas contas por ligar") +
              " (" +
              model.pendingLoginIds.length +
              ")"
            }
            disabled={
              locked ||
              !model.bridge?.connectImportedAccounts ||
              !model.pendingLoginIds.length
            }
            onClick={() => model.actions.connectPendingAccounts()}
          >
            {allSaved ? (
              <>
                <CheckCheck size={16} />
                {t("Todas ligadas")}
              </>
            ) : (
              <>
                <LogIn size={15} />
                {t("Entrar nas contas por ligar")}
                <span className="account-action-count">
                  {model.pendingLoginIds.length}
                </span>
              </>
            )}
          </Button>
          {["running", "stopping"].includes(login.phase) && (
            <Button
              variant="destructive"
              size="sm"
              type="button"
              disabled={login.phase === "stopping"}
              onClick={() => model.actions.stopAccountLogins()}
            >
              {t("Parar logins")}
            </Button>
          )}
        </div>
      </header>
      {manual && (
        <form
          className="add-account account-manual-form"
          onSubmit={(event) => {
            event.preventDefault()
            model.actions.addAccount(model.form.label || t("Conta manual"))
          }}
        >
          <div>
            <strong>{t("Ligar uma conta")}</strong>
            <p>{t("Conclui o login na janela que vai abrir.")}</p>
          </div>
          <label>
            {t("Nome local da conta")}
            <Input
              maxLength={40}
              placeholder={t("Por exemplo, Principal")}
              value={model.form.label}
              onChange={(event) => model.setForm({ label: event.target.value })}
            />
          </label>
          <Button
            variant="default"
            size="sm"
            disabled={locked || model.accounts.length >= 100}
          >
            <LogIn size={15} />
            {t("Abrir login")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className="account-icon-button"
            aria-label={t("Fechar login manual")}
            onClick={() => setManual(false)}
          >
            <X size={17} />
          </Button>
        </form>
      )}
      {login.total > 0 && (
        <div
          className={
            "account-login-progress" +
            (login.phase === "paused" ? " is-paused" : "")
          }
          role="status"
        >
          <span className="account-progress-dot" />
          <span>
            <b>{login.connected || 0}</b> {t("logins concluídos")} ·{" "}
            {login.alreadyConnected || 0} {t("já ligados")}
            {login.stage === "waiting"
              ? ` · ${t("Retoma automática em")} ${Math.max(0, Math.ceil((login.waitUntil - (model.now || Date.now())) / 1000))}s`
              : ""}
            {login.phase === "running" &&
            login.stage !== "waiting" &&
            login.label
              ? ` · ${t("A entrar em")} ${login.label}`
              : ""}
            {login.phase === "paused"
              ? ` · ${t("Em pausa")}: ${t(login.message || "")}`
              : ""}
          </span>
        </div>
      )}
      <Card className="accounts-simple accounts-manager">
        <div className="account-list-header">
          <div
            className="account-status-filters"
            role="group"
            aria-label={t("Filtrar sessão")}
          >
            {statusFilters
              .filter(
                (status) =>
                  status.value !== "verification" ||
                  status.count > 0 ||
                  ui.status === "verification"
              )
              .map((status) => (
                <Button
                  key={status.value}
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label={t(status.name)}
                  aria-pressed={(ui.status || "all") === status.value}
                  onClick={() => filter({ status: status.value })}
                >
                  {t(status.label)}
                  <span className="account-filter-count">{status.count}</span>
                </Button>
              ))}
          </div>
          <AccountGroupDialog
            workspace={workspace}
            accounts={model.accounts}
            pending={pending}
            onCommand={command}
            error={error}
            disabled={!workspace || model.loading}
          />
        </div>
        <div className="account-filters">
          <label className="account-search">
            <Search size={17} aria-hidden="true" />
            <Input
              aria-label={t("Pesquisar contas")}
              placeholder={t("Pesquisar nome, email ou grupo")}
              value={ui.query || ""}
              onChange={(event) => filter({ query: event.target.value })}
            />
            {ui.query && (
              <Button
                variant="ghost"
                size="icon-xs"
                type="button"
                aria-label={t("Limpar pesquisa")}
                onClick={() => filter({ query: "" })}
              >
                <X size={14} />
              </Button>
            )}
          </label>
          <Filter label={t("Grupo")}>
            <NativeSelect
              aria-label={t("Filtrar grupo")}
              value={ui.groupId || "all"}
              onChange={(event) => filter({ groupId: event.target.value })}
            >
              <option value="all">{t("Todos os grupos")}</option>
              <option value="ungrouped">{t("Sem grupo")}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </NativeSelect>
          </Filter>
          <Filter label={t("Ordenar")}>
            <NativeSelect
              aria-label={t("Ordenar contas")}
              value={ui.sort || "name"}
              onChange={(event) => filter({ sort: event.target.value })}
            >
              <option value="name">{t("Nome A–Z")}</option>
              <option value="email">{t("Email A–Z")}</option>
              <option value="recent">{t("Mais recentes")}</option>
            </NativeSelect>
          </Filter>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="account-reset-filters"
              onClick={() =>
                filter({ query: "", groupId: "all", status: "all" })
              }
            >
              <X size={14} />
              {t("Limpar filtros")}
            </Button>
          )}
        </div>
        {selection.length > 0 && (
          <div className="account-bulk-bar">
            <strong>
              <span className="account-selection-count">
                {selection.length}
              </span>{" "}
              {t("selecionadas")}
            </strong>
            <div className="account-select-wrap">
              <NativeSelect
                aria-label={t("Grupo das selecionadas")}
                value={destination}
                disabled={groupLocked}
                onChange={(event) => setDestination(event.target.value)}
              >
                <option value="">{t("Sem grupo")}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={groupLocked}
              onClick={() =>
                command("assignAccounts", {
                  accountIds: selection,
                  groupId: destination || null,
                }).catch(() => {})
              }
            >
              <Folder size={14} />
              {t("Mover para grupo")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={locked || !selectedPending.length}
              onClick={() => model.actions.connectPendingAccounts(selection)}
            >
              <LogIn size={14} />
              {t("Ligar selecionadas")} ({selectedPending.length})
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              className="account-clear-selection"
              onClick={() => onUiChange({ selection: [] })}
            >
              {t("Limpar seleção")}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="account-inline-error account-page-error">
            {error}
          </p>
        )}
        {model.loading ? (
          <div className="empty-state account-loading">
            <CircleDashed size={28} />
            {t("A carregar as contas…")}
          </div>
        ) : view.total ? (
          <AccountTable
            accounts={view.rows}
            model={model}
            workspace={workspace}
            selection={selection}
            onSelectionChange={(ids, checked) =>
              onUiChange({
                selection: togglePageSelection(selection, ids, checked),
              })
            }
            onCommand={command}
            groupLocked={groupLocked}
          />
        ) : (
          <div className="empty-state account-empty">
            <span className="account-empty-icon">
              <Users size={26} />
            </span>
            <h2>
              {t(
                model.accounts.length
                  ? "Nenhuma conta encontrada"
                  : "Ainda não há contas ligadas"
              )}
            </h2>
            <p>
              {t(
                model.accounts.length
                  ? "Experimenta outro nome ou ajusta os filtros."
                  : "Importa o teu JSON ou abre o login manual para começar."
              )}
            </p>
            {model.accounts.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() =>
                  filter({ query: "", groupId: "all", status: "all" })
                }
              >
                {t("Limpar filtros")}
              </Button>
            )}
          </div>
        )}
        <footer className="account-pagination">
          <span>
            <b>
              {view.start}–{view.end}
            </b>{" "}
            {t("de")} {view.total} {t("contas")}
          </span>
          <div className="account-pagination-controls">
            <label>
              {t("Por página")}
              <div className="account-select-wrap">
                <NativeSelect
                  aria-label={t("Contas por página")}
                  value={view.pageSize}
                  onChange={(event) =>
                    filter({ pageSize: Number(event.target.value) })
                  }
                >
                  {[10, 25, 50].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </label>
            <nav aria-label={t("Paginação de contas")}>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label={t("Página anterior")}
                disabled={view.page === 1}
                onClick={() => onUiChange({ page: view.page - 1 })}
              >
                <ChevronLeft size={16} />
              </Button>
              {Array.from({ length: view.pages }, (_, index) => index + 1).map(
                (page) => (
                  <Button
                    variant={page === view.page ? "secondary" : "ghost"}
                    size="icon-sm"
                    type="button"
                    key={page}
                    aria-label={t("Página") + " " + page}
                    aria-current={page === view.page ? "page" : undefined}
                    onClick={() => onUiChange({ page })}
                  >
                    {page}
                  </Button>
                )
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label={t("Página seguinte")}
                disabled={view.page === view.pages}
                onClick={() => onUiChange({ page: view.page + 1 })}
              >
                <ChevronRight size={16} />
              </Button>
            </nav>
          </div>
        </footer>
      </Card>
    </div>
  )
}
