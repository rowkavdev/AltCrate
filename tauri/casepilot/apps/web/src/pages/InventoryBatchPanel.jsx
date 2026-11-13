import React, { useEffect, useRef, useState } from "react";
import { t } from "../language.js";
import "./inventoryBatch.css";
const errorMessage = (error) =>
  String(error?.message || error).replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
const labels = {
  review: "Por rever",
  running: "Em execução",
  paused: "Pausado",
  stopped: "Parado",
  completed: "Concluído",
  queued: "Por executar",
  submitting: "A enviar",
  unconfirmed: "Por confirmar",
  unresolved: "Por confirmar",
  confirmed: "Confirmado",
  blocked: "Nova revisão necessária",
  failed: "Recusado",
  cancelled: "Cancelado",
};
const needsVerification = (item) =>
  ["submitting", "unconfirmed", "unresolved"].includes(item.state);
const needsAttention = (batch) =>
  ["running", "paused"].includes(batch.state) || batch.items.some(needsVerification);
const isExpired = (batch) => batch.expiresAt != null && batch.expiresAt <= Date.now();
const refKey = ({ accountId, itemId, storageUnitId }) =>
  JSON.stringify([accountId, itemId, storageUnitId ?? null]);

export function InventoryBatchReview({
  batch,
  busy = false,
  onStart,
  onStop,
  onVerify,
  onResume,
}) {
  const [, refreshDeadline] = useState(0);
  const expiresAt = batch?.expiresAt;
  useEffect(() => {
    if (expiresAt == null || expiresAt <= Date.now()) return;
    const timer = setTimeout(() => refreshDeadline((version) => version + 1), expiresAt - Date.now());
    return () => clearTimeout(timer);
  }, [expiresAt]);

  if (!batch) return null;
  const confirmed = batch.items.filter((item) => item.state === "confirmed");
  const remaining = batch.items.filter((item) => item.state !== "confirmed");
  const pending = remaining.some(needsVerification);
  const resumable = remaining.length > 0 && remaining.every((item) => item.state === "queued");
  const expired = isExpired(batch);
  const renderRows = (rows) => (
    <ol className="inventory-batch-rows">
      {rows.map((row) => (
        <li key={refKey(row.ref)}>
          <strong>
            {t(row.preview.item.name || row.ref.name || "Item sem nome")}
          </strong>
          <small>
            {t("Item: ")}
            {row.ref.itemId}
          </small>
          <small>
            {t(row.preview.sourceLabel)} ({row.ref.accountId.slice(0, 8)}) ·{" "}
            {t(
              row.ref.storageUnitId
                ? "storage de origem"
                : "inventário de origem",
            )}{" "}
            → {t(row.preview.destinationLabel || row.preview.sourceLabel)}
            {row.preview.destinationStorageName
              ? " · " + row.preview.destinationStorageName
              : ""}
          </small>
          <small>
            {row.preview.steps.map((step) => t(step)).join(" → ")}
          </small>
          <span>
            {t(labels[row.state] || row.state)}
            {row.message ? " · " + t(row.message) : ""}
          </span>
          {row.state === "confirmed" && row.finalLocation && (
            <small>
              {t(
                ["sell", "convert"].includes(batch.kind)
                  ? "Resultado confirmado: "
                  : "Chegada confirmada: ",
              )}
              {t(
                row.finalLocation.location === "sold"
                  ? "vendido"
                  : row.finalLocation.location === "converted"
                    ? "convertido em tokens"
                    : row.finalLocation.location === "storage"
                      ? row.preview.destinationStorageName || "storage"
                      : "inventário",
              )}
              {" · " + row.finalLocation.accountId.slice(0, 8)}
            </small>
          )}
        </li>
      ))}
    </ol>
  );
  return (
    <section
      className="inventory-batch-review"
      aria-label={t("Revisão do lote")}
    >
      <div className="section-heading">
        <h3>{t("Revisão por item")}</h3>
        <span role="status">
          {t(labels[batch.state] || batch.state)} · {confirmed.length}/
          {batch.items.length}
        </span>
      </div>
      <p className="muted">{t(batch.limitation)}</p>
      {batch.message && <p className="inline-error">{t(batch.message)}</p>}
      {batch.kind === "move-to-storage" && (
        <p className="muted">
          {t(batch.capacity?.message || "Capacidade do storage indisponível.")}
        </p>
      )}
      {remaining.length > 0 && renderRows(remaining)}
      {confirmed.length > 0 && (
        <details>
          <summary>{t("Itens confirmados")} ({confirmed.length})</summary>
          {renderRows(confirmed)}
        </details>
      )}
      {expired && (batch.state === "review" || resumable) && (
        <p className="muted">{t("A revisão expirou. Revê os itens restantes num novo lote.")}</p>
      )}
      <div className="inventory-batch-buttons">
        {batch.state === "review" && (
          <button
            className="primary-button"
            disabled={busy || expired}
            onClick={() => { if (!isExpired(batch)) onStart?.(batch.batchId); }}
          >
            {t("Executar lote")}
          </button>
        )}
        {batch.state === "running" && (
          <button
            className="secondary-button"
            disabled={batch.stopRequested}
            onClick={() => onStop?.(batch.batchId)}
          >
            {t(
              batch.stopRequested
                ? "A terminar a verificação atual…"
                : "Parar novos envios",
            )}
          </button>
        )}
        {pending && batch.state !== "running" && (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => onVerify?.(batch.batchId)}
          >
            {t("Verificar estado")}
          </button>
        )}
        {["paused", "stopped"].includes(batch.state) && resumable && (
          <button
            className="primary-button"
            disabled={busy || expired}
            onClick={() => { if (!isExpired(batch)) onResume?.(batch.batchId); }}
          >
            {t("Continuar itens por executar")}
          </button>
        )}
      </div>
      {batch.state === "running" && (
        <p className="muted">
          {t(
            "Parar impede novos envios e aguarda a verificação do item atual.",
          )}
        </p>
      )}
      {batch.items.some(
        (row) => row.state === "blocked" || row.state === "failed",
      ) && (
        <p className="muted">
          {t(
            "Cria uma nova revisão apenas dos itens por executar. Os itens confirmados ficam concluídos.",
          )}
        </p>
      )}
      {batch.items.some((row) => row.canResume) && (
        <p className="muted">
          {t(
            "O item chegou ao inventário. Usa Continuar na operação individual para concluir o depósito; depois verifica este lote.",
          )}
        </p>
      )}
    </section>
  );
}
function batchOption(batch) {
  return (
    <option key={batch.batchId} value={batch.batchId}>
      {new Date(batch.createdAt).toLocaleString("pt-PT")} · {batch.items.length}{" "}
      {t("itens")} · {t(labels[batch.state] || batch.state)}
    </option>
  );
}

