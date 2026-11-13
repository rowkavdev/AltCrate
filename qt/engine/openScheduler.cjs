const { parseRetryAfter } = require('./scheduler.cjs');
const { selectForConversion } = require('./skins.cjs');

function validate(config) {
  if (!Array.isArray(config?.accounts) || !config.accounts.length || new Set(config.accounts.map((x) => x.id)).size !== config.accounts.length) throw new Error('Seleciona contas válidas');
  if (typeof config.caseId !== 'string' || !/^[a-f0-9]{24}$/i.test(config.caseId)) throw new Error('Seleciona uma caixa válida');
  for (const [key, min, max] of [['concurrency', 1, 20]]) {
    if (!Number.isSafeInteger(config[key]) || config[key] < min || config[key] > max) throw new Error(`${key}: valor inválido`);
  }
  if (config.conversionCap !== null && (!Number.isSafeInteger(config.conversionCap) || config.conversionCap < 0 || config.conversionCap > 100)) throw new Error('Limite de conversão inválido');
  if (config.conversionCap === null && config.continuous !== true) throw new Error('Conversão sem limite requer modo contínuo');
  if (config.continuous !== true && (!Number.isSafeInteger(config.maxOpens) || config.maxOpens < 1 || config.maxOpens > 100)) throw new Error('Número de aberturas inválido');
  if (config.adaptive !== true && (!Number.isSafeInteger(config.delayMs) || config.delayMs < 1000 || config.delayMs > 3600000)) throw new Error('Intervalo inválido');
  if (typeof config.maxPrice !== 'number' || !Number.isFinite(config.maxPrice) || config.maxPrice < 0 || config.maxPrice > 1000) throw new Error('Teto de preço inválido');
  if (typeof config.convert !== 'boolean') throw new Error('Opção de conversão inválida');
  if(config.itemRules!==undefined&&(!Array.isArray(config.itemRules)||config.itemRules.length>500||config.itemRules.length&&config.convert))throw Error('As regras por skin não podem ser combinadas com a conversão por preço');
  if (config.conversionMode !== undefined && !['tokens', 'money'].includes(config.conversionMode)) throw new Error('Destino da conversão inválido');
  if (config.testOnce === true && (config.continuous === true || config.maxOpens !== 1 || config.accounts.length !== 1)) throw new Error('O teste de uma caixa requer uma conta e uma abertura');
}

