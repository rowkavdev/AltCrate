const test=require('node:test');
const assert=require('node:assert/strict');
let createStorageDeposit;try{({createStorageDeposit}=require('../engine/storageDeposit.cjs'));}catch{}
const itemId='a'.repeat(24),storageId='b'.repeat(24);
function fixture(options={}){
 const calls=[],limits=[],accounts=[{id:'source',label:'Origem'},{id:'destination',label:'Destino'}];
 const identity=options.identity||'destination-identity';
 const locator={identity:async()=>identity,scan:async(_account,_item,unit,cursor)=>{if(options.scan) return options.scan(unit,cursor);return unit?{outcome:options.storageOutcome||'absent'}:{outcome:options.inventoryOutcome||'found'};}};
 const deps={listAccounts:async()=>accounts,listStorageUnits:async accountId=>accountId==='destination'&&!options.foreign?[{id:storageId,name:'Blue',count:2}]:[],apiForAccount:account=>({depositStorageSkin:async(item,unit)=>{calls.push({account:account.id,item,unit});return options.response||{ok:true,status:200,retryAfter:null,message:''};}}),locator,accountQueue:{run:(_id,work)=>work()},coordinator:{cooldown:async()=>0,limit:async value=>limits.push(value)},now:()=>1000};
 const record={ref:{itemId},destinationAccountId:'destination',destinationStorageUnitId:storageId,destinationIdentity:'destination-identity'};
 return {service:typeof createStorageDeposit==='function'?createStorageDeposit(deps):null,calls,limits,record};
}
test('deposit posts one item to owner session',async()=>{
 const f=fixture();assert.equal(typeof createStorageDeposit,'function');
 assert.deepEqual((await f.service.preflight('destination',storageId)).storage,{id:storageId,name:'Blue',count:2});
 assert.equal((await f.service.sendOnce(f.record)).ok,true);
 assert.deepEqual(f.calls,[{account:'destination',item:itemId,unit:storageId}]);
});
test('foreign storage is rejected before deposit',async()=>{
 const f=fixture({foreign:true});assert.equal(typeof createStorageDeposit,'function');
 await assert.rejects(f.service.sendOnce(f.record),/Storage.*conta|Storage.*encontrado/i);assert.equal(f.calls.length,0);
});
test('identity drift blocks deposit',async()=>{
 const f=fixture({identity:'changed'});assert.equal(typeof createStorageDeposit,'function');
 await assert.rejects(f.service.sendOnce(f.record),/identidade/i);assert.equal(f.calls.length,0);
});
test('429 pauses deposit',async()=>{
 const f=fixture({response:{ok:false,status:429,retryAfter:'60',message:'Limit'}});assert.equal(typeof createStorageDeposit,'function');
 assert.equal((await f.service.sendOnce(f.record)).status,429);assert.equal(f.limits.length,1);assert.ok(f.limits[0]>1000);
});
test('verify requires exact item location',async()=>{
 const f=fixture({inventoryOutcome:'absent',storageOutcome:'found'});assert.equal(typeof createStorageDeposit,'function');
 assert.deepEqual(await f.service.verify(f.record),{inInventory:false,inStorage:true,location:'storage'});
 const unknown=fixture({inventoryOutcome:'absent',storageOutcome:'unknown'});assert.deepEqual(await unknown.service.verify(unknown.record),{inInventory:false,inStorage:null,location:'unknown'});
});
test('deposit requires fresh proof that item is only in destination inventory',async()=>{
 const absent=fixture({inventoryOutcome:'absent'});
 await assert.rejects(absent.service.sendOnce(absent.record),/inventário|localização/i);
 assert.equal(absent.calls.length,0);
 const uncertain=fixture({inventoryOutcome:'unknown'});
 await assert.rejects(uncertain.service.sendOnce(uncertain.record),/inventário|localização/i);
 assert.equal(uncertain.calls.length,0);
 const alreadyStored=fixture({storageOutcome:'found'});
 await assert.rejects(alreadyStored.service.sendOnce(alreadyStored.record),/inventário|localização/i);
 assert.equal(alreadyStored.calls.length,0);
});
test('verification continues after page twenty on later checks',async()=>{
 const seen=[];
 const f=fixture({scan:(unit,cursor)=>{seen.push({unit,cursor});if(!unit)return {outcome:'absent'};return cursor?.page===21?{outcome:'found'}:{outcome:'unknown',cursor:{page:21,stamp:'same'}};}});
 assert.equal((await f.service.verify(f.record)).location,'unknown');
 assert.equal((await f.service.verify(f.record)).location,'storage');
 assert.deepEqual(seen.filter(entry=>entry.unit).map(entry=>entry.cursor),[null,{page:21,stamp:'same'}]);
});
test('fresh pre-send scan reaches item beyond page twenty',async()=>{
 const f=fixture({scan:(unit,cursor)=>unit?{outcome:'absent'}:cursor?.page===21?{outcome:'found'}:{outcome:'unknown',cursor:{page:21,stamp:'same'}}});
 assert.equal((await f.service.sendOnce(f.record)).ok,true);assert.equal(f.calls.length,1);
});
test('full storage cannot receive another skin but its final slot can still be verified',async()=>{
 const calls=[],service=createStorageDeposit({listAccounts:async()=>[{id:'destination'}],listStorageUnits:async()=>[{id:storageId,count:1000}],locator:{identity:async()=> 'owner',scan:async(_a,_s,unit)=>({outcome:unit?'found':'absent'})},apiForAccount:()=>({depositStorageSkin:async()=>{calls.push(1);}})}),record={ref:{itemId},destinationAccountId:'destination',destinationStorageUnitId:storageId,destinationIdentity:'owner'};
 await assert.rejects(service.sendOnce(record),/1000 skins/);assert.equal(calls.length,0);assert.equal((await service.verifyComplete(record)).location,'storage');
});
