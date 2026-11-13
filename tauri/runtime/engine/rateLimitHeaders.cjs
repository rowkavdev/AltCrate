const {parseRetryAfter}=require('./scheduler.cjs');
function responseRateLimit(response,now=Date.now()){
 let longest;
 for(const source of ['Retry-After','X-Retry-After']){
  const raw=response.headers?.get?.(source),value=typeof raw==='string'?raw.trim():'';
  if(!value||!/^\d+(?:\.\d+)?$/.test(value)&&!Number.isFinite(Date.parse(value)))continue;
  const waitMs=parseRetryAfter(value,now);
  if(!longest||waitMs>longest.waitMs)longest={source,value,waitMs};
 }
 return longest||{source:'fallback',value:null,waitMs:parseRetryAfter(null,now)};
}
const readRetryAfter=response=>responseRateLimit(response).value;
module.exports={responseRateLimit,readRetryAfter};
