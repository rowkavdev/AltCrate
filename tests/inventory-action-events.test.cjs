const test=require('node:test'),assert=require('node:assert/strict'),{safeEvent,createReport}=require('../electron/export.cjs');
test('inventory event export strips private fields and distinguishes confirmation from acceptance',async()=>{
 const event={type:'inventory-action',operationId:'op',kind:'transfer',accountId:'source',destinationAccountId:'destination',item:{id:'a'.repeat(24),name:'Skin',cookie:'fixture-secret'},state:'unconfirmed',verified:false,httpStatus:200,stage:'result',token:'fixture-secret',partition:'fixture-secret',sourceIdentity:'fixture-secret'};
 const output=safeEvent(event);assert.equal(output.destinationAccountId,'destination');assert.equal(output.kind,'transfer');assert.equal(JSON.stringify(output).includes('fixture-secret'),false);
 const {activityConfirmed,filterActivityEvents}=await import('../src/activityViewModel.js');assert.equal(activityConfirmed(output),false);assert.equal(filterActivityEvents([output],{accountId:'destination'}).length,1);assert.equal(filterActivityEvents([output],{result:'unconfirmed'}).length,1);assert.equal(activityConfirmed({...output,state:'confirmed',verified:true}),true);
});
test('report includes recovered inventory operations without relying on session events',()=>{
 const report=createReport({inventoryOperations:[{operationId:'pending',accountId:'source',kind:'transfer',state:'unconfirmed',verified:false,token:'fixture-secret'}]});assert.equal(report.inventoryOperations?.[0]?.operationId,'pending');assert.equal(JSON.stringify(report).includes('fixture-secret'),false);
});
