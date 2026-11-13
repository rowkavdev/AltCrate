const GAMES = Object.freeze(['casebattle', 'jackpot', 'coinflip', 'upgrade', 'dice', 'guesstherank', 'blackjack', 'plinko', 'crash']);
const { parseRetryAfter } = require('./scheduler.cjs');
const ACTIONS = Object.freeze({ dice: ['roll'], plinko: ['drop'], guesstherank: ['start', 'guess'], upgrade: ['attempt'] });

function finite(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function cleanJson(text) { try { return JSON.parse(text); } catch { return null; } }
function errorFor(status, body) {
  const error = new Error(String(body?.error || body?.message || `HTTP ${status}`).slice(0, 160));
  error.status = status;
  return error;
}
function validateGame(game) { if (!GAMES.includes(game)) throw new Error('Jogo inválido'); }
function youtubeId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname) ? url.searchParams.get('v') || /^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})$/.exec(url.pathname)?.[1] : null;
    return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}
function validatePayload(game, action, payload) {
  if (!ACTIONS[game]?.includes(action)) throw new Error('Ação indisponível: contrato ainda não verificado');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Dados da jogada inválidos');
  const allowed = game === 'dice' ? ['bet', 'targetNumber', 'playerChoice'] : game === 'plinko' ? ['bet', 'risk'] : game === 'upgrade' ? ['tokens', 'targetId', 'targetPrice'] : action === 'start' ? ['bet', 'game'] : ['rankId'];
  if (Object.keys(payload).some((key) => !allowed.includes(key))) throw new Error('Campo não permitido');
  if (game === 'guesstherank' && action === 'guess') {
    if (!Number.isSafeInteger(payload.rankId) || payload.rankId < 0 || payload.rankId > 8) throw new Error('Classificação inválida');
    return { rankId: payload.rankId };
  }
  if (game === 'upgrade') {
    const tokens = Number(payload.tokens);
    if (!Number.isFinite(tokens) || tokens <= 0 || tokens > 1000000 || Math.abs(Math.round(tokens * 100) - tokens * 100) > 1e-6) throw new Error('Tokens inválidos');
    const targetPrice = Number(payload.targetPrice);
    if (!Number.isFinite(targetPrice) || targetPrice < tokens * 1.1 || targetPrice > 10000000) throw new Error('Preço alvo inválido');
    if (typeof payload.targetId !== 'string' || !/^[a-f0-9]{24}$/i.test(payload.targetId)) throw new Error('Item alvo inválido');
    return { tokens, targetId: payload.targetId, targetPrice };
  }
  const bet = Number(payload.bet);
  if (!Number.isSafeInteger(bet) || bet < (game === 'dice' ? 100 : 1) || bet > (game === 'dice' ? 10000000 : 5000000)) throw new Error('Aposta fora do intervalo permitido');
  if (game === 'guesstherank') {
    if (!['cs2', 'csgo'].includes(payload.game)) throw new Error('Versão do jogo inválida');
    return { bet, game: payload.game };
  }
  if (game === 'dice') {
    if (!Number.isSafeInteger(payload.targetNumber) || payload.targetNumber < 1 || payload.targetNumber > 99) throw new Error('Alvo inválido');
    if (!['over', 'under'].includes(payload.playerChoice)) throw new Error('Escolha inválida');
    return { bet, targetNumber: payload.targetNumber, playerChoice: payload.playerChoice };
  }
  if (!['Low', 'Medium', 'High', 'Extreme'].includes(payload.risk)) throw new Error('Risco inválido');
  return { bet, risk: payload.risk };
}

