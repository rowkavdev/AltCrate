const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSocketGames, validateAction, safeState } = require('../engine/socketGames.cjs');

class FakeSocket extends EventEmitter {
  constructor() { super(); this.connected = false; this.sent = []; }
  emit(event, ...args) { this.sent.push([event, ...args]); return super.emit(event, ...args); }
  connect() { this.connected = true; this.emit('connect'); }
  disconnect() { this.connected = false; this.emit('disconnect'); }
}

test('socket wagers recheck current availability inside the account queue', async () => {
  const {createAccountQueue}=require('../engine/accountQueue.cjs');
  const socket=new FakeSocket(),account={id:'limited-account'};
  let left=1,checks=0,auth;
  socket.on('placeBetCrash',()=>{left--;});
  const manager=createSocketGames({accountQueue:createAccountQueue(),ioFactory:(_url,options)=>{auth=options.auth;return socket;},
    fetchForAccount:()=>async path=>({ok:true,json:async()=>path==='/api/auth/token'?{token:'fixture-token'}:{tokens:100}}),
    requireAvailability:async()=>{checks++;if(left<1)throw Error('Limite diário atingido');},
  });
  await manager.load(account,'crash');
  await new Promise(resolve=>auth(resolve));
  const results=await Promise.allSettled([manager.perform(account,'crash','bet',{bet:10,autoCashout:2}),manager.perform(account,'crash','bet',{bet:10,autoCashout:2})]);
  assert.equal(checks,2);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
  assert.equal(socket.sent.filter(([event])=>event==='placeBetCrash').length,1);
  await manager.perform(account,'crash','cashout',{});assert.equal(checks,2);
  manager.dispose(account.id);
});

test('Socket.IO uses account session token, joins one room, and only exposes sanitized state', async () => {
  const socket = new FakeSocket();
  const updates = [];
  let auth;
  const manager = createSocketGames({
    fetchForAccount: () => async (path) => ({ ok: true, json: async () => path === '/api/auth/token' ? { token: 'secret-jwt' } : { user: { id: 'owner' }, tokens: 100 } }),
    ioFactory: (_url, options) => { auth = options.auth; return socket; },
    emit: (event) => updates.push(event),
  });
  const account = { id: 'test-account' };
  const initial = await manager.load(account, 'crash');
  assert.equal(initial.connected, true);
  assert.ok(socket.sent.some(([event]) => event === 'joinRoomCrash'));
  const credentials = await new Promise((resolve) => auth(resolve));
  assert.deepEqual(credentials, { token: 'secret-jwt' });
  socket.emit('crashState', { phase: 'betting', currentMultiplier: 1, bets: [{ email: 'other@example.com' }], token: 'hidden' });
  assert.equal(updates.at(-1).data.bets, 1);
  assert.ok(!JSON.stringify(updates).includes('hidden'));
  assert.ok(!JSON.stringify(updates).includes('other@example.com'));
  const result = await manager.perform(account, 'crash', 'bet', { bet: 10, autoCashout: 2 });
  assert.equal(result.verified, false);
  assert.deepEqual(socket.sent.at(-1), ['placeBetCrash', { bet: 10, autoCashout: 2 }]);
  manager.leave(account.id, 'crash');
  assert.ok(socket.sent.some(([event]) => event === 'exitRoomCrash'));
  assert.equal(socket.connected, false);
});

test('Blackjack actions require private table data and a valid turn', () => {
  assert.deepEqual(validateAction('blackjack', 'create'), ['createTableBlackjack', { isPrivate: true }]);
  assert.deepEqual(validateAction('blackjack', 'sit', { tableId: 'table123', code: '3D76SA', seatIndex: 2 }), ['joinTableBlackjack', { tableId: 'table123', code: '3D76SA', seatIndex: 2 }]);
  assert.throws(() => validateAction('blackjack', 'sit', { tableId: 'table123', seatIndex: 2 }), /código/);
  assert.throws(() => validateAction('blackjack', 'play', { move: 'hit' }), /vez inválida/);
  assert.deepEqual(validateAction('blackjack', 'play', { move: 'stand', turnId: 4 }), ['actionBlackjack', { action: 'stand', turnId: 4 }]);
  const state = safeState('blackjack', 'blackjackTableState', { tableId: 'table123', phase: 'acting', seats: [{ userId: 'owner', turnId: 4, hands: [{ status: 'playing', cards: [{ rank: 'A', suit: 'spades' }] }] }] }, 'owner');
  assert.equal(state.seats[0].mine, true);
  assert.equal(state.seats[0].turnId, 4);
  assert.deepEqual(state.seats[0].hands[0].cards, [{ rank: 'A', suit: 'SPADES' }]);
  const alternateShape = safeState('blackjack', 'blackjackTableState', { seats: [{ playerId: 42, turnId: 'turn-1', hands: [] }] }, '42');
  assert.equal(alternateShape.seats[0].mine, true);
  assert.equal(alternateShape.seats[0].turnId, 'turn-1');
  assert.deepEqual(safeState('blackjack', 'blackjackTableClosed', { tableId: 'table123' }), { tableId: 'table123', closed: true });
});

