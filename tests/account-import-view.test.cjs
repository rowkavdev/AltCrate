const test=require('node:test'),assert=require('node:assert/strict'),{loadComponent,render}=require('./helpers/render.cjs');
const model=(overrides={})=>({accounts:[{id:'a1',label:'player+1@example.com',email:'player+1@example.com',hasPassword:true}],snapshots:{},farmStatus:{accounts:[]},form:{label:''},bridge:{importAccounts(){},connectAccount(){}},actions:{},...overrides});
test('imported accounts remain unverified and offer import and login controls',async()=>{
 const Page=await loadComponent('/src/pages/AccountsPage.jsx');const html=render(Page,{model:model(),ui:{},onUiChange(){}});
 assert.match(html,/Importar JSON/);assert.match(html,/Entrar<\/button>/);assert.match(html,/sessão por validar/);assert.doesNotMatch(html,/type="password"/);
});
test('import is disabled while operations run and pending imports appear in login filter',async()=>{
 const Page=await loadComponent('/src/pages/AccountsPage.jsx');const html=render(Page,{model:model({running:true}),ui:{status:'login'},onUiChange(){}});
 assert.match(html,/disabled=""[^>]*>[\s\S]*?Importar JSON/);assert.match(html,/player\+1@example.com/);assert.match(html,/1 visível/);
});
test('already imported accounts offer automatic batch login and stopping remains available while busy',async()=>{
 const Page=await loadComponent('/src/pages/AccountsPage.jsx');const html=render(Page,{model:model({busy:true,accountLogin:{phase:'running',total:51,connected:5,alreadyConnected:1,withoutPassword:0,label:'Current account'}}),ui:{},onUiChange(){}});
 assert.match(html,/Religar todas as contas/);assert.match(html,/Parar logins/);assert.match(html,/Current account/);assert.match(html,/5/);
});
