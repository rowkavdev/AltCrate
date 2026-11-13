const test = require('node:test');
const assert = require('node:assert/strict');

test('cooldown endpoint diagnostics accept only fixed farm endpoints',()=>{
  const {safeEvent}=require('../engine/export.cjs');
  assert.equal(safeEvent({type:'cooldown',endpoint:'/api/click'}).endpoint,'/api/click');
  assert.equal(safeEvent({type:'cooldown',endpoint:'/api/me?cookie=private'}).endpoint,undefined);
});
const { createReport } = require('../engine/export.cjs');

test('farm report includes the account percentage and actual small-lot recipe without private fields', () => {
  const report=createReport({status:{farm:{accounts:[{id:'a',casesPerClick:2.65,clicksPerCase:38,caseLotClicks:76,caseLotIntervalMs:9817,cookie:'private'}]}}});
  const row=report.run.farm.accounts[0];
  assert.equal(row.casesPerClick,2.65);
  assert.equal(row.clicksPerCase,38);
  assert.equal(row.caseLotClicks,76);
  assert.equal(row.caseLotIntervalMs,9817);
  assert.equal(JSON.stringify(report).includes('private'),false);
});

test('cooldown exports identify the operation and stage without arbitrary error content',()=>{
  const report=createReport({events:[{type:'cooldown',accountId:'a',operation:'vault',stage:'request',httpStatus:429,until:5000,message:'cookie=secret',response:'private'}]});
  assert.equal(report.events[0].operation,'vault');assert.equal(report.events[0].stage,'request');assert.equal(report.events[0].httpStatus,429);
  assert.equal(JSON.stringify(report).includes('secret'),false);assert.equal(JSON.stringify(report).includes('private'),false);
});

test('evidence export includes observed deltas but never credentials or extra API fields', () => {
  const report = createReport({
    accounts: [{ id: 'a', label: 'Teste', partition: 'persist:secret', password: 'pass' }],
    status: { phase: 'complete', sent: 1, cookies: 'private' },
    events: [{
      type: 'request', accountId: 'a', clicks: 3, httpStatus: 200, awardedCount: 1,
      before: { casesTotal: 5, money: 10, password: 'pass' },
      after: { casesTotal: 6, money: 10, jwt: 'abc' },
      message: 'Authorization: Bearer secret-jwt', cookie: 'secret',
    }],
    now: '2026-10-08T12:00:00Z',
  });
  assert.equal(report.events[0].verifiedDelta, 1);
  assert.equal(report.accounts[0].label, 'Teste');
  const text = JSON.stringify(report);
  for (const value of ['persist:secret', 'pass', 'secret-jwt', 'private']) {
    assert.equal(text.includes(value), false);
  }
});

test('money, opening and conversion evidence preserve only safe fields', () => {
  const report = createReport({
    status: { generation: { phase: 'complete', sent: 2 }, opening: { phase: 'complete', opened: 16, converted: 1 } },
    events: [
      { type: 'request', kind: 'money', before: { money: 10, casesTotal: 5 }, after: { money: 12, casesTotal: 5 }, clicks: 10, cookie: 'private' },
      { type: 'open', caseId: 'case', openedCount: 16, observedCaseDelta: -16, skinCount: 16, token: 'private' },
      { type: 'conversion', skinId: 'skin', skinName: 'Cheap', price: 2, conversionMode: 'money', verified: true, moneyDelta: 2, httpStatus: 200, jwt: 'private' },
    ],
  });
  assert.equal(report.events[0].verifiedDelta, 2);
  assert.equal(report.events[1].openedCount, 16);
  assert.equal(report.events[2].price, 2);
  assert.equal(report.events[2].conversionMode, 'money');
  assert.equal(report.events[2].moneyDelta, 2);
  assert.equal(report.run.opening.converted, 1);
  assert.equal(JSON.stringify(report).includes('private'), false);
});

test('game evidence exports only result fields and excludes hidden server data', () => {
  const report = createReport({
    status: { case: { phase: 'complete' }, money: { phase: 'idle' } },
    events: [{ type: 'game', accountId: 'a', game: 'dice', action: 'roll', result: { status: 200, verified: true, diceRoll: 42, tokensWonOrLost: -100, cookie: 'secret-cookie' }, password: 'secret-password' }],
  });
  assert.equal(report.run.case.phase, 'complete');
  assert.equal(report.events[0].diceRoll, 42);
  assert.equal(JSON.stringify(report).includes('secret-'), false);
});

test('Blackjack export preserves audit evidence while stripping arbitrary server fields',()=>{
  const report=createReport({blackjack:[{accountId:'a',tableId:'t1',roundNumber:1,phase:'result',netProfit:-10,dealerCards:[{rank:'K',suit:'S',token:'private'}],hands:[],actions:[{action:'play',move:'stand',cards:[{rank:'10',suit:'H'}],dealerCard:[{rank:'K',suit:'S'}],bet:10,tokens:20,secret:'private'}],cookie:'private'}]});
  assert.equal(report.blackjack[0].actions[0].move,'stand');
  assert.equal(report.blackjack[0].netProfit,-10);
  assert.equal(JSON.stringify(report).includes('private'),false);
});

test('farm export includes three modes and a confirmed vault credit without credentials', () => {
  const report = createReport({
    accounts: [{id:'a',label:'A',partition:'persist:secret'}],
    status: {case:{phase:'running'},money:{phase:'running'},vault:{phase:'running'},opening:{phase:'idle'},farm:{phase:'running',accounts:[{id:'a',modes:{case:true,money:true,vault:true},paused:false,needsLogin:false,error:'',partition:'persist:secret'}]}},
    events: [{type:'vault',accountId:'a',httpStatus:200,confirmedDelta:25,at:'2026-10-09T00:00:00Z',cookie:'secret'}],
  });
  assert.equal(report.run.vault.phase,'running');
  assert.equal(report.run.farm.accounts[0].modes.vault,true);
  assert.equal(report.events[0].confirmedDelta,25);
  assert.equal(JSON.stringify(report).includes('secret'),false);
});
test('storage move export preserves destination and stage without credentials',()=>{
 const report=createReport({inventoryOperations:[{operationId:'op',kind:'move-to-storage',accountId:'a',destinationAccountId:'b',destinationStorageUnitId:'c'.repeat(24),destinationStorageName:'Blue',stage:'arrived',state:'unconfirmed',locationAccountId:'b',item:{id:'d'.repeat(24),name:'Skin'},token:'secret-token'}]});
 const op=report.inventoryOperations[0];assert.equal(op.kind,'move-to-storage');assert.equal(op.destinationStorageName,'Blue');assert.equal(op.stage,'arrived');assert.equal(op.locationAccountId,'b');assert.equal(JSON.stringify(op).includes('secret-token'),false);
});
