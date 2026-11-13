const budget = require('./clickBudget.cjs');

function createClickCoordinator({ store, now = Date.now }) {
  if (!store?.load || !store?.save) throw new TypeError('Armazenamento do orçamento obrigatório');
  let state;
  const accountStates = new Map();
  const connectionHolds = new Map();
  let chain = Promise.resolve();
  const active = new Map();
  function loadState(saved){
    state=budget.cleanState(saved);accountStates.clear();connectionHolds.clear();
    for(const [id,value] of Object.entries(saved?.accountBudgets||{}))accountStates.set(id,budget.cleanState(value));
    for(const [key,until] of Object.entries(saved?.connectionHolds||{}))if(/^[a-z0-9-]{1,64}$/.test(key)&&Number.isFinite(until)&&until>now())connectionHolds.set(key,until);
  }
  const serialized = (work) => {
    const next = chain.then(async () => {
      if (!state) {
        const saved=await store.load();
        loadState(saved);
      }
      return work();
    });
    chain = next.catch(() => {});
    return next;
  };
  function bucketFor(accountId) {
    if(accountId===undefined)return state;
    if(typeof accountId!=='string'||!accountId||accountId.length>128)throw TypeError('Conta do orçamento inválida');
    // An old reservation cannot be attributed to an account. Retain it in
    // each new scope until its original window expires, rather than reset it.
    if(!accountStates.has(accountId))accountStates.set(accountId,budget.cleanState(state));
    const scoped=accountStates.get(accountId);
    scoped.cooldownUntil=Math.max(scoped.cooldownUntil,state.cooldownUntil);
    return scoped;
  }
  function setBucket(accountId,value) {
    if(accountId===undefined)state=value;
    else accountStates.set(accountId,value);
  }
  function save() { return store.save({...state,accountBudgets:Object.fromEntries(accountStates),connectionHolds:Object.fromEntries(connectionHolds)}); }
  function validateGroup(until, accountIds) {
    if (!Number.isFinite(until) || !Array.isArray(accountIds) || !accountIds.length || accountIds.length > 100 || accountIds.some(id => typeof id !== 'string' || !id || id.length > 128)) throw TypeError('Grupo de contas inválido');
  }
  function holdGroup(until, accountIds) {
    let deadline = until;
    for (const id of new Set(accountIds)) {
      const scoped = budget.afterLimit(bucketFor(id), until);
      setBucket(id, scoped); deadline = Math.max(deadline, scoped.cooldownUntil);
    }
    return deadline;
  }
  function readStatus(accountId) {
    const kinds=active.get(accountId),simultaneous=(kinds?.size||0)>1;
    const caseAvailability=budget.availability(bucketFor(accountId),'case',now(),simultaneous);
    const moneyAvailability=budget.availability(caseAvailability.state,'money',now(),simultaneous);
    setBucket(accountId,moneyAvailability.state);
    const scoped=moneyAvailability.state;
    const resetAt = kind => scoped.budgets[kind].windowStart ? scoped.budgets[kind].windowStart + budget.WINDOW_MS : 0;
    return {caseUsed:scoped.budgets.case.used,moneyUsed:scoped.budgets.money.used,caseResetAt:resetAt('case'),moneyResetAt:resetAt('money'),combinedUsed:scoped.combined.used,caseRemaining:Math.max(0,budget.LIMITS.case-scoped.budgets.case.used),moneyRemaining:Math.max(0,budget.LIMITS.money-scoped.budgets.money.used),combinedRemaining:Math.max(0,budget.COMBINED_LIMIT-scoped.combined.used),cooldownUntil:scoped.cooldownUntil>now()?scoped.cooldownUntil:0,waitUntil:Math.max(caseAvailability.waitUntil,moneyAvailability.waitUntil)};
  }
  return {
    restore(saved){return serialized(async()=>{loadState(saved);await save();});},
    status(accountId) { return serialized(async () => readStatus(accountId)); },
    statusForAccounts(accountIds) {
      return serialized(async()=>{
        const accountBudgets=Object.fromEntries([...new Set(accountIds)].map(id=>[id,readStatus(id)]));
        const totals={caseUsed:0,moneyUsed:0,combinedUsed:0,caseRemaining:0,moneyRemaining:0,combinedRemaining:0};
        const statuses=Object.values(accountBudgets);
        for(const value of statuses)for(const key of Object.keys(totals))totals[key]+=value[key];
        const waits=statuses.map(value=>value.waitUntil).filter(until=>until>now());
        const cooldownUntil=state.cooldownUntil>now()?state.cooldownUntil:0;
        return {...totals,accountBudgets,cooldownUntil,waitUntil:cooldownUntil||(waits.length?Math.min(...waits):0)};
      });
    },
    activate(kind,accountId) { if(!active.has(accountId))active.set(accountId,new Set());active.get(accountId).add(kind); },
    deactivate(kind,accountId) { active.get(accountId)?.delete(kind); },
    cooldown(accountId) { return serialized(async () => {const until=bucketFor(accountId).cooldownUntil;return until>now()?until:0;}); },
    availability(kind,accountId) {
      return serialized(async () => {
        const result = budget.availability(bucketFor(accountId), kind, now(), (active.get(accountId)?.size||0) > 1);
        setBucket(accountId,result.state);
        return { remaining: result.remaining, waitUntil: result.waitUntil, cooldownUntil: result.state.cooldownUntil };
      });
    },
    reserve(kind, clicks, canSend = () => true, accountId) {
      return serialized(async () => {
        if (!canSend()) return { clicks: 0, remaining: 0, waitUntil: 0, cooldownUntil: state.cooldownUntil };
        const previous = budget.cleanState(bucketFor(accountId));
        const result = budget.reserve(previous, kind, clicks, now(), (active.get(accountId)?.size||0) > 1);
        setBucket(accountId,result.state);
        if (result.clicks) await save();
        if (result.clicks && !canSend()) {
          setBucket(accountId,previous);
          await save();
          return { clicks: 0, remaining: 0, waitUntil: 0, cooldownUntil: state.cooldownUntil };
        }
        return { clicks: result.clicks, remaining: result.remaining, waitUntil: result.waitUntil, cooldownUntil: result.state.cooldownUntil, windowStart: result.state.budgets[kind].windowStart };
      });
    },
    release(kind, clicks, windowStart, accountId) {
      return serialized(async () => {
        const scoped=bucketFor(accountId);
        if (clicks > 0 && scoped.budgets[kind]?.windowStart === windowStart) {
          scoped.budgets[kind].used = Math.max(0, scoped.budgets[kind].used - clicks);
          scoped.combined.used = Math.max(0, scoped.combined.used - clicks);
          await save();
        }
      });
    },
    limitAccounts(until, accountIds) {
      return serialized(async () => {
        validateGroup(until,accountIds);
        const deadline=holdGroup(until,accountIds);
        await save();
        return deadline;
      });
    },
    limitRoute(key, until, accountIds) {
      return serialized(async () => {
        if(typeof key!=='string'||!/^[a-z0-9-]{1,64}$/.test(key))throw TypeError('Ligação inválida');
        validateGroup(until,accountIds);
        const deadline=Math.max(until,connectionHolds.get(key)||0);
        connectionHolds.set(key,deadline);
        holdGroup(deadline,accountIds);
        await save();
        return deadline;
      });
    },
    inheritRoute(key, accountId) {
      return serialized(async () => {
        if(typeof key!=='string'||!/^[a-z0-9-]{1,64}$/.test(key))throw TypeError('Ligação inválida');
        const until=connectionHolds.get(key)||0;
        if(until<=now())return 0;
        const scoped=bucketFor(accountId);
        if(scoped.cooldownUntil<until){setBucket(accountId,budget.afterLimit(scoped,until));await save();}
        return until;
      });
    },
    limit(until,accountId) {
      return serialized(async () => {
        if(accountId!==undefined){const scoped=budget.afterLimit(bucketFor(accountId),until);setBucket(accountId,scoped);await save();return scoped.cooldownUntil;}
        state = budget.afterLimit(state, until);
        for(const [id,value] of accountStates)accountStates.set(id,budget.afterLimit(value,state.cooldownUntil));
        await save();
        return state.cooldownUntil;
      });
    },
  };
}

module.exports = { createClickCoordinator };
