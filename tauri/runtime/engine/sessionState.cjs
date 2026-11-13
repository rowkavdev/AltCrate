'use strict';
const isSessionCookie=name=>/^(?:__Secure-|__Host-)?better-auth\.session_token(?:\.\d+)?$/.test(name||'');
function describeSession(cookies,{requiresLogin=false,requiresVerification=false,browserSession=false,verifiedAt=0,lastRefreshedAt=0,serverExpiresAt=0,validationPending=false}={},now=Date.now()){
 const tokens=cookies.filter(cookie=>isSessionCookie(cookie.name||cookie.key)&&Boolean(cookie.value));
 const dates=tokens.map(cookie=>cookie.expires instanceof Date?cookie.expires.getTime():Number.isFinite(cookie.expirationDate)?cookie.expirationDate*1000:0).filter(value=>value>0);
 const expiresAt=Math.min(...dates,...(serverExpiresAt?[serverExpiresAt]:[]));
 const hasToken=tokens.length>0&&(!Number.isFinite(expiresAt)||expiresAt>now);
 const state=requiresLogin?'needs-login':!hasToken?(browserSession?'expired':'missing'):requiresVerification?'verification':validationPending?'validating':verifiedAt?'connected':'saved';
 return {state,hasToken,validationPending:hasToken&&validationPending,reusable:hasToken&&!requiresLogin,expiresAt:Number.isFinite(expiresAt)?expiresAt:null,verifiedAt,lastRefreshedAt,refreshDue:hasToken&&!requiresLogin&&(now-lastRefreshedAt>=86400000||(Number.isFinite(expiresAt)&&expiresAt-now<3600000&&now-lastRefreshedAt>=900000))};
}
function cookieFingerprint(cookies){return JSON.stringify(cookies.map(cookie=>({name:cookie.name||cookie.key,value:cookie.value,domain:(cookie.domain||'').replace(/^\./,''),path:cookie.path||'/',secure:Boolean(cookie.secure),httpOnly:Boolean(cookie.httpOnly),expiry:cookie.expires instanceof Date?cookie.expires.getTime():Number.isFinite(cookie.expirationDate)?cookie.expirationDate*1000:null})).sort((a,b)=>(a.domain+a.path+a.name).localeCompare(b.domain+b.path+b.name)));}
module.exports={isSessionCookie,describeSession,cookieFingerprint};
