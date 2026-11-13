import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Archive,
  History,
  RotateCcw,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  Crown,
  ExternalLink,
  LoaderCircle,
  Package,
  RefreshCw,
  Route,
  Search,
  Square,
  UserRound,
  Users,
  X,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@workspace/ui/components/dialog"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@workspace/ui/components/pagination"
import ConverterVerificationFeedback from "../components/ConverterVerificationFeedback.jsx"
import ConverterPreparationIssues from "../components/ConverterPreparationIssues.jsx"
import ConverterReviewDialog from "../components/ConverterReviewDialog.jsx"
import ConverterStepPicker from "../components/ConverterStepPicker.jsx"
import ConverterSequenceSummary from "../components/ConverterSequenceSummary.jsx"
import {
  converterViewModel,
  converterGuidance,
  previousConverterSelection,
  converterStepSelection,
  converterSequenceScope,
  converterSteps,
} from "../converterViewModel.js"
import { formatNumber, formatTime } from "../format.js"
import { t } from "../language.js"
import "./converter.css"

const states = {
  waiting: "A aguardar",
  running: "Em curso",
  confirmed: "Concluída",
  unconfirmed: "Por confirmar",
  unresolved: "Encerrada sem confirmação",
  failed: "Falhou",
  stopped: "Parada",
  cancelled: "Cancelada",
  skipped: "Não processada",
  reviewed: "Revista",
  paused: "Pronta para continuar",
}
const needsAttention = (row) => row.state === "unconfirmed" ||
  (row.state === "unresolved" && row.lockedAccountIds?.length > 0) ||
  ["running", "waiting"].includes(row.state) || row.canResume ||
  (row.canReviewNext && (row.state === "paused" || row.pendingStickers > 0 || row.pendingItems > 0 || row.handoffCounts?.source > 0 || row.handoffCounts?.destination > 0))
