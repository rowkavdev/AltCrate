const WINDOW_MS = 310000;
const LIMITS = Object.freeze({ case: 2400, money: 1900 });
const COMBINED_LIMIT = 1900;
const KINDS = Object.keys(LIMITS);

function cleanBucket(raw) {
  return {
    windowStart: Number.isFinite(raw?.windowStart) && raw.windowStart >= 0 ? raw.windowStart : 0,
    used: Number.isSafeInteger(raw?.used) && raw.used >= 0 ? raw.used : 0,
  };
}

function cleanState(raw) {
  const state = {
    version: 3,
    budgets: {
      case: cleanBucket(raw?.budgets?.case),
      money: cleanBucket(raw?.budgets?.money),
    },
    cooldownUntil: Number.isFinite(raw?.cooldownUntil) && raw.cooldownUntil >= 0 ? raw.cooldownUntil : 0,
    combined: cleanBucket(raw?.combined),
  };
  // Older builds kept one shared counter. Keep its reservation for the
  // operation that made it rather than discarding a live window.
  if (!raw?.budgets && Number.isSafeInteger(raw?.used) && raw.used > 0) {
    const bucket = cleanBucket(raw);
    if (raw.mixed === true) {
      state.budgets.case = { ...bucket };
      state.budgets.money = { ...bucket };
    } else if (KINDS.includes(raw.kind)) {
      state.budgets[raw.kind] = bucket;
    }
  }
  if (!raw?.combined && (state.budgets.case.used || state.budgets.money.used)) {
    state.combined.used = state.budgets.case.used + state.budgets.money.used;
    state.combined.windowStart = Math.max(0, ...KINDS.map((kind) => state.budgets[kind].windowStart));
  }
  return state;
}

function availability(raw, kind, now, simultaneous = false) {
  if (!Object.hasOwn(LIMITS, kind)) throw new Error('Tipo de clique inválido');
  const state = cleanState(raw);
  for (const bucket of [...Object.values(state.budgets), state.combined]) {
    if (bucket.windowStart && now >= bucket.windowStart + WINDOW_MS) { bucket.windowStart = 0; bucket.used = 0; }
  }
  if (state.cooldownUntil > now) return { state, remaining: 0, waitUntil: state.cooldownUntil };
  const bucket = state.budgets[kind];
  const kindRemaining = Math.max(0, LIMITS[kind] - bucket.used);
  const otherKind = kind === 'case' ? 'money' : 'case';
  const enforceCombined = simultaneous || state.budgets[otherKind].used > 0;
  const combinedRemaining = enforceCombined ? Math.max(0, COMBINED_LIMIT - state.combined.used) : Infinity;
  const remaining = Math.min(kindRemaining, combinedRemaining);
  const waitUntil = remaining ? 0 : Math.max(kindRemaining ? 0 : bucket.windowStart + WINDOW_MS, combinedRemaining ? 0 : state.combined.windowStart + WINDOW_MS);
  return { state, remaining, waitUntil };
}

function reserve(raw, kind, requested, now, simultaneous = false) {
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > 1000) throw new Error('Lote de cliques inválido');
  const result = availability(raw, kind, now, simultaneous);
  if (!result.remaining) return { ...result, clicks: 0 };
  const clicks = Math.min(requested, result.remaining);
  const bucket = result.state.budgets[kind];
  bucket.windowStart ||= now;
  bucket.used += clicks;
  result.state.combined.windowStart ||= now;
  result.state.combined.used += clicks;
  return { ...result, clicks };
}

function afterLimit(raw, until) {
  const state = cleanState(raw);
  state.cooldownUntil = Math.max(state.cooldownUntil, until);
  // A server pause does not prove that any other account's window ended.
  // Keep reservations until their own window expires, including on restart.
  return state;
}

module.exports = { WINDOW_MS, LIMITS, COMBINED_LIMIT, cleanState, availability, reserve, afterLimit };
