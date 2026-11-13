import React from "react"
import { X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@workspace/ui/components/dialog"
import { t } from "../language.js"

const MODES = [
  ["case", "Caixas"],
  ["money", "Dinheiro"],
  ["vault", "Cofre"],
]
export default function FarmModesDialog({
  open,
  onOpenChange,
  modes,
  onModesChange,
  onApply,
  pending,
  disabled,
  selectedCount,
  running,
  children,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={document.querySelector(".cp-shell")}
        className="farm-modes-dialog"
        showCloseButton={false}
      >
        <div className="farm-modes-heading">
          <div>
            <DialogTitle>{t("Modos da automação")}</DialogTitle>
            <DialogDescription>
              {selectedCount}{" "}
              {t(
                selectedCount === 1
                  ? "conta selecionada"
                  : "contas selecionadas"
              )}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Fechar")}
            >
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>
        <fieldset className="farm-mode-options" disabled={pending}>
          <legend className="sr-only">
            {t("Modos nas contas selecionadas")}
          </legend>
          {MODES.map(([kind, label]) => (
            <label key={kind}>
              <span>{t(label)}</span>
              <input
                type="checkbox"
                checked={modes?.[kind] === true}
                onChange={() =>
                  onModesChange({ ...modes, [kind]: !modes?.[kind] })
                }
              />
            </label>
          ))}
        </fieldset>
        <p className="farm-mode-hint">
          {t(
            running
              ? "Aplica os modos às contas da execução atual."
              : "Configura os modos; a execução começa em Iniciar."
          )}
        </p>
        <div className="farm-mode-actions">
          <Button
            variant="outline"
            type="button"
            disabled={pending || disabled}
            onClick={() => {
              const next = { case: true, money: false, vault: true }
              onModesChange(next)
              onApply(next)
            }}
          >
            {t("Prioridade caixas e cofre")}
          </Button>
          <Button
            type="button"
            disabled={pending || disabled}
            onClick={() => onApply(modes)}
          >
            {t(pending ? "A aplicar…" : "Aplicar modos")}
          </Button>
        </div>
        {children && <div className="farm-profile-controls">{children}</div>}
      </DialogContent>
    </Dialog>
  )
}
