'use strict';
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const path=require('node:path');

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
    child.stderr.resume();
    readline.createInterface({input:child.stdout}).on('line',line=>{
      if(line.length>32*1024*1024)return;
      let value;try{value=JSON.parse(line);}catch{return;}
      if(value.type==='result')finish(value.id,value.error,value.result);
      else if(value.type==='native-event'){if(value.event==='closed')openWindows.delete(value.id);onEvent(value);}
    });
    const current=child;
    const failed=()=>{if(child!==current)return;child=null;for(const id of [...openWindows]){openWindows.delete(id);onEvent({type:'native-event',id,event:'closed'});}for(const id of [...pending.keys()])finish(id,'O navegador de login foi fechado. Entra novamente na conta.');};
    child.once('error',failed);child.once('exit',failed);
    child.stdin.on('error',()=>{});
    return child;
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
