const test=require('node:test');const assert=require('node:assert/strict');
const settings=()=>require('../engine/openingRequest.cjs').openingRunSettings;
test('one-case request works while keeping all items and requires one account',()=>{
 const build=settings();const value=build({caseId:'case',testOnce:true,convert:false,maxPrice:0},[{id:'a'}],[]);assert.equal(value.testOnce,true);assert.equal(value.maxOpens,1);assert.equal(value.maxCasesPerAccount,1);assert.equal(value.continuous,false);assert.throws(()=>build({testOnce:true},[{id:'a'},{id:'b'}],[]),/uma conta/);
});
test('finite quantity crosses the production request boundary without becoming a request count',()=>{
 const value=settings()({caseId:'case',convert:false,maxPrice:0,maxCasesPerAccount:13},[{id:'a'},{id:'b'}],[]);assert.equal(value.maxCasesPerAccount,13);assert.equal(value.continuous,true);assert.equal(value.concurrency,2);assert.equal(value.conversionCap,null);
});
