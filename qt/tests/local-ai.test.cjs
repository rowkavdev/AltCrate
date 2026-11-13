const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');

const state = { cards:['8','8'], dealer:'10', canDouble:true, canSplit:true, secret:'NEVER_SEND', email:'private@example.com' };
test('local AI input strips identity and only permits valid cards and legal choices', () => {
  const { sanitizeDecision, validateAnswer } = require('../engine/localAi.cjs');
  const safe=sanitizeDecision(state);
  assert.equal(JSON.stringify(safe).includes('NEVER_SEND'),false);
  assert.deepEqual(safe,{cards:['8','8'],dealer:'10',canDouble:true,canSplit:true});
  assert.throws(()=>sanitizeDecision({...state,cards:['8','bad']}));
  assert.throws(()=>validateAnswer({move:'split',probabilities:{hit:.1,stand:.1,double:.1,split:.7},latencyMs:20},{...safe,canSplit:false}));
  assert.throws(()=>validateAnswer({move:'hit',probabilities:{hit:.1,stand:.9,double:0,split:0},latencyMs:20},safe));
});

function transport(onRequest) {
  const child=new EventEmitter(); child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=()=>{child.emit('exit',0);};
  let buffer='';child.stdin.on('data',data=>{buffer+=data;while(buffer.includes('\n')){const end=buffer.indexOf('\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+1);onRequest(JSON.parse(line),child);}});
  queueMicrotask(()=>child.stdout.write(JSON.stringify({type:'ready',model:'laya-typed-decisions-mlx'})+'\n'));
  return child;
}
test('one local worker serves concurrent accounts with distinct answers and sanitized inputs',async()=>{
  const {createLocalAi}=require('../engine/localAi.cjs');
  let starts=0;
  const ai=createLocalAi({directory:'/unused',exists:()=>true,spawnWorker:()=>{starts++;return transport((request,child)=>{
    assert.equal(JSON.stringify(request).includes('NEVER_SEND'),false);
    setImmediate(()=>child.stdout.write(JSON.stringify({id:request.id,move:request.state.cards[0]==='8'?'split':'stand',probabilities:request.state.cards[0]==='8'?{hit:.1,stand:.1,double:.1,split:.7}:{hit:.1,stand:.9,double:0},latencyMs:12})+'\n'));
  });}});
  await ai.prepare();
  const answers=await Promise.all([ai.predict(state),ai.predict({...state,cards:['K','Q'],canSplit:false})]);
  assert.equal(answers[0].move,'split');assert.equal(answers[1].move,'stand');assert.equal(starts,1);
  ai.dispose();
});
test('a stalled local model is terminated and reports unavailability rather than sending a late action',async()=>{
  const {createLocalAi}=require('../engine/localAi.cjs');
  const ai=createLocalAi({directory:'/unused',exists:()=>true,spawnWorker:()=>transport(()=>{}),requestTimeoutMs:20});
  await ai.prepare();
  await assert.rejects(ai.predict(state),/demorou/);
  assert.equal(ai.status().phase,'error');
  await assert.rejects(ai.predict(state));ai.dispose();
});
test('closing the app cancels model startup without leaving its caller hanging',async()=>{
  const {createLocalAi}=require('../engine/localAi.cjs');
  const ai=createLocalAi({directory:'/unused',exists:()=>true,spawnWorker:()=>{
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('exit',0);return child;
  }});
  const preparing=ai.prepare();ai.dispose();
  await assert.rejects(preparing,/desligada/);assert.equal(ai.status().phase,'idle');
});

test('AI play is discarded if Stop is clicked while inference is pending',async()=>{
  const {createBlackjackAutoRunner}=await import('../strategy/blackjackAuto.js');
  let finish;const sent=[];
  const runner=createBlackjackAutoRunner({send:async(a,p)=>{sent.push(p);return true;},choosePlay:()=>new Promise(resolve=>finish=resolve)});
  runner.start(1,10);
  const context={connected:true,tokens:50,events:{blackjackTableState:{tableId:'t',roundNumber:1,phase:'acting',dealerCards:[{rank:'10',suit:'S'}],seats:[{mine:true,turnId:'turn',activeHandIndex:0,hands:[{status:'playing',bet:10,cards:[{rank:'9',suit:'S'},{rank:'7',suit:'H'}]}]}]}}};
  const task=runner.observe(context);assert.equal(typeof finish,'function');runner.stop();finish({move:'stand',engine:'laya'});await task;
  assert.equal(sent.length,0);
});
test('AI can choose a legal alternative; an outdated hand is never acted on',async()=>{
  const {createBlackjackAutoRunner}=await import('../strategy/blackjackAuto.js');
  const sent=[];let finish;
  const runner=createBlackjackAutoRunner({send:async(a,p)=>{sent.push(p);return true;},choosePlay:()=>new Promise(resolve=>finish=resolve)});
  const table={tableId:'t',roundNumber:1,phase:'acting',dealerCards:[{rank:'10',suit:'S'}],seats:[{mine:true,turnId:'one',activeHandIndex:0,hands:[{status:'playing',bet:10,cards:[{rank:'9',suit:'S'},{rank:'7',suit:'H'}]}]}]};
  const context={connected:true,tokens:50,events:{blackjackTableState:table}};
  runner.start(1,10);let task=runner.observe(context);finish({move:'stand',engine:'laya'});await task;
  assert.equal(sent[0].move,'stand');assert.equal(sent[0].decisionEngine,'laya');runner.stop();
  runner.start(2,10);task=runner.observe(context);
  runner.observe({...context,events:{blackjackTableState:{...table,phase:'result'}}});finish({move:'hit',engine:'laya'});await task;
  assert.equal(sent.length,1);runner.stop();
});
test('a short server deadline uses the immediate reference action without waiting for AI',async()=>{
  const {createBlackjackAutoRunner}=await import('../strategy/blackjackAuto.js');
  const sent=[];let consulted=false;
  const runner=createBlackjackAutoRunner({now:()=>1000,send:async(a,p)=>{sent.push(p);return true;},choosePlay:async()=>{consulted=true;return {move:'stand',engine:'laya'};}});
  runner.start(1,10);
  await runner.observe({connected:true,tokens:30,events:{blackjackTableState:{tableId:'t',roundNumber:1,phase:'acting',dealerCards:[{rank:'10',suit:'S'}],seats:[{mine:true,turnId:'one',activeHandIndex:0,actionDeadlineAt:3000,hands:[{status:'playing',bet:10,cards:[{rank:'9',suit:'S'},{rank:'7',suit:'H'}]}]}]}}});
  assert.equal(consulted,false);assert.equal(sent[0].move,'hit');assert.equal(sent[0].decisionEngine,'table-fallback');runner.stop();
});
// React controls were replaced by native Qt controls; see test_ui.py.
