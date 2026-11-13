export function activityOperation(event){return event.type==='progression'?'progression':event.type==='inventory-action'?event.kind==='convert'?'conversion':event.kind:event.type==='request'?event.kind:event.type==='game'?'game':event.type;}
export function activityHttpStatus(event){return event.httpStatus??(event.type==='game'?event.result?.status:undefined);}
export function activityAccepted(event){if(event.type==='progression')return event.verified===true||event.state==='unconfirmed';if(event.type==='inventory-action')return event.verified===true||event.httpStatus>=200&&event.httpStatus<300;const status=activityHttpStatus(event);return status!=null?status>=200&&status<300:event.type==='game'&&event.result?.sent===true;}
export function activityConfirmed(event){
  if(event.type==='inventory-action')return event.verified===true&&['confirmed','cancelled'].includes(event.state);
  if(event.type==='progression')return event.verified===true;
  if(!activityAccepted(event))return false;
  if(event.type==='request')return Number.isFinite(event.verifiedDelta);
  if(event.type==='vault')return Number.isFinite(event.confirmedDelta);
  if(event.type==='open')return event.verified===true;
  if(event.type==='conversion')return event.verified===true;
  return event.type==='game'&&event.result?.verified===true;
}
export function activityFailed(event){return event.type==='progression'?event.state==='failed':event.type==='inventory-action'?event.state==='failed':activityHttpStatus(event)>=400||['account-error','needs-login'].includes(event.type);}
const names={case:'Caixas',money:'Dinheiro',vault:'Cofre',open:'Abertura',conversion:'Conversão',game:'Jogos',sell:'Venda',favorite:'Favorito',withdraw:'Retirada',transfer:'Envio','move-to-storage':'Mover para storage'};
export function filterActivityEvents(events,filters={},labels={}){
  const {query='',accountId='all',operation='all',result='all'}=filters;
  const needle=String(query).trim().toLocaleLowerCase('pt-PT');
  return events.filter(event=>{
    if(accountId!=='all'&&event.accountId!==accountId&&event.destinationAccountId!==accountId)return false;
    if(operation!=='all'&&activityOperation(event)!==operation)return false;
    if(result==='accepted'&&!activityAccepted(event))return false;
    if(result==='confirmed'&&!activityConfirmed(event))return false;
    if(result==='failed'&&!activityFailed(event))return false;
    if(result==='unconfirmed'&&(event.type==='inventory-action'?event.state!=='unconfirmed':!activityAccepted(event)||activityConfirmed(event)))return false;
    if(!needle)return true;
    const text=[labels[event.accountId]||'Conta removida',labels[event.destinationAccountId],event.destinationStorageName,event.item?.name,event.type,event.kind,event.game,event.message,event.skinName,event.caseName,names[activityOperation(event)]].filter(Boolean).join(' ').toLocaleLowerCase('pt-PT');
    return !needle||text.includes(needle);
  });
}
