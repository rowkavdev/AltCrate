const test=require('node:test');const assert=require('node:assert/strict');
test('preferred game density fits the available width and account count',async()=>{
 const {gameColumnsForWidth}=await import('../src/gameLayout.js');
 assert.equal(gameColumnsForWidth(320,5,100),1);assert.equal(gameColumnsForWidth(736,5,20),2);assert.equal(gameColumnsForWidth(1200,5,20),3);assert.equal(gameColumnsForWidth(2000,5,20),5);assert.equal(gameColumnsForWidth(2000,5,1),1);assert.equal(gameColumnsForWidth(1000,5,0),0);
});
test('a remembered upgrade target is unavailable until the current options include it',async()=>{
 const {upgradeTargetReady}=await import('../src/gameLayout.js');
 assert.equal(upgradeTargetReady('remembered',[]),false);
 assert.equal(upgradeTargetReady('remembered',[{id:'new'}]),false);
 assert.equal(upgradeTargetReady('remembered',[{id:'remembered'}]),true);
});
test('returning to a game preserves its stake form instead of restoring the initial stake',async()=>{
 const {gameInitialBet}=await import('../src/gameLayout.js');
 assert.equal(gameInitialBet('dice','245'),'245');assert.equal(gameInitialBet('blackjack',''),'');assert.equal(gameInitialBet('dice',undefined),'100');assert.equal(gameInitialBet('blackjack',undefined),'1');
});
