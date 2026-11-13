const test=require('node:test'),assert=require('node:assert/strict');const {safeEvent}=require('../electron/export.cjs');
test('farm failure exports retain diagnostic fields and exclude raw server content',()=>{
 const event=safeEvent({type:'account-error',operation:'money',stage:'request',httpStatus:503,errorCategory:'http',errorCode:'',failures:3,paused:true,retryAt:0,message:'Authorization: Bearer secret',cookie:'secret'});
 assert.equal(event.httpStatus,503);assert.equal(event.operation,'money');assert.equal(event.paused,true);assert.match(event.message,/HTTP 503/);assert.equal(JSON.stringify(event).includes('secret'),false);
});
test('diagnostic export rejects arbitrary operation names and error codes',()=>{
 const event=safeEvent({type:'account-error',operation:'secret-token',stage:'private-url',errorCategory:'private-data',errorCode:'secret',failures:200,message:'secret'});
 assert.equal(JSON.stringify(event).includes('secret'),false);assert.equal(event.failures,3);
});
