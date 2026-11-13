const test=require('node:test'),assert=require('node:assert/strict');
test('language preference persists, validates values and survives unavailable storage',async()=>{
 const {createLanguageStore}=await import('../src/language.js');
 const values=new Map();const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const store=createLanguageStore(storage);assert.equal(store.getSnapshot(),'pt');
 let changes=0;const stop=store.subscribe(()=>changes++);
 store.setLanguage('en');assert.equal(store.getSnapshot(),'en');assert.equal(createLanguageStore(storage).getSnapshot(),'en');assert.equal(changes,1);
 store.setLanguage('invalid');assert.equal(store.getSnapshot(),'en');stop();store.setLanguage('pt');assert.equal(changes,1);
 const blocked=createLanguageStore({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}});blocked.setLanguage('en');assert.equal(blocked.getSnapshot(),'en');
});
test('translations preserve interpolation, whitespace and unknown game data',async()=>{
 const {translateText}=await import('../src/language.js');
 assert.equal(translateText('Adicionar conta','en'),'Add account');
 assert.equal(translateText(' contas ','en'),' accounts ');
 assert.equal(translateText('A entrar em Conta A…','en'),'Logging in to Conta A…');
 assert.equal(translateText('Dinheiro virtual: 20 · Caixas: 5','en'),'Virtual money: 20 · Cases: 5');
 assert.equal(translateText('constructor','en'),'constructor');
 assert.equal(translateText('AK-47 | Redline','en'),'AK-47 | Redline');
 assert.equal(translateText('Adicionar conta','pt'),'Adicionar conta');
});
test('settings route is available',async()=>{
 const {parsePageHash}=await import('../src/workspaceNavigation.js');assert.equal(parsePageHash('#settings'),'settings');
});
