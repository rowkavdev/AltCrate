const test = require('node:test');
const assert = require('node:assert/strict');

test('100 account search and window show at most 20 visible rows', async () => {
  const { filterFarmAccounts, visibleFarmAccounts } = await import('../src/farmViewModel.js');
  const accounts = Array.from({length:100},(_,i)=>({id:`a${i+1}`,label:`Conta ${i+1}`}));
  const status = {accounts:accounts.map((account)=>({id:account.id,paused:account.id==='a100'}))};
  assert.equal(filterFarmAccounts(accounts,'100','all',status).length,1);
  assert.equal(filterFarmAccounts(accounts,'','paused',status)[0].id,'a100');
  const all=filterFarmAccounts(accounts,'','all',status);
  assert.ok(visibleFarmAccounts(all,0,64,640).items.length<=20);
  assert.ok(visibleFarmAccounts(all,64*90,64,640).items.some((item)=>item.id==='a100'));
});

test('a running account waiting for the exhausted click window is not also active', async () => {
  const { farmAccountActivity, formatVirtualMoney } = await import('../src/farmViewModel.js');
  const now = 1000;
  const entry = { selected:true, modes:{case:true,money:true,vault:true}, retryAt:0, vaultNextAt:999999 };
  const status = { phase:'running', budget:{combinedRemaining:0,caseUsed:950,moneyUsed:950,waitUntil:310000}, accounts:[entry] };
  assert.deepEqual(farmAccountActivity(entry,status,now), {active:false,waiting:true});
  assert.equal(formatVirtualMoney(15150.541668254264), '$15 150,54');
  assert.equal(formatVirtualMoney(253.64999999999964), '$253,65');
});

test('refresh queue ignores a second pass while first is active', async () => {
  const { createAccountRefreshQueue } = await import('../src/accountRefresh.js');
  const calls=[];
  let release;
  const gate=new Promise((resolve)=>{release=resolve;});
  const queue=createAccountRefreshQueue({refreshAccount:async(id)=>{calls.push(id);if(id==='a1')await gate;},delayMs:0});
  const accounts=Array.from({length:100},(_,i)=>({id:`a${i+1}`}));
  const first=queue.run(accounts);
  const second=queue.run(accounts);
  release();
  await Promise.all([first,second]);
  assert.equal(calls.length,100);
});

test('farm panel renders global and per-account controls for a window of 100 accounts', async () => {
  const { createServer } = await import('vite');
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  try {
    const { default: Panel } = await server.ssrLoadModule('/src/FarmControlPanel.jsx');
    const accounts = Array.from({length:100},(_,i)=>({id:`a${i+1}`,label:`Conta ${i+1}`}));
    const status = {phase:'idle',accounts:accounts.map((item)=>({id:item.id,modes:{case:true,money:true,vault:true}}))};
    const html = renderToStaticMarkup(React.createElement(Panel,{accounts,snapshots:{},status,bridge:{},onNotice:()=>{},selectedIds:accounts.map((item)=>item.id),setSelectedIds:()=>{},onRefresh:()=>{},onRemove:()=>{}}));
    assert.match(html,/Iniciar caixas, dinheiro e cofre/);
    assert.match(html,/Pesquisar contas/);
    assert.match(html,/Modos de Conta 1/);
    assert.equal((html.match(/class="farm-row"/g)||[]).length<=20,true);
  } finally { await server.close(); }
});

test('idle accounts are not called active and unavailable vault reason stays visible', async () => {
  const { createServer } = await import('vite');
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  try {
    const { default: Panel } = await server.ssrLoadModule('/src/FarmControlPanel.jsx');
    const account = {id:'a',label:'Conta A'};
    const status = {phase:'idle',accounts:[{id:'a',selected:true,modes:{case:true,money:true,vault:true},vaultNextAt:Date.now()+300000,error:'Dados do cofre indisponíveis.'}]};
    const html = renderToStaticMarkup(React.createElement(Panel,{accounts:[account],snapshots:{},status,bridge:{},onNotice:()=>{},selectedIds:['a'],setSelectedIds:()=>{},onRefresh:()=>{},onRemove:()=>{}}));
    assert.match(html,/<strong>0<\/strong> em curso/);
    assert.match(html,/<strong>0<\/strong> em espera/);
    assert.match(html,/Dados do cofre indisponíveis/);
  } finally { await server.close(); }
});

test('account row formats observed money and names the vault wait', async () => {
  const { createServer } = await import('vite');
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  try {
    const { default: Panel } = await server.ssrLoadModule('/src/FarmControlPanel.jsx');
    const account = {id:'a',label:'Conta A'};
    const status = {phase:'running',budget:{combinedRemaining:0,caseUsed:950,moneyUsed:950,waitUntil:Date.now()+310000},accounts:[{id:'a',selected:true,modes:{case:true,money:true,vault:true},vaultNextAt:Date.now()+300000,last:{kind:'money',confirmedDelta:253.64999999999964}}]};
    const html = renderToStaticMarkup(React.createElement(Panel,{accounts:[account],snapshots:{a:{casesTotal:13582,money:15150.541668254264}},status,bridge:{},onNotice:()=>{},selectedIds:['a'],setSelectedIds:()=>{},onRefresh:()=>{},onRemove:()=>{}}));
    assert.match(html,/Conta A/);
    assert.match(html,/253,65 confirmado/);
    assert.match(html,/Cofre agendado/);
    assert.match(html,/<strong>0<\/strong> em curso/);
    assert.match(html,/<strong>1<\/strong> em espera/);
    assert.doesNotMatch(html,/15150\.541668|253\.649999/);
  } finally { await server.close(); }
});
