const test=require('node:test'),assert=require('node:assert/strict');
test('summary cache retains safe membership and never classifies missing or broken data as free',async()=>{
 const {accountSummaryCache}=await import('../../casepilot/apps/web/src/accountSummaryCache.js');
 const result=accountSummaryCache({a:{money:2,membership:'pro',inventoryCount:3,inventorySize:50,observedAt:'2026-10-16T10:00:00Z',password:'private'},b:{tokens:1,membership:'future-tier'},c:{tokens:1,error:'failed',membership:'free'},d:{tokens:1}});
 assert.equal(result.a.membership,'pro');assert.equal(result.a.inventoryCount,3);assert.equal(result.a.inventorySize,50);assert.equal(result.a.password,undefined);
 assert.equal(result.b.membership,null);assert.equal(result.c,undefined);assert.equal(result.d.membership,undefined);
});
