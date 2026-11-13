import { DisclosurePanel } from "../components/WorkspaceSection.jsx"
import { t } from "../language.js"
import React, { useEffect, useMemo, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Package,
  RefreshCw,
  Search,
  LayoutGrid,
  List,
  SlidersHorizontal,
  CheckCheck,
  X,
  ArrowRight,
  Wallet,
  ScanLine,
  Layers,
  Star,
} from "lucide-react"
import { formatMoney, formatNumber, formatTime } from "../format.js"
import "./inventory.css"
import "./inventoryRedesign.css"
import { Button } from "../components/ui/button.jsx"
import {
  selectInventoryPage,
  deselectInventoryPage,
  inventorySelectionTotals,
} from "../inventorySelection.js"
import {
  InventoryCard,
  InventoryDetails,
  InventoryViews,
} from "./InventoryItems.jsx"
import InventoryFilters from "./InventoryFilters.jsx"
import StorageInventory from "./StorageInventory.jsx"
import InventoryBatchPanel from "./InventoryBatchPanel.jsx"
import ItemRankingPanel from "./ItemRankingPanel.jsx"
import InventoryActions, { InventoryOperations } from "./InventoryActions.jsx"
import { useInventoryActions } from "../useInventoryActions.js"
export { InventoryCard } from "./InventoryItems.jsx"

