'use strict';

// Native Qt transport. There is no Electron runtime or web renderer here.
const {EventEmitter} = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');
const handlers = new Map(), pending = new Map(), windows = new Map();
let configuration, readyResolve, sequence = 0, quitting = false;
const boot = new Promise(resolve => { readyResolve = resolve; });
const nativeEvents = new EventEmitter();

function send(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function request(method, args = {}, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || Error('Operação cancelada'));
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
  if (!configuration) throw Error('O Qt ainda não iniciou a aplicação');
  return name === 'userData' ? configuration.dataDirectory : configuration.appDataDirectory;
};
lifecycle.setPath = () => {};
lifecycle.getAppPath = () => path.resolve(__dirname,'..');
lifecycle.requestSingleInstanceLock = () => true; // Enforced by the Qt host before spawn.
lifecycle.relaunch = () => send({type:'relaunch'});
lifecycle.quit = () => {
  if (quitting) return;
  let prevented = false;
  lifecycle.emit('before-quit',{preventDefault(){prevented=true;}});
  if (!prevented) { quitting=true; send({type:'closed'}); process.exitCode=0; setTimeout(()=>process.exit(0),25); }
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
    this.created=request('login.create',{id:this.id,partition:this.partition,title:options.title,width:options.width,height:options.height});
    this.webContents=new EventEmitter();
    this.webContents.setWindowOpenHandler=()=>{};
    this.webContents.getURL=()=>this.url;
    this.webContents.executeJavaScript=async script=>{await this.created;return request('login.script',{id:this.id,script});};
  }
  static getAllWindows(){return [...windows.values()];}
  async loadURL(url){await this.created;this.url=url;return request('login.load',{id:this.id,url});}
  isDestroyed(){return this.destroyed;}
  close(){if(!this.destroyed)void request('login.close',{id:this.id}).catch(()=>{});}
}

const partitions=new Map();
function partitionSession(partition) {
  if (!partitions.has(partition)) {
    const call=(method,args={},signal)=>request(method,{partition,...args},signal);
    partitions.set(partition,{
      partition,
      async fetch(url,init={}) {
        const headers=Object.fromEntries(new Headers(init.headers||{}));
        const result=await call('session.fetch',{url,method:init.method||'GET',headers,body:init.body??null,credentials:init.credentials||'include',redirect:init.redirect||'follow'},init.signal);
        return new Response([204,205,304].includes(result.status)?null:Buffer.from(result.body,'base64'),{status:result.status,statusText:result.statusText||'',headers:result.headers});
      },
      setProxy:options=>call('session.proxy',{options}),
      closeAllConnections:()=>call('session.closeConnections'),
      clearStorageData:()=>call('session.clear'),
      clearCache:()=>call('session.clearCache'),
      cookies:{
        get:filter=>call('cookies.get',{filter}),
        set:cookie=>call('cookies.set',{cookie}),
        remove:(url,name)=>call('cookies.remove',{url,name}),
        flushStore:()=>call('cookies.flush'),
      },
    });
  }
  return partitions.get(partition);
}
const sessions={fromPartition:partitionSession};

class NativeWebSocket {
  static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
  constructor(url,options={}){
    this.id='socket-'+(++sequence);this.readyState=0;this.binaryType='nodebuffer';this.listeners=new EventEmitter();
    this.listener=message=>{
      if(message.id!==this.id)return;
      if(message.event==='open')this.readyState=1;
      if(message.event==='close')this.readyState=3;
      let data=message.data;
      if(message.binary){const bytes=Buffer.from(data,'base64');data=this.binaryType==='arraybuffer'?bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength):bytes;}
      const event={type:message.event,data,code:message.code||1000,reason:message.reason||'',target:this};
      this['on'+message.event]?.(event);this.listeners.emit(message.event,event);
      if(message.event==='close')nativeEvents.removeListener('socket',this.listener);
    };
    nativeEvents.on('socket',this.listener);
    request('socket.open',{id:this.id,url,partition:(options.session||options.sessions)?.partition,origin:options.origin,protocols:options.protocols||[]})
      .catch(error=>{this.onerror?.({error,target:this});this.close();});
  }
  addEventListener(name,fn){this.listeners.on(name,fn);}
  removeEventListener(name,fn){this.listeners.removeListener(name,fn);}
  send(data){if(this.readyState!==1)throw Error('Socket fechado');const binary=typeof data!=='string';send({type:'native-request',id:'socket-write-'+(++sequence),method:'socket.send',args:{id:this.id,data:binary?Buffer.from(data).toString('base64'):data,binary}});}
  close(){if(this.readyState>=2)return;this.readyState=2;void request('socket.close',{id:this.id}).catch(()=>{});}
}

const credentialVault={
  isEncryptionAvailable:()=>Boolean(configuration?.vaultKey),
  getSelectedStorageBackend:()=>configuration?.vaultKey?'os-keychain':'unavailable',
  encryptString(value){
    const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(configuration.vaultKey,'base64'),nonce);
    const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    return Buffer.concat([Buffer.from('QT01'),nonce,cipher.getAuthTag(),encrypted]);
  },
  decryptString(value){
    if(value.subarray(0,4).toString()!=='QT01')throw Error('Importa novamente as credenciais antigas para a versão Qt');
    const cipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(configuration.vaultKey,'base64'),value.subarray(4,16));
    cipher.setAuthTag(value.subarray(16,32));return Buffer.concat([cipher.update(value.subarray(32)),cipher.final()]).toString('utf8');
  },
};

async function receive(message){
  if(message.type==='initialize') {
    if(configuration)throw Error('Inicialização duplicada');
    configuration=message.configuration;readyResolve();return;
  }
  if(message.type==='native-result'){
    const task=pending.get(message.id);if(!task)return;
    pending.delete(message.id);task.signal?.removeEventListener('abort',task.abort);
    message.error?task.reject(Error(message.error)):task.resolve(message.result);return;
  }
  if(message.type==='native-event'){
    if(message.kind==='socket'){nativeEvents.emit('socket',message);return;}
    const window=windows.get(message.id);if(!window)return;
    if(message.url)window.url=message.url;
    if(message.event==='closed'){window.destroyed=true;windows.delete(message.id);window.emit('closed');}
    else window.webContents.emit(message.event);return;
  }
  if(message.type==='shutdown'){lifecycle.quit();return;}
  if(message.type==='command') {
    try{
      const handler=handlers.get(message.channel);if(!handler)throw Error('Comando Qt desconhecido: '+message.channel);
      const result=await handler({sender:mainSurface.webContents},...(message.args||[]));
      send({type:'result',id:message.id,result:result??null});
    }catch(error){send({type:'result',id:message.id,error:String(error.message||error)});}
  }
}
function announceReady(){send({type:'ready',channels:[...handlers.keys()].sort()});}
function fatal(error){send({type:'fatal',error:String(error.message||error)});process.exitCode=1;}

module.exports={receive,send,request,announceReady,fatal,mainSurface,lifecycle,commands,NativeLoginWindow,sessions,credentialVault,
  network:{WebSocket:NativeWebSocket},
  desktop:{openExternal:url=>request('desktop.open',{url})},
  fileDialogs:{showOpenDialog:(_parent,options)=>request('dialog.open',{options}),showSaveDialog:(_parent,options)=>request('dialog.save',{options})},
};
