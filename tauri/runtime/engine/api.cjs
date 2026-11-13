const { byId } = require('./caseCatalog.cjs');
const { picture } = require('./caseShowcase.cjs');
const {parseRetryAfter}=require('./scheduler.cjs');
const {readRetryAfter}=require('./rateLimitHeaders.cjs');

function finiteNumber(value, name) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`Resposta inválida: ${name}`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Resposta inválida: ${name}`);
  return number;
}

function vaultFields(me) {
  const capacity = me?.vaultCapacity;
  const rate = me?.vaultMoneyPerMinute;
  const collected = me?.vaultLastCollected;
  if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0 ||
      typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 ||
      typeof collected !== 'string' || !Number.isFinite(Date.parse(collected))) {
    return { vaultCapacity: null, vaultMoneyPerMinute: null, vaultLastCollected: null };
  }
  return { vaultCapacity: capacity, vaultMoneyPerMinute: rate, vaultLastCollected: new Date(collected).toISOString() };
}

function converterCapabilities(me) {
  const result={membership:['pro','basic','free'].includes(me?.membership)?me.membership:null};
  for(const key of ['inventorySize','inventoryCount','tradeItems','dailyTradesLeft','concurrentTradeLimit'])
    if(Number.isSafeInteger(me?.[key])&&me[key]>=0)result[key]=me[key];
  return result;
}
function convertedItems(value) {
  const {normalizeInventoryItem}=require('./inventoryView.cjs');
  if(!Array.isArray(value)||value.length>100000)throw Error('Resultado da conversão inválido');
  const seen=new Set();
  return value.map(item=>{const key=item?._id;if(typeof key!=='string'||!/^[a-f0-9]{24}$/i.test(key)||seen.has(key))throw Error('Identificação das skins convertidas por confirmar');seen.add(key);return normalizeInventoryItem(item);});
}
function converterJobs(value) {
  if(!value?.jobs||typeof value.jobs!=='object'||Array.isArray(value.jobs))throw Error('Estado da fila inválido');
  const jobs={};
  for(const key of ['tokens-to-skins','bulk-sell']){
    const raw=value.jobs[key];if(raw==null)continue;
    if(!['queued','running','done','failed'].includes(raw.state))throw Error('Estado da conversão desconhecido');
    const job={state:raw.state};
    for(const field of ['tokens','created','value','convertedToMoney','count','position','total'])if(typeof raw[field]==='number'&&Number.isFinite(raw[field])&&raw[field]>=0)job[field]=raw[field];
    for(const field of ['jobId','id','createdAt','startedAt','finishedAt','currency'])if(typeof raw[field]==='string'&&raw[field].length<=200)job[field]=raw[field];
    if(typeof raw.error==='string')job.error=raw.error.slice(0,180);
    if(raw.progress&&typeof raw.progress==='object')job.progress=Object.fromEntries(['created','sold','total'].filter(k=>Number.isSafeInteger(raw.progress[k])&&raw.progress[k]>=0).map(k=>[k,raw.progress[k]]));
    jobs[key]=job;
  }
  return {jobs};
}
function normalizeSnapshot(me, rawCases) {
  if (!me || !Array.isArray(rawCases)) throw new Error('Resposta inválida da conta ou das caixas');
  const cases = rawCases.map((item) => {
    const id = String(item._id || item.id || '');
    const image = picture(item.iconUrl || item.case?.iconUrl, 'cases');
    return {
      id,
      name: String(item.name || item.case?.name || item.caseName || byId.get(id)?.name || `Caixa ${id.slice(0, 6)}`),
      amount: finiteNumber(item.amount, 'quantidade de caixas'),
      ...(image ? { image } : {}),
    };
  });
  return {
    ...converterCapabilities(me),
    money: finiteNumber(me.money, 'saldo'),
    tokens: finiteNumber(me.tokens, 'tokens'),
    moneyPerClick: finiteNumber(me.moneyPerClick, 'dinheiro por clique'),
    casesPerClick: finiteNumber(me.casesPerClick, 'caixas por clique'),
    caseOpenCount: finiteNumber(me.caseOpenCount, 'caixas por abertura'),
    maxCaseOpenMultiplier: finiteNumber(me.maxCaseOpenMultiplier, 'multiplicador de abertura'),
    inventoryCount: finiteNumber(me.inventoryCount, 'inventário'),
    casesTotal: cases.reduce((sum, item) => sum + item.amount, 0),
    cases,
    ...vaultFields(me),
  };
}

async function parseResponse(response) {
  const body = await response.text();
  let json = null;
  try { json = JSON.parse(body); } catch { /* HTML or empty body */ }
  return { body, json };
}

function createCaseApi(fetcher,{publicFetcher=fetcher}={}) {
  if (typeof fetcher !== 'function') throw new TypeError('fetcher obrigatório');
  const id=value=>{if(typeof value!=='string'||!/^[a-f0-9]{24}$/i.test(value))throw Error('Identificador inválido');return value;};
  async function itemRequest(endpoint,method,body){
    const response=await fetcher(endpoint,{method,credentials:'include',cache:'no-store',...(body===undefined?{}:{headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)})});
    const {json}=await parseResponse(response);return {ok:response.ok,status:response.status,retryAfter:readRetryAfter(response),message:response.ok?'':String(json?.error||json?.message||`HTTP ${response.status}`).slice(0,180),json};
  }
  return {
    async converterProfile() {
      const result=await itemRequest('/api/me','GET');
      if(!result.ok)throw Object.assign(Error(result.message),{status:result.status,retryAfter:result.retryAfter});
      const me=result.json;
      const rankValue=me?.rank!==null&&typeof me?.rank==='object'&&!Array.isArray(me.rank)?me.rank.id:me?.rank;
      const rank=typeof rankValue==='number'||typeof rankValue==='string'&&rankValue.trim()!==''?Number(rankValue):NaN;
      if(!Number.isSafeInteger(rank)||rank<0)throw Error('Resposta inválida: nível');
      return {...converterCapabilities(me),money:finiteNumber(me?.money,'saldo'),tokens:finiteNumber(me?.tokens,'tokens'),
        rank,caseOpenCount:finiteNumber(me?.caseOpenCount,'abertura'),maxCaseOpenMultiplier:finiteNumber(me?.maxCaseOpenMultiplier,'multiplicador')};
    },
    async converterQueueStatus() {
      const result=await itemRequest('/api/queues/status','GET');
      if(!result.ok)throw Object.assign(Error(result.message),{status:result.status,retryAfter:result.retryAfter});
      return converterJobs(result.json);
    },
    async converterOpeningPolicy() {
      const result=await itemRequest('/api/user/autoOpen/config','GET');
      if(!result.ok)throw Object.assign(Error(result.message),{status:result.status,retryAfter:result.retryAfter});
      const raw=result.json?.config??result.json;
      if(typeof raw?.autosellActivated!=='boolean'||typeof raw.autosellAmount!=='number'||!Number.isFinite(raw.autosellAmount)||raw.autosellAmount<0||!['money','tokens'].includes(raw.autosellVariant))throw Error('Configuração de venda automática do site por confirmar');
      return {autosellActivated:raw.autosellActivated,autosellAmount:raw.autosellAmount,autosellVariant:raw.autosellVariant};
    },
    async converterOpeningConfiguration() {
      const result=await itemRequest('/api/user/autoOpen/config','GET');
      if(!result.ok)throw Object.assign(Error(result.message),{status:result.status,retryAfter:result.retryAfter});
      return require('./converterPreparation.cjs').openingConfiguration(result.json);
    },
    async setConverterOpeningConfiguration(value) {
      const config=require('./converterPreparation.cjs').openingConfiguration(value);
      if(config.config.autosellActivated!==false)throw Error('A preparação só pode desativar a venda automática');
      return itemRequest('/api/user/autoOpen/config','PUT',config);
    },
    async convertTokensToSkins(tokens) {
      if(!Number.isSafeInteger(tokens)||tokens<1||tokens>100000000)throw Error('Converte entre 1 e 100 milhões de tokens por pedido');
      const {json,...result}=await itemRequest('/api/casino/tokensToSkins','POST',{tokens,type:'skins'});
      return {...result,queued:result.status===202,skins:result.ok&&Array.isArray(json?.skins)?convertedItems(json.skins):[]};
    },
    async convertedTokenSkins() {
      const result=await itemRequest('/api/casino/tokensToSkins','GET');
      if(!result.ok)throw Object.assign(Error(result.message),{status:result.status,retryAfter:result.retryAfter});
      return convertedItems(result.json?.skins);
    },
    async converterCasePrices() {
      const result=await itemRequest('/api/cases/cases','GET');
      if(!result.ok)throw Object.assign(Error(result.message),{status:result.status,retryAfter:result.retryAfter});
      const items=Array.isArray(result.json)?result.json:result.json?.cases;
      if(!Array.isArray(items))throw Error('Cotação das caixas indisponível');
      const seen=new Set();return items.map(item=>{const caseId=id(item?._id||item?.id),price=finiteNumber(item?.price,'preço da caixa');if(price<0||seen.has(caseId))throw Error('Cotação da caixa inválida');seen.add(caseId);return {id:caseId,price};});
    },
    async converterCases() {
      const result=await itemRequest('/api/cases','GET');
      if(!result.ok)throw Object.assign(Error(result.message),{status:result.status,retryAfter:result.retryAfter});
      if(!Array.isArray(result.json))throw Error('Lista de caixas inválida');
      return result.json.map(item=>{
        const amount=finiteNumber(item.amount,'quantidade');
        if(!Number.isSafeInteger(amount)||amount<0)throw Error('Quantidade de caixas inválida');
        const boxId=id(item._id||item.id);
        return {id:boxId,amount,type:item.type||item.case?.type||(byId.has(boxId)?'case':boxId==='64d9ecad463b7ffa9697e2ea'?'capsule':'unknown')};
      });
    },
    async converterCapsule() {
      const response=await publicFetcher('/cases/capsules/atlanta-2017-legends-holo-foil',{method:'GET',credentials:'include',cache:'no-store'});
      if(!response.ok)throw Object.assign(Error('Cápsula indisponível: HTTP '+response.status),{status:response.status,retryAfter:readRetryAfter(response)});
      const props=require('./caseShowcase.cjs').pageProps(await response.text());
      const box=typeof props.caseProp==='string'?JSON.parse(props.caseProp):props.caseProp;
      if(box?._id!=='64d9ecad463b7ffa9697e2ea'||box.type!=='capsule'||!Number.isFinite(box.price)||box.price<=0||box.isNonBuyable===true||!Number.isFinite(box.rankNeeded))throw Error('Preço ou disponibilidade da cápsula por confirmar');
      return {id:box._id,price:box.price,rankNeeded:box.rankNeeded};
    },
    async sellCase(caseId,amount) {
      if(!Number.isSafeInteger(amount)||amount<1)throw Error('Quantidade inválida');
      const {json,...result}=await itemRequest('/api/cases','DELETE',{id:id(caseId),type:'case',amount});return result;
    },
    async buyConverterCapsules(amount) {
      if(!Number.isSafeInteger(amount)||amount<1)throw Error('Quantidade inválida');
      const {json,...result}=await itemRequest('/api/cases','POST',{id:'64d9ecad463b7ffa9697e2ea',type:'capsule',amount});return result;
    },
    async openConverterCapsules(count,multiplier) {
      if(!Number.isSafeInteger(count)||count<1||count>100||!Number.isSafeInteger(multiplier)||multiplier<1||multiplier>10)throw Error('Quantidade de abertura inválida');
      const {json,...result}=await itemRequest('/api/open/capsule','POST',{id:'64d9ecad463b7ffa9697e2ea',quickOpen:true,count,useEventTickets:false,caseOpenMultiplier:multiplier});
      const items=Array.isArray(json)?json:Array.isArray(json?.openedStickers)?json.openedStickers:[];
      return {...result,skinIds:[...new Set(items.map(item=>item?._id).filter(value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value)))]};
    },
    async farmSnapshot(kind, previous) {
      if (!['case','money'].includes(kind) || !previous || !Array.isArray(previous.cases)) throw new TypeError('Leitura de farm inválida');
      const endpoint = kind === 'money' ? '/api/me' : '/api/cases';
      const response = await fetcher(endpoint, { method:'GET', cache:'no-store', credentials:'include' });
      if (!response.ok) throw Object.assign(new Error(`Leitura de farm: HTTP ${response.status}`), {status:response.status,retryAfter:readRetryAfter(response),endpoint});
      const {json}=await parseResponse(response);
      // Other resources remain explicitly last observed; only the requested
      // resource supplies the fresh before/after evidence for this mutation.
      if (kind === 'money') return {...normalizeSnapshot(json,[]),cases:previous.cases,casesTotal:previous.casesTotal};
      const cases = normalizeSnapshot(previous,json);
      return {...previous,cases:cases.cases,casesTotal:cases.casesTotal};
    },
    async setSkinFavorite(skinId,isFavorite,inStorageUnit){if(typeof isFavorite!=='boolean'||typeof inStorageUnit!=='boolean')throw Error('Favorito inválido');const {json,...result}=await itemRequest('/api/inventory/skin/favorite','POST',{skinId:id(skinId),isFavorite,inStorageUnit});return result;},
    async createStorageUnit(index){if(!Number.isSafeInteger(index)||index<0||index>10000)throw Error('Posição inválida');const {json,...result}=await itemRequest('/api/inventory/storageUnits','POST',{index});return result;},
    async renameStorageUnit(storageUnitId,name,skinIconUrl){if(typeof name!=='string'||!name.trim()||name.trim().length>20)throw Error('O nome deve ter entre 1 e 20 caracteres');const {json,...result}=await itemRequest('/api/inventory/storageUnits','PATCH',{name:name.trim(),...(skinIconUrl!=null?{skinIconUrl}:{}),storageUnitId:id(storageUnitId)});return result;},
    async deleteStorageUnit(storageUnitId,clear=false){if(typeof clear!=='boolean')throw Error('Ação inválida');const {json,...result}=await itemRequest('/api/inventory/storageUnits','DELETE',{clear,storageUnitId:id(storageUnitId)});return result;},
    async withdrawStorageSkin(skinId,storageUnitId){const {json,...result}=await itemRequest('/api/inventory/storageUnits/skins','DELETE',{skinId:id(skinId),storageUnitId:id(storageUnitId)});return result;},
    async depositStorageSkin(skinId,storageUnitId){const {json,...result}=await itemRequest('/api/inventory/storageUnits/skins','POST',{skinIds:[id(skinId)],storageUnitId:id(storageUnitId)});return result;},
    async tradingStatus(){const result=await itemRequest('/api/trading','GET');if(!result.ok){const e=Error(result.message);e.status=result.status;e.retryAfter=result.retryAfter;throw e;}return result.json;},
    async createTrade(){const {json,...result}=await itemRequest('/api/trading','POST');return {...result,tradeId:typeof json?._id==='string'&&/^[a-f0-9]{24}$/i.test(json._id)?json._id:null};},
    async vaultSnapshot() {
      const response = await fetcher('/api/me', { method: 'GET', cache: 'no-store', credentials: 'include' });
      if (!response.ok) {
        const error = new Error(`Leitura do cofre: HTTP ${response.status}`);
        error.status = response.status;
        error.retryAfter = readRetryAfter(response);
        error.endpoint = '/api/me';
        throw error;
      }
      const { json } = await parseResponse(response);
      const date = Date.parse(response.headers.get('Date') || '');
      return {
        money: finiteNumber(json?.money, 'saldo'),
        ...vaultFields(json),
        serverNow: Number.isFinite(date) ? new Date(date).toISOString() : null,
      };
    },
    async collectVault() {
      const response = await fetcher('/api/vault', { method: 'POST', credentials: 'include', cache: 'no-store' });
      const { json } = await parseResponse(response);
      return {
        status: response.status, ok: response.ok,
        retryAfter: readRetryAfter(response),
        message: response.ok ? '' : String(json?.error || json?.message || `HTTP ${response.status}`).slice(0, 180),
      };
    },
    async balance() {
      const response = await fetcher('/api/me', { method: 'GET', cache: 'no-store', credentials: 'include' });
      if (!response.ok) { const error = new Error(`Leitura do saldo: HTTP ${response.status}`); error.status = response.status; error.retryAfter = readRetryAfter(response); throw error; }
      const { json } = await parseResponse(response);
      return { money: finiteNumber(json?.money, 'saldo'), tokens: finiteNumber(json?.tokens, 'tokens') };
    },
    async snapshot() {
      const [meResponse, casesResponse] = await Promise.all([
        fetcher('/api/me', { method: 'GET', cache: 'no-store', credentials: 'include' }),
        fetcher('/api/cases', { method: 'GET', cache: 'no-store', credentials: 'include' }),
      ]);
      if (!meResponse.ok || !casesResponse.ok) {
        const failures=[meResponse,casesResponse].filter(response=>!response.ok);
        const limited=failures.filter(response=>response.status===429);
        const failedResponse=limited.length?limited.reduce((longest,response)=>parseRetryAfter(readRetryAfter(response))>parseRetryAfter(readRetryAfter(longest))?response:longest):failures[0];
        const status = failedResponse.status;
        const error = new Error(failedResponse.headers.get('cf-mitigated')==='challenge'?'O site pede verificação de acesso. Entra na conta para validar a sessão.':`Leitura da conta: HTTP ${status}`);
        error.status = status;
        error.retryAfter = readRetryAfter(failedResponse);
        error.endpoint = failedResponse === meResponse ? '/api/me' : '/api/cases';
        throw error;
      }
      const [{ json: me }, { json: cases }] = await Promise.all([
        parseResponse(meResponse), parseResponse(casesResponse),
      ]);
      return normalizeSnapshot(me, cases);
    },
    async generate(clicks) {
      if (!Number.isSafeInteger(clicks) || clicks < 1 || clicks > 1000) {
        throw new RangeError('Os cliques devem ser um inteiro entre 1 e 1000');
      }
      const response = await fetcher('/api/caseClick', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ clicks }),
      });
      const { json } = await parseResponse(response);
      return {
        status: response.status,
        ok: response.ok,
        retryAfter: readRetryAfter(response),
        awardedCount: response.ok ? Number(json?.amount || 0) : 0,
        casesPerClick: response.ok && typeof json?.casesPerClick === 'number' && Number.isFinite(json.casesPerClick) ? json.casesPerClick : null,
        caseId: response.ok ? String(json?.caseId || '') : '',
        caseName: response.ok ? String(json?.caseName || '') : '',
        message: response.ok ? '' : String(json?.error || json?.message || `HTTP ${response.status}`).slice(0, 180),
      };
    },
    async clickMoney(clicks) {
      if (!Number.isSafeInteger(clicks) || clicks < 1 || clicks > 1000) throw new RangeError('Os cliques devem ser um inteiro entre 1 e 1000');
      const response = await fetcher('/api/click', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ clicks }),
      });
      const { json } = await parseResponse(response);
      return {
        status: response.status, ok: response.ok,
        retryAfter: readRetryAfter(response),
        message: response.ok ? '' : String(json?.error || json?.message || `HTTP ${response.status}`).slice(0, 180),
      };
    },
    async openCase(caseId, count = 1, multiplier = 1, containerType = 'case') {
      if (!['case', 'capsule'].includes(containerType)) throw new Error('Tipo de abertura inválido');
      if (typeof caseId !== 'string' || !/^[a-f0-9]{24}$/i.test(caseId)) throw new Error('Identificador de caixa inválido');
      if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error('Quantidade de abertura inválida');
      if (!Number.isSafeInteger(multiplier) || multiplier < 1 || multiplier > 10) throw new Error('Multiplicador de abertura inválido');
      const response = await fetcher(containerType === 'capsule' ? '/api/open/capsule' : '/api/open/case', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: caseId, quickOpen: true, count, useEventTickets: false, caseOpenMultiplier: multiplier }),
      });
      const { json } = await parseResponse(response);
      const openedItems = containerType === 'capsule' ? json?.openedStickers : json?.openedSkins;
      const received = Array.isArray(json) ? json : Array.isArray(openedItems) ? openedItems : json && typeof json === 'object' && json._id ? [json] : [];
      const skinIds = response.ok ? received.map((skin) => String(skin?._id || '')).filter((item) => /^[a-f0-9]{24}$/i.test(item)) : [];
      return {
        status: response.status, ok: response.ok, retryAfter: readRetryAfter(response),
        skinIds,
        requestedCount: count * multiplier,
        message: response.ok ? skinIds.length ? '' : 'A resposta da abertura não trouxe itens identificáveis' : String(json?.error || json?.message || `HTTP ${response.status}`).slice(0, 180),
      };
    },
    async inventoryPage(page) {
      if (!Number.isSafeInteger(page) || page < 1 || page > 100) throw new Error('Página de inventário inválida');
      const response = await fetcher(`/api/inventory?page=${page}&sort=true&showStickers=false&showUpgradedSkins=false`, {
        method: 'GET', credentials: 'include', cache: 'no-store',
      });
      if (!response.ok) { const error = new Error(`Inventário: HTTP ${response.status}`); error.status = response.status; error.retryAfter = readRetryAfter(response); throw error; }
      const { json } = await parseResponse(response);
      if (!Array.isArray(json?.skins) || !Number.isSafeInteger(json?.pages)) throw new Error('Resposta inválida do inventário');
      return { skins: json.skins, pages: json.pages };
    },
    async convertSkin(skinId) {
      if (typeof skinId !== 'string' || !/^[a-f0-9]{24}$/i.test(skinId)) throw new Error('Identificador de item inválido');
      const response = await fetcher('/api/casino/skinToTokens', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: skinId }),
      });
      const { json } = await parseResponse(response);
      return { status: response.status, ok: response.ok, retryAfter: readRetryAfter(response), message: response.ok ? '' : String(json?.error || json?.message || `HTTP ${response.status}`).slice(0, 180) };
    },
    async sellSkin(skinId) {
      if (typeof skinId !== 'string' || !/^[a-f0-9]{24}$/i.test(skinId)) throw new Error('Identificador de item inválido');
      const response = await fetcher('/api/inventory', {
        method: 'DELETE', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: skinId }),
      });
      const { json } = await parseResponse(response);
      return { status: response.status, ok: response.ok, retryAfter: readRetryAfter(response), message: response.ok ? '' : String(json?.error || json?.message || `HTTP ${response.status}`).slice(0, 180) };
    },
  };
}
module.exports = { normalizeSnapshot, createCaseApi };