export default function InventoryPage({ model, ui, onUiChange, onNavigate }) {
  const { accounts, bridge } = model
  const [batchSelection, setBatchSelection] = useState([])
  const toggleBatch = (item) =>
    setBatchSelection((old) => {
      const key = accountId + ":" + item.id
      return old.some((entry) => entry.key === key)
        ? old.filter((entry) => entry.key !== key)
        : old.length >= 200
          ? old
          : [
              ...old,
              {
                key,
                item,
                ref: {
                  accountId,
                  itemId: item.id,
                  storageUnitId: null,
                  page: ui.page || 1,
                  name: item.name,
                },
              },
            ]
    })
  const storageView = ui.view === "storages"
  const accountId = accounts.some((account) => account.id === ui.accountId)
    ? ui.accountId
    : accounts[0]?.id || ""
  const actionRevision = model.inventoryRevision?.[accountId] || 0
  const controller = useInventoryActions({
    model,
    refKey: accountId + ":" + (storageView ? "storages" : "inventory"),
    onChanged: () => setRevision((value) => value + 1),
  })
  const page = ui.page || 1,
    sort = ui.sort || "true",
    favorites = ui.favorites || "all",
    search = ui.search || ""
  const filters = {
    search,
    sort,
    favorites,
    ...Object.fromEntries(
      ["rarity", "exterior", "eventName", "quality", "statTrakSouvenir"]
        .filter((name) => ui[name] !== undefined && ui[name] !== "")
        .map((name) => [name, ui[name]])
    ),
  }
  const key = JSON.stringify([
    accountId,
    page,
    sort,
    favorites,
    search,
    filters,
  ])
  const summary = ui.summaryAccountId === accountId ? ui.summary : null
  const data = ui.dataKey === key ? ui.data : null
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [summaryPending, setSummaryPending] = useState(false),
    [summaryError, setSummaryError] = useState("")
  useEffect(() => {
    if (!accountId || !bridge?.readInventorySummary) {
      setSummaryPending(false)
      return
    }
    if (
      revision === 0 &&
      summary &&
      (ui.summaryActionRevision || 0) === actionRevision &&
      Date.now() - summary.readAt < 30000
    )
      return
    let live = true
    setSummaryPending(true)
    setSummaryError("")
    bridge
      .readInventorySummary(accountId)
      .then((result) => {
        if (live)
          onUiChange({
            summary: result,
            summaryAccountId: accountId,
            summaryActionRevision: actionRevision,
          })
      })
      .catch((failure) => {
        if (live) setSummaryError(String(failure.message || failure))
      })
      .finally(() => {
        if (live) setSummaryPending(false)
      })
    return () => {
      live = false
    }
  }, [accountId, bridge, revision, actionRevision])
  useEffect(() => {
    if (accountId !== ui.accountId)
      onUiChange({ accountId, page: 1, detailId: null, dataKey: "" })
  }, [accountId])
  useEffect(() => {
    if (storageView || !accountId || !bridge?.readInventory) {
      setPending(false)
      return
    }
    if (
      revision === 0 &&
      (ui.actionRevision || 0) === actionRevision &&
      ui.dataKey === key &&
      Date.now() - ui.readAt < 30000
    ) {
      setPending(false)
      setError("")
      return
    }
    let live = true
    setPending(true)
    setError("")
    bridge
      .readInventory(accountId, page, filters)
      .then((result) => {
        if (!live) return
        if (page > result.pages) {
          onUiChange({ page: result.pages, detailId: null, dataKey: "" })
          return
        }
        onUiChange({
          data: result,
          dataKey: key,
          readAt: Date.now(),
          actionRevision,
        })
      })
      .catch((failure) => {
        if (live)
          setError(
            String(failure.message || failure).replace(
              /^Error invoking remote method '[^']+': Error: /,
              ""
            )
          )
      })
      .finally(() => {
        if (live) setPending(false)
      })
    return () => {
      live = false
    }
  }, [bridge, key, revision, storageView, actionRevision])
  function change(patch) {
    setError("")
    onUiChange({ ...patch, page: 1, detailId: null, dataKey: "" })
  }
  const selectedKeys = useMemo(
    () => new Set(batchSelection.map((entry) => entry.key)),
    [batchSelection]
  )
  const selected = data?.skins.find((item) => item.id === ui.detailId)
  if (!accounts.length)
    return (
      <section className="panel empty-state">
        <Package size={32} />
        <h2>{t("Adiciona uma conta para veres o inventário")}</h2>
        <p>
          {t(
            "Os itens e as fotografias aparecem depois de ligares uma sessão."
          )}
        </p>
        <button
          className="primary-button"
          onClick={() => onNavigate("accounts")}
        >
          {t("Adicionar conta")}
        </button>
      </section>
    )
  if (storageView)
    return (
      <StorageInventory
        model={model}
        ui={ui}
        accountId={accountId}
        onUiChange={onUiChange}
        events={summary?.events || []}
        batchSelection={batchSelection}
        setBatchSelection={setBatchSelection}
      />
    )
  const activeFilters = [
    ["search", t("Pesquisa"), search],
    [
      "favorites",
      t("Favoritos"),
      favorites === "all"
        ? ""
        : t(favorites === "only" ? "Só favoritos" : "Sem favoritos"),
    ],
    ["rarity", t("Raridade"), ui.rarity],
    ["exterior", t("Exterior"), ui.exterior],
    ["eventName", t("Evento"), ui.eventName],
    [
      "quality",
      t("Qualidade"),
      { 0: "Comum", 1: "Rara", 2: "Épica", 3: "Lendária" }[ui.quality] ??
        ui.quality,
    ],
    [
      "statTrakSouvenir",
      "StatTrak / Souvenir",
      {
        None: "Sem StatTrak nem Souvenir",
        "Non ST": "Sem StatTrak",
        "Non SV": "Sem Souvenir",
        "Only ST": "Só StatTrak",
        "Only SV": "Só Souvenir",
      }[ui.statTrakSouvenir] ?? ui.statTrakSouvenir,
    ],
  ].filter(([, , value]) => value !== undefined && value !== "")
  const selectionTotals = inventorySelectionTotals(batchSelection)
  const pageItems = data?.skins || []
  const allPageSelected =
    pageItems.length > 0 &&
    pageItems.every((item) => selectedKeys.has(accountId + ":" + item.id))
  const clearFilters = () =>
    change({
      search: "",
      query: "",
      favorites: "all",
      rarity: "",
      exterior: "",
      eventName: "",
      quality: "",
      statTrakSouvenir: "",
    })
  function reviewSelection() {
    const panel = document
      .getElementById("inventory-batch-workspace")
      ?.querySelector("details")
    if (panel) {
      panel.open = true
      panel.scrollIntoView({ behavior: "instant", block: "start" })
      const control = panel.querySelector(".inventory-batch-controls select")
      control?.focus({ preventScroll: true })
      control?.scrollIntoView({ behavior: "instant", block: "center" })
    }
  }
  return (
    <div className="page-stack inventory-workspace">
      <section className="panel inventory-browser-tools">
        <div className="inventory-account-bar">
          <label className="inventory-account-picker">
            <span>
              <Package size={15} aria-hidden="true" />
              {t("Conta do inventário")}
            </span>
            <select
              aria-label={t("Conta do inventário")}
              value={accountId}
              onChange={(event) => change({ accountId: event.target.value })}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>
          <div className="inventory-sync">
            <small>
              {data && ui.readAt
                ? t("Leitura às ") + formatTime(ui.readAt)
                : t("A aguardar leitura")}
            </small>
            <Button
              variant="outline"
              aria-label={t("Atualizar inventário")}
              disabled={pending || !bridge?.readInventory}
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw size={15} aria-hidden="true" />
              {t("Atualizar")}
            </Button>
          </div>
        </div>
        <div className="inventory-overview" aria-busy={summaryPending}>
          <div>
            <Wallet size={17} aria-hidden="true" />
            <span>
              {t("Valor virtual")}
              <strong>
                {summary?.value != null ? formatMoney(summary.value) : "—"}
              </strong>
            </span>
          </div>
          <div>
            <Layers size={17} aria-hidden="true" />
            <span>
              {t("Itens no inventário")}
              <strong>{data ? formatNumber(data.count) : "—"}</strong>
            </span>
          </div>
          <div>
            <ScanLine size={17} aria-hidden="true" />
            <span>
              {t("Cobertura de float")}
              <strong>
                {summary?.floatCoverage
                  ? formatNumber(summary.floatCoverage.percent, 1) + "%"
                  : "—"}
              </strong>
              <small>
                {summary?.floatCoverage
                  ? formatNumber(summary.floatCoverage.rankedSkins) +
                    " / " +
                    formatNumber(summary.floatCoverage.totalSkins)
                  : t("Indisponível")}
              </small>
            </span>
          </div>
        </div>
        {summaryPending && (
          <small className="muted" role="status">
            {t("A atualizar resumo…")}
          </small>
        )}
        {(summaryError || summary?.errors?.length > 0) && (
          <p className="inline-error" role="status">
            {t(summaryError || summary.errors.join(" · "))}
          </p>
        )}
        <InventoryViews
          view="inventory"
          onChange={(view) => onUiChange({ view })}
        />
        <div className="inventory-filterbar">
          <form
            className="inventory-search"
            onSubmit={(event) => {
              event.preventDefault()
              change({ search: (ui.query || "").trim() })
            }}
          >
            <div className="inventory-search-field">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label={t("Pesquisar itens")}
                placeholder={t("Pesquisar por nome do item")}
                value={ui.query || ""}
                onChange={(event) => onUiChange({ query: event.target.value })}
              />
              {ui.query && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("Limpar pesquisa")}
                  onClick={() => change({ search: "", query: "" })}
                >
                  <X size={14} />
                </Button>
              )}
            </div>
            <Button
              type="submit"
              variant="secondary"
              disabled={pending || !bridge?.readInventory}
            >
              {t("Pesquisar")}
            </Button>
          </form>
          <label className="inventory-sort">
            <span>{t("Ordenação")}</span>
            <select
              aria-label={t("Ordenação do inventário")}
              value={sort}
              onChange={(event) => change({ sort: event.target.value })}
            >
              <option value="true">{t("Recentes")}</option>
              <option value="price">{t("Preço")}</option>
              <option value="float">Float</option>
              <option value="rank">{t("Ranking de float")}</option>
            </select>
          </label>
          <Button
            variant={favorites === "only" ? "secondary" : "outline"}
            aria-pressed={favorites === "only"}
            onClick={() =>
              change({ favorites: favorites === "only" ? "all" : "only" })
            }
          >
            <Star size={15} aria-hidden="true" />
            {t("Favoritos")}
          </Button>
          <Button
            variant="outline"
            aria-expanded={!!ui.filtersOpen}
            aria-controls="inventory-advanced"
            onClick={() => onUiChange({ filtersOpen: !ui.filtersOpen })}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            {t("Filtros")}
            {activeFilters.length > 0 && (
              <span className="inventory-count-badge">
                {activeFilters.length}
              </span>
            )}
          </Button>
        </div>
        {ui.filtersOpen && (
          <div id="inventory-advanced" className="inventory-filter-panel">
            <InventoryFilters
              values={ui}
              onChange={change}
              events={summary?.events || []}
            />
            <label>
              {t("Favoritos")}
              <select
                aria-label={t("Favoritos do inventário")}
                value={favorites}
                onChange={(event) => change({ favorites: event.target.value })}
              >
                <option value="all">{t("Todos os itens")}</option>
                <option value="only">{t("Só favoritos")}</option>
                <option value="none">{t("Sem favoritos")}</option>
              </select>
            </label>
          </div>
        )}
        {activeFilters.length > 0 && (
          <div
            className="inventory-active-filters"
            aria-label={t("Filtros ativos")}
          >
            {activeFilters.map(([key, label, value]) => (
              <Button
                key={key}
                size="sm"
                variant="secondary"
                aria-label={t("Remover filtro") + ": " + label}
                onClick={() =>
                  change({
                    [key]: key === "favorites" ? "all" : "",
                    ...(key === "search" ? { query: "" } : {}),
                  })
                }
              >
                {label}: {t(value)}
                <X size={12} aria-hidden="true" />
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              {t("Limpar filtros")}
            </Button>
          </div>
        )}
      </section>

      <section className="panel inventory-results" aria-busy={pending}>
        <div className="section-heading inventory-collection-heading">
          <div>
            <h2>{t("A tua coleção")}</h2>
            <small className="muted">
              {data
                ? formatNumber(data.skins.length) +
                  " " +
                  t("itens nesta página")
                : t("Inventário")}
            </small>
          </div>
          <div className="inventory-display-controls">
            {bridge?.prepareInventoryBatch && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending || !pageItems.length}
                onClick={() =>
                  setBatchSelection((old) =>
                    allPageSelected
                      ? deselectInventoryPage(old, pageItems, accountId)
                      : selectInventoryPage(old, pageItems, accountId, page)
                  )
                }
              >
                <CheckCheck size={15} aria-hidden="true" />
                {t(allPageSelected ? "Desmarcar página" : "Selecionar página")}
              </Button>
            )}
            <div
              role="group"
              aria-label={t("Apresentação dos itens")}
              className="inventory-layout-toggle"
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("Vista em grelha")}
                aria-pressed={ui.layout !== "list"}
                onClick={() => onUiChange({ layout: "grid" })}
              >
                <LayoutGrid size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("Vista em lista")}
                aria-pressed={ui.layout === "list"}
                onClick={() => onUiChange({ layout: "list" })}
              >
                <List size={16} />
              </Button>
            </div>
            {ui.layout !== "list" && (
              <label className="inventory-density">
                <span>{t("Densidade")}</span>
                <select
                  aria-label={t("Densidade da grelha")}
                  value={ui.density || "comfortable"}
                  onChange={(event) =>
                    onUiChange({ density: event.target.value })
                  }
                >
                  <option value="comfortable">{t("Confortável")}</option>
                  <option value="compact">{t("Compacta")}</option>
                </select>
              </label>
            )}
          </div>
        </div>
        {!bridge?.readInventory && (
          <p className="inline-error">
            {t(
              "A leitura do inventário não está disponível nesta versão da app."
            )}
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {t(error)}
            {t(" Usa Atualizar para tentar novamente.")}
          </p>
        )}
        {pending && !data ? (
          <div className="inventory-loading" role="status">
            {t("A carregar os itens…")}
          </div>
        ) : data?.skins.length ? (
          <div
            className={
              ui.layout === "list"
                ? "inventory-list"
                : "inventory-grid" +
                  (ui.density === "compact" ? " is-compact" : "")
            }
          >
            {data.skins.map((item) => (
              <InventoryCard
                key={item.id}
                item={item}
                onSelect={
                  bridge?.prepareInventoryBatch ? toggleBatch : undefined
                }
                selectionDisabled={pending}
                selected={selectedKeys.has(accountId + ":" + item.id)}
                onOpen={(id) => onUiChange({ detailId: id })}
                onActions={(item, event) =>
                  controller.openMenu(
                    {
                      accountId,
                      itemId: item.id,
                      storageUnitId: null,
                      page,
                      name: item.name,
                    },
                    item,
                    event,
                    () => onUiChange({ detailId: item.id })
                  )
                }
              />
            ))}
          </div>
        ) : data ? (
          <div className="empty-state">
            <Package size={32} />
            <h2>
              {t(
                activeFilters.length > 0
                  ? "Sem itens para estes filtros"
                  : "Este inventário está vazio"
              )}
            </h2>
            <p>
              {t(
                activeFilters.length > 0
                  ? "Experimenta outro nome ou escolhe Todos os itens."
                  : "Atualiza depois de receberes novos itens."
              )}
            </p>
            {activeFilters.length > 0 && (
              <Button variant="outline" onClick={clearFilters}>
                {t("Limpar filtros")}
              </Button>
            )}
          </div>
        ) : null}
        {data && (
          <nav
            className="inventory-pagination"
            aria-label={t("Páginas do inventário")}
          >
            <button
              disabled={pending || page <= 1}
              onClick={() => onUiChange({ page: page - 1, detailId: null })}
            >
              <ChevronLeft size={16} />
              {t("Anterior")}
            </button>
            <span>
              {t("Página ")}
              {t(page)}
              {t(" de ")}
              {t(formatNumber(data.pages))}
            </span>
            <button
              disabled={pending || page >= data.pages}
              onClick={() => onUiChange({ page: page + 1, detailId: null })}
            >
              {t("Seguinte")}
              <ChevronRight size={16} />
            </button>
          </nav>
        )}
      </section>
      {batchSelection.length > 0 && (
        <aside
          className="inventory-selection-bar"
          aria-label={t("Seleção de itens")}
        >
          <div className="inventory-selection-count">
            <CheckCheck size={19} aria-hidden="true" />
            <span>
              <strong role="status">
                {selectionTotals.count} {t("selecionados")}
              </strong>
              <small>
                {selectionTotals.accounts}{" "}
                {t(selectionTotals.accounts === 1 ? "Conta" : "Contas")} ·{" "}
                {t("Limite de seleção")}: 200
              </small>
            </span>
          </div>
          <div className="inventory-selection-value">
            <small>{t("Valor virtual selecionado")}</small>
            <strong>
              {formatMoney(selectionTotals.value)}
              {selectionTotals.unknownPrices > 0 ? " + ?" : ""}
            </strong>
            <small>
              {t("Valores da última leitura")}
              {selectionTotals.unknownPrices > 0
                ? " · " + selectionTotals.unknownPrices + " " + t("sem preço")
                : ""}
            </small>
          </div>
          <Button variant="ghost" onClick={() => setBatchSelection([])}>
            <X size={15} aria-hidden="true" />
            {t("Limpar seleção")}
          </Button>
          <Button onClick={reviewSelection}>
            {t("Rever ações")}
            <ArrowRight size={15} aria-hidden="true" />
          </Button>
        </aside>
      )}
      <div id="inventory-batch-workspace">
        <DisclosurePanel
          title="Ações em lote"
          badge={batchSelection.length + " " + t("selecionados")}
          forceOpen={batchSelection.length > 0}
          description="Rever uma ação antes de a executar nas skins selecionadas."
        >
          <InventoryBatchPanel
            model={model}
            accountId={accountId}
            items={data?.skins || []}
            page={page}
            selection={batchSelection}
            onSelectionChange={setBatchSelection}
          />
        </DisclosurePanel>
      </div>
      <DisclosurePanel
        title="Ranking dos itens"
        description="Consultar posições e critérios de float."
      >
        <ItemRankingPanel
          bridge={bridge}
          accountId={accountId}
          items={data?.skins || []}
        />
      </DisclosurePanel>
      <InventoryOperations
        model={model}
        controller={controller}
        accountId={accountId}
      />
      <InventoryActions controller={controller} accounts={accounts} />
      {selected && (
        <InventoryDetails
          item={selected}
          onClose={() => onUiChange({ detailId: null })}
        />
      )}
    </div>
  )
}
