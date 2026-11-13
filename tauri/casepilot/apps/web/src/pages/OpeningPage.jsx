import { useCaseCatalog } from "../useCaseCatalog.js"
import { groupOpeningRules } from "../openingRuleGroups.js"
import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Boxes,
  Search,
  Star,
  Check,
  ChevronLeft,
  ChevronRight,
  PackageOpen,
  Square,
  RefreshCw,
  Clock3,
  ArrowUpRight,
  UserRoundMinus,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Badge } from "@workspace/ui/components/badge"
import { Switch } from "@workspace/ui/components/switch"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@workspace/ui/components/tabs"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@workspace/ui/components/pagination"
import AccountSelection from "../components/AccountSelection.jsx"
import EventRow from "../components/EventRow.jsx"
import OpeningItemRules from "./OpeningItemRules.jsx"
import { validateRuleSet } from "../openingRulesViewModel.js"
import { t } from "../language.js"
import { formatNumber } from "../format.js"
import {
  createOpeningCatalog,
  selectOpeningCatalog,
  openingCatalogPage,
  openingQuantityPreview,
  openingAccountsWithoutStock,
} from "../openingViewModel.js"
import "./opening.css"

const CATEGORIES = [
  ["all", "Tudo"],
  ["cases", "Caixas"],
  ["capsules", "Cápsulas"],
  ["collections", "Coleções"],
  ["keychainCollections", "Porta-chaves"],
]
function savedFavorites() {
  try {
    const value = JSON.parse(
      localStorage.getItem("casepilot:opening-favorites-v1") || "[]"
    )
    return Array.isArray(value)
      ? value.filter((id) => typeof id === "string").slice(0, 1000)
      : []
  } catch {
    return []
  }
}
function Artwork({ src, name = "", className = "" }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return (
    <span className={`case-art ${className}`}>
      {src && !failed ? (
        <img
          src={src}
          alt={name}
          width="200"
          height="150"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Boxes size={32} aria-hidden="true" />
      )}
    </span>
  )
}
function Pager({ page, onChange, label = "Paginação das caixas" }) {
  return (
    <Pagination aria-label={t(label)} className="opening-pagination">
      <PaginationContent>
        <PaginationItem>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("Página anterior")}
            disabled={page.page <= 1}
            onClick={() => onChange(page.page - 1)}
          >
            <ChevronLeft className="rtl:rotate-180" />
          </Button>
        </PaginationItem>
        <PaginationItem>
          <span aria-live="polite">
            {t(`Página ${page.page} de ${page.pages}`)}
          </span>
        </PaginationItem>
        <PaginationItem>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t("Página seguinte")}
            disabled={page.page >= page.pages}
            onClick={() => onChange(page.page + 1)}
          >
            <ChevronRight className="rtl:rotate-180" />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
