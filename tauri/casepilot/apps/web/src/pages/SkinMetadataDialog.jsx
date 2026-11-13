import React, { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { t } from "../language.js"
const value = (n) => (Number.isFinite(n) ? String(n) : "—")
const money = (n) =>
  Number.isFinite(n)
    ? "$" +
      n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "—"
const yes = (v) => (typeof v === "boolean" ? t(v ? "Sim" : "Não") : "—")

export default function SkinMetadataDialog({
  skin,
  loadMetadata,
  onClose,
  Artwork,
}) {
  const [state, setState] = useState({ loading: true, data: null, error: "" })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    setState({ loading: true, data: null, error: "" })
    Promise.resolve()
      .then(() => {
        if (!live) return null
        if (!loadMetadata)
          throw Error(t("Dados detalhados indisponíveis nesta ligação."))
        return loadMetadata(skin.name)
      })
      .then((data) => {
        if (live) setState({ loading: false, data, error: "" })
      })
      .catch((error) => {
        if (live) setState({ loading: false, data: null, error: error.message })
      })
    return () => {
      live = false
    }
  }, [loadMetadata, skin.name, retry])
  const data = state.data,
    rows = data?.exteriors || [],
    variants = data?.variants || []
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="skin-metadata-dialog"
        container={document.querySelector(".cp-shell")}
      >
        <DialogHeader>
          <DialogTitle>{t("Dados da skin")}</DialogTitle>
          <DialogDescription>{skin.label || skin.name}</DialogDescription>
        </DialogHeader>
        <div className="skin-metadata-body">
          <div className="skin-metadata-overview">
            {Artwork && (skin.image || data?.image) && (
              <Artwork
                src={skin.image || data.image}
                name={skin.label || skin.name}
              />
            )}
            <dl>
              <div>
                <dt>{t("Arma")}</dt>
                <dd>{data?.weapon || skin.weapon || "—"}</dd>
              </div>
              <div>
                <dt>{t("Raridade")}</dt>
                <dd>{data?.rarity || skin.rarity || "—"}</dd>
              </div>
              <div>
                <dt>{t("Coleção")}</dt>
                <dd>{data?.collection || "—"}</dd>
              </div>
              <div>
                <dt>Float</dt>
                <dd>
                  {value(data?.minFloat ?? skin.minFloat)} –{" "}
                  {value(data?.maxFloat ?? skin.maxFloat)}
                </dd>
              </div>
              <div>
                <dt>StatTrak</dt>
                <dd>{yes(data?.hasStatTrak)}</dd>
              </div>
              <div>
                <dt>Souvenir</dt>
                <dd>{yes(data?.hasSouvenir)}</dd>
              </div>
            </dl>
          </div>
          {state.loading && (
            <p role="status">{t("A carregar dados oficiais da skin…")}</p>
          )}
          {state.error && (
            <div role="alert">
              <p>{state.error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetry((n) => n + 1)}
              >
                {t("Tentar novamente")}
              </Button>
            </div>
          )}
          {data?.stale && (
            <p role="status">
              {t("Dados guardados. Não foi possível atualizar a ficha.")}
            </p>
          )}
          {rows.length > 0 && (
            <section>
              <h3>{t("Desgaste e preços do simulador")}</h3>
              <div className="skin-metadata-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Desgaste")}</th>
                      <th>Float</th>
                      <th>{t("Normal")}</th>
                      <th>StatTrak</th>
                      <th>Souvenir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <th scope="row">
                          {row.label || row.key}
                          {row.available === false && " · " + t("Indisponível")}
                        </th>
                        <td>
                          {value(row.min)}–{value(row.max)}
                        </td>
                        <td>{money(row.price)}</td>
                        <td>{money(row.statTrakPrice)}</td>
                        <td>{money(row.souvenirPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {variants.length > 0 && (
            <section>
              <h3>{t("Variantes publicadas")}</h3>
              <div className="skin-metadata-variants">
                {variants.map((variant) => (
                  <article key={variant.id || variant.name}>
                    {Artwork && variant.image && (
                      <Artwork src={variant.image} name={variant.name} />
                    )}
                    <div>
                      <strong>{variant.name}</strong>
                      <span>
                        {t("Probabilidade")}:{" "}
                        {variant.probability
                          ? "1 / " + variant.probability.toLocaleString("en-US")
                          : "—"}
                      </span>
                      <span>
                        {t("Acréscimo de valor")}:{" "}
                        {Number.isFinite(variant.overpay)
                          ? (variant.overpay >= 0 ? "+" : "−") +
                            money(Math.abs(variant.overpay))
                          : "—"}
                      </span>
                      {(variant.minFloat !== null ||
                        variant.maxFloat !== null) && (
                        <span>
                          Float: {value(variant.minFloat)}–
                          {value(variant.maxFloat)}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          {data?.containers?.length > 0 && (
            <section>
              <h3>{t("Onde pode sair")}</h3>
              <ul>
                {data.containers.map((box) => (
                  <li key={box.href}>{box.name}</li>
                ))}
              </ul>
            </section>
          )}
          {data && (
            <p className="skin-metadata-source">
              {t("Fonte")}: {data.sourceUrl}
              <br />
              {t(
                "Preços do simulador; o preço de cada item é confirmado no inventário."
              )}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
