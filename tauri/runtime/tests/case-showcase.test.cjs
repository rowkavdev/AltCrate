const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeCatalog,normalizeDetails,createCaseShowcase,picture,skinPicture}=require('../engine/caseShowcase.cjs');
const id='a'.repeat(24);
const page=props=>`<html><script type="application/json" id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:props}})}</script></html>`;

test('catalog projects only safe public case metadata',()=>{
 const result=normalizeCatalog(page({cases:JSON.stringify([{_id:id,name:'Fracture Case',slug:'fracture-case',iconUrl:'fracture.png'},{_id:'bad',slug:'bad',iconUrl:'x.png'}])}));
 assert.deepEqual(result,[{id,name:'Fracture Case',slug:'fracture-case',category:'cases',image:'https://case-clicker.com/pictures/cases/fracture.png'}]);
 assert.equal(picture('../evil.png','cases'),'');
 assert.equal(picture('crate_sticker_pack01.050d07ce442dc326f33bbb10ade6df941136b479.png','cases').startsWith('https://case-clicker.com/pictures/cases/'),true);
 assert.equal(skinPicture('https://cdn.case-clicker.com/stickers/sticker-27.png'),'https://cdn.case-clicker.com/stickers/sticker-27.png');
 assert.equal(skinPicture('-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpot7HxfDhjxszJemkV0924gYKChMj4OrzZgiUGv5wo3uuY8dr02lLn-0FsMGmgIdfEelU3Ml-G_VG9xOm7gZC87suf1zI97aiJAbeK').startsWith('https://steamcommunity-a.akamaihd.net/economy/image/'),true);
});

test('details show server case contents and reject mismatched case',()=>{
 const html=page({caseProp:JSON.stringify({_id:id,name:'Fracture Case',iconUrl:'fracture.png'}),skins:JSON.stringify([{name:'Rare Special Items',iconUrl:'rareItem.webp',rarity:'Covert',rarityColor:'FCC419',specialItems:['Knife A','Knife B']},{name:'Desert Eagle | Printstream',iconUrl:'printstream.png',rarity:'Covert',rarityColor:'eb4b4b'}])});
 const result=normalizeDetails(html,id);
 assert.equal(result.items.length,2);
 assert.equal(result.items[0].specialCount,2);
 assert.equal(result.items[1].image,'https://case-clicker.com/pictures/skins/printstream.png');
 assert.throws(()=>normalizeDetails(html,'b'.repeat(24)),/Conteúdo da caixa inválido/);
});

test('reader loads public pages once and only known case slugs',async()=>{
 const paths=[];
 const catalog=page({cases:JSON.stringify([{_id:id,name:'Fracture Case',slug:'fracture-case',iconUrl:'fracture.png'}])});
 const details=page({caseProp:JSON.stringify({_id:id,name:'Fracture Case',iconUrl:'fracture.png'}),skins:JSON.stringify([{name:'Skin',iconUrl:'skin.png'}])});
 const reader=createCaseShowcase({listAccounts:async()=>[{id:'account'}],fetchForAccount:()=>async path=>{paths.push(path);return {ok:true,text:async()=>['/cases/cases','/cases/capsules','/cases/collections','/cases/keychainCollections'].includes(path)?catalog:details};}});
 await reader.list();await reader.detail(id);await reader.detail(id);
 assert.deepEqual(paths,['/cases/cases','/cases/capsules','/cases/collections','/cases/keychainCollections','/cases/cases/fracture-case']);
 await assert.rejects(()=>reader.detail('b'.repeat(24)),/Caixa não encontrada/);
});

