import english from './locales/en.json' with {type:'json'};

export const LANGUAGE_STORAGE_KEY='casepilot:language';
export function createLanguageStore(storage){
  let language='pt';
  try{if(storage?.getItem(LANGUAGE_STORAGE_KEY)==='en')language='en';}catch{/* The preference still works when storage is unavailable. */}
  const listeners=new Set();
  return {
    getSnapshot:()=>language,
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    setLanguage(next){
      if(!['pt','en'].includes(next)||next===language)return;
      language=next;
      try{storage?.setItem(LANGUAGE_STORAGE_KEY,next);}catch{}
      for(const listener of listeners)listener();
    },
  };
}
let storage;
try{storage=globalThis.localStorage;}catch{}
export const languageStore=createLanguageStore(storage);
export const getLocale=()=>languageStore.getSnapshot()==='en'?'en-GB':'pt-PT';
const escapePattern=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.entries(english).filter(([key])=>/\{\d+\}/.test(key)).map(([key,value])=>{
  const slots=[];
  const parts=key.split(/(\{\d+\})/);
  const expression=parts.map(part=>{const match=part.match(/^\{(\d+)\}$/);if(!match)return escapePattern(part);slots.push(match[1]);return '(.+?)';}).join('');
  return {prefix:parts[0],pattern:new RegExp('^'+expression+'$'),slots,value};
});
// Translate presentation text only; identifiers, input values and API payloads stay untouched.
export function translateText(value,language=languageStore.getSnapshot()){
  if(language!=='en'||typeof value!=='string'||!value.trim())return value;
  const text=value.trim();
  if(!/[A-Za-zÀ-ÿ]/.test(text))return value;
  let translated=Object.hasOwn(english,text)?english[text]:undefined;
  if(translated===undefined){
    for(const entry of patterns){
      if(!text.startsWith(entry.prefix))continue;
      const match=text.match(entry.pattern);
      if(!match)continue;
      const variables=Object.fromEntries(entry.slots.map((slot,index)=>[slot,match[index+1]]));
      translated=entry.value.replace(/\{(\d+)\}/g,(_,slot)=>variables[slot]);break;
    }
  }
  if(translated===undefined&&/ · |: | \+| → /.test(text)){
    translated=text.split(/( · |: | \+| → )/).map(part=>translateText(part,language)).join('');
  }
  return translated===undefined?value:value.slice(0,value.length-value.trimStart().length)+translated+value.slice(value.trimEnd().length);
}
export function t(value){
  return Array.isArray(value)?value.map(t):translateText(value);
}
