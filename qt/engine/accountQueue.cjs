function createAccountQueue() {
  const tails = new Map();
  return {
    run(accountId, work) {
      if (typeof accountId !== 'string' || !accountId || typeof work !== 'function') throw new TypeError('Fila de conta inválida');
      const previous = tails.get(accountId) || Promise.resolve();
      const next = previous.catch(() => {}).then(work);
      tails.set(accountId, next);
      next.finally(() => { if (tails.get(accountId) === next) tails.delete(accountId); }).catch(() => {});
      return next;
    },
  };
}

module.exports = { createAccountQueue };
