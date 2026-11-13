import { t } from "../language.js"
import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Search,
  Swords,
  X,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import OrderedOpeningRules from "./OrderedOpeningRules.jsx"
import { canonicalSkinName } from "../openingRulesViewModel.js"
import { loadStorageDestinations } from "../storageDestinationPicker.js"

export default function OpeningItemRules({
  caseName,
  siteEvent,
  items,
  rules,
  onChange,
  onRulesChange,
  accounts = [],
  bridge,
  disabled,
  Artwork,
  loadSkinMetadata,
}) {
  const [query, setQuery] = useState(""),
    [quickPage, setQuickPage] = useState(1),
    [picker, setPicker] = useState(null),
    [storageSearch, setStorageSearch] = useState(""),
    [storagePage, setStoragePage] = useState(1),
    [destinations, setDestinations] = useState(null),
    [error, setError] = useState("")
  const abort = useRef(null)
  useEffect(() => () => abort.current?.abort(), [])
  const skins = useMemo(
    () => [
      ...new Map(
        items
          .flatMap((item) =>
            item.specialItems?.length
              ? item.specialItems.map((skin) => ({ ...skin, special: true }))
              : item.specialCount
                ? []
                : [item]
          )
          .filter((item) => item?.name)
          .map((item) => [canonicalSkinName(item.name), item])
      ).values(),
    ],
    [items]
  )
  const unknownSpecials = items.reduce(
    (total, item) =>
      total + (!item.specialItems?.length ? item.specialCount || 0 : 0),
    0
  )
  const orderedRules = useMemo(
    () =>
      Array.isArray(rules)
        ? rules
        : Object.entries(rules || {}).map(([name, rule]) => ({
            name,
            ...rule,
          })),
    [rules]
  )
  const generalRules = useMemo(() => {
    const result = new Map()
    for (const rule of orderedRules) {
      const name = canonicalSkinName(rule?.name)
      if (!rule?.conditions || !Object.keys(rule.conditions).length)
        if (!result.has(name)) result.set(name, rule)
    }
    return result
  }, [orderedRules])
  function changeGeneral(name, rule) {
    if (disabled) return
    if (!onRulesChange) return onChange?.(name, rule)
    const index = orderedRules.findIndex(
      (value) =>
        canonicalSkinName(value?.name) === canonicalSkinName(name) &&
        (!value?.conditions || !Object.keys(value.conditions).length)
    )
    const next = orderedRules.filter((_, i) => i !== index)
    if (rule) {
      if (index < 0) next.push({ name, ...rule })
      else next.splice(index, 0, { ...orderedRules[index], name, ...rule })
    }
    onRulesChange(next)
  }
  const counts = skins.reduce(
    (total, item) => {
      const action =
        generalRules.get(canonicalSkinName(item.name))?.action || "keep"
      total[action] = (total[action] || 0) + 1
      return total
    },
    { keep: 0, sell: 0, storage: 0 }
  )
  const needle = query.trim().toLocaleLowerCase("pt-PT"),
    filtered = skins.filter((item) =>
      item.name.toLocaleLowerCase("pt-PT").includes(needle)
    )
  const quickPages = Math.max(1, Math.ceil(filtered.length / 12)),
    currentQuickPage = Math.min(quickPage, quickPages)
  async function chooseStorage(item, refresh = false) {
    if (disabled) return
    setPicker(item)
    setStorageSearch("")
    setStoragePage(1)
    setError("")
    if (
      !refresh &&
      destinations &&
      (destinations.loading || destinations.entries.length)
    )
      return
    if (!bridge?.listStorageUnits) {
      setError("A escolha de storages não está disponível nesta versão da app.")
      return
    }
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setDestinations({
      entries: [],
      loaded: 0,
      total: accounts.length,
      loading: true,
      errors: [],
    })
    try {
      const value = await loadStorageDestinations(
        accounts,
        (id) => bridge.listStorageUnits(id),
        {
          signal: controller.signal,
          cooldown: bridge.storageCooldown
            ? () => bridge.storageCooldown()
            : undefined,
          onUpdate: (value) => {
            if (!controller.signal.aborted) setDestinations(value)
          },
        }
      )
      if (!controller.signal.aborted) setDestinations(value)
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(String(failure.message || failure))
        setDestinations((current) => ({ ...current, loading: false }))
      }
    }
  }
  const available = (destinations?.entries || []).filter((entry) =>
    (entry.accountLabel + " " + entry.storageName)
      .toLocaleLowerCase("pt-PT")
      .includes(storageSearch.toLocaleLowerCase("pt-PT"))
  )
  const storagePages = Math.max(1, Math.ceil(available.length / 12)),
    currentStoragePage = Math.min(storagePage, storagePages)
  return (
    <div className="opening-rules">
      {onRulesChange && (
        <OrderedOpeningRules
          loadSkinMetadata={loadSkinMetadata}
          siteEvent={siteEvent}
          caseName={caseName}
          rules={orderedRules}
          skins={skins}
          Artwork={Artwork}
          onChange={onRulesChange}
          onChooseStorage={chooseStorage}
          accounts={accounts}
          disabled={disabled}
        />
      )}
      <details className="opening-quick-destinations">
        <summary>
          <span>{t("Destinos rápidos por skin")}</span>
          <small>
            {counts.sell} {t("para vender")} · {counts.storage}{" "}
            {t("para storage")}
          </small>
        </summary>
        <p>
          {t(
            "Define o destino geral de uma skin. As variantes específicas mantêm a sua prioridade na lista de regras."
          )}
        </p>
        <label className="opening-quick-search">
          <Search size={16} />
          <Input
            type="search"
            aria-label={t("Pesquisar skins da caixa")}
            placeholder={t("Pesquisar skin…")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setQuickPage(1)
            }}
          />
        </label>
        <div className="opening-quick-list">
          {filtered
            .slice((currentQuickPage - 1) * 12, currentQuickPage * 12)
            .map((item) => {
              const current = generalRules.get(
                canonicalSkinName(item.name)
              ) || { action: "keep" }
              return (
                <article className="opening-quick-row" key={item.name}>
                  {item.special && !item.image ? (
                    <span className="opening-quick-art">
                      <Swords size={25} />
                    </span>
                  ) : (
                    <Artwork src={item.image} name={item.name} />
                  )}
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {current.action === "storage"
                        ? [
                            current.storageName || t("Storage"),
                            current.accountLabel,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : t(
                            item.special
                              ? "Faca ou item especial"
                              : item.rarity || "Skin"
                          )}
                    </small>
                  </div>
                  <div
                    className="opening-quick-actions"
                    role="group"
                    aria-label={t("Destino de ") + item.name}
                  >
                    <Button
                      variant={
                        current.action === "keep" ? "secondary" : "ghost"
                      }
                      size="sm"
                      aria-pressed={current.action === "keep"}
                      disabled={disabled}
                      onClick={() => changeGeneral(item.name, null)}
                    >
                      {t("Inventário")}
                    </Button>
                    <Button
                      variant={
                        current.action === "sell" ? "secondary" : "ghost"
                      }
                      size="sm"
                      aria-pressed={current.action === "sell"}
                      disabled={
                        disabled ||
                        (orderedRules.length >= 500 &&
                          !generalRules.has(canonicalSkinName(item.name)))
                      }
                      onClick={() =>
                        changeGeneral(item.name, { action: "sell" })
                      }
                    >
                      {t("Vender")}
                    </Button>
                    <Button
                      variant={
                        current.action === "storage" ? "secondary" : "ghost"
                      }
                      size="sm"
                      aria-pressed={current.action === "storage"}
                      disabled={
                        disabled ||
                        (orderedRules.length >= 500 &&
                          !generalRules.has(canonicalSkinName(item.name)))
                      }
                      onClick={() => chooseStorage(item)}
                    >
                      {t("Storage")}
                    </Button>
                  </div>
                </article>
              )
            })}
          {!filtered.length && <p>{t("Nenhuma skin encontrada.")}</p>}
        </div>
        <nav
          className="opening-rules-pagination"
          aria-label={t("Paginação dos destinos rápidos")}
        >
          <span>
            {filtered.length} {t("skins")} · {t("Página")} {currentQuickPage} /{" "}
            {quickPages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("Página anterior de skins")}
            disabled={currentQuickPage === 1}
            onClick={() => setQuickPage(currentQuickPage - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("Página seguinte de skins")}
            disabled={currentQuickPage === quickPages}
            onClick={() => setQuickPage(currentQuickPage + 1)}
          >
            <ChevronRight />
          </Button>
        </nav>
        {unknownSpecials > 0 && (
          <p>
            {t(
              "Itens especiais sem identificação no catálogo ficam no inventário."
            )}
          </p>
        )}
      </details>
      <Dialog
        open={!!picker}
        onOpenChange={(open) => {
          if (!open) setPicker(null)
        }}
      >
        {picker && (
          <DialogContent
            className="opening-storage-dialog"
            container={document.querySelector(".cp-shell")}
            showCloseButton={false}
          >
            <DialogHeader>
              <DialogTitle>{t("Escolher storage")}</DialogTitle>
              <DialogDescription>
                {picker.name} ·{" "}
                {t("Escolhe qualquer storage das contas ligadas.")}
              </DialogDescription>
            </DialogHeader>
            <DialogClose asChild>
              <Button
                className="opening-editor-close"
                variant="ghost"
                size="icon-sm"
                aria-label={t("Fechar seleção de storage")}
              >
                <X />
              </Button>
            </DialogClose>
            <Input
              aria-label={t("Pesquisar storage para esta skin")}
              placeholder={t("Pesquisar conta ou storage…")}
              value={storageSearch}
              onChange={(event) => {
                setStorageSearch(event.target.value)
                setStoragePage(1)
              }}
            />
            <small role="status">
              {destinations?.loaded || 0} {t("de")} {accounts.length}{" "}
              {t("contas consultadas")}
              {destinations?.loading ? t(" · a carregar…") : ""}
            </small>
            <div className="opening-storage-options">
              {available
                .slice((currentStoragePage - 1) * 12, currentStoragePage * 12)
                .map((entry) => (
                  <Button
                    variant="outline"
                    key={entry.accountId + ":" + entry.storageId}
                    disabled={disabled}
                    onClick={() => {
                      const chosen = {
                        action: "storage",
                        destinationAccountId: entry.accountId,
                        storageUnitId: entry.storageId,
                        accountLabel: entry.accountLabel,
                        storageName: entry.storageName,
                      }
                      if (picker.onSelect) picker.onSelect(chosen)
                      else changeGeneral(picker.name, chosen)
                      setPicker(null)
                    }}
                  >
                    <Archive />
                    <span>
                      <strong>{entry.storageName}</strong>
                      <small>
                        {entry.accountLabel} · {entry.count} {t("itens")}
                      </small>
                    </span>
                  </Button>
                ))}
            </div>
            {!destinations?.loading && !available.length && (
              <p>{t("Nenhum storage encontrado.")}</p>
            )}
            {destinations?.errors?.length > 0 && (
              <p className="inline-error">
                {t(
                  "Não foi possível consultar {0} conta(s).".replace(
                    "{0}",
                    destinations.errors.length
                  )
                )}
              </p>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {t(error)}
              </p>
            )}
            <div className="opening-rules-pagination">
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || destinations?.loading}
                onClick={() => chooseStorage(picker, true)}
              >
                {t("Atualizar storages")}
              </Button>
              <span>
                {currentStoragePage} / {storagePages}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t("Página anterior de storages")}
                disabled={currentStoragePage === 1}
                onClick={() => setStoragePage(currentStoragePage - 1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t("Página seguinte de storages")}
                disabled={currentStoragePage === storagePages}
                onClick={() => setStoragePage(currentStoragePage + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
