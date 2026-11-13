import { WorkspaceTabs } from "../components/WorkspaceSection.jsx";
import { t, getLocale } from "../language.js";
import React, { useMemo, useState } from "react";
import ProgressionBatchPanel from "./ProgressionBatchPanel.jsx";
import { Gift, Check } from "lucide-react";
import { displayValue } from "./progressionHelpers.js";
import {
  useProgressionAccount,
  useProgression,
  ProgressionHeader,
  ProgressionState,
  PreviewDialog,
  ReadTime,
} from "./progressionShared.jsx";
const requirementLabels = {
  requiredClicks: "Cliques",
  requiredCasesClicked: "Cliques para caixas",
  requiredMoneyClicked: "Cliques para dinheiro",
  requiredCasesOpened: "Caixas abertas",
  requiredGamesPlayed: "Jogos realizados",
  requiredXp: "Experiência",
  requiredLevel: "Nível",
  requiredRankId: "Rank",
  requiredTradedItems: "Itens trocados",
  requiredCollectedVault: "Recolhas do cofre",
  requiredCases: "Caixas",
  requiredOpenedCases: "Caixas abertas",
  requiredInventoryValue: "Valor do inventário",
  requiredBlackjacks: "Blackjacks",
};
export function RewardsContent({ data, pending, onPrepare }) {
  return (
    <div className="progression-card-grid">
      {data.tracks?.length ? (
        [...data.tracks]
          .sort(
            (a, b) =>
              (a.complete ? 2 : a.eligible ? 0 : 1) -
              (b.complete ? 2 : b.eligible ? 0 : 1),
          )
          .map((track) => {
            const current = Number(track.current),
              target = Number(track.target),
              ratio =
                Number.isFinite(current) && target > 0
                  ? Math.max(0, Math.min(100, (current / target) * 100))
                  : Number(track.progress) || 0;
            return (
              <article
                className="panel reward-card"
                key={track.key}
                data-reward-id={track.id}
              >
                <div className="section-heading">
                  <Gift size={19} />
                  <span
                    className={"status-tag" + (track.eligible ? " good" : "")}
                  >
                    {t(
                      track.complete
                        ? "Concluída"
                        : track.eligible
                          ? "Disponível"
                          : "Em progresso",
                    )}
                  </span>
                </div>
                <h3>{t(track.title)}</h3>
                <p>
                  {t(track.description || "Efeito não indicado pelo servidor.")}
                </p>
                <p className="muted">
                  {t(
                    Array.isArray(track.requirement)
                      ? track.requirement
                          .map(
                            (item) =>
                              `${t(item.label || requirementLabels[item.field]) || "Objetivo indicado pelo servidor"}: ${displayValue(item.target)}`,
                          )
                          .join(" · ")
                      : track.requirement || "Objetivo indicado pelo servidor",
                  )}
                </p>
                {track.current != null && track.target > 0 && (
                  <progress
                    max="100"
                    value={ratio}
                    aria-label={t("Progresso de " + t(track.title))}
                  />
                )}
                {!track.complete && (
                  <p className="reward-count">
                    {t(displayValue(track.current))} /{" "}
                    {t(displayValue(track.target))}
                  </p>
                )}
                <button
                  className="secondary-button"
                  type="button"
                  disabled={pending || track.eligible !== true}
                  onClick={() => onPrepare("reward", { id: track.id })}
                >
                  {t("Rever recompensa")}
                </button>
              </article>
            );
          })
      ) : (
        <section className="panel empty-state">
          <Check size={26} />
          <h3>{t("Sem próximas recompensas")}</h3>
          <p>
            {t("O servidor não indicou recompensas pendentes para esta conta.")}
          </p>
        </section>
      )}
    </div>
  );
}
const futureDate = (value) =>
  Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
