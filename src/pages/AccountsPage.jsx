import { DisclosurePanel } from "../components/WorkspaceSection.jsx";
import AccountTable from "../components/AccountTable.jsx";
import { t } from "../language.js";
import React, { useMemo } from "react";
import { Plus, Users, RefreshCw, Upload } from "lucide-react";
import { formatMoney, formatNumber } from "../format.js";
import AccountDetails from "../components/AccountDetails.jsx";
import AccountGroups from "../components/AccountGroups.jsx";
import AccountSelection from "../components/AccountSelection.jsx";
import LocalOperationProfiles from "../components/LocalOperationProfiles.jsx";
export default function AccountsPage({ model, ui, onUiChange }) {
  const states = useMemo(
    () =>
      new Map(
        (model.farmStatus?.accounts || []).map((item) => [item.id, item]),
      ),
    [model.farmStatus?.accounts],
  );
  const needle = String(ui.query || "")
    .trim()
    .toLocaleLowerCase("pt-PT");
  const accounts = useMemo(
    () =>
      model.accounts.filter((account) => {
        const group = model.accountWorkspace?.accountGroups?.[account.id];
        if (
          ui.groupId &&
          ui.groupId !== "all" &&
          (ui.groupId === "ungrouped" ? Boolean(group) : group !== ui.groupId)
        )
          return false;
        if (
          needle &&
          !account.label.toLocaleLowerCase("pt-PT").includes(needle) &&
          !account.id.toLocaleLowerCase("pt-PT").includes(needle)
        )
          return false;
        const snapshot = model.snapshots[account.id],
          entry = states.get(account.id);
        if (ui.status === "login")
          return (
            entry?.needsLogin === true ||
            Boolean(account.email && (!snapshot || snapshot.error))
          );
        if (ui.status === "error") return !!snapshot?.error;
        if (ui.status === "connected")
          return !!snapshot && !snapshot.error && !entry?.needsLogin;
        return true;
      }),
    [
      model.accounts,
      model.snapshots,
      model.accountWorkspace?.accountGroups,
      states,
      needle,
      ui.groupId,
      ui.status,
    ],
  );
  const detail = model.accounts.find((account) => account.id === ui.detailId);
  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <h2>{t("As tuas contas")}</h2>
          <span>
            {t(accounts.length)}{" "}
            {t(accounts.length === 1 ? "visível" : "visíveis")}
          </span>
        </div>
        <div className="toolbar">
          <input
            className="search"
            aria-label={t("Pesquisar contas")}
            placeholder={t("Pesquisar por nome")}
            value={ui.query || ""}
            onChange={(event) => onUiChange({ query: event.target.value })}
          />
          <select
            aria-label={t("Estado da sessão")}
            value={ui.status || "all"}
            onChange={(event) => onUiChange({ status: event.target.value })}
          >
            <option value="all">{t("Todas as sessões")}</option>
            <option value="connected">{t("Ligadas")}</option>
            <option value="login">{t("Pedem login")}</option>
            <option value="error">{t("Com erro")}</option>
          </select>
        </div>
        <div className="selection-toolbar">
          <span>
            {(model.selectedIds || []).length} {t("contas selecionadas")}
          </span>
          <button
            type="button"
            disabled={
              model.busy ||
              model.running ||
              !model.setSelectedIds ||
              !accounts.length
            }
            onClick={() =>
              model.setSelectedIds(accounts.map((account) => account.id))
            }
          >
            {t("Selecionar visíveis")}
          </button>
          <button
            type="button"
            disabled={
              model.busy ||
              model.running ||
              !model.setSelectedIds ||
              !(model.selectedIds || []).length
            }
            onClick={() => model.setSelectedIds([])}
          >
            {t("Limpar seleção")}
          </button>
        </div>
        {model.loading ? (
          <div className="empty-state">{t("A carregar as contas…")}</div>
        ) : accounts.length ? (
          <AccountTable
            accounts={accounts}
            model={model}
            states={states}
            onUiChange={onUiChange}
          />
        ) : (
          <div className="empty-state">
            <Users size={28} />
            <h2>
              {t(
                model.accounts.length
                  ? "Nenhuma conta encontrada"
                  : "Ainda não há contas ligadas",
              )}
            </h2>
            <p>
              {t(
                model.accounts.length
                  ? "Ajusta a pesquisa ou o filtro de sessão."
                  : "Usa Adicionar conta para ligar a primeira sessão.",
              )}
            </p>
          </div>
        )}
      </section>
      <DisclosurePanel
        title="Adicionar e importar contas"
        description="Ligar sessões, importar um ficheiro ou recuperar os logins."
        defaultOpen={!model.accounts.length}
        forceOpen={["running", "stopping", "paused"].includes(
          model.accountLogin?.phase,
        )}
      >
        <div className="connection-tools">
          <section className="panel">
            <div className="section-heading">
              <h2>{t("Ligar uma conta")}</h2>
              <span>
                {t(model.accounts.length)}
                {t(" de 100")}
              </span>
            </div>
            <form
              className="add-account"
              onSubmit={(event) => {
                event.preventDefault();
                model.actions.addAccount?.(model.form.label);
              }}
            >
              <label>
                {t("Nome local da conta")}
                <input
                  value={model.form.label}
                  maxLength={40}
                  placeholder={t("Por exemplo, Principal")}
                  onChange={(event) =>
                    model.setForm({ label: event.target.value })
                  }
                />
              </label>
              <button
                className="primary-button"
                disabled={
                  !model.bridge ||
                  model.busy ||
                  model.running ||
                  !model.form.label.trim() ||
                  model.accounts.length >= 100
                }
              >
                <Plus size={16} />
                {t(model.busy ? "A aguardar login…" : "Adicionar conta")}
              </button>
            </form>
            <p className="login-hint">
              {t(
                "Conclui o login na janela temporária. Ela fecha quando a sessão é validada.",
              )}
            </p>
            {model.running && (
              <p className="muted">
                {t(
                  "Para adicionar ou remover contas, termina primeiro a operação em curso.",
                )}
              </p>
            )}
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>{t("Importar contas")}</h2>
              <Upload size={20} />
            </div>
            <p>
              {t(
                "Escolhe o JSON que descarregaste no ajudante de recuperação. Podes importar as 51 contas de uma vez.",
              )}
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={
                !model.bridge?.importAccounts || model.busy || model.running
              }
              onClick={() => model.actions.importAccounts?.()}
            >
              <Upload size={16} />
              {t("Importar JSON")}
            </button>
            <p
              className="login-hint"
              style={{ marginTop: 12, marginBottom: 0 }}
            >
              {t(
                "As palavras-passe ficam protegidas neste Mac. Contas repetidas são atualizadas sem perder a sessão. Após importar, a app entra automaticamente nas contas com palavra-passe, uma de cada vez. Se o site pedir uma verificação, completa-a na janela aberta.",
              )}
            </p>
            <div className="run-actions">
              <button
                type="button"
                className="primary-button"
                disabled={
                  !model.bridge?.connectImportedAccounts ||
                  model.busy ||
                  model.running ||
                  !model.accounts.length
                }
                onClick={() => model.actions.connectImportedAccounts?.()}
              >
                {t("Religar todas as contas")}
              </button>
              {["running", "stopping"].includes(model.accountLogin?.phase) && (
                <button
                  type="button"
                  className="stop-button"
                  disabled={model.accountLogin.phase === "stopping"}
                  onClick={() => model.actions.stopAccountLogins?.()}
                >
                  {t("Parar logins")}
                </button>
              )}
            </div>
            {model.accountLogin?.total > 0 && (
              <p className="login-hint" role="status">
                {t(model.accountLogin.connected || 0)}
                {t(" logins concluídos · ")}
                {t(model.accountLogin.alreadyConnected || 0)}
                {t(" já ligados · ")}
                {t(model.accountLogin.withoutPassword || 0)}
                {t(" sem palavra-passe · ")}
                {t(model.accountLogin.total)}
                {t(" contas")}
                {t(
                  model.accountLogin.phase === "running" &&
                    model.accountLogin.label
                    ? ` · A entrar em ${model.accountLogin.label}`
                    : "",
                )}
                {t(
                  model.accountLogin.phase === "paused"
                    ? ` · Em pausa: ${model.accountLogin.message}`
                    : "",
                )}
              </p>
            )}
          </section>
        </div>
      </DisclosurePanel>
      <DisclosurePanel
        title="Grupos e seleção"
        description="Organiza as contas e escolhe o grupo de trabalho."
      >
        {model.accountWorkspace && (
          <AccountGroups
            accounts={model.accounts}
            workspace={model.accountWorkspace}
            selectedIds={model.selectedIds}
            onSelect={model.setSelectedIds}
            onCommand={model.actions.workspaceCommand}
            filter={ui.groupId || "all"}
            onFilterChange={(groupId) => onUiChange({ groupId })}
            disabled={model.busy || model.running}
          />
        )}
        {model.accountWorkspace && (
          <AccountSelection
            accounts={accounts}
            selectedIds={model.selectedIds || []}
            onChange={model.setSelectedIds || (() => {})}
            disabled={model.busy || model.running}
          />
        )}
      </DisclosurePanel>
      <DisclosurePanel
        title="Perfis de operação"
        description="Guardar e carregar configurações locais."
      >
        <LocalOperationProfiles
          accounts={model.accounts}
          profiles={model.accountWorkspace?.profiles || []}
          caseChoices={model.caseChoices || []}
          currentConfig={
            model.operationProfileConfig || {
              farm: { case: true, money: true, vault: true },
              targetCase: model.form.caseId || null,
            }
          }
          onCommand={model.actions.workspaceCommand}
          onApply={model.actions.applyOperationProfile}
          disabled={model.busy || model.running}
        />
      </DisclosurePanel>
      {detail && (
        <AccountDetails
          account={detail}
          snapshot={model.snapshots[detail.id]}
          onClose={() => onUiChange({ detailId: null })}
        />
      )}
    </div>
  );
}
