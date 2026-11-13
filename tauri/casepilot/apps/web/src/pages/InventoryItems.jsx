import { t } from "../language.js"
import React, { useEffect, useRef, useState } from "react"
import { Package, Star, X, Ellipsis, Archive, ScanLine } from "lucide-react"
import { formatMoney, formatNumber } from "../format.js"
import { Button } from "../components/ui/button.jsx"

export function ItemPhoto({ item, large = false }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [item.image])
  return (
    <div className={"item-photo" + (large ? " large" : "")}>
      {item.image && !failed ? (
        <img
          src={item.image}
          alt={t("Foto de " + item.name)}
          width={400}
          height={300}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>
          <Package size={32} />
          <small>{t("Imagem indisponível")}</small>
        </span>
      )}
    </div>
  )
}
export function ItemAccessories({ item, large = false }) {
  const accessories = [
    ...(item.stickers || []),
    ...(item.charm ? [item.charm] : []),
  ]
  if (!accessories.length) return null
  return (
    <div
      className={"item-accessories" + (large ? " large" : "")}
      aria-label={t("Autocolantes e charm")}
    >
      {accessories.map((a, index) => (
        <figure key={index} title={t(a.name)}>
          <ItemPhoto item={a} />
          <figcaption>{t(a.name || "Acessório")}</figcaption>
        </figure>
      ))}
    </div>
  )
}
function ItemAttributes({ item }) {
  return (
    <div className="inventory-item-attributes">
      {item.statTrak && <span>StatTrak™</span>}
      {item.souvenir && <span>Souvenir</span>}
      {item.patternName && <span>{item.patternName}</span>}
      {item.eventName && <span>{item.eventName}</span>}
    </div>
  )
}
export function InventoryCard({
  item,
  onOpen,
  onActions,
  onSelect,
  selected = false,
  selectionDisabled = false,
}) {
  const actions = (event) => onActions?.(item, event)
  const name = item.baseName || item.name || t("Item sem nome")
  const [weapon, ...finish] = name.split(" | ")
  const float =
    typeof item.float === "number" && Number.isFinite(item.float)
      ? item.float
      : null
  return (
    <article
      className={"inventory-card" + (selected ? " is-selected" : "")}
      onContextMenu={actions}
      onKeyDown={(event) => {
        if (
          event.key === "ContextMenu" ||
          (event.key === "F10" && event.shiftKey)
        )
          actions(event)
      }}
      style={{ "--item-rarity": item.rarityColor || "var(--border)" }}
    >
      <div className="inventory-card-top">
        {onSelect && (
          <label
            className={"inventory-select" + (selected ? " is-selected" : "")}
          >
            <input
              type="checkbox"
              aria-label={t("Selecionar skin " + item.name)}
              checked={selected}
              disabled={selectionDisabled}
              onChange={() => onSelect(item)}
            />
            <span>{t(selected ? "Selecionada" : "Selecionar")}</span>
          </label>
        )}
        {item.isFavorite && (
          <Star
            className="inventory-favorite-mark"
            size={14}
            fill="currentColor"
            aria-label={t("Favorito")}
          />
        )}
      </div>
      <button
        className="inventory-open"
        type="button"
        aria-label={t("Ver detalhes de " + item.name)}
        onClick={() => onOpen(item.id)}
      >
        <ItemPhoto item={item} />
        <div className="item-copy">
          <span className="item-rarity">
            <i aria-hidden="true" />
            {t(item.rarity || "Raridade não indicada")}
          </span>
          <strong className="inventory-item-name">
            <span>{weapon}</span>
            {finish.length > 0 && <span>{finish.join(" | ")}</span>}
          </strong>
          <ItemAttributes item={item} />
          <div className="inventory-item-wear">
            <small>{t(item.exterior || "Estado não indicado")}</small>
            {item.patternId !== undefined &&
              item.patternId !== null &&
              item.patternId !== "" && <small>#{item.patternId}</small>}
          </div>
          <div className="inventory-float">
            <span>
              <ScanLine size={12} aria-hidden="true" />
              Float
            </span>
            <code>{float !== null ? float.toFixed(6) : "—"}</code>
          </div>
          <span className="item-price">{formatMoney(item.price)}</span>
        </div>
      </button>
      <ItemAccessories item={item} />
      <Button
        className="inventory-actions-trigger"
        type="button"
        variant="ghost"
        aria-label={t("Ações de " + item.name)}
        aria-haspopup="menu"
        onClick={actions}
      >
        <Ellipsis size={18} />
        {t("Ações")}
      </Button>
    </article>
  )
}
export function InventoryDetails({ item, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement,
      overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    ref.current?.querySelector("button")?.focus()
    const key = (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      }
      if (event.key === "Tab") {
        event.preventDefault()
        ref.current?.querySelector("button")?.focus()
      }
    }
    document.addEventListener("keydown", key)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener("keydown", key)
      if (previous?.isConnected) previous.focus()
    }
  }, [item.id])
  const values = [
    ["Preço virtual", formatMoney(item.price)],
    ["Raridade", item.rarity],
    ["Estado", item.exterior],
    ["Float", typeof item.float === "number" ? item.float.toFixed(8) : "—"],
    ["Variante", item.patternName],
    ["Padrão", item.patternId],
    ["Evento", item.eventName],
    [
      "Qualidade",
      typeof item.quality === "number" ? formatNumber(item.quality) : "—",
    ],
    ["Origem", item.origin],
    ["Nome personalizado", item.nickname],
    [
      "Atributos",
      [
        item.isFavorite ? t("Favorito") : "",
        item.statTrak ? "StatTrak" : "",
        item.souvenir ? "Souvenir" : "",
      ]
        .filter(Boolean)
        .join(" · ") || t("Sem atributos indicados"),
    ],
  ]
  return (
    <div
      className="detail-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="account-details inventory-details"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-detail-title"
      >
        <header>
          <div>
            <span className="kicker">{t("DETALHES DO ITEM")}</span>
            <h2 id="inventory-detail-title">
              {t(item.name || "Item sem nome")}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Fechar detalhes do item")}
            onClick={onClose}
          >
            <X size={20} />
          </Button>
        </header>
        <ItemPhoto item={item} large />
        <ItemAttributes item={item} />
        <ItemAccessories item={item} large />
        <dl className="item-detail-values">
          {values.map(([label, value]) => (
            <div key={label}>
              <dt>{t(label)}</dt>
              <dd>
                {t(
                  value !== undefined && value !== null && value !== ""
                    ? value
                    : "—"
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
export function InventoryViews({ view, onChange }) {
  return (
    <div
      className="inventory-views"
      role="group"
      aria-label={t("Vista do inventário")}
    >
      <Button
        variant="ghost"
        aria-label={t("Ver inventário principal")}
        aria-pressed={view !== "storages"}
        onClick={() => onChange("inventory")}
      >
        <Package size={16} aria-hidden="true" />
        {t("Inventário principal")}
      </Button>
      <Button
        variant="ghost"
        aria-label={t("Ver storages")}
        aria-pressed={view === "storages"}
        onClick={() => onChange("storages")}
      >
        <Archive size={16} aria-hidden="true" />
        {t("Storages")}
      </Button>
    </div>
  )
}
