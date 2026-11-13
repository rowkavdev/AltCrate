import {t} from '../language.js';
import React from 'react';
const fields=[
 ['rarity','Raridade',[['Consumer Grade','Consumer Grade'],['Industrial Grade','Industrial Grade'],['Mil-Spec Grade','Mil-Spec Grade'],['Restricted','Restricted'],['Classified','Classified'],['Covert','Covert'],['Contraband','Contraband'],['Base Grade','Base Grade'],['High Grade','High Grade'],['Remarkable','Remarkable'],['Exotic','Exotic'],['Extraordinary','Extraordinary'],['Distinguished','Distinguished'],['Exceptional','Exceptional'],['Superior','Superior'],['Master','Master']]],
 ['exterior','Exterior',['Factory New','Minimal Wear','Field-Tested','Well-Worn','Battle-Scarred'].map(value=>[value,value])],
 ['quality','Qualidade',[['0','Comum'],['1','Rara'],['2','Épica'],['3','Lendária']]],
 ['statTrakSouvenir','StatTrak / Souvenir',[['None','Sem StatTrak nem Souvenir'],['Non ST','Sem StatTrak'],['Non SV','Sem Souvenir'],['Only ST','Só StatTrak'],['Only SV','Só Souvenir']]],
];
export default function InventoryFilters({values,onChange,events=[],scope='inventory'}){
 return <div className="inventory-controls inventory-advanced-filters">{fields.map(([key,label,options])=><label key={key}>{t(label)}<select aria-label={t(label)+' ('+scope+')'} value={values[key]??''} onChange={event=>onChange({[key]:event.target.value})}><option value="">{t("Todos")}</option>{options.map(([value,title])=><option key={value} value={value}>{t(title)}</option>)}</select></label>)}<label>{t("Evento")}<select aria-label={t('Evento')+' ('+scope+')'} value={values.eventName||''} onChange={event=>onChange({eventName:event.target.value})}><option value="">{t("Todos")}</option>{events.filter(event=>event.value).map(event=><option key={event.value} value={event.value}>{event.value==='None'?t('Sem evento'):event.value==='All'?t('Só eventos'):event.label}</option>)}</select></label></div>;
}
