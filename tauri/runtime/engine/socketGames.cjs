const { io } = require('socket.io-client');

const ROOMS = Object.freeze({
  coinflip: ['joinRoomCoinflip', 'exitRoomCoinflip'],
  jackpot: ['joinRoomJackpot', 'exitRoomJackpot'],
  casebattle: ['joinRoomCasebattle', 'exitRoomCasebattle'],
  blackjack: ['joinRoomBlackjack', 'exitRoomBlackjack'],
  crash: ['joinRoomCrash', 'exitRoomCrash'],
});
const EVENTS = Object.freeze({
  coinflip: ['games', 'newGame', 'joinedGame', 'deleteGame', 'coinflipError', 'usercount', 'userstats'],
  jackpot: ['gamesJackpot', 'newGameJackpot', 'gameCreatedJackpot', 'gameUpdatedJackpot', 'gameFinishedJackpot', 'errorJackpot', 'userstats'],
  casebattle: ['games', 'newGame', 'gameCreated', 'gameUpdated', 'gameFinished', 'gameDeleted', 'casebattleError', 'usercount', 'userstats'],
  blackjack: ['blackjackLobby', 'blackjackConfig', 'blackjackMySeat', 'blackjackTableJoined', 'blackjackTableState', 'blackjackTableClosed', 'blackjackKicked', 'blackjackError', 'userstats'],
  crash: ['crashState', 'crashNewRound', 'crashStarted', 'crashTick', 'crashBet', 'crashCashout', 'crashRoundEnd', 'crashError', 'userstats'],
});
const SOCKET_URL = 'https://ws.case-clicker.com';
function numeric(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function deadlineAt(end, serverNow) {
  const endTime = numeric(end);
  if (endTime === null) return null;
  const remaining = endTime - (numeric(serverNow) ?? Date.now());
  return Date.now() + Math.max(0, Math.min(600000, remaining));
}
function id(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : null; }
function turnId(value) { return id(value) || (Number.isSafeInteger(value) && value >= 0 ? value : null); }
function tokenUserIds(token) {
  if (typeof token !== 'string' || token.length > 16384) return [];
  const parts = token.split('.');
  if (parts.length !== 3) return [];
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return [id(claims?.id), id(claims?.sub)].filter(Boolean);
  } catch { return []; }
}
function card(value) {
  if (typeof value === 'string') {
    const match = /^(10|[2-9AJQK])([HDCS])$/.exec(value);
    return match ? { rank: match[1], suit: match[2] } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const rank = String(value.rank || '').toUpperCase();
  const suit = String(value.suit || '').toUpperCase();
  return /^(10|[2-9AJQK])$/.test(rank) && /^(H|D|C|S|HEARTS|DIAMONDS|CLUBS|SPADES)$/.test(suit) ? { rank, suit } : null;
}
function cards(value) { return Array.isArray(value) ? value.map(card).filter(Boolean).slice(0, 11) : []; }
function completeCards(value) { return Array.isArray(value) && value.length <= 11 && value.every(c => card(c) !== null); }
function gameRow(value) {
  if (!value || typeof value !== 'object') return null;
  const gameId = id(value._id) || id(value.id) || id(value.gameId) || id(value.tableId);
  if (!gameId) return null;
  return { id: gameId, bet: numeric(value.bet), price: numeric(value.battlePrice), status: String(value.status || value.phase || '').slice(0, 40), players: Array.isArray(value.players) ? value.players.length : numeric(value.playerCount), seats: numeric(value.seatsTaken) ?? (Array.isArray(value.seats) ? value.seats.filter(Boolean).length : null) };
}
function safeBlackjackRules(value) {
  const input=value?.rules&&typeof value.rules==='object'?value.rules:value;
  const rules={};
  for(const key of ['dealerStandsOnSoft17','splitAcesOneCard','splitAnyTenValue','doubleAfterSplit'])if(typeof input?.[key]==='boolean')rules[key]=input[key];
  for(const [key,min,max] of [['deckCount',1,8],['maxHandsPerSeat',1,4]])if(Number.isSafeInteger(input?.[key])&&input[key]>=min&&input[key]<=max)rules[key]=input[key];
  if([1,1.5].includes(input?.blackjackPayout))rules.blackjackPayout=input.blackjackPayout;
  if(Number.isFinite(input?.reshufflePenetration)&&input.reshufflePenetration>0&&input.reshufflePenetration<1)rules.reshufflePenetration=input.reshufflePenetration;
  return rules;
}
function safeState(game, event, value, userId) {
  if (event === 'userstats') return { tokens: numeric(value?.tokens ?? value?.user?.tokens), money: numeric(value?.money ?? value?.user?.money) };
  if (event === 'connect_error') return { error: 'Ligação Socket.IO recusada; verifica a sessão ou tenta novamente mais tarde' };
  if (['coinflipError', 'errorJackpot', 'casebattleError', 'blackjackError', 'crashError', 'blackjackKicked'].includes(event)) return { error: String(typeof value === 'string' ? value : value?.message || 'O servidor recusou a ação').slice(0, 160) };
  if (['games', 'gamesJackpot', 'blackjackLobby'].includes(event)) return { games: Array.isArray(value) ? value.map(gameRow).filter(Boolean).slice(0, 100) : [] };
  if (['newGame', 'newGameJackpot', 'gameUpdatedJackpot', 'gameFinishedJackpot', 'gameUpdated', 'gameFinished', 'gameDeleted', 'deleteGame', 'joinedGame'].includes(event)) return { game: gameRow(value), gameId: id(value) || id(value?.gameId) || id(value?.id) };
  if (['gameCreatedJackpot', 'gameCreated'].includes(event)) return { gameId: id(value) || id(value?.gameId) || id(value?.id) };
  if (event === 'blackjackConfig') return { minBet: numeric(value?.minBet), maxBet: numeric(value?.maxBet), rules:safeBlackjackRules(value) };
  if (event === 'blackjackMySeat' || event === 'blackjackTableJoined') return { tableId: id(value?.tableId), code: id(value?.code), seatIndex: numeric(value?.seatIndex) };
  if (event === 'blackjackTableClosed') return { tableId: id(value?.tableId), closed: true };
  if (event === 'blackjackTableState') return {
    tableId: id(value?.tableId), code: id(value?.code), phase: String(value?.phase || value?.status || '').slice(0, 40),
    roundNumber: numeric(value?.roundNumber), serverNow: numeric(value?.serverNow), deadlineAt: deadlineAt(value?.phaseEndsAt, value?.serverNow),
    shuffleCount: Number.isSafeInteger(value?.shuffleCount) && value.shuffleCount >= 0 ? value.shuffleCount : null,
    visibleCardsComplete: completeCards(value?.dealer?.cards) && Array.isArray(value?.seats) && value.seats.every(seat => !seat || Array.isArray(seat.hands) && seat.hands.length <= 4 && seat.hands.every(hand => completeCards(hand?.cards))),
    minBet: numeric(value?.minBet), maxBet: numeric(value?.maxBet), maxSeats: numeric(value?.maxSeats),
    dealerCards: cards(value?.dealer?.cards), dealerHoleCardHidden: typeof value?.dealer?.holeCardHidden==='boolean'?value.dealer.holeCardHidden:null, dealerValue: numeric(value?.dealer?.value), dealerBust: Boolean(value?.dealer?.isBust), dealerBlackjack: Boolean(value?.dealer?.isBlackjack),
    seats: Array.isArray(value?.seats) ? value.seats.map((seat, index) => {
      if (!seat) return null;
      const seatId = seat.userId ?? seat.playerId ?? seat.user?._id ?? seat.user?.id;
      const ownIds = Array.isArray(userId) ? userId : [userId];
      const mine = Boolean(seatId != null && ownIds.some(ownId => ownId != null && String(seatId) === String(ownId)));
      return { index, occupied: true, mine, name: String(seat.name || '').slice(0, 40), status: String(seat.status || '').slice(0, 24), bet: numeric(seat.bet), netProfit: numeric(seat.netProfit),
        activeHandIndex: mine && Number.isSafeInteger(seat.activeHandIndex) ? seat.activeHandIndex : null,
        hands: Array.isArray(seat.hands) ? seat.hands.map(hand => ({ status: String(hand?.status || '').slice(0, 24), result: ['blackjack', 'win', 'push', 'lose'].includes(hand?.result) ? hand.result : null, cards: cards(hand?.cards), value: numeric(hand?.value), bet: numeric(hand?.bet), payout: numeric(hand?.payout), splitAces: Boolean(hand?.splitAces), fromSplit: Boolean(hand?.fromSplit) })).slice(0, 4) : [],
        turnId: mine ? turnId(seat.turnId) : null, actionDeadlineAt: mine ? deadlineAt(seat.actionEndsAt, value?.serverNow) : null };
    }).slice(0, 10) : [],
  };
  if (event === 'crashState') return { phase: String(value?.phase || '').slice(0, 40), multiplier: numeric(value?.currentMultiplier), countdown: numeric(value?.countdown), isLocked: Boolean(value?.isLocked), bets: Array.isArray(value?.bets) ? value.bets.length : 0, history: Array.isArray(value?.history) ? value.history.map(numeric).filter(n => n !== null).slice(0, 10) : [] };
  if (event === 'crashTick') return { multiplier: numeric(value?.multiplier ?? value) };
  if (event === 'crashNewRound' || event === 'crashStarted' || event === 'crashRoundEnd') return { multiplier: numeric(value?.multiplier ?? value?.crashPoint), phase: event === 'crashNewRound' ? 'betting' : event === 'crashStarted' ? 'running' : 'crashed' };
  if (event === 'crashBet' || event === 'crashCashout') return { bet: numeric(value?.bet), multiplier: numeric(value?.multiplier) };
  if (event === 'usercount') return { count: numeric(value) };
  return {};
}
function validateAction(game, action, payload = {}) {
  if (!ROOMS[game]) throw new Error('Jogo Socket.IO inválido');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Dados inválidos');
  const amount = Number(payload.bet);
  const positiveBet = () => {
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 5000000) throw new Error('Aposta inválida');
    return amount;
  };
  if (game === 'crash' && action === 'bet') {
    const auto = payload.autoCashout == null || payload.autoCashout === '' ? null : Number(payload.autoCashout);
    if (auto !== null && (!Number.isFinite(auto) || auto < 1.01 || auto > 1000)) throw new Error('Cashout automático inválido');
    return ['placeBetCrash', { bet: positiveBet(), autoCashout: auto }];
  }
  if (game === 'crash' && action === 'cashout') return ['cashoutCrash'];
  if (game === 'jackpot' && action === 'create') {
    const time = Number(payload.time), maxDeposit = Number(payload.maxDeposit);
    if (!Number.isSafeInteger(time) || time < 10 || time > 300 || !Number.isSafeInteger(maxDeposit) || maxDeposit < 1 || maxDeposit > 10000000) throw new Error('Parâmetros de Jackpot inválidos');
    return ['createGameJackpot', { time, maxDeposit, isPrivate: Boolean(payload.isPrivate) }];
  }
  if (game === 'blackjack' && action === 'join') {
    const tableId = id(payload.tableId), code = id(payload.code);
    if (!tableId && !code) throw new Error('Mesa inválida');
    return ['joinTableBlackjack', tableId ? { tableId } : { code }];
  }
  if (game === 'blackjack' && action === 'create') return ['createTableBlackjack', { isPrivate: true }];
  if (game === 'blackjack' && action === 'sit') {
    const tableId = id(payload.tableId), code = id(payload.code), seatIndex = Number(payload.seatIndex);
    if (!tableId || !Number.isSafeInteger(seatIndex) || seatIndex < 0 || seatIndex > 9) throw new Error('Lugar inválido');
    if (!code) throw new Error('Falta o código da mesa privada');
    return ['joinTableBlackjack', { tableId, code, seatIndex }];
  }
  if (game === 'blackjack' && action === 'watch') {
    const tableId = id(payload.tableId), code = id(payload.code);
    if (!tableId) throw new Error('Mesa inválida');
    return ['watchTableBlackjack', code ? { tableId, code } : { tableId }];
  }
  if (game === 'blackjack' && action === 'bet') return ['placeBetBlackjack', { bet: positiveBet() }];
  if (game === 'blackjack' && action === 'play') {
    if (!['hit', 'stand', 'double', 'split'].includes(payload.move) || turnId(payload.turnId) === null) throw new Error('Jogada ou vez inválida');
    return ['actionBlackjack', { action: payload.move, turnId: payload.turnId }];
  }
  throw new Error('Ação ainda indisponível neste jogo');
}
function createSocketGames({ fetchForAccount, websocketTransportForAccount = null, emit = () => {}, ioFactory = io, accountQueue = null, requireAvailability = null }) {
  const { createBlackjackAudit, assertCurrentBlackjackAction } = require('./blackjackAudit.cjs');
  const audit = createBlackjackAudit({ emit: (round) => emit({type:'blackjack-audit',accountId:round.accountId,round,at:new Date().toISOString()}) });
  const sockets = new Map();
  const pending = new Map();
  const desiredRooms = new Map();
  const pausedBlackjack = new Set();
  const roomRevision = new Map();
  function push(accountId, game, event, value, userId) {
    const data = safeState(game, event, value, userId);
    emit({ type: 'socket-game-update', accountId, game, event, data, at: new Date().toISOString() });
  }
  async function connect(account) {
    let entry = sockets.get(account.id);
    if (entry) return entry;
    if (pending.has(account.id)) return pending.get(account.id);
    const task = (async () => {
    const fetcher = fetchForAccount(account);
    const meResponse = await fetcher('/api/me', { method: 'GET', credentials: 'include', cache: 'no-store' });
    if (!meResponse.ok) throw new Error('Sessão expirada; atualiza a conta');
    const me = await meResponse.json();
    entry = { accountId: account.id, room: null, userIds: [me?.user?.id, me?.user?._id, me?.user?.userId, me?.id, me?._id, me?.userId].filter(x => x != null), state: {}, phase: null, socket: null, authenticated: false };
    const transport = websocketTransportForAccount?.(account);
    const socket = ioFactory(SOCKET_URL, {
      autoConnect: false, ...(transport ? { transportImplementations: [transport] } : { transports: ['websocket'] }), reconnectionDelay: 5000,
      auth: async (callback) => {
        try {
          const response = await fetcher('/api/auth/token', { method: 'GET', credentials: 'include', cache: 'no-store' });
          if (!response.ok) return callback({});
          const body = await response.json();
          entry.authenticated = typeof body?.token === 'string' && body.token.length > 0;
          if (entry.authenticated) entry.userIds = [...new Set([...entry.userIds, ...tokenUserIds(body.token)])];
          callback(entry.authenticated ? { token: body.token } : {});
        } catch { callback({}); }
      },
    });
    entry.socket = socket;
    sockets.set(account.id, entry);
    socket.on('connect', () => { delete entry.state.connect_error; if (entry.room) socket.emit(ROOMS[entry.room][0]); push(account.id, entry.room, 'connect', { connected: true }, entry.userIds); });
    socket.on('disconnect', () => { if (entry.room) push(account.id, entry.room, 'disconnect', { connected: false }, entry.userIds); });
    socket.on('connect_error', () => { if (entry.room) push(account.id, entry.room, 'connect_error', { error: 'Ligação ao jogo falhou; a app vai tentar novamente' }, entry.userIds); });
    socket.connect();
    return entry;
    })();
    pending.set(account.id, task);
    try { return await task; }
    finally { pending.delete(account.id); }
  }
  return {
    async load(account, game, { resume = false } = {}) {
      if (!ROOMS[game]) throw new Error('Jogo inválido');
      if (game === 'blackjack' && pausedBlackjack.has(account.id)) {
        if (!resume) return {connected:false,events:{},phase:null,paused:true};
        pausedBlackjack.delete(account.id);
      }
      desiredRooms.set(account.id, game);
      const revision=roomRevision.get(account.id)||0;
      const entry = await connect(account);
      if (desiredRooms.get(account.id) !== game || revision!==(roomRevision.get(account.id)||0)) {
        if (!desiredRooms.has(account.id)) this.dispose(account.id);
        return { connected: false, events: {}, phase: null };
      }
      if (entry.room !== game) {
        if (entry.room && entry.socket.connected) entry.socket.emit(ROOMS[entry.room][1]);
        entry.room = game;
        entry.state = {};
        entry.phase = null;
        entry.socket.removeAllListeners('games');
        for (const events of Object.values(EVENTS)) for (const event of events) entry.socket.removeAllListeners(event);
        for (const event of EVENTS[game]) entry.socket.on(event, (value) => {
          const data = safeState(game, event, value, entry.userIds);
          const previous = entry.state.blackjackTableState;
          if (event === 'blackjackTableState' && previous?.tableId === data.tableId && ((Number.isFinite(previous.serverNow) && Number.isFinite(data.serverNow) && data.serverNow < previous.serverNow) || data.roundNumber < previous.roundNumber)) return;
          entry.state[event] = data;
          if (event === 'blackjackTableState') audit.observe(account.id, data);
          if (event === 'blackjackMySeat' && data.tableId) entry.socket.emit('watchTableBlackjack', { tableId: data.tableId, code: data.code });
          if (event === 'blackjackTableClosed') {
            delete entry.state.blackjackTableState;
            delete entry.state.blackjackTableJoined;
            delete entry.state.blackjackMySeat;
          }
          if (event === 'blackjackTableState' || event === 'blackjackTableJoined') delete entry.state.blackjackTableClosed;
          if (data.phase) entry.phase = data.phase;
          const listEvent = game === 'jackpot' ? 'gamesJackpot' : 'games';
          const list = entry.state[listEvent]?.games;
          if (Array.isArray(list)) {
            if (['newGame', 'newGameJackpot', 'gameUpdated', 'gameUpdatedJackpot'].includes(event) && data.game) {
              entry.state[listEvent].games = [...list.filter((row) => row.id !== data.game.id), data.game].slice(-100);
            }
            if (['deleteGame', 'gameDeleted', 'gameFinished', 'gameFinishedJackpot'].includes(event) && (data.game?.id || data.gameId)) {
              entry.state[listEvent].games = list.filter((row) => row.id !== (data.game?.id || data.gameId));
            }
          }
          push(account.id, game, event, value, entry.userIds);
          if (Array.isArray(list) && ['newGame', 'newGameJackpot', 'gameUpdated', 'gameUpdatedJackpot', 'deleteGame', 'gameDeleted', 'gameFinished', 'gameFinishedJackpot'].includes(event)) {
            emit({ type: 'socket-game-update', accountId: account.id, game, event: listEvent, data: entry.state[listEvent], at: new Date().toISOString() });
          }
        });
        if (entry.socket.connected) entry.socket.emit(ROOMS[game][0]);
      }
      return { connected: entry.socket.connected, events: entry.state, phase: entry.phase, authenticated: entry.authenticated };
    },
    async perform(account, game, action, payload) {
      const work = async () => {
        const entry = sockets.get(account.id);
        if (!entry || entry.room !== game || !entry.socket.connected) throw new Error('Jogo desligado; atualiza o cartão e tenta novamente');
        if (!entry.authenticated) throw new Error('Sessão de jogo não autenticada; atualiza a conta');
        const [event, data] = validateAction(game, action, payload);
        const cost = data?.bet;
        if (cost) {
          const response = await fetchForAccount(account)('/api/me', { method: 'GET', credentials: 'include', cache: 'no-store' });
          if (!response.ok) throw new Error('Não foi possível confirmar o saldo desta conta');
          const me = await response.json();
          if (!Number.isFinite(Number(me?.tokens)) || Number(me.tokens) < cost) throw new Error('Tokens insuficientes');
        }
        if (requireAvailability && ['bet','create','join','deposit'].includes(action)) await requireAvailability(account,game,{role:action==='join'&&['casebattle','coinflip'].includes(game)?'guest':'host'});
        if (entry.room !== game || !entry.socket.connected) throw new Error('A ligação ao jogo mudou; atualiza o cartão');
        if (game === 'blackjack') assertCurrentBlackjackAction(entry.state.blackjackTableState, action, payload || {});
        if (game === 'blackjack') audit.command(account.id, action, payload || {}, entry.state.blackjackTableState);
        entry.socket.emit(event, ...(data === undefined ? [] : [data]));
        return { game, action, sent: true, verified: false, event };
      };
      return accountQueue ? accountQueue.run(account.id, work) : work();
    },
    history(accountId) { return audit.history(accountId); },
    leave(accountId, game) {
      roomRevision.set(accountId,(roomRevision.get(accountId)||0)+1);
      if (game === 'blackjack') pausedBlackjack.add(accountId);
      if (desiredRooms.get(accountId) === game) desiredRooms.delete(accountId);
      const entry = sockets.get(accountId);
      if (!entry || entry.room !== game) return;
      if (game === 'blackjack' && entry.socket.connected && entry.state.blackjackTableState?.tableId) entry.socket.emit('exitWatchBlackjack', {tableId:entry.state.blackjackTableState.tableId});
      if (entry.socket.connected) entry.socket.emit(ROOMS[game][1]);
      entry.socket.disconnect();
      sockets.delete(accountId);
    },
    dispose(accountId) {
      roomRevision.set(accountId,(roomRevision.get(accountId)||0)+1);
      pausedBlackjack.delete(accountId);
      desiredRooms.delete(accountId);
      const entry = sockets.get(accountId);
      if (!entry) return;
      if (entry.room === 'blackjack' && entry.socket.connected && entry.state.blackjackTableState?.tableId) entry.socket.emit('exitWatchBlackjack', {tableId:entry.state.blackjackTableState.tableId});
      if (entry.room && entry.socket.connected) entry.socket.emit(ROOMS[entry.room][1]);
      entry.socket.disconnect();
      sockets.delete(accountId);
    },
  };
}
module.exports = { createSocketGames, validateAction, safeState, gameRow, ROOMS };