export function missionCanClaim(mission) {
  return (
    mission.eligible === true &&
    !mission.redeemed &&
    typeof mission.current === "number" &&
    typeof mission.target === "number" &&
    mission.target > 0 &&
    mission.current >= mission.target &&
    futureDate(mission.validTill) &&
    ["day", "week"].includes(mission.duration)
  );
}
export function MissionsContent({ data, pending = false, onPrepare }) {
  return (
    <div className="progression-card-grid">
      {data.missions?.length ? (
        data.missions.map((mission) => {
          const ready = missionCanClaim(mission),
            points =
              mission.duration === "week"
                ? 25
                : mission.duration === "day"
                  ? 10
                  : null;
          return (
            <article
              className="panel reward-card mission-card"
              key={mission.id}
            >
              <div className="section-heading">
                <span
                  className={
                    "status-tag" + (mission.redeemed || ready ? " good" : "")
                  }
                >
                  {t(
                    mission.redeemed
                      ? "Recolhida"
                      : ready
                        ? "Disponível"
                        : "Em progresso",
                  )}
                </span>
                <span className="muted">
                  {t(
                    mission.duration === "week"
                      ? "Semanal"
                      : mission.duration === "day"
                        ? "Diária"
                        : "Missão",
                  )}
                </span>
              </div>
              <h3>{t(mission.title || mission.goal || "Missão")}</h3>
              <p>{t(mission.description)}</p>
              {mission.current != null && mission.target > 0 && (
                <progress
                  max="100"
                  value={Math.min(
                    100,
                    (mission.current / mission.target) * 100,
                  )}
                  aria-label={t("Progresso de " + mission.title)}
                />
              )}
              <p>
                {displayValue(mission.current ?? mission.currentAmount)}
                {(mission.target ?? mission.targetAmount) != null
                  ? " / " + displayValue(mission.target ?? mission.targetAmount)
                  : ""}
              </p>
              {points !== null && (
                <p className="form-note">
                  {t(String(points) + " pontos no passe mensal")}
                </p>
              )}
              {mission.validTill && (
                <p className="form-note">
                  {t("Até ")}
                  {new Date(mission.validTill).toLocaleString(getLocale())}
                </p>
              )}
              {!mission.redeemed && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pending || !ready || !onPrepare}
                  onClick={() => onPrepare("mission", { id: mission.id })}
                >
                  {t("Rever missão")}
                </button>
              )}
            </article>
          );
        })
      ) : (
        <section className="panel empty-state">
          <h3>{t("Sem missões indicadas")}</h3>
        </section>
      )}
    </div>
  );
}
const passReward = (reward, effects) =>
  effects?.length
    ? effects
        .map(
          (effect) =>
            `${effect.description || "Efeito desconhecido"}: ${displayValue(effect.amount)}`,
        )
        .join(" · ")
    : reward || "Sem recompensa indicada";
