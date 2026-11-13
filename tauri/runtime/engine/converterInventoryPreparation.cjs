const {protections}=require('./converterReview.cjs');
function inventoryShortage({profile,steps,items,stickerItems,openings}){
 const converts=steps.includes('convert-stickers'),opens=steps.includes('open')?openings:0;
 const beforeOpen=converts?new Set(stickerItems.map(i=>i.id)).size:0;
 const beforeMint=new Set([...(steps.includes('convert-inventory')?items:[]),...(converts?stickerItems:[])].map(i=>i.id)).size;
 const mint=steps.includes('mint')&&(profile.tokens>=1||beforeMint>0||converts&&opens>0);
 return Math.max(0,opens?(converts?1:opens)+profile.inventoryCount-profile.inventorySize-beforeOpen:0,mint?1+profile.inventoryCount-profile.inventorySize-beforeMint+(converts?0:opens):0);
}
function inventoryPreparation(args){
 const {profile,steps,all,items,heldIds,label}=args;
 if(steps.includes('convert-inventory')&&steps.includes('open')&&items.length)return {kind:'convert-existing',items:[...items],slots:items.length,beforeCount:profile.inventoryCount,inventorySize:profile.inventorySize};
 const shortage=inventoryShortage(args);
 if(!shortage)return null;
 if(all.length!==profile.inventoryCount)throw Error('O inventário mudou. Atualiza e revê '+label+'.');
 const chosen=all.filter(item=>['skin','sticker'].includes(item.type)&&item.price>0&&!protections(item).length&&!heldIds.has(item.id)).sort((a,b)=>a.price-b.price||a.id.localeCompare(b.id)).slice(0,shortage);
 if(chosen.length<shortage)throw Error('Falta espaço no inventário de '+label+': é necessário libertar '+shortage+' lugares, mas só '+chosen.length+' itens podem ser convertidos sem tocar nos protegidos.');
 return {kind:'free-inventory',items:chosen,slots:shortage,beforeCount:profile.inventoryCount,inventorySize:profile.inventorySize};
}
module.exports={inventoryPreparation,inventoryShortage};
