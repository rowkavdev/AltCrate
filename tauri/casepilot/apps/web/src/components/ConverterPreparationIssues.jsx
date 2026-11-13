import React from "react"
import { AlertTriangle, Settings2, UserMinus, X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { t } from "../language.js"

export default function ConverterPreparationIssues({
  issues,
  disabled,
  onPreferences,
  onExclude,
  onRemoveOpening,
}) {
  return issues.map((issue) => (
    <div
      key={`${issue.code}:${issue.accountId}`}
      role="alert"
      className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 text-sm"
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle size={16} aria-hidden="true" />
        {t("Venda automática ativa")} · {issue.label}
      </div>
      <p className="text-muted-foreground">
        {t(
          "Para guardar e converter os stickers, desativa a venda automática nas preferências desta conta."
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !onPreferences}
          onClick={() => onPreferences(issue.accountId)}
        >
          <Settings2 size={13} aria-hidden="true" />
          {t("Abrir preferências desta conta")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onExclude(issue.accountId)}
        >
          <UserMinus size={13} aria-hidden="true" />
          {t("Excluir esta conta")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onRemoveOpening}
        >
          <X size={13} aria-hidden="true" />
          {t("Retirar abertura e conversão de stickers")}
        </Button>
      </div>
    </div>
  ))
}
