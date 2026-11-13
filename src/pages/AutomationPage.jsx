import { DisclosurePanel } from "../components/WorkspaceSection.jsx";
import "./progression.css";
import { t } from "../language.js";
import React from "react";
import FarmControlPanel from "../FarmControlPanel.jsx";
export default function AutomationPage({ model, ui, onUiChange }) {
  return (
    <section className="panel">
      {model.loadedOperationProfile?.config.farm && (
        <div className="progression-notice">
          <strong>{t("Modos do perfil local carregado")}</strong>
          <p>
            {Object.entries(model.loadedOperationProfile.config.farm)
              .filter(([, v]) => v)
              .map(
                ([k]) =>
                  ({
                    case: t("Caixas"),
                    money: t("Dinheiro"),
                    vault: t("Cofre"),
                  })[k],
              )
              .join(" · ") || t("Todos os modos desligados")}{" "}
            · {model.selectedIds.length} {t("contas selecionadas")}
          </p>
          <button
            type="button"
            disabled={model.busy || model.running || !model.selectedIds.length}
            onClick={() =>
              model.actions.invokeFarm(async () => {
                for (const id of model.selectedIds)
                  await model.bridge.farmSetModes(
                    id,
                    model.loadedOperationProfile.config.farm,
                  );
                model.setNotice(
                  t(
                    "Modos do perfil aplicados. Revê as contas e inicia quando quiseres.",
                  ),
                );
              })
            }
          >
            {t("Aplicar modos do perfil às contas selecionadas")}
          </button>
        </div>
      )}
      <FarmControlPanel
        accounts={model.accounts}
        snapshots={model.snapshots}
        status={model.farmStatus}
        bridge={model.bridge}
        onNotice={model.setNotice}
        selectedIds={model.selectedIds}
        setSelectedIds={model.setSelectedIds}
        onRefresh={model.actions.refreshAccount}
        onRemove={model.actions.removeAccount}
        ui={ui}
        onUiChange={onUiChange}
        operationPending={model.farmPending}
        onInvoke={model.actions.invokeFarm}
      />
      <DisclosurePanel title="Como funciona a automação">
        <p className="form-note">
          {t(
            "Até 100 contas. Caixas e dinheiro alternam em cada conta; os cofres intercalam com os cliques. Um limite de cliques pausa essa conta até ao prazo indicado, sem abrandar as restantes. Lotes recusados não gastam o orçamento local. ",
          )}
          {t(
            model.farmStatus?.network?.connections > 1
              ? "Limites nas leituras ou nos cofres pausam as contas dessa ligação; as outras continuam."
              : "Limites nas leituras ou nos cofres mantêm uma pausa geral.",
          )}
          {t(
            " Os ganhos só aumentam quando o servidor aceita e confirma os pedidos.",
          )}
        </p>
      </DisclosurePanel>
    </section>
  );
}
