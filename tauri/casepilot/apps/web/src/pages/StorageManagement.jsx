import React,{useEffect,useRef,useState} from 'react';
import {t} from '../language.js';
import './inventoryBatch.css';
const titles={create:'Criar cofre',rename:'Mudar nome',clear:'Esvaziar cofre',delete:'Apagar cofre'};
const message=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': Error: /,'');

export default function StorageManagement({bridge,accountId,units=[],selectedId='',onChanged}){
 const [kind,setKind]=useState('create'),[id,setId]=useState(''),[name,setName]=useState(''),[preview,setPreview]=useState(null),[operations,setOperations]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const version=useRef(0),locked=useRef(false);
 const available=!!bridge?.prepareStorageManagement;
 useEffect(()=>{const stamp=++version.current;setPreview(null);setError('');setOperations([]);setId(selectedId);setBusy(false);setKind(selectedId?'rename':'create');setName('');if(available)bridge.listStorageManagement?.().then(values=>{if(stamp===version.current)setOperations(values);}).catch(e=>{if(stamp===version.current)setError(message(e));});return()=>{version.current++;};},[bridge,accountId,selectedId,available]);
 useEffect(()=>{if(!available)return;return bridge.onEvent?.(event=>{if(event.type==='storage-management'&&event.operation){const result=event.operation;setOperations(old=>[result,...old.filter(o=>o.operationId!==result.operationId)]);}});},[bridge,available]);
 const unit=units.find(u=>u.id===id),pending=operations.filter(o=>['unconfirmed','sending'].includes(o.state));
 async function call(method,arg){if(locked.current)return;locked.current=true;setBusy(true);setError('');const stamp=version.current;
  try{const result=await bridge[method](arg);if(stamp===version.current){if(method==='prepareStorageManagement')setPreview(result);else{setPreview(null);setOperations(old=>[result,...old.filter(o=>o.operationId!==result.operationId)]);onChanged?.();}}}
  catch(e){if(stamp===version.current)setError(message(e));}finally{locked.current=false;if(stamp===version.current)setBusy(false);}
 }
 if(!available)return null;
 return <section className="panel storage-management" aria-label={t('Gerir cofres')}><div className="section-heading"><div><h2>{t('Gerir cofres')}</h2><small className="muted">{t('Criar, mudar nome, esvaziar ou apagar um storage desta conta.')}</small></div></div>
  <div className="inventory-controls"><label>{t('Ação do cofre')}<select value={kind} disabled={busy} onChange={e=>{setKind(e.target.value);setPreview(null);}}>{Object.entries(titles).map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>
  {kind!=='create'&&<label>{t('Cofre')}<select value={id} disabled={busy} onChange={e=>{setId(e.target.value);setPreview(null);setName('');}}><option value="">{t('Selecionar cofre')}</option>{units.map(u=><option key={u.id} value={u.id}>{u.name} · {u.count} {t('skins')}</option>)}</select></label>}
  {kind==='rename'&&<label>{t('Novo nome')}<input aria-label={t('Novo nome do cofre')} maxLength={20} value={name} disabled={busy} placeholder={unit?.name||''} onChange={e=>{setName(e.target.value);setPreview(null);}}/></label>}</div>
  <p className="muted">{t(kind==='create'?'A criação depende do número de cofres permitido pelo jogo nesta conta.':kind==='rename'?'O nome pode ter entre 1 e 20 caracteres.':'As skins regressam ao inventário da mesma conta. Esta ação não pode ser desfeita.')}</p>
  <button className="primary-button" disabled={busy||pending.length>0||kind!=='create'&&!unit||kind==='rename'&&!name.trim()} onClick={()=>call('prepareStorageManagement',{kind,accountId,...(kind!=='create'?{storageUnitId:id}:{}),...(kind==='rename'?{name}: {})})}>{t('Rever alteração do cofre')}</button>
  {preview&&<div className="inventory-batch-review" aria-label={t('Revisão do cofre')}><h3>{t(titles[preview.kind])}</h3><p>{preview.accountLabel}{preview.unit?' · '+preview.unit.name+' · '+preview.unit.count+' skins':''}{preview.name?' → '+preview.name:''}</p>{['clear','delete'].includes(preview.kind)&&<p>{t('Todas as skins revistas serão verificadas no inventário depois da ação.')}</p>}<div className="inventory-batch-buttons"><button className="primary-button" disabled={busy} onClick={()=>call('confirmStorageManagement',preview.previewId)}>{t('Confirmar '+titles[preview.kind].toLowerCase())}</button><button className="secondary-button" disabled={busy} onClick={()=>setPreview(null)}>{t('Cancelar')}</button></div></div>}
  {operations.filter(o=>o.accountId===accountId||['unconfirmed','sending'].includes(o.state)).slice(0,5).map(o=><div className="storage-management-result" key={o.operationId}><p role="status">{o.accountId!==accountId?o.accountLabel+' · ':''}{t(o.message)}{o.createdUnit?' · '+o.createdUnit.name:''}</p>{['sending','unconfirmed'].includes(o.state)&&<button className="secondary-button" disabled={busy} onClick={()=>call('verifyStorageManagement',o.operationId)}>{t('Verificar alteração do cofre')}</button>}</div>)}
  {error&&<p className="inline-error" role="alert">{t(error)}</p>}
 </section>;
}
