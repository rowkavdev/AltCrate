const finite=value=>typeof value==='number'&&Number.isFinite(value);
const future=(value,now)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)>now;
function missionStep(missions,id,now){
 const mission=missions.find(row=>row.id===id);
 if(!mission||mission.redeemed||mission.eligible!==true||!finite(mission.current)||!finite(mission.target)||mission.target<=0||mission.current<mission.target||!future(mission.validTill,now)||!['day','week'].includes(mission.duration))throw Error('Missão não elegível, expirada ou já recolhida. Atualiza as missões.');
 return {kind:'mission',id,name:mission.title,goal:mission.goal,target:mission.target,validTill:mission.validTill,duration:mission.duration,passPoints:mission.duration==='week'?25:10};
}
function passStep(pass,tier,track,now){
 const premium=track==='premium',suffix=premium?'Premium':'Free',claimed=pass['claimed'+suffix+'Tiers'],available=pass['claimable'+suffix+'Tiers'];
 const entry=pass.track?.find(row=>row.tier===tier),reward=entry?.[premium?'premiumReward':'freeReward'],effects=entry?.[premium?'premiumEffects':'freeEffects'];
 if(premium&&pass.isPremium!==true)throw Error('A faixa Premium não está ativa nesta conta.');
 if(typeof pass.period!=='string'||!pass.period||!future(pass.endsAt,now)||!Array.isArray(claimed)||!Array.isArray(available)||claimed.includes(tier)||!available.includes(tier)||typeof reward!=='string'||!reward)throw Error('Recompensa do passe não elegível, indisponível ou já recolhida. Atualiza o passe.');
 return {kind:'pass',tier,track,period:pass.period,endsAt:pass.endsAt,name:'Escalão '+tier+' · '+(premium?'Premium':'Gratuito'),reward,description:effects?.length?effects.map(effect=>effect.description+(effect.amount!==null?' +'+effect.amount:'')).join(' · '):reward};
}
function missionObserved(missions,step){return missions.some(row=>row.id===step.id&&row.redeemed===true&&row.validTill===step.validTill&&row.goal===step.goal);}
function passObserved(pass,step){return pass.period===step.period&&pass.endsAt===step.endsAt&&pass['claimed'+(step.track==='premium'?'Premium':'Free')+'Tiers']?.includes(step.tier)===true;}
function claimRequest(step){
 if(step.kind==='mission')return {path:'/api/missions',method:'DELETE',body:{id:step.id}};
 if(step.kind==='pass')return {path:'/api/monthlyPass',method:'POST',body:{tier:step.tier,track:step.track}};
 return null;
}
module.exports={missionStep,passStep,missionObserved,passObserved,claimRequest};
