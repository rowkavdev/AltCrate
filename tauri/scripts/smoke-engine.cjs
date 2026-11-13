const {spawn}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');const readline=require('node:readline');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'casepilot-tauri-smoke-'));
const child=spawn(process.execPath,[path.join(root,'runtime/engine/desktop-worker.cjs')],{cwd:path.join(root,'runtime'),stdio:['pipe','pipe','pipe']});
let seq=0;const pending=new Map(),checks=[];const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
const invoke=(channel,...args)=>new Promise((resolve,reject)=>{const id='test-'+(++seq);pending.set(id,{resolve,reject});send({type:'command',id,channel,args});});
const timer=setTimeout(()=>{console.error('Engine verification timed out');child.kill();process.exitCode=1;},25000);
child.stderr.on('data',()=>{});
readline.createInterface({input:child.stdout}).on('line',async line=>{
 const message=JSON.parse(line);
 if(message.type==='native-request'){send({type:'native-result',id:message.id,result:message.method==='login.cookies'?null:undefined});return;}
 if(message.type==='fatal'){console.error(message.error);child.kill();process.exitCode=1;return;}
 if(message.type==='result'){const task=pending.get(message.id);pending.delete(message.id);message.error?task?.reject(Error(message.error)):task?.resolve(message.result);return;}
 if(message.type!=='ready')return;
 try{
  const preload=fs.readFileSync(path.join(root,'../electron/preload.cjs'),'utf8');
  const required=[...preload.matchAll(/invoke\('([^']+)'/g)].map(m=>m[1]);assert(required.every(channel=>message.channels.includes(channel)));checks.push('All '+new Set(required).size+' original desktop commands registered');
  for(const [channel,validate] of [['accounts:list',v=>assert.deepEqual(v,[])],['workspace:read',v=>assert(Array.isArray(v.groups))],['farm:status',v=>assert.equal(v.phase,'idle')],['open:status',v=>assert.equal(v.phase,'idle')],['converter:status',v=>assert.equal(v.phase,'idle')],['history:query',v=>assert(Array.isArray(v.rows))]]){validate(await invoke(channel));checks.push(channel);}
  const groups=await invoke('workspace:command','createGroup',{name:'Tauri smoke'});assert(groups.groups.some(g=>g.name==='Tauri smoke'));checks.push('Local workspace persists groups');
  await assert.rejects(invoke('accounts:refresh','unknown-account'));checks.push('Unknown accounts rejected');
  await assert.rejects(invoke('unknown-command'));checks.push('Unknown commands rejected');
  const math=await invoke('blackjack:self-check');assert.equal(math.length,4);assert(math.every(item=>item.passed));checks.push('Four native strategy worker calculations');
  fs.mkdirSync(path.join(root,'evidence'),{recursive:true});fs.writeFileSync(path.join(root,'evidence/engine-smoke.json'),JSON.stringify({passed:true,fixture:'temporary empty account store',runtime:'Node sidecar; no Electron or Qt',liveGameRequests:0,checks},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));send({type:'shutdown'});
 }catch(error){console.error(error);process.exitCode=1;child.kill();}
});
child.on('exit',code=>{clearTimeout(timer);if(code!==0)process.exitCode=1;fs.rmSync(data,{recursive:true,force:true});});
send({type:'initialize',configuration:{dataDirectory:data,appDataDirectory:data,vaultKey:crypto.randomBytes(32).toString('base64')}});
