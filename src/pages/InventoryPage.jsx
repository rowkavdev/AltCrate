import { DisclosurePanel } from "../components/WorkspaceSection.jsx";
import { t } from "../language.js";
import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Package,
  RefreshCw,
  Search,
} from "lucide-react";
import { formatMoney, formatNumber, formatTime } from "../format.js";
import "./inventory.css";
import {
  InventoryCard,
  InventoryDetails,
  InventoryViews,
} from "./InventoryItems.jsx";
import InventoryFilters from "./InventoryFilters.jsx";
import StorageInventory from "./StorageInventory.jsx";
import InventoryBatchPanel from "./InventoryBatchPanel.jsx";
import ItemRankingPanel from "./ItemRankingPanel.jsx";
import InventoryActions, { InventoryOperations } from "./InventoryActions.jsx";
import { useInventoryActions } from "../useInventoryActions.js";
export { InventoryCard } from "./InventoryItems.jsx";

export default function InventoryPage({ model, ui, onUiChange, onNavigate }) {
  const { accounts, bridge } = model;
  const [batchSelection, setBatchSelection] = useState([]);
  const toggleBatch = (item) =>
    setBatchSelection((old) => {
      const key = accountId + ":" + item.id;
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
            ];
    });
  const storageView = ui.view === "storages";
  const accountId = accounts.some((account) => account.id === ui.accountId)
    ? ui.accountId
    : accounts[0]?.id || "";
  const actionRevision = model.inventoryRevision?.[accountId] || 0;
  const controller = useInventoryActions({
    model,
    refKey: accountId + ":" + (storageView ? "storages" : "inventory"),
    onChanged: () => setRevision((value) => value + 1),
  });
  const page = ui.page || 1,
    sort = ui.sort || "true",
    favorites = ui.favorites || "all",
    search = ui.search || "";
  const filters = {
    search,
    sort,
    favorites,
    ...Object.fromEntries(
      ["rarity", "exterior", "eventName", "quality", "statTrakSouvenir"]
        .filter((name) => ui[name] !== undefined && ui[name] !== "")
        .map((name) => [name, ui[name]]),
    ),
  };
  const key = JSON.stringify([
    accountId,
    page,
    sort,
    favorites,
    search,
    filters,
  ]);
  const summary = ui.summaryAccountId === accountId ? ui.summary : null;
  const data = ui.dataKey === key ? ui.data : null;
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [summaryPending, setSummaryPending] = useState(false),
    [summaryError, setSummaryError] = useState("");
  useEffect(() => {
    if (!accountId || !bridge?.readInventorySummary) {
      setSummaryPending(false);
      return;
    }
    if (
      revision === 0 &&
      summary &&
      (ui.summaryActionRevision || 0) === actionRevision &&
      Date.now() - summary.readAt < 30000
    )
      return;
    let live = true;
    setSummaryPending(true);
    setSummaryError("");
    bridge
      .readInventorySummary(accountId)
      .then((result) => {
        if (live)
          onUiChange({
            summary: result,
            summaryAccountId: accountId,
            summaryActionRevision: actionRevision,
          });
      })
      .catch((failure) => {
        if (live) setSummaryError(String(failure.message || failure));
      })
      .finally(() => {
        if (live) setSummaryPending(false);
      });
    return () => {
      live = false;
    };
  }, [accountId, bridge, revision, actionRevision]);
  useEffect(() => {
    if (accountId !== ui.accountId)
      onUiChange({ accountId, page: 1, detailId: null, dataKey: "" });
  }, [accountId]);
  useEffect(() => {
    if (storageView || !accountId || !bridge?.readInventory) {
      setPending(false);
      return;
    }
    if (
      revision === 0 &&
      (ui.actionRevision || 0) === actionRevision &&
      ui.dataKey === key &&
      Date.now() - ui.readAt < 30000
    ) {
      setPending(false);
      setError("");
      return;
    }
    let live = true;
    setPending(true);
    setError("");
    bridge
      .readInventory(accountId, page, filters)
      .then((result) => {
        if (!live) return;
        if (page > result.pages) {
          onUiChange({ page: result.pages, detailId: null, dataKey: "" });
          return;
        }
        onUiChange({
          data: result,
          dataKey: key,
          readAt: Date.now(),
          actionRevision,
        });
      })
      .catch((failure) => {
        if (live)
          setError(
            String(failure.message || failure).replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            ),
          );
      })
      .finally(() => {
        if (live) setPending(false);
      });
    return () => {
      live = false;
    };
  }, [bridge, key, revision, storageView, actionRevision]);
  function change(patch) {
    setError("");
    onUiChange({ ...patch, page: 1, detailId: null, dataKey: "" });
  }
  const selectedKeys = useMemo(
    () => new Set(batchSelection.map((entry) => entry.key)),
    [batchSelection],
  );
  const selected = data?.skins.find((item) => item.id === ui.detailId);
  if (!accounts.length)
    return (
      <section className="panel empty-state">
        <Package size={32} />
        <h2>{t("Adiciona uma conta para veres o inventário")}</h2>
        <p>
          {t(
            "Os itens e as fotografias aparecem depois de ligares uma sessão.",
          )}
        </p>
        <button
          className="primary-button"
          onClick={() => onNavigate("accounts")}
        >
          {t("Adicionar conta")}
        </button>
      </section>
    );
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
    );
  return (
    <div className="page-stack">
      <section className="panel inventory-browser-tools">
        <div className="section-heading">
          <div>
            <h2>{t("Itens da conta")}</h2>
            <small className="muted">
              {t(
                data && ui.readAt
                  ? "Última leitura às " + formatTime(ui.readAt)
                  : "Seleciona uma conta para consultar os seus itens.",
              )}
            </small>
          </div>
          <button
            className="secondary-button"
            aria-label={t("Atualizar inventário")}
            disabled={pending || !bridge?.readInventory}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={16} />
            {t("Atualizar")}
          </button>
        </div>
        <InventoryViews
          view="inventory"
          onChange={(view) => onUiChange({ view })}
        />
        <div className="inventory-controls">
          <label>
            {t("Conta")}
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
          <label>
            {t("Ordenação")}
            <select
              aria-label={t("Ordenação do inventário")}
              value={sort}
              onChange={(event) => change({ sort: event.target.value })}
            >
              <option value="true">{t("Recentes")}</option>
              <option value="price">{t("Preço")}</option>
              <option value="float">{t("Float")}</option>
              <option value="rank">{t("Ranking de float")}</option>
            </select>
          </label>
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
        <div className="inventory-summary" aria-busy={summaryPending}>
          <p>
            {t("Valor virtual: ")}
            <strong>
              {t(
                summary?.value != null
                  ? formatMoney(summary.value)
                  : "Indisponível",
              )}
            </strong>
            {t(" · Cobertura de float: ")}
            <strong>
              {t(
                summary?.floatCoverage
                  ? formatNumber(summary.floatCoverage.rankedSkins) +
                      " de " +
                      formatNumber(summary.floatCoverage.totalSkins) +
                      " (" +
                      formatNumber(summary.floatCoverage.percent, 1) +
                      "%)"
                  : "Indisponível",
              )}
            </strong>
          </p>
          {summary?.readAt && (
            <small className="muted">
              {t("Leitura às ")}
              {t(formatTime(summary.readAt))}
            </small>
          )}
          {summaryPending && (
            <small role="status">{t("A atualizar resumo…")}</small>
          )}
          {(summaryError || summary?.errors?.length > 0) && (
            <p className="inline-error">
              {t(summaryError || summary.errors.join(" · "))}
            </p>
          )}
        </div>
        <form
          className="inventory-search"
          onSubmit={(event) => {
            event.preventDefault();
            change({ search: (ui.query || "").trim() });
          }}
        >
          <input
            aria-label={t("Pesquisar itens")}
            placeholder={t("Pesquisar por nome do item")}
            value={ui.query || ""}
            onChange={(event) => onUiChange({ query: event.target.value })}
          />
          <button
            className="primary-button"
            disabled={pending || !bridge?.readInventory}
          >
            <Search size={16} />
            {t("Pesquisar")}
          </button>
        </form>
        <details
          className="filter-disclosure"
          open={Boolean(
            ui.rarity ||
            ui.exterior ||
            ui.eventName ||
            ui.quality ||
            ui.statTrakSouvenir,
          )}
        >
          <summary>{t("Mais filtros")}</summary>
          <InventoryFilters
            values={ui}
            onChange={change}
            events={summary?.events || []}
            batchSelection={batchSelection}
            setBatchSelection={setBatchSelection}
          />
        </details>
      </section>

      <section className="panel inventory-results" aria-busy={pending}>
        <div className="section-heading">
          <h2>
            {t(
              data
                ? formatNumber(data.skins.length) + " itens nesta página"
                : "Inventário",
            )}
          </h2>
          {data && (
            <span>
              {t(
                !search && favorites !== "only" && data.count > 0
                  ? formatNumber(data.count) + " no inventário · "
                  : "",
              )}
              {t("Página ")}
              {t(page)}
              {t(" de ")}
              {t(formatNumber(data.pages))}
            </span>
          )}
        </div>
        {!bridge?.readInventory && (
          <p className="inline-error">
            {t(
              "A leitura do inventário não está disponível nesta versão da app.",
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
          <div className="inventory-grid">
            {data.skins.map((item) => (
              <InventoryCard
                key={item.id}
                item={item}
                onSelect={
                  bridge?.prepareInventoryBatch ? toggleBatch : undefined
                }
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
                    () => onUiChange({ detailId: item.id }),
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
                search || favorites === "only"
                  ? "Sem itens para estes filtros"
                  : "Este inventário está vazio",
              )}
            </h2>
            <p>
              {t(
                search || favorites === "only"
                  ? "Experimenta outro nome ou escolhe Todos os itens."
                  : "Atualiza depois de receberes novos itens.",
              )}
            </p>
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
  );
}