test('rare special item entries expose each named skin for individual rules',()=>{
 const html=page({caseProp:JSON.stringify({_id:id,name:'Revolver Case',iconUrl:'revolver.png'}),skins:JSON.stringify([{name:'Rare Special Items',iconUrl:'rare.webp',rarity:'Covert',specialItems:[{name:'Karambit | Fade',iconUrl:'karambit.png'},{name:'Bayonet | Blue Steel',iconUrl:'bayonet.png'},'Gut Knife | Slaughter']},{name:'AK-47 | Point Disarray',iconUrl:'ak.png'}])});
 const result=normalizeDetails(html,id);
 assert.deepEqual(result.items[0].specialItems.map(item=>item.name),['Karambit | Fade','Bayonet | Blue Steel','Gut Knife | Slaughter']);
 assert.equal(result.items[0].specialItems[0].image,'https://case-clicker.com/pictures/skins/karambit.png');
 assert.equal(result.items[1].specialItems.length,0);
});
test('case reader enriches missing special images through official weapon metadata and shares detail reads',async()=>{
 const paths=[],image='https://steamcommunity-a.akamaihd.net/economy/image/'+'a'.repeat(40);
 const catalog=page({cases:JSON.stringify([{_id:id,name:'Fracture Case',slug:'fracture-case',iconUrl:'fracture.png'}])});
 const detail=page({caseProp:JSON.stringify({_id:id,name:'Fracture Case'}),skins:JSON.stringify([{name:'Rare Special Items',specialItems:['Nomad Knife | Fade']}])});
 const model=value=>page({model:value});
 const reader=createCaseShowcase({listAccounts:async()=>[{id:'account'}],fetchForAccount:()=>async path=>{paths.push(path);return {ok:true,text:async()=>path==='/skins'?model({classes:[{weapons:[{name:'Nomad Knife',slug:'nomad-knife',weaponClass:'Knife'}]}]}):path==='/skins/nomad-knife'?model({weapon:{slug:'nomad-knife',weaponClass:'Knife'},rarities:[{skins:[{name:'Nomad Knife | Fade',imageUrl:image}]}]}):path==='/cases/cases/fracture-case'?detail:catalog};}});
 const [one,two]=await Promise.all([reader.detail(id),reader.detail(id)]);
 assert.equal(one.items[0].specialItems[0].image,image);assert.equal(two.items[0].specialItems[0].weaponClass,'Knife');
 assert.equal(paths.filter(path=>path==='/cases/cases/fracture-case').length,1);assert.equal(paths.filter(path=>path==='/skins/nomad-knife').length,1);
});
test('discovery adds new cases automatically and preserves the last catalog during a failed refresh',async()=>{
 let now=1000,second=false,fail=false;const another='b'.repeat(24);
 const reader=createCaseShowcase({now:()=>now,listAccounts:async()=>[{id:'account'}],fetchForAccount:()=>async path=>{if(fail&&path.startsWith('/cases/'))return {ok:false,status:429,headers:{get:()=> '600'}};return {ok:true,text:async()=>path==='/help/patterns'?page({skingroups:[]}):path==='/'?page({currentEvent:null,isEventRunning:false}):page({cases:JSON.stringify([{_id:id,name:'One',slug:'one',iconUrl:'one.png'},...(second?[{_id:another,name:'New case',slug:'new-case',iconUrl:'new.png'}]:[])])})};}});
 const first=await reader.discover();assert.equal(first.catalog.length,1);assert.deepEqual(first.newCaseIds,[]);now+=301000;second=true;const next=await reader.discover();assert.equal(next.catalog.length,2);assert.deepEqual(next.newCaseIds,[another]);now+=301000;fail=true;const stale=await reader.discover();assert.equal(stale.catalog.length,2);assert.equal(stale.stale,true);assert(stale.nextRefreshAt>=now+600000);
});
test('stalled category refresh has a deadline, keeps cached cases and allows future attempts',async()=>{
 let now=1000,stall=false;const catalog=page({cases:JSON.stringify([{_id:id,name:'One',slug:'one',iconUrl:'one.png'}])});
 const reader=createCaseShowcase({now:()=>now,readTimeoutMs:10,listAccounts:async()=>[{id:'a'}],fetchForAccount:()=>async path=>stall&&path==='/cases/collections'?new Promise(()=>{}):{ok:true,text:async()=>path==='/help/patterns'?page({skingroups:[]}):path==='/'?page({currentEvent:null,isEventRunning:false}):catalog}});
 await reader.discover();now+=301000;stall=true;const result=await reader.discover();assert.equal(result.catalog.length,1);assert.equal(result.stale,true);now+=301000;stall=false;assert.equal((await reader.discover()).stale,false);
});
