const collator=new Intl.Collator('pt-PT',{numeric:true,sensitivity:'base'});
export function accountListView(accounts,workspace,options={}){
 const query=String(options.query||'').trim().toLocaleLowerCase('pt-PT'),groupId=options.groupId||'all';
 const groups=new Map((workspace?.groups||[]).map(group=>[group.id,group.name]));
 const counts={all:0,ready:0,pending:0,verification:0};
 const filtered=accounts.filter(account=>{
  const group=workspace?.accountGroups?.[account.id]||null;
  if(groupId!=='all'&&(groupId==='ungrouped'?group!==null:group!==groupId))return false;
  if(query&&![account.label,account.email,groups.get(group)].some(value=>String(value||'').toLocaleLowerCase('pt-PT').includes(query)))return false;
  counts.all++;
  const ready=account.session?.reusable&&!account.session?.validationPending;
  counts[ready?'ready':'pending']++;
  if(account.session?.state==='verification')counts.verification++;
  if(options.status==='ready'&&(!account.session?.reusable||account.session?.validationPending))return false;
  if(options.status==='pending'&&account.session?.reusable&&!account.session?.validationPending)return false;
  if(options.status==='verification'&&account.session?.state!=='verification')return false;
  return true;
 }).sort((a,b)=>options.sort==='recent'?(Date.parse(b.addedAt)||0)-(Date.parse(a.addedAt)||0)||collator.compare(a.id,b.id):collator.compare(options.sort==='email'?a.email||a.label:a.label,options.sort==='email'?b.email||b.label:b.label)||collator.compare(a.id,b.id));
 const pageSize=[10,25,50].includes(Number(options.pageSize))?Number(options.pageSize):10;
 const pages=Math.max(1,Math.ceil(filtered.length/pageSize)),page=Math.min(pages,Math.max(1,Number.isSafeInteger(options.page)?options.page:1));
 const start=(page-1)*pageSize;
 return {filtered,rows:filtered.slice(start,start+pageSize),page,pages,pageSize,total:filtered.length,counts,start:filtered.length?start+1:0,end:Math.min(start+pageSize,filtered.length)};
}
export function togglePageSelection(selectedIds,pageIds,checked){
 const next=new Set(selectedIds);for(const id of pageIds)checked?next.add(id):next.delete(id);return [...next];
}
