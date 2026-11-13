const { randomUUID } = require('node:crypto');
const MAX_ACCOUNTS = 100;
function publicAccount(account) {
  const { id, label, partition, addedAt, email } = account;
  return { id, label, partition, addedAt, ...(email ? { email, hasPassword: Boolean(account.protectedPassword) } : {}) };
}
function importRows(value) {
  const rows = Array.isArray(value) ? value : value?.accounts;
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ACCOUNTS) throw Error('O JSON deve conter entre 1 e 100 contas em accounts.');
  const emails = new Set(), labels = new Set();
  return rows.map((row, index) => {
    const email = typeof row?.email === 'string' ? row.email.trim().toLowerCase() : '';
    const label = typeof row?.label === 'string' && row.label.trim() ? row.label.trim() : email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || /[\x00-\x1f]/.test(email)) throw Error(`Email inválido na conta ${index + 1}.`);
    if (!label || label.length > 40 || /[\x00-\x1f]/.test(label)) throw Error(`Nome inválido na conta ${index + 1} (máximo de 40 caracteres).`);
    if (row.password != null && (typeof row.password !== 'string' || row.password.length > 1024)) throw Error(`Palavra-passe inválida na conta ${index + 1}.`);
    if (emails.has(email) || labels.has(label.toLowerCase())) throw Error(`Conta repetida na posição ${index + 1}.`);
    emails.add(email); labels.add(label.toLowerCase());
    return { email, label, password: row.password || null };
  });
}

function createAccountRegistry(storage) {
  let accounts = [];
  let readyPromise;
  const ready = () => {
    if (!readyPromise) readyPromise = Promise.resolve(storage.load()).then((value) => {
      accounts = Array.isArray(value) ? value.filter((item) =>
        typeof item?.id === 'string' && typeof item?.label === 'string' &&
        typeof item?.partition === 'string') : [];
    });
    return readyPromise;
  };
  return {
    ready,
    async list() { await ready(); return accounts.map(publicAccount); },
    async importAccounts(value, protector) {
      await ready();
      const rows = importRows(value), next = accounts.map(account => ({ ...account }));
      let added = 0, updated = 0;
      for (const row of rows) {
        const sameEmail = next.find(item => (item.email || item.label).toLowerCase() === row.email);
        const sameLabel = next.find(item => item.label.toLowerCase() === row.label.toLowerCase());
        if (sameLabel && sameLabel !== sameEmail) throw Error('Já existe uma conta com um dos nomes do JSON.');
        let account = sameEmail;
        if (!account) {
          if (next.length >= MAX_ACCOUNTS) throw Error('Máximo de 100 contas; nenhuma alteração foi guardada.');
          account = { id: randomUUID(), label: row.label, partition: `persist:caseclicker-${randomUUID()}`, addedAt: new Date().toISOString() };
          next.push(account); added++;
        } else updated++;
        account.email = row.email;
        if (row.password) account.protectedPassword = protector.seal(row.password);
      }
      await storage.save(next); accounts = next;
      return { added, updated, withoutPassword: rows.filter(row => !next.find(item => item.email === row.email)?.protectedPassword).length, accounts: next.map(publicAccount) };
    },
    async credentials(id, protector) {
      await ready(); const account = accounts.find(item => item.id === id);
      if (!account) throw Error('Conta não encontrada.');
      return { email: account.email || '', password: account.protectedPassword ? protector.open(account.protectedPassword) : '' };
    },
    async add(label, partition) {
      await ready();
      const cleanLabel = String(label || '').trim();
      if (!cleanLabel || cleanLabel.length > 40 || /[\x00-\x1f]/.test(cleanLabel)) {
        throw new Error('Nome da conta inválido');
      }
      if (!String(partition).startsWith('persist:caseclicker-')) {
        throw new Error('Sessão da conta inválida');
      }
      if (accounts.some((item) => item.label.toLocaleLowerCase() === cleanLabel.toLocaleLowerCase())) {
        throw new Error('Já existe uma conta com esse nome');
      }
      if (accounts.length >= MAX_ACCOUNTS) throw new Error(`Máximo de ${MAX_ACCOUNTS} contas`);
      const account = { id: randomUUID(), label: cleanLabel, partition, addedAt: new Date().toISOString() };
      const next = [...accounts, account];
      await storage.save(next);
      accounts = next;
      return { ...account };
    },
    async remove(id) {
      await ready();
      const removed = accounts.find((account) => account.id === id);
      if (!removed) return null;
      const next = accounts.filter((account) => account.id !== id);
      await storage.save(next);
      accounts = next;
      return publicAccount(removed);
    },
  };
}
module.exports = { createAccountRegistry, MAX_ACCOUNTS };
