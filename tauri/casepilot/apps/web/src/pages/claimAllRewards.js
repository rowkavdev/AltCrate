// Reuse the reviewed, sequential batch transport and its result verification.
export async function claimAllRewards({bridge,accountIds,onBatch=()=>{},shouldStop=()=>false}){
 const seen=new Set();let confirmed=0,batch=null;
 while(!shouldStop()){
  const rows=await bridge.discoverProgressionBatch({accountIds,kinds:['reward','mission','pass']});
  if(shouldStop())break;
  const failure=rows.find(row=>row.state==='failed');
  if(failure)throw new Error(failure.message||'Não foi possível consultar todas as recompensas.');
  const actions=rows.filter(row=>row.eligible===true&&['reward','mission','pass'].includes(row.kind))
   .map(({accountId,kind,payload})=>({accountId,kind,payload}))
   .filter(action=>!seen.has(JSON.stringify(action))).slice(0,500);
  if(!actions.length)break;
  for(const action of actions)seen.add(JSON.stringify(action));
  batch=await bridge.prepareProgressionBatch({actions});onBatch(batch);
  if(shouldStop()){batch=await bridge.stopProgressionBatch(batch.batchId);onBatch(batch);break;}
  if(!batch.rows.some(row=>row.state==='ready'))break;
  batch=await bridge.confirmProgressionBatch(batch.batchId);onBatch(batch);
  confirmed+=batch.rows.filter(row=>row.state==='confirmed').length;
  if(batch.phase!=='completed'||batch.rows.some(row=>row.state!=='confirmed'))break;
 }
 return {confirmed,batch,stopped:shouldStop()};
}
