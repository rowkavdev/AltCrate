const https=require('node:https');
const {isIP}=require('node:net');
const ALLOWED=new Map([['/api/me','GET'],['/api/cases','GET'],['/api/caseClick','POST'],['/api/click','POST'],['/api/vault','POST']]);
function validateRequest(endpoint,init={}){
 const method=init.method||'GET';
 if(ALLOWED.get(endpoint)!==method)throw TypeError('Pedido de farm inválido');
 if(['/api/caseClick','/api/click'].includes(endpoint)){
  const clicks=JSON.parse(init.body||'{}').clicks;if(!Number.isSafeInteger(clicks)||clicks<1||clicks>1000)throw TypeError('Cliques inválidos');
 }
 return {method};
}
function cookieHeader(cookies,endpoint,now=Date.now()){
 return cookies.filter(c=>['case-clicker.com','.case-clicker.com'].includes(c.domain)&&typeof c.name==='string'&&/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(c.name)&&typeof c.value==='string'&&!/[\r\n;]/.test(c.value)&&(!c.expirationDate||c.expirationDate*1000>now)&&
  (endpoint===c.path||endpoint.startsWith((c.path||'/').replace(/\/$/,'')+'/'))).map(c=>c.name+'='+c.value).join('; ');
}
function createServerTransport({account,saveCookies=async()=>{}}){
 const family=account.family||isIP(account.sourceAddress||'')||4;
 const agent=new https.Agent({keepAlive:true,maxSockets:2,localAddress:account.sourceAddress,family});
 return {close(){agent.destroy();},fetch(endpoint,init={}){
  const {method}=validateRequest(endpoint,init);
  const headers={Accept:'application/json','User-Agent':'CasePilot/0.3.19',Origin:'https://case-clicker.com',Referer:'https://case-clicker.com/',...init.headers};
  const cookie=cookieHeader(account.cookies,endpoint);if(cookie)headers.Cookie=cookie;
  return new Promise((resolve,reject)=>{
   const req=https.request({hostname:'case-clicker.com',path:endpoint,method,headers,agent,localAddress:account.sourceAddress,family,timeout:12000},res=>{
    const chunks=[];let size=0;res.on('data',c=>{size+=c.length;if(size>8*1024*1024)req.destroy(Object.assign(Error('Resposta demasiado grande'),{code:'ERR_RESPONSE_TOO_LARGE'}));else chunks.push(c);});
    res.on('error',reject);res.on('end',async()=>{
     try{
      for(const line of res.headers['set-cookie']||[]){
       const parts=line.split(';').map(s=>s.trim()),pair=parts.shift(),split=pair.indexOf('=');if(split<1)continue;
       const next={name:pair.slice(0,split),value:pair.slice(split+1),domain:'case-clicker.com',path:'/',secure:true};
       for(const part of parts){const [key,...v]=part.split('='),value=v.join('=');if(key.toLowerCase()==='domain')next.domain=value.toLowerCase();if(key.toLowerCase()==='path')next.path=value;if(key.toLowerCase()==='expires')next.expirationDate=Date.parse(value)/1000;if(key.toLowerCase()==='max-age')next.expirationDate=Date.now()/1000+Number(value);}
       if(!['case-clicker.com','.case-clicker.com'].includes(next.domain))continue;
       account.cookies=account.cookies.filter(c=>!(c.name===next.name&&c.path===next.path&&c.domain.replace(/^\./,'')===next.domain.replace(/^\./,'')));account.cookies.push(next);
      }
      if(res.headers['set-cookie'])await saveCookies();
      const body=Buffer.concat(chunks),status=res.statusCode;
      resolve(new Response([204,205,304].includes(status)?null:body,{status,headers:Object.fromEntries(Object.entries(res.headers).filter(([k,v])=>k!=='set-cookie'&&v!==undefined).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v]))}));
     }catch(error){reject(error);}
    });
   });
   req.on('timeout',()=>req.destroy(Object.assign(Error('Ligação sem resposta'),{code:'ETIMEDOUT'})));req.on('error',reject);
   if(init.signal){if(init.signal.aborted)req.destroy(Object.assign(Error('Pedido interrompido'),{code:'ETIMEDOUT'}));else init.signal.addEventListener('abort',()=>req.destroy(Object.assign(Error('Pedido interrompido'),{code:'ETIMEDOUT'})),{once:true});}
   if(init.body)req.write(init.body);req.end();
  });
 }};
}
module.exports={cookieHeader,validateRequest,createServerTransport};