function Recovery({
  row,
  bridge,
  invoke,
  disabled,
  onReviewNext,
  onChooseSteps,
  onStop,
  onVerify,
  verifyingId,
  verifyDisabled,
}) {
  const [acknowledge, setAcknowledge] = useState(false)
  const [closingUnresolved, setClosingUnresolved] = useState(false)
  const [closeError, setCloseError] = useState("")
  return (
    <div className="converter-recovery">
      {row.canStop && bridge.stopTokenConverterAccount && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onStop(row.operationId)}
        >
          <Square size={12} />
          {t("Parar nesta conta")}
        </Button>
      )}
      {row.stopRequested && (
        <span className="text-xs text-muted-foreground">
          {t(row.state === "running" ? "A parar…" : "Parada pelo utilizador")}
        </span>
      )}
      {row.canRepeat && (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChooseSteps(row)}
        >
          {t("Escolher etapas")}
        </Button>
      )}
      {row.canReviewNext && (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onReviewNext([row])}
        >
          <ArrowRight size={13} />
          {t("Rever próxima etapa")}
        </Button>
      )}
      {(row.canVerify || row.state === "unconfirmed") && (
        <Button
          variant="outline"
          size="sm"
          disabled={verifyDisabled || !!verifyingId}
          onClick={() => onVerify(row.operationId)}
        >
          <RefreshCw
            size={13}
            className={verifyingId === row.operationId ? "animate-spin" : ""}
          />
          {t(
            verifyingId === row.operationId
              ? "A verificar…"
              : "Verificar resultado"
          )}
        </Button>
      )}
      {row.canCloseUnresolved && bridge.closeUnresolvedTokenConversion && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setCloseError("")
              setClosingUnresolved(true)
            }}
          >
            <Archive size={13} aria-hidden="true" />
            {t("Encerrar sem confirmar")}
          </Button>
          <Dialog open={closingUnresolved} onOpenChange={setClosingUnresolved}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("Encerrar esta pendência?")}</DialogTitle>
                <DialogDescription>
                  {formatNumber(row.unconfirmedResults)}{" "}
                  {t(
                    "resultados continuam por confirmar. O registo fica guardado e não será contado como concluído."
                  )}
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {t(
                  "O resultado continua desconhecido. A operação não será repetida e o registo mantém as proteções dos itens e das contas."
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {t(
                  "Algumas etapas podem continuar bloqueadas quando não é possível identificar os itens. Verifica o resultado no jogo antes de continuar."
                )}
              </p>
              {closeError && (
                <p role="alert" className="text-sm text-destructive">
                  {t(closeError)}
                </p>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => setClosingUnresolved(false)}
                >
                  {t("Cancelar")}
                </Button>
                <Button
                  disabled={disabled}
                  onClick={async () => {
                    setCloseError("")
                    const result = await invoke(() =>
                      bridge.closeUnresolvedTokenConversion(row.operationId)
                    )
                    if (result) setClosingUnresolved(false)
                    else
                      setCloseError(
                        "Não foi possível confirmar o encerramento. Atualiza o estado antes de repetir."
                      )
                  }}
                >
                  {t("Encerrar sem confirmar")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
      {row.canResume && (
        <Button
          size="sm"
          disabled={disabled || !bridge.resumeTokenConverter}
          onClick={() =>
            invoke(() => bridge.resumeTokenConverter(row.operationId))
          }
        >
          <ArrowRight size={13} />
          {t("Continuar")}
        </Button>
      )}
      {row.canCancel && (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => invoke(() => bridge.cancelTokenTrade(row.operationId))}
        >
          {t("Cancelar troca")}
        </Button>
      )}
      {row.state === "unconfirmed" && (
        <a
          href={
            row.tradeId
              ? `https://case-clicker.com/trading/${row.tradeId}`
              : "https://case-clicker.com/inventory"
          }
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={13} />
          {t("Ver no jogo")}
        </a>
      )}
      {row.state === "unconfirmed" && !row.route && !row.steps && (
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => setAcknowledge((value) => !value)}
        >
          {t("Já revi no jogo")}
        </Button>
      )}
      {acknowledge && row.state === "unconfirmed" && (
        <div className="converter-ack">
          <p>
            {t(
              "Confirma apenas depois de resolveres os itens e qualquer troca pendente no jogo. Os tokens não serão contados como enviados."
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() =>
              invoke(() => bridge.acknowledgeTokenConversion(row.operationId))
            }
          >
            {t("Marcar como revisto")}
          </Button>
        </div>
      )}
    </div>
  )
}
function RowDetails({
  row,
  bridge,
  invoke,
  disabled,
  onReviewNext,
  onChooseSteps,
  onStop,
  onVerify,
  verifyingId,
  verifyDisabled,
  showActions = true,
}) {
  const counts = row.steps
    ? [
        ["Caixas vendidas", row.sold],
        ["Cápsulas compradas", row.bought],
        ["Cápsulas abertas", row.opened],
        ["Stickers por converter", row.pendingStickers],
        ["Skins criadas", row.mintedItems],
        ["Na origem", row.handoffCounts?.source],
        ["Na Main", row.handoffCounts?.destination],
        ["Tokens recebidos", row.receivedTokens || row.sentTokens],
      ]
    : row.route
      ? [
          ["Inventário convertido", row.originalConverted],
          ["Skins criadas", row.mintedItems],
          ["Itens por tratar", row.pendingItems],
          ["Tokens recebidos", row.receivedTokens || row.sentTokens],
        ]
      : [
          ["Caixas vendidas", row.sold],
          ["Cápsulas compradas", row.bought],
          ["Cápsulas abertas", row.opened],
          ["Stickers convertidos", row.converted],
          ["Tokens recebidos", row.state === "confirmed" ? row.sentTokens : 0],
        ]
  return (
    <div className="converter-row-detail">
      <p>{t(row.message)}</p>
      <dl>
        {counts.map(([label, value]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd>{formatNumber(value || 0)}</dd>
          </div>
        ))}
      </dl>
      {row.convertedToMoney > 0 && (
        <p className="converter-error">
          {t("O site pagou em dinheiro:")}{" "}
          {formatNumber(row.convertedToMoney, 2)}
        </p>
      )}
      {row.queueProgress?.total > 0 && (
        <progress
          aria-label={t("Progresso no site")}
          max={row.queueProgress.total}
          value={row.queueProgress.created || 0}
        />
      )}
      {!!row.steps?.length && (
        <div className="converter-completed-steps">
          {row.steps.map((id) => (
            <span key={id}>
              {row.completedSteps?.includes(id) && <Check size={11} />}{" "}
              {t(converterSteps.find((step) => step.id === id)?.label || id)}
            </span>
          ))}
        </div>
      )}
      {showActions && (
        <Recovery
          row={row}
          bridge={bridge}
          invoke={invoke}
          disabled={disabled}
          onReviewNext={onReviewNext}
          onChooseSteps={onChooseSteps}
          onStop={onStop}
          onVerify={onVerify}
          verifyingId={verifyingId}
          verifyDisabled={verifyDisabled}
        />
      )}
    </div>
  )
}
export default function TokenConverterPage({
  model,
  ui = {},
  onUiChange,
  onOpenOpeningPreferences,
}) {
  const { bridge, accounts, selectedIds, snapshots } = model,
    status = model.converter || { phase: "idle", rows: [], sentTokens: 0 }
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(10),
    [pending, setPending] = useState(false),
    [stopping, setStopping] = useState({}),
    [error, setError] = useState(""),
    [preparationIssues, setPreparationIssues] = useState([]),
    [preview, setPreview] = useState(null),
    [previewKey, setPreviewKey] = useState(""),
    [reviewNow, setReviewNow] = useState(Date.now()),
    [expanded, setExpanded] = useState(null),
    [resumeIds, setResumeIds] = useState([]),
    [repeatIds, setRepeatIds] = useState([]),
    [clearOpen, setClearOpen] = useState(false),
    [resultsOpen, setResultsOpen] = useState(false),
    [historyPage, setHistoryPage] = useState(1),
    [verifyingId, setVerifyingId] = useState(null),
    [notice, setNotice] = useState("")
  const verifyingWork = useRef(false),
    working = useRef(false),
    reviewGeneration = useRef(0),
    reviewButton = useRef(null)
  const selection = converterStepSelection({
      steps: ui.converterSteps,
      legacyAction: ui.converterAction,
    }),
    steps = selection.steps,
    routing = ui.converterRouting || "auto",
    transfer = selection.needsDestination
  const running = ["preparing", "revalidating", "running", "stopping"].includes(status.phase),
    rateLimited = status.retryAt > (model.now ?? Date.now()),
    clearableCount = status.clearableCount || 0,
    protectedCount = status.rows.length - clearableCount
  const refresh = model.actions?.refreshAccounts,
    refreshing = ["running", "waiting", "stopping"].includes(model.refreshStatus?.phase)
  const farmRunning = ["running", "stopping"].includes(model.farmStatus?.phase),
    openingRunning = ["running", "stopping"].includes(model.opening?.phase),
    otherBusy =
      model.busy ||
      model.loading ||
      refreshing ||
      farmRunning ||
      openingRunning ||
      (model.running && !running)
  const view = useMemo(
    () =>
      converterViewModel({
        accounts,
        snapshots,
        selectedIds,
        destinationAccountId: ui.destinationAccountId,
        transfer,
        query,
        membershipFilter: filter,
        page,
        pageSize,
        now: model.now,
      }),
    [
      accounts,
      snapshots,
      selectedIds,
      ui.destinationAccountId,
      transfer,
      query,
      filter,
      page,
      pageSize,
      model.now,
    ]
  )
  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts]
  )
  const prioritizedRows = useMemo(() => {
    const priority = (row) => row.state === "unconfirmed" || (row.state === "unresolved" && row.lockedAccountIds?.length) ? 0 : ["running", "waiting"].includes(row.state) ? 1 : needsAttention(row) ? 2 : 3
    return [...status.rows].sort((a, b) => priority(a) - priority(b) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
  }, [status.rows])
  const pendingRows = prioritizedRows.filter(needsAttention)
  const historicalRows = prioritizedRows.filter((row) => !pendingRows.includes(row))
  const resultsById = useMemo(() => {
    const byAccount = new Map()
    for (const row of prioritizedRows) if (!byAccount.has(row.accountId)) byAccount.set(row.accountId, row)
    return byAccount
  }, [prioritizedRows])
  const expired = Number.isFinite(preview?.expiresAt) && preview.expiresAt <= Math.max(model.now || 0, reviewNow)
  useEffect(() => {
    if (!Number.isFinite(preview?.expiresAt)) return
    setReviewNow(Date.now())
    const timer = setTimeout(() => setReviewNow(Date.now()), Math.max(0, preview.expiresAt - Date.now()) + 1)
    return () => clearTimeout(timer)
  }, [preview?.expiresAt])
  const activeVerificationId =
    verifyingId ||
    status.rows.find((row) => row.verification?.phase === "running")
      ?.operationId
  const destination = accountsById.get(ui.destinationAccountId)
  const guidance = converterGuidance({
      status,
      independent: !resumeIds.length,
      steps,
      sourceIds: view.sourceIds,
      resumeIds,
      repeatIds,
      needsDestination: transfer,
      destination,
      busy: otherBusy,
      running,
      pending,
      now: model.now,
    }),
    eligibleSourceIds = guidance.eligibleSourceIds,
    scopeKey = converterSequenceScope({
      sourceIds: eligibleSourceIds,
      destinationAccountId: transfer ? destination?.id : null,
      steps,
      routing,
      resumeOperationIds: resumeIds,
      repeatOperationIds: repeatIds,
    }),
    localBlocked = guidance.issues.some((issue) => issue.blocking !== false),
    summaryTotals = {
      ...view.totals,
      selected: eligibleSourceIds.length,
      tokens: eligibleSourceIds.reduce(
        (n, id) =>
          n +
          (Number.isFinite(snapshots[id]?.tokens) ? snapshots[id].tokens : 0),
        0
      ),
    },
    issues = guidance.issues,
    previous = previousConverterSelection(status),
    disabled =
      pending ||
      running ||
      otherBusy ||
      rateLimited ||
      !!activeVerificationId ||
      localBlocked,
    historyPages = Math.max(1, Math.ceil(historicalRows.length / 10)),
    currentHistoryPage = Math.min(historyPage, historyPages),
    historyRows = historicalRows.slice(
      (currentHistoryPage - 1) * 10,
      currentHistoryPage * 10
    )
  async function verifyResult(operationId) {
    if (verifyingWork.current) return
    verifyingWork.current = true
    setVerifyingId(operationId)
    setError("")
    try {
      model.setConverter(await bridge.verifyTokenConversion(operationId))
    } catch (failure) {
      setError(String(failure.message || failure))
    } finally {
      verifyingWork.current = false
      setVerifyingId(null)
    }
  }
  async function invoke(work, update = true) {
    if (working.current) return
    working.current = true
    setPending(true)
    setError("")
    try {
      const result = await work()
      if (update && result) model.setConverter(result)
      return result
    } catch (e) {
      setError(
        String(e.message || e).replace(
          /^Error invoking remote method '[^']+': Error: /,
          ""
        )
      )
    } finally {
      working.current = false
      setPending(false)
    }
  }
  async function prepare(protectedItemIds = [], override = {}) {
    setPreparationIssues([])
    const config = {
      action: "sequence",
      accountIds: override.accountIds || eligibleSourceIds,
      steps: override.steps || steps,
      routing: override.routing || routing,
      protectedItemIds,
      resumeOperationIds: override.resumeOperationIds || resumeIds,
      repeatOperationIds: override.repeatOperationIds || repeatIds,
    }
    config.independent = !config.resumeOperationIds.length
    const requiresMain = converterStepSelection({
      steps: config.steps,
    }).needsDestination
    config.destinationAccountId = requiresMain
      ? override.destinationAccountId || destination?.id
      : undefined
    if (requiresMain && !config.destinationAccountId) {
      setError("Escolhe a conta principal.")
      return
    }
    const key = converterSequenceScope({
      ...config,
      sourceIds: config.accountIds,
    })
    await invoke(async () => {
      const generation = ++reviewGeneration.current
      try {
        const result = await bridge.prepareTokenConverter(config)
        if (generation === reviewGeneration.current) {
          if (result.blocked) {
            setPreview(null)
            setPreparationIssues(result.issues || [])
            return
          }
          const reviewed = new Set(result.rows?.map((row) => row.accountId))
          if (reviewed.size !== config.accountIds.length || config.accountIds.some((id) => !reviewed.has(id))) {
            setPreview(null)
            throw Error("A revisão não inclui todas as contas selecionadas. Volta a rever antes de iniciar.")
          }
          setPreview(result)
          setPreviewKey(key)
        }
      } catch (failure) {
        if (generation === reviewGeneration.current) throw failure
      }
    }, false)
  }
  async function halt(operationId) {
    const key = operationId || "all"
    if (stopping[key] || stopping.all) return
    setStopping((old) => ({ ...old, [key]: true }))
    if (!operationId || status.preparation) {
      reviewGeneration.current++
      setPreview(null)
      setResumeIds([])
      setRepeatIds([])
      setError("")
    }
    if (operationId && status.preparation) {
      const row = status.rows.find((row) => row.operationId === operationId)
      if (row)
        model.setSelectedIds(selectedIds.filter((id) => id !== row.accountId))
    }
    try {
      const result = await (operationId
        ? bridge.stopTokenConverterAccount(operationId)
        : bridge.stopTokenConverter())
      model.setConverter(result)
      setNotice(
        t(
          "Paragem pedida. As etapas concluídas e os itens ficam guardados. Escolhe as etapas que queres executar a seguir."
        )
      )
    } catch (failure) {
      setError(String(failure.message || failure))
    } finally {
      setStopping((old) => {
        const next = { ...old }
        delete next[key]
        return next
      })
    }
  }
  function reviewNext(rows, prepareReview = true) {
    setRepeatIds([])
    const nextSteps = converterSteps
      .map((s) => s.id)
      .filter((id) => rows.every((row) => row.availableSteps?.includes(id)))
    const destinationAccountId =
      rows.find((row) => row.destinationAccountId)?.destinationAccountId ||
      destination?.id
    const ids = rows.map((row) => row.operationId),
      sourceIds = rows.map((row) => row.accountId)
    setResumeIds(ids)
    model.setSelectedIds(sourceIds)
    onUiChange({
      converterSteps: nextSteps,
      converterRouting: "selected",
      ...(destinationAccountId ? { destinationAccountId } : {}),
    })
    if (nextSteps.length && prepareReview)
      prepare([], {
        steps: nextSteps,
        routing: "selected",
        resumeOperationIds: ids,
        repeatOperationIds: [],
        accountIds: sourceIds,
        destinationAccountId,
      })
    else if (!nextSteps.length)
      setError(
        "As contas estão em etapas diferentes. Revê cada conta em separado."
      )
  }
  function confirm() {
    if (!preview || pending || running || otherBusy || rateLimited || previewKey !== scopeKey) return
    if (Number.isFinite(preview.expiresAt) && preview.expiresAt <= Date.now()) {
      setReviewNow(Date.now())
      setError("A revisão expirou. Revê novamente antes de confirmar.")
      return
    }
    invoke(async () => {
      const result = await bridge.startTokenConverter({
        action: "sequence",
        previewId: preview.previewId,
      })
      setPreview(null)
      setResumeIds([])
      setRepeatIds([])
      return result
    })
  }
  async function clearPrevious() {
    const result = await invoke(() => bridge.clearTokenConverter())
    if (result) {
      setClearOpen(false)
      setPreview(null)
      setResumeIds([])
      setRepeatIds([])
      setExpanded(null)
    }
  }
  function changeSelection(ids) {
    setPreparationIssues([])
    setResumeIds([])
    setRepeatIds([])
    setPreview(null)
    setError("")
    model.setSelectedIds(ids)
  }
  function selectPage() {
    const ids = new Set(selectedIds),
      all = view.rows.every((row) => ids.has(row.id))
    for (const row of view.rows) all ? ids.delete(row.id) : ids.add(row.id)
    changeSelection([...ids])
  }
  function selectAll() {
    changeSelection(
      accounts
        .filter((account) => !transfer || account.id !== destination?.id)
        .map((account) => account.id)
    )
  }
  const sourceAccountCount = accounts.length - (transfer && destination ? 1 : 0)
  const lockSelection = pending || running
  function restoreSelection(row) {
    setPreparationIssues([])
    const saved = row ? previousConverterSelection({ rows: [row] }) : previous
    if (!saved) return
    setResumeIds([])
    setRepeatIds([])
    setPreview(null)
    setError("")
    model.setSelectedIds(
      row
        ? [row.accountId]
        : saved.accountIds.filter((id) => accountsById.has(id))
    )
    onUiChange({
      converterSteps: saved.steps,
      converterRouting: saved.routing,
      ...(saved.destinationAccountId
        ? { destinationAccountId: saved.destinationAccountId }
        : {}),
    })
    setResultsOpen(false)
    setNotice("")
  }
  const reason = activeVerificationId
    ? t("A verificar o resultado da conta…")
    : issues.find((issue) => issue.blocking !== false)?.message
      ? t(issues.find((issue) => issue.blocking !== false).message)
      : !bridge?.prepareTokenConverter
        ? t("A ligação ao motor ainda não está disponível.")
        : ""
  return (
    <div className="converter-page">
      <header className="converter-heading">
        <div>
          <h2>
            <Route size={18} aria-hidden="true" />
            {t("Configurar percurso")}
          </h2>
          <p>
            {t(
              "Escolhe qualquer etapa. Podes executar outra ou repetir a mesma depois."
            )}
          </p>
        </div>
        <div className="converter-heading-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={
              stopping.all ||
              (!running &&
                !pending &&
                !status.rows.some((row) => row.canStop)) ||
              !bridge?.stopTokenConverter
            }
            onClick={() => halt()}
          >
            <Square size={14} />
            {t("Parar todas")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResultsOpen(true)}
            disabled={!status.rows.length && !previous}
          >
            <History size={14} />
            {t("Resultados anteriores")}{" "}
            <span className="text-muted-foreground">{status.rows.length}</span>
          </Button>
          <Button
            aria-label={t(refreshing ? "Parar leitura" : "Atualizar contas")}
            variant="outline"
            size="sm"
            disabled={refreshing ? !model.actions?.stopRefresh : pending || running || otherBusy || rateLimited || !refresh}
            onClick={() =>
              refreshing ? model.actions.stopRefresh() : refresh()
            }
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            {t(refreshing ? "Parar leitura" : "Atualizar contas")}
          </Button>
        </div>
      </header>
      <div className="converter-workspace">
        <div className="converter-workspace-main">
          <ConverterStepPicker
            selectedSteps={steps}
            routing={routing}
            disabled={lockSelection}
            onChange={(converterSteps, converterRouting) => {
              setPreparationIssues([])
              setResumeIds([])
              setRepeatIds([])
              setPreview(null)
              setError("")
              onUiChange({ converterSteps, converterRouting })
            }}
          />
          {notice && (
            <p className="converter-run-note" role="status">
              {t(notice)}
            </p>
          )}
          {error && !preview && !clearOpen && (
            <p role="alert" className="converter-error">
              {t(error)}
            </p>
          )}
          {!!preparationIssues.length && !preview && (
            <ConverterPreparationIssues
              issues={preparationIssues}
              disabled={pending || running || otherBusy}
              onPreferences={
                onOpenOpeningPreferences
                  ? (accountId) =>
                      invoke(() => onOpenOpeningPreferences(accountId), false)
                  : undefined
              }
              onExclude={(accountId) =>
                changeSelection(selectedIds.filter((id) => id !== accountId))
              }
              onRemoveOpening={() => {
                setPreparationIssues([])
                setResumeIds([])
                setRepeatIds([])
                setPreview(null)
                setError("")
                onUiChange({
                  converterSteps: steps.filter(
                    (step) => !["open", "convert-stickers"].includes(step)
                  ),
                })
              }}
            />
          )}
          {rateLimited && (
            <div className="converter-active" role="status">
              <div>
                <Clock3 size={16} aria-hidden="true" />
                <strong>{t("Limite do site")}</strong>
                <span>
                  {t("Volta a rever após")} {formatTime(status.retryAt)}
                </span>
              </div>
              <span>{t("Os resultados e as etapas estão guardados.")}</span>
            </div>
          )}
          {running && (
            <div className="converter-active" role="status">
              <div>
                <LoaderCircle size={16} className="animate-spin" />
                <strong>
                  {t(
                    status.phase === "stopping"
                      ? "A parar com segurança"
                      : status.phase === "preparing"
                        ? "A preparar a revisão"
                        : status.phase === "revalidating"
                          ? "A revalidar a revisão"
                          : "Conversão em curso"
                  )}
                </strong>
                <span>
                  {status.preparation
                    ? `${status.preparation.completed} / ${status.preparation.total} ${t("contas lidas")}`
                    : `${formatNumber(status.sentTokens || 0)} ${t("tokens recebidos")}`}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={stopping.all || status.phase === "stopping"}
                onClick={() => halt()}
              >
                <Square size={12} />
                {t("Parar todas")}
              </Button>
            </div>
          )}
          <section
            className="converter-accounts"
            aria-label={t("Contas do conversor")}
          >
            <div className="converter-list-heading">
              <h3>
                <span className="converter-section-number">2</span>
                <Users size={17} aria-hidden="true" />
                {t("Contas de origem")} <span>{view.filteredCount}</span>
              </h3>
              <p>
                <strong>{view.totals.selected}</strong>{" "}
                {t(view.totals.selected === 1 ? "selecionada" : "selecionadas")}
                {view.totals.selected > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="converter-clear-selection"
                    disabled={lockSelection}
                    onClick={() => changeSelection([])}
                  >
                    <X size={12} aria-hidden="true" />
                    {t("Limpar seleção")}
                  </Button>
                )}
              </p>
            </div>
            <div className="converter-filters">
              <div className="converter-search">
                <Search size={14} />
                <Input
                  aria-label={t("Procurar conta")}
                  placeholder={t("Procurar conta…")}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setPage(1)
                  }}
                />
              </div>
              <NativeSelect
                aria-label={t("Filtrar tipo de conta")}
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value)
                  setPage(1)
                }}
              >
                <NativeSelectOption value="all">
                  {t("Todas as contas")}
                </NativeSelectOption>
                <NativeSelectOption value="pro">Pro</NativeSelectOption>
                <NativeSelectOption value="free">
                  {t("Sem Pro")}
                </NativeSelectOption>
                <NativeSelectOption value="unknown">
                  {t("Por verificar")}
                </NativeSelectOption>
              </NativeSelect>
              <div className="converter-selection-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={lockSelection || !view.rows.length}
                  onClick={selectPage}
                >
                  {t(
                    view.rows.length > 0 &&
                      view.rows.every((row) => row.selected)
                      ? "Desmarcar página"
                      : "Selecionar página"
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t("Selecionar todas as contas")}
                  disabled={lockSelection || !sourceAccountCount}
                  onClick={selectAll}
                >
                  <CheckCheck size={14} aria-hidden="true" />
                  {t("Selecionar todas")} <span>({sourceAccountCount})</span>
                </Button>
              </div>
            </div>
            <Table className="converter-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="converter-select-cell">
                    <span className="sr-only">{t("Selecionar")}</span>
                  </TableHead>
                  <TableHead>{t("Conta")}</TableHead>
                  <TableHead className="converter-numeric">
                    <span>
                      <Coins size={13} aria-hidden="true" />
                      {t("Tokens")}
                    </span>
                  </TableHead>
                  <TableHead className="converter-stock-heading">
                    {t("Inventário")}
                  </TableHead>
                  <TableHead className="converter-route-heading">
                    {t("Percurso")}
                  </TableHead>
                  <TableHead className="converter-state-heading">
                    {t("Estado")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.rows.map((account) => {
                  const row = resultsById.get(account.id),
                    open = expanded === account.id,
                    accountRoute =
                      account.route !== "unknown" &&
                      routing === "selected" &&
                      steps.includes("mint")
                        ? "skins"
                        : account.route
                  return (
                    <React.Fragment key={account.id}>
                      <TableRow
                        data-selected={account.selected ? "true" : undefined}
                        className="converter-account-row"
                      >
                        <TableCell className="converter-select-cell">
                          <Checkbox
                            className="converter-check"
                            aria-label={t("Selecionar") + " " + account.label}
                            checked={account.selected}
                            disabled={lockSelection}
                            onCheckedChange={() =>
                              changeSelection(
                                account.selected
                                  ? selectedIds.filter(
                                      (id) => id !== account.id
                                    )
                                  : [...selectedIds, account.id]
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="converter-account-name">
                            <strong title={account.label}>
                              {account.label}
                            </strong>
                            <Badge
                              title={account.membershipStale ? t("Última leitura guardada. O tipo de conta será confirmado ao rever as etapas.") : undefined}
                              variant={
                                account.membership === "pro"
                                  ? "secondary"
                                  : "outline"
                              }
                            >
                              {account.observedMembership === "pro" ? (
                                <Crown size={11} aria-hidden="true" />
                              ) : (
                                <UserRound size={11} aria-hidden="true" />
                              )}
                              {account.observedMembership === "pro"
                                ? "Pro"
                                : t(
                                    account.observedMembership === "free"
                                      ? "Sem Pro"
                                      : "Por verificar"
                                  )}
                              {account.membershipStale && " · " + t("por atualizar")}
                            </Badge>
                            {row && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="converter-mobile-progress"
                                aria-label={
                                  t("Detalhes de") + " " + account.label
                                }
                                aria-expanded={open}
                                onClick={() =>
                                  setExpanded(open ? null : account.id)
                                }
                              >
                                {t(states[row.state] || row.state)}
                                <ChevronDown size={11} />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="converter-numeric">
                          {account.tokens === null
                            ? "—"
                            : formatNumber(account.tokens, 0)}
                        </TableCell>
                        <TableCell className="converter-stock">
                          {account.inventoryCount === null
                            ? "—"
                            : formatNumber(account.inventoryCount)}
                        </TableCell>
                        <TableCell className="converter-route-label">
                          {!transfer ? (
                            <span>{t("Na origem")}</span>
                          ) : !steps.includes("transfer") ? (
                            <span>{t("Na Main")}</span>
                          ) : accountRoute === "unknown" ? (
                            <span>{t("Verificar conta")}</span>
                          ) : (
                            <span>
                              {accountRoute === "tokens" ? (
                                <Coins size={13} />
                              ) : (
                                <Package size={13} />
                              )}{" "}
                              {t(
                                accountRoute === "tokens"
                                  ? "Tokens diretos"
                                  : "Por skins"
                              )}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="converter-state">
                          {row ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-expanded={open}
                              aria-label={
                                t("Detalhes de") + " " + account.label
                              }
                              onClick={() =>
                                setExpanded(open ? null : account.id)
                              }
                            >
                              {row.state === "confirmed" ? (
                                <Check size={13} />
                              ) : row.state === "running" ? (
                                <LoaderCircle
                                  size={13}
                                  className="animate-spin"
                                />
                              ) : null}
                              {t(states[row.state] || row.state)}
                              <ChevronDown size={12} />
                            </Button>
                          ) : (
                            <span>{t("Por iniciar")}</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {open && row && (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <RowDetails
                              row={row}
                              bridge={bridge}
                              invoke={invoke}
                              disabled={
                                pending || running || otherBusy || rateLimited
                              }
                              onReviewNext={reviewNext}
                              onChooseSteps={restoreSelection}
                              onStop={halt}
                              onVerify={verifyResult}
                              verifyingId={activeVerificationId}
                              verifyDisabled={pending || running || rateLimited}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  )
                })}
                {!view.rows.length && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <div className="converter-empty">
                        <Search size={22} />
                        <strong>
                          {t(
                            accounts.length
                              ? "Nenhuma conta encontrada"
                              : "Ainda não há contas"
                          )}
                        </strong>
                        <p>
                          {t(
                            accounts.length
                              ? "Experimenta outro nome ou filtro."
                              : "Adiciona contas para preparar a primeira conversão."
                          )}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <div className="converter-pagination">
              <span>
                {view.filteredCount
                  ? `${(view.page - 1) * view.pageSize + 1}–${Math.min(view.page * view.pageSize, view.filteredCount)}`
                  : "0"}{" "}
                {t("de")} {view.filteredCount}
              </span>
              <Pagination aria-label={t("Paginação das contas")}>
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label={t("Página anterior")}
                      disabled={view.page === 1}
                      onClick={() => setPage(view.page - 1)}
                    >
                      <ChevronLeft size={14} />
                    </Button>
                  </PaginationItem>
                  <PaginationItem>
                    <span>
                      {view.page} / {view.pages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label={t("Página seguinte")}
                      disabled={view.page === view.pages}
                      onClick={() => setPage(view.page + 1)}
                    >
                      <ChevronRight size={14} />
                    </Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
              <NativeSelect
                size="sm"
                aria-label={t("Contas por página")}
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
              >
                {[10, 20, 50].map((size) => (
                  <NativeSelectOption key={size} value={size}>
                    {size} / {t("página")}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </section>
        </div>
        <ConverterSequenceSummary
          steps={steps}
          routing={routing}
          totals={summaryTotals}
          accounts={accounts}
          destination={destination}
          needsDestination={transfer}
          continuing={!!resumeIds.length}
          repeating={!!repeatIds.length}
          locked={lockSelection}
          disabled={disabled || !bridge?.prepareTokenConverter}
          pending={pending}
          reason={reason}
          excludedCount={view.sourceIds.length - eligibleSourceIds.length}
          reviewButton={reviewButton}
          onDestinationChange={(destinationAccountId) =>
            onUiChange({ destinationAccountId })
          }
          onReview={() => { if (!refreshing) return prepare() }}
          pendingCount={pendingRows.length}
          recovery={pendingRows.length > 0 && (
            <section className="converter-active-results" aria-label={t("Pendências e operações ativas")}>
              <h4>{t("Pendências e operações ativas")} <Badge variant="outline">{pendingRows.length}</Badge></h4>
              {pendingRows.slice(0, 3).map((row) => (
                <div key={row.operationId} className="converter-active-result">
                  <strong>{row.sourceLabel}</strong>
                  <Badge variant="outline">{t(states[row.state] || row.state)}</Badge>
                  <p>{t(row.message || "")}</p>
                  <Recovery row={row} bridge={bridge} invoke={invoke}
                    disabled={pending || running || !!activeVerificationId || otherBusy || rateLimited}
                    onReviewNext={reviewNext} onChooseSteps={restoreSelection} onStop={halt}
                    onVerify={verifyResult} verifyingId={activeVerificationId}
                    verifyDisabled={pending || running || otherBusy || rateLimited} />
                </div>
              ))}
              {pendingRows.length > 3 && <Button variant="link" size="sm" onClick={() => setResultsOpen(true)}>{t("Ver todas as pendências")}</Button>}
            </section>
          )}
          onOpenResults={() => setResultsOpen(true)}
        />
      </div>
      {preview && (
        <ConverterReviewDialog
          preview={preview}
          pending={pending}
          preparation={status.preparation}
          stopping={!!stopping.all || status.phase === "stopping"}
          onStop={() => halt()}
          expired={expired}
          onReview={() => prepare()}
          error={error}
          stale={
            expired ||
            previewKey !== scopeKey ||
            running ||
            localBlocked ||
            otherBusy ||
            rateLimited
          }
          returnFocusRef={reviewButton}
          onClose={() => {
            setPreview(null)
            setError("")
          }}
          onConfirm={confirm}
          onProtected={prepare}
        />
      )}
      <Dialog open={resultsOpen} onOpenChange={setResultsOpen}>
        <DialogContent className="converter-results-dialog">
          <DialogHeader>
            <DialogTitle>{t("Resultados anteriores")}</DialogTitle>
            <DialogDescription>
              {t(
                "Consulta os resultados ou escolhe as próximas etapas de uma conta."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="converter-results-toolbar">
            <Button
              size="sm"
              variant="outline"
              disabled={lockSelection || !previous}
              onClick={() => restoreSelection()}
            >
              <RotateCcw size={13} />
              {t("Usar última seleção")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || running || !clearableCount}
              onClick={() => {
                setError("")
                setClearOpen(true)
              }}
            >
              <Archive size={13} />
              {t("Limpar concluídos")}
            </Button>
          </div>
          <div className="converter-results-list">
            {pendingRows.length > 0 && <h3 className="converter-results-heading">{t("Pendências e operações ativas")} · {pendingRows.length}</h3>}
            {[...pendingRows, ...historyRows].map((row, index) => (
              <section key={row.operationId} className="converter-result-row">
                {index === pendingRows.length && <h3 className="converter-results-heading">{t("Resultados anteriores")}</h3>}
                <header>
                  <strong>{row.sourceLabel}</strong>
                  <Badge variant="outline">
                    {t(states[row.state] || row.state)}
                  </Badge>
                </header>
                <p>
                  {formatNumber(
                    row.handoffCounts?.source || row.pendingStickers || 0
                  )}{" "}
                  {t("Na origem")} ·{" "}
                  {formatNumber(row.handoffCounts?.destination || 0)}{" "}
                  {t("Na Main")}
                  {row.unconfirmedResults > 0 &&
                    ` · ${row.unconfirmedResults} ${t("resultados por confirmar")}`}
                </p>
                <Recovery
                  row={row}
                  bridge={bridge}
                  invoke={invoke}
                  disabled={
                    pending ||
                    running ||
                    !!activeVerificationId ||
                    otherBusy ||
                    rateLimited
                  }
                  onReviewNext={(rows) => {
                    setResultsOpen(false)
                    reviewNext(rows)
                  }}
                  onChooseSteps={restoreSelection}
                  onStop={halt}
                  onVerify={verifyResult}
                  verifyingId={activeVerificationId}
                  verifyDisabled={pending || running || rateLimited}
                />
                {row.verification ? (
                  <ConverterVerificationFeedback
                    verification={row.verification}
                    closed={row.state === "unresolved"}
                  />
                ) : row.state === "unconfirmed" ? (
                  <p className="converter-result-message" role="status">
                    {t(row.message || "")}
                  </p>
                ) : null}
                <details>
                  <summary>{t("Detalhes")}</summary>
                  <RowDetails
                    row={row}
                    bridge={bridge}
                    invoke={invoke}
                    disabled={pending || running}
                    onReviewNext={reviewNext}
                    onChooseSteps={restoreSelection}
                    onStop={halt}
                    showActions={false}
                  />
                </details>
              </section>
            ))}
            {!status.rows.length && <p>{t("Sem resultados anteriores.")}</p>}
          </div>
          {error && (
            <p role="alert" className="converter-error">
              {t(error)}
            </p>
          )}
          <DialogFooter className="converter-results-pagination">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t("Página anterior de resultados")}
              disabled={currentHistoryPage === 1}
              onClick={() => setHistoryPage(currentHistoryPage - 1)}
            >
              <ChevronLeft size={14} />
            </Button>
            <span>
              {currentHistoryPage} / {historyPages}
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={t("Página seguinte de resultados")}
              disabled={currentHistoryPage === historyPages}
              onClick={() => setHistoryPage(currentHistoryPage + 1)}
            >
              <ChevronRight size={14} />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={clearOpen}
        onOpenChange={(open) => {
          if (!pending) setClearOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Limpar execução anterior?")}</DialogTitle>
            <DialogDescription>
              {t(
                "Os resultados serão retirados deste ecrã e guardados no arquivo local."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <p>
              {t("Resultados a limpar")}: <strong>{clearableCount}</strong>
            </p>
            {protectedCount > 0 && (
              <p>
                {t("Pendências preservadas")}: <strong>{protectedCount}</strong>
              </p>
            )}
            <p className="text-muted-foreground">
              {t("Contas, saldos e itens não serão alterados.")}
            </p>
            {error && (
              <p role="alert" className="converter-error">
                {t(error)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setClearOpen(false)}
            >
              {t("Cancelar")}
            </Button>
            <Button
              disabled={pending || running || otherBusy || !clearableCount}
              onClick={clearPrevious}
            >
              {pending ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Archive size={14} />
              )}
              {t("Limpar anterior")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
