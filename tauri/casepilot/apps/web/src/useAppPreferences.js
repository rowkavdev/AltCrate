import {useCallback,useEffect,useRef,useState} from 'react';
export function useAppPreferences(bridge){
 const [preferences,setPreferences]=useState({enableSiteOpening:false}),[loading,setLoading]=useState(!!bridge?.readAppPreferences),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const busy=useRef(false),mounted=useRef(true);
 useEffect(()=>{
  mounted.current=true;let live=true;
  if(!bridge?.readAppPreferences){setLoading(false);return()=>{mounted.current=false;};}
  bridge.readAppPreferences().then(value=>{if(live)setPreferences({enableSiteOpening:value?.enableSiteOpening===true});}).catch(failure=>{if(live)setError(String(failure.message||failure));}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;mounted.current=false;};
 },[bridge]);
 const update=useCallback(async patch=>{
  if(busy.current||loading||!bridge?.updateAppPreferences)return;
  busy.current=true;setSaving(true);setError('');
  try{const value=await bridge.updateAppPreferences(patch);if(mounted.current)setPreferences({enableSiteOpening:value?.enableSiteOpening===true});}
  catch(failure){if(mounted.current)setError(String(failure.message||failure));}
  finally{busy.current=false;if(mounted.current)setSaving(false);}
 },[bridge,loading]);
 return {preferences,loading,saving,error,update};
}
