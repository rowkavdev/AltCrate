'use strict';
const {app,BrowserWindow,session}=require('electron');
const readline=require('node:readline'),path=require('node:path'),fs=require('node:fs');
const ORIGIN='https://case-clicker.com',MAX_BODY=16*1024*1024;
const testIndex=process.argv.indexOf('--casepilot-test-origin');
const testOrigin=testIndex<0?null:new URL(process.argv[testIndex+1]);
if(testOrigin&&(testOrigin.protocol!=='http:'||testOrigin.hostname!=='127.0.0.1'))throw Error('Tests require a local loopback origin');
const dataIndex=process.argv.indexOf('--casepilot-data');
if(dataIndex<0||!process.argv[dataIndex+1])throw Error('Missing private browser directory');
const directory=path.resolve(process.argv[dataIndex+1]);fs.mkdirSync(directory,{recursive:true,mode:0o700});
app.setPath('userData',directory);app.setName('AltCrate Login');
const windows=new Map(),stores=new Map(),preparing=new Map(),requests=new Map(),cookieTimers=new Map(),observedStores=new WeakSet();let transportClosed=false;
function stop(){if(transportClosed)return;transportClosed=true;for(const task of requests.values())task.abort();void Promise.allSettled([...stores.values()].map(store=>store.cookies.flushStore())).finally(()=>app.quit());}
function send(value){if(transportClosed||process.stdout.destroyed||!process.stdout.writable)return;try{process.stdout.write(JSON.stringify(value)+'\n',error=>{if(error)stop();});}catch{stop();}}
process.stdout.on('error',stop);process.stdin.on('error',stop);
function partition(value){if(typeof value!=='string'||!value.startsWith('persist:')||value.length>200)throw Error('Sessão de login inválida.');return value;}
function siteURL(value){const url=new URL(value);if((url.origin!==ORIGIN&&url.origin!==testOrigin?.origin)||url.username||url.password)throw Error('Destino de login inválido.');return url.href;}
function navigationURL(value){try{const url=new URL(value);return ['about:blank','about:srcdoc'].includes(url.href)||(!url.username&&!url.password&&(url.origin===testOrigin?.origin||(url.protocol==='https:'&&!url.port&&['case-clicker.com','challenges.cloudflare.com'].includes(url.hostname))));}catch{return false;}}
function entryFor(key){return [...windows.values()].find(entry=>entry.partition===key&&!entry.window.isDestroyed());}
async function cookiesFor(key){return session.fromPartition(partition(key)).cookies.get({url:ORIGIN});}
async function setCookies(key,values,{replace=false}={}){
 const store=session.fromPartition(partition(key)).cookies;
 if(replace)for(const cookie of await cookiesFor(key))await store.remove(ORIGIN+cookie.path,cookie.name);
 for(const value of values||[]){
  if(!['case-clicker.com','.case-clicker.com'].includes(value.domain||'case-clicker.com'))continue;
  if(Number.isFinite(value.expirationDate)&&value.expirationDate<=Date.now()/1000)continue;
  const cookie={url:ORIGIN,name:value.name,value:value.value,path:value.path||'/',secure:value.secure!==false,httpOnly:value.httpOnly===true};
  if(!value.name.startsWith('__Host-'))cookie.domain=value.domain||'case-clicker.com';
  if(Number.isFinite(value.expirationDate))cookie.expirationDate=value.expirationDate;
  if(['unspecified','no_restriction','lax','strict'].includes(value.sameSite))cookie.sameSite=value.sameSite;
  await store.set(cookie);
 }
 await store.flushStore();
}
async function prepare(args){
 const key=partition(args.partition);if(stores.has(key))return stores.get(key);if(preparing.has(key))return preparing.get(key);
 const work=(async()=>{
  const store=session.fromPartition(key);
  if(args.proxy){const proxy=new URL(args.proxy);if(!['http:','socks5:'].includes(proxy.protocol)||proxy.username||proxy.password)throw Error('Proxy inválido.');await store.setProxy({proxyRules:proxy.href});}else await store.setProxy({mode:'direct'});
  store.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));store.setPermissionCheckHandler(()=>false);
  if(!(await cookiesFor(key)).length)await setCookies(key,args.cookies);
  if(!observedStores.has(store)){observedStores.add(store);store.cookies.on('changed',(_event,cookie)=>{
   if(!['case-clicker.com','.case-clicker.com'].includes(cookie.domain))return;
   clearTimeout(cookieTimers.get(key));cookieTimers.set(key,setTimeout(()=>{cookieTimers.delete(key);void store.cookies.flushStore().catch(()=>{});send({type:'native-event',kind:'session-cookies',partition:key});},100));
  });}
  stores.set(key,store);return store;
 })().finally(()=>preparing.delete(key));preparing.set(key,work);return work;
}
async function create(args){
 if(typeof args.id!=='string'||!args.id.startsWith('login-')||args.id.length>100||windows.has(args.id))throw Error('Janela de login inválida.');
 const key=partition(args.partition);if(entryFor(key))throw Error('Já existe um login aberto nesta conta.');
 await prepare(args);
 const window=new BrowserWindow({width:args.width||1050,height:args.height||800,show:args.background!==true,title:args.title||'AltCrate · Entrar',webPreferences:{partition:key,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
 const entry={window,partition:key,id:args.id,retained:false};windows.set(args.id,entry);
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 for(const name of ['will-navigate','will-frame-navigate','will-redirect'])window.webContents.on(name,(event,url)=>{if(!navigationURL(typeof url==='string'?url:event.url))event.preventDefault();});
 window.webContents.on('will-attach-webview',event=>event.preventDefault());window.webContents.on('will-prevent-unload',event=>event.preventDefault());
 window.webContents.on('did-finish-load',()=>send({type:'native-event',id:args.id,event:'did-finish-load',url:window.webContents.getURL()}));
 window.on('closed',()=>{windows.delete(args.id);if(!entry.retained)send({type:'native-event',id:args.id,event:'closed'});});
 return entry;
}
async function fetchInSession(store,args,id){
 siteURL(args.url);const method=String(args.method||'GET').toUpperCase();if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method))throw Error('Método inválido.');
 const body=args.body==null?undefined:Buffer.from(args.body,'base64');if(body?.length>MAX_BODY)throw Error('Pedido demasiado grande.');
 const headers=new Headers(args.headers||{});for(const name of ['cookie','host','origin','user-agent'])headers.delete(name);
 const controller=new AbortController();requests.set(id,controller);
 try{
  const response=await store.fetch(args.url,{method,headers,body,credentials:args.credentials==='omit'?'omit':'include',cache:'no-store',redirect:'error',signal:controller.signal});
  const reader=response.body?.getReader(),parts=[];let length=0;
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BODY){controller.abort();throw Error('Resposta demasiado grande.');}parts.push(Buffer.from(value));}
  return {status:response.status,statusText:response.statusText,headers:Object.fromEntries(response.headers),body:Buffer.concat(parts).toString('base64')};
 }finally{requests.delete(id);}
}
async function handle(method,args,id){
 if(method==='login.create'){await create(args);return null;}
 if(method==='session.prepare'){const store=await prepare(args);return {userAgent:store.getUserAgent()};}
 if(method==='session.info')return {windows:windows.size,sessions:stores.size,transport:'chromium-session'};
 if(method==='session.invalidate'){const key=partition(args.partition);stores.delete(key);await session.fromPartition(key).closeAllConnections();return null;}
 if(method==='login.cookies')return stores.has(args.partition)?cookiesFor(args.partition):null;
 if(method==='login.setCookies'){if(stores.has(args.partition))await setCookies(args.partition,args.cookies,{replace:true});return null;}
 if(method==='login.clear'){const store=session.fromPartition(partition(args.partition));await store.clearStorageData();stores.delete(args.partition);return null;}
 if(method==='login.fetch'){const store=stores.get(args.partition);return store?fetchInSession(store,args,id):null;}
 const entry=windows.get(args.id);if(!entry||entry.window.isDestroyed()){if(method==='login.close')return null;throw Error('A janela de login foi fechada.');}
 if(method==='login.load'){await entry.window.loadURL(siteURL(args.url));return {userAgent:entry.window.webContents.getUserAgent()};}
 if(method==='login.script'){try{siteURL(entry.window.webContents.getURL());}catch{return null;}return entry.window.webContents.executeJavaScript(args.script);}
 if(method==='login.retain'){entry.retained=true;const store=session.fromPartition(entry.partition);await store.cookies.flushStore();store.flushStorageData();entry.window.destroy();return null;}
 if(method==='login.close'){entry.window.close();return null;}
 throw Error('Comando de navegador desconhecido.');
}
app.on('window-all-closed',()=>{});
app.whenReady().then(()=>{
 const input=readline.createInterface({input:process.stdin});
 input.on('line',line=>{let message;try{message=JSON.parse(line);}catch{return;}
  if(message.type==='shutdown'){stop();return;}
  if(message.type==='cancel'){requests.get(message.id)?.abort();return;}
  if(message.type==='request')void handle(message.method,message.args||{},message.id).then(result=>send({type:'result',id:message.id,result}),()=>send({type:'result',id:message.id,error:'Não foi possível concluir o pedido na sessão da conta.'}));
 });input.on('close',stop);
});
