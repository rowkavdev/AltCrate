const https = require('node:https');
function networkMessage(code) {
  if (['ENETUNREACH','EHOSTUNREACH'].includes(code)) return 'O servidor não encontra uma rota para o jogo.';
  if (['ENOTFOUND','EAI_AGAIN'].includes(code)) return 'Não foi possível encontrar o endereço do jogo.';
  if (/CERT|TLS|SSL|SELF_SIGNED/.test(code||'')) return 'O certificado da ligação ao jogo não é válido.';
  if (code === 'ETIMEDOUT') return 'A ligação ao jogo não respondeu a tempo.';
  return 'Não foi possível ligar ao jogo.';
}
function probeGameRoute(route,{request=https.request,now=Date.now,timeoutMs=4000}={}) {
  const start=now();
  return new Promise(resolve=>{
    let req,done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve({routeId:route.id,family:route.family,checkedAt:now(),latencyMs:Math.max(0,now()-start),...value});};
    const timer=setTimeout(()=>{finish({ok:false,errorCode:'ETIMEDOUT',message:networkMessage('ETIMEDOUT')});req?.destroy();},timeoutMs);
    try {
      // A public request: no account cookies, redirects or farm mutations.
      req=request({hostname:'case-clicker.com',path:'/',method:'GET',agent:false,family:route.family,localAddress:route.sourceAddress,rejectUnauthorized:true,headers:{Accept:'text/html','User-Agent':'CasePilot/0.3.19'}},res=>{
        const challenged=res.headers['cf-mitigated']==='challenge';
        const ok=res.statusCode>=200&&res.statusCode<400&&!challenged;
        finish({ok,httpStatus:res.statusCode,challenged,message:challenged?'O jogo pede uma verificação no navegador.':ok?'Ligação ao jogo verificada.':'O jogo respondeu com HTTP '+res.statusCode+'.'});
        res.on('error',()=>{});res.destroy();
      });
      req.on('error',error=>{const code=String(error.code||'NETWORK_ERROR').slice(0,80);finish({ok:false,errorCode:code,message:networkMessage(code)});});
      req.end();
    } catch(error) {finish({ok:false,errorCode:'NETWORK_ERROR',message:networkMessage()});req?.destroy();}
  });
}
async function checkGameRoutes(routes,{probe=probeGameRoute,accounts=[]}={}) {
  const results=new Array(routes.length);let next=0;
  async function worker(){while(next<routes.length){const i=next++;results[i]={...await probe(routes[i]),accounts:accounts.filter(a=>a.routeId===routes[i].id).length};}}
  await Promise.all(Array.from({length:Math.min(4,routes.length)},worker));
  return {routes:results,healthy:results.filter(r=>r.ok).length,total:results.length};
}
const RECOVERABLE=new Set(['ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','ERR_CONNECTION_RESET','ERR_CONNECTION_REFUSED','ERR_CONNECTION_TIMED_OUT','ERR_PROXY_CONNECTION_FAILED','ERR_INTERNET_DISCONNECTED','ERR_NETWORK_CHANGED']);
function recoveryDelay(id,attempt=0){const base=[30000,60000,120000,300000][Math.min(3,Math.max(0,attempt))];let hash=0;for(const c of id)hash=(hash*31+c.charCodeAt(0))>>>0;return base+hash%10000;}
module.exports={probeGameRoute,checkGameRoutes,networkMessage,RECOVERABLE,recoveryDelay};
