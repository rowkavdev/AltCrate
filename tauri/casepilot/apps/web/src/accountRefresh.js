export function createAccountRefreshQueue({ refreshAccount, delayMs = 650, maxConcurrent = 4, continueOnError = false, maxConsecutiveErrors = Infinity, onProgress = () => {}, now = Date.now }) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4) throw new TypeError('Número de leituras inválido');
  let active = null, stopped = false, state = { phase: 'idle', total: 0, processed: 0, succeeded: 0, failed: 0 };
  const waiting = new Set();
  const publish = patch => { state = { ...state, ...patch }; onProgress({ ...state }); };
  const wake = () => { for (const resolve of [...waiting]) resolve(); };
  const wait = () => new Promise(resolve => {
    const finish = () => { clearTimeout(timer); waiting.delete(finish); resolve(); };
    const timer = setTimeout(finish, delayMs); waiting.add(finish);
  });
  return {
    status: () => ({ ...state }),
    run(accounts) {
      if (active) return active;
      stopped = false;
      publish({ phase: 'running', total: accounts.length, processed: 0, succeeded: 0, failed: 0, currentId: null, error: null, retryAt: 0, errorStatus: 0, startedAt: now(), finishedAt: null });
      active = (async () => {
        let cursor = 0, failure = null, consecutiveErrors = 0, errorPriority = 0, failurePriority = 0;
        const read = async () => {
          while (!stopped && cursor < accounts.length) {
            const account = accounts[cursor++]; publish({ currentId: account.id });
            try { await refreshAccount(account.id); consecutiveErrors = 0; publish({ processed: state.processed + 1, succeeded: state.succeeded + 1 }); }
            catch (error) {
              consecutiveErrors++;
              const sharedLimit = error.status === 429 || error.status === 403 || error.code === 'FARM_COOLDOWN' || error.retryAt > now();
              const priority = error.status === 429 || error.code === 'FARM_COOLDOWN' || error.retryAt > now() ? 3 : error.status === 403 ? 2 : 1;
              const detail = priority >= errorPriority ? { error: String(error.message || error), errorStatus: Number(error.status) || 0 } : {};
              errorPriority = Math.max(errorPriority, priority);
              // A later, unrelated in-flight failure must not erase the server's retry deadline.
              publish({ processed: state.processed + 1, failed: state.failed + 1, ...detail, retryAt: Math.max(state.retryAt || 0, Number(error.retryAt) || 0) });
              if (!continueOnError || sharedLimit || consecutiveErrors >= maxConsecutiveErrors) { if (priority >= failurePriority) { failure = error; failurePriority = priority; } stopped = true; wake(); }
            }
            if (delayMs && !stopped && cursor < accounts.length) await wait();
          }
        };
        await Promise.all(Array.from({ length: Math.min(maxConcurrent, accounts.length) }, read));
        publish({ phase: failure ? 'paused' : stopped ? 'stopped' : 'complete', currentId: null, finishedAt: now() });
        if (failure && !continueOnError) throw failure;
        return { ...state };
      })().finally(() => { active = null; });
      return active;
    },
    stop() { if (!active) return; stopped = true; publish({ phase: 'stopping' }); wake(); },
  };
}
