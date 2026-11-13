import SkillPresetPanel from "./SkillPresetPanel.jsx";
import { WorkspaceTabs } from "../components/WorkspaceSection.jsx";
import { DisclosurePanel } from "../components/WorkspaceSection.jsx";
import { t } from "../language.js";
import ProgressionBatchPanel from "./ProgressionBatchPanel.jsx";
import React, { useEffect, useMemo, useState } from "react";
import { Check, Lock, Map as MapIcon } from "lucide-react";
import {
  MAP_NAMES,
  displayValue,
  skillAvailability,
  skillIndex,
} from "./progressionHelpers.js";
import {
  useProgressionAccount,
  useProgression,
  ProgressionHeader,
  ProgressionState,
  PreviewDialog,
  ReadTime,
} from "./progressionShared.jsx";
const rewardTypes = {
  11: "Dinheiro por clique",
  13: "Capacidade do cofre",
  14: "Geração do cofre por minuto",
  15: "Pontos percentuais de caixas por clique",
  16: "Capacidade do inventário",
  17: "Máximo de aberturas",
  19: "Preço máximo da caixa",
  20: "Multiplicador",
};
export function skillEffects(rewards) {
  if (!rewards) return "Efeito não indicado";
  return (Array.isArray(rewards) ? rewards : [rewards])
    .map((reward) => {
      if (typeof reward === "object")
        return `${reward.description || rewardTypes[reward.type ?? reward.rewardType] || "Efeito desconhecido (" + displayValue(reward.type ?? reward.rewardType) + ")"}: ${displayValue(reward.value ?? reward.amount ?? reward.rewardAmount)}`;
      const [type, amount] = String(reward).split(";");
      return amount === undefined
        ? displayValue(reward)
        : `${rewardTypes[type] || "Efeito desconhecido (" + type + ")"}: ${displayValue(Number(amount))}`;
    })
    .join(" · ");
}
const position = (value) =>
  `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
export function SkillMapContent({ data, pending = false, onPrepare }) {
  const skills = data.map.skills || [];
  const index = useMemo(() => skillIndex(data), [data]);
  const states = useMemo(
    () =>
      new Map(
        skills.map((skill) => [
          String(skill.id),
          skillAvailability(data, skill, index),
        ]),
      ),
    [data, index],
  );
  function scrollTo(event, id) {
    event.preventDefault();
    const target = document.getElementById(id);
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  }
  return (
    <>
      <div className="progression-totals panel">
        <div>
          <span className="muted">{t("Dinheiro virtual")}</span>
          <strong>{t(displayValue(data.money))}</strong>
        </div>
        <div>
          <span className="muted">{t("Pontos disponíveis")}</span>
          <strong>{t(displayValue(data.skillPoints))}</strong>
        </div>
        <div>
          <span className="muted">{t("Rank")}</span>
          <strong>
            {t(displayValue(data.rank?.name ?? data.rank?.id ?? data.rank))}
          </strong>
        </div>
        <div>
          <span className="muted">{t("Rank necessário")}</span>
          <strong>{t(displayValue(data.map.requiredRankId))}</strong>
        </div>
        {data.map.requiredPremierId > 0 && (
          <>
            <div>
              <span className="muted">{t("Rank Premier")}</span>
              <strong>
                {t(displayValue(data.premierRank?.id ?? data.premierRank))}
              </strong>
            </div>
            <div>
              <span className="muted">{t("Premier necessário")}</span>
              <strong>{t(displayValue(data.map.requiredPremierId))}</strong>
            </div>
          </>
        )}
      </div>
      <section
        className="panel"
        id="skill-accessible-list"
        tabIndex={-1}
        aria-label={t("Lista de habilidades")}
      >
        <h3>{t("Lista de habilidades")}</h3>
        <ul className="skill-node-list">
          {skills.map((skill) => {
            const state = states.get(String(skill.id));
            return (
              <li id={"skill-node-" + skill.id} tabIndex={-1} key={skill.id}>
                <div>
                  <div className="section-heading">
                    <h4>{skill.name}</h4>
                    <span
                      className={"status-tag" + (state.isOwned ? " good" : "")}
                    >
                      {t(state.state)}
                    </span>
                  </div>
                  <p>{t(skillEffects(skill.effects || skill.rewards))}</p>
                  <p className="muted">
                    {t("Custo: ")}
                    {t(displayValue(skill.cost))}
                    {t(" de dinheiro virtual · 1 ponto")}
                    {t(
                      skill.requiredPrevSkillId != null
                        ? ` · Requer: ${index.byId.get(String(skill.requiredPrevSkillId))?.name || skill.requiredPrevSkillId}`
                        : " · Sem dependência",
                    )}
                  </p>
                  {state.reason && (
                    <p className="form-note">{t(state.reason)}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={
                    pending || !(state.isOwned ? state.canSell : state.canBuy)
                  }
                  onClick={() =>
                    onPrepare(state.isOwned ? "skill-sell" : "skill-buy", {
                      mapName: data.map.name,
                      skillId: skill.id,
                    })
                  }
                >
                  {t(state.isOwned ? "Rever venda" : "Rever compra")}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <DisclosurePanel
        title="Mapa de habilidades"
        description="Ver a árvore e as dependências no mapa."
      >
        <section className="panel skill-map-panel">
          <div className="section-heading">
            <h3>{data.map.name}</h3>
            <a
              className="text-link"
              href="#skill-accessible-list"
              onClick={(event) => scrollTo(event, "skill-accessible-list")}
            >
              {t("Ver lista de habilidades")}
            </a>
          </div>
          <p className="form-note">
            {t(
              "Arrasta a área horizontal no ecrã pequeno. A lista abaixo contém os mesmos requisitos e ações.",
            )}
          </p>
          <div
            className="skill-map-scroll"
            tabIndex="0"
            aria-label={t("Árvore de habilidades de " + data.map.name)}
          >
            <div className="skill-map-canvas">
              {data.map.image && (
                <img
                  className="skill-map-image"
                  src={data.map.image}
                  alt={t("Mapa " + data.map.name)}
                />
              )}
              <svg
                className="skill-map-links"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {skills
                  .filter((skill) => skill.requiredPrevSkillId != null)
                  .map((skill) => {
                    const parent = index.byId.get(
                      String(skill.requiredPrevSkillId),
                    );
                    return parent ? (
                      <line
                        key={skill.id}
                        x1={parent.waypointX}
                        y1={parent.waypointY}
                        x2={skill.waypointX}
                        y2={skill.waypointY}
                      />
                    ) : null;
                  })}
              </svg>
              {skills.map((skill) => {
                const state = states.get(String(skill.id));
                return (
                  <a
                    key={skill.id}
                    href={"#skill-node-" + skill.id}
                    onClick={(event) =>
                      scrollTo(event, "skill-node-" + skill.id)
                    }
                    className={
                      "skill-map-node " +
                      (state.isOwned
                        ? "owned"
                        : state.canBuy
                          ? "available"
                          : "locked")
                    }
                    style={{
                      left: position(skill.waypointX),
                      top: position(skill.waypointY),
                    }}
                    title={t(`${skill.name} · ${state.state}`)}
                    aria-label={t(`${skill.name} · ${state.state}`)}
                  >
                    {state.isOwned ? (
                      <Check size={15} />
                    ) : state.canBuy ? (
                      <MapIcon size={15} />
                    ) : (
                      <Lock size={14} />
                    )}
                    <span>{skill.name}</span>
                  </a>
                );
              })}
            </div>
          </div>
        </section>
      </DisclosurePanel>
    </>
  );
}
export default function SkillMapsPage({ model, ui = {}, onUiChange }) {
  const account = useProgressionAccount(model, ui),
    mapName = MAP_NAMES.includes(ui.mapName) ? ui.mapName : MAP_NAMES[0],
    [presetId, setPresetId] = useState(""),
    [reset, setReset] = useState(false),
    [presetOptions, setPresetOptions] = useState([]),
    [catalog, setCatalog] = useState(null),
    [catalogLoading, setCatalogLoading] = useState(false),
    [catalogError, setCatalogError] = useState(''),
    [catalogRevision, setCatalogRevision] = useState(0);
  useEffect(()=>{let live=true;model.bridge.listSkillPresets().then(value=>{if(live&&Array.isArray(value))setPresetOptions(value);}).catch(()=>{});return()=>{live=false;};},[model.bridge]);
  useEffect(()=>{let live=true;setCatalog(null);setCatalogError('');setCatalogLoading(false);if(!account?.id)return;setCatalogLoading(true);model.bridge.listSkillPresets(account.id).then(result=>{if(!live)return;if(result?.accountId!==account.id||!Array.isArray(result.presets))throw Error('A comparação dos presets não está disponível nesta versão.');setCatalog(result);}).catch(error=>{if(live)setCatalogError(String(error.message||error));}).finally(()=>{if(live)setCatalogLoading(false);});return()=>{live=false;};},[account?.id,model.bridge,catalogRevision]);
  const controller = useProgression({
    bridge: model.bridge,
    accountId: account?.id,
    scope: mapName,
    load: async () => {
      return model.bridge.readSkillMap(account.id, mapName);
    },
  });
  useEffect(() => setReset(false), [account?.id, mapName]);
  return (
    <div className="page-stack progression-page">
      <ProgressionHeader
        title="Mapas de habilidades"
        description="Revê compras, vendas e presets com os custos atuais da conta."
        accounts={model.accounts}
        account={account}
        controller={controller}
        onUiChange={onUiChange}
      />
      <WorkspaceTabs
        value={mapName}
        label="Escolher mapa"
        panelId="skill-map-content"
        onChange={(name) => {
          setReset(false);
          onUiChange?.({ mapName: name });
        }}
        items={MAP_NAMES.map((name) => ({
          id: name,
          label: name,
          disabled: controller.pending,
        }))}
      />
      <ProgressionState
        controller={controller}
        account={account}
        model={model}
      />

      <SkillPresetPanel presets={catalog?.presets||presetOptions} selectedId={presetId} onSelect={id=>{setPresetId(id);setReset(false);controller.closePreview();}} reset={reset} onReset={value=>{setReset(value);controller.closePreview();}} onPrepare={controller.prepare} disabled={controller.writeDisabled||!account} loading={catalogLoading} error={catalogError} readAt={catalog?.readAt} onRefresh={()=>setCatalogRevision(n=>n+1)}/>
      {controller.data && (
        <>
          <div
            id="skill-map-content"
            role="tabpanel"
            aria-labelledby={"skill-map-content-" + encodeURIComponent(mapName)}
          >
            <SkillMapContent
              data={controller.data}
              pending={controller.writeDisabled}
              onPrepare={controller.prepare}
            />
          </div>
          <ReadTime value={controller.data.readAt} />
        </>
      )}
      <ProgressionBatchPanel
        model={model}
        accountId={account?.id}
        mode="skills"
        presets={presetOptions}
      />
      {controller.preview && (
        <PreviewDialog
          preview={controller.preview}
          accountLabel={account?.label}
          pending={controller.pending}
          error={controller.error}
          onClose={() => {
            if (!controller.pending) controller.closePreview();
          }}
          onConfirm={controller.confirm}
        />
      )}
    </div>
  );
}
