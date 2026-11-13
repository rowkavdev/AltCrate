function createAccountSummaryReader({ listAccounts, read, cooldown, now = Date.now }) {
  return async function refresh(id, options) {
    try {
      const account = (await listAccounts()).find(account => account.id === id);
      if (!account) throw Object.assign(Error('Conta não encontrada.'), { code: 'ACCOUNT_NOT_FOUND' });
      const snapshot = await read(account);
      if(!snapshot || snapshot.error || !['money','tokens','casesTotal'].some(key=>Number.isFinite(snapshot[key])))throw Error('Leitura indisponível.');
      return options?.structured === true ? { ok: true, snapshot } : snapshot;
    } catch (error) {
      if (options?.structured !== true) throw error;
      const status = Number.isInteger(error.status) ? error.status : error.code === 'FARM_COOLDOWN' ? 429 : 0;
      const retryAt = status === 429 ? Math.max(Number(error.retryAt) || 0, Number(await cooldown(id)) || 0, now() + 1000) : 0;
      const message = error.code === 'ACCOUNT_NOT_FOUND' ? 'Conta não encontrada.' : status === 429 ? 'O site limitou as leituras. Aguarda o prazo indicado.' : status === 403 ? 'O site pede verificação de acesso nesta sessão.' : status === 401 ? 'A sessão desta conta expirou.' : status ? `Não foi possível ler esta conta (HTTP ${status}).` : 'Não foi possível ler esta conta. Tenta novamente mais tarde.';
      return { ok: false, error: { message, status, retryAt, code: status === 429 ? 'READ_COOLDOWN' : status === 403 ? 'ACCESS_VERIFICATION' : 'READ_FAILED' } };
    }
  };
}
module.exports = { createAccountSummaryReader };
