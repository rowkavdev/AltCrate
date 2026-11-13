import React, { useMemo, useState } from "react";
import { t } from "../language.js";
import "./accountWorkspace.css";
function GroupRow({ group, index, groups, members, onCommand, disabled }) {
  const [draft, setDraft] = useState(group.name),
    [deleting, setDeleting] = useState(false);
  function move(offset) {
    const ids = groups.map((g) => g.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    return onCommand("reorderGroups", { groupIds: ids });
  }
  return (
    <div className="account-group-row">
      <form
        className="toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          onCommand("updateGroup", { id: group.id, name: draft });
        }}
      >
        <input
          aria-label={t(`Nome do grupo ${group.name}`)}
          value={draft}
          maxLength={60}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim() || draft.trim() === group.name}
        >
          {t("Renomear")}
        </button>
        <button
          type="button"
          aria-label={t(`Mover ${group.name} para cima`)}
          disabled={disabled || index === 0}
          onClick={() => move(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={t(`Mover ${group.name} para baixo`)}
          disabled={disabled || index === groups.length - 1}
          onClick={() => move(1)}
        >
          ↓
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setDeleting(!deleting)}
        >
          {t("Apagar grupo")}
        </button>
      </form>
      <p className="muted">
        {members.length} {t("contas")}
        {members.length
          ? `: ${members.map((a) => `${a.label} (${a.id.slice(0, 8)})`).join(", ")}`
          : ""}
      </p>
      {deleting && (
        <div role="alert">
          <p>
            {t(
              `Apagar ${group.name} deixa ${members.length} contas sem grupo; não elimina contas.`,
            )}
          </p>
          <div className="run-actions">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onCommand("deleteGroup", { id: group.id })}
            >
              {t("Confirmar remoção do grupo")}
            </button>
            <button type="button" onClick={() => setDeleting(false)}>
              {t("Cancelar")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export default function AccountGroups({
  accounts = [],
  workspace,
  selectedIds = [],
  onSelect,
  onCommand,
  filter = "all",
  onFilterChange,
  disabled = false,
}) {
  const [name, setName] = useState(""),
    [destination, setDestination] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const groups = workspace?.groups || [],
    mapping = workspace?.accountGroups || {},
    selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]),
    selected = useMemo(
      () => accounts.filter((a) => selectedSet.has(a.id)),
      [accounts, selectedSet],
    );
  const membersByGroup = useMemo(() => {
    const result = new Map();
    for (const account of accounts) {
      const id = mapping[account.id];
      if (!result.has(id)) result.set(id, []);
      result.get(id).push(account);
    }
    return result;
  }, [accounts, mapping]);
  const filtered = accounts.filter(
    (a) =>
      filter === "all" ||
      (filter === "ungrouped" ? !mapping[a.id] : mapping[a.id] === filter),
  );
  const unavailable = disabled || pending || !workspace || !onCommand;
  async function command(action, payload) {
    if (unavailable) return;
    setPending(true);
    setError("");
    try {
      const result = await onCommand(action, payload);
      if (action === "createGroup") setName("");
      if (action === "deleteGroup") {
        if (payload.id === filter) onFilterChange?.("all");
        if (payload.id === destination) setDestination("");
      }
      return result;
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="panel account-groups"
      aria-label={t("Grupos de contas")}
    >
      <div className="section-heading">
        <h2>{t("Grupos de contas")}</h2>
        <span>
          {groups.length} {t("grupos locais")}
        </span>
      </div>
      <p className="form-note">
        {t(
          "Cada conta pertence a um grupo. Selecionar um grupo substitui a seleção de trabalho; não inicia operações. Apagar um grupo não elimina contas.",
        )}
      </p>
      {!workspace && <p className="muted">{t("A carregar grupos locais…")}</p>}
      <div className="toolbar">
        <label>
          {t("Filtrar grupo")}
          <select
            aria-label={t("Filtrar grupo")}
            value={filter}
            disabled={pending || !workspace}
            onChange={(e) => onFilterChange?.(e.target.value)}
          >
            <option value="all">{t("Todos os grupos")}</option>
            <option value="ungrouped">{t("Sem grupo")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={unavailable || filter === "all" || !onSelect}
          onClick={async () => {
            const result = await command("selectGroup", {
              groupId: filter === "ungrouped" ? null : filter,
            });
            if (result) onSelect(result.accountIds);
          }}
        >
          {t("Selecionar contas do grupo")}
        </button>
      </div>
      <p className="muted">
        {t("Contas abrangidas pelo filtro: ")}
        {filtered.length
          ? filtered.map((a) => `${a.label} (${a.id.slice(0, 8)})`).join(", ")
          : t("Nenhuma")}
      </p>
      <details>
        <summary>{t("Gerir grupos e associações")}</summary>
        <div className="toolbar">
          <label>
            {t("Associar as contas selecionadas a")}
            <select
              aria-label={t("Grupo de destino")}
              disabled={unavailable}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              <option value="">{t("Sem grupo")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={unavailable || !selected.length}
            onClick={() =>
              command("assignAccounts", {
                groupId: destination || null,
                accountIds: selected.map((a) => a.id),
              })
            }
          >
            {t("Associar selecionadas")} ({selected.length})
          </button>
        </div>
        <p className="muted">
          {t("Contas que serão associadas: ")}
          {selected.length
            ? selected.map((a) => `${a.label} (${a.id.slice(0, 8)})`).join(", ")
            : t("Seleciona contas na lista abaixo.")}
        </p>
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            command("createGroup", { name });
          }}
        >
          <input
            aria-label={t("Nome do novo grupo")}
            placeholder={t("Nome do novo grupo")}
            maxLength={60}
            value={name}
            disabled={unavailable}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" disabled={unavailable || !name.trim()}>
            {t("Criar grupo")}
          </button>
        </form>
        {groups.map((g, index) => (
          <GroupRow
            key={g.id + g.name}
            group={g}
            index={index}
            groups={groups}
            members={membersByGroup.get(g.id) || []}
            onCommand={command}
            disabled={unavailable}
          />
        ))}
      </details>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </section>
  );
}
