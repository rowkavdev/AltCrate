const test=require('node:test'),assert=require('node:assert/strict');
const page=model=>`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{model}}})}</script>`;
const image='https://steamcommunity-a.akamaihd.net/economy/image/'+'a'.repeat(40);
const weapons=[{name:'Nomad Knife',slug:'nomad-knife',weaponClass:'Knife',imageUrl:image},{name:'Broken Fang Gloves',slug:'broken-fang-gloves',weaponClass:'Gloves',imageUrl:image}];
const index=page({classes:[{name:'Knives',weapons}]});
const weapon=(value,name)=>page({weapon:value,rarities:[{rarity:'Covert',skins:[{name,rarity:'Covert',rarityColor:'eb4b4b',imageUrl:image}]}]});
test('official metadata normalizers read imageUrl and reject foreign image hosts and weapon mismatches',()=>{
 const {normalizeWeaponIndex,normalizeWeaponArtwork,safeSkinImage}=require('../engine/skinArtwork.cjs');
 assert.equal(normalizeWeaponIndex(index).length,2);
 assert.equal(normalizeWeaponArtwork(weapon(weapons[0],'Nomad Knife | Fade'),'nomad-knife').items[0].image,image);
 assert.equal(safeSkinImage('https://evil.invalid/'+image),'');
 assert.equal(normalizeWeaponIndex(page({classes:[{weapons:[{name:'Invalid'}, {name:'Invalid 2',slug:'../evil'}]}]})).length,0);
 assert.throws(()=>normalizeWeaponArtwork(weapon(weapons[0],'Nomad Knife'),'karambit'));
});
test('different weapon lookups share a global pool of two reads',async()=>{
 const {createSkinArtworkCatalog}=require('../engine/skinArtwork.cjs');const list=Array.from({length:8},(_,i)=>({name:'Knife '+i,slug:'knife-'+i,weaponClass:'Knife'}));let active=0,max=0;
 const art=createSkinArtworkCatalog({read:async path=>{if(path==='/skins')return page({classes:[{weapons:list}]});const w=list.find(w=>path.endsWith(w.slug));max=Math.max(max,++active);await new Promise(resolve=>setTimeout(resolve,2));active--;return weapon(w,w.name+' | Fade');}});
 await Promise.all(list.map(w=>art.enrich({items:[{name:w.name+' | Fade',image:''}]})));
 assert.equal(max,2);
});
test('artwork fills exact knife and glove names, shares in-flight reads and persists public metadata across restart',async()=>{
 const {createSkinArtworkCatalog}=require('../engine/skinArtwork.cjs');let saved=null;const calls=[];
 const read=async path=>{calls.push(path);return path==='/skins'?index:weapon(weapons.find(w=>path.endsWith(w.slug)),path.endsWith('nomad-knife')?'Nomad Knife | Fade':'Broken Fang Gloves | Jade');};
 const cache={load:async()=>saved,save:async value=>{saved=JSON.parse(JSON.stringify(value));}};
 const art=createSkinArtworkCatalog({read,cache});const detail={items:[{name:'Rare',specialItems:[{name:'Nomad Knife | Fade',image:''},{name:'Broken Fang Gloves | Jade',image:''}]},{name:'Existing',image:'existing'}]};
 const [one,two]=await Promise.all([art.enrich(detail),art.enrich(detail)]);
 assert.equal(one.items[0].specialItems[0].image,image);assert.equal(two.items[0].specialItems[1].weaponClass,'Gloves');assert.equal(one.items[1].image,'existing');assert.equal(detail.items[0].specialItems[0].image,'');assert.equal(calls.length,3);
 const reopened=createSkinArtworkCatalog({read:async()=>{throw Error('must use local metadata');},cache});assert.equal((await reopened.enrich(detail)).items[0].specialItems[0].image,image);
});
test('cached multi-weapon artwork never force-refreshes from an array index',async()=>{
 const {createSkinArtworkCatalog}=require('../engine/skinArtwork.cjs');let saved,reads=0;
 const read=async url=>{reads++;return url==='/skins'?index:weapon(weapons.find(w=>url.endsWith(w.slug)),url.endsWith('nomad-knife')?'Nomad Knife | Fade':'Broken Fang Gloves | Jade');};const cache={load:async()=>saved,save:async value=>{saved=structuredClone(value)}};
 const detail={items:[{name:'Nomad Knife | Fade'},{name:'Broken Fang Gloves | Jade'}]};const art=createSkinArtworkCatalog({read,cache});await art.enrich(detail);const before=reads;await createSkinArtworkCatalog({read,cache}).enrich(detail);assert.equal(reads,before);
});
test('missing or failed artwork does not prevent configuring or opening the case and retries are bounded',async()=>{
 const {createSkinArtworkCatalog}=require('../engine/skinArtwork.cjs');let calls=0;const art=createSkinArtworkCatalog({read:async()=>{calls++;throw Error('HTTP 429');}});const detail={id:'case',items:[{name:'Nomad Knife | Fade',image:''}]};
 assert.equal((await art.enrich(detail)).items[0].image,'');await art.enrich(detail);assert.equal(calls,1);
});
test('stalled optional artwork and cache IO return original contents within a bounded deadline',async()=>{
 const {createSkinArtworkCatalog}=require('../engine/skinArtwork.cjs');const detail={items:[{name:'Nomad Knife | Fade',image:''}]};
 const art=createSkinArtworkCatalog({read:()=>new Promise(()=>{}),cache:{load:()=>new Promise(()=>{}),save:()=>new Promise(()=>{})},timeoutMs:15,ioTimeoutMs:5,readTimeoutMs:20});
 assert.equal(await art.enrich(detail),detail);
});
test('stalled cache saves do not block successfully read artwork',async()=>{
 const {createSkinArtworkCatalog}=require('../engine/skinArtwork.cjs');
 const art=createSkinArtworkCatalog({read:async path=>path==='/skins'?index:weapon(weapons[0],'Nomad Knife | Fade'),cache:{load:async()=>null,save:()=>new Promise(()=>{})},timeoutMs:100,ioTimeoutMs:5});
 assert.equal((await art.enrich({items:[{name:'Nomad Knife | Fade',image:''}]})).items[0].image,image);
});
test('expired queued artwork reads are skipped during the failure cooldown',async()=>{
 const {createSkinArtworkCatalog}=require('../engine/skinArtwork.cjs');const list=Array.from({length:5},(_,i)=>({name:'Knife '+i,slug:'knife-'+i,weaponClass:'Knife'}));const releases=[];let reads=0;
 const art=createSkinArtworkCatalog({timeoutMs:100,readTimeoutMs:10,read:async path=>{if(path==='/skins')return page({classes:[{weapons:list}]});reads++;return new Promise(resolve=>releases.push(()=>{const w=list.find(w=>path.endsWith(w.slug));resolve(weapon(w,w.name+' | Fade'));}));}});
 await Promise.all(list.map(w=>art.enrich({items:[{name:w.name+' | Fade',image:''}]})));assert.equal(reads,2);releases.splice(0).forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);
});
