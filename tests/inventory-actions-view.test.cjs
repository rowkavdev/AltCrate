const test=require('node:test'),assert=require('node:assert/strict'),{loadComponent,render}=require('./helpers/render.cjs');
const item={id:'a'.repeat(24),name:'AK-47 | Blue Mag',image:'https://case-clicker.com/pictures/skins/ak_ch_bg.png',price:5000,rarity:'Covert',stickers:[{name:'Christmas Cat',image:'https://case-clicker.com/pictures/events/christmas25/cat.png'}],charm:{name:'Charm',image:'https://case-clicker.com/pictures/skins/charm.png'}};
test('inventory cards expose separate details and actions buttons with actual accessory photos',async()=>{
 const Card=await loadComponent('/src/pages/InventoryItems.jsx','InventoryCard'),html=render(Card,{item,onOpen(){},onActions(){}});assert.match(html,/Ações/);assert.match(html,/Christmas Cat/);assert.match(html,/pictures\/events\/christmas25\/cat.png/);assert.match(html,/Charm/);assert.doesNotMatch(html,/<button[^>]*>[\s\S]*<button[^>]*>[\s\S]*<\/button>[\s\S]*<\/button>/);
});
test('review shows the exact item source destination and storage steps before confirmation',async()=>{
 const Actions=await loadComponent('/src/pages/InventoryActions.jsx'),html=render(Actions,{accounts:[{id:'a',label:'Origem'},{id:'b',label:'Destino'}],controller:{preview:{previewId:'p',kind:'transfer',item,sourceLabel:'Origem',destinationLabel:'Destino',steps:['Retirar do storage','Enviar para Destino']},operation:null,busy:false,error:'',closeReview(){},confirm(){}}});assert.match(html,/Confirmar envio/);assert.match(html,/Destino/);assert.match(html,/Retirar do storage/);assert.match(html,/Blue Mag/);
});
test('storage review names the chosen account and storage',async()=>{
 const Actions=await loadComponent('/src/pages/InventoryActions.jsx'),html=render(Actions,{accounts:[],controller:{preview:{previewId:'p',kind:'move-to-storage',item,sourceLabel:'Origem',destinationLabel:'Destino',destinationStorageName:'Blue',steps:['Enviar para Destino','Guardar no storage Blue']},busy:false,error:'',closeReview(){},confirm(){}}});
 assert.match(html,/Mover para storage/);assert.match(html,/Destino/);assert.match(html,/Blue/);assert.match(html,/Confirmar movimento/);
});
test('failed deposit offers a new reviewed move from destination inventory',async()=>{
 const Actions=await loadComponent('/src/pages/InventoryActions.jsx'),html=render(Actions,{accounts:[],controller:{operation:{kind:'move-to-storage',state:'failed',item,accountId:'a',destinationAccountId:'b',locationAccountId:'b',location:'inventory',destinationStorageName:'Blue',message:'Depósito recusado'},busy:false,error:'',closeReview(){},reviewFailedDeposit(){}}});
 assert.match(html,/inventário.*destino/i);assert.match(html,/Rever armazenamento/);
});
test('failed source withdrawal names source storage rather than chosen destination',async()=>{
 const Actions=await loadComponent('/src/pages/InventoryActions.jsx');
 const html=render(Actions,{accounts:[],controller:{operation:{kind:'move-to-storage',state:'failed',item,accountId:'a',destinationAccountId:'a',destinationStorageUnitId:'b'.repeat(24),destinationStorageName:'Blue',locationAccountId:'a',locationStorageUnitId:'c'.repeat(24),location:'storage',message:'Retirada recusada'},busy:false,error:'',closeReview(){}}});
 assert.match(html,/Localização confirmada: storage de origem/);assert.doesNotMatch(html,/Localização confirmada: storage Blue/);
});
test('pending cross-account storage trade offers cancellation until arrival',async()=>{
 const Actions=await loadComponent('/src/pages/InventoryActions.jsx');
 const html=render(Actions,{accounts:[],controller:{operation:{kind:'move-to-storage',state:'unconfirmed',item,accountId:'a',destinationAccountId:'b',stage:'result',canCancel:true,message:'Oferta alterada'},busy:false,error:'',closeReview(){},cancel(){},verify(){}}});
 assert.match(html,/Cancelar envio/);
});
test('item menu offers moving to storage',async()=>{
 const Actions=await loadComponent('/src/pages/InventoryActions.jsx'),html=render(Actions,{accounts:[{id:'a',label:'A'}],controller:{menu:{item,ref:{accountId:'a',itemId:item.id,storageUnitId:null},anchor:{x:1,y:1}},available:true,storageAvailable:true,closeMenu(){},choose(){}}});
 assert.match(html,/data-action="move-to-storage"/);assert.match(html,/Mover para storage/);
});
test('picker distinguishes equal account names and shows empty accounts',async()=>{
 const Actions=await loadComponent('/src/pages/InventoryActions.jsx');
 const accounts=[{id:'alpha1111',label:'Igual'},{id:'beta2222',label:'Igual'},{id:'empty333',label:'Vazia'}];
 const html=render(Actions,{accounts,controller:{storagePicker:{selected:{item,ref:{accountId:'alpha1111',storageUnitId:null}},entries:[{accountId:'alpha1111',accountLabel:'Igual',storageId:'s1',storageName:'Blue',count:1},{accountId:'beta2222',accountLabel:'Igual',storageId:'s2',storageName:'Blue',count:2}],completedAccountIds:accounts.map(a=>a.id),errors:[],loaded:3,total:3,loading:false},busy:false,error:'',closeReview(){},reviewStorage(){}}});
 assert.match(html,/Igual.*alpha111/);assert.match(html,/Igual.*beta2222/);assert.match(html,/Vazia.*não tem storages/i);
});
