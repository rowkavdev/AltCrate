const test=require('node:test'),assert=require('node:assert/strict'),{loadComponent,render}=require('./helpers/render.cjs');
test('individual ranking panel selects visible items explicitly and separates cache date from source date',async()=>{
 const Panel=await loadComponent('/src/pages/ItemRankingPanel.jsx');
 const html=render(Panel,{accountId:'a',bridge:{itemRankingRead(){},itemRankingRefresh(){}},items:[{id:'a'.repeat(24),name:'Karambit | Fade'}]});
 for(const text of ['Ranking individual','Overall','Karambit | Fade','Consultar selecionados','Observação local','Atualização na origem','Sem consulta','Selecionar Karambit | Fade'])assert.ok(html.includes(text),text);
 assert.match(html,/type="checkbox"/);assert.match(html,/cobertura agregada/);assert.match(html,/Consultar selecionados[\s\S]*Parar/);
});
test('ranking panel exposes unavailable capability without showing coverage as position',async()=>{
 const Panel=await loadComponent('/src/pages/ItemRankingPanel.jsx');const html=render(Panel,{accountId:'a',bridge:{},items:[]});
 assert.match(html,/indisponível nesta versão/);assert.doesNotMatch(html,/#0/);
});
