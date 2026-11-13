const test=require('node:test'),assert=require('node:assert/strict');
const {createCaseApi}=require('../engine/api.cjs');const id='a'.repeat(24);
test('case price quotes come from the current catalog and expose only validated IDs and prices',async()=>{
 const calls=[],api=createCaseApi(async(path,init)=>{calls.push({path,method:init.method});return new Response(JSON.stringify([{_id:id,price:70,name:'Case',privateField:'omit'}]));});
 assert.equal(typeof api.converterCasePrices,'function');assert.deepEqual(await api.converterCasePrices(),[{id,price:70}]);assert.deepEqual(calls,[{path:'/api/cases/cases',method:'GET'}]);
});
test('missing prices, malformed IDs and duplicate case quotes are refused',async()=>{
 for(const body of [[{_id:id}], [{_id:'wrong',price:5}],[{_id:id,price:5},{_id:id,price:6}]]){const api=createCaseApi(async()=>new Response(JSON.stringify(body)));assert.equal(typeof api.converterCasePrices,'function');await assert.rejects(api.converterCasePrices());}
});
