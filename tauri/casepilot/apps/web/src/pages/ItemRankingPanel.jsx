import React,{useEffect,useRef,useState} from 'react';
import {ListOrdered,RefreshCw,Square} from 'lucide-react';
import {t} from '../language.js';
import './itemRanking.css';
const date=value=>Number.isFinite(value)?new Date(value).toLocaleString('pt-PT'):'Sem data';
const stateLabel={fresh:'Atual',stale:'Obsoleto','identity-changed':'Item alterado',unavailable:'Sem posição disponível'};
export default function ItemRankingPanel({bridge,accountId,items=[]}){
 const [selected,setSelected]=useState([]),[records,setRecords]=useState({}),[pending,setPending]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(''),[clock,setClock]=useState(Date.now),[maxAgeMs,setMaxAgeMs]=useState(300000);
 const stopped=useRef(false),generation=useRef(0);
 const ids=items.map(item=>item.id).filter(Boolean),signature=JSON.stringify(items.map(item=>[item.id,item.name,item.float,item.patternId,item.statTrak,item.souvenir,item.eventName])),available=!!bridge?.itemRankingRead&&!!bridge?.itemRankingRefresh;
 useEffect(()=>{
  const version=++generation.current;stopped.current=true;setSelected([]);setRecords({});setError('');setProgress('');
  if(!available||!accountId||!ids.length)return;
  bridge.itemRankingRead({accountId,itemIds:ids}).then(value=>{if(version===generation.current){setRecords(Object.fromEntries((value.items||value.records||[]).map(entry=>[entry.itemId,entry])));if(Number.isFinite(value.capability?.maxAgeMs))setMaxAgeMs(value.capability.maxAgeMs);setClock(Date.now());}}).catch(failure=>{if(version===generation.current)setError(String(failure.message||failure));});
  return()=>{generation.current++;stopped.current=true;};
 },[bridge,accountId,signature,available]);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),30000);return()=>clearInterval(timer);},[]);
 async function refreshSelected(){
  if(pending||!selected.length)return;const version=generation.current,target=accountId,chosen=[...selected];stopped.current=false;setPending(true);setError('');let completed=0;
  try{
   for(const itemId of chosen){
    if(stopped.current||version!==generation.current)break;
    setProgress('A consultar '+(completed+1)+' de '+chosen.length+'…');
    const value=await bridge.itemRankingRefresh({accountId:target,itemIds:[itemId]});
    if(version!==generation.current)break;
    const entries=value.items||value.records||(value.itemId?[value]:[]);setRecords(previous=>({...previous,...Object.fromEntries(entries.map(entry=>[entry.itemId,entry]))}));completed++;
   }
   if(version===generation.current)setProgress((stopped.current?'Parado · ':'')+completed+' de '+chosen.length+' itens consultados.');
  }catch(failure){if(version===generation.current){setError(String(failure.message||failure));setProgress(completed+' de '+chosen.length+' itens consultados. Não foi feita nova tentativa automática.');}}
  finally{setPending(false);}
 }
 return <section className="panel item-ranking-panel"><div className="section-heading"><h2><ListOrdered size={17}/>{t('Ranking individual')}</h2><span>{t('Overall · menor float')}</span></div><p className="form-note">{t('Seleciona os itens visíveis que queres consultar. Cada posição pertence a um item e a uma conta; a cobertura agregada não é uma posição. A observação local e a atualização na origem têm datas distintas. Dados ausentes ou obsoletos conservam o item nas regras Top N.')}</p>
  {!available&&<p className="inline-error">{t('A consulta de ranking individual está indisponível nesta versão da app.')}</p>}
  {!!items.length&&<><label className="checkbox-label"><input type="checkbox" checked={ids.length>0&&ids.every(id=>selected.includes(id))} disabled={!available||pending} onChange={event=>setSelected(event.target.checked?ids:[])}/>{t('Selecionar itens desta página')}</label><div className="item-ranking-list">{items.map(item=>{const record=records[item.id],state=record?.state==='fresh'&&clock-Math.min(record.observedAt,record.sourceUpdatedAt)>maxAgeMs?'stale':record?.state;return <article key={item.id}><label><input type="checkbox" aria-label={t('Selecionar '+item.name)} disabled={!available||pending} checked={selected.includes(item.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/><strong>{item.name}</strong></label><div><span className={'status-tag'+(state==='fresh'?' good':'')}>{t(record?stateLabel[state]||'Indisponível':'Sem consulta')}</span>{['fresh','stale'].includes(state)&&Number.isSafeInteger(record.rank)&&<strong> #{record.rank}</strong>}<small>{t('Observação local: ')}{t(date(record?.observedAt))}</small><small>{t('Atualização na origem: ')}{t(date(record?.sourceUpdatedAt))}</small>{record?.reason&&<small>{t(record.reason)}</small>}</div></article>;})}</div></>}
  <div className="run-actions"><button className="secondary-button" type="button" disabled={!available||pending||!selected.length} onClick={refreshSelected}><RefreshCw size={15}/>{t('Consultar selecionados')}{selected.length?' ('+selected.length+')':''}</button><button className="stop-button" type="button" disabled={!pending} onClick={()=>{stopped.current=true;setProgress('A parar após o pedido atual…');}}><Square size={14}/>{t('Parar')}</button></div>{progress&&<p role="status" className="form-note">{t(progress)}</p>}{error&&<p role="alert" className="inline-error">{t(error)}</p>}
 </section>;
}
