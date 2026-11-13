const {validId}=require('./inventoryItemLocator.cjs');
function openingIntent(row){
 const p=row.pending;
 return !row.tradeId&&typeof row.sourceIdentity==='string'&&!!row.sourceIdentity&&p?.kind==='seq-open'&&p.id==='64d9ecad463b7ffa9697e2ea'&&Number.isSafeInteger(p.amount)&&p.amount>0&&p.amount<=1000&&Number.isSafeInteger(p.before)&&p.before>=p.amount;
}
function identifiedOpening(row){const p=row.pending;return openingIntent(row)&&Array.isArray(p.skinIds)&&p.skinIds.length===p.amount&&new Set(p.skinIds).size===p.amount&&p.skinIds.every(validId);}
const unknownOpening=row=>openingIntent(row)&&row.pending.skinIds==null;
function identifiedConversion(row){
 const p=row.pending;
 return !row.tradeId&&typeof row.sourceIdentity==='string'&&!!row.sourceIdentity&&p?.kind==='inventory-child'&&p.childKind==='convert'&&validId(p.itemId)&&typeof p.operationId==='string'&&!!p.operationId&&typeof p.previewId==='string'&&!!p.previewId&&[row.accountId,row.destinationAccountId].includes(p.accountId)&&Number.isFinite(p.beforeTokens)&&p.beforeTokens>=0;
}
const completeVerification=v=>v?.phase==='complete'&&v.outcome==='pending'&&v.errorStatus===0&&Number.isFinite(Date.parse(v.finishedAt));
function canCloseUnresolved(row){
 if(row.state!=='unconfirmed'||row.childOperations?.some(child=>['running','unconfirmed'].includes(child.state)))return false;
 const v=row.verification,i=v?.inventory;
 if(!completeVerification(v))return false;
 if(identifiedConversion(row))return v.childOperationId===row.pending.operationId&&v.child?.complete===true&&v.child.operationId===row.pending.operationId&&v.child.accountId===row.pending.accountId&&v.child.itemId===row.pending.itemId&&v.child.canCloseUnresolved===true;
 if(row.remainingSkinIds?.length||row.remainingItems?.length||row.handoffs?.length||!openingIntent(row)||v.expected!==row.pending.amount||!Number.isSafeInteger(i?.pages)||i.pages<1||i.page!==i.pages||!Number.isSafeInteger(i.read)||i.read<0||i.read!==i.total)return false;
 return identifiedOpening(row)?Number.isSafeInteger(v.found)&&v.found>=0&&v.found<v.expected&&i.read>=v.found:unknownOpening(row)&&v.unknownResultScope===true&&v.unknownScopeDiagnosticComplete===true;
}
function isClosedUnresolved(row){
 if(row.state!=='unresolved')return false;
 if(row.resolution?.kind==='unresolved-conversion')return identifiedConversion(row);
 return row.resolution?.kind==='unresolved-opening'&&(identifiedOpening(row)||unknownOpening(row)&&row.resolution.scope?.kind==='unknown-opening-results'&&row.resolution.scope.accountId===row.accountId&&row.resolution.scope.identity===row.sourceIdentity);
}
const requiresUnknownScopeIsolation=row=>isClosedUnresolved(row)&&unknownOpening(row);
const unresolvedResultCount=row=>row.pending?.kind==='seq-open'&&openingIntent(row)?row.pending.amount:identifiedConversion(row)?1:0;
function unresolvedResolution(row,{closedAt=new Date().toISOString()}={}){
 const conversion=identifiedConversion(row),p=row.pending;
 return {kind:conversion?'unresolved-conversion':'unresolved-opening',closedAt,verificationAt:row.verification.finishedAt,unconfirmedCount:unresolvedResultCount(row),scope:conversion?{kind:'identified-conversion',accountId:p.accountId,identity:p.accountId===row.accountId?row.sourceIdentity:row.destinationIdentity,itemIds:[p.itemId],childOperationId:p.operationId,previewId:p.previewId}:{kind:identifiedOpening(row)?'identified-opening-results':'unknown-opening-results',accountId:row.accountId,identity:row.sourceIdentity,capsuleId:p.id,amount:p.amount,...(Array.isArray(p.skinIds)?{itemIds:[...p.skinIds]}:{})}};
}
const closedResultIds=row=>!isClosedUnresolved(row)?[]:identifiedConversion(row)?[row.pending.itemId]:row.pending.skinIds||[];
const protectedResultIds=rows=>new Set(rows.flatMap(closedResultIds));
function protectedResultOwners(rows){
 const owners=new Map();
 for(const row of rows){
  const ids=[...closedResultIds(row),...(row.remainingSkinIds||[]),...(row.handoffs||[]).map(item=>item.id),...(row.remainingItems||[]).map(item=>item.id),...(row.sequencePlan?.items||[]).map(item=>item.id),...(row.sequencePlan?.prerequisites||[]).flatMap(p=>p.items?.map(i=>i.id)||[])];
  for(const id of ids){if(!owners.has(id))owners.set(id,new Set());owners.get(id).add(row.operationId);}
 }return owners;
}
module.exports={canCloseUnresolved,isClosedUnresolved,protectedResultIds,protectedResultOwners,unresolvedResolution,unresolvedResultCount,requiresUnknownScopeIsolation};
