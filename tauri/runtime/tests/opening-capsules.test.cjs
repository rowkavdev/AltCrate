const test = require('node:test');
const assert = require('node:assert/strict');
const {createCaseApi} = require('../engine/api.cjs');
const {createOpenScheduler} = require('../engine/openScheduler.cjs');
const request = require('../engine/openingRequest.cjs');
const capsule = 'a'.repeat(24), drop = 'b'.repeat(24);

test('capsule opening sends the selected capsule ID to the capsule endpoint', async () => {
  const calls = [];
  const ids = Array.from({length:6},(_,i)=>(i+1).toString(16).padStart(24,'0'));
  const api = createCaseApi(async (path,init) => {
    calls.push({path,init});
    return new Response(JSON.stringify(ids.map(_id=>({_id}))));
  });
  const result = await api.openCase(capsule,2,3,'capsule');
  assert.equal(calls[0].path,'/api/open/capsule');
  assert.deepEqual(JSON.parse(calls[0].init.body),{id:capsule,quickOpen:true,count:2,useEventTickets:false,caseOpenMultiplier:3});
  assert.deepEqual(result.skinIds,ids);
});

test('capsules identify opened stickers rather than the catalogue of possible stickers', async () => {
  for (const [body,expected] of [
    [{stickers:[{_id:capsule}],openedStickers:[{_id:drop}]},[drop]],
    [{stickers:[{_id:capsule}]},[]],
    [{_id:drop},[drop]],
  ]) {
    const api=createCaseApi(async()=>new Response(JSON.stringify(body)));
    assert.deepEqual((await api.openCase(capsule,1,1,'capsule')).skinIds,expected);
  }
});

test('unsupported opening types are rejected before any request',async()=>{
  let calls=0;
  const api=createCaseApi(async()=>{calls++;return new Response('[]');});
  for(const type of ['collectionCase','keychainCollection','../case',null])
    await assert.rejects(()=>api.openCase(capsule,1,1,type),/tipo/i);
  assert.equal(calls,0);
});

test('the backend derives the opening type from the catalogue and refuses unknown containers',()=>{
  const catalog=[{id:capsule,category:'capsules'},{id:drop,category:'cases'},{id:'c'.repeat(24),category:'collections'}];
  assert.equal(request.openingTypeForCatalog(capsule,catalog),'capsule');
  assert.equal(request.openingTypeForCatalog(drop,catalog),'case');
  assert.throws(()=>request.openingTypeForCatalog('c'.repeat(24),catalog),/disponível/i);
  assert.throws(()=>request.openingTypeForCatalog('unknown',catalog),/catálogo/i);
});

test('capsule settings retain their type and reject skin price conversion',()=>{
  const config={caseId:capsule,containerType:'capsule',convert:false,maxPrice:0,maxCasesPerAccount:7};
  assert.equal(request.openingRunSettings(config,[{id:'a'}]).containerType,'capsule');
  assert.throws(()=>request.openingRunSettings({...config,containerType:'collectionCase'},[{id:'a'}]),/tipo/i);
  assert.throws(()=>request.openingRunSettings({...config,convert:true},[{id:'a'}]),/conversão/i);
});

function pipeline({loseResponse=false,missingIds=false}={}) {
  const stock={a:9,b:0,c:4},writes=[],events=[];
  let clock=0,sequence=0;
  const scheduler=createOpenScheduler({
    now:()=>clock,sleep:async ms=>{clock+=ms;},emit:event=>events.push(event),
    apiForAccount:account=>createCaseApi(async(path,init)=>{
      if(path==='/api/me')return new Response(JSON.stringify({money:100,tokens:0,moneyPerClick:1,casesPerClick:1,caseOpenCount:3,maxCaseOpenMultiplier:2,inventoryCount:0}));
      if(path==='/api/cases')return new Response(JSON.stringify([{_id:capsule,amount:stock[account.id],type:'capsule'}]));
      assert.equal(path,'/api/open/capsule');
      const body=JSON.parse(init.body);assert.equal(body.id,capsule);
      writes.push({account:account.id,...body});stock[account.id]-=body.count*body.caseOpenMultiplier;
      if(loseResponse)throw Error('Response lost');
      return new Response(JSON.stringify(missingIds?[]:Array.from({length:body.count*body.caseOpenMultiplier},()=>({_id:(++sequence).toString(16).padStart(24,'0')}))));
    }),
  });
  const config=request.openingRunSettings({caseId:capsule,containerType:'capsule',convert:false,maxPrice:0,maxCasesPerAccount:7},[{id:'a'},{id:'b'},{id:'c'}]);
  return {scheduler,config,stock,writes,events};
}

test('capsule UI request, API and scheduler respect stock, account quantity and multipliers',async()=>{
  const h=pipeline();const result=await h.scheduler.start(h.config);
  assert.equal(result.confirmed,11);
  assert.deepEqual(h.stock,{a:2,b:0,c:0});
  assert.equal(h.writes.some(row=>row.account==='b'),false);
  assert.deepEqual(result.accounts.map(row=>row.opened),[7,0,4]);
  assert(h.events.filter(event=>event.type==='open').every(event=>event.verified));
});

test('a lost or unidentified capsule response stops without repeating the opening',async()=>{
  for(const options of [{loseResponse:true},{missingIds:true}]){
    const h=pipeline(options);const result=await h.scheduler.start({...h.config,accounts:[{id:'a'}]});
    assert.equal(h.writes.length,1);
    assert.equal(result.confirmed,0);
    assert.equal(result.unconfirmed,6);
    assert.equal(result.accounts[0].disabled,true);
  }
});
