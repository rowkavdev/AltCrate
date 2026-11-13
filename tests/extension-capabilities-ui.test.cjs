const test=require('node:test'),assert=require('node:assert/strict'),{loadComponent,render}=require('./helpers/render.cjs');
test('boost panel states concrete verification gaps and cannot issue activation',async()=>{
 const Panel=await loadComponent('/src/pages/BoostsPanel.jsx');const html=render(Panel,{capability:{title:'Boosts',state:'unavailable',reason:'Falta confirmar a duração e a ativação.',missingEvidence:[{id:'activation',description:'Confirmar a ativação e o consumo do boost.'}],sourceRefs:[],observedAt:'2026-10-14'}});
 assert.match(html,/Falta confirmar a duração/);assert.match(html,/disabled=""/);assert.match(html,/Ativação indisponível/);assert.doesNotMatch(html,/onclick/i);
});
test('capability panel shows prepared limitations without game-action controls',async()=>{
 const Panel=await loadComponent('/src/components/CapabilityPanel.jsx');const html=render(Panel,{capabilities:[{id:'capsule-opening',title:'Cápsulas',state:'unavailable',reason:'Falta verificar os itens recebidos.',missingEvidence:[],sourceRefs:[],liveVerified:false}]});
 assert.match(html,/Cápsulas/);assert.match(html,/Falta verificar os itens recebidos/);assert.match(html,/Sem validação no jogo/);assert.doesNotMatch(html,/<button/);
});
