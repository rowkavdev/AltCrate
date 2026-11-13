import React, { useState } from "react"
import { Pencil, Check, X, LogIn } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { NativeSelect } from "@workspace/ui/components/native-select"
import { t } from "../language.js"
import { Badge } from "@workspace/ui/components/badge"
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "@workspace/ui/components/table"
const labels = {
  validating: "A validar sessão",
  connected: "Ligada",
  saved: "Sessão guardada",
  missing: "Sem sessão",
  expired: "Sessão expirada",
  "needs-login": "Precisa de login",
  verification: "Verificação necessária",
}
function AccountRow({
  account,
  model,
  workspace,
  selected,
  onSelect,
  onCommand,
  editingLocked,
  groupLocked,
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(account.label),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("")
  async function rename(event) {
    event.preventDefault()
    if (!draft.trim()) return
    setSaving(true)
    setError("")
    try {
      await onCommand("renameAccount", { id: account.id, label: draft.trim() })
      setEditing(false)
    } catch (error) {
      setError(error.message || String(error))
    } finally {
      setSaving(false)
    }
  }
  const words = account.label.split(/\s+/).filter(Boolean),
    alias = account.label.match(/(?:\+|\s)(\d+)(?:@|$)/)
  const initials = alias
    ? alias[1].slice(-3)
    : words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
          .toUpperCase()
      : account.label.slice(0, 2).toUpperCase()
  const status = account.session?.state || "missing"
  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className={"account-row" + (selected ? " is-selected" : "")}
    >
      <TableCell className="account-check">
        <input
          type="checkbox"
          aria-label={t("Selecionar conta") + " " + account.label}
          checked={selected}
          onChange={(event) => onSelect(account.id, event.target.checked)}
        />
      </TableCell>
      <TableCell className="account-name-cell">
        {editing ? (
          <form
            className="account-rename"
            onSubmit={rename}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setEditing(false)
                setError("")
              }
            }}
          >
            <Input
              aria-label={t("Novo nome da conta")}
              value={draft}
              maxLength={40}
              autoFocus
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              type="submit"
              disabled={saving || !draft.trim()}
              aria-label={t("Guardar nome")}
            >
              <Check size={15} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={saving}
              aria-label={t("Cancelar alteração do nome")}
              onClick={() => {
                setEditing(false)
                setError("")
              }}
            >
              <X size={15} />
            </Button>
          </form>
        ) : (
          <div className="account-identity">
            <span className="account-avatar" aria-hidden="true">
              {initials}
            </span>
            <div className="account-name-heading">
              <strong title={account.label}>{account.label}</strong>
              <Button
                variant="ghost"
                size="icon-xs"
                type="button"
                className="account-edit-button"
                aria-label={t("Alterar nome de") + " " + account.label}
                disabled={editingLocked}
                onClick={() => {
                  setDraft(account.label)
                  setError("")
                  setEditing(true)
                }}
              >
                <Pencil size={13} />
              </Button>
            </div>
          </div>
        )}
        {account.email && account.email !== account.label && (
          <small title={account.email}>{account.email}</small>
        )}
        {error && (
          <small role="alert" className="account-inline-error">
            {t(error)}
          </small>
        )}
      </TableCell>
      <TableCell className="account-group-cell" data-label={t("Grupo")}>
        <div className="account-row-group">
          <NativeSelect
            size="sm"
            className="account-group-select"
            aria-label={t("Grupo de") + " " + account.label}
            value={workspace?.accountGroups?.[account.id] || ""}
            disabled={groupLocked}
            onChange={(event) =>
              onCommand("assignAccounts", {
                accountIds: [account.id],
                groupId: event.target.value || null,
              }).catch(() => {})
            }
          >
            <option value="">{t("Sem grupo")}</option>
            {(workspace?.groups || []).map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </TableCell>
      <TableCell className="account-session-cell" data-label={t("Sessão")}>
        <Badge
          variant={
            ["expired", "needs-login"].includes(status)
              ? "destructive"
              : "secondary"
          }
          className={"account-session-badge session-" + status}
        >
          <span aria-hidden="true" />
          {t(labels[status] || "Sem sessão")}
        </Badge>
      </TableCell>
      <TableCell className="account-actions">
        <Button
          variant="ghost"
          size={account.session?.reusable ? "icon-sm" : "sm"}
          type="button"
          aria-label={t("Login manual")}
          title={t("Login manual")}
          className={
            "account-row-login" +
            (!account.session?.reusable ? " needs-login" : "")
          }
          disabled={
            model.busy || model.running || !model.bridge?.connectAccount
          }
          onClick={() =>
            model.actions.connectAccount(account, { manual: true })
          }
        >
          <LogIn size={14} />
          {!account.session?.reusable && t("Login manual")}
        </Button>
      </TableCell>
    </TableRow>
  )
}
export default function AccountTable({
  accounts,
  model,
  workspace,
  selection = [],
  onSelectionChange,
  onCommand,
  groupLocked = false,
}) {
  const allSelected =
    accounts.length > 0 &&
    accounts.every((account) => selection.includes(account.id))
  return (
    <div className="account-list">
      <Table className="account-table account-management-table">
        <TableHeader>
          <TableRow>
            <TableHead className="account-check">
              <span className="account-mobile-select-label">
                {t("Selecionar página")}
              </span>
              <input
                type="checkbox"
                aria-label={t("Selecionar página")}
                checked={allSelected}
                ref={(node) => {
                  if (node)
                    node.indeterminate =
                      !allSelected &&
                      accounts.some((account) => selection.includes(account.id))
                }}
                onChange={(event) =>
                  onSelectionChange(
                    accounts.map((account) => account.id),
                    event.target.checked
                  )
                }
              />
            </TableHead>
            <TableHead>{t("Conta")}</TableHead>
            <TableHead>{t("Grupo")}</TableHead>
            <TableHead>{t("Sessão")}</TableHead>
            <TableHead>{t("Ações")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              model={model}
              workspace={workspace}
              selected={selection.includes(account.id)}
              onSelect={(id, checked) => onSelectionChange([id], checked)}
              onCommand={onCommand}
              editingLocked={model.busy || model.running || groupLocked}
              groupLocked={groupLocked}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
