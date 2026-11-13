const CAPSULE_ID='64d9ecad463b7ffa9697e2ea';
// Reconcile an already sent opening from read-only server evidence. Never sends mutations.
function reconcileOpening(row,{identity,quantity,skins}) {
  const p=row.pending,end=Date.parse(row.updatedAt);
  if(row.state!=='unconfirmed'||p?.kind!=='open'||p.id!==CAPSULE_ID||identity!==row.sourceIdentity||
    !Number.isFinite(end)||!Number.isSafeInteger(p.before)||!Number.isSafeInteger(p.amount)||p.amount<1||p.amount>1000||p.amount>p.before||
    quantity!==p.before-p.amount||!Array.isArray(skins)||row.remainingSkinIds?.length)throw Error('Abertura sem evidência suficiente para recuperar.');
  const candidates=skins.filter(s=>{
    const age=end-Date.parse(s.openedAt);
    return s.userId===identity&&s.isSticker===true&&s.isFavorite===false&&s.origin?.name==='Atlanta 2017 Legends (Holo-Foil)'&&s.origin.type==='case'&&age>=0&&age<=15000;
  });
  const ids=candidates.map(s=>s._id);
  if(ids.length!==p.amount||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{24}$/i.test(id)))throw Error('Os stickers da abertura não foram identificados de forma única.');
  return {...structuredClone(row),pending:null,state:'stopped',verified:false,opened:(row.opened||0)+p.amount,remainingSkinIds:ids,
    message:p.amount+' stickers recuperados. Usa Abrir e converter para continuar sem repetir esta abertura.'};
}
function recordMissingStickers(row,{identity,quantity,skins,inventoryComplete,humanConfirmedUnchanged,config}) {
  const p=row.pending;
  if(row.state!=='unconfirmed'||p?.kind!=='open'||p.id!==CAPSULE_ID||identity!==row.sourceIdentity||
    !Number.isSafeInteger(p.before)||!Number.isSafeInteger(p.amount)||p.amount<1||p.amount>1000||p.amount>p.before||quantity!==p.before-p.amount||
    inventoryComplete!==true||humanConfirmedUnchanged!==true||!Array.isArray(skins)||skins.some(s=>s.userId!==identity||s.isSticker!==false)||
    config?.autosellActivated!==true||config.autosellVariant!=='money')throw Error('Falta evidência para encerrar esta abertura como falhada.');
  return {...structuredClone(row),pending:null,state:'failed',verified:false,opened:(row.opened||0)+p.amount,missingStickers:p.amount,
    missingOpening:{pending:structuredClone(p),observedQuantity:quantity,inventoryCount:skins.length,moneyAutosellConfigured:true},
    message:p.amount+' cápsulas abertas, mas os stickers não estão no inventário. A conta tem venda automática em dinheiro ativa; o destino destes itens não foi confirmado.'};
}
module.exports={reconcileOpening,recordMissingStickers};
