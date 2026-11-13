export function accountSummaryCache(value){
 const result={};
 if(!value||Array.isArray(value)||typeof value!=='object')return result;
 for(const [id,snapshot] of Object.entries(value).slice(0,100)){
  if(!snapshot||snapshot.error||typeof snapshot!=='object'||id.length>200)continue;
  const summary={};
  if(Object.hasOwn(snapshot,'membership'))summary.membership=['pro','basic','free'].includes(snapshot.membership)?snapshot.membership:null;
  for(const key of ['inventoryCount','inventorySize','tradeItems','dailyTradesLeft','concurrentTradeLimit'])if(Number.isSafeInteger(snapshot[key])&&snapshot[key]>=0)summary[key]=snapshot[key];
  for(const key of ['money','tokens','casesTotal'])if(Number.isFinite(snapshot[key])&&snapshot[key]>=0)summary[key]=snapshot[key];
  if(typeof snapshot.observedAt==='string'&&Number.isFinite(Date.parse(snapshot.observedAt)))summary.observedAt=new Date(snapshot.observedAt).toISOString();
  if(Array.isArray(snapshot.cases))summary.cases=snapshot.cases.slice(0,1000).filter(item=>item&&['string','number'].includes(typeof item.id)).map(item=>({id:item.id,name:String(item.name||'').slice(0,200),...(Number.isFinite(item.amount)?{amount:item.amount}:{}),...(Number.isFinite(item.quantity)?{quantity:item.quantity}:{})}));
  if(Object.keys(summary).length)result[id]=summary;
 }
 return result;
}
