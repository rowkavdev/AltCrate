import {useEffect,useMemo,useState} from 'react';
import {createServerSettingsController} from './farmServerSettings.js';
export function useFarmServer(bridge,executionKind){
 const [state,setState]=useState(null);const available=typeof bridge?.farmServerConfig==='function';
 const controller=useMemo(()=>available?createServerSettingsController({bridge,onChange:setState}):null,[bridge,available]);
 useEffect(()=>{if(controller)controller.load();},[controller,executionKind]);
 useEffect(()=>bridge?.onEvent?.(event=>{if(event.type==='server-setup')controller?.installationProgress(event.stage);}),[bridge,controller]);
 return {available,...(state||controller?.snapshot()),controller};
}
