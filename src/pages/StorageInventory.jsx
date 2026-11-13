import { DisclosurePanel } from "../components/WorkspaceSection.jsx";
import { t } from "../language.js";
import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Archive,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
} from "lucide-react";
import { formatMoney, formatNumber, formatTime } from "../format.js";
import {
  InventoryCard,
  InventoryDetails,
  InventoryViews,
} from "./InventoryItems.jsx";
import InventoryFilters from "./InventoryFilters.jsx";
import InventoryActions, { InventoryOperations } from "./InventoryActions.jsx";
import { useInventoryActions } from "../useInventoryActions.js";
import StorageManagement from "./StorageManagement.jsx";
import InventoryBatchPanel from "./InventoryBatchPanel.jsx";

const EMPTY = {
  units: null,
  unitsReadAt: 0,
  selectedId: "",
  page: 1,
  sort: "true",
  favorites: "all",
  query: "",
  search: "",
  data: null,
  dataKey: "",
  readAt: 0,
  detailId: null,
};
const message = (failure) =>
  String(failure.message || failure).replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
export default function StorageInventory({
  model,
  ui,
  accountId,
  onUiChange,
  events = [],
  batchSelection = [],
  setBatchSelection,
}) {
  const { accounts, bridge } = model;
  const actionRevision = model.inventoryRevision?.[accountId] || 0;
  const state = ui.storage?.accountId === accountId ? ui.storage : EMPTY;
  const { units, selectedId, page, sort, favorites, search } = state;
  const unit = units?.find((item) => item.id === selectedId);
  const filters = {
    search,
    sort,
    favorites,
    ...Object.fromEntries(
      ["rarity", "exterior", "eventName", "quality", "statTrakSouvenir"]
        .filter((name) => state[name] !== undefined && state[name] !== "")
        .map((name) => [name, state[name]]),
    ),
  };
  const key = JSON.stringify([
    accountId,
    selectedId,
    page,
    sort,
    favorites,
    search,
    filters,
  ]);
  const data = state.dataKey === key ? state.data : null;
  const [listPending, setListPending] = useState(false),
    [itemPending, setItemPending] = useState(false);
  const [listError, setListError] = useState(""),
    [itemError, setItemError] = useState(""),
    [revision, setRevision] = useState(0);
  const controller = useInventoryActions({
    model,
    refKey: accountId + ":" + selectedId,
    onChanged: () => setRevision((value) => value + 1),
  });
  const available =
    !!bridge?.listStorageUnits && !!bridge?.readStorageInventory;
  function update(patch) {
    onUiChange((previous) => {
      const current =
        previous.storage?.accountId === accountId
          ? previous.storage
          : { ...EMPTY, accountId };
      return {
        storage: {
          ...current,
          ...(typeof patch === "function" ? patch(current) : patch),
        },
      };
    });
  }
  useEffect(() => {
    if (!available || !accountId) return;
    if (
      revision === 0 &&
      (state.unitsActionRevision || 0) === actionRevision &&
      units &&
      Date.now() - state.unitsReadAt < 30000
    ) {
      setListPending(false);
      setListError("");
      return;
    }
    let live = true;
    setListPending(true);
    setListError("");
    bridge
      .listStorageUnits(accountId)
      .then((result) => {
        if (live)
          update((current) => ({
            units: result,
            unitsReadAt: Date.now(),
            unitsActionRevision: actionRevision,
            ...(!result.some((item) => item.id === current.selectedId)
              ? { selectedId: "", detailId: null, dataKey: "" }
              : {}),
          }));
      })
      .catch((failure) => {
        if (live) setListError(message(failure));
      })
      .finally(() => {
        if (live) setListPending(false);
      });
    return () => {
      live = false;
    };
  }, [accountId, bridge, revision, available, actionRevision]);
  useEffect(() => {
    if (!available || !unit) {
      setItemPending(false);
      return;
    }
    if (
      revision === 0 &&
      (state.actionRevision || 0) === actionRevision &&
      state.dataKey === key &&
      Date.now() - state.readAt < 30000
    )
      return;
    let live = true;
    setItemPending(true);
    setItemError("");
    bridge
      .readStorageInventory(accountId, selectedId, page, filters)
      .then((result) => {
        if (!live) return;
        if (page > result.pages) {
          update({ page: result.pages, detailId: null, dataKey: "" });
          return;
        }
        update({
          data: result,
          dataKey: key,
          readAt: Date.now(),
          actionRevision,
        });
      })
      .catch((failure) => {
        if (live) setItemError(message(failure));
      })
      .finally(() => {
        if (live) setItemPending(false);
      });
    return () => {
      live = false;
    };
  }, [accountId, bridge, key, !!unit, revision, available, actionRevision]);
  function change(patch) {
    update({ ...patch, page: 1, detailId: null, dataKey: "" });
  }
  const toggleBatch = (item) =>
    setBatchSelection?.((old) => {
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
                  storageUnitId: selectedId,
                  page,
                  name: item.name,
                },
              },
            ];
    });
  const selectedKeys = useMemo(
    () => new Set(batchSelection.map((entry) => entry.key)),
    [batchSelection],
  );
  const selected = data?.skins.find((item) => item.id === state.detailId);
  return (
    <div className="page-stack storage-browser">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{t("Storages da conta")}</h2>
            <small className="muted">
              {t(
                units && state.unitsReadAt
                  ? "Última leitura às " + formatTime(state.unitsReadAt)
                  : "Consulta os itens guardados em cada storage.",
              )}
            </small>
          </div>
          <button
            className="secondary-button"
            aria-label={t("Atualizar storages")}
            disabled={!available || listPending || itemPending}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={16} />
            {t("Atualizar")}
          </button>
        </div>
        <InventoryViews
          view="storages"
          onChange={(view) => onUiChange({ view })}
        />
        <div className="inventory-controls storage-account">
          <label>
            {t("Conta")}
            <select
              aria-label={t("Conta do inventário")}
              value={accountId}
              onChange={(event) =>
                onUiChange({ accountId: event.target.value })
              }
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!available && (
          <p className="inline-error">
            {t(
              "A consulta de storages não está disponível nesta versão da app.",
            )}
          </p>
        )}
        {listError && (
          <p className="inline-error" role="alert">
            {t(listError)}
            {t(" Usa Atualizar para tentar novamente.")}
          </p>
        )}
      </section>

      {!unit ? (
        <section className="panel" aria-busy={listPending}>
          <div className="section-heading">
            <h2>{t("Os teus storages")}</h2>
            {units && (
              <span>
                {t(formatNumber(units.length))}
                {t(" storages")}
              </span>
            )}
          </div>
          {listPending && !units ? (
            <div className="inventory-loading" role="status">
              {t("A carregar os storages…")}
            </div>
          ) : units?.length ? (
            <div className="storage-grid">
              {units.map((item) => (
                <button
                  className="storage-card"
                  aria-label={t("Ver storage " + item.name)}
                  key={item.id}
                  onClick={() => {
                    setItemError("");
                    update({
                      ...EMPTY,
                      units,
                      unitsReadAt: state.unitsReadAt,
                      selectedId: item.id,
                    });
                  }}
                >
                  <Archive size={32} />
                  <strong>{item.name}</strong>
                  <span>
                    {t(formatNumber(item.count))}
                    {t(" itens guardados")}
                  </span>
                  <small>{t("Ver conteúdo")}</small>
                </button>
              ))}
            </div>
          ) : units ? (
            <div className="empty-state">
              <Archive size={32} />
              <h2>{t("Esta conta ainda não tem storages")}</h2>
              <p>
                {t(
                  "Os storages criados no jogo aparecem aqui depois de atualizares.",
                )}
              </p>
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <section className="panel storage-content">
            <div className="section-heading">
              <div>
                <h2>{unit.name}</h2>
                <small className="muted">
                  {t(formatNumber(unit.count))}
                  {t(" itens guardados")}
                  {t(
                    data?.value != null
                      ? " · " + formatMoney(data.value) + " de valor virtual"
                      : "",
                  )}
                </small>
              </div>
              <button
                className="secondary-button"
                aria-label={t("Todos os storages")}
                onClick={() => update({ selectedId: "", detailId: null })}
              >
                <ArrowLeft size={16} />
                {t("Todos os storages")}
              </button>
            </div>
            <div className="inventory-controls storage-filters">
              <label>
                {t("Ordenação")}
                <select
                  aria-label={t("Ordenação do storage")}
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
                  aria-label={t("Favoritos do storage")}
                  value={favorites}
                  onChange={(event) =>
                    change({ favorites: event.target.value })
                  }
                >
                  <option value="all">{t("Todos os itens")}</option>
                  <option value="only">{t("Só favoritos")}</option>
                  <option value="none">{t("Sem favoritos")}</option>
                </select>
              </label>
            </div>
            <details className="filter-disclosure">
              <summary>{t("Mais filtros")}</summary>
              <InventoryFilters
                values={state}
                onChange={change}
                events={events}
                scope="storage"
              />
            </details>
            <form
              className="inventory-search storage-search"
              onSubmit={(event) => {
                event.preventDefault();
                change({ search: state.query.trim() });
              }}
            >
              <input
                aria-label={t("Pesquisar itens no storage")}
                placeholder={t("Pesquisar por nome do item")}
                value={state.query}
                onChange={(event) => update({ query: event.target.value })}
              />
              <button className="primary-button" disabled={itemPending}>
                <Search size={16} />
                {t("Pesquisar")}
              </button>
            </form>
            {itemError && (
              <p className="inline-error" role="alert">
                {t(itemError)}
                {t(" Usa Atualizar para tentar novamente.")}
              </p>
            )}
            <div className="storage-items" aria-busy={itemPending}>
              {itemPending && !data ? (
                <div className="inventory-loading" role="status">
                  {t("A carregar os itens guardados…")}
                </div>
              ) : data?.skins.length ? (
                <>
                  <div className="section-heading">
                    <h3>
                      {t(formatNumber(data.skins.length))}
                      {t(" itens nesta página")}
                    </h3>
                    {state.readAt && (
                      <small className="muted">
                        {t("Leitura às ")}
                        {t(formatTime(state.readAt))}
                      </small>
                    )}
                  </div>
                  <div className="inventory-grid">
                    {data.skins.map((item) => (
                      <InventoryCard
                        key={item.id}
                        item={item}
                        onSelect={
                          bridge?.prepareInventoryBatch
                            ? toggleBatch
                            : undefined
                        }
                        selected={selectedKeys.has(accountId + ":" + item.id)}
                        onOpen={(id) => update({ detailId: id })}
                        onActions={(item, event) =>
                          controller.openMenu(
                            {
                              accountId,
                              itemId: item.id,
                              storageUnitId: selectedId,
                              page,
                              name: item.name,
                            },
                            item,
                            event,
                            () => update({ detailId: item.id }),
                          )
                        }
                      />
                    ))}
                  </div>
                </>
              ) : data ? (
                <div className="empty-state">
                  <Archive size={32} />
                  <h2>
                    {t(
                      search || favorites === "only"
                        ? "Sem itens para estes filtros"
                        : "Este storage está vazio",
                    )}
                  </h2>
                  <p>
                    {t(
                      search || favorites === "only"
                        ? "Experimenta outro nome ou escolhe Todos os itens."
                        : "Os itens guardados neste storage aparecerão aqui.",
                    )}
                  </p>
                </div>
              ) : null}
            </div>
            {data && (
              <nav
                className="inventory-pagination"
                aria-label={t("Páginas do storage")}
              >
                <button
                  disabled={itemPending || page <= 1}
                  onClick={() => update({ page: page - 1, detailId: null })}
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
                  disabled={itemPending || page >= data.pages}
                  onClick={() => update({ page: page + 1, detailId: null })}
                >
                  {t("Seguinte")}
                  <ChevronRight size={16} />
                </button>
              </nav>
            )}
          </section>
        </>
      )}
      <DisclosurePanel
        title="Ações em lote"
        badge={batchSelection.length + " " + t("selecionados")}
        forceOpen={batchSelection.length > 0}
      >
        <InventoryBatchPanel
          model={model}
          accountId={accountId}
          items={unit ? data?.skins || [] : []}
          storageUnitId={selectedId || null}
          page={page}
          selection={batchSelection}
          onSelectionChange={setBatchSelection}
        />
      </DisclosurePanel>
      <DisclosurePanel
        title="Gerir storages"
        description="Criar, renomear e consultar operações dos cofres."
      >
        <StorageManagement
          bridge={bridge}
          accountId={accountId}
          units={units || []}
          selectedId={selectedId}
          onChanged={() => setRevision((value) => value + 1)}
        />
      </DisclosurePanel>
      <InventoryOperations
        model={model}
        controller={controller}
        accountId={accountId}
      />
      <InventoryActions controller={controller} accounts={accounts} />
      {selected && unit && (
        <InventoryDetails
          item={selected}
          onClose={() => update({ detailId: null })}
        />
      )}
    </div>
  );
}
