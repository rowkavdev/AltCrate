import React, { useRef, useState } from "react"
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import { Folder, FolderPlus, Plus, Check, Trash2, X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { t } from "../language.js"
function GroupRow({ group, count, pending, onCommand }) {
  const [name, setName] = useState(group.name),
    [confirm, setConfirm] = useState(false)
  return (
    <div className="account-group-editor">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onCommand("updateGroup", { id: group.id, name }).catch(() => {})
        }}
      >
        <span className="account-group-folder" aria-hidden="true">
          <Folder size={18} />
        </span>
        <label>
          <span className="account-sr-only">{t("Nome do grupo")}</span>
          <Input
            aria-label={t("Nome do grupo") + " " + group.name}
            value={name}
            maxLength={60}
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <span className="account-group-member-count">
          {count} {t(count === 1 ? "conta" : "contas")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          type="submit"
          className="account-icon-button account-group-save"
          aria-label={t("Guardar")}
          title={t("Guardar")}
          disabled={pending || !name.trim() || name.trim() === group.name}
        >
          <Check size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          className="account-icon-button account-group-remove"
          aria-label={t("Remover grupo")}
          title={t("Remover grupo")}
          disabled={pending}
          onClick={() => setConfirm((value) => !value)}
        >
          <Trash2 size={15} />
        </Button>
      </form>
      {confirm && (
        <div className="group-remove-confirm">
          <p>
            {t(
              "As contas deste grupo ficam sem grupo. As contas e sessões são conservadas."
            )}
          </p>
          <div>
            <Button
              variant="destructive"
              size="sm"
              type="button"
              disabled={pending}
              onClick={() =>
                onCommand("deleteGroup", { id: group.id }).catch(() => {})
              }
            >
              {t("Confirmar remoção do grupo")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setConfirm(false)}
            >
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
export default function AccountGroupDialog({
  workspace,
  accounts,
  pending,
  onCommand,
  error,
  disabled,
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    input = useRef(null)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          type="button"
          className="account-manage-groups"
          aria-label={t("Gerir grupos")}
          title={t("Gerir grupos")}
          disabled={disabled}
        >
          <FolderPlus size={15} />
          <span className="account-group-trigger-label">
            {t("Gerir grupos")}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent
        container={document.querySelector(".cp-shell")}
        showCloseButton={false}
        className="account-dialog-content sm:max-w-[550px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          input.current?.focus()
        }}
      >
        <div className="account-dialog-heading">
          <span className="account-dialog-icon" aria-hidden="true">
            <Folder size={21} />
          </span>
          <div>
            <DialogTitle>{t("Grupos de contas")}</DialogTitle>
            <DialogDescription>
              {t(
                "Cria grupos para organizar as tuas contas. Os grupos ficam guardados neste Mac."
              )}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              className="account-icon-button"
              aria-label={t("Fechar grupos")}
            >
              <X size={18} />
            </Button>
          </DialogClose>
        </div>
        <form
          className="account-group-create"
          onSubmit={async (event) => {
            event.preventDefault()
            try {
              await onCommand("createGroup", { name })
              setName("")
            } catch {}
          }}
        >
          <label>
            {t("Nome do novo grupo")}
            <Input
              ref={input}
              value={name}
              maxLength={60}
              placeholder={t("Por exemplo, Principal")}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <Button
            variant="default"
            size="sm"
            disabled={pending || !name.trim()}
          >
            <Plus size={15} />
            {t("Criar grupo")}
          </Button>
        </form>
        <div className="account-group-list-heading">
          <span>{t("Os teus grupos")}</span>
          <span>{workspace?.groups?.length || 0}</span>
        </div>
        <div className="account-group-editors">
          {(workspace?.groups || []).map((group) => (
            <GroupRow
              key={group.id + group.name}
              group={group}
              count={
                accounts.filter(
                  (account) =>
                    workspace.accountGroups?.[account.id] === group.id
                ).length
              }
              pending={pending}
              onCommand={onCommand}
            />
          ))}
        </div>
        {!workspace?.groups?.length && (
          <p className="account-groups-empty">
            {t("Cria o primeiro grupo para organizar as contas.")}
          </p>
        )}
        {error && (
          <p role="alert" className="account-inline-error">
            {t(error)}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
