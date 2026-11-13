import { t } from "../language.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
  Search,
  Swords,
  Wallet,
} from "lucide-react";
import OrderedOpeningRules from "./OrderedOpeningRules.jsx";
import { loadStorageDestinations } from "../storageDestinationPicker.js";

export default function OpeningItemRules({
  items,
  rules,
  onChange,
  onRulesChange,
  accounts,
  bridge,
  disabled,
  Artwork,
}) {
  const [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState(() => new Set()),
    [picker, setPicker] = useState(null),
    [storageSearch, setStorageSearch] = useState(""),
    [destinations, setDestinations] = useState(null),
    [error, setError] = useState("");
  const abort = useRef(null);
  useEffect(() => () => abort.current?.abort(), []);
  const skins = useMemo(
    () =>
      items
        .flatMap((item) =>
          item.specialItems?.length
            ? item.specialItems
            : item.specialCount
              ? []
              : [item],
        )
        .filter((item) => item?.name),
    [items],
  );
  const specialGroups = items.filter(
    (item) => item.specialItems?.length || item.specialCount,
  );
  const ordinaryItems = items.filter(
    (item) => !item.specialItems?.length && !item.specialCount,
  );
  const orderedRules = Array.isArray(rules)
    ? rules
    : Object.entries(rules || {}).map(([name, rule]) => ({ name, ...rule }));
  const generalRules = Object.fromEntries(
    orderedRules
      .filter(
        (rule) => !rule.conditions || !Object.keys(rule.conditions).length,
      )
      .map((rule) => [rule.name, rule]),
  );
  function changeGeneral(name, rule) {
    if (!onRulesChange) {
      onChange?.(name, rule);
      return;
    }
    const index = orderedRules.findIndex(
      (value) =>
        value.name === name &&
        (!value.conditions || !Object.keys(value.conditions).length),
    );
    const next = orderedRules.filter((_, i) => i !== index);
    if (rule) {
      if (index < 0) next.push({ name, ...rule });
      else next.splice(index, 0, { ...orderedRules[index], name, ...rule });
    }
    onRulesChange(next);
  }
  const selected = skins.map(
    (item) => generalRules[item.name]?.action || "keep",
  );
  const counts = {
    sell: selected.filter((action) => action === "sell").length,
    storage: selected.filter((action) => action === "storage").length,
    keep: selected.filter((action) => action === "keep").length,
  };
  const needle = query.trim().toLocaleLowerCase("pt-PT");
  async function chooseStorage(item) {
    if (disabled) return;
    setPicker(item);
    setStorageSearch("");
    setError("");
    if (destinations?.entries?.length) return;
    if (!bridge?.listStorageUnits) {
      setError(
        "A escolha de storages não está disponível nesta versão da app.",
      );
      return;
    }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setDestinations({
      entries: [],
      loaded: 0,
      total: accounts.length,
      loading: true,
      errors: [],
    });
    try {
      const value = await loadStorageDestinations(
        accounts,
        (id) => bridge.listStorageUnits(id),
        {
          signal: controller.signal,
          cooldown: bridge.storageCooldown
            ? () => bridge.storageCooldown()
            : undefined,
          onUpdate: (value) => {
            if (!controller.signal.aborted) setDestinations(value);
          },
        },
      );
      if (!controller.signal.aborted) setDestinations(value);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(String(failure.message || failure));
    }
  }
  function ruleCard(item, index, special = false) {
    const current = generalRules[item.name] || { action: "keep" };
    return (
      <article
        className="opening-rule-card"
        key={item.name + "-" + index}
        style={{
          "--item-color":
            item.rarityColor || (special ? "#e6ad42" : "var(--cp-border)"),
        }}
      >
        {special && !item.image ? (
          <span className="case-art opening-knife-art">
            <Swords size={27} aria-hidden="true" />
          </span>
        ) : (
          <Artwork src={item.image} name={item.name} />
        )}
        <div className="opening-rule-copy">
          <strong>{item.name}</strong>
          <small>
            {t(special ? "Faca ou item especial" : item.rarity || "Skin")}
          </small>
          {current.action === "storage" && (
            <span className="opening-rule-destination">
              <Archive size={13} />
              {t(
                current.accountLabel ||
                  accounts.find(
                    (account) => account.id === current.destinationAccountId,
                  )?.label ||
                  "Conta",
              )}{" "}
              · {t(current.storageName || "Storage")}
            </span>
          )}
        </div>
        <div
          className="opening-rule-actions"
          role="group"
          aria-label={t("Destino de " + item.name)}
        >
          <button
            type="button"
            aria-pressed={current.action === "keep"}
            disabled={disabled}
            onClick={() => changeGeneral(item.name, null)}
          >
            {t("Inventário")}
          </button>
          <button
            type="button"
            aria-pressed={current.action === "sell"}
            disabled={disabled}
            onClick={() => changeGeneral(item.name, { action: "sell" })}
          >
            <Wallet size={13} />
            {t("Vender")}
          </button>
          <button
            type="button"
            aria-pressed={current.action === "storage"}
            disabled={disabled}
            onClick={() => chooseStorage(item)}
          >
            <Archive size={13} />
            {t("Storage")}
          </button>
        </div>
      </article>
    );
  }
  const available = (destinations?.entries || []).filter((entry) =>
    (entry.accountLabel + " " + entry.storageName)
      .toLocaleLowerCase("pt-PT")
      .includes(storageSearch.toLocaleLowerCase("pt-PT")),
  );
  return (
    <div className="opening-rules">
      <div className="opening-rules-intro">
        <p>
          {t(
            "Escolhe o destino geral de cada skin quando sair desta caixa. Podes definir variantes por atributos nas regras locais ordenadas. Sem escolha, fica no inventário.",
          )}
        </p>
        <div className="opening-rules-counts">
          <span>
            <Check size={14} />
            {t(counts.keep)}
            {t(" no inventário")}
          </span>
          <span>
            <Wallet size={14} />
            {t(counts.sell)}
            {t(" para vender")}
          </span>
          <span>
            <Archive size={14} />
            {t(counts.storage)}
            {t(" para storage")}
          </span>
        </div>
      </div>
      <label className="opening-rules-search">
        <Search size={16} />
        <input
          type="search"
          aria-label={t("Pesquisar skins da caixa")}
          placeholder={t("Pesquisar skin…")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {picker && (
        <div className="opening-storage-choice">
          <div className="opening-storage-choice-heading">
            <div>
              <strong>
                {t("Storage para ")}
                {picker.name}
              </strong>
              <small>{t("Escolhe qualquer storage das contas ligadas.")}</small>
            </div>
            <button type="button" onClick={() => setPicker(null)}>
              {t("Fechar")}
            </button>
          </div>
          <input
            aria-label={t("Pesquisar storage para esta skin")}
            placeholder={t("Pesquisar conta ou storage…")}
            value={storageSearch}
            onChange={(event) => setStorageSearch(event.target.value)}
          />
          <small role="status">
            {t(destinations?.loaded || 0)}
            {t(" de ")}
            {t(accounts.length)}
            {t(" contas consultadas")}
            {t(destinations?.loading ? " · a carregar…" : "")}
          </small>
          <div className="opening-storage-options">
            {available.map((entry) => (
              <button
                key={entry.accountId + ":" + entry.storageId}
                type="button"
                onClick={() => {
                  const chosen = {
                    action: "storage",
                    destinationAccountId: entry.accountId,
                    storageUnitId: entry.storageId,
                    accountLabel: entry.accountLabel,
                    storageName: entry.storageName,
                  };
                  if (picker.ruleIndex !== undefined && onRulesChange)
                    onRulesChange(
                      orderedRules.map((rule, index) =>
                        index === picker.ruleIndex
                          ? { ...rule, ...chosen }
                          : rule,
                      ),
                    );
                  else changeGeneral(picker.name, chosen);
                  setPicker(null);
                }}
              >
                <Archive size={16} />
                <span>
                  <strong>{t(entry.storageName)}</strong>
                  <small>
                    {t(entry.accountLabel)} · {t(entry.count)}
                    {t(" itens")}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {!destinations?.loading && !available.length && (
            <small>{t("Nenhum storage encontrado.")}</small>
          )}
          {destinations?.errors?.length > 0 && (
            <small className="inline-error">
              {t("Não foi possível consultar ")}
              {t(destinations.errors.length)}
              {t(" conta(s).")}
            </small>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {t(error)}
            </p>
          )}
        </div>
      )}
      {onRulesChange && (
        <details
          className="ordered-rules-disclosure"
          open={
            orderedRules.some(
              (rule) => Object.keys(rule.conditions || {}).length > 0,
            ) || undefined
          }
        >
          <summary>
            {t("Regras por atributos")} · {orderedRules.length}
          </summary>
          <OrderedOpeningRules
            rules={orderedRules}
            skins={skins}
            onChange={onRulesChange}
            onChooseStorage={chooseStorage}
            accounts={accounts}
            disabled={disabled}
          />
        </details>
      )}
      {specialGroups.map((item, index) => {
        const specials = item.specialItems || [];
        if (!specials.length)
          return (
            <div
              className="opening-special-unavailable"
              key={item.name + "-" + index}
            >
              <Artwork src={item.image} name={item.name} />
              <span>
                <strong>{t("Facas e itens especiais")}</strong>
                <small>
                  {t("As ")}
                  {t(item.specialCount)}
                  {t(
                    " opções não vieram identificadas no catálogo. Ficam no inventário.",
                  )}
                </small>
              </span>
            </div>
          );
        const open = expanded.has(item.name) || !!needle,
          visible = specials.filter(
            (special) =>
              !needle ||
              special.name.toLocaleLowerCase("pt-PT").includes(needle),
          );
        if (needle && !visible.length) return null;
        return (
          <section
            className="opening-special-group"
            key={item.name + "-" + index}
          >
            <button
              type="button"
              className="opening-special-toggle"
              aria-expanded={open}
              onClick={() =>
                setExpanded((old) => {
                  const next = new Set(old);
                  next.has(item.name)
                    ? next.delete(item.name)
                    : next.add(item.name);
                  return next;
                })
              }
            >
              <Artwork src={item.image} name={item.name} />
              <span>
                <strong>{t("Facas e itens especiais")}</strong>
                <small>
                  {t(specials.length)}
                  {t(" opções nesta caixa · escolhe cada faca separadamente")}
                </small>
              </span>
              {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {
              <div className="opening-special-grid" hidden={!open}>
                {t(
                  visible.map((special, index) =>
                    ruleCard(special, index, true),
                  ),
                )}
              </div>
            }
          </section>
        );
      })}
      <div className="opening-rule-grid">
        {t(
          ordinaryItems
            .filter(
              (item) =>
                !needle ||
                item.name.toLocaleLowerCase("pt-PT").includes(needle),
            )
            .map((item, index) => ruleCard(item, index)),
        )}
      </div>
    </div>
  );
}
