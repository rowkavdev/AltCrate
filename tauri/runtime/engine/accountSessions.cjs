'use strict';
function createAccountSessionManager({list,sessionFor,fetchSession,canRefresh=()=>true,now=Date.now,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 let active=null;
 return {
  async list(){return Promise.all((await list()).map(async account=>({...account,session:await sessionFor(account.partition).status()})));},
  async refresh(account,{signal}={}){
   const local=sessionFor(account.partition);if(!(await local.status()).reusable)return local.status();
   await local.prepareBrowser();const response=await fetchSession(account,{signal});
   if(response.status===401)return local.markNeedsLogin();
   if(!response.ok)throw Object.assign(Error(response.status===429?'O site limitou a atualização de sessões.':'Não foi possível atualizar a sessão.'),{status:response.status});
   const data=await response.json();if(data===null||data?.session===null)return local.markNeedsLogin();
   if(!data?.session||!data?.user||(account.email&&typeof data.user.email!=='string'))throw Error('A resposta de validação da sessão não é reconhecida. A sessão guardada foi conservada.');
   if(account.email&&data.user.email?.toLowerCase()!==account.email.toLowerCase())return local.markNeedsLogin();
   const expiresAt=Date.parse(data.session.expiresAt);if(!Number.isFinite(expiresAt))throw Error('O site não indicou a validade da sessão. A sessão guardada foi conservada.');
   if(expiresAt<=now())return local.markNeedsLogin();
   return local.markAuthenticated({expiresAt});
  },
  runDue(){
   if(active)return active;
   active=(async()=>{for(const account of await this.list()){
    if(!canRefresh())break;
    if(!account.session.refreshDue||account.session.state==='verification')continue;
    try{await this.refresh(account);}catch{break;}
    await delay(10000);
   }})().finally(()=>{active=null;});return active;
  },
 };
}
module.exports={createAccountSessionManager};
