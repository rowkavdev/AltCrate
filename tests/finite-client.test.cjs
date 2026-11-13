const test=require('node:test'),assert=require('node:assert/strict');
test('finite evaluator discards a timed-out worker and starts a fresh one for the next hand',async()=>{
  const {createFiniteEvaluator}=await import('../src/finiteClient.js');
  const workers=[];
  const evaluator=createFiniteEvaluator({workerFactory:()=>{const worker={terminate(){this.terminated=true;},postMessage(message){this.message=message;}};workers.push(worker);return worker;},timeoutMs:10});
  assert.equal((await evaluator.evaluate({cards:['K','Q']})).complete,false);
  assert.equal(workers[0].terminated,true);
  const next=evaluator.evaluate({cards:['9','7']});
  workers[1].onmessage({data:{id:workers[1].message.id,result:{complete:true,peek:{stand:0}}}});
  assert.equal((await next).complete,true);
  const stopped=evaluator.evaluate({cards:['A','7']});evaluator.dispose();
  assert.equal((await stopped).complete,false);assert.equal(workers[1].terminated,true);
});
