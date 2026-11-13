export function createAccountRefreshQueue({ refreshAccount, delayMs = 650, maxConcurrent = 4 }) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4) throw new TypeError('Número de leituras inválido');
  let active = null;
  let stopped = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    run(accounts) {
      if (active) return active;
      stopped = false;
      active = (async () => {
        let cursor = 0;
        const read = async () => {
          while (!stopped && cursor < accounts.length) {
            const account = accounts[cursor++];
            try { await refreshAccount(account.id); }
            catch (error) { stopped = true; throw error; }
            if (delayMs && !stopped && cursor < accounts.length) await sleep(delayMs);
          }
        };
        const results = await Promise.allSettled(Array.from({ length: Math.min(maxConcurrent, accounts.length) }, read));
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
      })().finally(() => { active = null; });
      return active;
    },
    stop() { stopped = true; },
  };
}
