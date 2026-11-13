const {isDeepStrictEqual}=require('node:util');
const {normalizeAutoOpen}=require('./progressionData.cjs');
function ordered(value){return Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;}
function openingConfiguration(raw){
 const normalized=normalizeAutoOpen(raw,[]),config=raw.config??Object.fromEntries(Object.entries(raw).filter(([key])=>key!=='activePresetId'));
 // Preserve fields introduced by the site as well as the validated known fields.
 return ordered({config:{...structuredClone(config),...normalized.config},activePresetId:normalized.activePresetId});
}
function openingPreparation(before){
 if(!before.config.autosellActivated||before.config.autosellAmount===0)return [];
 return [{kind:'disable-autosell',before,after:openingConfiguration({...before,config:{...before.config,autosellActivated:false}})}];
}
const sameConfiguration=(a,b)=>isDeepStrictEqual(a,b);
module.exports={openingConfiguration,openingPreparation,sameConfiguration};
