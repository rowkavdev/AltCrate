import React, { useMemo, useState } from "react"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Search,
  Info,
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
import { Switch } from "@workspace/ui/components/switch"
import {
  prepareSkinOptions,
  normalizeSelectedSkinNames,
  skinSelectionPage,
} from "../openingSkinSelection.js"
import { t } from "../language.js"
import SkinMetadataDialog from "./SkinMetadataDialog.jsx"
const phrase = (key, n) => t(key.replace("{0}", String(n)))
export default function OpeningSkinPicker({
  caseName,
  options,
  selectedNames,
  onApply,
  onClose,
  disabled,
  maxSelection = 500,
  Artwork,
  loadSkinMetadata,
}) {
  const [selected, setSelected] = useState(
      () => new Set(normalizeSelectedSkinNames(selectedNames, options))
    ),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [onlySelected, setOnlySelected] = useState(false),
    [page, setPage] = useState(1),
    [inspected, setInspected] = useState(null)
  const prepared = useMemo(() => prepareSkinOptions(options), [options])
  const result = useMemo(
    () =>
      skinSelectionPage(prepared, {
        query,
        category,
        selectedOnly: onlySelected,
        selectedNames: [...selected],
        page,
      }),
    [prepared, query, category, onlySelected, selected, page]
  )
  const union = new Set([...selected, ...result.matchingNames]),
    allMatching =
      result.matchingNames.length > 0 &&
      result.matchingNames.every((name) => selected.has(name))
  function toggle(name) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else if (next.size < maxSelection) {
        if (name.includes("::")) next.delete(name.split("::")[0])
        else
          for (const key of next)
            if (key.startsWith(name + "::")) next.delete(key)
        next.add(name)
      }
      return next
    })
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="opening-skin-picker"
        container={document.querySelector(".cp-shell")}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t("Escolher skins")}</DialogTitle>
          <DialogDescription>
            {caseName
              ? t("Apenas skins que podem sair de {0}.").replace(
                  "{0}",
                  caseName
                )
              : t(
                  "Seleciona uma ou várias skins desta caixa para partilhar as mesmas condições e destino."
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogClose asChild>
          <Button
            className="opening-editor-close"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Fechar seleção de skins")}
          >
            <X />
          </Button>
        </DialogClose>
        <div className="skin-picker-controls">
          <label className="skin-picker-search">
            <Search size={16} />
            <Input
              type="search"
              autoFocus
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-label={t("Procurar skins")}
              placeholder={t("Procurar por arma ou acabamento…")}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
            />
          </label>
          <div className="skin-picker-filters">
            <div role="group" aria-label={t("Tipo de skin")}>
              {[
                ["all", "Todas"],
                ["weapons", "Armas"],
                ["knives", "Facas"],
                ["gloves", "Luvas"],
              ].map(([key, label]) => (
                <Button
                  type="button"
                  variant={category === key ? "secondary" : "ghost"}
                  size="sm"
                  key={key}
                  aria-pressed={category === key}
                  disabled={disabled}
                  onClick={() => {
                    setCategory(key)
                    setPage(1)
                  }}
                >
                  {t(label)}
                </Button>
              ))}
            </div>
            <label>
              <Switch
                aria-label={t("Só selecionadas")}
                checked={onlySelected}
                onCheckedChange={(value) => {
                  setOnlySelected(value)
                  setPage(1)
                }}
                disabled={disabled}
              />
              {t("Só selecionadas")}
            </label>
          </div>
          <div className="skin-picker-count">
            <span>
              {phrase("{0} resultados", result.total)} ·{" "}
              {phrase("{0} selecionadas", selected.size)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={
                disabled ||
                !result.total ||
                (!allMatching && union.size > maxSelection)
              }
              onClick={() =>
                setSelected((current) => {
                  const next = new Set(current)
                  for (const name of result.matchingNames)
                    allMatching ? next.delete(name) : next.add(name)
                  return next
                })
              }
            >
              {t(
                allMatching ? "Desmarcar resultados" : "Selecionar resultados"
              )}
            </Button>
          </div>
        </div>
        <div
          className="skin-picker-grid"
          role="group"
          aria-label={t("Skins da caixa")}
        >
          {result.items.map((item) => (
            <div className="skin-picker-entry" key={item.key}>
              <Button
                type="button"
                role="checkbox"
                aria-checked={selected.has(item.key)}
                aria-label={item.label}
                className="skin-picker-tile"
                variant="outline"
                key={item.key}
                disabled={
                  disabled ||
                  (!selected.has(item.key) && selected.size >= maxSelection)
                }
                onClick={() => toggle(item.key)}
              >
                <span className="skin-picker-check">
                  {selected.has(item.key) && <Check size={13} />}
                </span>
                {item.image && Artwork ? (
                  <Artwork src={item.image} name={item.label} />
                ) : (
                  <span className="skin-picker-no-art">
                    <Swords size={30} />
                    <small>{t("Sem imagem")}</small>
                  </span>
                )}
                <strong>{item.label}</strong>
                {(Number.isFinite(item.minFloat) ||
                  Number.isFinite(item.maxFloat)) && (
                  <small className="skin-picker-float">
                    Float {item.minFloat ?? "—"}–{item.maxFloat ?? "—"}
                  </small>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="skin-picker-info"
                aria-label={t("Dados da skin") + " · " + item.label}
                onClick={() => setInspected(item)}
              >
                <Info size={13} />
                {t("Dados da skin")}
              </Button>
            </div>
          ))}
          {!result.items.length && (
            <p className="skin-picker-empty">
              {t("Nenhuma skin encontrada. Experimenta outro nome ou filtro.")}
            </p>
          )}
        </div>
        {inspected && (
          <SkinMetadataDialog
            skin={inspected}
            loadMetadata={loadSkinMetadata}
            onClose={() => setInspected(null)}
            Artwork={Artwork}
          />
        )}
        <footer className="skin-picker-footer">
          <div className="skin-picker-pagination">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t("Página anterior de skins")}
              disabled={result.page === 1}
              onClick={() => setPage(result.page - 1)}
            >
              <ChevronLeft />
            </Button>
            <span>
              {result.page} / {result.pages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t("Página seguinte de skins")}
              disabled={result.page === result.pages}
              onClick={() => setPage(result.page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="skin-picker-footer-actions">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("Cancelar")}
            </Button>
            <Button
              type="button"
              disabled={disabled || selected.size === 0}
              onClick={() => onApply([...selected])}
            >
              <Check />
              {selected.size === 1
                ? t("Usar 1 skin")
                : phrase("Usar {0} skins", selected.size)}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
