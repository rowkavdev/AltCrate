export function gameColumnsForWidth(width,preferred,count){
 if(count<=0)return 0;
 const fit=Math.max(1,Math.floor((Math.max(0,width)+16)/376));
 return Math.min(fit,Math.max(1,Math.min(5,Number(preferred)||3)),count,20);
}
export function upgradeTargetReady(targetId,targets){return !!targetId&&targets.some(item=>item.id===targetId);}
export function gameInitialBet(game,saved){return saved===undefined?(game==='dice'?'100':'1'):saved;}
