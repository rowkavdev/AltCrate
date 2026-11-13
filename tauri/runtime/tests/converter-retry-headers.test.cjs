const test=require('node:test'),assert=require('node:assert/strict');
const {createRequestCoordinator}=require('../engine/requestCoordinator.cjs');
const {createCoordinatedTransport}=require('../engine/coordinatedTransport.cjs');
const {createCaseApi}=require('../engine/api.cjs');
const {createInventoryReader}=require('../engine/inventoryView.cjs');
const {createItemLocator}=require('../engine/inventoryItemLocator.cjs');
const {sessionRateLimit}=require('../engine/authRateLimit.cjs');
const scenarios=[
 {headers:{'X-Retry-After':'12'},want:12000},
 {headers:{'Retry-After':'7','X-Retry-After':'12'},want:12000},
 {headers:{'Retry-After':'20','X-Retry-After':'12'},want:20000},
 {headers:{'Retry-After':'invalid','X-Retry-After':'12'},want:12000},
 {headers:{},want:300000}
];
for(const [i,{headers,want}] of scenarios.entries())test('converter transport and error propagation agree with login retry headers '+i,async()=>{
 let hold=0;const fetchForAccount=createCoordinatedTransport({now:()=>1000,requestWork:createRequestCoordinator(),coordinator:{cooldown:async()=>0,limit:async until=>{hold=until}},fetchForAccount:()=>async()=>new Response('{}',{status:429,headers})});
 const fetcher=fetchForAccount({id:'a'}),api=createCaseApi(fetcher);
 await assert.rejects(api.converterCases(),e=>e.status===429&&(headers['X-Retry-After']?Number(e.retryAfter)*1000===want:e.retryAfter===null));
 assert.equal(hold-1000,want);assert.equal(sessionRateLimit(new Response('{}',{status:429,headers}),{now:1000}).rateLimit.waitMs,want);
});
test('inventory listing and item identity preserve the custom retry header for converter recovery',async()=>{
 const account={id:'a'},listAccounts=async()=>[account],fetchForAccount=()=>async()=>new Response('{}',{status:429,headers:{'X-Retry-After':'12'}});
 const reader=createInventoryReader({listAccounts,fetchForAccount}),locator=createItemLocator({listAccounts,fetchForAccount});
 for(const read of [()=>reader(account.id,1),()=>locator.identity(account.id)])await assert.rejects(read,e=>e.status===429&&e.retryAfter==='12');
});
