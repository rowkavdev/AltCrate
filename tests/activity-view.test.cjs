const test=require('node:test');const assert=require('node:assert/strict');
test('opening activity needs explicit item and selected-stock verification',async()=>{
 const {activityConfirmed,filterActivityEvents}=await import('../src/activityViewModel.js');
 const unconfirmed={type:'open',httpStatus:200,observedCaseDelta:-10,verified:false};
 const confirmed={...unconfirmed,verified:true};
 assert.equal(activityConfirmed(unconfirmed),false);
 assert.deepEqual(filterActivityEvents([unconfirmed,confirmed],{result:'confirmed'}),[confirmed]);
});
test('confirmed activity includes a zero observation and excludes absent evidence',async()=>{
 const {filterActivityEvents}=await import('../src/activityViewModel.js');
 const events=[{type:'request',kind:'money',accountId:'a100',httpStatus:200,verifiedDelta:0},{type:'request',kind:'money',accountId:'a100',httpStatus:200,verifiedDelta:null}];
 assert.deepEqual(filterActivityEvents(events,{result:'confirmed'},{}),[events[0]]);assert.equal(events.length,2);
});
test('activity filters combine account, operation and outcome without losing removed accounts',async()=>{
 const {filterActivityEvents}=await import('../src/activityViewModel.js');
 const events=[{type:'vault',accountId:'a100',httpStatus:200,confirmedDelta:50},{type:'request',kind:'case',accountId:'a100',httpStatus:429},{type:'request',kind:'money',accountId:'a1',httpStatus:200,verifiedDelta:null},{type:'game',game:'blackjack',accountId:'deleted',result:{sent:true,verified:true}}];
 assert.deepEqual(filterActivityEvents(events,{accountId:'a100',operation:'case',result:'failed'},{}),[events[1]]);
 assert.deepEqual(filterActivityEvents(events,{query:'COFRE'},{a100:'Principal'}),[events[0]]);
 assert.deepEqual(filterActivityEvents(events,{result:'unconfirmed'},{}),[events[2]]);
 assert.deepEqual(filterActivityEvents(events,{accountId:'deleted'},{}),[events[3]]);
});
test('HTTP game responses use the status returned by the game bridge',async()=>{
 const {activityAccepted,activityConfirmed,activityFailed,filterActivityEvents}=await import('../src/activityViewModel.js');
 const confirmed={type:'game',game:'dice',result:{status:200,verified:true,diceRoll:42,tokensWonOrLost:10}};
 const accepted={type:'game',game:'plinko',result:{status:200,verified:false}};
 const failed={type:'game',game:'upgrade',result:{status:429,verified:false}};
 assert.equal(activityAccepted(confirmed),true);assert.equal(activityConfirmed(confirmed),true);
 assert.equal(activityAccepted(accepted),true);assert.equal(activityConfirmed(accepted),false);assert.equal(activityFailed(failed),true);
 assert.deepEqual(filterActivityEvents([confirmed,accepted,failed],{result:'confirmed'}),[confirmed]);
});
test('storage move appears as a named activity operation',async()=>{
 const {activityOperation,filterActivityEvents}=await import('../src/activityViewModel.js');
 const event={type:'inventory-action',kind:'move-to-storage',accountId:'a',destinationAccountId:'b',destinationStorageName:'Blue',state:'confirmed',verified:true};
 assert.equal(activityOperation(event),'move-to-storage');
 assert.deepEqual(filterActivityEvents([event],{query:'blue'},{a:'Origem',b:'Destino'}),[event]);
});
