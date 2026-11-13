const test=require('node:test');const assert=require('node:assert/strict');
test('bulk configuration continues after one failure and never starts farming',async()=>{
 const {applyModesToAccounts}=await import('../src/farmActions.js');
 const called=[];let active=0,maximum=0,starts=0;
 const bridge={farmStart(){starts++;},async farmSetModes(id){active++;maximum=Math.max(maximum,active);called.push(id);await Promise.resolve();active--;if(id==='a50')throw Error('Sessão expirada');}};
 const ids=Array.from({length:100},(_,i)=>'a'+(i+1));
 const result=await applyModesToAccounts(bridge,[...ids,'a100'],{case:true,money:true,vault:true});
 assert.equal(maximum,1);assert.equal(starts,0);assert.equal(called.length,100);assert.equal(result.appliedIds.at(-1),'a100');assert.equal(result.failures[0].accountId,'a50');assert.equal(result.appliedIds.length,99);
});
test('a virtualized list can reach the last account in row and card layouts',async()=>{
 const {farmLayoutForWidth,visibleFarmAccounts}=await import('../src/farmViewModel.js');
 const accounts=Array.from({length:100},(_,i)=>({id:'a'+(i+1)}));
 for(const width of [320,759,760,1440]){const layout=farmLayoutForWidth(width);const window=visibleFarmAccounts(accounts,layout.rowHeight*95,layout.rowHeight,570);assert.ok(window.items.some(item=>item.id==='a100'));assert.ok(window.items.length<=20);}
});
