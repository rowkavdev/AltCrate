import { t } from "../language.js";
import React, { useMemo, useState } from "react";
import { Heart, Coins, SlidersHorizontal } from "lucide-react";
import { displayValue, AUTOOPEN_LABELS } from "./progressionHelpers.js";
import {
  useProgressionAccount,
  useProgression,
  ProgressionHeader,
  ProgressionState,
  PreviewDialog,
  ReadTime,
} from "./progressionShared.jsx";
export const AUTOOPEN_BOOLEANS = [
  ["favoriteLowFloats", "Marcar floats baixos como favoritos"],
  ["favoriteHighFloats", "Marcar floats altos como favoritos"],
  ["favoriteCustomFloats", "Marcar floats personalizados como favoritos"],
  ["favoritePatterns", "Marcar padrões como favoritos"],
  ["autosellActivated", "Ativar venda automática no site"],
];
const editDraft = (data) => ({
  ...data.config,
  activePresetId: data.activePresetId ?? "",
  customSelectedFloats: (data.config.customSelectedFloats || []).join(", "),
  patternBlacklist: (data.config.patternBlacklist || []).join("\n"),
});
export function parseAutoOpenDraft(draft) {
  const config = {};
  for (const [key] of AUTOOPEN_BOOLEANS) {
    if (typeof draft[key] !== "boolean")
      throw new Error("Atualiza a configuração antes de a rever.");
    config[key] = draft[key];
  }
  for (const key of ["autosellAmount", "customLowFloat", "customHighFloat"]) {
    if (
      draft[key] === "" ||
      draft[key] == null ||
      !Number.isFinite(Number(draft[key])) ||
      Number(draft[key]) < 0
    )
      throw new Error(
        "Preenche os valores numéricos com valores não negativos.",
      );
    config[key] = Number(draft[key]);
  }
  if (
    config.customLowFloat > 1 ||
    config.customHighFloat > 1 ||
    config.customLowFloat > config.customHighFloat
  )
    throw new Error(
      "O intervalo de floats deve estar entre 0 e 1, com o mínimo abaixo do máximo.",
    );
  if (!["money", "tokens"].includes(draft.autosellVariant))
    throw new Error("Escolhe a moeda da venda automática.");
  config.autosellVariant = draft.autosellVariant;
  const tokens = String(draft.customSelectedFloats || "")
    .split(/[\s,;]+/)
    .filter(Boolean);
  config.customSelectedFloats = tokens.map(Number);
  if (
    config.customSelectedFloats.some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1,
    )
  )
    throw new Error("Cada float personalizado deve ser um número entre 0 e 1.");
  config.patternBlacklist = String(draft.patternBlacklist || "")
    .split(/[\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    config.customSelectedFloats.length > 500 ||
    config.patternBlacklist.length > 500
  )
    throw new Error("As listas podem conter no máximo 500 entradas.");
  return { config, activePresetId: draft.activePresetId || null };
}
function OpeningChoice({ label, description, checked, pending, onChange }) {
  return (
    <label className="opening-preference-choice">
      <span>
        <strong>{t(label)}</strong>
        {description && <small>{t(description)}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked === true}
        disabled={pending}
        onChange={onChange}
      />
    </label>
  );
}
export function AutoOpenFields({ draft, pending, onChange, presets = [] }) {
  return (
    <div className="opening-preference-sections">
      <section className="opening-preference-group opening-preference-preset">
        <div>
          <h3>
            <SlidersHorizontal size={18} />
            {t("Preset guardado")}
          </h3>
          <p>
            {t(
              "Carrega uma seleção do jogo e revê os valores antes de guardar.",
            )}
          </p>
        </div>
        <label>
          {t("Preset do jogo")}
          <select
            value={draft.activePresetId || ""}
            disabled={pending}
            onChange={(e) => {
              const selected = presets.find(
                (preset) => preset.id === e.target.value,
              );
              onChange(
                selected
                  ? editDraft({
                      config: selected.config,
                      activePresetId: selected.id,
                    })
                  : { activePresetId: "" },
              );
            }}
          >
            <option value="">{t("Personalizado")}</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="opening-preference-group">
        <h3>
          <Heart size={18} />
          {t("Favoritos")}
        </h3>
        <p>
          {t(
            "Escolhe os itens que queres marcar automaticamente como favoritos.",
          )}
        </p>
        <div className="opening-preference-choices">
          {AUTOOPEN_BOOLEANS.filter(([key]) => key !== "autosellActivated").map(
            ([key, label]) => (
              <OpeningChoice
                key={key}
                label={label}
                checked={draft[key]}
                pending={pending}
                onChange={(e) => onChange({ [key]: e.target.checked })}
              />
            ),
          )}
        </div>
        <details
          className="preference-more"
          open={draft.favoriteCustomFloats || undefined}
        >
          <summary>{t("Floats personalizados")}</summary>
          <fieldset
            className="opening-preference-custom"
            disabled={pending || !draft.favoriteCustomFloats}
          >
            <legend>{t("Floats personalizados")}</legend>
            <div className="autoopen-fields">
              <label>
                {t("Float personalizado mínimo")}
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="any"
                  value={draft.customLowFloat ?? ""}
                  onChange={(e) => onChange({ customLowFloat: e.target.value })}
                />
              </label>
              <label>
                {t("Float personalizado máximo")}
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="any"
                  value={draft.customHighFloat ?? ""}
                  onChange={(e) =>
                    onChange({ customHighFloat: e.target.value })
                  }
                />
              </label>
              <label className="opening-preference-wide">
                {t("Floats exatos")}
                <textarea
                  value={draft.customSelectedFloats ?? ""}
                  onChange={(e) =>
                    onChange({ customSelectedFloats: e.target.value })
                  }
                  placeholder="0.01, 0.25, 0.99"
                />
                <small>
                  {t(
                    "Entre 0 e 1, separados por vírgula ou espaço. Usa ponto decimal.",
                  )}
                </small>
              </label>
            </div>
          </fieldset>
        </details>
        <label className="opening-preference-patterns">
          {t("Padrões excluídos")}
          <textarea
            value={draft.patternBlacklist ?? ""}
            disabled={pending || !draft.favoritePatterns}
            onChange={(e) => onChange({ patternBlacklist: e.target.value })}
            placeholder={t("Um padrão por linha")}
          />
          <small>
            {t(
              "Usa os nomes dos padrões do jogo, separados por linha ou vírgula.",
            )}
          </small>
        </label>
      </section>
      <section className="opening-preference-group">
        <h3>
          <Coins size={18} />
          {t("Venda automática")}
        </h3>
        <p>
          {t("Define o limite de venda e o que queres receber pelos itens.")}
        </p>
        <OpeningChoice
          label="Ativar venda automática"
          checked={draft.autosellActivated}
          pending={pending}
          onChange={(e) => onChange({ autosellActivated: e.target.checked })}
        />
        <fieldset
          className="opening-preference-custom"
          disabled={pending || !draft.autosellActivated}
        >
          <div className="autoopen-fields">
            <label>
              {t("Vender itens abaixo de")}
              <input
                type="number"
                min="0"
                step="any"
                value={draft.autosellAmount ?? ""}
                onChange={(e) => onChange({ autosellAmount: e.target.value })}
              />
              <small>
                {t("Limite usado pelo jogo para a venda automática.")}
              </small>
            </label>
            <label>
              {t("Receber venda em")}
              <select
                value={draft.autosellVariant || ""}
                onChange={(e) => onChange({ autosellVariant: e.target.value })}
              >
                <option value="">{t("Escolher…")}</option>
                <option value="money">{t("Dinheiro virtual")}</option>
                <option value="tokens">{t("Tokens")}</option>
              </select>
            </label>
          </div>
        </fieldset>
      </section>
    </div>
  );
}
export default function SiteAutoOpenPage({ model, ui = {}, onUiChange }) {
  const account = useProgressionAccount(model, ui),
    controller = useProgression({
      bridge: model.bridge,
      accountId: account?.id,
      scope: "autoopen",
      load: () => model.bridge.readAutoOpen(account.id),
    }),
    [edit, setEdit] = useState(null),
    [validation, setValidation] = useState("");
  const data = controller.data,
    draft = useMemo(
      () => (edit?.data === data ? edit.draft : data ? editDraft(data) : null),
      [edit, data],
    );
  const change = (patch) => {
    setValidation("");
    controller.closePreview();
    setEdit({ data, draft: { ...draft, ...patch } });
  };
  const prepare = () => {
    try {
      setValidation("");
      controller.prepare("autoopen", parseAutoOpenDraft(draft));
    } catch (e) {
      setValidation(e.message);
    }
  };
  return (
    <div className="page-stack progression-page">
      <ProgressionHeader
        title="Preferências de abertura"
        description="Favoritos, venda automática e presets das aberturas no jogo."
        accounts={model.accounts}
        account={account}
        controller={controller}
        onUiChange={onUiChange}
      />
      <section className="opening-preference-intro">
        <p>
          {t(
            "Estas preferências ficam guardadas no jogo. Para iniciar uma abertura na AltCrate, usa ",
          )}
          <a href="#opening">{t("Abertura")}</a>
          {t(". Aqui, revês o que será guardado antes de confirmar.")}
        </p>
      </section>
      <ProgressionState
        controller={controller}
        account={account}
        model={model}
      />
      {draft && (
        <section className="panel progression-autoopen">
          <div className="section-heading">
            <h3>{t("Preferências da conta")}</h3>
            <span className="status-tag">{t("Revisão antes de guardar")}</span>
          </div>
          <footer className="opening-preference-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={controller.pending}
              onClick={() => {
                setEdit(null);
                setValidation("");
                controller.closePreview();
              }}
            >
              {t("Desfazer alterações")}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={controller.writeDisabled}
              onClick={prepare}
            >
              {t("Rever alterações")}
            </button>
          </footer>
          <AutoOpenFields
            draft={draft}
            presets={data.presets}
            pending={controller.writeDisabled}
            onChange={change}
          />
          {validation && (
            <p role="alert" className="inline-error">
              {t(validation)}
            </p>
          )}

          <details>
            <summary>{t("Valores atualmente guardados no jogo")}</summary>
            <dl className="autoopen-observed">
              {Object.entries(data.config).map(([key, value]) => (
                <div key={key}>
                  <dt>{t(AUTOOPEN_LABELS[key] || "Configuração do site")}</dt>
                  <dd>{t(displayValue(value))}</dd>
                </div>
              ))}
            </dl>
          </details>
          <ReadTime value={data.readAt} />
        </section>
      )}
      {controller.preview && (
        <PreviewDialog
          preview={{
            ...controller.preview,
            changes: controller.preview.changes?.map((change) =>
              change.field === "activePresetId"
                ? {
                    ...change,
                    before: change.before
                      ? data.presets.find((item) => item.id === change.before)
                          ?.name || "Preset guardado no site"
                      : "Sem preset",
                    after: change.after
                      ? data.presets.find((item) => item.id === change.after)
                          ?.name || "Preset guardado no site"
                      : "Sem preset",
                  }
                : change,
            ),
          }}
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
