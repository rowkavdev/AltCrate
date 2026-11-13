import { DirectionSetting } from "../DesktopDirection.jsx";
import "./progression.css";
import React from "react";
import CapabilityPanel from "../components/CapabilityPanel.jsx";
import BoostsPanel from "./BoostsPanel.jsx";
import { Settings2 } from "lucide-react";
import { t } from "../language.js";
import FarmServerSettings from "../components/FarmServerSettings.jsx";
import { DisclosurePanel } from "../components/WorkspaceSection.jsx";
export default function SettingsPage({
  preferencesController = {},
  capabilities = [],
  serverController,
}) {
  const {
    preferences = { enableSiteOpening: false },
    loading,
    saving,
    error,
    update,
  } = preferencesController;
  return (
    <div className="page-stack">
      <div className="settings-grid">
        {serverController?.available && (
          <FarmServerSettings controller={serverController} />
        )}
        <section className="panel application-settings">
          <div className="section-heading">
            <h2>{t("Aplicação")}</h2>
            <Settings2 size={18} />
          </div>
          <div className="setting-row"><DirectionSetting /></div>
          <div className="setting-row optional-feature-settings">
            <div>
              <h3>{t("Funcionalidades opcionais")}</h3>
              <p>
                {t(
                  "Ativar esta página apenas mostra os controlos. As preferências do jogo só mudam depois de reveres e confirmares uma alteração.",
                )}
              </p>
            </div>
            <label className="optional-feature-choice">
              <input
                type="checkbox"
                checked={preferences.enableSiteOpening === true}
                disabled={loading || saving || !update}
                onChange={(event) =>
                  update({ enableSiteOpening: event.target.checked })
                }
              />
              <span>
                <strong>{t("Mostrar preferências de abertura")}</strong>
                <small>
                  {t(preferences.enableSiteOpening ? "Ativa" : "Inativa")}
                </small>
              </span>
            </label>
          </div>
          {saving && <p role="status">{t("A guardar preferência…")}</p>}
          {error && (
            <p className="inline-error" role="alert">
              {t(error)}
            </p>
          )}
        </section>
      </div>
      <DisclosurePanel
        title="Integrações e disponibilidade"
        description="Consultar capacidades, requisitos e funcionalidades por verificar."
        badge={capabilities.length}
      >
        <BoostsPanel capability={capabilities.find((c) => c.id === "boosts")} />
        <CapabilityPanel
          capabilities={capabilities.filter((c) => c.id !== "boosts")}
        />
      </DisclosurePanel>
    </div>
  );
}
