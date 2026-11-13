const test=require('node:test'),assert=require('node:assert/strict');
const html=props=>`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:props}})}</script>`;
const event={_id:'a'.repeat(24),name:'Orbit',startingAt:'2026-08-28T18:00:00Z',endingAt:'2026-09-14T00:00:00Z'};
test('event status follows official flag and dates, including ended events retained by the site',()=>{
 const {normalizeSiteEvent}=require('../engine/siteCatalogMetadata.cjs');
 assert.equal(normalizeSiteEvent(html({currentEvent:JSON.stringify(event),isEventRunning:true}),Date.parse('2026-09-01')).status,'active');
 assert.equal(normalizeSiteEvent(html({currentEvent:JSON.stringify(event),isEventRunning:false}),Date.parse('2026-10-16')).status,'ended');
 assert.notEqual(normalizeSiteEvent(html({currentEvent:JSON.stringify(event),isEventRunning:false}),Date.parse('2026-09-01')).status,'active');
});
test('official pattern IDs and images enrich only matching case skins',async()=>{
 const {createSiteCatalogMetadata,normalizePatternCatalog}=require('../engine/siteCatalogMetadata.cjs');
 const data={skingroups:[{name:'Flip Knife | Doppler',patterns:[{_id:'b'.repeat(24),name:'Sapphire',iconUrl:'flip_doppler_sapphire.webp'},{_id:'c'.repeat(24),name:'Bad',iconUrl:'https://evil.invalid/x'}]}]};
 assert.equal(normalizePatternCatalog(html(data))[0].variants.length,1);
 const metadata=createSiteCatalogMetadata({read:async path=>path==='/help/patterns'?html(data):html({currentEvent:JSON.stringify(event),isEventRunning:false})});await metadata.refresh();
 const detail=metadata.enrich({items:[{name:'Rare',specialItems:[{name:'Flip Knife | Doppler'}]},{name:'AK-47 | Slate'}]});assert.equal(detail.items.length,2);assert.equal(detail.items[0].specialItems[0].variants[0].id,'b'.repeat(24));assert.equal(detail.items[1].variants,undefined);
});
test('discovery metadata is cached, deduplicated and keeps last valid data on failures',async()=>{
 const {createSiteCatalogMetadata}=require('../engine/siteCatalogMetadata.cjs');let now=1000,reads=0,fail=false,saved;
 const metadata=createSiteCatalogMetadata({now:()=>now,store:{load:async()=>saved,save:async value=>{saved=structuredClone(value);}},read:async path=>{reads++;if(fail)throw Error('HTTP429');return path==='/help/patterns'?html({skingroups:[]}):html({currentEvent:JSON.stringify(event),isEventRunning:false});}});
 await Promise.all([metadata.refresh(),metadata.refresh()]);assert.equal(reads,2);await metadata.refresh();assert.equal(reads,2);now+=301000;fail=true;const state=await metadata.refresh();assert.equal(state.event.name,'Orbit');assert.equal(state.stale,true);const prior=reads;await metadata.refresh();assert.equal(reads,prior);
 const reopened=createSiteCatalogMetadata({now:()=>1001,store:{load:async()=>saved},read:()=>{throw Error('cache must be used');}});assert.equal((await reopened.refresh()).event.name,'Orbit');
});
test('manual refresh updates events inside the cache interval and still respects failure cooldown',async()=>{
 const {createSiteCatalogMetadata}=require('../engine/siteCatalogMetadata.cjs');let label='One',calls=0,fail=false;
 const metadata=createSiteCatalogMetadata({read:async path=>{calls++;if(fail)throw Error('HTTP429');return path==='/help/patterns'?html({skingroups:[]}):html({currentEvent:JSON.stringify({...event,name:label}),isEventRunning:false});}});
 await metadata.refresh();label='Two';assert.equal((await metadata.refresh({force:true})).event.name,'Two');fail=true;await metadata.refresh({force:true});const prior=calls;await metadata.refresh({force:true});assert.equal(calls,prior);
});