test('Blackjack keeps the public card codes, active hand, and hidden dealer card', () => {
  const state = safeState('blackjack', 'blackjackTableState', {
    tableId: 'table123', code: '3D76SA', phase: 'acting', minBet: 1, maxBet: 100000000,
    dealer: { cards: ['10H'], holeCardHidden: true, value: 10 },
    seats: [{ userId: 'owner', seatIndex: 0, status: 'playing', activeHandIndex: 1, turnId: 'turn123', hands: [
      { status: 'stand', cards: ['AS', 'KC'], value: 21, bet: 2 },
      { status: 'playing', cards: ['8D', '8S'], value: 16, bet: 2, fromSplit: true },
    ] }],
    token: 'secret',
  }, 'owner');
  assert.equal(state.code, '3D76SA');
  assert.deepEqual(state.dealerCards, [{ rank: '10', suit: 'H' }]);
  assert.equal(state.dealerHoleCardHidden, true);
  assert.deepEqual(state.seats[0].hands[0].cards, [{ rank: 'A', suit: 'S' }, { rank: 'K', suit: 'C' }]);
  assert.equal(state.seats[0].activeHandIndex, 1);
  assert.equal(state.seats[0].hands[1].value, 16);
  assert.ok(!JSON.stringify(state).includes('secret'));
});

test('Blackjack resumes a private table using its server-provided invite code', async () => {
  const socket = new FakeSocket();
  const manager = createSocketGames({
    fetchForAccount: () => async (path) => ({ ok: true, json: async () => path === '/api/auth/token' ? { token: 'test-token' } : { user: { id: 'owner' } } }),
    ioFactory: () => socket,
  });
  const account = { id: 'test-account' };
  await manager.load(account, 'blackjack');
  socket.emit('blackjackMySeat', { tableId: 'table123', code: '3D76SA', seatIndex: 0 });
  assert.ok(socket.sent.some(([event, value]) => event === 'watchTableBlackjack' && value.tableId === 'table123' && value.code === '3D76SA'));
  manager.leave(account.id, 'blackjack');
});

test('Blackjack identifies the test account from the game token when /api/me has no ID', async () => {
  const socket = new FakeSocket();
  const updates = [];
  let auth;
  const claims = Buffer.from(JSON.stringify({ id: 'owner', sub: 'owner' })).toString('base64url');
  const token = `header.${claims}.signature`;
  const manager = createSocketGames({
    fetchForAccount: () => async (path) => ({ ok: true, json: async () => path === '/api/auth/token' ? { token } : { tokens: 29, money: 100 } }),
    ioFactory: (_url, options) => { auth = options.auth; return socket; },
    emit: (event) => updates.push(event),
  });
  const account = { id: 'test-account' };
  await manager.load(account, 'blackjack');
  await new Promise((resolve) => auth(resolve));
  socket.emit('blackjackTableState', { tableId: 'table123', phase: 'acting', seats: [{ userId: 'owner', activeHandIndex: 0, turnId: 'turn123', hands: [{ status: 'playing', cards: ['AS', '10H'] }] }] });
  const seat = updates.at(-1).data.seats[0];
  assert.equal(seat.mine, true);
  assert.equal(seat.turnId, 'turn123');
  assert.ok(!JSON.stringify(updates).includes(token));
  manager.leave(account.id, 'blackjack');
});

