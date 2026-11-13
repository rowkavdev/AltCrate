'use strict';
const {responseRateLimit}=require('./rateLimitHeaders.cjs');
function sessionRateLimit(response,{now=Date.now(),endpoint='/api/me'}={}){
 const {waitMs,source}=responseRateLimit(response,now);
 return Object.assign(Error('O site limitou a validação da sessão. A fila aguarda para voltar a validar.'),{
  status:429,retryAt:now+waitMs,safeToRetry:true,
  rateLimit:{endpoint,status:429,waitMs,source,challenge:response.headers?.get?.('cf-mitigated')==='challenge'},
 });
}
module.exports={sessionRateLimit};
