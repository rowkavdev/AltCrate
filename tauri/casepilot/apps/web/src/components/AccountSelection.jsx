import {t} from '../language.js';
import React,{useMemo} from 'react';
import {ChevronDown} from 'lucide-react';
export default function AccountSelection({accounts,selectedIds,onChange,disabled=false}){
 const selectedSet=useMemo(()=>new Set(selectedIds),[selectedIds]);
 const valid=useMemo(()=>accounts.filter(account=>selectedSet.has(account.id)),[accounts,selectedSet]);
 return <details className="account-selection"><summary><span><strong>{t(valid.length)}</strong> {t(valid.length===1?'conta selecionada':'contas selecionadas')}{valid.length>0&&<small className="muted"> · {t(valid.slice(0,2).map(account=>account.label).join(', '))}{t(valid.length>2?' e mais '+(valid.length-2):'')}</small>}</span><ChevronDown size={16}/></summary><div className="selection-actions"><button type="button" disabled={disabled||!accounts.length} onClick={()=>onChange(accounts.map(account=>account.id))}>{t("Selecionar todas")}</button><button type="button" disabled={disabled||!valid.length} onClick={()=>onChange([])}>{t("Limpar seleção")}</button></div><div className="selection-items">{accounts.length?accounts.map(account=><label key={account.id}><input type="checkbox" checked={selectedSet.has(account.id)} disabled={disabled} onChange={()=>onChange(selectedSet.has(account.id)?selectedIds.filter(id=>id!==account.id):[...selectedIds,account.id])}/><span>{account.label}</span></label>):<p className="muted">{t("Adiciona uma conta para a selecionares.")}</p>}</div></details>;
}
