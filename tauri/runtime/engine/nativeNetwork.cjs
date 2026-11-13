'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {CookieJar, Cookie} = require('tough-cookie');
const {fetch: requestFetch, Agent, ProxyAgent} = require('undici');
const WebSocket = require('ws');
const {SocksClient} = require('socks');
const tls = require('node:tls');
const {HttpsProxyAgent} = require('https-proxy-agent');
const {SocksProxyAgent} = require('socks-proxy-agent');
const {isSessionCookie,describeSession,cookieFingerprint}=require('./sessionState.cjs');
const ORIGIN = 'https://case-clicker.com';

function allowed(value, websocket=false, testOrigins=[]) {
  const url = new URL(value);
  const valid = url.protocol === (websocket ? 'wss:' : 'https:') && (websocket ? ['case-clicker.com','ws.case-clicker.com'] : ['case-clicker.com']).includes(url.hostname) && (!url.port || url.port === '443');
  if ((!valid && !testOrigins.includes(url.origin)) || url.username || url.password) throw Error('A ligação não pertence ao site do jogo.');
  return url;
}
function proxyAgent(value){
  if(!value.startsWith('socks5:'))return new ProxyAgent(value);
  const proxy=new URL(value);
  return new Agent({connect(options,callback){
    SocksClient.createConnection({proxy:{host:proxy.hostname,port:Number(proxy.port),type:5},command:'connect',destination:{host:options.hostname,port:Number(options.port)||443},timeout:30000}).then(({socket})=>{
      if(options.protocol==='https:'){
        const secure=tls.connect({socket,servername:options.servername||options.hostname});
        let completed=false;
        secure.once('secureConnect',()=>{completed=true;callback(null,secure);});
        secure.once('error',error=>{if(!completed)callback(error,null);});
      }else callback(null,socket);
    }).catch(error=>callback(error,null));
  }});
}
function createNetwork({configuration, nativeRequest, testOrigins=[],onSessionChanged=()=>{}}) {
  const sessions = new Map();
  const directory = path.join(configuration.dataDirectory, 'sessions');
  const key = Buffer.from(configuration.vaultKey, 'base64');
  function session(partition) {
    if(typeof partition !== 'string' || !partition || partition.length > 200) throw Error('Sessão de conta inválida.');
    if(sessions.has(partition)) return sessions.get(partition);
    const filename = path.join(directory, crypto.createHash('sha256').update(partition).digest('hex')+'.session');
    let jar = new CookieJar(), agent = new Agent(), proxy = null, userAgent = null;
    let saveTail = Promise.resolve(), cookieRevision = 0, browserSession = false, requiresLogin = false, preparingBrowser;
    let requiresVerification=false,verifiedAt=0,lastRefreshedAt=0,serverExpiresAt=0,lastPublished='',migrated=false,validationPending=false;
    const describe=()=>describeSession(jar.getCookiesSync(ORIGIN),{requiresLogin,requiresVerification,browserSession,verifiedAt,lastRefreshedAt,serverExpiresAt,validationPending});
    const loaded = (async()=>{
      try {
        const value = await fs.readFile(filename);
        if(value.subarray(0,4).toString() !== 'CP01') throw Error('Sessão local inválida.');
        const cipher = crypto.createDecipheriv('aes-256-gcm',key,value.subarray(4,16));
        cipher.setAuthTag(value.subarray(16,32));
        const state = JSON.parse(Buffer.concat([cipher.update(value.subarray(32)),cipher.final()]));
        jar = CookieJar.deserializeSync(state.cookies); userAgent = state.nativeIdentity===true?state.userAgent:null;browserSession=state.browserSession===true;requiresLogin=state.requiresLogin===true;
        requiresVerification=state.requiresVerification===true;verifiedAt=state.verifiedAt||0;lastRefreshedAt=state.lastRefreshedAt||Date.now();serverExpiresAt=state.serverExpiresAt||0;migrated=state.schemaVersion!==2;validationPending=state.validationPending===true;
        if(migrated&&requiresLogin&&jar.getCookiesSync(ORIGIN).some(cookie=>isSessionCookie(cookie.key))){requiresLogin=false;requiresVerification=true;}
      } catch(error) { if(error.code !== 'ENOENT') throw Error('Não foi possível desbloquear esta sessão.'); }
    })();
    // Keep a corrupt session local to that account, without an unhandled rejection.
    loaded.catch(()=>{});
    async function persist() {
      await loaded;
      saveTail = saveTail.catch(()=>{}).then(async()=>{
        const nonce=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
        const data=Buffer.concat([cipher.update(JSON.stringify({schemaVersion:2,cookies:jar.serializeSync(),userAgent,nativeIdentity:Boolean(userAgent),browserSession,requiresLogin,requiresVerification,verifiedAt,lastRefreshedAt,serverExpiresAt,validationPending})),cipher.final()]);
        await fs.mkdir(directory,{recursive:true,mode:0o700});
        const temporary=filename+'.'+crypto.randomUUID()+'.tmp';
        await fs.writeFile(temporary,Buffer.concat([Buffer.from('CP01'),nonce,cipher.getAuthTag(),data]),{mode:0o600});
        await fs.rename(temporary,filename);
        const status=describe(),signature=JSON.stringify(status);if(signature!==lastPublished){lastPublished=signature;onSessionChanged(partition,status);}
      });
      return saveTail;
    }
    async function setCookie(value) {
      await loaded;
      const url=allowed(value.url || ORIGIN,false,testOrigins);
      const domain=value.domain || url.hostname;
      if(!['case-clicker.com','.case-clicker.com'].includes(domain) && !testOrigins.includes(url.origin)) throw Error('Domínio de cookie inválido.');
      const cookie=new Cookie({key:value.name,value:value.value,domain:domain.replace(/^\./,''),hostOnly:!value.domain||value.name.startsWith('__Host-'),path:value.path||'/',secure:value.secure??true,httpOnly:value.httpOnly??false,...(Number.isFinite(value.expirationDate)?{expires:new Date(value.expirationDate*1000)}:{})});
      jar.setCookieSync(cookie,url.href);cookieRevision++;
    }
    async function importBrowserCookies() {
      await loaded;
      const revision=cookieRevision, cookies=await nativeRequest('login.cookies',{partition});
      if(Array.isArray(cookies) && revision===cookieRevision&&cookieFingerprint(cookies)!==cookieFingerprint(jar.getCookiesSync(ORIGIN))) {
        const before=cookieFingerprint(jar.getCookiesSync(ORIGIN).filter(cookie=>isSessionCookie(cookie.key)));
        jar.removeAllCookiesSync();cookieRevision++;for(const cookie of cookies)await setCookie({...cookie,url:ORIGIN});
        const tokens=jar.getCookiesSync(ORIGIN).filter(cookie=>isSessionCookie(cookie.key));
        if(tokens.length&&cookieFingerprint(tokens)!==before){requiresLogin=false;requiresVerification=false;serverExpiresAt=0;browserSession=true;}
        await persist();
      }
    }
    const result={
      partition,
      get proxy(){return proxy;},
      async status(){await loaded;if(migrated){migrated=false;await persist();}return describe();},
      syncBrowserCookies:importBrowserCookies,
      async markValidationPending(){await loaded;validationPending=describe().hasToken;await persist();return describe();},
      async markAuthenticated({expiresAt}={}){await loaded;validationPending=false;browserSession=true;requiresLogin=false;requiresVerification=false;verifiedAt=Date.now();lastRefreshedAt=Date.now();if(expiresAt)serverExpiresAt=Number(expiresAt)||Date.parse(expiresAt)||0;await persist();return describe();},
      async markNeedsLogin(){await loaded;validationPending=false;requiresLogin=true;await persist();return describe();},
      async restoreSession(){await loaded;await result.prepareBrowser(true);await importBrowserCookies();if(describe().hasToken&&!browserSession){browserSession=true;await persist();}return describe();},
      async loginOptions(){await loaded;return {proxy,userAgent,cookies:await result.cookies.get({url:ORIGIN})};},
      async rememberBrowserIdentity(identity){
        await loaded;const value=identity?.userAgent;
        if(typeof value!=='string'||!value||value.length>1024||/[\r\n]/.test(value))return;
        if(userAgent!==value){userAgent=value;await persist();}
      },
      async retainBrowserSession(){await importBrowserCookies();await result.markAuthenticated();},
      async prepareBrowser(force=false){
        await loaded;if(!browserSession&&!force)return;
        if(!preparingBrowser)preparingBrowser=(async()=>{const identity=await nativeRequest('session.prepare',{partition,...await result.loginOptions()});await result.rememberBrowserIdentity(identity);})().finally(()=>{preparingBrowser=null;});
        await preparingBrowser;
      },
      async fetch(url,init={}){
        await loaded;
        allowed(url,false,testOrigins);
        if(init.signal?.aborted) throw init.signal.reason;
        const methodName=String(init.method||'GET').toUpperCase();
        if(new URL(url).origin===ORIGIN){
          await result.prepareBrowser();
          const body=init.body==null?undefined:Buffer.from(typeof init.body==='string'||Buffer.isBuffer(init.body)?init.body:String(init.body)).toString('base64');
          const browser=await nativeRequest('login.fetch',{partition,url,method:methodName,headers:Object.fromEntries(new Headers(init.headers||{})),credentials:init.credentials||'include',body},init.signal);
          if(browser){
            if(init.credentials!=='omit'){
              if(browser.status===401)requiresLogin=true;
              if(browser.status===403&&browser.headers?.['cf-mitigated']==='challenge')requiresVerification=true;
              if(browser.status===401||requiresVerification)await persist();
            }
            await importBrowserCookies();
            return new Response([204,205,304].includes(browser.status)||methodName==='HEAD'?null:Buffer.from(browser.body,'base64'),{status:browser.status,statusText:browser.statusText||'',headers:browser.headers});
          }
          if(browserSession)throw Error('A sessão do navegador está indisponível. Entra novamente na conta.');
        }
        if(requiresLogin && init.credentials!=='omit')throw Object.assign(Error('Esta conta precisa de login. Conclui a verificação do site na janela de entrada.'),{status:401,code:'AUTHENTICATION_REQUIRED'});
        await importBrowserCookies();
        let current=new URL(url), method=methodName, body=init.body;
        for(let redirect=0;redirect<=10;redirect++){
          allowed(current.href,false,testOrigins);
          const headers=new Headers(init.headers||{});
          headers.delete('cookie');headers.delete('host');
          if(init.credentials !== 'omit') { const cookies=jar.getCookieStringSync(current.href); if(cookies) headers.set('cookie',cookies); }
          if(userAgent&&!headers.has('user-agent')) headers.set('user-agent',userAgent);
          const response=await requestFetch(current,{...init,method,body,headers,redirect:'manual',dispatcher:agent,signal:init.signal||AbortSignal.timeout(30000)});
          if(init.credentials!=='omit' && (response.status===401 || response.status===403&&response.headers.get('cf-mitigated')==='challenge')){requiresLogin=true;await persist();}
          if(init.credentials !== 'omit') { const updates=response.headers.getSetCookie(); for(const cookie of updates) {jar.setCookieSync(cookie,current.href,{ignoreError:true});cookieRevision++;} if(updates.length){await persist();await nativeRequest('login.setCookies',{partition,cookies:await result.cookies.get({url:ORIGIN})});} }
          if(![301,302,303,307,308].includes(response.status) || !response.headers.get('location') || init.redirect === 'manual') return response;
          await response.body?.cancel();
          if(init.redirect === 'error' || !['GET','HEAD'].includes(method)) throw Error('O servidor tentou redirecionar o pedido. Verifica o estado antes de repetir.');
          const next=new URL(response.headers.get('location'),current);
          allowed(next.href,false,testOrigins);
          if(response.status===303 || [301,302].includes(response.status)&&method==='POST'){method='GET';body=undefined;}
          current=next;
        }
        throw Error('Demasiados redirecionamentos.');
      },
      async setProxy(options){
        await loaded;
        const value=options.mode==='fixed_servers'?options.proxyRules:null;
        if(value){const url=new URL(value);if(!['http:','socks5:'].includes(url.protocol)||url.username||url.password||!url.port)throw Error('Configuração de proxy inválida.');}
        if(value!==proxy)await nativeRequest('session.invalidate',{partition});
        const previous=agent; proxy=value;agent=proxy?proxyAgent(proxy):new Agent();await previous.close();
      },
      async closeAllConnections(){await loaded;await agent.close();agent=proxy?proxyAgent(proxy):new Agent();},
      async clearStorageData(){await loaded;jar.removeAllCookiesSync();cookieRevision++;browserSession=false;requiresLogin=false;requiresVerification=false;verifiedAt=0;lastRefreshedAt=0;serverExpiresAt=0;validationPending=false;await nativeRequest('login.clear',{partition});await persist();},
      async clearCache(){},
      async dispose(){try{await saveTail;}finally{await agent.destroy();}},
      cookies:{
        async get(filter={}){await loaded;return jar.getCookiesSync(allowed(filter.url||ORIGIN,false,testOrigins).href).filter(cookie=>!filter.name||cookie.key===filter.name).map(cookie=>({name:cookie.key,value:cookie.value,domain:cookie.domain,path:cookie.path,secure:cookie.secure,httpOnly:cookie.httpOnly,...(cookie.expires instanceof Date?{expirationDate:cookie.expires.getTime()/1000}:{})}));},
        async set(cookie){await setCookie(cookie);await persist();await nativeRequest('login.setCookies',{partition,cookies:await result.cookies.get({url:ORIGIN})});},
        async remove(url,name){await loaded;for(const cookie of jar.getCookiesSync(allowed(url,false,testOrigins).href))if(cookie.key===name){jar.removeCookieSync(cookie.domain,cookie.path,name);cookieRevision++;}await persist();await nativeRequest('login.setCookies',{partition,cookies:await result.cookies.get({url:ORIGIN})});},
        flushStore:persist,
      },
      async socket(url,options,signal){await loaded;if(signal?.aborted)throw signal.reason;allowed(url,true,testOrigins);const headers=userAgent?{'User-Agent':userAgent}:{};const cookies=jar.getCookieStringSync(ORIGIN);if(cookies)headers.Cookie=cookies;const agent=proxy?(proxy.startsWith('socks5:')?new SocksProxyAgent(proxy):new HttpsProxyAgent(proxy)):undefined;return new WebSocket(url,options.protocols||[],{headers,origin:ORIGIN,agent,handshakeTimeout:30000});},
    };
    sessions.set(partition,result);return result;
  }
  class SessionWebSocket {
    static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
    constructor(url,options={}){
      const {EventEmitter}=require('node:events');
      this.readyState=0;this.binaryType='nodebuffer';this.events=new EventEmitter();
      this.socket=null;this.cancelled=false;this.controller=new AbortController();this.closed=false;
      const deliver=(type,event)=>{if(type==='close'){if(this.closed)return;this.closed=true;this.readyState=3;}this['on'+type]?.(event);if(type!=='error'||this.events.listenerCount('error'))this.events.emit(type,event);};
      this.deliver=deliver;
      session((options.session||options.sessions)?.partition).socket(url,options,this.controller.signal).then(socket=>{
        this.socket=socket;if(this.cancelled){socket.on('error',()=>{});socket.terminate();deliver('close',{target:this,code:1000,reason:''});return;}
        socket.on('open',()=>{if(this.cancelled)return;this.readyState=1;deliver('open',{target:this});});
        socket.on('message',(data,binary)=>{const bytes=Buffer.from(data);deliver('message',{target:this,data:binary?(this.binaryType==='arraybuffer'?bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength):bytes):bytes.toString()});});
        socket.on('close',(code,reason)=>{this.readyState=3;deliver('close',{target:this,code,reason:reason.toString()});});
        socket.on('error',()=>{if(!this.cancelled)deliver('error',{target:this,message:'Não foi possível ligar ao jogo.'});});
      }).catch(()=>{if(this.cancelled){deliver('close',{target:this,code:1000,reason:''});return;}this.readyState=3;deliver('error',{target:this,message:'Não foi possível ligar ao jogo.'});deliver('close',{target:this,code:1006,reason:''});});
    }
    addEventListener(name,fn){this.events.on(name,fn);}
    removeEventListener(name,fn){this.events.off(name,fn);}
    send(data){if(this.readyState!==1)throw Error('Socket fechado');this.socket.send(data);}
    close(){if(this.readyState>=2)return;this.cancelled=true;this.controller.abort();this.readyState=2;if(this.socket){if(this.socket.readyState===WebSocket.CONNECTING)this.socket.terminate();else this.socket.close();}else queueMicrotask(()=>this.deliver('close',{target:this,code:1000,reason:''}));}
  }
  return {sessions:{fromPartition:session},WebSocket:SessionWebSocket,close:async()=>Promise.all([...sessions.values()].map(ses=>ses.dispose()))};
}
module.exports={createNetwork,allowed};
