import React from "react"
import { Pause, Play, ChevronRight } from "lucide-react"
import { Card } from "@workspace/ui/components/card"
import { Button } from "@workspace/ui/components/button"
import { Switch } from "radix-ui"
import { farmAccountState, formatVirtualMoney } from "../farmViewModel.js"
import { formatNumber, formatTime } from "../format.js"
import { t } from "../language.js"

const MODES = [
  ["case", "Caixas"],
  ["money", "Dinheiro"],
  ["vault", "Cofre"],
]
export default function FarmAccountCard({
  account,
  entry,
  status,
  selected,
  selectionLocked,
  pending,
  onSelect,
  onPause,
  onDetails,
  onModeChange,
}) {
  const state = farmAccountState(entry, status)
  const problem = entry?.error || (state.key === "login" ? state.reason : "")
  const measured =
    status?.phase === "running" &&
    entry?.selected &&
    Number.isFinite(entry?.performance?.casesPerMinute5)
  return (
    <Card
      className="farm-account-card"
      role="article"
      aria-label={account.label}
      data-account-id={account.id}
    >
      <div className="farm-card-heading">
        <label className="farm-card-identity">
          <input
            type="checkbox"
            aria-label={t("Selecionar " + account.label)}
            checked={selected}
            disabled={selectionLocked}
            onChange={onSelect}
          />
          <strong title={account.label}>{account.label}</strong>
        </label>
        <span className={"farm-card-state state-" + state.key}>
          <i aria-hidden="true" />
          {t(state.label)}
        </span>
      </div>
      <div
        className="farm-card-modes"
        role="group"
        aria-label={t("Modos de " + account.label)}
      >
        {MODES.map(([kind, label]) => (
          <label className="farm-card-mode" key={kind}>
            <Switch.Root
              data-slot="switch"
              className="farm-mode-switch"
              aria-label={t(label) + " · " + account.label}
              checked={entry?.modes?.[kind] === true}
              disabled={pending || !entry?.modes}
              onCheckedChange={(checked) => onModeChange(kind, checked)}
            >
              <Switch.Thumb className="farm-mode-thumb" />
            </Switch.Root>
            <span>{t(label)}</span>
          </label>
        ))}
      </div>
      <div className="farm-card-metrics">
        <div
          className="farm-card-cases"
          title={t("Caixas ganhas e confirmadas")}
        >
          <span>{t("Caixas ganhas")}</span>
          <strong className="farm-card-case-count">
            {formatNumber(entry?.results?.case)}
          </strong>
          {measured && (
            <small>
              {formatNumber(entry.performance.casesPerMinute5, 2)}{" "}
              {t("caixas/min")}
            </small>
          )}
        </div>
        <dl className="farm-card-money">
          <div>
            <dt>{t("Dinheiro")}</dt>
            <dd title={formatVirtualMoney(entry?.results?.money)}>
              {formatVirtualMoney(entry?.results?.money)}
            </dd>
          </div>
          <div>
            <dt>{t("Cofre")}</dt>
            <dd title={formatVirtualMoney(entry?.results?.vault)}>
              {formatVirtualMoney(entry?.results?.vault)}
            </dd>
          </div>
        </dl>
      </div>
      {problem && (
        <p className="farm-card-problem" title={t(problem)}>
          {t(problem)}
        </p>
      )}
      {state.nextAt && (
        <p className="farm-card-schedule">
          {t("Retoma às")} <time>{formatTime(state.nextAt)}</time>
        </p>
      )}
      <div className="farm-card-actions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending || !entry}
          aria-label={t(
            (entry?.paused ? "Retomar " : "Pausar ") + account.label
          )}
          onClick={onPause}
        >
          {entry?.paused ? (
            <Play aria-hidden="true" />
          ) : (
            <Pause aria-hidden="true" />
          )}
          {t(entry?.paused ? "Retomar" : "Pausar")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("Detalhes de " + account.label)}
          onClick={onDetails}
        >
          {t("Detalhes")}
          <ChevronRight className="farm-detail-arrow" aria-hidden="true" />
        </Button>
      </div>
    </Card>
  )
}
