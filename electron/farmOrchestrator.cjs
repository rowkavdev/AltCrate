const { parseRetryAfter } = require('./scheduler.cjs');
const { vaultDueAt, shouldCollectVault } = require('./vaultPolicy.cjs');
const { inferCaseAward } = require('./caseAward.cjs');
const {failureDetails,safeFailure}=require('./farmFailure.cjs');
const { WINDOW_MS } = require('./clickBudget.cjs');

const DEFAULT_MODES = Object.freeze({ case: true, money: true, vault: true });
const MODE_KEYS = ['case', 'money', 'vault'];
const RETRY_DELAYS = [30000, 60000];
const VAULT_INTERVAL_MS = 2000;
const CLICK_INTERVAL_MS = 500;
const FAST_CLICK_INTERVAL_MS = 150;
const CASE_FLUSH_MS = 10000;
const ACCOUNT_LIMIT_POLICY = 'isolated-clicks-v2';
const emptyResults = () => ({ case: 0, money: 0, vault: 0, confirmedRequests: 0, unconfirmedRequests: 0 });

function cleanModes(value) {
  return Object.fromEntries(MODE_KEYS.map((kind) => [kind, value?.[kind] === false ? false : true]));
}

function createFarmOrchestrator({ accounts = [], apiForAccount, coordinator, accountQueue, snapshots, stateStore, emit = () => {}, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxInFlight = 4, verifyAccountLimits = false, accountClickLimits = false, smoothClicks = false, alignCaseClicks = false, steadyCaseClicks = false, limitGroup, networkStatus }) {
  if (typeof apiForAccount !== 'function' || !coordinator?.reserve || !coordinator?.status || !accountQueue?.run || !stateStore?.load || !stateStore?.save || !Number.isSafeInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 20) throw new TypeError('Orquestrador inválido');
  const entries = new Map(accounts.map((account) => [account.id, makeEntry(account)]));
  let order = accounts.map((account) => account.id);
  let cursor = 0;
  let nextMode = 'case';
  let phase = 'idle';
  let stopRequested = false;
  let runPromise = null;
  let selected = new Set();
  let budget = null;
  let readyPromise;
  let saveChain = Promise.resolve();
  let reservationChain = Promise.resolve();
  let nextVaultDispatchAt = 0;
  let nextClickSendAt = 0;
  let vaultInFlight = false;
  let lastJobKind = null;
  let clickIntervalMs = accountClickLimits ? FAST_CLICK_INTERVAL_MS : CLICK_INTERVAL_MS;
  let vaultIntervalMs = VAULT_INTERVAL_MS;
  let clickSuccesses = 0;
  let vaultSuccesses = 0;
  let scopeCheck = null;

  function makeEntry(account) {
    return { account, modes: { ...DEFAULT_MODES }, nextClickMode: 'case', casesPerClick: null, clicksPerCase: null, percentageReadAt: null, caseNextAt: 0, results: emptyResults(), paused: false, needsLogin: false, failures: 0, retryAt: 0, vaultNextAt: 0, pendingVaultCollectedAt: null, inFlight: false, error: '', last: null };
  }

  async function ready() {
    if (!readyPromise) readyPromise = Promise.resolve(stateStore.load()).then(async (saved) => {
      cursor = Number.isSafeInteger(saved?.cursor) && saved.cursor >= 0 ? saved.cursor : 0;
      nextMode = saved?.nextMode === 'money' ? 'money' : 'case';
      if (Number.isSafeInteger(saved?.pace?.clickIntervalMs) && saved.pace.clickIntervalMs >= 150 && saved.pace.clickIntervalMs <= 8000) clickIntervalMs = saved.pace.clickIntervalMs;
      if (Number.isSafeInteger(saved?.pace?.vaultIntervalMs) && saved.pace.vaultIntervalMs >= 1000 && saved.pace.vaultIntervalMs <= 15000) vaultIntervalMs = saved.pace.vaultIntervalMs;
      if(accountClickLimits){
        if(saved?.pace?.limitPolicy==='account-clicks-v1'){
          // Remove only the old cross-account penalty. Retain pacing learned
          // from shared limits, all reservations, and every server deadline.
          if(saved.pace.clickBurstGuarded===true)clickIntervalMs=FAST_CLICK_INTERVAL_MS;
        }else if(saved?.pace?.limitPolicy!==ACCOUNT_LIMIT_POLICY){
          clickIntervalMs=FAST_CLICK_INTERVAL_MS;vaultIntervalMs=VAULT_INTERVAL_MS;
        }
      }
      for (const [id, entry] of entries) {
        entry.modes = cleanModes(saved?.accounts?.[id]?.modes);
        entry.nextClickMode = saved?.accounts?.[id]?.nextClickMode === 'money' ? 'money' : 'case';
        entry.paused = saved?.accounts?.[id]?.paused === true;
        entry.caseNextAt = Number.isFinite(saved?.accounts?.[id]?.caseNextAt) && saved.accounts[id].caseNextAt >= 0 && saved.accounts[id].caseNextAt <= 8640000000000000 ? saved.accounts[id].caseNextAt : 0;
        entry.pendingVaultCollectedAt = typeof saved?.accounts?.[id]?.pendingVaultCollectedAt === 'string' ? saved.accounts[id].pendingVaultCollectedAt : null;
      }
      // A restart during an inconclusive check must not dispatch another probe.
      if(saved?.scopeCheck?.until>now())await coordinator.limit(saved.scopeCheck.until);
      budget=await refreshBudget();
    });
    return readyPromise;
  }

  function persist() {
    const value = { cursor, nextMode, scopeCheck:scopeCheck?{until:scopeCheck.until}:null, pace: { clickIntervalMs, vaultIntervalMs, ...(accountClickLimits?{limitPolicy:ACCOUNT_LIMIT_POLICY}:{}) }, accounts: Object.fromEntries([...entries].map(([id, entry]) => [id, { modes: { ...entry.modes }, nextClickMode: entry.nextClickMode, caseNextAt: entry.caseNextAt, paused: entry.paused, pendingVaultCollectedAt: entry.pendingVaultCollectedAt }])) };
    saveChain = saveChain.catch(() => {}).then(() => stateStore.save(value));
    return saveChain;
  }

  function status() {
    const accountBudgets = Object.fromEntries([...entries].map(([id,entry]) => {
      const scoped = budget?.accountBudgets?.[id];
      if (!scoped || !alignCaseClicks) return [id,scoped];
      const caseClicksAvailable = entry.modes.case ? completeClicks(entry,'case') : 0;
      const moneyClicksAvailable = entry.modes.money ? completeClicks(entry,'money') : 0;
      const caseReady = caseClicksAvailable && entry.caseNextAt <= now();
      const waits = [scoped.waitUntil,entry.modes.case && (caseClicksAvailable ? entry.caseNextAt : scoped.caseResetAt),entry.modes.money && scoped.moneyResetAt].filter(at=>at>now());
      const hold = Math.max(scoped.cooldownUntil || 0,budget.cooldownUntil || 0);
      const waitUntil = hold>now() ? hold : caseReady || moneyClicksAvailable ? 0 : waits.length ? Math.min(...waits) : 0;
      return [id,{...scoped,caseClicksAvailable,moneyClicksAvailable,waitUntil}];
    }));
    const waits = [...selected].filter(id=>!entries.get(id)?.paused&&!entries.get(id)?.needsLogin).map(id=>accountBudgets[id]?.waitUntil).filter(at=>at>now());
    return {
      phase,
      budget: alignCaseClicks && budget ? {...budget,accountBudgets,waitUntil:budget.cooldownUntil>now()?budget.cooldownUntil:waits.length?Math.min(...waits):0} : budget,
      limitCheck:scopeCheck?{kind:scopeCheck.kind,until:scopeCheck.until}:null,
      pace: { clickIntervalMs, vaultIntervalMs },
      ...(networkStatus ? { network: networkStatus() } : {}),
      clicksAvailable: budget ? [...selected].reduce((sum,id)=>{const entry=entries.get(id);return sum+(!entry||entry.paused||entry.needsLogin?0:['case','money'].filter(kind=>entry.modes[kind]).reduce((total,kind)=>total+completeClicks(entry,kind),0));},0) : null,
      accounts: order.filter((id) => entries.has(id)).map((id) => {
        const entry = entries.get(id);
        return { id, selected: selected.has(id), budget:accountBudgets[id], modes: { ...entry.modes }, casesPerClick: entry.casesPerClick, clicksPerCase: entry.clicksPerCase, caseLotClicks: caseLotTarget(entry), caseLotIntervalMs: entry.clicksPerCase ? caseLotInterval(entry,caseLotTarget(entry)) : null, caseNextAt: entry.caseNextAt, nextClickMode: entry.nextClickMode, results: { ...entry.results }, paused: entry.paused, needsLogin: entry.needsLogin, retryAt: entry.retryAt, vaultNextAt: entry.vaultNextAt, inFlight: entry.inFlight, error: entry.error, last: entry.last };
      }),
    };
  }

  function publish(event) {
    emit({ ...event, at: new Date(now()).toISOString(), status: status() });
  }

  function syncActiveKinds() {
    for (const [id,entry] of entries) for (const kind of ['case', 'money']) {
      const enabled = phase === 'running' && selected.has(id) && !entry.paused && !entry.needsLogin && entry.modes[kind];
      if (enabled) coordinator.activate(kind,id);
      else coordinator.deactivate(kind,id);
    }
  }

  function eligible(entry) {
    return entry && selected.has(entry.account.id) && !entry.paused && !entry.needsLogin && !entry.inFlight && entry.retryAt <= now() && !(budget?.accountBudgets?.[entry.account.id]?.cooldownUntil>now());
  }

  function canClick(entry, kind) {
    return !stopRequested && !entry.paused && !entry.needsLogin && entry.modes[kind] && selected.has(entry.account.id) && (!scopeCheck || scopeCheck.probeId===entry.account.id&&scopeCheck.kind===kind);
  }

  function hasBothClickModes(entry) { return entry.modes.case && entry.modes.money; }

  function kindCap(entry,kind) { return hasBothClickModes(entry) ? 950 : kind === 'case' ? 2400 : 1900; }

  function quota(entry,kind) {
    if (!budget || budget.cooldownUntil > now()) return 0;
    const scoped=budget.accountBudgets?.[entry.account.id]||budget;
    if(scoped.cooldownUntil>now())return 0;
    const used = kind === 'case' ? scoped.caseUsed : scoped.moneyUsed;
    const shared = hasBothClickModes(entry) || (kind === 'case' ? scoped.moneyUsed : scoped.caseUsed) > 0;
    return Math.max(0, Math.min(kindCap(entry,kind) - used, shared ? scoped.combinedRemaining ?? Infinity : Infinity));
  }

  function caseLotTarget(entry) {
    if (!entry.clicksPerCase) return null;
    const max = Math.min(1000,kindCap(entry,'case'));
    if (!steadyCaseClicks) return Math.floor(max/entry.clicksPerCase)*entry.clicksPerCase;
    // The current site flushes approximately every ten seconds. Keep whole
    // cases at that cadence, within the account's existing click allowance.
    const cases = Math.max(1,Math.floor(kindCap(entry,'case')*CASE_FLUSH_MS/WINDOW_MS/entry.clicksPerCase));
    return Math.floor(Math.min(max,cases*entry.clicksPerCase)/entry.clicksPerCase)*entry.clicksPerCase;
  }

  function caseLotInterval(entry, clicks) {
    return Math.max(clicks*120,steadyCaseClicks ? Math.ceil(WINDOW_MS*clicks/kindCap(entry,'case')) : 0);
  }

  function batchSize(entry,kind) {
    const available = Math.min(1000,quota(entry,kind));
    return alignCaseClicks && kind === 'case' && entry.clicksPerCase
      ? Math.min(caseLotTarget(entry),Math.floor(available/entry.clicksPerCase)*entry.clicksPerCase) : available;
  }

  function completeClicks(entry,kind) {
    const available = quota(entry,kind);
    return alignCaseClicks && kind === 'case' && entry.clicksPerCase
      ? Math.floor(available / entry.clicksPerCase) * entry.clicksPerCase : available;
  }

  function observePercentage(entry, value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || Math.ceil(100 / value) > 1000) {
      entry.paused = true;
      entry.error = 'Percentagem de caixas indisponível; atualiza esta conta antes de retomar.';
      syncActiveKinds();
      publish({type:'notice',accountId:entry.account.id,message:entry.error});
      persist().catch(()=>publish({type:'notice',message:'A conta foi pausada, mas não foi possível guardar o estado.'}));
      return false;
    }
    entry.casesPerClick = value;
    entry.clicksPerCase = Math.ceil(100 / value);
    entry.percentageReadAt = now();
    return true;
  }

  function clickSpacing(clicks) {
    if (!smoothClicks) return clickIntervalMs;
    let capacity = 0;
    for (const id of selected) {
      const entry = entries.get(id);
      if (!entry || entry.paused || entry.needsLogin) continue;
      if (hasBothClickModes(entry)) capacity += 1900;
      else if (entry.modes.case) capacity += 2400;
      else if (entry.modes.money) capacity += 1900;
    }
    // Keep limited accounts in the configured capacity so their refusal
    // cannot slow dispatch to another route. Budgets still cap each account.
    return Math.max(clickIntervalMs, Math.ceil(WINDOW_MS * clicks / Math.max(1, capacity)));
  }

  function refreshBudget() {
    return coordinator.statusForAccounts ? coordinator.statusForAccounts([...selected]) : coordinator.status();
  }

  function recordResult(entry, kind, result, delta) {
    const confirmedDelta = result.ok && Number.isFinite(delta) && delta >= 0 ? delta : null;
    entry.last = { kind, at: new Date(now()).toISOString(), confirmedDelta, ok: result.ok };
    if (result.ok) {
      if (kind === 'vault' && ++vaultSuccesses >= 10) {
        vaultSuccesses = 0;
        vaultIntervalMs = Math.max(1000, Math.floor(vaultIntervalMs * 0.9));
      } else if (kind !== 'vault' && ++clickSuccesses >= 20) {
        clickSuccesses = 0;
        clickIntervalMs = Math.max(FAST_CLICK_INTERVAL_MS, Math.floor(clickIntervalMs * 0.9));
        if (!smoothClicks) nextClickSendAt = Math.min(nextClickSendAt, now() + clickIntervalMs);
      }
      if (confirmedDelta === null) entry.results.unconfirmedRequests++;
      else { entry.results[kind] += confirmedDelta; entry.results.confirmedRequests++; }
    }
  }

  function observeVault(entry, snapshot) {
    if (entry.pendingVaultCollectedAt) return;
    const due=vaultDueAt(snapshot,now());
    if(due!==null)entry.vaultNextAt=now()+Math.max(1000,due-now());
  }

  function reserveClicks(entry, kind) {
    // Refresh and reserve together: concurrent jobs must not reuse a mode's last share.
    const task = reservationChain.then(async () => {
      while (nextClickSendAt > now() && canClick(entry, kind)) await sleep(Math.min(1000, nextClickSendAt - now()));
      budget = await refreshBudget();
      if (!canClick(entry, kind)) return { clicks: 0 };
      const requested = batchSize(entry,kind);
      if (!requested) return { clicks: 0 };
      const reservation = await coordinator.reserve(kind, requested, () => canClick(entry, kind),entry.account.id);
      if (alignCaseClicks && kind === 'case' && reservation.clicks) {
        const aligned = Math.floor(reservation.clicks / entry.clicksPerCase) * entry.clicksPerCase;
        if (aligned !== reservation.clicks) {
          await coordinator.release(kind, reservation.clicks - aligned, reservation.windowStart, entry.account.id);
          reservation.clicks = aligned;
        }
      }
      if (reservation.clicks) nextClickSendAt = now() + clickSpacing(reservation.clicks);
      budget = await refreshBudget();
      return reservation;
    });
    reservationChain = task.catch(() => {});
    return task;
  }

  function pickJob() {
    if (!order.length) return null;
    if(scopeCheck&&scopeCheck.until<=now())scopeCheck=null;
    if(scopeCheck){
      if(scopeCheck.probeId)return null;
      for(let offset=0;offset<order.length;offset++){
        const index=(cursor+offset)%order.length,entry=entries.get(order[index]);
        if(entry?.account.id!==scopeCheck.sourceId&&eligible(entry)&&entry.modes[scopeCheck.kind]&&quota(entry,scopeCheck.kind)>=scopeCheck.minClicks){scopeCheck.probeId=entry.account.id;return {entry,kind:scopeCheck.kind,index};}
      }
      return null;
    }
    let clickJob = null;
    for (let offset = 0; offset < order.length; offset++) {
      const index = (cursor + offset) % order.length;
      const entry = entries.get(order[index]);
      if (!eligible(entry)) continue;
      const preferred = [entry.nextClickMode, entry.nextClickMode === 'case' ? 'money' : 'case'];
      for (const kind of preferred) {
        if (entry.modes[kind] && !(alignCaseClicks && kind === 'case' && entry.caseNextAt > now()) && batchSize(entry,kind) > 0) { clickJob = { entry, kind, index }; break; }
      }
      if (clickJob) break;
    }
    // A ready vault gets priority, then yields to clicks. One paced vault job
    // leaves the other worker slots free instead of draining every vault first.
    if (!vaultInFlight && nextVaultDispatchAt <= now() && (!clickJob || lastJobKind !== 'vault')) {
      for (let offset = 0; offset < order.length; offset++) {
        const index = (cursor + offset) % order.length;
        const entry = entries.get(order[index]);
        if (eligible(entry) && entry.modes.vault && entry.vaultNextAt <= now()) return { entry, kind: 'vault', index };
      }
    }
    return clickJob;
  }

  function nextCaseWakeDelay() {
    if (!steadyCaseClicks) return null;
    let delay = null;
    for (const id of selected) {
      const entry = entries.get(id);
      if (eligible(entry) && entry.modes.case && completeClicks(entry,'case') > 0 && entry.caseNextAt > now()) {
        const remaining = entry.caseNextAt - now();
        delay = delay === null ? remaining : Math.min(delay, remaining);
      }
    }
    return delay;
  }

  function slowSharedTraffic() {
    clickSuccesses=vaultSuccesses=0;
    clickIntervalMs=Math.min(8000,clickIntervalMs*2);
    vaultIntervalMs=Math.min(15000,vaultIntervalMs*2);
  }

  async function inconclusiveScope(message) {
    if(!scopeCheck)return;
    const check=scopeCheck;scopeCheck=null;
    slowSharedTraffic();
    const until=await coordinator.limit(check.until);budget=await refreshBudget();
    publish({type:'cooldown',accountId:check.sourceId,operation:check.kind,stage:'request',httpStatus:429,scope:'global',until,message});
    try {await persist();}catch {publish({type:'notice',message:'A pausa foi aplicada, mas não foi possível guardar o ritmo aprendido.'});}
  }

  async function serverLimit(entry, operation, stage, response, failedClicks) {
    const deadline=now()+parseRetryAfter(response.retryAfter,now());
    const accountOnly=accountClickLimits&&stage==='request'&&['case','money'].includes(operation);
    const canCheck=!accountOnly&&verifyAccountLimits&&!stopRequested&&!scopeCheck&&stage==='request'&&['case','money'].includes(operation)&&Number.isSafeInteger(failedClicks)&&[...selected].some(id=>{const other=entries.get(id);return id!==entry.account.id&&other&&!other.paused&&!other.needsLogin&&other.modes[operation]&&quota(other,operation)>=failedClicks;});
    let until;
    if(accountOnly){
      // A refused account cannot change the dispatch pace of other accounts.
      until=await coordinator.limit(deadline,entry.account.id);
    }else if(canCheck){
      scopeCheck={sourceId:entry.account.id,kind:operation,minClicks:failedClicks,until:deadline,probeId:null};
      until=await coordinator.limit(deadline,entry.account.id);
    }else{
      const sharedDeadline=Math.max(deadline,scopeCheck?.until||0);
      scopeCheck=null;
      if(limitGroup)until=await limitGroup(sharedDeadline,entry.account.id);
      else {slowSharedTraffic();until=await coordinator.limit(sharedDeadline);}
    }
    budget = await refreshBudget();
    const name = {case:'Caixas',money:'Dinheiro',vault:'Cofre'}[operation];
    const endpoint=['/api/me','/api/cases'].includes(response.endpoint)?response.endpoint:stage==='request'?{case:'/api/caseClick',money:'/api/click',vault:'/api/vault'}[operation]:'';
    publish({ type:'cooldown',accountId:entry.account.id,operation,stage,httpStatus:429,until,endpoint,scope:accountOnly||canCheck||limitGroup?'account':'global',message:`${name} · ${stage === 'read' ? 'leitura' : 'pedido'} recebeu HTTP 429${endpoint?` em ${endpoint}`:''}; ${accountOnly?'esta conta aguarda o prazo indicado; as restantes continuam no seu ritmo.':canCheck?'esta conta aguarda o prazo indicado. A verificar um lote noutra conta.':limitGroup?'as contas desta ligação aguardam; as outras ligações continuam.':'todos os pedidos aguardam o prazo indicado pelo servidor.'}` });
    try {await persist();}
    catch {
      if(scopeCheck)await inconclusiveScope('Não foi possível guardar a verificação; a pausa geral mantém-se.');
      publish({type:'notice',message:'O limite foi aplicado, mas não foi possível guardar o estado da execução.'});
    }
  }

  function failEntry(entry, error, operation, stage) {
    if (error?.status === 401 || error?.status === 403) {
      entry.needsLogin = true;
      entry.error = 'Sessão expirada; inicia sessão de novo.';
      publish({ type: 'needs-login', accountId: entry.account.id, message: entry.error });
      return;
    } else {
      entry.failures++;
      if (entry.failures >= 3) {entry.paused = true;entry.retryAt=0;}
      else entry.retryAt = now() + RETRY_DELAYS[entry.failures - 1];
    }
    const details=safeFailure({...failureDetails(error),operation,stage,failures:entry.failures,paused:entry.paused,retryAt:entry.retryAt});
    entry.error=details.message;
    publish({ type: 'account-error', accountId: entry.account.id, ...details });
    if (entry.paused) persist().catch(() => {});
  }

  async function performClick(entry, kind) {
    const id = entry.account.id;
    const api = apiForAccount(entry.account);
    let stage='read';
    try {
      if (!canClick(entry, kind) || await coordinator.cooldown(id) > now()) return;
      const refreshPercentage = alignCaseClicks && kind === 'case' && (entry.percentageReadAt === null || now() - entry.percentageReadAt >= 60000);
      const before = await (refreshPercentage ? snapshots.read(entry.account, { fresh: true }) : snapshots.readForFarm ? snapshots.readForFarm(entry.account,kind) : snapshots.read(entry.account, { fresh: true }));
      if (refreshPercentage && !observePercentage(entry, before?.casesPerClick)) return;
      if(kind==='money')observeVault(entry,before);
      if (!canClick(entry, kind)) return;
      const cooldown = await coordinator.cooldown(id);
      if (cooldown > now() || !canClick(entry, kind)) return;
      const reservation = await reserveClicks(entry, kind);
      if (!reservation.clicks) return;
      if(scopeCheck?.probeId===id&&reservation.clicks<scopeCheck.minClicks){
        await coordinator.release(kind,reservation.clicks,reservation.windowStart,id);
        return;
      }
      const sendCooldown=await coordinator.cooldown(id);
      if (sendCooldown > now() || !canClick(entry, kind)) {
        await coordinator.release(kind, reservation.clicks, reservation.windowStart,id);
        return;
      }
      stage='request';
      if (alignCaseClicks && kind === 'case') {
        // Retain the site's 120ms-per-click pace on this account even when
        // its local budget rolls over. Other accounts have their own clock.
        entry.caseNextAt = now() + caseLotInterval(entry,reservation.clicks);
        await persist();
        if (!canClick(entry,kind) || await coordinator.cooldown(id) > now()) {
          await coordinator.release(kind,reservation.clicks,reservation.windowStart,id);
          return;
        }
      }
      const result = kind === 'case' ? await api.generate(reservation.clicks) : await api.clickMoney(reservation.clicks);
      if (alignCaseClicks && kind === 'case' && result.ok && typeof result.casesPerClick === 'number' && result.casesPerClick > 0) observePercentage(entry, result.casesPerClick);
      if (!accountClickLimits || result.status !== 429) entry.nextClickMode = kind === 'case' ? 'money' : 'case';
      if (result.status === 429) {
        await serverLimit(entry, kind, stage, result,reservation.clicks);
        if(accountClickLimits){
          // An explicit refusal consumed no clicks. Keep its server deadline,
          // but do not postpone the retry with a second, local budget penalty.
          // Accepted or ambiguous requests always retain their reservations.
          try { await coordinator.release(kind,reservation.clicks,reservation.windowStart,id); }
          catch { publish({type:'notice',message:'O prazo do servidor mantém-se; não foi possível repor o orçamento do lote recusado.'}); }
          budget=await refreshBudget();
        }
      }
      if (result.status === 401 || result.status === 403) entry.needsLogin = true;
      if (entry.needsLogin) publish({ type: 'needs-login', accountId: id, message: 'Sessão expirada; inicia sessão de novo.' });
      if (!accountClickLimits || result.status !== 429) snapshots.invalidate(id);
      let after = null;
      if (result.ok && await coordinator.cooldown(id) <= now()) {
        try { after = await (snapshots.readForFarm ? snapshots.readForFarm(entry.account,kind,before) : snapshots.read(entry.account, { fresh: true })); }
        catch (error) { if (error?.status === 429) await serverLimit(entry, kind, 'read', error); }
      }
      const verifiedDelta = before && after ? (kind === 'case' ? after.casesTotal - before.casesTotal : after.money - before.money) : null;
      if(kind==='money'&&after)observeVault(entry,after);
      if(result.ok&&scopeCheck?.probeId===id&&scopeCheck.kind===kind){
        const check=scopeCheck;scopeCheck=null;
        publish({type:'cooldown',accountId:check.sourceId,operation:kind,stage:'request',httpStatus:429,scope:'account',verifiedScope:true,until:check.until,message:'Outra conta aceitou um lote igual ou maior. A conta limitada aguarda; as restantes continuam.'});
      }
      const award = kind === 'case' ? inferCaseAward(before, after, result) : { caseId: '', caseName: '' };
      if (result.ok) { entry.failures = 0; entry.error = ''; }
      else if (result.status === 401 || result.status === 403) entry.error = 'Sessão expirada; inicia sessão de novo.';
      else if (result.status !== 429 && result.status !== 401 && result.status !== 403) failEntry(entry, Object.assign(new Error(),{status:result.status}), kind, stage);
      recordResult(entry, kind, result, verifiedDelta);
      publish({ type: 'request', kind, accountId: id, clicks: reservation.clicks, httpStatus: result.status, verifiedDelta: entry.last.confirmedDelta, snapshot: after, awardedCount: Number(result.awardedCount || 0), caseId: award.caseId, caseName: award.caseName });
      try { await persist(); }
      catch { publish({ type: 'notice', message: 'O resultado foi processado, mas não foi possível guardar o próximo modo desta conta para uma futura execução.' }); }
    } catch (error) {
      if(error?.code==='FARM_COOLDOWN')return;
      if (error?.status === 429) await serverLimit(entry, kind, stage, error);
      else failEntry(entry, error, kind, stage);
    } finally {
      if(scopeCheck?.probeId===id)await inconclusiveScope('Não foi possível concluir a verificação noutra conta. A pausa geral mantém-se até ao prazo indicado.');
    }
  }

  async function performVault(entry) {
    const id = entry.account.id;
    const api = apiForAccount(entry.account);
    let stage='read';
    try {
      if (stopRequested || scopeCheck || entry.paused || entry.needsLogin || !selected.has(id) || await coordinator.cooldown(id) > now()) return;
      const before = await api.vaultSnapshot();
      if (entry.pendingVaultCollectedAt) {
        if (before.vaultLastCollected === entry.pendingVaultCollectedAt) {
          entry.vaultNextAt = now() + 300000;
          return;
        }
        entry.pendingVaultCollectedAt = null;
        await persist();
      }
      const serverNow = before.serverNow ? Date.parse(before.serverNow) : now();
      const due = vaultDueAt(before, serverNow);
      if (due === null) {
        entry.vaultNextAt = now() + 300000;
        entry.error = 'Dados do cofre indisponíveis.';
        return;
      }
      if (!shouldCollectVault(before, serverNow)) {
        entry.vaultNextAt = now() + Math.max(1000, due - serverNow);
        return;
      }
      if (stopRequested || scopeCheck || entry.paused || !entry.modes.vault || !selected.has(id)) return;
      if (scopeCheck || await coordinator.cooldown(id) > now()) return;
      if (stopRequested || scopeCheck || entry.paused || !entry.modes.vault || !selected.has(id)) return;
      stage='request';
      nextVaultDispatchAt = Math.max(nextVaultDispatchAt, now() + vaultIntervalMs);
      const result = await api.collectVault();
      if (result.status === 429) await serverLimit(entry, 'vault', stage, result);
      if (result.status === 401 || result.status === 403) entry.needsLogin = true;
      if (entry.needsLogin) publish({ type: 'needs-login', accountId: id, message: 'Sessão expirada; inicia sessão de novo.' });
      snapshots.invalidate(id);
      let after = null;
      if (result.ok && await coordinator.cooldown(id) <= now()) {
        try { after = await api.vaultSnapshot(); }
        catch (error) { if (error?.status === 429) await serverLimit(entry, 'vault', 'read', error); }
      }
      const confirmedDelta = result.ok && after && after.vaultLastCollected !== before.vaultLastCollected && after.money > before.money ? after.money - before.money : null;
      if (result.ok && (!after || after.vaultLastCollected === before.vaultLastCollected)) {
        entry.pendingVaultCollectedAt = before.vaultLastCollected;
      }
      if (result.ok) { entry.failures = 0; entry.error = ''; }
      else if (result.status !== 429 && result.status !== 401 && result.status !== 403) failEntry(entry, Object.assign(new Error(),{status:result.status}), 'vault', stage);
      const nextServerNow = after?.serverNow ? Date.parse(after.serverNow) : now();
      const nextDue = after ? vaultDueAt(after, nextServerNow) : null;
      entry.vaultNextAt = entry.pendingVaultCollectedAt || nextDue === null ? now() + 300000 : now() + Math.max(1000, nextDue - nextServerNow);
      recordResult(entry, 'vault', result, confirmedDelta);
      publish({ type: 'vault', accountId: id, httpStatus: result.status, confirmedDelta });
      try { await persist(); }
      catch { publish({ type: 'notice', message: 'O resultado do cofre foi processado, mas não foi possível guardar a confirmação pendente para uma futura execução.' }); }
    } catch (error) {
      if (error?.status === 429) await serverLimit(entry, 'vault', stage, error);
      else failEntry(entry, error, 'vault', stage);
    }
  }

  async function run(accountIds) {
    await ready();
    if (stopRequested) { phase = 'stopped'; return status(); }
    if (!Array.isArray(accountIds) || !accountIds.length || accountIds.some((id) => !entries.has(id)) || new Set(accountIds).size !== accountIds.length) throw new Error('Seleciona contas válidas e diferentes');
    selected = new Set(accountIds);
    vaultInFlight = false;
    lastJobKind = null;
    for (const entry of entries.values()) { entry.results = emptyResults(); entry.last = null; }
    phase = 'running';
    syncActiveKinds();
    publish({ type: 'farm-started' });
    const active = new Set();
    try {
      while (!stopRequested) {
        budget = await refreshBudget();
        if (budget.cooldownUntil > now()) {
          if (active.size) await Promise.race(active);
          else await sleep(Math.min(1000, budget.cooldownUntil - now()));
          continue;
        }
        if (active.size >= maxInFlight) { await Promise.race(active); continue; }
        const job = pickJob();
        if (!job) {
          const caseWakeDelay = nextCaseWakeDelay();
          if (active.size) {
            // A pending request owns only its own slot. Wake for another
            // account's clock when a worker is free; never replay the request.
            await Promise.race(caseWakeDelay === null ? active : [...active, sleep(Math.max(1,Math.min(1000,caseWakeDelay)))]);
            continue;
          }
          if(scopeCheck){await inconclusiveScope('Nenhuma outra conta tem um lote equivalente disponível. A pausa geral mantém-se até ao prazo indicado.');continue;}
          const possible = [...selected].some((id) => {
            const entry = entries.get(id);
            return entry && !entry.paused && !entry.needsLogin && Object.values(entry.modes).some(Boolean);
          });
          if (!possible) break;
          const idleWait=caseWakeDelay === null ? 1000 : Math.min(1000,caseWakeDelay);
          await sleep(Math.max(1,idleWait));
          continue;
        }
        const { entry, kind, index } = job;
        entry.inFlight = true;
        lastJobKind = kind;
        if (kind === 'vault') { vaultInFlight = true; nextVaultDispatchAt = now() + vaultIntervalMs; }
        cursor = (index + 1) % order.length;
        if (kind !== 'vault') nextMode = kind === 'case' ? 'money' : 'case';
        await persist();
        const task = accountQueue.run(entry.account.id, () => kind === 'vault' ? performVault(entry) : performClick(entry, kind)).catch((error) => failEntry(entry, error, kind, 'request')).finally(() => { entry.inFlight = false; if (kind === 'vault') vaultInFlight = false; active.delete(task); });
        active.add(task);
      }
      await Promise.allSettled(active);
      await saveChain.catch(() => {});
    } finally {
      if(scopeCheck)await inconclusiveScope('A verificação foi interrompida. A pausa geral mantém-se até ao prazo indicado.');
      phase = stopRequested ? 'stopped' : 'complete';
      for(const id of entries.keys()){coordinator.deactivate('case',id);coordinator.deactivate('money',id);}
      const blocked=!stopRequested&&[...selected].every(id=>{const entry=entries.get(id);return entry?.paused||entry?.needsLogin;});
      publish({ type: 'farm-finished', ...(blocked?{reason:'accounts-unavailable',message:'Nenhuma conta selecionada está disponível. Verifica a sessão ou usa Atualizar e Retomar em Automação.'}:{}) });
      runPromise = null;
    }
    return status();
  }

  return {
    ready,
    start(accountIds) {
      if (runPromise) throw new Error('A automação já está ativa');
      const network = networkStatus?.();
      if (network?.configured && network.connections === 1 && network.unavailableProxies > 0) throw new Error('Nenhum proxy configurado está disponível. Reinicia a app para verificar as ligações antes de iniciar.');
      stopRequested = false;
      runPromise = run(accountIds);
      const current = runPromise;
      current.finally(() => { if (runPromise === current) runPromise = null; }).catch(() => {});
      return runPromise;
    },
    stop() { stopRequested = true; if (phase === 'running') phase = 'stopping'; publish({ type: 'farm-stopping' }); return status(); },
    async syncAccounts(accounts) {
      await ready();
      const next = new Map(accounts.map((account) => [account.id, account]));
      for (const id of entries.keys()) if (!next.has(id)) { entries.delete(id); selected.delete(id); }
      for (const account of accounts) {
        if (entries.has(account.id)) entries.get(account.id).account = account;
        else entries.set(account.id, makeEntry(account));
      }
      order = accounts.map((account) => account.id);
      cursor = order.length ? cursor % order.length : 0;
      syncActiveKinds();
      await persist();
      return status();
    },
    async setModes(id, modes) {
      await ready();
      const entry = entries.get(id);
      if (!entry || !modes || MODE_KEYS.some((kind) => typeof modes[kind] !== 'boolean')) throw new Error('Modos inválidos');
      entry.modes = { ...modes };
      syncActiveKinds();
      await persist();
      return status();
    },
    async pause(id) {
      await ready();
      const entry = entries.get(id);
      if (!entry) throw new Error('Conta não encontrada');
      entry.paused = true;
      syncActiveKinds();
      await persist();
      return status();
    },
    async resume(id) {
      await ready();
      const entry = entries.get(id);
      if (!entry) throw new Error('Conta não encontrada');
      entry.paused = false;
      entry.needsLogin = false;
      entry.failures = 0;
      entry.retryAt = 0;
      entry.error = '';
      syncActiveKinds();
      await persist();
      return status();
    },
    status,
  };
}

module.exports = { createFarmOrchestrator };
