import english from './locales/en.json' with {type:'json'};

export const getLocale = () => 'en-GB';
const escapePattern=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// These slots contain engine messages. Other placeholders can contain account or item names.
const nestedMessages = new Map([
  ['O item ficou no inventário. {0}', ['0']],
  ['Depósito não enviado. {0}', ['0']],
  ['Depósito por confirmar. {0}', ['0']],
  ['Consulta do ranking falhou; item conservado. {0}', ['0']],
  ['{0} indisponível: {1}', ['0', '1']],
]);
const patterns=Object.entries(english).filter(([key])=>/\{\d+\}/.test(key)).map(([key,value])=>{
  const slots=[];
  const parts=key.split(/(\{\d+\})/);
  const expression=parts.map(part=>{const match=part.match(/^\{(\d+)\}$/);if(!match)return escapePattern(part);slots.push(match[1]);return '(.+?)';}).join('');
  return {prefix:parts[0],pattern:new RegExp('^'+expression+'$'),slots,value,nested:nestedMessages.get(key)};
});
// Translate presentation text only; identifiers, input values and API payloads stay untouched.
export function translateText(value){
  if(typeof value!=='string'||!value.trim())return value;
  const text=value.trim();
  if(!/[A-Za-zÀ-ÿ]/.test(text))return value;
  let translated=Object.hasOwn(english,text)?english[text]:undefined;
  if(translated===undefined){
    for(const entry of patterns){
      if(!text.startsWith(entry.prefix))continue;
      const match=text.match(entry.pattern);
      if(!match)continue;
      const variables=Object.fromEntries(entry.slots.map((slot,index)=>[slot,match[index+1]]));
      translated=entry.value.replace(/\{(\d+)\}/g,(_,slot)=>entry.nested?.includes(slot)?translateText(variables[slot]):variables[slot]);break;
    }
  }
  if(translated===undefined&&/ · |: | \+| → /.test(text)){
    translated=text.split(/( · |: | \+| → )/).map(translateText).join('');
  }
  return translated===undefined?value:value.slice(0,value.length-value.trimStart().length)+translated+value.slice(value.trimEnd().length);
}
export function t(value){
  return Array.isArray(value)?value.map(t):translateText(value);
}
