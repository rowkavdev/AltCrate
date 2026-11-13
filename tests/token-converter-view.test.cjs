const test=require('node:test'),assert=require('node:assert/strict');
const {loadComponent,render}=require('./helpers/render.cjs');
const model={bridge:{startTokenConverter(){}},accounts:[{id:'s',label:'Origem A'},{id:'d',label:'Destino B'}],selectedIds:['s','d'],setSelectedIds(){},snapshots:{},converter:{phase:'idle',rows:[],sentTokens:0},setConverter(){},busy:false,loading:false,running:false};
test('converter is an addressable page instead of falling back to overview',async()=>{
  const {parsePageHash,pageHash}=await import('../src/workspaceNavigation.js');assert.equal(parsePageHash('#converter'),'converter');assert.equal(pageHash('converter'),'#converter');
});
test('converter excludes destination from origin checklist and requires destination to enable the full sequence',async()=>{
  const Page=await loadComponent('/src/pages/TokenConverterPage.jsx');
  const missing=render(Page,{model,ui:{destinationAccountId:''},onUiChange(){}});
  assert.match(missing,/<button\b[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Iniciar sequência/);
  const ready=render(Page,{model,ui:{destinationAccountId:'d'},onUiChange(){}});
  assert.match(ready,/<button\b(?![^>]*disabled)[^>]*>(?:(?!<\/button>)[\s\S])*Iniciar sequência/);
  assert.equal((ready.match(/type="checkbox"/g)||[]).length,1);assert.match(ready,/Origem A/);
});
test('pending conversion blocks another start and exposes review without counting tokens as received',async()=>{
  const Page=await loadComponent('/src/pages/TokenConverterPage.jsx');
  const html=render(Page,{model:{...model,converter:{phase:'blocked',sentTokens:0,rows:[{operationId:'pending',accountId:'s',sourceLabel:'Origem A',state:'unconfirmed',stage:'accept',offerTokens:123,canCancel:true,tradeId:'c'.repeat(24),message:'Por confirmar.'}]}},ui:{destinationAccountId:'d'},onUiChange(){}});
  assert.match(html,/Verificar resultado/);assert.match(html,/Cancelar troca/);assert.match(html,/<button\b[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Iniciar sequência/);
});
test('a running farm explains the blocked converter and offers an enabled stop control',async()=>{
  const Page=await loadComponent('/src/pages/TokenConverterPage.jsx');
  const html=render(Page,{model:{...model,running:true,farmStatus:{phase:'running'},actions:{stopFarm(){}}},ui:{destinationAccountId:'d'},onUiChange(){}});
  assert.match(html,/O farm está em execução/);
  assert.match(html,/<button\b(?![^>]*disabled)[^>]*>(?:(?!<\/button>)[\s\S])*Parar farm/);
  assert.match(html,/<button\b[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Iniciar sequência/);
  assert.doesNotMatch(html,/>Pronta<\/span>/);
});
test('converter waits for outstanding farm requests after Stop',async()=>{
  const Page=await loadComponent('/src/pages/TokenConverterPage.jsx');
  const html=render(Page,{model:{...model,running:true,farmStatus:{phase:'stopping'},actions:{stopFarm(){}}},ui:{destinationAccountId:'d'},onUiChange(){}});
  assert.match(html,/A aguardar a paragem do farm/);
  assert.match(html,/<button\b[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Iniciar sequência/);
});
test('opening in progress offers its own stop without presenting the converter as ready',async()=>{
  const Page=await loadComponent('/src/pages/TokenConverterPage.jsx');
  const html=render(Page,{model:{...model,running:true,farmStatus:{phase:'idle'},opening:{phase:'running'},actions:{stopOpening(){}}},ui:{destinationAccountId:'d'},onUiChange(){}});
  assert.match(html,/abertura de caixas está em execução/);assert.match(html,/Parar abertura/);assert.doesNotMatch(html,/>Pronta<\/span>/);
});
