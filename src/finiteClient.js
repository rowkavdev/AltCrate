export function createFiniteEvaluator({workerFactory=()=>new Worker(new URL('./blackjackFinite.worker.js',import.meta.url),{type:'module'}),timeoutMs=1000}={}) {
  let worker=null,pending=null,sequence=0;
  function finish(result,terminate=false) {
    if(terminate&&worker){worker.terminate();worker=null;}
    if(pending){clearTimeout(pending.timer);const resolve=pending.resolve;pending=null;resolve(result);}
  }
  return {
    evaluate(state,{kind='finite'}={}) {
      if(pending)return Promise.resolve({complete:false,reason:'busy'});
      return new Promise(resolve=>{
        try {
          if(!worker){worker=workerFactory();worker.onmessage=event=>{if(event.data?.id===pending?.id)finish(event.data.result);};worker.onerror=()=>finish({complete:false,reason:'worker'},true);}
          const id=++sequence;
          pending={id,resolve,timer:setTimeout(()=>finish({complete:false,reason:'timeout'},true),timeoutMs)};
          worker.postMessage({id,state,kind});
        }catch{if(pending)finish({complete:false,reason:'worker'},true);else resolve({complete:false,reason:'worker'});}
      });
    },
    dispose(){finish({complete:false,reason:'stopped'},true);},
  };
}
