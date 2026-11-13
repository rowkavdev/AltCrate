import {useEffect,useRef,useState} from 'react';
import {loadStorageDestinations,reviewRequestForFailedDeposit} from './storageDestinationPicker.js';
const message=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': Error: /,'');
export function useInventoryActions({model,refKey,onChanged}){
 const [menu,setMenu]=useState(null),[preview,setPreview]=useState(null),[localOperation,setOperation]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[transfer,setTransfer]=useState(null),[storagePicker,setStoragePicker]=useState(null);
 const version=useRef(0),locked=useRef(false),trigger=useRef(null),changed=useRef(onChanged),storageAbort=useRef(null);changed.current=onChanged;
 const operation=localOperation?(model.inventoryOperations?.[localOperation.operationId]||localOperation):null;
 useEffect(()=>{version.current++;storageAbort.current?.abort();setMenu(null);setPreview(null);setTransfer(null);setStoragePicker(null);setOperation(null);setError('');setBusy(false);locked.current=false;return()=>{version.current++;storageAbort.current?.abort();};},[refKey]);
 const restore=()=>{if(trigger.current?.isConnected)trigger.current.focus();};
 function closeMenu(){setMenu(null);restore();}
 function closeReview(){version.current++;storageAbort.current?.abort();setPreview(null);setTransfer(null);setStoragePicker(null);setOperation(null);setError('');setBusy(false);locked.current=false;restore();}
 async function loadStorages(selected){
  storageAbort.current?.abort();const abort=new AbortController();storageAbort.current=abort;
  setStoragePicker({selected,entries:[],errors:[],loaded:0,total:model.accounts.length,retryAt:null,loading:true});
  try{const value=await loadStorageDestinations(model.accounts,id=>model.bridge.listStorageUnits(id),{signal:abort.signal,cooldown:model.bridge.storageCooldown?()=>model.bridge.storageCooldown():undefined,onUpdate:value=>setStoragePicker({selected,...value})});if(!abort.signal.aborted)setStoragePicker({selected,...value});}
  catch(e){if(!abort.signal.aborted)setError(message(e));}
 }
 function openMenu(ref,item,event,onDetails){
  event?.preventDefault?.();const target=event?.target?.closest?.('button')||event?.currentTarget?.querySelector?.('button')||document.activeElement;trigger.current=target;
  const rect=target?.getBoundingClientRect?.();setError('');setMenu({ref,item,onDetails,anchor:{x:event?.type==='contextmenu'?event.clientX:rect?.left||16,y:event?.type==='contextmenu'?event.clientY:rect?.bottom||16}});
 }
 async function prepare(kind,selected,options={}){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');const stamp=version.current;
  try{const value=await model.bridge.prepareInventoryAction({kind,ref:selected.ref,...options});if(version.current===stamp){setPreview(value);setTransfer(null);setStoragePicker(null);setOperation(null);}}
  catch(e){if(version.current===stamp)setError(message(e));}
  finally{if(version.current===stamp){setBusy(false);locked.current=false;}}
 }
 async function choose(kind,options){
  const selected=menu;if(!selected)return;closeMenu();
  if(kind==='details'){selected.onDetails?.();return;}
  if(kind==='copy'){try{await navigator.clipboard.writeText(selected.item.name);model.setNotice?.('Nome copiado.');}catch{model.setNotice?.('Não foi possível copiar o nome.');}return;}
  if(kind==='transfer'){setTransfer(selected);return;}
  if(kind==='move-to-storage'){loadStorages(selected);return;}
  await prepare(kind,selected,kind==='favorite'?{isFavorite:!selected.item.isFavorite}:options);
 }
 async function confirm(){
  if(locked.current||!preview)return;locked.current=true;setBusy(true);setError('');const stamp=version.current;
  try{const result=await model.bridge.confirmInventoryAction(preview.previewId);if(version.current===stamp){if(result.reviewRequired){setPreview(result.reviewRequired);setError('O item mudou. Revê os dados atualizados antes de confirmar.');}else{setPreview(null);setOperation(result.operation);changed.current?.();}}}
  catch(e){if(version.current===stamp)setError(message(e));}
  finally{if(version.current===stamp){locked.current=false;setBusy(false);}}
 }
 async function operate(method,id=operation?.operationId){
  if(locked.current||!id)return;locked.current=true;setBusy(true);setError('');const stamp=version.current;
  try{const result=await model.bridge[method](id);if(version.current===stamp){setOperation(result);changed.current?.();}}
  catch(e){if(version.current===stamp)setError(message(e));}
  finally{if(version.current===stamp){locked.current=false;setBusy(false);}}
 }
 return {available:!!model.bridge?.prepareInventoryAction,storageAvailable:!!model.bridge?.listStorageUnits&&!!model.bridge?.prepareInventoryAction,menu,preview,operation,transfer,storagePicker,busy,error,openMenu,closeMenu,choose,confirm,closeReview,reviewTransfer:destinationAccountId=>prepare('transfer',transfer,{destinationAccountId}),reviewStorage:(destinationAccountId,destinationStorageUnitId)=>{storageAbort.current?.abort();prepare('move-to-storage',storagePicker.selected,{destinationAccountId,destinationStorageUnitId});},retryStorage:()=>{if(storagePicker&&(!storagePicker.retryAt||Date.now()>=storagePicker.retryAt))loadStorages(storagePicker.selected);},reviewFailedDeposit:()=>{const request=reviewRequestForFailedDeposit(operation);if(request)prepare(request.kind,{ref:request.ref},{destinationAccountId:request.destinationAccountId,destinationStorageUnitId:request.destinationStorageUnitId});},verify:id=>operate('verifyInventoryOperation',id),resume:id=>operate('resumeInventoryOperation',id),cancel:id=>operate('cancelInventoryOperation',id),showOperation:value=>{storageAbort.current?.abort();setOperation(value);setPreview(null);setTransfer(null);setStoragePicker(null);setError('');}};
}
