const {pageProps}=require('./publicCatalogPage.cjs');
const {createSkinArtworkCatalog,safeSkinImage}=require('./skinArtwork.cjs');
const {createSiteCatalogMetadata}=require('./siteCatalogMetadata.cjs');
const {createSkinMetadataCatalog}=require('./skinMetadata.cjs');
const {canonicalSkinName}=require('./openingPolicy.cjs');
const {parseRetryAfter}=require('./scheduler.cjs');
const ORIGIN = 'https://case-clicker.com';
const CASE_ID = /^[a-f0-9]{24}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORIES = Object.freeze(['cases', 'capsules', 'collections', 'keychainCollections']);

function picture(value, folder) {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,238}\.(?:png|webp|jpe?g)$/i.test(name) || name.includes('..')) return '';
  return `${ORIGIN}/pictures/${folder}/${name}`;
}

function skinPicture(value) {
  const official=safeSkinImage(value);if(official)return official;
  const local = picture(value, 'skins');
  if (local) return local;
  if (typeof value === 'string' && /^https:\/\/cdn\.case-clicker\.com\/(?:stickers|keychains)\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,238}\.(?:png|webp|jpe?g)$/i.test(value) && !value.includes('..')) return value;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,2048}$/.test(value)
    ? `https://steamcommunity-a.akamaihd.net/economy/image/${value}` : '';
}

function unpack(value) { return typeof value === 'string' ? JSON.parse(value) : value; }

function normalizeCatalog(html, category = 'cases') {
  if (!CATEGORIES.includes(category)) throw Error('Categoria inválida');
  const cases = unpack(pageProps(html).cases);
  if (!Array.isArray(cases)) throw Error('Lista de caixas inválida');
  return cases.filter(item => CASE_ID.test(item?._id) && SLUG.test(item?.slug)).map(item => ({
    id: item._id,
    name: String(item.name || '').slice(0, 120),
    slug: item.slug,
    category,
    image: picture(item.iconUrl, 'cases'),
  }));
}

function normalizeDetails(html, expectedId) {
  const props = pageProps(html);
  const box = unpack(props.caseProp);
  const skins = unpack(props.skins);
  if (!CASE_ID.test(expectedId) || box?._id !== expectedId || !Array.isArray(skins)) throw Error('Conteúdo da caixa inválido');
  return {
    id: box._id,
    name: String(box.name || '').slice(0, 120),
    image: picture(box.iconUrl, 'cases'),
    items: skins.slice(0, 120).map(item => ({
      name: String(item?.name || '').slice(0, 130),
      rarity: String(item?.rarity || '').slice(0, 40),
      rarityColor: /^[a-f0-9]{6}$/i.test(item?.rarityColor || '') ? `#${item.rarityColor}` : '',
      image: skinPicture(item?.iconUrl),
      weapon:String(item?.gunType||item?.knifeType||'').slice(0,100),
      ...Object.fromEntries(['minFloat','maxFloat','minPrice','maxPrice'].filter(key=>Number.isFinite(item?.[key])&&item[key]>=0&&(key.endsWith('Price')||item[key]<=1)).map(key=>[key,item[key]])),
      specialCount: Array.isArray(item?.specialItems) ? item.specialItems.length : 0,
      specialItems: Array.isArray(item?.specialItems)?item.specialItems.slice(0,500).map(special=>({
        name:String(typeof special==='string'?special:special?.name||'').slice(0,130),
        image:skinPicture(typeof special==='string'?'':special?.iconUrl),
      })).filter(special=>special.name):[],
    })).filter(item => item.name),
  };
}