function Results({ opening, events, accounts, cooldown }) {
  const names = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.label])),
    [accounts]
  )
  const results = useMemo(
    () =>
      events
        .filter((event) =>
          [
            "open",
            "conversion",
            "opening-item",
            "open-started",
            "open-finished",
            "account-error",
          ].includes(event.type)
        )
        .slice(0, 15),
    [events]
  )
  const [accountPage, setAccountPage] = useState(1)
  const rows = openingCatalogPage(opening.accounts || [], {
    prepared: true,
    page: accountPage,
    pageSize: 12,
  })
  return (
    <div className="opening-results-body">
      <div className="opening-result-heading">
        <h2>{t("Resultados da abertura")}</h2>
        <Badge variant="secondary">
          {t(
            cooldown
              ? `${cooldown} s de espera`
              : ["running", "stopping"].includes(opening.phase)
                ? "Em execução"
                : opening.phase === "complete"
                  ? "Concluída"
                  : "Pronta"
          )}
        </Badge>
      </div>
      <dl className="opening-result-metrics">
        {[
          ["Confirmadas", opening.confirmed ?? opening.opened ?? 0],
          ["Aceites", opening.accepted || 0],
          ["Por confirmar", opening.unconfirmed || 0],
          ["Itens convertidos", opening.converted || 0],
          ["Falhas", opening.failed || 0],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd>{formatNumber(value)}</dd>
          </div>
        ))}
      </dl>
      {rows.total > 0 && (
        <div className="opening-run-accounts">
          <table>
            <thead>
              <tr>
                <th>{t("Conta")}</th>
                <th>{t("Caixas abertas")}</th>
                <th>{t("Estado")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.items.map((row) => (
                <tr key={row.id}>
                  <td>{names.get(row.id) || row.id}</td>
                  <td>
                    {formatNumber(row.opened || 0)}
                    {row.target != null && ` / ${formatNumber(row.target)}`}
                  </td>
                  <td>
                    {t(
                      row.disabled
                        ? "Parada"
                        : row.target != null && row.opened >= row.target
                          ? "Concluída"
                          : ["running", "stopping"].includes(opening.phase)
                            ? "Em execução"
                            : "Concluída"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.pages > 1 && (
            <Pager
              page={rows}
              onChange={setAccountPage}
              label="Paginação dos resultados"
            />
          )}
        </div>
      )}
      {results.length ? (
        <div className="opening-event-list">
          {results.map((event, index) => (
            <EventRow
              key={event.at + ":" + index}
              event={event}
              label={names.get(event.accountId)}
              destinationLabel={names.get(event.destinationAccountId)}
            />
          ))}
        </div>
      ) : (
        <div className="opening-quiet-empty">
          <PackageOpen size={24} aria-hidden="true" />
          <div>
            <h3>{t("Ainda não há resultados")}</h3>
            <p>
              {t(
                "As aberturas confirmadas e os destinos dos itens aparecem aqui."
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
export default function OpeningPage({ model, ui = {}, onUiChange }) {
  const { form, opening, accounts, selectedIds, actions, snapshots, bridge } =
    model
  const loadSkinMetadata = useMemo(
    () =>
      bridge?.skinMetadata
        ? (name) => bridge.skinMetadata(form.caseId, name)
        : undefined,
    [bridge, form.caseId]
  )
  const inspectorRef = useRef(null)
  const appliedProfile = useRef(null)
  const loadedProfile = model.loadedOperationProfile
  const [localUi, setLocalUi] = useState({})
  const view = {
    query: "",
    category: "all",
    stockOnly: true,
    favoritesOnly: false,
    sort: "quantity",
    page: 1,
    pageSize: 12,
    tab: "content",
    continuous: true,
    quantity: "10",
    ...localUi,
    ...ui,
  }
  const update = (patch) =>
    onUiChange ? onUiChange(patch) : setLocalUi((old) => ({ ...old, ...patch }))
  const filter = (patch) => update({ ...patch, page: 1 })
  const [favorites, setFavorites] = useState(savedFavorites)
  const saved = useMemo(() => new Set(favorites), [favorites])
  const [detail, setDetail] = useState(null),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState("")
  const [retry, setRetry] = useState(0),
    [contentPage, setContentPage] = useState(1)
  const [rulesByCase, setRulesByCase] = useState(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("casepilot:opening-rules-v1") || "{}"
      )
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {}
    } catch {
      return {}
    }
  })
  const running = ["running", "stopping"].includes(opening.phase),
    locked = model.running || model.busy
  const {
    catalog,
    loading: catalogLoading,
    refreshing: catalogRefreshing,
    error: catalogError,
    discovery,
  } = useCaseCatalog({
    bridge,
    accountCount: accounts.length,
    paused: !!model.busy,
    refreshToken: retry,
  })
  const detailRef = useRef(null)
  detailRef.current = detail
  const itemRules = useMemo(() => {
    const current = rulesByCase[form.caseId] || {}
    return Array.isArray(current)
      ? current
      : Object.entries(current).map(([name, rule]) => ({ name, ...rule }))
  }, [rulesByCase, form.caseId])
  const ruleGroupCount = useMemo(
    () => groupOpeningRules(itemRules).length,
    [itemRules]
  )
  const ruleValidation = useMemo(
    () =>
      validateRuleSet(
        itemRules,
        detail?.id === form.caseId ? detail.items || [] : []
      ),
    [itemRules, detail, form.caseId]
  )
  const boxes = useMemo(
    () => createOpeningCatalog({ catalog, accounts, selectedIds, snapshots }),
    [catalog, accounts, selectedIds, snapshots]
  )
  const byId = useMemo(
    () => new Map(boxes.map((box) => [box.id, box])),
    [boxes]
  )
  const selectedCase = byId.get(form.caseId)
  const isCapsule = selectedCase?.category === "capsules"
  const selectedCaseId = selectedCase?.id
  const filtered = useMemo(
    () =>
      selectOpeningCatalog(boxes, {
        category: view.category,
        stockOnly: view.stockOnly,
        favoritesOnly: view.favoritesOnly,
        favorites,
        query: view.query,
        sort: view.sort,
      }),
    [
      boxes,
      view.category,
      view.stockOnly,
      view.favoritesOnly,
      favorites,
      view.query,
      view.sort,
    ]
  )
  const page = openingCatalogPage(filtered, {
    prepared: true,
    page: view.page,
    pageSize: view.pageSize,
  })
  const preview = openingQuantityPreview(
    selectedCase?.stockByAccount,
    selectedIds,
    view.continuous ? null : view.quantity
  )
  const withoutStockIds = openingAccountsWithoutStock(
    selectedCase?.stockByAccount,
    selectedIds,
    snapshots
  )
  const validPrice =
    form.maxPrice !== "" &&
    Number.isFinite(Number(form.maxPrice)) &&
    Number(form.maxPrice) >= 0 &&
    Number(form.maxPrice) <= 1000
  const canOpen = ["cases", "capsules"].includes(selectedCase?.category) && preview.accounts > 0
  const disabled =
    !bridge ||
    locked ||
    !canOpen ||
    !preview.valid ||
    !ruleValidation.valid ||
    (form.convert && !isCapsule && !validPrice) ||
    (itemRules.length > 0 && (!detail || detail.id !== form.caseId))
  const contents = openingCatalogPage(detail?.items || [], {
    prepared: true,
    page: contentPage,
    pageSize: 12,
  })
  function chooseCase(id) {
    model.setForm({ caseId: id })
    if (window.matchMedia("(max-width: 699px)").matches) {
      inspectorRef.current?.focus({ preventScroll: true })
      inspectorRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      })
    }
  }
  function toggleFavorite(id) {
    const next = saved.has(id)
      ? favorites.filter((value) => value !== id)
      : [...favorites, id]
    setFavorites(next)
    try {
      localStorage.setItem(
        "casepilot:opening-favorites-v1",
        JSON.stringify(next)
      )
    } catch {
      model.setNotice?.(
        "Não foi possível guardar os favoritos neste dispositivo."
      )
    }
  }
  function persistRules(rules) {
    const next = { ...rulesByCase, [form.caseId]: rules }
    setRulesByCase(next)
    model.setProfileRules?.(next)
    try {
      localStorage.setItem("casepilot:opening-rules-v1", JSON.stringify(next))
    } catch {
      model.setNotice?.("Não foi possível guardar as regras neste dispositivo.")
    }
    if (rules.length && form.convert) model.setForm({ convert: false })
  }
  function updateRule(name, rule) {
    const next = itemRules.filter((value) => value.name !== name)
    if (rule) next.push({ name, ...rule })
    persistRules(next)
  }
  function start(testOnce) {
    if (disabled || (testOnce && selectedIds.length !== 1)) return
    update({ tab: "results" })
    actions.startOpening(testOnce, itemRules, {
      convert: !isCapsule && form.convert,
      maxCasesPerAccount: testOnce
        ? 1
        : view.continuous
          ? undefined
          : Number(view.quantity),
    })
  }
  useEffect(() => {
    if (!loadedProfile || appliedProfile.current === loadedProfile) return
    const config = loadedProfile.config
    if (!config?.itemRules) return
    appliedProfile.current = loadedProfile
    setRulesByCase((old) => {
      const next = {
        ...old,
        [config.targetCase || form.caseId]: config.itemRules,
      }
      try {
        localStorage.setItem("casepilot:opening-rules-v1", JSON.stringify(next))
      } catch {}
      return next
    })
  }, [loadedProfile, form.caseId])
  useEffect(() => {
    if (!locked && !catalogLoading && boxes.length && !byId.has(form.caseId))
      model.setForm({
        caseId: (
          boxes.find((box) => box.total > 0 && box.category === "cases") ||
          boxes[0]
        ).id,
      })
  }, [locked, catalogLoading, boxes, byId, form.caseId, model])
  useEffect(() => {
    const changing = detailRef.current?.id !== selectedCaseId
    if (changing) setDetail(null)
    setDetailError("")
    setContentPage(1)
    if (!bridge?.caseDetails || !selectedCaseId) {
      setDetailLoading(false)
      return
    }
    let live = true
    if (changing) setDetailLoading(true)
    bridge
      .caseDetails(selectedCaseId)
      .then((value) => {
        if (live) setDetail(value)
      })
      .catch((error) => {
        if (live) setDetailError(error.message)
      })
      .finally(() => {
        if (live) setDetailLoading(false)
      })
    return () => {
      live = false
    }
  }, [bridge, selectedCaseId, retry, discovery?.revision])
  return (
    <div className="opening-workspace">
      <AccountSelection
        accounts={accounts}
        selectedIds={selectedIds}
        onChange={model.setSelectedIds}
        disabled={locked}
      />
      <div className="opening-workbench">
        <section
          className="opening-library"
          aria-labelledby="opening-library-title"
        >
          <div className="opening-library-heading">
            <h2 id="opening-library-title">{t("Catálogo")}</h2>
            <span>
              {formatNumber(boxes.length)} {t("tipos")}
            </span>
          </div>
          <div
            className="opening-site-status"
            aria-label={t("Novidades do site")}
          >
            <span>
              {discovery?.event?.status === "active"
                ? t("Evento ativo") + " · " + discovery.event.name
                : discovery?.event?.status === "scheduled"
                  ? t("Próximo evento") + " · " + discovery.event.name
                  : t("Sem evento ativo")}
            </span>
            {!!discovery?.newCaseIds?.length && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  filter({ stockOnly: false, category: "all", query: "" })
                }
              >
                {t("Novas caixas")}: {discovery.newCaseIds.length}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Atualizar catálogo e eventos")}
              disabled={!!model.busy || catalogRefreshing}
              onClick={() => setRetry((value) => value + 1)}
            >
              <RefreshCw size={14} />
            </Button>
          </div>
          <div
            className="opening-category-bar"
            aria-label={t("Categorias de caixas")}
          >
            {CATEGORIES.filter(
              ([key]) =>
                key === "all" || boxes.some((box) => box.category === key)
            ).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={view.category === key}
                onClick={() => filter({ category: key })}
              >
                {t(label)}
              </Button>
            ))}
          </div>
          <div className="opening-search-row">
            <div className="opening-search-field">
              <Search size={16} aria-hidden="true" />
              <Input
                type="search"
                aria-label={t("Procurar caixa")}
                placeholder={t("Procurar caixa")}
                value={view.query}
                onChange={(event) => filter({ query: event.target.value })}
              />
            </div>
            <NativeSelect
              aria-label={t("Ordenar caixas")}
              value={view.sort}
              onChange={(event) => filter({ sort: event.target.value })}
            >
              <NativeSelectOption value="quantity">
                {t("Mais caixas")}
              </NativeSelectOption>
              <NativeSelectOption value="name">
                {t("Nome A–Z")}
              </NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="opening-filter-row">
            <label htmlFor="opening-stock-only">
              <Switch
                id="opening-stock-only"
                size="sm"
                checked={view.stockOnly}
                onCheckedChange={(checked) => filter({ stockOnly: checked })}
              />
              {t("Com stock")}
            </label>
            <Button
              type="button"
              size="sm"
              variant={view.favoritesOnly ? "secondary" : "ghost"}
              aria-pressed={view.favoritesOnly}
              onClick={() => filter({ favoritesOnly: !view.favoritesOnly })}
            >
              <Star
                size={14}
                fill={view.favoritesOnly ? "currentColor" : "none"}
              />
              {t("Favoritos")}
              <span className="opening-filter-count">{favorites.length}</span>
            </Button>
            <span className="opening-filter-total" role="status">
              {page.total} {t("resultados")}
            </span>
          </div>
          {catalogError && (
            <div className="opening-feedback" role="status">
              <span>
                {t(
                  "Não foi possível atualizar o catálogo. Mantivemos os últimos dados."
                )}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRetry((value) => value + 1)}
              >
                <RefreshCw />
                {t("Tentar de novo")}
              </Button>
            </div>
          )}
          {catalogLoading && !boxes.length ? (
            <div className="opening-skeleton" role="status">
              {t("A carregar catálogo…")}
            </div>
          ) : page.total ? (
            <div className="opening-tile-grid">
              {page.items.map((box) => (
                <article
                  key={box.id}
                  className="opening-tile"
                  data-case-id={box.id}
                  data-selected={box.id === form.caseId}
                >
                  <button
                    type="button"
                    data-slot="case-choice"
                    className="opening-tile-choice"
                    aria-label={t("Selecionar caixa") + " · " + box.name}
                    aria-pressed={box.id === form.caseId}
                    disabled={locked}
                    onClick={() => chooseCase(box.id)}
                  >
                    <Artwork src={box.image} />
                    <span className="opening-tile-name">{box.name}</span>
                    <span className="opening-tile-stock">
                      <strong>{formatNumber(box.total)}</strong>
                      <span>{t("em stock")}</span>
                      {box.id === form.caseId && (
                        <Check size={14} aria-hidden="true" />
                      )}
                    </span>
                  </button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="opening-save-case"
                    aria-label={
                      t(
                        saved.has(box.id)
                          ? "Remover dos favoritos"
                          : "Adicionar aos favoritos"
                      ) +
                      " · " +
                      box.name
                    }
                    aria-pressed={saved.has(box.id)}
                    onClick={() => toggleFavorite(box.id)}
                  >
                    <Star fill={saved.has(box.id) ? "currentColor" : "none"} />
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="opening-library-empty">
              <Boxes size={28} aria-hidden="true" />
              <h3>{t("Nenhuma caixa encontrada")}</h3>
              <p>
                {t(
                  view.stockOnly
                    ? "Muda os filtros ou escolhe outras contas para ver o stock disponível."
                    : "Experimenta outro nome ou categoria."
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  filter({
                    category: "all",
                    query: "",
                    stockOnly: false,
                    favoritesOnly: false,
                  })
                }
              >
                {t("Limpar filtros")}
              </Button>
            </div>
          )}
          <div className="opening-library-footer">
            <span>
              {page.start}–{page.end} {t("de")} {page.total}
            </span>
            <label>
              {t("Por página")}
              <NativeSelect
                aria-label={t("Caixas por página")}
                value={view.pageSize}
                onChange={(event) =>
                  filter({ pageSize: Number(event.target.value) })
                }
              >
                <NativeSelectOption value="12">12</NativeSelectOption>
                <NativeSelectOption value="24">24</NativeSelectOption>
              </NativeSelect>
            </label>
            <Pager page={page} onChange={(value) => update({ page: value })} />
          </div>
        </section>
        <aside
          ref={inspectorRef}
          tabIndex={-1}
          className="opening-inspector"
          aria-label={t("Configurar abertura")}
        >
          {selectedCase ? (
            <>
              <div className="opening-selected-case">
                <Artwork
                  src={detail?.image || selectedCase.image}
                  name={selectedCase.name}
                />
                <span className="opening-eyebrow">
                  {t(
                    CATEGORIES.find(
                      ([key]) => key === selectedCase.category
                    )?.[1] || "Caixa"
                  )}
                </span>
                <h2>{selectedCase.name}</h2>
                <p>
                  <strong>{formatNumber(selectedCase.total)}</strong>{" "}
                  {t(isCapsule ? "cápsulas nas contas selecionadas" : "caixas nas contas selecionadas")}
                </p>
              </div>
              <div className="opening-stock-summary">
                <span>
                  {preview.accounts} / {selectedIds.length}{" "}
                  {t("contas com stock")}
                </span>
                {withoutStockIds.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={locked}
                    title={t("Desselecionar contas sem stock deste item")}
                    onClick={() => {
                      const emptyIds = new Set(withoutStockIds)
                      model.setSelectedIds((current) =>
                        current.filter((id) => !emptyIds.has(id))
                      )
                    }}
                  >
                    <UserRoundMinus size={14} />
                    {t(`Remover sem stock (${withoutStockIds.length})`)}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={locked || !selectedCase.holderIds.length}
                  onClick={() => model.setSelectedIds(selectedCase.holderIds)}
                >
                  {t("Selecionar contas com stock")}
                  <ArrowUpRight size={14} />
                </Button>
              </div>
              <details className="opening-stock-details">
                <summary>
                  {t("Stock por conta")}
                  <span>{t("Última leitura")}</span>
                </summary>
                <table>
                  <tbody>
                    {accounts
                      .filter(
                        (account) => selectedCase.stockByAccount[account.id] > 0
                      )
                      .map((account) => (
                        <tr key={account.id}>
                          <th scope="row">{account.label}</th>
                          <td>
                            {formatNumber(
                              selectedCase.stockByAccount[account.id]
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!selectedCase.holderIds.length && (
                  <p>{t("Sem stock nas contas com leitura disponível.")}</p>
                )}
              </details>
              <div className="opening-run-settings">
                <label
                  className="opening-switch-label"
                  htmlFor="opening-continuous"
                >
                  <span>
                    <strong>{t("Abertura contínua")}</strong>
                    <small>{t("Até esgotar o stock ou parar.")}</small>
                  </span>
                  <Switch
                    id="opening-continuous"
                    aria-label={t("Abertura contínua")}
                    checked={view.continuous}
                    disabled={locked}
                    onCheckedChange={(checked) =>
                      update({ continuous: checked })
                    }
                  />
                </label>
                {!view.continuous && (
                  <div className="opening-quantity">
                    <label htmlFor="opening-quantity">
                      {t("Quantidade por conta")}
                    </label>
                    <Input
                      id="opening-quantity"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="10000"
                      step="1"
                      value={view.quantity}
                      disabled={locked}
                      aria-invalid={!preview.valid}
                      onChange={(event) =>
                        update({ quantity: event.target.value })
                      }
                    />
                    <div>
                      {[1, 10, 100, 1000].map((count) => (
                        <Button
                          key={count}
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={locked}
                          onClick={() => update({ quantity: String(count) })}
                        >
                          {formatNumber(count)}
                        </Button>
                      ))}
                    </div>
                    {!preview.valid && (
                      <p role="alert" className="opening-validation">
                        {t("Escolhe um número inteiro entre 1 e 10 000.")}
                      </p>
                    )}
                  </div>
                )}
                <label
                  className="opening-switch-label"
                  htmlFor="opening-convert"
                >
                  <span>
                    <strong>{t("Converter itens baratos")}</strong>
                    <small>
                      {t(
                        itemRules.length
                          ? "As regras por item estão ativas."
                          : isCapsule
                            ? "Os stickers recebidos ficam no inventário."
                          : "Apenas itens comuns, sem favoritos."
                      )}
                    </small>
                  </span>
                  <Switch
                    id="opening-convert"
                    aria-label={t("Converter itens baratos")}
                    checked={!isCapsule && form.convert}
                    disabled={locked || itemRules.length > 0 || isCapsule}
                    onCheckedChange={(checked) =>
                      model.setForm({ convert: checked })
                    }
                  />
                </label>
                {form.convert && !isCapsule && (
                  <div className="opening-conversion-fields">
                    <label>
                      {t("Destino da conversão")}
                      <NativeSelect
                        value={form.conversionMode}
                        disabled={locked}
                        onChange={(event) =>
                          model.setForm({ conversionMode: event.target.value })
                        }
                      >
                        <NativeSelectOption value="tokens">
                          {t("Tokens")}
                        </NativeSelectOption>
                        <NativeSelectOption value="money">
                          {t("Dinheiro virtual")}
                        </NativeSelectOption>
                      </NativeSelect>
                    </label>
                    <label>
                      {t("Teto do item ($ virtual)")}
                      <Input
                        type="number"
                        min="0"
                        max="1000"
                        step="0.01"
                        value={form.maxPrice}
                        disabled={locked}
                        aria-invalid={!validPrice}
                        onChange={(event) =>
                          model.setForm({ maxPrice: event.target.value })
                        }
                      />
                    </label>
                    {!validPrice && (
                      <p className="opening-validation" role="alert">
                        {t("O teto deve estar entre $0 e $1000.")}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="opening-launch">
                <div className="opening-launch-summary">
                  <span>{t("Abertura prevista")}</span>
                  <strong>
                    {t("Até")} {formatNumber(preview.total)} {t(isCapsule ? "cápsulas" : "caixas")}
                  </strong>
                  <small>
                    {preview.accounts} {t("contas com stock")}
                    {itemRules.length
                      ? ` · ${ruleGroupCount} ${t("regras ativas")}`
                      : ""}
                  </small>
                </div>
                {running ? (
                  <Button
                    variant="destructive"
                    disabled={opening.phase === "stopping"}
                    onClick={actions.stopOpening}
                  >
                    <Square />
                    {t(
                      opening.phase === "stopping"
                        ? "A parar…"
                        : "Parar abertura"
                    )}
                  </Button>
                ) : (
                  <>
                    <Button disabled={disabled} onClick={() => start(false)}>
                      <PackageOpen />
                      {t(model.busy ? "A preparar…" : "Iniciar abertura")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={disabled || selectedIds.length !== 1}
                      onClick={() => start(true)}
                    >
                      {t(isCapsule ? "Abrir 1 cápsula" : "Abrir 1 caixa")}
                    </Button>
                  </>
                )}
                {!canOpen && (
                  <p>
                    {t(
                      !["cases", "capsules"].includes(selectedCase.category)
                        ? "Consulta o conteúdo deste tipo no catálogo. A abertura está disponível para caixas e cápsulas."
                        : "Seleciona contas com stock desta caixa."
                    )}
                  </p>
                )}
                {selectedIds.length !== 1 && !running && (
                  <p>{t(isCapsule ? "Seleciona uma conta para abrir apenas uma cápsula." : "Seleciona uma conta para abrir apenas uma caixa.")}</p>
                )}
                {itemRules.length > 0 &&
                  detail?.id === form.caseId &&
                  !ruleValidation.valid && (
                    <div className="opening-validation" role="alert">
                      <p>
                        {t("Corrige as regras inválidas antes de iniciar.")}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => update({ tab: "rules" })}
                      >
                        {t("Rever regras")}
                      </Button>
                    </div>
                  )}
                <span className="opening-pace">
                  <Clock3 size={13} />
                  {t("Ritmo automático")}
                  {running && ` · ${opening.intervalMs || 500} ms`}
                </span>
              </div>
            </>
          ) : (
            <div className="opening-inspector-empty">
              <PackageOpen size={30} />
              <h2>{t("Escolhe uma caixa")}</h2>
              <p>{t("Consulta o conteúdo e prepara a abertura aqui.")}</p>
            </div>
          )}
        </aside>
      </div>
      <Tabs
        className="opening-detail-tabs"
        value={view.tab}
        onValueChange={(tab) => update({ tab })}
      >
        <TabsList variant="line" aria-label={t("Detalhes da abertura")}>
          <TabsTrigger value="content">
            {t("Conteúdo")}
            {detail?.items?.length > 0 && <span>{detail.items.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="rules">
            {t("Regras")}
            {itemRules.length > 0 && (
              <Badge variant="secondary">{ruleGroupCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="results">
            {t("Resultados")}
            <span>
              {formatNumber(opening.confirmed ?? opening.opened ?? 0)}
            </span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="content">
          <div className="opening-content-heading">
            <div>
              <h2>{selectedCase?.name || t("Dentro da caixa")}</h2>
              <p>
                {t(
                  "Conteúdo do catálogo. Cada abertura é decidida pelo servidor."
                )}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!detail?.items?.length}
              onClick={() => update({ tab: "rules" })}
            >
              {t("Configurar regras")}
            </Button>
          </div>
          {detailLoading ? (
            <p className="opening-detail-message" role="status">
              {t("A carregar conteúdo desta caixa…")}
            </p>
          ) : detailError ? (
            <div className="opening-feedback">
              <p>{t("Não foi possível carregar o conteúdo desta caixa.")}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetry((value) => value + 1)}
              >
                <RefreshCw />
                {t("Tentar de novo")}
              </Button>
            </div>
          ) : contents.total ? (
            <>
              <div className="opening-content-grid">
                {contents.items.map((item) => (
                  <div key={item.name} className="opening-content-item">
                    <Artwork src={item.image} />
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {item.rarity}
                        {item.specialCount
                          ? ` · ${item.specialCount} ${t("variantes")}`
                          : ""}
                      </small>
                    </div>
                    <span
                      className="opening-rarity-marker"
                      style={{
                        background:
                          item.rarityColor || "var(--muted-foreground)",
                      }}
                      aria-hidden="true"
                    />
                  </div>
                ))}
              </div>
              {contents.pages > 1 && (
                <Pager
                  page={contents}
                  onChange={setContentPage}
                  label="Paginação do conteúdo"
                />
              )}
            </>
          ) : (
            <p className="opening-detail-message">
              {t(
                selectedCase
                  ? "O catálogo ainda não apresenta os itens desta caixa."
                  : "Seleciona uma caixa para consultar o conteúdo."
              )}
            </p>
          )}
        </TabsContent>
        <TabsContent value="rules">
          <div className="opening-content-heading">
            <div>
              <h2>{t("Destino dos itens")}</h2>
              <p>
                {t("Define o que guardar, vender ou enviar para um storage.")}
              </p>
            </div>
            <Badge variant="secondary">
              {ruleGroupCount} {t("regras ativas")}
            </Badge>
          </div>
          {detailLoading ? (
            <p className="opening-detail-message">
              {t("A carregar conteúdo desta caixa…")}
            </p>
          ) : detail?.id === form.caseId && detail?.items?.length ? (
            <OpeningItemRules
              loadSkinMetadata={loadSkinMetadata}
              key={form.caseId}
              caseName={detail.name || selectedCase?.name}
              siteEvent={discovery?.event}
              items={detail.items}
              rules={itemRules}
              onChange={updateRule}
              onRulesChange={persistRules}
              accounts={accounts}
              bridge={bridge}
              disabled={locked}
              Artwork={Artwork}
            />
          ) : (
            <p className="opening-detail-message">
              {t("Carrega o conteúdo da caixa para configurar as regras.")}
            </p>
          )}
        </TabsContent>
        <TabsContent value="results">
          <Results
            opening={opening}
            events={model.events || []}
            accounts={accounts}
            cooldown={model.openingCooldown}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
