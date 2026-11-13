import {useEffect,useSyncExternalStore} from 'react';
import {languageStore,getLocale} from './language.js';
export function useLanguage(){
  const language=useSyncExternalStore(languageStore.subscribe,languageStore.getSnapshot,()=> 'pt');
  useEffect(()=>{document.documentElement.lang=getLocale();},[language]);
  return {language,setLanguage:languageStore.setLanguage};
}
