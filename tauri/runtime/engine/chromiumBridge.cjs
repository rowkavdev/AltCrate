'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const MAX_FRAME_BYTES = 32 * 1024 * 1024;

// Private pipes only. No debugger port, renderer preload, vault key, or API exposed
// to the remote page. A failed browser request is never retried through Node/WebKit.
function createChromiumBridge({executable,dataDirectory,onEvent,spawnProcess=spawn}){
  let child,sequence=0,stopped=false;
  const pending=new Map(),openWindows=new Set();
  function finish(id,error,result){
    const task=pending.get(id);if(!task)return;
    pending.delete(id);clearTimeout(task.timer);task.signal?.removeEventListener('abort',task.abort);
    error?task.reject(Error(error)):task.resolve(result);
  }
  function start(){
    if(stopped)throw Error('O navegador de login foi encerrado.');
    if(child)return child;
    const env={...process.env};
    for(const name of ['NODE_OPTIONS','ELECTRON_RUN_AS_NODE','CASEPILOT_FIXTURE','CASEPILOT_VERIFY_UI','CASEPILOT_VERIFY_EXIT','VITE_DEV_SERVER_URL'])delete env[name];
    child=spawnProcess(executable,[path.join(__dirname,'chromium-worker.cjs'),'--casepilot-data',path.join(dataDirectory,'chromium')],{env,stdio:['pipe','pipe','pipe']});
    const current=child;
    let partial;
    let length = 0;

    function disconnect(message, terminate) {
      if (child !== current) return;
      child = null;
      partial = undefined;
      length = 0;
      const windows = [...openWindows];
      openWindows.clear();
      for (const id of pending.keys()) finish(id, message);
      if (terminate) current.kill();
      for (const id of windows) onEvent({ type: 'native-event', id, event: 'closed' });
    }

    const closedMessage = 'O navegador de login foi fechado. Entra novamente na conta.';
    const invalidFrame = () => disconnect('O navegador de login enviou uma resposta inválida. Entra novamente na conta.', true);
    const pipeFailed = () => disconnect(closedMessage, true);
    const exited = () => disconnect(closedMessage, false);

    current.stderr.resume();
    current.stdout.on('data', chunk => {
      let offset = 0;
      while (child === current && offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline === -1 ? chunk.length : newline;
        const bytes = end - offset;
        const size = length + bytes;
        if (size > MAX_FRAME_BYTES) {
          invalidFrame();
          return;
        }

        // Only frames split across chunks need a buffer. Grow it within the byte cap.
        let frame = chunk.subarray(offset, end);
        if (length || newline === -1) {
          if (!partial || partial.length < size) {
            const capacity = Math.min(MAX_FRAME_BYTES, Math.max(size, (partial?.length ?? 2048) * 2));
            const next = Buffer.allocUnsafe(capacity);
            partial?.copy(next, 0, 0, length);
            partial = next;
          }
          frame.copy(partial, length);
          length = size;
          if (newline === -1) return;
          frame = partial.subarray(0, length);
          partial = undefined;
          length = 0;
        }
        offset = end + 1;

        let value;
        try {
          value = JSON.parse(frame.toString('utf8'));
        } catch {
          invalidFrame();
          return;
        }
        if (value?.type === 'result') finish(value.id, value.error, value.result);
        else if (value?.type === 'native-event') {
          if (value.event === 'closed') openWindows.delete(value.id);
          onEvent(value);
        }
      }
    });
    current.stdout.once('end', () => {
      if (length) invalidFrame();
      else pipeFailed();
    });
    current.stdout.once('close', pipeFailed);
    current.stdout.on('error', pipeFailed);
    current.stdin.on('error', pipeFailed);
    current.on('error', exited);
    current.once('exit', exited);
    return current;
  }
  return {
    request(method,args={},signal){
      if(signal?.aborted)return Promise.reject(signal.reason||Error('Operação cancelada'));
      let process;try{process=start();}catch(error){return Promise.reject(error);}
      const id='browser-'+(++sequence);
      return new Promise((resolve,reject)=>{
        const abort=()=>{process.stdin.write(JSON.stringify({type:'cancel',id})+'\n');finish(id,'Operação cancelada');};
        const timer=setTimeout(()=>{process.stdin.write(JSON.stringify({type:'cancel',id})+'\n');finish(id,'O navegador de login não respondeu.');},60000);
        const completed=result=>{if(method==='login.create')openWindows.add(args.id);if(method==='login.retain')openWindows.delete(args.id);resolve(result);};
        pending.set(id,{resolve:completed,reject,timer,signal,abort});signal?.addEventListener('abort',abort,{once:true});
        process.stdin.write(JSON.stringify({type:'request',id,method,args})+'\n');
      });
    },
    close(){stopped=true;if(child){child.stdin.end(JSON.stringify({type:'shutdown'})+'\n');const current=child;const timer=setTimeout(()=>current.kill(),2000);timer.unref();}for(const id of [...pending.keys()])finish(id,'Aplicação encerrada.');},
  };
}
module.exports={createChromiumBridge};
