import {t,getLocale} from '../language.js';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ArrowRightLeft,Coins,Copy,Eye,Star,Wallet,X,Archive,LoaderCircle} from 'lucide-react';
import {ItemPhoto,ItemAccessories} from './InventoryItems.jsx';
import {formatMoney,formatNumber} from '../format.js';
const titles={sell:'Vender por dinheiro virtual',convert:'Converter em tokens',favorite:'Atualizar favorito',withdraw:'Retirar para inventário',transfer:'Enviar para outra conta','move-to-storage':'Mover para storage'};
const confirms={sell:'Confirmar venda',convert:'Confirmar conversão',favorite:'Confirmar favorito',withdraw:'Confirmar retirada',transfer:'Confirmar envio','move-to-storage':'Confirmar movimento'};
function ContextMenu({controller,accounts}){
 const {menu,closeMenu,choose}=controller,ref=useRef(null),[position,setPosition]=useState({left:16,top:16});
 useLayoutEffect(()=>{const place=()=>{const el=ref.current;if(!el)return;const r=el.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(menu.anchor.x,innerWidth-r.width-8)),top:Math.max(8,Math.min(menu.anchor.y,innerHeight-r.height-8))});};place();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);},[menu]);
 useEffect(()=>{ref.current?.querySelector('button:not(:disabled)')?.focus();const key=e=>{if(e.key==='Escape'){e.preventDefault();closeMenu();}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[menu]);
 const entries=[['details','Ver detalhes',Eye],['move-to-storage','Mover para storage',Archive],['transfer','Enviar para outra conta',ArrowRightLeft],['convert','Converter em tokens',Coins],['sell','Vender por dinheiro virtual',Wallet],['favorite',menu.item.isFavorite?'Remover favorito':'Adicionar favorito',Star],...(menu.ref.storageUnitId?[['withdraw','Retirar para inventário',Archive]]:[]),['copy','Copiar nome',Copy]];
 const blocked=kind=>kind==='transfer'&&accounts.length<2?'Adiciona outra conta para enviar':['sell','convert'].includes(kind)&&menu.item.isFavorite?'Item favorito':kind==='move-to-storage'&&!controller.storageAvailable?'Atualiza a app para usar storages':!['details','copy'].includes(kind)&&!controller.available?'Atualiza a app para usar esta ação':'';
 function keys(e){const buttons=[...ref.current.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}if(e.key==='Tab')closeMenu();}
 return <div className="inventory-menu-scrim" onMouseDown={e=>{if(e.target===e.currentTarget)closeMenu();}}><section className="inventory-context-menu" ref={ref} style={position} role="menu" aria-label={t('Ações de '+menu.item.name)} onKeyDown={keys}><header><small>{t("AÇÕES DO ITEM")}</small><strong>{menu.item.name}</strong></header>{entries.map(([kind,label,Icon])=><button key={kind} role="menuitem" data-action={kind} disabled={!!blocked(kind)} onClick={()=>choose(kind)}><Icon size={18}/><span>{t(label)}{blocked(kind)&&<small>{t(blocked(kind))}</small>}</span></button>)}</section></div>;
}
function Dialog({title,onClose,children,busy=false}){
 const ref=useRef(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{const previous=document.activeElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';(ref.current?.querySelector('button:not(:disabled)')||ref.current)?.focus();const keys=e=>{if(e.key==='Escape'){e.preventDefault();close.current();}if(e.key==='Tab'){const items=[...ref.current.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]')];const first=items[0],last=items.at(-1);if(!first||!items.includes(document.activeElement)){e.preventDefault();(e.shiftKey?last||ref.current:first||ref.current)?.focus();}else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',keys);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keys);if(previous?.isConnected)previous.focus();};},[]);
 return <div className="detail-scrim" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={ref} className="account-details inventory-action-review" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="inventory-action-title"><header><div><span className="kicker">{t("AÇÃO SOBRE UM ITEM")}</span><h2 id="inventory-action-title">{t(title)}</h2></div><button className="icon-button" aria-label={t("Fechar revisão")} onClick={onClose} disabled={busy}><X size={20}/></button></header>{t(children)}</section></div>;
}
function DestinationPicker({controller,accounts}){
 const [search,setSearch]=useState(''),[id,setId]=useState('');const options=accounts.filter(a=>a.id!==controller.transfer.ref.accountId&&a.label.toLocaleLowerCase('pt-PT').includes(search.toLocaleLowerCase('pt-PT')));
 return <Dialog title="Escolher conta de destino" onClose={controller.busy?()=>{}:controller.closeReview} busy={controller.busy}><ItemPhoto item={controller.transfer.item}/><h3>{controller.transfer.item.name}</h3><div className="inventory-destination-fields"><label>{t("Pesquisar conta")}<input aria-label={t("Pesquisar conta de destino")} value={search} onChange={e=>setSearch(e.target.value)} placeholder={t("Nome da conta…")}/></label><label>{t("Conta de destino")}<select aria-label={t("Conta de destino")} value={id} onChange={e=>setId(e.target.value)}><option value="">{t("Seleciona uma conta")}</option>{options.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label></div><p className="muted">{t("Envio de um item, sem tokens nem itens em contrapartida.")}</p>{controller.error&&<p role="alert" className="inline-error">{t(controller.error)}</p>}<footer><button className="secondary-button" onClick={controller.closeReview} disabled={controller.busy}>{t("Voltar")}</button><button data-action="review-transfer" className="primary-button" disabled={!id||controller.busy} onClick={()=>controller.reviewTransfer(id)}>{t(controller.busy?'A consultar…':'Rever envio')}</button></footer></Dialog>;
}
function StorageDestinationPicker({controller,accounts}){
 const [search,setSearch]=useState(''),[time,setTime]=useState(Date.now());
 useEffect(()=>{if(!controller.storagePicker?.retryAt)return;const timer=setInterval(()=>setTime(Date.now()),1000);return()=>clearInterval(timer);},[controller.storagePicker?.retryAt]);
 const {selected,entries=[],errors=[],completedAccountIds=[],loaded=0,total=accounts.length,retryAt,loading}=controller.storagePicker;
 const needle=search.trim().toLocaleLowerCase('pt-PT');
 const visible=entries.filter(entry=>(entry.accountLabel+' '+entry.accountId+' '+entry.storageName).toLocaleLowerCase('pt-PT').includes(needle));
 const duplicateLabels=new Set(accounts.filter(account=>accounts.filter(other=>other.label===account.label).length>1).map(account=>account.label));
 const groups=accounts.map(account=>({account,storages:visible.filter(entry=>entry.accountId===account.id),completed:completedAccountIds.includes(account.id)})).filter(group=>group.storages.length||group.completed&&(!needle||group.account.label.toLocaleLowerCase('pt-PT').includes(needle)));
 return <Dialog title="Escolher storage de destino" onClose={controller.busy?()=>{}:controller.closeReview} busy={controller.busy}><ItemPhoto item={selected.item}/><h3>{selected.item.name}</h3><label className="storage-destination-search">{t("Pesquisar conta ou storage")}<input aria-label={t("Pesquisar conta ou storage")} value={search} onChange={event=>setSearch(event.target.value)} placeholder={t("Nome da conta ou do storage…")}/></label><p className="muted" role="status">{t(loaded)}{t(" de ")}{t(total)}{t(" contas consultadas")}{t(loading?' · a carregar…':'')}</p><div className="storage-destination-list">{groups.map(({account,storages,completed})=><section key={account.id}><h3>{account.label}{duplicateLabels.has(account.label)&&<small> · {t(account.id.slice(0,8))}</small>}</h3>{completed&&!storages.length&&<p className="muted">{t("Esta conta não tem storages.")}</p>}{storages.map(storage=>{const same=account.id===selected.ref.accountId&&storage.storageId===selected.ref.storageUnitId;return <button key={storage.storageId} data-account={account.id} data-storage={storage.storageId} disabled={same||controller.busy} onClick={()=>controller.reviewStorage(account.id,storage.storageId)}><Archive size={18}/><span><strong>{t(storage.storageName)}</strong><small>{t(same?'Já está neste storage':formatNumber(storage.count)+' itens')}</small></span></button>;})}</section>)}</div>{!loading&&!entries.length&&!retryAt&&<p className="muted">{t("Nenhum storage disponível nas contas consultadas.")}</p>}{!loading&&needle&&!visible.length&&entries.length>0&&<p className="muted">{t("Nenhum storage corresponde à pesquisa.")}</p>}{errors.length>0&&<div className="storage-destination-errors"><strong>{t(errors.length)}{t(" contas não puderam ser consultadas")}</strong>{errors.map(failure=><small key={failure.accountId}>{t(failure.accountLabel)}: {t(failure.message)}</small>)}</div>}{retryAt&&<p role="alert" className="inline-error">{t("Limite de pedidos atingido. Podes retomar a consulta após ")}{t(new Date(retryAt).toLocaleTimeString(getLocale()))}.</p>}{controller.error&&<p role="alert" className="inline-error">{t(controller.error)}</p>}<footer><button className="secondary-button" onClick={controller.closeReview} disabled={controller.busy}>{t("Fechar")}</button>{(errors.length>0||retryAt)&&<button className="secondary-button" disabled={controller.busy||retryAt&&time<retryAt} onClick={controller.retryStorage}>{t("Tentar novamente")}</button>}</footer></Dialog>;
}
export default function InventoryActions({controller,accounts}){
 if(controller.menu)return <ContextMenu controller={controller} accounts={accounts}/>;
 if(controller.transfer)return <DestinationPicker controller={controller} accounts={accounts}/>;
 if(controller.storagePicker)return <StorageDestinationPicker controller={controller} accounts={accounts}/>;
 const {preview,operation,busy,error}=controller;
 if(!preview&&!operation&&!error&&!busy)return null;
 const item=preview?.item||operation?.item;
 return <Dialog title={preview?titles[preview.kind]:operation?'Resultado da operação':busy?'A consultar o item':'Ação indisponível'} onClose={controller.busy?()=>{}:controller.closeReview} busy={controller.busy}>
  {item&&<><ItemPhoto item={item}/><h3>{item.name}</h3><ItemAccessories item={item} large/></>}
  {preview&&<><dl className="item-detail-values"><div><dt>{t("Conta de origem")}</dt><dd>{t(preview.sourceLabel)}</dd></div>{preview.destinationLabel&&<div><dt>{t("Conta de destino")}</dt><dd>{t(preview.destinationLabel)}</dd></div>}{preview.destinationStorageName&&<div><dt>{t("Storage de destino")}</dt><dd>{t(preview.destinationStorageName)}</dd></div>}<div><dt>{t("Valor virtual do item")}</dt><dd>{t(formatMoney(item.price))}</dd></div></dl><ol className="inventory-action-steps">{preview.steps.map(step=><li key={step}>{t(step)}</li>)}</ol>{preview.kind==='convert'&&<p className="muted">{t(preview.quoteTokens==null?'O resultado em tokens será mostrado após a conversão.':formatNumber(preview.quoteTokens)+' tokens')}</p>}<p className="muted">{t(['sell','convert'].includes(preview.kind)?'Esta ação remove o item desta conta.':'Confirma o item e as contas antes de continuar.')}</p></>}
  {operation&&<div className="inventory-operation-result" role="status"><strong>{t(operation.message)}</strong>{operation.kind==='move-to-storage'&&operation.location==='inventory'&&<p>{t("Localização confirmada: inventário da ")}{t(operation.locationAccountId===operation.destinationAccountId?'conta de destino':'conta de origem')}.</p>}{operation.kind==='move-to-storage'&&operation.location==='storage'&&<p>{t("Localização confirmada: ")}{t(operation.locationStorageUnitId===operation.destinationStorageUnitId||operation.state==='confirmed'?'storage '+operation.destinationStorageName:'storage de origem')}.</p>}{operation.observedMoney!=null&&<p>{t("Saldo observado: ")}{t(formatMoney(operation.observedMoney))}</p>}{operation.observedTokens!=null&&<p>{t("Tokens observados: ")}{t(formatNumber(operation.observedTokens,4))}</p>}</div>}
  {busy&&<p role="status" className="muted"><LoaderCircle size={16}/>{t("A consultar o servidor…")}</p>}{error&&<p role="alert" className="inline-error">{t(error)}</p>}
  <footer><button className="secondary-button" onClick={controller.closeReview} disabled={controller.busy}>{t(preview?'Voltar':'Fechar')}</button>{preview&&<button data-action="confirm" className="primary-button" disabled={busy} onClick={controller.confirm}>{t(busy?'A executar…':confirms[preview.kind])}</button>}{operation?.state==='unconfirmed'&&<button className="primary-button" disabled={busy} onClick={()=>controller.verify()}>{t("Verificar estado")}</button>}{operation?.canResume&&<button className="primary-button" disabled={busy} onClick={()=>controller.resume()}>{t("Continuar armazenamento")}</button>}{operation?.kind==='move-to-storage'&&operation.state==='failed'&&operation.location==='inventory'&&operation.locationAccountId===operation.destinationAccountId&&<button className="primary-button" disabled={busy} onClick={controller.reviewFailedDeposit}>{t("Rever armazenamento")}</button>}{operation?.canCancel&&<button className="secondary-button" disabled={busy} onClick={()=>controller.cancel()}>{t("Cancelar envio")}</button>}</footer>
 </Dialog>;
}
export function InventoryOperations({ model, controller, accountId }) {
  const [page, setPage] = useState(1);
  const operations = Object.values(model.inventoryOperations || {})
    .filter((operation) => [operation.accountId, operation.destinationAccountId].includes(accountId))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  if (!operations.length) return null;

  const needsAttention = (operation) =>
    ["running", "submitting", "unconfirmed"].includes(operation.state) || operation.canResume || operation.canCancel;
  const pending = operations.filter(needsAttention);
  const history = operations.filter((operation) => !needsAttention(operation));
  const pageSize = 10;
  const pageCount = Math.ceil(history.length / pageSize);
  const currentPage = Math.min(page, pageCount);
  const renderOperation = (operation) => (
    <article key={operation.operationId}>
      <div>
        <strong>{t(operation.item?.name || "Item")}</strong>
        <small>{t(operation.message || "Operação em curso")}</small>
      </div>
      <button className="secondary-button" onClick={() => controller.showOperation(operation)}>
        {t("Ver operação")}
      </button>
    </article>
  );

  return (
    <section className="panel inventory-operations">
      <div className="section-heading">
        <h2>{t("Operações do inventário")}</h2>
        <small>{t("Estado guardado na app")}</small>
      </div>
      {pending.map(renderOperation)}
      {history.length > 0 && (
        <details>
          <summary>{t("Histórico")} ({history.length})</summary>
          {history.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(renderOperation)}
          {pageCount > 1 && (
            <div className="inventory-batch-buttons">
              <button className="secondary-button" aria-label={t("Página anterior do histórico")}
                disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                {t("Anterior")}
              </button>
              <span>{currentPage} / {pageCount}</span>
              <button className="secondary-button" aria-label={t("Página seguinte do histórico")}
                disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>
                {t("Seguinte")}
              </button>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
