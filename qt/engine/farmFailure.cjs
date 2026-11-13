const OPERATIONS={case:'Caixas',money:'Dinheiro',vault:'Cofre'};
const NETWORK_CODES=new Set(['ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH']);
function safeCode(value){const code=String(value||'');return NETWORK_CODES.has(code)||/^ERR_[A-Z_]{1,64}$/.test(code)?code:'';}
function failureDetails(error){
 const text=String(error?.message||'');
 const candidate=Number(error?.status||/\bHTTP (\d{3})\b/.exec(text)?.[1]);
 const httpStatus=Number.isInteger(candidate)&&candidate>=400&&candidate<=599?candidate:null;
 const errorCode=safeCode(error?.code)||safeCode(/\bnet::(ERR_[A-Z_]+)/.exec(text)?.[1]);
 return {httpStatus,errorCode,errorCategory:httpStatus?'http':errorCode?'network':/^Resposta inválida/.test(text)?'response':'unknown'};
}
function safeFailure(event){
 const httpStatus=Number.isInteger(event.httpStatus)&&event.httpStatus>=400&&event.httpStatus<=599?event.httpStatus:null;
 const errorCode=safeCode(event.errorCode);
 const errorCategory=httpStatus?'http':errorCode?'network':['response','unknown'].includes(event.errorCategory)?event.errorCategory:'unknown';
 const operation=Object.hasOwn(OPERATIONS,event.operation)?event.operation:'';
 const stage=['read','request'].includes(event.stage)?event.stage:'';
 const failures=Number.isFinite(event.failures)?Math.min(3,Math.max(0,Math.floor(event.failures))):0;
 const paused=event.paused===true;
 const retryAt=!paused&&Number.isFinite(event.retryAt)&&event.retryAt>0&&event.retryAt<=8640000000000000?event.retryAt:0;
 const cause=errorCategory==='http'?'A API devolveu HTTP '+httpStatus+'.':errorCategory==='network'?'Falha de ligação ('+errorCode+').':errorCategory==='response'?'Resposta da API sem os dados esperados.':'Não foi possível concluir a operação.';
 const context=[OPERATIONS[operation],stage==='read'?'leitura':stage==='request'?'pedido':''].filter(Boolean).join(' · ');
 const recovery=paused?' Conta pausada após 3 falhas consecutivas. Usa Atualizar e Retomar em Automação.':retryAt?' Tentativa '+failures+' de 3; nova tentativa às '+new Date(retryAt).toLocaleTimeString('pt-PT')+'.':'';
 return {operation,stage,httpStatus,errorCode,errorCategory,failures,paused,retryAt,message:(context?context+': ':'')+cause+recovery};
}
module.exports={failureDetails,safeFailure};
