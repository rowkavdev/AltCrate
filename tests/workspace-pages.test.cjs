const test=require('node:test');const assert=require('node:assert/strict');const {loadComponent,render}=require('./helpers/render.cjs');
const accountModel={accounts:[],snapshots:{},farmStatus:{accounts:[]},loading:false,busy:false,form:{label:''},actions:{},setForm(){}};
test('account search reaches the final account without needing a snapshot',async()=>{
 const AccountsPage=await loadComponent('/src/pages/AccountsPage.jsx');
 const model={...accountModel,accounts:Array.from({length:100},(_,i)=>({id:'a'+(i+1),label:'Conta '+(i+1)}))};
 const html=render(AccountsPage,{model,ui:{query:'Conta 100',status:'all'},onUiChange(){}});
 assert.match(html,/Conta 100/);assert.doesNotMatch(html,/Conta 99/);assert.match(html,/—/);
});
test('an empty account page offers login and incomplete account details stay readable',async()=>{
 const Page=await loadComponent('/src/pages/AccountsPage.jsx');
 assert.match(render(Page,{model:accountModel,ui:{query:'',status:'all'},onUiChange(){}}),/Adicionar conta/);
 const Detail=await loadComponent('/src/components/AccountDetails.jsx');
 const html=render(Detail,{account:{id:'a',label:'Conta A'},snapshot:{error:'A sessão foi interrompida; atualiza a conta.',cases:[{id:'c',name:'Gallery Case',amount:7}]},onClose(){}});
 assert.match(html,/Gallery Case/);assert.match(html,/A sessão foi interrompida; atualiza a conta/);assert.match(html,/—/);
});
const openingModel={bridge:{},accounts:[{id:'a',label:'Conta A'}],selectedIds:['a'],snapshots:{},caseChoices:[{id:'case',name:'Gallery Case',amount:1}],form:{caseId:'case',convert:true,conversionMode:'tokens',maxPrice:'1000'},opening:{phase:'idle',opened:0,converted:0},openingCooldown:0,busy:false,loading:false,events:[],actions:{},setForm(){},setSelectedIds(){}};
test('opening rejects a price above the virtual item ceiling',async()=>{
 const Page=await loadComponent('/src/pages/OpeningPage.jsx');
 const html=render(Page,{model:{...openingModel,form:{...openingModel.form,maxPrice:'1000.01'}}});
 assert.match(html,/O teto deve estar entre/);assert.match(html,/<button\b[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Iniciar abertura/);
 const valid=render(Page,{model:openingModel});assert.doesNotMatch(valid,/O teto deve estar entre/);assert.match(valid,/<button\b(?![^>]*disabled)[^>]*>(?:(?!<\/button>)[\s\S])*Iniciar abertura/);
});
test('testing one case requires conversion and a single selected account',async()=>{
 const Page=await loadComponent('/src/pages/OpeningPage.jsx');
 const html=render(Page,{model:{...openingModel,form:{...openingModel.form,conversionMode:'money'}}});
 assert.match(html,/Testar 1 caixa → dinheiro/);
 const multi=render(Page,{model:{...openingModel,selectedIds:['a','b']}});assert.match(multi,/<button\b[^>]*disabled[^>]*>Testar 1 caixa/);
 const empty=render(Page,{model:{...openingModel,caseChoices:[]}});assert.match(empty,/<button\b[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Iniciar abertura/);
 const noConversion=render(Page,{model:{...openingModel,form:{...openingModel.form,convert:false}}});assert.match(noConversion,/<button\b[^>]*disabled[^>]*>Testar 1 caixa/);
});
test('a stopped workspace explains how to recover a paused account',async()=>{
 const Page=await loadComponent('/src/components/OperationSummary.jsx');
 const html=render(Page,{status:{phase:'idle',accounts:[{id:'a',paused:true,modes:{case:true}}]},onNavigate(){}});
 assert.match(html,/Retomar/);assert.match(html,/pausada/);
});