function createOpenScheduler({ apiForAccount, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), emit = () => {}, coordinator = null, accountQueue = null, isItemReserved = () => false,onOpenedItems=null }) {
  let phase = 'idle';
  let stopRequested = false;
  let cooldownUntil = 0;
  let opened = 0;
  let accepted = 0, confirmed = 0, unconfirmed = 0;
  let converted = 0;
  let failed = 0;
  let runPromise = null;
  let entries = [];
  let intervalMs = 500;
  let successStreak = 0;
  let mode = 'bounded';
  const status = () => ({ phase, cooldownUntil, opened, accepted, confirmed, unconfirmed, converted, failed, intervalMs, mode, accounts: entries.map((x) => ({ id: x.account.id, attempts: x.attempts, conversions: x.conversions, disabled: x.disabled })) });
  const publish = (event) => emit({ ...event, at: new Date(now()).toISOString(), status: status() });
  async function handleLimit(result, entry) {
    if (result.status === 429) {
      cooldownUntil = Math.max(cooldownUntil, now() + parseRetryAfter(result.retryAfter, now()));
      if (coordinator) await coordinator.limit(cooldownUntil);
      if (mode === 'adaptive') { intervalMs = Math.min(60000, Math.ceil(intervalMs * 2)); successStreak = 0; }
      publish({ type: 'cooldown', accountId: entry.account.id, until: cooldownUntil });
    }
    if (result.status === 401 || result.status === 403) {
      entry.disabled = true;
      publish({ type: 'needs-login', accountId: entry.account.id });
    }
  }

  async function findNewSkins(api, ids) {
    const wanted = new Set(ids);
    const found = [];
    for (let page = 1; page <= 20 && wanted.size; page++) {
      const result = await api.inventoryPage(page);
      for (const skin of result.skins) {
        if (wanted.delete(String(skin?._id))) found.push(skin);
      }
      if (page >= result.pages) break;
    }
    return found;
  }

  async function one(entry, config) {
    const api = apiForAccount(entry.account);
    let mutationSent = false, requested = 0, beforeStock = null, beforeReadAt = null;
    try {
      const before = await api.snapshot();
      if (stopRequested) return;
      if (coordinator && (cooldownUntil = await coordinator.cooldown())) return;
      beforeReadAt = new Date(now()).toISOString();
      const stock = snapshot => {
        if (!Array.isArray(snapshot?.cases)) return null;
        const box = snapshot.cases.find(item => item.id === config.caseId);
        return !box ? 0 : Number.isSafeInteger(box.amount) && box.amount >= 0 ? box.amount : null;
      };
      beforeStock = stock(before);
      if (beforeStock === null) throw Error('Stock da caixa selecionada indisponível; abertura parada');
      if (beforeStock === 0) {
        entry.disabled = true;
        publish({ type: 'out-of-cases', accountId: entry.account.id });
        return;
      }
      const owned = beforeStock;
      const maximum = Number.isSafeInteger(before.caseOpenCount) ? Math.max(1, Math.min(100, before.caseOpenCount)) : 1;
      let multiplier = Number.isSafeInteger(before.maxCaseOpenMultiplier) ? Math.max(1, Math.min(10, before.maxCaseOpenMultiplier)) : 1;
      if (owned < multiplier) multiplier = 1;
      const count = config.testOnce === true ? 1 : Math.max(1, Math.min(maximum, Math.floor(owned / multiplier)));
      if (config.testOnce === true) multiplier = 1;
      requested = count * multiplier;
      mutationSent = true;
      const result = await api.openCase(config.caseId, count, multiplier);
      mutationSent = false;
      await handleLimit(result, entry);
      const ids = Array.isArray(result.skinIds) ? result.skinIds : [];
      const identifiable = ids.length === requested && ids.every(id => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)) && new Set(ids).size === requested;
      const after = await api.snapshot().catch(() => null);
      const afterReadAt = after ? new Date(now()).toISOString() : null;
      const afterStock = stock(after);
      const selectedCaseDelta = afterStock !== null ? afterStock - beforeStock : null;
      const verified = result.ok === true && identifiable && selectedCaseDelta === -requested;
      const ambiguous = result.ok === true && !verified || result.status >= 500;
      if (result.ok) accepted += requested;
      if (verified) { confirmed += requested; opened = confirmed; }
      if (ambiguous) unconfirmed += requested;
      if (!result.ok || ambiguous) failed++;
      publish({ type: 'open', accountId: entry.account.id, caseId: config.caseId, httpStatus: result.status,
        acceptedCount: result.ok ? requested : 0, confirmedCount: verified ? requested : 0, unconfirmedCount: ambiguous ? requested : 0,
        openedCount: verified ? requested : 0, requestedCount: requested, verified, verification: verified ? 'confirmed' : ambiguous ? 'unconfirmed' : 'rejected',
        selectedCaseBefore: beforeStock, selectedCaseAfter: afterStock, selectedCaseDelta, beforeReadAt, afterReadAt,
        observedCaseDelta: after && Number.isFinite(after.casesTotal) && Number.isFinite(before.casesTotal) ? after.casesTotal - before.casesTotal : null,
        skinCount: ids.length, skinIds: ids.filter(id => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)), message: result.message });
      if (ambiguous) {
        entry.disabled = true;
        publish({ type: 'account-error', accountId: entry.account.id, message: !identifiable ? 'A resposta da abertura não identificou todos os itens; execução parada sem repetir o pedido' : 'Stock da caixa selecionada não confirmou a abertura; execução parada sem repetir o pedido' });
        return;
      }
      if (!result.ok) { if (result.status !== 429) entry.disabled = true; return; }
      if (mode === 'adaptive' && ++successStreak >= 20) {
        intervalMs = Math.max(250, Math.floor(intervalMs * 0.85)); successStreak = 0;
        publish({ type: 'pace', intervalMs });
      }
      if (config.itemRules?.length) return ids;
      if (!config.convert || stopRequested || cooldownUntil > now() || (config.conversionCap !== null && entry.conversions >= config.conversionCap)) return;
      const skins = await findNewSkins(api, result.skinIds);
      if (!skins.length) {
        failed++; entry.disabled = true;
        publish({ type: 'account-error', accountId: entry.account.id, message: 'Itens abertos não encontrados no inventário; execução parada para evitar gastar mais caixas' });
        return;
      }
      const remaining = config.conversionCap === null ? result.skinIds.length : config.conversionCap - entry.conversions;
      const conversionMode = config.conversionMode || 'tokens';
      const selected = selectForConversion(conversionMode === 'money' ? skins.filter((skin) => skin.price > 0) : skins, new Set(), config.maxPrice, remaining);
      for (const skin of selected) {
        if (stopRequested || cooldownUntil > now()) break;
        await sleep(intervalMs);
        if (stopRequested || cooldownUntil > now()) break;
        const beforeBalance = await api.balance();
        if (isItemReserved(entry.account.id, skin._id)) continue;
        const conversion = conversionMode === 'money' ? await api.sellSkin(skin._id) : await api.convertSkin(skin._id);
        await handleLimit(conversion, entry);
        let afterBalance = null;
        if (conversion.ok) {
          afterBalance = await api.balance();
          if (afterBalance[conversionMode] <= beforeBalance[conversionMode]) {
            await sleep(1000);
            afterBalance = await api.balance();
          }
        }
        const tokenDelta = afterBalance ? afterBalance.tokens - beforeBalance.tokens : null;
        const moneyDelta = afterBalance ? afterBalance.money - beforeBalance.money : null;
        const verified = conversion.ok && (conversionMode === 'money' ? moneyDelta : tokenDelta) > 1e-8;
        if (verified) { converted++; entry.conversions++; }
        else { failed++; entry.disabled = true; }
        publish({ type: 'conversion', accountId: entry.account.id, skinId: skin._id, skinName: String(skin.name || '').slice(0, 100), price: skin.price, conversionMode, httpStatus: conversion.status, verified, tokenDelta, moneyDelta, message: verified ? '' : conversion.ok ? `Resposta aceite, mas o saldo de ${conversionMode === 'money' ? 'dinheiro' : 'tokens'} não aumentou; conversão automática parada nesta conta` : conversion.message });
        if (!verified) break;
      }
    } catch (error) {
      failed++;
      entry.disabled = true;
      if (mutationSent) {
        unconfirmed += requested;
        publish({ type: 'open', accountId: entry.account.id, caseId: config.caseId, acceptedCount: 0, confirmedCount: 0, unconfirmedCount: requested, openedCount: 0, requestedCount: requested, verified: false, verification: 'unconfirmed', selectedCaseBefore: beforeStock, selectedCaseAfter: null, selectedCaseDelta: null, beforeReadAt, afterReadAt: null, skinCount: 0, skinIds: [], message: 'Resultado da abertura desconhecido; pedido não repetido' });
      }
      if (error.status === 429) await handleLimit(error, entry);
      publish({ type: 'account-error', accountId: entry.account.id, message: String(error.message || error).slice(0, 180) });
    }
  }

  async function run(config) {
    entries = config.accounts.map((account) => ({ account, attempts: 0, conversions: 0, disabled: false, busy: false }));
    phase = 'running'; stopRequested = false; cooldownUntil = 0; opened = 0; accepted = 0; confirmed = 0; unconfirmed = 0; converted = 0; failed = 0;
    mode = config.adaptive === true ? 'adaptive' : 'bounded';
    intervalMs = mode === 'adaptive' ? 500 : config.delayMs;
    successStreak = 0;
    publish({ type: 'open-started' });
    let cursor = 0;
    let nextStart = now();
    const active = new Set();
    try {
      while (!stopRequested) {
        if (!entries.some((x) => !x.disabled && (config.continuous === true || x.attempts < config.maxOpens))) break;
        if (cooldownUntil > now()) { publish({ type: 'waiting', until: cooldownUntil }); await sleep(Math.min(1000, cooldownUntil - now())); continue; }
        if (coordinator && (cooldownUntil = await coordinator.cooldown())) { await sleep(Math.min(1000, cooldownUntil - now())); continue; }
        if (active.size >= config.concurrency) { await Promise.race(active); continue; }
        if (nextStart > now()) { await sleep(Math.min(1000, nextStart - now())); continue; }
        let entry;
        for (let offset = 0; offset < entries.length; offset++) {
          const index = (cursor + offset) % entries.length;
          const candidate = entries[index];
          if (!candidate.busy && !candidate.disabled && (config.continuous === true || candidate.attempts < config.maxOpens)) { entry = candidate; cursor = (index + 1) % entries.length; break; }
        }
        if (!entry) { if (active.size) await Promise.race(active); else break; continue; }
        entry.busy = true; entry.attempts++;
        nextStart = now() + intervalMs;
        const task = (async()=>{
          const ids=await (accountQueue?accountQueue.run(entry.account.id,()=>one(entry,config)):one(entry,config));
          if(ids?.length&&!stopRequested&&onOpenedItems)await onOpenedItems(entry,ids,config,{isStopped:()=>stopRequested});
        })().catch(error=>{failed++;entry.disabled=true;publish({type:'account-error',accountId:entry.account.id,message:String(error.message||error).slice(0,180)});}).finally(() => { entry.busy = false; active.delete(task); });
        active.add(task);
      }
      await Promise.allSettled(active);
    } finally {
      phase = stopRequested ? 'stopped' : 'complete';
      publish({ type: 'open-finished' });
      runPromise = null;
    }
    return status();
  }
  return {
    start(config) { if (runPromise) throw new Error('Já existe uma execução ativa'); validate(config); runPromise = run(config); return runPromise; },
    stop() { if (phase === 'running') { stopRequested = true; phase = 'stopping'; publish({ type: 'run-stopping' }); } return status(); },
    status,
  };
}
module.exports = { createOpenScheduler };
