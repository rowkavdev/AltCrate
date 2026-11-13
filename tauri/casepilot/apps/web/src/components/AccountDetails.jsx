import {t} from '../language.js';
import React,{useEffect,useRef} from 'react';
import {X} from 'lucide-react';
import {formatMoney,formatNumber} from '../format.js';
export default function AccountDetails({account,snapshot,operation,onClose,children}){
 const ref=useRef(null);
 useEffect(()=>{
   if(!account)return;
   const old=document.activeElement,previousOverflow=document.body.style.overflow;
   document.body.style.overflow='hidden';ref.current?.querySelector('button')?.focus();
   const key=event=>{
     if(event.key==='Escape'){event.preventDefault();onClose();}
     if(event.key==='Tab'){
       const buttons=Array.from(ref.current?.querySelectorAll('button:not([disabled]),a[href],input')||[]),first=buttons[0],last=buttons.at(-1);
       if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
       else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
     }
   };
   document.addEventListener('keydown',key);
   return()=>{document.body.style.overflow=previousOverflow;document.removeEventListener('keydown',key);if(old?.isConnected)old.focus();};
 },[account?.id]);
 if(!account)return null;
 return <div className="detail-scrim" onClick={event=>{if(event.target===event.currentTarget)onClose();}}><section className="account-details" ref={ref} role="dialog" aria-modal="true" aria-labelledby="account-detail-title"><header><div><span className="kicker">{t("DETALHES DA CONTA")}</span><h2 id="account-detail-title">{account.label}</h2></div><button className="icon-button" aria-label={t("Fechar detalhes")} onClick={onClose}><X size={20}/></button></header>{snapshot?.error&&<p className="inline-error">{t(snapshot.error)}</p>}{operation?.error&&<p className="inline-error">{t(operation.error)}</p>}{t(children)}{operation?.last&&<p className="muted">{t("Última operação: ")}{t(operation.last.kind)} · {t(operation.last.confirmedDelta==null?'por confirmar':formatNumber(operation.last.confirmedDelta,2)+' confirmado')}</p>}<div className="detail-values"><span className="muted">{t("Saldo virtual")}<strong>{t(formatMoney(snapshot?.money))}</strong></span><span className="muted">{t("Caixas observadas")}<strong>{t(formatNumber(snapshot?.casesTotal))}</strong></span></div><h3>{t("Caixas nesta conta")}</h3><p className="muted">{t("Resumo da última leitura. Os itens do inventário não são apresentados nesta lista.")}</p><div className="case-detail-list">{snapshot?.cases?.length?snapshot.cases.map(item=><div key={item.id}><span>{t(item.name||'Caixa sem nome')}</span><strong>{t(formatNumber(item.amount))}</strong></div>):<p className="muted">{t("Não há caixas disponíveis nesta leitura.")}</p>}</div></section></div>;
}
