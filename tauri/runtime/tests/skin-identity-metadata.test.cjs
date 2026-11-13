const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const page=model=>`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{model}}})}</script>`;
const pattern='64f3285e94409aec7b3620c7',name='AK-47 | Case Hardened';
test('sanitized observed inventory examples retain their exact variant and match the ordered rule',()=>{
 const {decideOpeningItem}=require('../engine/openingPolicy.cjs'),{normalizeInventoryItem}=require('../engine/inventoryView.cjs');
 for(const sample of require('./fixtures/observed-skin-variants.json').samples){const normalized=normalizeInventoryItem(sample);assert.equal(normalized.baseName,'R8 Revolver | Fade');assert.equal(normalized.patternName,'100% Fade');assert.equal(normalized.float,sample.float);assert.equal(decideOpeningItem(sample,[{name:normalized.baseName,action:'keep',conditions:{patterns:[sample.patternId]}}]).ruleIndex,0);}
});
test('actual special-pattern markers prevent the cheap-item converter from consuming the item',()=>{
 const {eligibleForConversion}=require('../engine/skins.cjs');const ordinary={_id:'a'.repeat(24),name:'R8 Revolver | Bone Mask',price:.1,quality:0,rarity:'Mil-Spec Grade',isFavorite:false,isTerminal:false,isSticker:false,isKeychain:false};assert.equal(eligibleForConversion(ordinary,1),true);
 for(const attrs of [{hasPattern:true},{patternId:pattern},{patternName:'Tier 4'},{name:"R8 Revolver | Bone Mask 'Gold Gem' (Minimal Wear)"},{stickers:[{name:'Sticker'}]},{appliedKeychain:{name:'Charm'}}])assert.equal(eligibleForConversion({...ordinary,...attrs},1),false,JSON.stringify(attrs));
});
test('a real quoted Tier variant matches its base skin and its exact official pattern ID',async()=>{
 const policy=require('../engine/openingPolicy.cjs');const item={name:"StatTrak™ AK-47 | Case Hardened 'Tier 4' (Minimal Wear)",patternId:pattern,statTrak:true,float:.101};
 assert.equal(policy.canonicalSkinName(item.name),name.toLowerCase());
 assert.equal(policy.decideOpeningItem(item,[{name,action:'storage',conditions:{patterns:[pattern],floatMax:.15}}]).action,'storage');
 assert.equal(policy.decideOpeningItem({...item,patternId:'b'.repeat(24)},[{name,action:'sell',conditions:{patterns:[pattern]}}]).action,'keep');
 assert.equal(policy.canonicalSkinName("M4A1-S | Chantico's Fire (Factory New)"),"m4a1-s | chantico's fire");
 const vm=await import(path.resolve(__dirname,'../../casepilot/apps/web/src/openingRulesViewModel.js'));assert.equal(vm.canonicalSkinName(item.name),policy.canonicalSkinName(item.name));
 // Legacy decorated rules cannot silently become broad rules for every variant.
 assert.throws(()=>policy.normalizeOpeningRule({name:item.name,action:'sell'}),/variante/i);
});
test('an untouched legacy quoted rule cannot become a broad base rule in the grouped editor',async()=>{
 const vm=await import(path.resolve(__dirname,'../../casepilot/apps/web/src/openingRulesViewModel.js'));const selection=await import(path.resolve(__dirname,'../../casepilot/apps/web/src/openingSkinSelection.js'));const options=[{name,variants:[{id:pattern,name:'Tier 4'}]}];const legacy={id:'legacy',name:"AK-47 | Case Hardened 'Tier 4'",action:'sell'};
 assert.deepEqual(selection.normalizeSelectedSkinNames([legacy.name],options),[]);
 assert.equal(selection.prepareSkinRuleBatch([legacy],0,vm.ruleDraft(legacy),[legacy.name],options,[0]).valid,false);
 const repaired=selection.prepareSkinRuleBatch([legacy],0,vm.ruleDraft(legacy),[name+'::'+pattern],options,[0]);assert.equal(repaired.valid,true);assert.deepEqual(repaired.candidates[0].conditions,{patterns:[pattern]});
});
test('normalizing a real special item preserves its variant, exact float, prices and accessory metadata',()=>{
 const {normalizeInventoryItem}=require('../engine/inventoryView.cjs');
 const result=normalizeInventoryItem({_id:'a'.repeat(24),name:"AK-47 | Case Hardened 'Tier 4' (Minimal Wear)",patternId:pattern,hasPattern:true,float:.101902305700966,exterior:'Minimal Wear',price:5375.19,weaponPrice:5375.19,statTrak:false,souvenir:false,nickname:'Example',gunType:'AK-47',floatRanks:{lowestFloatBySkingroupRank:10},openedAt:'2026-10-16T08:00:00Z',stickers:[{name:'Sticker',iconUrl:'sticker.png',slot:2,wear:.15}],appliedKeychain:{name:'Charm',iconUrl:'charm.png',patternId:'123'}});
 assert.equal(result.baseName,name);assert.equal(result.patternName,'Tier 4');assert.equal(result.hasPattern,true);assert.equal(result.float,.101902305700966);assert.equal(result.weaponPrice,5375.19);assert.equal(result.nickname,'Example');assert.equal(result.floatRanks.lowestFloatBySkingroupRank,10);assert.equal(result.stickers[0].wear,.15);assert.equal(result.stickers[0].slot,2);assert.equal(result.charm.patternId,'123');
});
test('official pattern metadata retains odds, signed overpay and source color',()=>{
 const {normalizePatternCatalog}=require('../engine/siteCatalogMetadata.cjs');const html=`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{skingroups:[{name,patterns:[{_id:pattern,name:'Tier 4',iconUrl:'ak_ch_tier4.png',color:'#B8860B',overpay:5000,probability:100},{_id:'b'.repeat(24),name:'Phase 3',iconUrl:'phase3.png',overpay:-5,probability:4}]}]}}})}</script>`;
 const data=normalizePatternCatalog(html)[0];assert.equal(data.variants[0].overpay,5000);assert.equal(data.variants[0].probability,100);assert.equal(data.variants[0].color,'#B8860B');assert.equal(data.variants[1].overpay,-5);
});
test('case contents retain published float and price ranges',()=>{
 const {normalizeDetails}=require('../engine/caseShowcase.cjs');const id='a'.repeat(24);const html=`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{caseProp:{_id:id},skins:[{name,minFloat:0,maxFloat:1,minPrice:230.41,maxPrice:1116.61,gunType:'AK-47'}]}}})}</script>`;
 const data=normalizeDetails(html,id).items[0];assert.equal(data.minFloat,0);assert.equal(data.maxFloat,1);assert.equal(data.minPrice,230.41);assert.equal(data.maxPrice,1116.61);assert.equal(data.weapon,'AK-47');
});
test('official skin profile preserves wear prices, availability, provenance and pattern information',()=>{
 const {normalizeSkinMetadata}=require('../engine/skinMetadata.cjs');const model=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../tests/fixtures/skin-case-hardened.json'),'utf8'));
 const data=normalizeSkinMetadata(page(model),name);assert.equal(data.hasStatTrak,true);assert.equal(data.hasSouvenir,false);assert.equal(data.exteriors.find(e=>e.key==='MW').price,375.19);assert.equal(data.variants.find(v=>v.name==='Tier 4').overpay,5000);assert.equal(data.containers[0].href,'/cases/cases/cs-go-weapon-case');assert.equal(data.minFloat,0);assert.equal(data.maxFloat,1);assert.equal(data.collection,'CS:GO Weapon Case');assert.throws(()=>normalizeSkinMetadata(page(model),'AWP | Asiimov'),/skin/i);
});
test('skin profiles deduplicate reads, survive reopen and retain cached data on failure',async()=>{
 const {createSkinMetadataCatalog}=require('../engine/skinMetadata.cjs');const model=JSON.parse(fs.readFileSync(path.resolve(__dirname,'fixtures/skin-case-hardened.json'),'utf8'));let calls=0,saved,now=1000,fail=false;
 const options={now:()=>now,resolveLink:async()=>'/skin/ak-47-case-hardened',read:async()=>{calls++;if(fail)throw Error('HTTP429');return page(model);},store:{load:async()=>saved,save:async x=>{saved=structuredClone(x)}}};const source=createSkinMetadataCatalog(options);await Promise.all([source.get(name),source.get(name)]);assert.equal(calls,1);const reopened=createSkinMetadataCatalog(options);assert.equal((await reopened.get(name)).name,name);assert.equal(calls,1);now+=8*86400000;fail=true;assert.equal((await reopened.get(name)).stale,true);assert.equal((await reopened.get(name)).name,name);assert.equal(calls,2);
});
test('a stalled skin profile expires and respects its retry cooldown',async()=>{
 const {createSkinMetadataCatalog}=require('../engine/skinMetadata.cjs');let calls=0;
 const source=createSkinMetadataCatalog({timeoutMs:10,resolveLink:async()=>'/skin/ak-47-case-hardened',read:async()=>{calls++;return new Promise(()=>{});}});
 await assert.rejects(source.get(name),/Prazo/);await assert.rejects(source.get(name),/Aguarda/);assert.equal(calls,1);
});
test('profile lookup accepts only a skin contained in the requested case and resolves the official link',async()=>{
 const {createCaseShowcase}=require('../engine/caseShowcase.cjs');const model=require('./fixtures/skin-case-hardened.json'),id='a'.repeat(24),reads=[];
 const html=props=>`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:props}})}</script>`;
 const reader=createCaseShowcase({listAccounts:async()=>[{id:'a'}],fetchForAccount:()=>async url=>{reads.push(url);return {ok:true,text:async()=>url==='/skins'?page({classes:[{weapons:[{name:'AK-47',slug:'ak-47',weaponClass:'Rifle'}]}]}):url==='/skins/ak-47'?page({weapon:{slug:'ak-47',weaponClass:'Rifle'},rarities:[{skins:[{name,imageUrl:model.skin.imageUrl}]}]})+`<a aria-label="${name}" href="/skin/ak-47-case-hardened">Skin</a>`:url==='/skin/ak-47-case-hardened'?page(model):url==='/cases/cases/test-case'?html({caseProp:{_id:id,name:'Test'},skins:[{name,iconUrl:model.skin.imageUrl}]}):html({cases:[{_id:id,name:'Test',slug:'test-case'}]})};}});
 const result=await reader.skin(id,name);assert.equal(result.sourceUrl,'https://case-clicker.com/skin/ak-47-case-hardened');const count=reads.length;await assert.rejects(reader.skin(id,'AWP | Asiimov'),/não consta/);assert.equal(reads.length,count);await reader.skin(id,name);assert.equal(reads.length,count);
});