function createCaseShowcase({ listAccounts, fetchForAccount, now = Date.now, artworkStore, metadataStore, skinMetadataStore, readTimeoutMs=10000 }) {
  if (typeof listAccounts !== 'function' || typeof fetchForAccount !== 'function') throw TypeError('Leitor de caixas inválido');
  let catalog = null;
  let catalogAt = 0, catalogRetryAt=0, catalogError='', newCaseIds=[];
  let catalogPromise = null;
  const details = new Map();
  const detailPromises = new Map(),detailAt=new Map();
  const metadata=createSiteCatalogMetadata({read,store:metadataStore,now});
  const artwork=createSkinArtworkCatalog({read,cache:artworkStore,now});
  const skinMetadata=createSkinMetadataCatalog({read,resolveLink:name=>artwork.resolveSkinLink(name),store:skinMetadataStore,now});

  async function read(path) {
    let expired=false,timer;const controller=new AbortController();
    const work=(async()=>{
      const account=(await listAccounts())[0];if(!account)throw Error('Liga uma conta para ver as caixas');
      if(expired)throw Error('Prazo do catálogo excedido');
      const response=await fetchForAccount(account)(path,{method:'GET',cache:'no-store',credentials:'include',headers:{Accept:'text/html'},signal:controller.signal,casepilotBeforeSend:()=>{if(expired)throw Object.assign(Error('Leitura do catálogo expirada'),{notSent:true});}});
      if(!response.ok)throw Object.assign(Error(`Catálogo de caixas: HTTP ${response.status}`),{status:response.status,retryAt:response.status===429?now()+parseRetryAfter(response.headers?.get?.('Retry-After'),now()):0});
      return response.text();
    })();
    try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(Error('Prazo de leitura do catálogo excedido'));},readTimeoutMs);})]);}
    finally{clearTimeout(timer);}
  }

  async function list({force=false}={}) {
    if (!force && catalog && now() - catalogAt < 5 * 60_000) return catalog;
    if(now()<catalogRetryAt){if(catalog)return catalog;throw Error(catalogError);}
    if (!catalogPromise) catalogPromise = Promise.all(CATEGORIES.map(async category => normalizeCatalog(await read(`/cases/${category}`), category))).then(groups => groups.flat()).then(value => {
      const prior=catalog&&new Set(catalog.map(box=>box.id));
      const unique=new Map();for(const box of value)if(!unique.has(box.id))unique.set(box.id,box);catalog=[...unique.values()];
      newCaseIds=prior?catalog.filter(box=>!prior.has(box.id)).map(box=>box.id):[];
      catalogAt = now();catalogError='';
      return catalog;
    }).catch(error=>{catalogError=error.message;catalogRetryAt=Math.max(now()+300_000,error.retryAt||0);throw error;}).finally(() => { catalogPromise = null; });
    return catalogPromise;
  }

  async function detail(id) {
    if (!CASE_ID.test(id)) throw Error('Caixa inválida');
    const box = (await list()).find(item => item.id === id);
    if (!box) throw Error('Caixa não encontrada no catálogo');
    if (!details.has(id) || now()-(detailAt.get(id)||0)>=300_000) {
      if(!detailPromises.has(id))detailPromises.set(id,read(`/cases/${box.category}/${box.slug}`).then(html=>normalizeDetails(html,id)).then(value=>{details.set(id,value);detailAt.set(id,now());return value;}).finally(()=>detailPromises.delete(id)));
      await detailPromises.get(id);
    }
    return metadata.enrich(await artwork.enrich(details.get(id)));
  }

  async function discover(options={}){
    const [boxes,state]=await Promise.allSettled([list({force:options?.force===true}),metadata.refresh({force:options?.force===true})]);
    const meta=state.status==='fulfilled'?state.value:metadata.status();
    const failure=boxes.status==='rejected'?boxes.reason.message:catalogError;
    if(!catalog&&failure)throw Error(failure);
    return {catalog:catalog||[],event:meta.event,newCaseIds,observedAt:catalogAt,revision:String(catalogAt)+':'+meta.observedAt,stale:!!failure||meta.stale,error:failure||meta.error,nextRefreshAt:Math.max(catalogRetryAt,meta.nextRefreshAt,catalogAt+300_000)};
  }
  async function skin(caseId,name){
    if(typeof name!=='string'||name.length>130)throw Error('Skin inválida');
    const box=await detail(caseId);const eligible=box.items.flatMap(item=>item.specialItems?.length?item.specialItems:[item]).find(item=>canonicalSkinName(item.name)===canonicalSkinName(name));
    if(!eligible)throw Error('A skin não consta do catálogo desta caixa');
    return skinMetadata.get(eligible.name);
  }
  return { list, detail, discover, skin };
}

module.exports = { picture, skinPicture, pageProps, normalizeCatalog, normalizeDetails, createCaseShowcase };
