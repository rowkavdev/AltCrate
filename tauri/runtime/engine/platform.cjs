'use strict';

// Private Tauri transport. Workspace UI uses WebKit; account browsing uses Chromium.
const {EventEmitter} = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');
const handlers = new Map(), pending = new Map(), windows = new Map();
let nativeNetwork,chromium;
let configuration, readyResolve, sequence = 0, quitting = false;
const boot = new Promise(resolve => { readyResolve = resolve; });
const nativeEvents = new EventEmitter();

function send(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function request(method, args = {}, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || Error('Operação cancelada'));
  if(chromium&&(method.startsWith('login.')||method.startsWith('session.'))){
    return chromium.request(method,args,signal).then(result=>{if(method==='login.retain')mainSurface.focus();return result;});
  }
  const id = 'native-' + (++sequence);
  return new Promise((resolve, reject) => {
    const abort = () => {
      pending.delete(id); send({type:'native-cancel',id});
      reject(signal.reason || Error('Operação cancelada'));
    };
    pending.set(id, {resolve, reject, signal, abort});
    signal?.addEventListener('abort', abort, {once:true});
    send({type:'native-request', id, method, args});
  });
}
const mainSurface = {
  isDestroyed: () => false, isMinimized: () => false, restore(){},
  focus: () => send({type:'focus'}),
  webContents: {send:(_channel,payload)=>send({type:'event',payload})},
};
const lifecycle = new EventEmitter();
lifecycle.whenReady = () => boot;
lifecycle.getPath = name => {
  if (!configuration) throw Error('O Tauri ainda não iniciou a aplicação');
  return name === 'userData' ? configuration.dataDirectory : configuration.appDataDirectory;
};
lifecycle.setPath = () => {};
lifecycle.getAppPath = () => path.resolve(__dirname,'..');
lifecycle.requestSingleInstanceLock = () => true; // Enforced by the Tauri host before spawn.
lifecycle.relaunch = () => send({type:'relaunch'});
lifecycle.quit = () => {
  if (quitting) return;
  let prevented = false;
  lifecycle.emit('before-quit',{preventDefault(){prevented=true;}});
  if (!prevented) { quitting=true; chromium?.close();send({type:'closed'}); process.exitCode=0; setTimeout(()=>process.exit(0),25); }
};
const commands = {
  handle(name, action) {
    if (handlers.has(name)) throw Error('Comando duplicado: '+name);
    handlers.set(name, action);
  },
  execute(name,args=[]){const handler=handlers.get(name);if(!handler)throw Error('Comando desconhecido');return Promise.resolve(handler({sender:mainSurface.webContents},...args));},
};

class NativeLoginWindow extends EventEmitter {
  constructor(options) {
    super(); this.id='login-'+(++sequence); this.destroyed=false; this.url='';
    this.partition=options.webPreferences.partition; windows.set(this.id,this);
    this.created=(async()=>{const session=nativeNetwork.sessions.fromPartition(this.partition);const settings=await session.loginOptions();await request('login.create',{id:this.id,partition:this.partition,title:options.title,width:options.width,height:options.height,...settings});})();
    this.webContents=new EventEmitter();
    this.webContents.setWindowOpenHandler=()=>{};
    this.webContents.getURL=()=>this.url;
    this.webContents.executeJavaScript=async script=>{await this.created;return request('login.script',{id:this.id,script});};
  }
  static getAllWindows(){return [...windows.values()];}
  async loadURL(url){await this.created;this.url=url;const identity=await request('login.load',{id:this.id,url});await nativeNetwork.sessions.fromPartition(this.partition).rememberBrowserIdentity(identity);return identity;}
  isDestroyed(){return this.destroyed;}
  async retain(){await nativeNetwork.sessions.fromPartition(this.partition).retainBrowserSession();await request('login.retain',{id:this.id});this.destroyed=true;windows.delete(this.id);}
  close(){if(!this.destroyed)void request('login.close',{id:this.id}).catch(()=>{});}
}

const credentialVault={
  isEncryptionAvailable:()=>Boolean(configuration?.vaultKey),
  getSelectedStorageBackend:()=>configuration?.vaultKey?'os-keychain':'unavailable',
  encryptString(value){
    const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(configuration.vaultKey,'base64'),nonce);
    const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    return Buffer.concat([Buffer.from('CP01'),nonce,cipher.getAuthTag(),encrypted]);
  },
  decryptString(value){
    if(value.subarray(0,4).toString()!=='CP01')throw Error('Importa novamente as credenciais antigas para a versão Tauri');
    const cipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(configuration.vaultKey,'base64'),value.subarray(4,16));
    cipher.setAuthTag(value.subarray(16,32));return Buffer.concat([cipher.update(value.subarray(32)),cipher.final()]).toString('utf8');
  },
};

async function receive(message){
  if(message.type==='initialize') {
    if(configuration)throw Error('Inicialização duplicada');
    configuration=message.configuration;
    if(configuration.browserExecutable)chromium=require('./chromiumBridge.cjs').createChromiumBridge({executable:configuration.browserExecutable,dataDirectory:configuration.dataDirectory,onEvent:event=>{void receive(event);}});
    nativeNetwork=require('./nativeNetwork.cjs').createNetwork({configuration,nativeRequest:request,onSessionChanged:(partition,session)=>send({type:'event',payload:{type:'account-session',partition,session}})});readyResolve();return;
  }
  if(message.type==='native-result'){
    const task=pending.get(message.id);if(!task)return;
    pending.delete(message.id);task.signal?.removeEventListener('abort',task.abort);
    message.error?task.reject(Error(message.error)):task.resolve(message.result);return;
  }
  if(message.type==='native-event'){
    if(message.kind==='session-cookies'){void nativeNetwork.sessions.fromPartition(message.partition).syncBrowserCookies().catch(()=>{});return;}
    if(message.kind==='socket'){nativeEvents.emit('socket',message);return;}
    const window=windows.get(message.id);if(!window)return;
    if(message.url)window.url=message.url;
    if(message.event==='closed'){window.destroyed=true;windows.delete(message.id);window.emit('closed');}
    else window.webContents.emit(message.event);return;
  }
  if(message.type==='shutdown'){lifecycle.quit();return;}
  if(message.type==='command') {
    try{
      const handler=handlers.get(message.channel);if(!handler)throw Error('Comando Tauri desconhecido: '+message.channel);
      const result=await handler({sender:mainSurface.webContents},...(message.args||[]));
      send({type:'result',id:message.id,result:result??null});
    }catch(error){send({type:'result',id:message.id,error:String(error.message||error)});}
  }
}
function announceReady(){send({type:'ready',channels:[...handlers.keys()].sort()});}
function fatal(error){send({type:'fatal',error:String(error.message||error)});process.exitCode=1;}

module.exports={receive,send,request,announceReady,fatal,mainSurface,lifecycle,commands,NativeLoginWindow,sessions:{fromPartition:partition=>nativeNetwork.sessions.fromPartition(partition)},credentialVault,
  network:{get WebSocket(){return nativeNetwork.WebSocket;}},
  desktop:{openExternal:url=>request('desktop.open',{url})},
  fileDialogs:{showOpenDialog:(_parent,options)=>request('dialog.open',{options}),showSaveDialog:(_parent,options)=>request('dialog.save',{options})},
};
