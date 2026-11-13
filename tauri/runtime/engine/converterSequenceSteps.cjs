const steps=require('../../shared/converter-steps.json');
function normalizeSequenceSteps(value){
 if(!Array.isArray(value)||!value.length||value.length>steps.length||value.some(id=>typeof id!=='string'||!steps.some(s=>s.id===id))||new Set(value).size!==value.length)throw Error('Escolhe uma ou mais etapas válidas, sem repetições.');
 const selected=new Set(value);return steps.filter(s=>selected.has(s.id)).map(s=>s.id);
}
const availableSequenceSteps=row=>{
 const source=(row.handoffs||[]).filter(i=>i.location==='source'),destination=(row.handoffs||[]).filter(i=>i.location==='destination');
 const choices=[source.some(i=>i.kind==='sticker')||row.remainingSkinIds?.length?'convert-stickers':null,source.some(i=>i.kind==='skin')?'transfer':null,destination.length||source.some(i=>i.kind==='skin')?'convert-received':null].filter(Boolean);
 if(['stopped','failed','cancelled'].includes(row.state))for(const step of row.sequencePlan?.effectiveSteps||[])if(!row.completedSteps?.includes(step)&&!choices.includes(step))choices.push(step);
 return steps.filter(s=>choices.includes(s.id)).map(s=>s.id);
};
module.exports={normalizeSequenceSteps,availableSequenceSteps};