function createGames({ fetchForAccount, accountQueue = null, coordinator = null, now = Date.now }) {
  if (typeof fetchForAccount !== 'function') throw new TypeError('fetchForAccount obrigatório');
  async function read(fetcher, endpoint) {
    const response = await fetcher(endpoint, { method: 'GET', credentials: 'include', cache: 'no-store' });
    const body = cleanJson(await response.text());
    if (response.status === 429 && coordinator) await coordinator.limit(now() + parseRetryAfter(response.headers?.get?.('Retry-After'), now()));
    if (!response.ok) throw errorFor(response.status, body);
    return body;
  }
  const limitFields = { casebattle: 'cbHostLeft', coinflip: 'coinflipHostLeft', dice: 'diceHostLeft', guesstherank: 'guessTheRankHostLeft', jackpot: 'jackpotHostLeft', upgrade: 'upgradeHostLeft', blackjack: 'blackjackHostLeft', plinko: 'plinkoHostLeft', crash: 'crashHostLeft' };
  async function availability(fetcher, game, role = 'host') {
    const limitField = role === 'guest' && game === 'casebattle' ? 'cbGuestLeft' : role === 'guest' && game === 'coinflip' ? 'coinflipGuestLeft' : limitFields[game];
    const [status, limits] = await Promise.allSettled([read(fetcher, '/api/games/status'), read(fetcher, '/api/gameLimitations')]);
    const disabledList = status.status === 'fulfilled' && Array.isArray(status.value?.disabledGames) && status.value.disabledGames.every(value => typeof value === 'string') ? status.value.disabledGames : null;
    const disabled = disabledList ? disabledList.some(value => value.toLowerCase().replace(/[ _-]/g,'') === game) : null;
    const raw = limits.status === 'fulfilled' ? finite(limits.value?.[limitField]) : null;
    const remaining = raw !== null && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
    const limitKnown = remaining !== null && disabled !== null;
    return { disabled, remaining, limitKnown, message: disabled === true ? 'Jogo desativado pelo servidor' : !limitKnown ? 'Estado ou limite do jogo indisponível' : remaining === 0 ? 'Limite diário esgotado' : '' };
  }
  async function requireAvailability(account, game, { allowActive = false, role = 'host' } = {}) {
    validateGame(game);
    if (!['host','guest'].includes(role)) throw Error('Papel do jogo inválido');
    const state = await availability(fetchForAccount(account), game, role);
    if (!state.limitKnown || state.disabled === true || !allowActive && state.remaining === 0) throw Error(state.message || 'Limite do jogo indisponível');
    return state;
  }
  async function upgradeTargets(fetcher, tokens, targetPrice) {
    const endpoint = `/api/casino/upgrade/skins?price=${targetPrice}&name=&totalPrice=${tokens}`;
    const list = await read(fetcher, endpoint);
    if (!Array.isArray(list)) throw new Error('Lista de alvos inválida');
    return list.filter((item) => /^[a-f0-9]{24}$/i.test(String(item?._id || '')) && Number.isFinite(Number(item?.price)) && Number(item.price) > tokens);
  }
  return {
    requireAvailability,
    async load(account, game) {
      validateGame(game);
      const fetcher = fetchForAccount(account);
      const me = await read(fetcher, '/api/me');
      const state = game === 'guesstherank' ? await read(fetcher, '/api/casino/guesstherank') : null;
      return {
        game, supported: Boolean(ACTIONS[game]), availability: await availability(fetcher, game), tokens: finite(me?.tokens), money: finite(me?.money),
        state: game === 'guesstherank' ? { active: Boolean(state?.link), game: ['cs2', 'csgo'].includes(state?.game) ? state.game : null, videoId: youtubeId(state?.link) } : null,
      };
    },
    async options(account, game, tokens, targetPrice) {
      if (game !== 'upgrade') throw new Error('Opções indisponíveis para este jogo');
      const amount = Number(tokens);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) throw new Error('Tokens inválidos');
      const price = Number(targetPrice);
      if (!Number.isFinite(price) || price < amount * 1.1 || price > 10000000) throw new Error('Preço alvo inválido');
      const fetcher = fetchForAccount(account);
      const me = await read(fetcher, '/api/me');
      const balance = finite(me?.tokens);
      if (balance === null || balance < amount) throw new Error('Tokens insuficientes');
      const targets = await upgradeTargets(fetcher, amount, price);
      return targets.slice(0, 30).map((item) => ({ id: String(item._id), name: String(item.name || item.skin?.name || 'Item').slice(0, 100), price: Number(item.price) }));
    },
    async perform(account, game, action, payload) {
      validateGame(game);
      const body = validatePayload(game, action, payload);
      const work = async () => {
        if (coordinator && await coordinator.cooldown()) throw new Error('A API está em pausa; tenta após o prazo indicado no dashboard');
        const fetcher = fetchForAccount(account);
        await requireAvailability(account, game, { allowActive: action === 'guess' });
        const me = await read(fetcher, '/api/me');
        const cost = game === 'upgrade' ? body.tokens : body.bet;
        const balance = finite(me?.tokens);
        if (action !== 'guess' && (balance === null || balance < cost)) throw new Error('Tokens insuficientes ou saldo indisponível');
        const active = game === 'guesstherank' ? await read(fetcher, '/api/casino/guesstherank') : null;
        if (game === 'guesstherank' && action === 'start' && active?.link) throw new Error('Já existe uma ronda ativa nesta conta');
        if (game === 'guesstherank' && action === 'guess' && (!active?.link || !['cs2', 'csgo'].includes(active.game) || (active.game === 'cs2' ? body.rankId < 1 || body.rankId > 7 : body.rankId > 8))) throw new Error('Ronda ou classificação inválida');
        let upgradeTarget = null;
        if (game === 'upgrade') {
          const targets = await upgradeTargets(fetcher, body.tokens, body.targetPrice);
          upgradeTarget = targets.find((item) => String(item._id) === body.targetId);
          if (!upgradeTarget) throw new Error('Item alvo já não está disponível');
        }
        const endpoint = game === 'dice' ? '/api/casino/dice' : game === 'plinko' ? '/api/casino/plinko' : game === 'upgrade' ? '/api/casino/upgrade' : '/api/casino/guesstherank';
        const response = await fetcher(endpoint, {
          method: action === 'guess' ? 'PATCH' : 'POST', credentials: 'include', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(game === 'upgrade' ? { userSkinReq: null, userTokensReq: body.tokens, upgradeSkinReq: upgradeTarget } : body),
        });
        const result = cleanJson(await response.text());
        if (response.status === 429 && coordinator) await coordinator.limit(now() + parseRetryAfter(response.headers?.get?.('Retry-After'), now()));
        if (!response.ok) throw errorFor(response.status, result);
        if (game === 'upgrade') return { game, action: 'attempt', status: response.status, verified: typeof result?.result === 'boolean', won: result?.result === true, skinName: String(result?.skin?.name || upgradeTarget.name || 'Item').slice(0, 100) };
        if (game === 'guesstherank') {
          if (action === 'start') {
            const round = await read(fetcher, endpoint).catch(() => result);
            return { game, action: 'start', status: response.status, verified: Boolean(round?.link), state: { active: Boolean(round?.link), game: ['cs2', 'csgo'].includes(round?.game) ? round.game : body.game, videoId: youtubeId(round?.link) } };
          }
          return { game, action: 'guess', status: response.status, verified: finite(result?.tokensWon) !== null, tokensWon: finite(result?.tokensWon), rank: finite(result?.video?.rank) };
        }
        if (game === 'dice') {
          const diceRoll = finite(result?.diceRoll);
          const tokensWonOrLost = finite(result?.tokensWonOrLost);
          return { game, status: response.status, verified: diceRoll !== null && tokensWonOrLost !== null, diceRoll, tokensWonOrLost };
        }
        const bet = finite(result?.bet);
        const multiplier = finite(result?.multiplier);
        return { game, status: response.status, verified: bet !== null && multiplier !== null, bet, multiplier };
      };
      return accountQueue ? accountQueue.run(account.id, work) : work();
    },
  };
}

module.exports = { GAMES, createGames, validatePayload, youtubeId };
