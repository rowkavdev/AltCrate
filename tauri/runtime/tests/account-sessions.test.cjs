const test=require('node:test');
const assert=require('node:assert/strict');
test('remaining login IDs exclude connected accounts and include unknown, expired and explicitly invalid sessions',async()=>{
 const {pendingLoginIds}=await import('../../casepilot/apps/web/src/accountSessions.js');
 const accounts=['connected','unknown','expired','invalidated'].map(id=>({id}));
 const snapshots={connected:{money:10},expired:{error:'HTTP 401'},invalidated:{money:20}};
 assert.deepEqual(pendingLoginIds(accounts,snapshots,[{id:'invalidated',needsLogin:true}]),['unknown','expired','invalidated']);
 assert.deepEqual(pendingLoginIds([{id:'connected'}],snapshots),[]);
});