export function MonthlyPassContent({ pass, pending = false, onPrepare }) {
  const labels = {
    period: "Período",
    endsAt: "Termina em",
    points: "Pontos",
    tier: "Escalão",
    pointsToNextTier: "Pontos até ao próximo escalão",
    totalTiers: "Total de escalões",
    isPremium: "Premium",
  };
  const entries = pass
    ? Object.entries(pass).filter(([key]) => labels[key])
    : [];
  const tierSets = useMemo(
    () => ({
      free: {
        claimed: new Set(pass?.claimedFreeTiers || []),
        available: new Set(pass?.claimableFreeTiers || []),
      },
      premium: {
        claimed: new Set(pass?.claimedPremiumTiers || []),
        available: new Set(pass?.claimablePremiumTiers || []),
      },
    }),
    [pass],
  );
  const reward = (item, track) => {
    const premium = track === "premium",
      { claimed, available } = tierSets[track];
    const code = item[premium ? "premiumReward" : "freeReward"],
      effects = item[premium ? "premiumEffects" : "freeEffects"];
    const collected = claimed.has(item.tier),
      entitled = !premium || pass.isPremium === true;
    const ready =
      !!code &&
      !collected &&
      entitled &&
      available.has(item.tier) &&
      futureDate(pass.endsAt);
    const state = !code
      ? "Sem recompensa"
      : collected
        ? "Recolhido"
        : !entitled
          ? "Premium não ativo"
          : ready
            ? "Disponível"
            : "Em progresso";
    return (
      <div className="pass-reward">
        <strong>{t(premium ? "Premium" : "Gratuito")}</strong>
        <p>{t(passReward(code, effects))}</p>
        <small className={ready || collected ? "good" : ""}>{t(state)}</small>
        {!!code && !collected && (
          <button
            type="button"
            className="secondary-button"
            disabled={pending || !ready || !onPrepare}
            onClick={() => onPrepare("pass", { tier: item.tier, track })}
          >
            {t("Rever recolha")}
          </button>
        )}
      </div>
    );
  };
  return (
    <section className="panel">
      <h3>{t("Passe mensal")}</h3>
      {entries.length ? (
        <dl className="progression-totals">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{t(labels[key])}</dt>
              <dd>
                {t(
                  key === "endsAt"
                    ? new Date(value).toLocaleString(getLocale())
                    : displayValue(value),
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">
          {t("O servidor não indicou dados do passe mensal.")}
        </p>
      )}
      {pass?.track?.length > 0 && (
        <ul
          className="pass-tier-list"
          aria-label={t("Recompensas do passe por escalão")}
        >
          {pass.track.map((item) => (
            <li key={item.tier}>
              <strong>
                {t("Escalão ")}
                {item.tier}
              </strong>
              {reward(item, "free")}
              {reward(item, "premium")}
            </li>
          ))}
        </ul>
      )}
      <p className="form-note">
        {t(
          "Revê a recompensa e a faixa antes de confirmar. A disponibilidade volta a ser verificada na conta selecionada.",
        )}
      </p>
    </section>
  );
}
export default function RewardsPage({ model, ui = {}, onUiChange }) {
  const [claimingAll, setClaimingAll] = useState(false);
  const account = useProgressionAccount(model, ui),
    tab = ["rewards", "missions", "pass"].includes(ui.tab) ? ui.tab : "rewards";
  const controller = useProgression({
    bridge: model.bridge,
    accountId: account?.id,
    scope: tab,
    load: () =>
      tab === "rewards"
        ? model.bridge.readRewards(account.id)
        : model.bridge.readMissions(account.id),
  });
  return (
    <div className="page-stack progression-page">
      <ProgressionHeader
        title="Recompensas"
        description="Consulta requisitos, progresso e efeitos antes de recolher uma recompensa."
        accounts={model.accounts}
        account={account}
        controller={controller}
        onUiChange={onUiChange}
      />
      <WorkspaceTabs
        value={tab}
        label="Recompensas e missões"
        panelId="reward-tab-content"
        onChange={(tab) => onUiChange?.({ tab })}
        items={[
          ["rewards", "Próximas recompensas"],
          ["missions", "Missões"],
          ["pass", "Passe mensal"],
        ].map(([id, label]) => ({
          id,
          label,
          disabled: controller.pending || claimingAll,
        }))}
      />
      <ProgressionState
        controller={controller}
        account={account}
        model={model}
      />

      <div id="reward-tab-content" role="tabpanel">
        {controller.data &&
          (tab === "rewards" ? (
            <RewardsContent
              data={controller.data}
              pending={controller.writeDisabled || claimingAll}
              onPrepare={controller.prepare}
            />
          ) : tab === "missions" ? (
            <MissionsContent
              data={controller.data}
              pending={controller.writeDisabled || claimingAll}
              onPrepare={controller.prepare}
            />
          ) : (
            <MonthlyPassContent
              pass={controller.data.pass}
              pending={controller.writeDisabled || claimingAll}
              onPrepare={controller.prepare}
            />
          ))}
        {controller.data && <ReadTime value={controller.data.readAt} />}
      </div>
      <ProgressionBatchPanel
        model={model}
        accountId={account?.id}
        disabled={controller.writeDisabled}
        onBusyChange={setClaimingAll}
        onComplete={controller.refresh}
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
