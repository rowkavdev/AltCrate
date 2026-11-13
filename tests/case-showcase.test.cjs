const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeCatalog,normalizeDetails,createCaseShowcase,picture,skinPicture}=require('../electron/caseShowcase.cjs');
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
