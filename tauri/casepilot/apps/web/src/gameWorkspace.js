export const MAX_GAME_TABLES = 20;
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

export function resolveGameTables(accounts, tableIds) {
  if (!Array.isArray(tableIds)) return accounts.slice(0, MAX_GAME_TABLES);
  const ids = new Set(tableIds);
  return accounts.filter(account => ids.has(account.id)).slice(0, MAX_GAME_TABLES);
}

export function selectedBlackjackIds(tables, selectedIds, cards = {}) {
  const selected = new Set(selectedIds);
  return tables.filter(account => selected.has(account.id) && (cards[account.id]?.game || 'blackjack') === 'blackjack').map(account => account.id);
}

export function filterGameTables(tables, query, game, cards = {}) {
  const needle = normalize(query.trim());
  return tables.filter(account => normalize(account.label).includes(needle) && (game === 'all' || (cards[account.id]?.game || 'blackjack') === game));
}
