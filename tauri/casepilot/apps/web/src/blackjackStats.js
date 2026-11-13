const emptyStats = () => ({ won: 0, lost: 0, positive: 0, negative: 0, ties: 0 });

export function eligibleBlackjackBet({ connected, table, tokens, pending }, amount) {
  const seat = table?.seats?.find((entry) => entry?.mine);
  return Boolean(connected && !pending && table?.phase === 'betting' && seat?.status === 'betting' &&
    Number.isSafeInteger(amount) && amount >= 1 && amount <= 5000000 &&
    amount >= (table.minBet ?? 1) && amount <= (table.maxBet ?? 5000000) &&
    Number.isFinite(tokens) && tokens >= amount);
}

export function addBlackjackResult(state, accountId, table) {
  if (!accountId || table?.phase !== 'result' || !table.tableId || !Number.isSafeInteger(table.roundNumber)) return state;
  const seat = table.seats?.find((entry) => entry?.mine);
  if (!seat || !Array.isArray(seat.hands) || !seat.hands.length || !Number.isFinite(seat.netProfit) || !Number.isFinite(seat.bet) || seat.bet <= 0) return state;
  const key = `${accountId}:${table.tableId}:${table.roundNumber}`;
  if (state.rounds[key]) return state;
  const before = state.byAccount[accountId] || emptyStats();
  const value = seat.netProfit;
  return {
    rounds: { ...state.rounds, [key]: true },
    byAccount: { ...state.byAccount, [accountId]: {
      won: before.won + Math.max(0, value),
      lost: before.lost + Math.max(0, -value),
      positive: before.positive + Number(value > 0),
      negative: before.negative + Number(value < 0),
      ties: before.ties + Number(value === 0),
    } },
  };
}

export function summarizeBlackjackResults(state) {
  const total = Object.values(state.byAccount).reduce((sum, row) => ({
    won: sum.won + row.won, lost: sum.lost + row.lost,
    positive: sum.positive + row.positive, negative: sum.negative + row.negative, ties: sum.ties + row.ties,
  }), emptyStats());
  return { ...total, net: total.won - total.lost };
}
