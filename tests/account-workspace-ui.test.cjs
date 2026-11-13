const test=require('node:test'),assert=require('node:assert/strict'),{loadComponent,render}=require('./helpers/render.cjs');
const accounts=[{id:'a',label:'Alice'},{id:'b',label:'Bob'}],workspace={version:1,groups:[{id:'farmer',name:'Farmer'},{id:'trader',name:'Trader'}],accountGroups:{a:'farmer'},profiles:[{id:'p',name:'Cauteloso',config:{farm:{case:true,money:false,vault:true},itemRules:[{name:'A',action:'keep'}],destinations:[{accountId:'b'}]}}]};
test('group controls show exact affected accounts and distinguish selection from local association',async()=>{
 const Component=await loadComponent('/src/components/AccountGroups.jsx');const html=render(Component,{accounts,workspace,selectedIds:['a'],filter:'farmer',onFilterChange(){},onSelect(){},onCommand(){}});
 assert.match(html,/Alice/);assert.match(html,/Selecionar.*grupo/);assert.match(html,/Associar.*selecionadas/);assert.match(html,/não elimina contas/);assert.match(html,/Mover Farmer para baixo/);
});
test('profiles explain configuration-only loading and show saved farm rules and destinations',async()=>{
 const Component=await loadComponent('/src/components/LocalOperationProfiles.jsx');const html=render(Component,{accounts,profiles:workspace.profiles,currentConfig:{farm:{case:true,money:false,vault:true}},onCommand(){},onApply(){}});
 assert.match(html,/Cauteloso/);assert.match(html,/Carregar configuração/);assert.match(html,/não inicia operações/);assert.match(html,/1 regra/);assert.match(html,/Bob/);assert.match(html,/Guardar perfil/);
});
test('accounts group filtering respects both session and group constraints',async()=>{
 const Component=await loadComponent('/src/pages/AccountsPage.jsx');const html=render(Component,{model:{accounts,accountWorkspace:workspace,farmStatus:{accounts:[]},snapshots:{a:{money:1},b:{money:2}},form:{label:''},actions:{},selectedIds:[]},ui:{groupId:'farmer',status:'connected'},onUiChange(){}});
 assert.match(html,/Atualizar Alice/);assert.doesNotMatch(html,/Atualizar Bob/);
});
