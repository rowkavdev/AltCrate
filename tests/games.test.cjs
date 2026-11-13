const test = require('node:test');
const assert = require('node:assert/strict');
const { createGames, GAMES, youtubeId } = require('../electron/games.cjs');

const response = (value, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(value) });

const availabilityResponse=url=>url==='/api/games/status'?response({disabledGames:[]}):url==='/api/gameLimitations'?response({diceHostLeft:500,plinkoHostLeft:10000,guessTheRankHostLeft:100,upgradeHostLeft:300}):null;

test('only verified manual actions can send requests', async () => {
  const calls = [];
  const games = createGames({ fetchForAccount: () => async (url, init) => { if(availabilityResponse(url))return availabilityResponse(url); if (url === '/api/me') return response({ tokens: 1000 }); calls.push({ url, init }); return response({ diceRoll: 41, tokensWonOrLost: -100 }); } });
  assert.equal(GAMES.length, 9);
  await assert.rejects(games.perform({ id: 'a' }, 'blackjack', 'bet', { bet: 1 }), /indisponível/);
  await assert.rejects(games.perform({ id: 'a' }, 'dice', 'roll', { bet: 99, targetNumber: 50, playerChoice: 'over' }), /Aposta/);
  await assert.rejects(games.perform({ id: 'a' }, 'dice', 'roll', { bet: 100, targetNumber: 50, playerChoice: 'over', url: '/api/admin' }), /Campo/);
  const result = await games.perform({ id: 'a' }, 'dice', 'roll', { bet: 100, targetNumber: 50, playerChoice: 'over' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/casino/dice');
  assert.deepEqual(JSON.parse(calls[0].init.body), { bet: 100, targetNumber: 50, playerChoice: 'over' });
  assert.equal(result.diceRoll, 41);
});

test('Plinko uses a fixed endpoint and recognized risk', async () => {
  const calls = [];
  const games = createGames({ fetchForAccount: () => async (url, init) => { if(availabilityResponse(url))return availabilityResponse(url); if (url === '/api/me') return response({ tokens: 1000 }); calls.push({ url, init }); return response({ bet: 1, multiplier: 1.2 }); } });
  await assert.rejects(games.perform({ id: 'a' }, 'plinko', 'drop', { bet: 1, risk: 'Extreme;bad' }), /Risco/);
  const result = await games.perform({ id: 'a' }, 'plinko', 'drop', { bet: 1, risk: 'Low' });
  assert.equal(calls[0].url, '/api/casino/plinko');
  assert.equal(result.multiplier, 1.2);
});

test('load exposes only balance and sanctioned game state', async () => {
  const games = createGames({ fetchForAccount: () => async (url) => availabilityResponse(url) || (url === '/api/me' ? response({ money: 8, tokens: 3, cookie: 'secret' }) : response({ game: 'cs2', link: 'https://example.com/video', secret: 'x' })) });
  assert.deepEqual(await games.load({ id: 'a' }, 'dice'), { game: 'dice', supported: true, availability:{disabled:false,remaining:500,limitKnown:true,message:''}, tokens: 3, money: 8, state: null });
  assert.deepEqual(await games.load({ id: 'a' }, 'guesstherank'), { game: 'guesstherank', supported: true, availability:{disabled:false,remaining:100,limitKnown:true,message:''}, tokens: 3, money: 8, state: { active: true, game: 'cs2', videoId: null } });
});

test('Guess the Rank starts and resolves only an active server round', async () => {
  let round = null;
  const calls = [];
  const games = createGames({ fetchForAccount: () => async (url, init) => { if(availabilityResponse(url))return availabilityResponse(url);
    if (url === '/api/me') return response({ tokens: 10 });
    if (init.method === 'GET') return response(round);
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    if (init.method === 'POST') { round = { game: 'cs2', link: 'https://www.youtube.com/watch?v=abcdefghijk' }; return response(round); }
    round = null;
    return response({ tokensWon: 2, video: { rank: 3 } });
  } });
  const account = { id: 'a' };
  await assert.rejects(games.perform(account, 'guesstherank', 'guess', { rankId: 3 }), /Ronda/);
  const started = await games.perform(account, 'guesstherank', 'start', { bet: 1, game: 'cs2' });
  assert.equal(started.state.videoId, 'abcdefghijk');
  await assert.rejects(games.perform(account, 'guesstherank', 'guess', { rankId: 0 }), /classificação/);
  const result = await games.perform(account, 'guesstherank', 'guess', { rankId: 3 });
  assert.equal(result.tokensWon, 2);
  assert.deepEqual(calls.map(({ method }) => method), ['POST', 'PATCH']);
  assert.equal(youtubeId('https://evil.example/watch?v=abcdefghijk'), null);
  assert.equal(youtubeId('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
});

test('game HTTP 429 shares cooldown with farming', async () => {
  const until = [];
  const games = createGames({
    now: () => 1000,
    coordinator: { cooldown: async () => 0, limit: async (value) => until.push(value) },
    fetchForAccount: () => async (url) => availabilityResponse(url) || (url === '/api/me' ? response({ tokens: 1000 }) : { ...response({ error: 'limit' }, 429), headers: { get: () => '4' } }),
  });
  await assert.rejects(games.perform({ id: 'a' }, 'dice', 'roll', { bet: 100, targetNumber: 50, playerChoice: 'over' }), /limit/);
  assert.deepEqual(until, [5000]);
});

test('Upgrade uses tokens only and a target rechecked from the server', async () => {
  const target = { _id: '691f90c11ff412261c423a3f', name: 'Test target', price: 20 };
  const calls = [];
  const games = createGames({ fetchForAccount: () => async (url, init) => { if(availabilityResponse(url))return availabilityResponse(url);
    calls.push({ url, init });
    if (url === '/api/me') return response({ tokens: 10 });
    if (url.startsWith('/api/casino/upgrade/skins?')) return response([target]);
    return response({ result: true, skin: target });
  } });
  const account = { id: 'a' };
  assert.deepEqual(await games.options(account, 'upgrade', 2, 20), [{ id: target._id, name: target.name, price: 20 }]);
  await assert.rejects(games.perform(account, 'upgrade', 'attempt', { tokens: 2, targetId: '000000000000000000000000', url: '/api/admin' }), /Campo/);
  const result = await games.perform(account, 'upgrade', 'attempt', { tokens: 2, targetPrice: 20, targetId: target._id });
  assert.equal(result.won, true);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { userSkinReq: null, userTokensReq: 2, upgradeSkinReq: target });
});

test('incomplete HTTP game results remain unverified instead of becoming zero results', async () => {
  const variants = [null, '', ' ', false, true, [], [1], {}];
  const scenarios = [
    { game: 'dice', action: 'roll', payload: { bet: 100, targetNumber: 50, playerChoice: 'over' }, valid: { diceRoll: 41, tokensWonOrLost: -100 }, fields: ['diceRoll', 'tokensWonOrLost'] },
    { game: 'plinko', action: 'drop', payload: { bet: 1, risk: 'Low' }, valid: { bet: 1, multiplier: 1.2 }, fields: ['bet', 'multiplier'] },
    { game: 'guesstherank', action: 'guess', payload: { rankId: 4 }, valid: { tokensWon: 0, video: { rank: 4 } }, fields: ['tokensWon'] },
  ];
  for (const scenario of scenarios) {
    for (const field of scenario.fields) {
      for (const invalid of variants) {
        const games = createGames({ fetchForAccount: () => async (url, init) => { if(availabilityResponse(url))return availabilityResponse(url);
          if (url === '/api/me') return response({ tokens: 1000 });
          if (init.method === 'GET') return response({ game: 'cs2', link: 'https://www.youtube.com/watch?v=abcdefghijk' });
          return response({ ...scenario.valid, [field]: invalid });
        } });
        const result = await games.perform({ id: 'a' }, scenario.game, scenario.action, scenario.payload);
        assert.equal(result.verified, false, `${scenario.game}.${field}: ${JSON.stringify(invalid)}`);
        assert.equal(result[field], null);
      }
    }
  }
});

test('actual zero game results and numeric strings remain verified', async () => {
  const games = createGames({ fetchForAccount: () => async (url) => availabilityResponse(url) || (url === '/api/me'
    ? response({ tokens: 1000 }) : response({ diceRoll: '0', tokensWonOrLost: 0 })) });
  const result = await games.perform({ id: 'a' }, 'dice', 'roll', { bet: 100, targetNumber: 50, playerChoice: 'over' });
  assert.equal(result.verified, true);
  assert.equal(result.diceRoll, 0);
  assert.equal(result.tokensWonOrLost, 0);
});

test('unavailable game balances are exposed as unavailable, not zero', async () => {
  const games = createGames({ fetchForAccount: () => async () => response({ money: null, tokens: '' }) });
  const result = await games.load({ id: 'a' }, 'dice');
  assert.equal(result.money, null);
  assert.equal(result.tokens, null);
});

test('malformed token balances cannot authorize a wager or upgrade lookup', async () => {
  for (const invalid of [null, '', ' ', false, true, [], [1000], {}]) {
    const calls = [];
    const games = createGames({ fetchForAccount: () => async (url) => { if(availabilityResponse(url))return availabilityResponse(url);
      calls.push(url);
      if (url === '/api/me') return response({ tokens: invalid });
      if (url.startsWith('/api/casino/upgrade/skins')) return response([{ _id: 'a'.repeat(24), price: 2 }]);
      return response({ bet: 1, multiplier: 1 });
    } });
    await assert.rejects(games.perform({ id: 'a' }, 'plinko', 'drop', { bet: 1, risk: 'Low' }), /Tokens insuficientes/, JSON.stringify(invalid));
    await assert.rejects(games.options({ id: 'a' }, 'upgrade', 1, 2), /Tokens insuficientes/, JSON.stringify(invalid));
    assert.deepEqual(calls, ['/api/me', '/api/me']);
  }
});
