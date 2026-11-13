import React, { useState, useMemo } from "react"
import {
  ArrowRight,
  ArrowRightLeft,
  Coins,
  LockKeyhole,
  Package,
  LoaderCircle,
  Settings2,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@workspace/ui/components/dialog"
import { formatNumber } from "../format.js"
import { t } from "../language.js"
import { converterSteps } from "../converterViewModel.js"

function ReviewItems({ row }) {
  const [page, setPage] = useState(1),
    items = [...row.items, ...row.excludedItems],
    pages = Math.max(1, Math.ceil(items.length / 8))
  return (
    <details className="converter-review-items">
      <summary>
        {t("Ver skins")} · {items.length}
      </summary>
      <div className="converter-skin-grid">
        {items.slice((page - 1) * 8, page * 8).map((item) => (
          <div
            key={item.id}
            className={
              "converter-skin" +
              (row.excludedItems.some((excluded) => excluded.id === item.id)
                ? " is-excluded"
                : "")
            }
          >
            {item.image ? (
              <img src={item.image} alt="" loading="lazy" />
            ) : (
              <Package size={28} aria-hidden="true" />
            )}
            <div>
              <strong>{item.name}</strong>
              <small>
                {item.protection?.includes("unresolved-result")
                  ? t("Resultado anterior guardado para revisão")
                  : item.isFavorite
                    ? t("Favorito · fica na origem")
                    : item.protection?.length
                      ? t("Skin especial")
                      : t("Incluída na conversão")}
              </small>
            </div>
          </div>
        ))}
      </div>
      {pages > 1 && (
        <div className="converter-items-pagination">
          <Button
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("Anterior")}
          </Button>
          <span>
            {page} / {pages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("Seguinte")}
          </Button>
        </div>
      )}
    </details>
  )
}
export default function ConverterReviewDialog({
  preview,
  pending,
  preparation,
  stopping,
  expired = false,
  onStop,
  onReview,
  error,
  stale,
  returnFocusRef,
  onClose,
  onConfirm,
  onProtected,
}) {
  const rows = useMemo(
    () =>
      preview
        ? preview.rows.map((row) => ({
            ...row,
            reviewSteps: row.prerequisites?.some((p) => p.kind === "convert-existing")
              ? ["convert-inventory", ...row.effectiveSteps.filter((id) => id !== "convert-inventory")]
              : row.effectiveSteps,
            items: [
              ...new Map(
                [
                  ...(row.items || []),
                  ...(row.transferItems || []),
                  ...(row.stickerItems || []),
                  ...(row.receivedItems || []),
                  ...(row.prerequisites || []).flatMap((p) => p.items || []),
                ].map((item) => [item.id, item])
              ).values(),
            ],
          }))
        : [],
    [preview]
  )
  if (!preview) return null
  const sequence = Array.isArray(preview.steps)
  const special = rows.flatMap((row) =>
    [...row.items, ...row.excludedItems]
      .filter(
        (item) =>
          item.protection?.length &&
          !item.isFavorite &&
          !item.protection.includes("unpriced") &&
          !item.protection.includes("unresolved-result")
      )
      .map((item) => row.accountId + ":" + item.id)
  )
  const includedSpecial = rows.some((row) =>
    row.items.some((item) => item.protection?.length)
  )
  const totalItems = rows.reduce((n, row) => n + row.items.length, 0),
    excluded = rows.reduce((n, row) => n + row.excludedItems.length, 0),
    transferRows = rows.filter((row) => row.effectiveSteps?.includes("transfer") || (!sequence && row.route)),
    transferTokens = transferRows.reduce((sum, row) => sum + (Number.isFinite(row.scopes?.tokens) ? row.scopes.tokens : Number.isFinite(row.maxTokens) ? row.maxTokens : 0), 0)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent
        className="converter-review-dialog"
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current && !returnFocusRef.current.disabled) {
            event.preventDefault()
            returnFocusRef.current.focus()
          }
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault()
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t(
              sequence
                ? "Rever etapas"
                : preview.legacy
                  ? "Rever etapa"
                  : "Rever consolidação"
            )}
          </DialogTitle>
          <DialogDescription>
            {t("Confirma as contas, os itens e o destino antes de iniciar.")}
          </DialogDescription>
        </DialogHeader>
        {pending && (
          <div className="converter-revalidation" role="status" aria-live="polite">
            <p><LoaderCircle size={15} className="animate-spin" aria-hidden="true" />{t(stopping ? "A parar…" : "A revalidar as contas antes de iniciar…")}</p>
            {preparation?.total > 0 && <>
              <progress aria-label={t("Progresso da revalidação")} value={preparation.completed || 0} max={preparation.total} />
              <small>{formatNumber(preparation.completed || 0)} / {formatNumber(preparation.total)} {preparation.label}</small>
            </>}
          </div>
        )}
        <div className="converter-review-scroll">
          {rows.some((row) => row.prerequisites?.length) && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-1">
              <p className="flex items-center gap-2 font-medium">
                <Settings2 size={16} aria-hidden="true" />
                {t("Preparação automática")}
              </p>
              {rows.some((row) => row.prerequisites?.some((p) => p.kind === "disable-autosell")) && (
                <p className="text-muted-foreground">
                  {t("Desligar a venda automática antes de começar:")} {rows.filter((row) => row.prerequisites?.some((p) => p.kind === "disable-autosell")).length} {t("contas")}. {t("As restantes preferências são preservadas. A alteração fica guardada no site.")}
                </p>
              )}
              {rows.some((row) => row.prerequisites?.some((p) => p.items?.length)) && (
                <p className="text-muted-foreground">
                  {t("Converte os itens revistos abaixo em tokens antes de abrir. Favoritos e itens protegidos ficam de fora.")}
                </p>
              )}
            </div>
          )}
          {!!preview.config?.repeatOperationIds?.length && (
            <p className="converter-run-note">
              {t(
                "Nova execução com dados atuais. Os resultados anteriores desta conta ficam arquivados; as restantes contas são preservadas."
              )}
            </p>
          )}
          <div className="converter-review-destination">
            <span>
              <ArrowRightLeft size={18} />
              {t("Conta principal")}
            </span>
            <strong>
              {preview.destination?.label || t("Sem transferência nesta etapa")}
            </strong>
          </div>
          {!!transferRows.length && (
            <p className="converter-review-token-total"><Coins size={15} aria-hidden="true" /> {t("Tokens no âmbito do envio")} <strong>{formatNumber(transferTokens, 0)}</strong></p>
          )}
          {sequence && preview.steps.some((step) => ["buy", "open"].includes(step)) && (
            <p className="converter-capsule-note">{t("Cápsula fixa do conversor:")} <strong>Atlanta2017</strong></p>
          )}
          {!preview.legacy && (
            <div className="converter-review-scope">
              <span>
                <strong>{totalItems}</strong>{" "}
                {t(sequence ? "itens revistos" : "skins incluídas")}
              </span>
              <span>
                <LockKeyhole size={13} />
                {excluded} {t("protegidas")}
              </span>
            </div>
          )}
          <div className="converter-review-origins">
            {rows.map((row) => (
              <section key={row.accountId} className="converter-review-origin">
                <div className="converter-review-origin-heading">
                  <strong>{row.label}</strong>
                  <Badge variant="secondary">
                    {row.membership === "pro"
                      ? "Pro"
                      : t(
                          ["basic", "free"].includes(row.membership)
                            ? "Sem Pro"
                            : "Por verificar"
                        )}
                  </Badge>
                </div>
                {sequence && row.scopes && (
                  <dl className="converter-review-resources">
                    {row.effectiveSteps.includes("sell") && (
                      <div>
                        <dt>{t("Caixas no âmbito")}</dt>
                        <dd>
                          {formatNumber(
                            row.scopes.cases
                              .filter((box) => box.type === "case")
                              .reduce((sum, box) => sum + box.amount, 0)
                          )}
                        </dd>
                      </div>
                    )}
                    {row.effectiveSteps.includes("buy") && (
                      <div>
                        <dt>{t("Dinheiro revisto")}</dt>
                        <dd>${formatNumber(row.scopes.money, 2)}</dd>
                      </div>
                    )}
                    {row.effectiveSteps.includes("open") && (
                      <div>
                        <dt>{t("Cápsulas existentes")}</dt>
                        <dd>{formatNumber(row.scopes.capsuleCount)}</dd>
                      </div>
                    )}
                    {(row.effectiveSteps.includes("mint") || row.effectiveSteps.includes("transfer")) && (
                      <div>
                        <dt>{t(row.effectiveSteps.includes("transfer") ? "Tokens no âmbito do envio" : "Tokens revistos")}</dt>
                        <dd>{formatNumber(row.scopes.tokens, 0)}</dd>
                      </div>
                    )}
                  </dl>
                )}
                {row.prerequisites?.some((p) => p.kind === "disable-autosell") && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Settings2 size={14} aria-hidden="true" />
                    {t("Primeiro: desligar e verificar a venda automática.")}
                  </p>
                )}
                {row.prerequisites?.filter((p) => p.items?.length).map((p) => (
                  <p key={p.kind} className="text-sm text-muted-foreground">
                    {t(p.kind === "convert-existing" ? "Converter inventário existente primeiro:" : "Libertar espaço antes de começar:")} {formatNumber(p.items.length)} {t("itens")} · ${formatNumber(p.items.reduce((n, item) => n + item.price, 0), 2)}. {t("Conversão irreversível em tokens.")}
                  </p>
                ))}
                {sequence &&
                  row.effectiveSteps.includes("sell") &&
                  row.effectiveSteps.includes("buy") && (
                    <p>
                      {t(
                        "A compra pode usar também a receita comprovada da venda, dentro da cotação revista."
                      )}
                    </p>
                  )}
                {sequence &&
                  row.effectiveSteps.includes("open") &&
                  row.effectiveSteps.includes("buy") && (
                    <p>
                      {t("Abre também as cápsulas compradas nesta execução.")}
                    </p>
                  )}
                {sequence &&
                  row.effectiveSteps.some((id) => ["mint", "transfer"].includes(id)) &&
                  row.effectiveSteps.some((id) =>
                    ["convert-stickers", "convert-inventory"].includes(id)
                  ) && (
                    <p>
                      {t(
                        "Inclui também os tokens comprovados das conversões anteriores desta sequência."
                      )}
                    </p>
                  )}
                {sequence && (
                  <>
                    <ol className="converter-review-steps">
                      {row.reviewSteps.map((id) => (
                        <li key={id}>
                          {t(
                            converterSteps.find((step) => step.id === id)
                              ?.label || id
                          )}
                        </li>
                      ))}
                    </ol>
                    <p className="converter-review-stop">
                      {t("Termina após:")}{" "}
                      <strong>
                        {t(
                          converterSteps.find(
                            (step) => step.id === row.reviewSteps.at(-1)
                          )?.label
                        )}
                      </strong>
                    </p>
                    {row.effectiveSteps.length !== preview.steps.length && (
                      <p>
                        {t(
                          "O percurso foi adaptado ao Pro ou às etapas já concluídas."
                        )}
                      </p>
                    )}
                  </>
                )}
                {!sequence && !preview.legacy && (
                  <div className="converter-review-route">
                    <span>
                      {t(row.route === "tokens" ? "Tokens" : "Tokens → skins")}
                    </span>
                    <ArrowRight size={13} />
                    <span>{t("Principal")}</span>
                    {row.route === "skins" && (
                      <>
                        <ArrowRight size={13} />
                        <span>
                          <Coins size={13} />
                          {t("Tokens")}
                        </span>
                      </>
                    )}
                  </div>
                )}
                {!sequence && !preview.legacy && (
                  <p>
                    {row.items.length} {t("skins a converter")} · {t("até")}{" "}
                    <strong>{formatNumber(row.maxTokens)}</strong>{" "}
                    {t("tokens na origem")}
                  </p>
                )}
                {row.items.length + row.excludedItems.length > 0 && (
                  <ReviewItems row={row} />
                )}
              </section>
            ))}
          </div>
          {!!special.length && !preview.legacy && (
            <div className="converter-special-scope">
              <div>
                <strong>{t("Skins especiais")}</strong>
                <p>
                  {t(
                    "Padrões, eventos, acessórios e floats de topo ficam protegidos até os incluíres. Os favoritos ficam sempre na origem."
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={pending || stale}
                onClick={() => onProtected(includedSpecial ? [] : special)}
              >
                {t(
                  includedSpecial ? "Proteger especiais" : "Incluir especiais"
                )}{" "}
                {!includedSpecial && `(${special.length})`}
              </Button>
            </div>
          )}
          <div className="converter-review-notes">
            {sequence ? (
              <>
                <p>
                  {t(
                    "Executa apenas as etapas revistas. As skins e os stickers guardados ficam identificados para continuar depois."
                  )}
                </p>
                {preview.steps.includes("mint") && (
                  <p>
                    {t(
                      "O site escolhe as skins e pode criar várias. Cada pedido usa até 100 milhões de tokens. O resultado e qualquer pagamento em dinheiro são verificados antes de avançar."
                    )}
                  </p>
                )}
                {preview.steps.some((id) =>
                  [
                    "convert-inventory",
                    "convert-stickers",
                    "convert-received",
                  ].includes(id)
                ) && (
                  <p>
                    {t(
                      "As conversões em tokens são irreversíveis. Favoritos ficam protegidos."
                    )}
                  </p>
                )}
              </>
            ) : preview.legacy ? (
              <p>{t(preview.legacyDescription)}</p>
            ) : (
              <>
                <p>
                  {t(
                    "As skins incluídas são convertidas de forma irreversível. A principal converte apenas os itens recebidos por esta execução."
                  )}
                </p>
                {preview.rows.some((row) => row.route === "skins") && (
                  <p>
                    {t(
                      "O site escolhe as skins e pode criar várias. Cada pedido usa até 100 milhões de tokens. O resultado e qualquer pagamento em dinheiro são verificados antes de avançar."
                    )}
                  </p>
                )}
              </>
            )}
          </div>
          {expired && (
            <p role="alert" className="converter-error">{t("A revisão expirou. Revê novamente antes de confirmar.")}</p>
          )}
          {stale && !expired && (
            <p role="alert" className="converter-error">
              {t("A seleção mudou. Fecha esta revisão e prepara uma nova.")}
            </p>
          )}
          {error && (
            <p role="alert" className="converter-error">
              {t(error)}
            </p>
          )}
        </div>
        <DialogFooter>
          {pending && onStop && <Button variant="outline" disabled={stopping} onClick={onStop}>{t(stopping ? "A parar…" : "Parar")}</Button>}
          {!pending && (expired || stale) && onReview && <Button variant="outline" onClick={onReview}>{t("Rever novamente")}</Button>}
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t("Voltar")}
          </Button>
          <Button disabled={pending || stale || expired} onClick={onConfirm}>
            {pending && <LoaderCircle className="animate-spin" size={14} />}{" "}
            {sequence
              ? `${t("Confirmar")} ${preview.steps.length} ${t(preview.steps.length === 1 ? "etapa" : "etapas")}`
              : t("Confirmar e iniciar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
