const CACHE_MS = 30000;
const {parseRetryAfter}=require('./scheduler.cjs');

function createAccountSnapshots({ apiForAccount, coordinator, limitGroup, now = Date.now, maxConcurrent = 4 }) {
  if (typeof apiForAccount !== 'function' || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) throw new TypeError('Leitor de contas inválido');
  const cache = new Map();
  const pending = new Map();
  const versions = new Map();
  const queue = [];
  let active = 0;

  function pump() {
    while (active < maxConcurrent && queue.length) {
      const job = queue.shift();
      active++;
      Promise.resolve().then(async () => {
        if(coordinator && await coordinator.cooldown(job.account.id)>now())throw Object.assign(Error('Pedidos suspensos pelo servidor; aguarda o prazo indicado.'),{code:'FARM_COOLDOWN'});
        const api=apiForAccount(job.account);
        return job.kind && api.farmSnapshot ? api.farmSnapshot(job.kind,job.previous) : api.snapshot();
      }).then((snapshot) => {
        if (versions.get(job.account.id) === job.version) cache.set(job.account.id, { value: snapshot, at: now(), complete:!job.kind });
        job.resolve(snapshot);
      }, async error => {
        if(error?.status===429&&coordinator){
          const until=now()+parseRetryAfter(error.retryAfter,now());
          await (limitGroup ? limitGroup(until,job.account.id) : coordinator.limit(until)).catch(()=>{});
        }
        if(pending.get(job.account.id)?.promise===job.promise)pending.delete(job.account.id);
        job.reject(error);
      }).finally(() => {
        if (pending.get(job.account.id)?.promise === job.promise) pending.delete(job.account.id);
        active--;
        pump();
      });
    }
  }

  function forget(accountId) {
    versions.set(accountId, (versions.get(accountId) || 0) + 1);
    cache.delete(accountId);
    pending.delete(accountId);
  }

  function read(account, { fresh = false, kind, previous } = {}) {
      if (!account || typeof account.id !== 'string' || !account.id) return Promise.reject(new TypeError('Conta inválida'));
      const cached = cache.get(account.id);
      if (!fresh && cached?.complete && now() - cached.at < CACHE_MS) return Promise.resolve(cached.value);
      const baseline=previous||cached?.value;
      const resource=kind&&baseline?kind:undefined;
      const current = pending.get(account.id);
      if (current && current.kind===resource && (!fresh || current.fresh)) return current.promise;
      const version = (versions.get(account.id) || 0) + 1;
      versions.set(account.id, version);
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      queue.push({ account, version, promise, resolve, reject, kind:resource, previous:baseline });
      pending.set(account.id, { promise, fresh, kind:resource });
      pump();
      return promise;
  }
  return {
    read,
    readForFarm(account,kind,previous) {
      if(!['case','money'].includes(kind))return Promise.reject(new TypeError('Operação de farm inválida'));
      return read(account,{fresh:true,kind,previous});
    },
    invalidate: forget,
    invalidateForEvent(event) {
      // Farm mutations invalidate before their confirmation read. Keep that
      // fresh cache; other mutation producers still require invalidation here.
      if (!['open','conversion','game','account-added','inventory-action','token-converter','progression'].includes(event.type)) return;
      const id=event.accountId||event.account?.id;
      if(id)forget(id);
      if(event.destinationAccountId)forget(event.destinationAccountId);
    },
    remove: forget,
  };
}

module.exports = { createAccountSnapshots };