test('Blackjack preserves round outcomes and server-relative deadlines', () => {
  const before = Date.now();
  const state = safeState('blackjack', 'blackjackTableState', {
    tableId: 'table123', phase: 'result', roundNumber: 4, serverNow: 100000, phaseEndsAt: 115000,
    dealer: { cards: ['10H', '8S'], value: 18, isBust: false },
    seats: [
      { userId: 'owner', name: 'Owner', netProfit: 15, actionEndsAt: 108000, hands: [{ cards: ['AS', 'KH'], status: 'blackjack', result: 'blackjack', bet: 10, payout: 25 }] },
      { userId: 'other', name: 'Guest', netProfit: -10, hands: [{ cards: ['10C', '6D'], status: 'bust', result: 'lose', bet: 10, payout: 0 }] },
    ],
  }, 'owner');
  assert.equal(state.roundNumber, 4);
  assert.equal(state.dealerValue, 18);
  assert.equal(state.seats[0].netProfit, 15);
  assert.equal(state.seats[0].hands[0].result, 'blackjack');
  assert.equal(state.seats[1].netProfit, -10);
  assert.ok(state.deadlineAt >= before + 15000 && state.deadlineAt <= Date.now() + 15000);
  assert.ok(state.seats[0].actionDeadlineAt >= before + 8000 && state.seats[0].actionDeadlineAt <= Date.now() + 8000);
  assert.equal(state.seats[1].actionDeadlineAt, null);
});

test('live balance updates omit account secrets', () => {
  assert.deepEqual(safeState('blackjack', 'userstats', { tokens: 12.5, money: 60, email: 'private@example.com', token: 'secret' }), { tokens: 12.5, money: 60 });
});

test('a bet delayed by balance verification never reaches a changed round; leaving frees the seat', async () => {
  const socket=new FakeSocket();let auth,release,delay=false;
  const manager=createSocketGames({fetchForAccount:()=>async path=>{
    if(path==='/api/auth/token')return {ok:true,json:async()=>({token:'test-token'})};
    if(delay)await new Promise(resolve=>{release=resolve;});
    return {ok:true,json:async()=>({user:{id:'owner'},tokens:100})};
  },ioFactory:(_url,options)=>{auth=options.auth;return socket;}});
  const account={id:'a'};
  await manager.load(account,'blackjack');await new Promise(resolve=>auth(resolve));
  socket.emit('blackjackTableState',{tableId:'t1',roundNumber:1,phase:'betting',minBet:1,maxBet:100,seats:[{userId:'owner',status:'betting',hands:[]}]});
  delay=true;
  const pending=manager.perform(account,'blackjack','bet',{bet:10,tableId:'t1',roundNumber:1});
  await Promise.resolve();
  socket.emit('blackjackTableState',{tableId:'t1',roundNumber:2,phase:'betting',minBet:1,maxBet:100,seats:[{userId:'owner',status:'betting',hands:[]}]});
  release();
  await assert.rejects(pending,/ronda mudou/);
  assert.equal(socket.sent.filter(([name])=>name==='placeBetBlackjack').length,0);
  manager.leave('a','blackjack');
  assert.ok(socket.sent.some(([name,payload])=>name==='exitWatchBlackjack'&&payload.tableId==='t1'));
});

test('stopped Blackjack stays disconnected during passive polling and reconnects only on explicit resume',async()=>{
  const sockets=[];
  const manager=createSocketGames({fetchForAccount:()=>async()=>({ok:true,json:async()=>({user:{id:'owner'},tokens:100})}),ioFactory:()=>{const s=new FakeSocket();sockets.push(s);return s;}});
  const account={id:'a'};await manager.load(account,'blackjack');manager.leave('a','blackjack');
  const held=await manager.load(account,'blackjack');
  assert.equal(held.connected,false);assert.equal(held.paused,true);assert.equal(sockets.length,1);
  await manager.load(account,'blackjack',{resume:true});assert.equal(sockets.length,2);
});

test('an in-flight passive load cannot enter Blackjack after Stop',async()=>{
  let release;const socket=new FakeSocket();
  const manager=createSocketGames({fetchForAccount:()=>async()=>{await new Promise(resolve=>{release=resolve;});return {ok:true,json:async()=>({user:{id:'owner'},tokens:100})};},ioFactory:()=>socket});
  const loading=manager.load({id:'a'},'blackjack');manager.leave('a','blackjack');release();
  const state=await loading;
  assert.equal(state.connected,false);assert.equal(socket.sent.some(([name])=>name==='joinRoomBlackjack'),false);
});
