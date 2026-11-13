const test=require('node:test'),assert=require('node:assert/strict');const {safeEvent}=require('../engine/export.cjs');
test('progression evidence preserves reviewed result and progress while stripping unrelated fields',()=>{const event=safeEvent({type:'progression',accountId:'a',kind:'skill-preset',title:'Preset Dust II',state:'unconfirmed',verified:false,completed:2,total:5,message:'Resultado desconhecido',cookie:'secret',config:{token:'secret'}});assert.equal(event.kind,'skill-preset');assert.equal(event.state,'unconfirmed');assert.equal(event.completed,2);assert.equal(event.total,5);assert.equal(event.title,'Preset Dust II');assert.equal(JSON.stringify(event).includes('secret'),false);});
test('mission and pass claim kinds are retained in exported operation evidence',()=>{
 for(const kind of ['mission','pass'])assert.equal(safeEvent({type:'progression',kind,state:'completed',verified:true}).kind,kind);
});
