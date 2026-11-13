const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createNetwork,allowed}=require('../engine/nativeNetwork.cjs');
async function fixture(t){
 let hits=[];
 const server=http.createServer((req,res)=>{hits.push(req.url);if(req.url==='/cookie')res.setHeader('Set-Cookie','session=alpha; Path=/; HttpOnly');if(req.url==='/redirect'){res.writeHead(302,{Location:'https://example.invalid/private'});res.end();return;}if(req.url==='/slow'){req.on('close',()=>{});return;}res.end(JSON.stringify({cookie:req.headers.cookie||''}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port, data=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-network-'));
 const config={dataDirectory:data,vaultKey:crypto.randomBytes(32).toString('base64')};
 const network=createNetwork({configuration:config,nativeRequest:async()=>null,testOrigins:[origin]});
 t.after(async()=>{await network.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(data,{recursive:true,force:true});});
 return {network,origin,data,config,hits};
}
test('HTTP sessions isolate cookies and encrypt persisted storage',async t=>{
 const {network,origin,data}=await fixture(t),a=network.sessions.fromPartition('a'),b=network.sessions.fromPartition('b');
 await (await a.fetch(origin+'/cookie')).text();assert.equal((await (await a.fetch(origin+'/echo')).json()).cookie,'session=alpha');assert.equal((await (await b.fetch(origin+'/echo')).json()).cookie,'');
 for(const file of await fs.readdir(path.join(data,'sessions'))){const bytes=await fs.readFile(path.join(data,'sessions',file));assert(!bytes.includes(Buffer.from('session=alpha')));assert(!bytes.includes(Buffer.from('"value":"alpha"')));}
});
test('redirect validation happens before following an external origin',async t=>{const {network,origin,hits}=await fixture(t);await assert.rejects(network.sessions.fromPartition('a').fetch(origin+'/redirect'),/não pertence/);assert.deepEqual(hits,['/redirect']);});
test('cancellation aborts without retrying the request',async t=>{const {network,origin,hits}=await fixture(t);const controller=new AbortController();const work=network.sessions.fromPartition('a').fetch(origin+'/slow',{signal:controller.signal});setTimeout(()=>controller.abort(),80);await assert.rejects(work);assert.equal(hits.filter(x=>x==='/slow').length,1);});
test('credential-free probes never attach session cookies',async t=>{const {network,origin}=await fixture(t);const session=network.sessions.fromPartition('a');await (await session.fetch(origin+'/cookie')).text();assert.equal((await (await session.fetch(origin+'/echo',{credentials:'omit'})).json()).cookie,'');});
test('origin policy rejects remote URLs, credentials and insecure requests',()=>{for(const url of ['https://evil.example/api','http://case-clicker.com/','https://case-clicker.com.evil.example/','https://user:pass@case-clicker.com/'])assert.throws(()=>allowed(url));assert.equal(allowed('https://case-clicker.com/api/me').host,'case-clicker.com');});

test('WebSocket failures with property callbacks do not become unhandled EventEmitter errors',async t=>{
 const {network,origin}=await fixture(t);const url=origin.replace('http:','ws:');
 // Validation errors are delivered by the browser-style callback API.
 const socket=new network.WebSocket(url,{session:{partition:'socket-a'}});
 const result=await new Promise(resolve=>{socket.onerror=()=>{};socket.onclose=resolve;});
 assert.equal(result.code,1006);assert.equal(socket.readyState,3);
});
test('closing a connecting WebSocket emits a single close and no error',async t=>{
 const {network,origin}=await fixture(t);const socket=new network.WebSocket(origin.replace('http:','ws:'),{session:{partition:'socket-a'}});
 let errors=0,closed=0;socket.onerror=()=>errors++;socket.onclose=()=>closed++;
 socket.close();await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(errors,0);assert.equal(closed,1);assert.equal(socket.readyState,3);
});
test('an expired cookie with expirationDate zero is removed',async t=>{
 const {network}=await fixture(t);const session=network.sessions.fromPartition('a');
 await session.cookies.set({name:'auth',value:'old',domain:'case-clicker.com',path:'/',secure:true});
 await session.cookies.set({name:'auth',value:'expired',domain:'case-clicker.com',path:'/',secure:true,expirationDate:0});
 assert.deepEqual(await session.cookies.get({}),[]);
});
test('a failed persistence write can recover on the next save',async t=>{
 const {network,data}=await fixture(t);const session=network.sessions.fromPartition('a');
 await fs.writeFile(path.join(data,'sessions'),'blocked');
 await assert.rejects(session.cookies.set({name:'auth',value:'one',domain:'case-clicker.com',secure:true}));
 await fs.unlink(path.join(data,'sessions'));
 await session.cookies.set({name:'auth',value:'two',domain:'case-clicker.com',secure:true});
 assert.equal((await session.cookies.get({}))[0].value,'two');
});
test('a mutation redirect does not replay the request',async t=>{
 let writes=0;
 const server=http.createServer((req,res)=>{writes++;res.writeHead(307,{Location:'/again'});res.end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-write-'));const network=createNetwork({configuration:{dataDirectory:data,vaultKey:crypto.randomBytes(32).toString('base64')},nativeRequest:async()=>null,testOrigins:[origin]});
 t.after(async()=>{await network.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(data,{recursive:true,force:true});});
 await assert.rejects(network.sessions.fromPartition('a').fetch(origin+'/write',{method:'POST',body:'{}'}),/redirecionar/);assert.equal(writes,1);
});
test('login reads use the browser response without a second HTTP request',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-browser-'));let requests=0;
 const network=createNetwork({configuration:{dataDirectory:data,vaultKey:crypto.randomBytes(32).toString('base64')},nativeRequest:async(method)=>{if(method==='login.fetch'){requests++;return {status:200,headers:{'content-type':'application/json'},body:Buffer.from('{"connected":true}').toString('base64')};}return null;}});
 t.after(async()=>{await network.close();await fs.rm(data,{recursive:true,force:true});});
 const response=await network.sessions.fromPartition('a').fetch('https://case-clicker.com/api/me');assert.deepEqual(await response.json(),{connected:true});assert.equal(requests,1);
});

test('encrypted session cookies survive restart without crossing accounts',async t=>{
 const {network,origin,config}=await fixture(t);await (await network.sessions.fromPartition('a').fetch(origin+'/cookie')).text();
 const restarted=createNetwork({configuration:config,nativeRequest:async()=>null,testOrigins:[origin]});t.after(()=>restarted.close());
 assert.equal((await (await restarted.sessions.fromPartition('a').fetch(origin+'/echo')).json()).cookie,'session=alpha');
 assert.equal((await (await restarted.sessions.fromPartition('b').fetch(origin+'/echo')).json()).cookie,'');
});
test('WebSocket carries text and binary data with its own account cookies',async t=>{
 const {WebSocketServer}=require('ws');const server=http.createServer();const sockets=new WebSocketServer({server});let observedCookie;
 sockets.on('connection',(socket,request)=>{observedCookie=request.headers.cookie;socket.on('message',(data,binary)=>socket.send(data,{binary}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='ws://127.0.0.1:'+server.address().port;
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-socket-'));const network=createNetwork({configuration:{dataDirectory:data,vaultKey:crypto.randomBytes(32).toString('base64')},nativeRequest:async()=>null,testOrigins:[origin]});
 t.after(async()=>{for(const socket of sockets.clients)socket.terminate();await network.close();await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>server.close(resolve));await fs.rm(data,{recursive:true,force:true});});
 await network.sessions.fromPartition('a').cookies.set({name:'session',value:'alpha',domain:'case-clicker.com',secure:true});
 const socket=new network.WebSocket(origin,{session:{partition:'a'}});await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});assert.equal(observedCookie,'session=alpha');
 const read=()=>new Promise(resolve=>{socket.onmessage=event=>resolve(event.data);});let response=read();socket.send('hello');assert.equal(await response,'hello');
 socket.binaryType='arraybuffer';response=read();socket.send(Buffer.from([0,255,42]));assert.deepEqual([...new Uint8Array(await response)],[0,255,42]);
 await new Promise(resolve=>{socket.onclose=resolve;socket.close();});
});
test('closing a WebSocket during the network handshake is a normal cancellation',async t=>{
 const server=http.createServer();let upgraded,rawSocket;const handshake=new Promise(resolve=>{upgraded=resolve;});server.on('upgrade',(_request,socket)=>{rawSocket=socket;upgraded();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='ws://127.0.0.1:'+server.address().port;
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-handshake-'));const network=createNetwork({configuration:{dataDirectory:data,vaultKey:crypto.randomBytes(32).toString('base64')},nativeRequest:async()=>null,testOrigins:[origin]});
 t.after(async()=>{rawSocket?.destroy();await network.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(data,{recursive:true,force:true});});
 const socket=new network.WebSocket(origin,{session:{partition:'a'}});let errors=0;socket.onerror=()=>errors++;
 await handshake;await new Promise(resolve=>{socket.onclose=resolve;socket.close();});assert.equal(errors,0);assert.equal(socket.readyState,3);
});

test('authenticated browser sessions are restored once for concurrent reads after restart',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-restore-'));const config={dataDirectory:data,vaultKey:crypto.randomBytes(32).toString('base64')};
 const initial=createNetwork({configuration:config,nativeRequest:async()=>null});await initial.sessions.fromPartition('a').retainBrowserSession();await initial.close();let prepared=0;
 const restored=createNetwork({configuration:config,nativeRequest:async(method)=>{if(method==='session.prepare'){prepared++;await new Promise(resolve=>setTimeout(resolve,15));return true;}if(method==='login.fetch')return {status:200,body:Buffer.from('{}').toString('base64'),headers:{}};return null;}});
 t.after(async()=>{await restored.close();await fs.rm(data,{recursive:true,force:true});});const account=restored.sessions.fromPartition('a');
 await Promise.all([account.fetch('https://case-clicker.com/api/me'),account.fetch('https://case-clicker.com/api/cases')]);assert.equal(prepared,1);
});
test('browser writes retain the exact method and body and never fall back after a transport failure',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-browser-write-'));let writes=0;
 const network=createNetwork({configuration:{dataDirectory:data,vaultKey:crypto.randomBytes(32).toString('base64')},nativeRequest:async(method,args)=>{if(method==='login.fetch'){writes++;assert.equal(args.method,'POST');assert.equal(Buffer.from(args.body,'base64').toString(),' {"value":"á"} ');throw Error('uncertain outcome');}return null;}});
 t.after(async()=>{await network.close();await fs.rm(data,{recursive:true,force:true});});
 await assert.rejects(network.sessions.fromPartition('a').fetch('https://case-clicker.com/api/example',{method:'POST',body:' {"value":"á"} '}),/uncertain outcome/);assert.equal(writes,1);
});
test('a saved browser session never silently changes transport when its window is unavailable',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-browser-unavailable-'));let attempts=0;
 const network=createNetwork({configuration:{dataDirectory:data,vaultKey:crypto.randomBytes(32).toString('base64')},nativeRequest:async(method)=>{if(method==='login.fetch')attempts++;return null;}});
 t.after(async()=>{await network.close();await fs.rm(data,{recursive:true,force:true});});const account=network.sessions.fromPartition('a');await account.retainBrowserSession();
 await assert.rejects(account.fetch('https://case-clicker.com/api/me'),/indisponível/);assert.equal(attempts,1);
});

test('accounts requiring authentication do not repeatedly send failed HTTP reads',async t=>{
 let hits=0;const server=http.createServer((_req,res)=>{hits++;res.writeHead(403,{'cf-mitigated':'challenge'});res.end('verification');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'casepilot-login-required-')),config={dataDirectory:data,vaultKey:crypto.randomBytes(32).toString('base64')};
 const network=createNetwork({configuration:config,nativeRequest:async()=>null,testOrigins:[origin]});let restarted;
 t.after(async()=>{await network.close();await restarted?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(data,{recursive:true,force:true});});
 const account=network.sessions.fromPartition('a');await (await account.fetch(origin+'/private')).text();
 await assert.rejects(account.fetch(origin+'/private'),/precisa de login/);assert.equal(hits,1);
 restarted=createNetwork({configuration:config,nativeRequest:async()=>null,testOrigins:[origin]});
 await assert.rejects(restarted.sessions.fromPartition('a').fetch(origin+'/private'),/precisa de login/);assert.equal(hits,1);
 await (await account.fetch(origin+'/public',{credentials:'omit'})).text();assert.equal(hits,2);
});

test('the observed native browser identity is persisted and reused without inventing a Safari version',async t=>{
 const {network,config}=await fixture(t),account=network.sessions.fromPartition('identity');
 assert.equal((await account.loginOptions()).userAgent,null);
 const userAgent='Mozilla/5.0 Native-WebKit-Identity-For-Test';await account.rememberBrowserIdentity({userAgent});
 assert.equal((await account.loginOptions()).userAgent,userAgent);
 await account.rememberBrowserIdentity({userAgent:'invalid\r\nheader'});assert.equal((await account.loginOptions()).userAgent,userAgent);
 const restarted=createNetwork({configuration:config,nativeRequest:async()=>null});t.after(()=>restarted.close());
 assert.equal((await restarted.sessions.fromPartition('identity').loginOptions()).userAgent,userAgent);
 assert.equal((await restarted.sessions.fromPartition('different-account').loginOptions()).userAgent,null);
});
test('restoring a browser session updates the engine to its actual current identity',async t=>{
 const {network,config}=await fixture(t);await network.sessions.fromPartition('a').retainBrowserSession();
 const userAgent='Native WebKit identity from restored session';
 const restarted=createNetwork({configuration:config,nativeRequest:async method=>method==='session.prepare'?{userAgent}:null});t.after(()=>restarted.close());
 await restarted.sessions.fromPartition('a').prepareBrowser();assert.equal((await restarted.sessions.fromPartition('a').loginOptions()).userAgent,userAgent);
});
