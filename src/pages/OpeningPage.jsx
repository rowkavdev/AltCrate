import { DisclosurePanel } from "../components/WorkspaceSection.jsx";
import { t } from "../language.js";
import React, { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Clock3,
  Search,
  Square,
  PackageOpen,
  RefreshCw,
} from "lucide-react";
import AccountSelection from "../components/AccountSelection.jsx";
import EventRow from "../components/EventRow.jsx";
import OpeningItemRules from "./OpeningItemRules.jsx";
import { formatNumber } from "../format.js";
import "./opening.css";
import { accountIndex, selectedCaseTotals } from "../workspaceViewModel.js";

function Artwork({ src, name, className = "" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={`case-art ${className}`}>
      {src && !failed ? (
        <img
          src={src}
          alt={t(name)}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Boxes size={34} aria-hidden="true" />
      )}
    </span>
  );
}

export default function OpeningPage({ model }) {
  const {
    form,
    opening,
    accounts,
    selectedIds,
    caseChoices,
    actions,
    snapshots,
    bridge,
  } = model;
  const [catalog, setCatalog] = useState([]),
    [catalogError, setCatalogError] = useState(""),
    [catalogLoading, setCatalogLoading] = useState(true);
  const [detail, setDetail] = useState(null),
    [detailError, setDetailError] = useState(""),
    [detailLoading, setDetailLoading] = useState(false);
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("quantity"),
    [retry, setRetry] = useState(0);
  const [rulesByCase, setRulesByCase] = useState(() => {
    try {
      return (
        JSON.parse(
          localStorage.getItem("casepilot:opening-rules-v1") || "{}",
        ) || {}
      );
    } catch {
      return {};
    }
  });
  const currentRules = rulesByCase[form.caseId] || {};
  const itemRules = Array.isArray(currentRules)
    ? currentRules
    : Object.entries(currentRules)
        .map(([name, rule]) => ({ name, ...rule }))
        .filter((rule) => ["keep", "sell", "storage"].includes(rule.action));
  function persistRules(next) {
    setRulesByCase(next);
    model.setProfileRules?.(next);
    try {
      localStorage.setItem("casepilot:opening-rules-v1", JSON.stringify(next));
    } catch {
      model.setNotice?.(
        "Não foi possível guardar as regras neste dispositivo.",
      );
    }
  }
  function updateRule(name, rule) {
    const entries = Array.isArray(currentRules)
      ? Object.fromEntries(currentRules.map((r) => [r.name, r]))
      : { ...currentRules };
    if (rule) entries[name] = rule;
    else delete entries[name];
    persistRules({ ...rulesByCase, [form.caseId]: entries });
    if (rule?.action && form.convert) model.setForm({ convert: false });
  }
  function updateOrderedRules(nextRules) {
    persistRules({ ...rulesByCase, [form.caseId]: nextRules });
    if (nextRules.length && form.convert) model.setForm({ convert: false });
  }
  useEffect(() => {
    const config = model.loadedOperationProfile?.config;
    if (!config?.itemRules) return;
    const id = config.targetCase || form.caseId;
    setRulesByCase((old) => {
      const next = { ...old, [id]: config.itemRules };
      try {
        localStorage.setItem(
          "casepilot:opening-rules-v1",
          JSON.stringify(next),
        );
      } catch {}
      return next;
    });
  }, [model.loadedOperationProfile?.loadedAt]);
  const validPrice =
    form.maxPrice !== "" &&
    Number.isFinite(Number(form.maxPrice)) &&
    Number(form.maxPrice) >= 0 &&
    Number(form.maxPrice) <= 1000;
  const validCase =
    caseChoices.some((item) => item.id === form.caseId) &&
    selectedIds.length > 0;
  const running = ["running", "stopping"].includes(opening.phase);
  const disabled =
    !bridge ||
    model.busy ||
    !validCase ||
    (form.convert && !validPrice) ||
    (itemRules.length > 0 && !detail);
  const results = useMemo(
    () =>
      (model.events || []).filter((event) =>
        [
          "open",
          "conversion",
          "opening-item",
          "open-started",
          "open-finished",
          "account-error",
        ].includes(event.type),
      ),
    [model.events],
  );
  const accountsById = useMemo(() => accountIndex(accounts), [accounts]);
  const quantities = useMemo(
    () => selectedCaseTotals(selectedIds, snapshots),
    [selectedIds, snapshots],
  );
  const catalogById = useMemo(
    () => new Map(catalog.map((item) => [item.id, item])),
    [catalog],
  );
  const selectedCase = caseChoices.find((item) => item.id === form.caseId);
  const selectedMeta = catalogById.get(form.caseId);
  const selectedName = selectedMeta?.name || selectedCase?.name;
  const quantity = (id) => quantities.get(id) || 0;
  const boxList = useMemo(
    () =>
      caseChoices
        .map((item) => ({
          ...item,
          total: quantity(item.id),
          meta: catalogById.get(item.id),
          displayName: catalogById.get(item.id)?.name || item.name,
        }))
        .filter((item) =>
          item.displayName
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.displayName.localeCompare(b.displayName, "pt")
            : b.total - a.total ||
              a.displayName.localeCompare(b.displayName, "pt"),
        ),
    [caseChoices, quantities, catalogById, query, sort],
  );

  useEffect(() => {
    if (
      !running &&
      !catalogLoading &&
      caseChoices.length &&
      !caseChoices.some((item) => item.id === form.caseId)
    )
      model.setForm({
        caseId:
          caseChoices.find((item) => catalogById.has(item.id))?.id ||
          caseChoices[0].id,
      });
  }, [running, catalogLoading, form.caseId, caseChoices, catalogById]);

  useEffect(() => {
    if (!bridge?.listCaseShowcase || !accounts.length) {
      setCatalogLoading(false);
      return;
    }
    let live = true;
    setCatalogLoading(true);
    setCatalogError("");
    bridge
      .listCaseShowcase()
      .then((items) => {
        if (live) setCatalog(items);
      })
      .catch((error) => {
        if (live) setCatalogError(error.message || "Imagens indisponíveis");
      })
      .finally(() => {
        if (live) setCatalogLoading(false);
      });
    return () => {
      live = false;
    };
  }, [bridge, accounts.length, retry]);

  useEffect(() => {
    if (!bridge?.caseDetails || !selectedCase) {
      setDetail(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }
    let live = true;
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    bridge
      .caseDetails(selectedCase.id)
      .then((value) => {
        if (live) setDetail(value);
      })
      .catch((error) => {
        if (live) setDetailError(error.message || "Conteúdo indisponível");
      })
      .finally(() => {
        if (live) setDetailLoading(false);
      });
    return () => {
      live = false;
    };
  }, [bridge, selectedCase?.id, retry]);

  return (
    <div className="opening-page">
      <AccountSelection
        accounts={accounts}
        selectedIds={selectedIds}
        onChange={model.setSelectedIds}
        disabled={model.running}
      />
      <div className="opening-browser opening-primary">
        <section
          className="panel opening-catalog"
          aria-labelledby="opening-catalog-title"
        >
          <div className="section-heading">
            <div>
              <span className="kicker">{t("ESCOLHE UMA CAIXA")}</span>
              <h2 id="opening-catalog-title">{t("As tuas caixas")}</h2>
            </div>
            <span>
              {t(caseChoices.length)}
              {t(" disponíveis")}
            </span>
          </div>
          <div className="opening-catalog-tools">
            <label className="opening-search">
              <Search size={17} />
              <input
                type="search"
                placeholder={t("Procurar caixa")}
                aria-label={t("Procurar caixa")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label={t("Ordenar caixas")}
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="quantity">{t("Mais caixas")}</option>
              <option value="name">{t("Nome A–Z")}</option>
            </select>
          </div>
          {catalogError && (
            <div className="opening-catalog-note">
              {t("As imagens estão temporariamente indisponíveis. ")}
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                <RefreshCw size={14} />
                {t("Tentar de novo")}
              </button>
            </div>
          )}
          {catalogLoading && (
            <p className="muted opening-loading">
              {t("A carregar imagens das caixas…")}
            </p>
          )}
          {boxList.length ? (
            <div className="opening-case-grid">
              {boxList.map((box) => (
                <button
                  key={box.id}
                  type="button"
                  className={`opening-case-card${box.id === form.caseId ? " is-selected" : ""}`}
                  aria-pressed={box.id === form.caseId}
                  disabled={running}
                  onClick={() => model.setForm({ caseId: box.id })}
                >
                  <Artwork
                    src={box.meta?.image || box.image}
                    name={box.displayName}
                  />
                  <span className="opening-case-name">
                    {t(box.displayName)}
                  </span>
                  <span className="opening-case-count">
                    <strong>{t(formatNumber(box.total))}</strong>
                    {t(" nas contas selecionadas")}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="opening-empty">
              <Boxes size={28} />
              <strong>
                {t(
                  caseChoices.length
                    ? "Nenhuma caixa corresponde à pesquisa"
                    : "Não há caixas comuns às contas selecionadas",
                )}
              </strong>
              <small>
                {t(
                  caseChoices.length
                    ? "Experimenta outro nome."
                    : "Escolhe uma conta ou atualiza os saldos na página Contas.",
                )}
              </small>
            </div>
          )}
        </section>
        <section className="panel opening-settings">
          <div className="section-heading">
            <h2>{t("Configurar abertura")}</h2>
            <span>{t("Para as contas selecionadas")}</span>
          </div>
          <div className="opening-form">
            <div className="pace-note">
              <Clock3 size={18} />
              <div>
                {t("Ritmo automático")}
                <small>
                  {t(Math.round(opening.intervalMs || 500))}
                  {t(
                    " ms entre pedidos · continua até esgotar caixas ou parar.",
                  )}
                </small>
              </div>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.convert}
                disabled={running || itemRules.length > 0}
                onChange={(event) =>
                  model.setForm({ convert: event.target.checked })
                }
              />
              {t("Converter itens baratos")}
            </label>
            {itemRules.length > 0 && (
              <p className="form-note">
                {t(
                  "As escolhas feitas nas skins acima serão aplicadas a cada abertura. Podes testar com uma caixa numa conta.",
                )}
              </p>
            )}
            {form.convert && (
              <>
                <div className="conversion-fields">
                  <label>
                    {t("Destino da conversão")}
                    <select
                      value={form.conversionMode}
                      disabled={running}
                      onChange={(event) =>
                        model.setForm({ conversionMode: event.target.value })
                      }
                    >
                      <option value="tokens">{t("Tokens")}</option>
                      <option value="money">{t("Dinheiro virtual")}</option>
                    </select>
                  </label>
                  <label>
                    {t("Teto do item ($ virtual)")}
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      step="0.01"
                      value={form.maxPrice}
                      disabled={running}
                      onChange={(event) =>
                        model.setForm({ maxPrice: event.target.value })
                      }
                    />
                  </label>
                </div>
                {!validPrice && (
                  <p className="inline-error">
                    {t("O teto deve estar entre $0 e $1000.")}
                  </p>
                )}
                <p className="form-note">
                  {t(
                    "Só são convertidos itens comuns de baixa raridade, abaixo do teto, sem favoritos nem atributos especiais. Itens desconhecidos ficam guardados.",
                  )}
                </p>
              </>
            )}
          </div>
          <div className="run-actions">
            {running ? (
              <button
                className="stop-button"
                disabled={opening.phase === "stopping"}
                onClick={actions.stopOpening}
              >
                <Square size={16} />
                {t(
                  opening.phase === "stopping" ? "A parar…" : "Parar abertura",
                )}
              </button>
            ) : (
              <>
                <button
                  className="primary-button"
                  disabled={disabled}
                  onClick={() => actions.startOpening(false, itemRules)}
                >
                  <Boxes size={17} />
                  {t("Iniciar abertura")}
                </button>
                <button
                  className="test-button"
                  disabled={
                    disabled ||
                    (!form.convert && !itemRules.length) ||
                    selectedIds.length !== 1
                  }
                  onClick={() => actions.startOpening(true, itemRules)}
                >
                  {t(
                    itemRules.length
                      ? "Testar 1 caixa com regras"
                      : `Testar 1 caixa → ${form.conversionMode === "money" ? "dinheiro" : "tokens"}`,
                  )}
                </button>
              </>
            )}
          </div>
        </section>
      </div>
      <section className="panel opening-results">
        <div className="section-heading">
          <h2>{t("Resultados da abertura")}</h2>
          <span className={"status-tag" + (running ? " good" : "")}>
            {t(
              model.openingCooldown
                ? model.openingCooldown + " s de espera"
                : running
                  ? "Em execução"
                  : "Pronta",
            )}
          </span>
        </div>
        <div className="opening-summary">
          <span>
            <strong>{t(formatNumber(opening.accepted || 0))}</strong>
            {t("Aceites")}
          </span>
          <span>
            <strong>
              {t(formatNumber(opening.confirmed ?? opening.opened ?? 0))}
            </strong>
            {t("Confirmadas")}
          </span>
          <span>
            <strong>{t(formatNumber(opening.unconfirmed || 0))}</strong>
            {t("Por confirmar")}
          </span>
          <span>
            <strong>{t(formatNumber(opening.converted || 0))}</strong>
            {t("Itens convertidos")}
          </span>
          <span>
            <strong>{t(formatNumber(opening.failed || 0))}</strong>
            {t("Falhas")}
          </span>
        </div>
        <div className="event-list">
          {results.length ? (
            results
              .slice(0, 15)
              .map((event, index) => (
                <EventRow
                  key={index}
                  event={event}
                  label={accountsById.get(event.accountId)?.label}
                  destinationLabel={
                    accountsById.get(event.destinationAccountId)?.label
                  }
                />
              ))
          ) : (
            <div className="empty-state">
              <Boxes size={26} />
              <h2>{t("Ainda não há resultados")}</h2>
              <p>
                {t(
                  "Escolhe uma caixa e inicia a abertura. Os resultados aparecem aqui.",
                )}
              </p>
            </div>
          )}
        </div>
      </section>
      <DisclosurePanel
        title="Conteúdo e regras dos itens"
        badge={itemRules.length + " " + t("regras ativas")}
        description="Consultar o conteúdo da caixa e escolher o destino dos itens."
        forceOpen={itemRules.length > 0}
      >
        <section
          className="panel opening-preview"
          aria-labelledby="opening-preview-title"
        >
          <div className="section-heading">
            <div>
              <span className="kicker">{t("PRÉ-VISUALIZAÇÃO")}</span>
              <h2 id="opening-preview-title">{t("Dentro da caixa")}</h2>
            </div>
            {selectedCase && (
              <span className="status-tag good">{t("Selecionada")}</span>
            )}
          </div>
          {selectedCase ? (
            <>
              <div className="opening-feature">
                <Artwork
                  src={
                    detail?.image || selectedMeta?.image || selectedCase.image
                  }
                  name={selectedName}
                  className="opening-feature-art"
                />
                <div>
                  <span className="kicker">{t("CAIXA SELECIONADA")}</span>
                  <h3>{t(selectedName)}</h3>
                  <p>
                    {t(formatNumber(quantity(selectedCase.id)))}
                    {t(" caixas nas contas selecionadas")}
                  </p>
                </div>
              </div>
              <div className="opening-contents-heading">
                <h3>{t("Itens possíveis")}</h3>
                <span>
                  {t(
                    detail?.items?.length
                      ? `${detail.items.length} tipos`
                      : detailLoading
                        ? "A carregar…"
                        : "—",
                  )}
                </span>
              </div>
              {detailLoading ? (
                <p className="muted opening-loading">
                  {t("A carregar conteúdo desta caixa…")}
                </p>
              ) : detailError ? (
                <div className="opening-contents-error">
                  <p>
                    {t("Não foi possível carregar o conteúdo desta caixa.")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    <RefreshCw size={14} />
                    {t("Tentar de novo")}
                  </button>
                  {selectedMeta?.slug && (
                    <a
                      href={`https://case-clicker.com/cases/${selectedMeta.category}/${selectedMeta.slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("Ver no jogo")}
                    </a>
                  )}
                </div>
              ) : detail?.items?.length ? (
                <OpeningItemRules
                  key={form.caseId}
                  items={detail.items}
                  rules={itemRules}
                  onChange={updateRule}
                  onRulesChange={updateOrderedRules}
                  accounts={accounts}
                  bridge={bridge}
                  disabled={running}
                  Artwork={Artwork}
                />
              ) : (
                <p className="muted">
                  {t("O catálogo ainda não apresenta os itens desta caixa.")}
                </p>
              )}
              <p className="opening-contents-note">
                {t(
                  "O conteúdo é apresentado pelo catálogo público do jogo. O resultado de cada abertura é decidido pelo servidor.",
                )}
              </p>
            </>
          ) : (
            <div className="opening-preview-empty">
              <PackageOpen size={38} />
              <h3>{t("Escolhe uma caixa")}</h3>
              <p>
                {t(
                  "Seleciona uma imagem à esquerda para veres os itens que podem sair.",
                )}
              </p>
            </div>
          )}
        </section>
      </DisclosurePanel>
    </div>
  );
}