export default function InventoryBatchPanel({
  model,
  accountId,
  items = [],
  storageUnitId = null,
  page = 1,
  selection: externalSelection,
  onSelectionChange,
}) {
  const bridge = model.bridge,
    accounts = model.accounts || [],
    available = !!bridge?.prepareInventoryBatch;
  const [localSelection, setLocalSelection] = useState([]),
    [kind, setKind] = useState("move-to-storage"),
    [destination, setDestination] = useState(""),
    [storage, setStorage] = useState(""),
    [units, setUnits] = useState([]),
    [batches, setBatches] = useState([]),
    [selectionOfBatch, selectBatch] = useState({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selection = externalSelection ?? localSelection,
    setSelection = onSelectionChange || setLocalSelection;
  const selectionKey = selection.map((entry) => entry.key).join("|");
  const panelRef = useRef(null);
  const alive = useRef(true),
    locked = useRef(false),
    loadVersion = useRef(0),
    records = useRef(new Map());
  const scopedBatches = batches.filter((batch) =>
    batch.destinationAccountId === accountId ||
    batch.items.some((item) => item.ref.accountId === accountId || item.preview.destinationAccountId === accountId)
  );
  const active = scopedBatches.filter(needsAttention);
  const attention = scopedBatches.filter((batch) => batch.state === "review" || needsAttention(batch));
  const saved = scopedBatches.filter((batch) => batch.state !== "review" && !needsAttention(batch));
  const selectedBatch = selectionOfBatch.accountId === accountId ? selectionOfBatch.id : undefined;
  const batch = scopedBatches.find((value) => value.batchId === selectedBatch) || active[0];

  useEffect(() => {
    if (batch && selectedBatch !== batch.batchId) {
      selectBatch({ accountId, id: batch.batchId });
    }
  }, [accountId, batch?.batchId, selectedBatch]);

  useEffect(() => {
    if (batch?.state === "review") selectBatch({ accountId, id: "" });
  }, [selectionKey, kind, destination, storage]);

  function merge(value) {
    if (!value || !alive.current) return;
    const previous = records.current.get(value.batchId);
    if (previous && (value.updatedAt || "") < (previous.updatedAt || "")) return;

    records.current.set(value.batchId, value);
    setBatches((old) => [value, ...old.filter((entry) => entry.batchId !== value.batchId)]);

    const alreadyConfirmed = new Set(
      previous?.items.filter((row) => row.state === "confirmed").map((row) => refKey(row.ref))
    );
    const confirmed = new Set(
      value.items.filter((row) => row.state === "confirmed").map((row) => refKey(row.ref))
        .filter((key) => !alreadyConfirmed.has(key))
    );
    if (confirmed.size) {
      setSelection((old) => old.filter((entry) => !confirmed.has(refKey(entry.ref))));
    }
  }

  useEffect(() => {
    alive.current = true;
    if (!available) return;
    let live = true;
    bridge.listInventoryBatches?.().then((values) => {
      if (!live) return;
      const unseen = values.filter((value) => !records.current.has(value.batchId));
      for (const value of unseen) records.current.set(value.batchId, value);
      setBatches((old) => [...old, ...unseen]);
    }).catch((failure) => {
      if (live) setError(errorMessage(failure));
    });
    const unsubscribe = bridge.onEvent?.((event) => {
      if (live && event.type === "inventory-batch") merge(event.batch);
    });
    return () => {
      live = false;
      alive.current = false;
      unsubscribe?.();
    };
  }, [bridge, available]);
  async function call(method, ...args) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await bridge[method](...args);
      if (alive.current) {
        merge(value);
        selectBatch({ accountId, id: value.batchId });
      }
    } catch (failure) {
      if (alive.current) setError(errorMessage(failure));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function stop(id) {
    try {
      merge(await bridge.stopInventoryBatch(id));
    } catch (failure) {
      if (alive.current) setError(errorMessage(failure));
    }
  }
  async function loadUnits(id) {
    const version = ++loadVersion.current;
    setUnits([]);
    setStorage("");
    setError("");
    if (!id) return;
    try {
      const result = await bridge.listStorageUnits(id);
      if (alive.current && version === loadVersion.current) setUnits(result);
    } catch (failure) {
      if (alive.current && version === loadVersion.current)
        setError(errorMessage(failure));
    }
  }
  function toggle(item) {
    const key = accountId + ":" + item.id;
    setSelection((old) =>
      old.some((entry) => entry.key === key)
        ? old.filter((entry) => entry.key !== key)
        : old.length >= 200
          ? old
          : [
              ...old,
              {
                key,
                item,
                ref: {
                  accountId,
                  itemId: item.id,
                  storageUnitId,
                  page,
                  name: item.name,
                },
              },
            ],
    );
  }
  const selected = (key) => selection.some((entry) => entry.key === key),
    canReview =
      selection.length > 0 &&
      (kind === "withdraw"
        ? selection.every((entry) => entry.ref.storageUnitId)
        : ["sell", "convert"].includes(kind)
          ? true
          : !!destination && (kind !== "move-to-storage" || !!storage));
  useEffect(() => {
    if (batch && (batch.state === "review" || needsAttention(batch))) {
      const disclosure = panelRef.current?.closest(".disclosure-panel");
      if (disclosure) disclosure.open = true;
    }
  }, [batch?.batchId, batch?.state]);
  if (!available) return null;
  return (
    <section ref={panelRef} className="panel inventory-batch-panel">
      <div className="section-heading">
        <div>
          <h2>{t("Ações em lote")}</h2>
          <small className="muted">
            {t(
              "Seleciona skins nos cartões. A seleção mantém-se ao mudar de conta, página ou cofre.",
            )}
          </small>
        </div>
        <span>
          {selection.length} {t("selecionados")}
        </span>
      </div>
      {items.length > 0 && (
        <>
          <div className="inventory-batch-buttons">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                setSelection((old) => {
                  const next = [...old];
                  for (const item of items) {
                    const key = accountId + ":" + item.id;
                    if (
                      !next.some((entry) => entry.key === key) &&
                      next.length < 200
                    )
                      next.push({
                        key,
                        item,
                        ref: {
                          accountId,
                          itemId: item.id,
                          storageUnitId,
                          page,
                          name: item.name,
                        },
                      });
                  }
                  return next;
                })
              }
            >
              {t("Selecionar página")}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                setSelection((old) =>
                  old.filter(
                    (entry) =>
                      !items.some(
                        (item) => entry.key === accountId + ":" + item.id,
                      ),
                  ),
                )
              }
            >
              {t("Desmarcar página")}
            </button>
          </div>
          <details>
            <summary>{t("Selecionar itens desta página")}</summary>
            <div className="inventory-batch-selection">
              {items.map((item) => (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    aria-label={t("Selecionar " + item.name)}
                    checked={selected(accountId + ":" + item.id)}
                    disabled={busy}
                    onChange={() => toggle(item)}
                  />
                  <span>
                    {t(item.name)}
                    <small>{item.isFavorite ? t("Favorito") : ""}</small>
                  </span>
                </label>
              ))}
            </div>
          </details>
        </>
      )}
      {selection.length > 0 && (
        <div className="inventory-batch-selected">
          <p>
            {t("Contas selecionadas: ")}
            {[...new Set(selection.map((entry) => entry.ref.accountId))]
              .map(
                (id) =>
                  (accounts.find((account) => account.id === id)?.label || id) +
                  " (" +
                  id.slice(0, 8) +
                  ")",
              )
              .join(", ")}
          </p>
          <div className="inventory-batch-selected-items">
            {selection.map((entry) => (
              <button
                key={entry.key}
                className="secondary-button"
                disabled={busy}
                aria-label={t("Desmarcar " + entry.item.name)}
                onClick={() =>
                  setSelection((old) =>
                    old.filter((row) => row.key !== entry.key),
                  )
                }
              >
                {entry.item.name} ×
              </button>
            ))}
          </div>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => setSelection([])}
          >
            {t("Limpar seleção")}
          </button>
        </div>
      )}
      <div className="inventory-controls inventory-batch-controls">
        <label>
          {t("Ação")}
          <select
            value={kind}
            disabled={busy}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="move-to-storage">{t("Guardar em storage")}</option>
            <option value="sell">{t("Vender selecionadas")}</option>
            <option value="convert">
              {t("Converter selecionadas em tokens")}
            </option>
            <option value="transfer">{t("Enviar para outra conta")}</option>
            <option value="withdraw">
              {t("Retirar para o inventário da origem")}
            </option>
          </select>
        </label>
        {["transfer", "move-to-storage"].includes(kind) && (
          <label>
            {t("Conta de destino")}
            <select
              value={destination}
              disabled={busy}
              onChange={(event) => {
                setDestination(event.target.value);
                loadUnits(event.target.value);
              }}
            >
              <option value="">{t("Selecionar conta")}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label} ({account.id.slice(0, 8)})
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "move-to-storage" && (
          <label>
            {t("Storage de destino")}
            <select
              value={storage}
              disabled={busy || !destination}
              onChange={(event) => setStorage(event.target.value)}
            >
              <option value="">{t("Selecionar storage")}</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name} · {unit.count} {t("itens")}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {["sell", "convert"].includes(kind) && (
        <p className="inline-error">
          {t(
            "A venda e a conversão são irreversíveis. Os favoritos estão protegidos; retira-os da seleção ou remove o favorito primeiro.",
          )}
        </p>
      )}
      <p className="muted">
        {t(
          "As transferências são trocas individuais verificadas. O limite publicado é de 1000 skins por cofre.",
        )}
      </p>
      <button
        className="primary-button"
        disabled={busy || !canReview}
        onClick={() =>
          call("prepareInventoryBatch", {
            kind,
            refs: selection.map((entry) => entry.ref),
            ...(["transfer", "move-to-storage"].includes(kind)
              ? { destinationAccountId: destination }
              : {}),
            ...(kind === "move-to-storage"
              ? { destinationStorageUnitId: storage }
              : {}),
          })
        }
      >
        {t("Rever lote")}
      </button>
      {error && (
        <p className="inline-error" role="alert">
          {t(error)}
        </p>
      )}
      {attention.length > 0 && (
        <label className="inventory-batch-history" aria-label={t("Lotes a acompanhar")}>
          {t("Lotes a acompanhar")}
          <select
            value={attention.some((value) => value.batchId === batch?.batchId) ? batch.batchId : ""}
            onChange={(event) => selectBatch({ accountId, id: event.target.value })}
          >
            <option value="">{t("Selecionar lote para consultar ou recuperar")}</option>
            {attention.map(batchOption)}
          </select>
        </label>
      )}
      {saved.length > 0 && (
        <details>
          <summary>{t("Lotes concluídos e parados")}</summary>
          <label className="inventory-batch-history">
            {t("Lotes guardados")}
            <select
              value={saved.some((value) => value.batchId === batch?.batchId) ? batch.batchId : ""}
              onChange={(event) => selectBatch({ accountId, id: event.target.value })}
            >
              <option value="">{t("Selecionar lote para consultar ou recuperar")}</option>
              {saved.map(batchOption)}
            </select>
          </label>
        </details>
      )}
      <InventoryBatchReview
        batch={batch}
        busy={busy}
        onStart={(id) => call("startInventoryBatch", id)}
        onStop={stop}
        onVerify={(id) => call("verifyInventoryBatch", id)}
        onResume={(id) => call("resumeInventoryBatch", id)}
      />
    </section>
  );
}
