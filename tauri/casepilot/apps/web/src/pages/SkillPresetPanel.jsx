import React from 'react';
import {getLocale,t} from '../language.js';
import {formatNumber,formatMoney} from '../format.js';
import './skillPresets.css';
const amount=(value,precision=2)=>Number.isFinite(value)?formatNumber(value,precision):'—';
const bonus=(value,unit='',precision=2)=>Number.isFinite(value)?'+'+amount(value,precision)+unit:'—';
export function SkillPresetCard({preset,selected,onSelect,disabled}){
 const s=preset.summary,b=s?.bonuses||{};
 return <article className={'skill-preset-card'+(selected?' selected':'')}>
  <div className="section-heading"><h4>{preset.name}</h4>{selected&&<span className="status-tag good">{t('Selecionado')}</span>}</div>
  <p className="skill-preset-goal">{t(preset.goal||'Seleção de habilidades')}</p><p className="form-note">{t(preset.description)}</p>
  {s?.available?<><dl className="skill-preset-values"><div><dt>{t('Chance de caixas')}</dt><dd>{bonus(b[15]||0,' p.p.')}</dd></div><div><dt>{t('Dinheiro por clique')}</dt><dd>{bonus(b[11]||0,' $',3)}</dd></div><div><dt>{t('Geração do cofre por minuto')}</dt><dd>{bonus(b[14]||0,' $',1)}</dd></div><div><dt>{t('Máximo de aberturas')}</dt><dd>{bonus(b[17]||0,'',0)}</dd></div><div><dt>{t('Multiplicador de abertura')}</dt><dd>{bonus(b[20]||0,'×',0)}</dd></div><div><dt>{t('Preço máximo da caixa')}</dt><dd>{bonus(b[19]||0,' $')}</dd></div></dl>
   <p className="skill-preset-cost">{t('Custo completo: ')}<strong>{formatMoney(s.totalCost)}</strong> · {s.totalPoints} {t('pontos')}</p>
   <p className="form-note">{t('Em falta nesta conta: ')}{s.missingPoints} {t('pontos')} · {formatMoney(s.missingCost)}</p>
   <details><summary>{t('Mapas e efeitos adicionais')}</summary><p>{s.maps.join(' · ')}</p><p>{t('Capacidade do cofre')}: {bonus(b[13]||0,' $',0)} · {t('Capacidade do inventário')}: {bonus(b[16]||0,'',0)}</p>{s.warnings?.map(w=><p className="progression-notice" key={w}>{t(w)}</p>)}</details>
  </>:<p className="form-note">{t(s?.reason||'Os valores serão calculados com os mapas desta conta.')}</p>}
  <button type="button" className={selected?'secondary-button':'primary-button'} aria-pressed={selected} disabled={disabled} onClick={()=>onSelect(preset.id)}>{t(selected?'Preset selecionado':'Escolher este preset')}</button>
 </article>;
}
export default function SkillPresetPanel({presets=[],selectedId,onSelect,reset,onReset,onPrepare,disabled,loading,error,readAt,onRefresh}){
 const selected=presets.find(p=>p.id===selectedId),s=selected?.summary,projection=s?.projection?.[reset?'reset':'add'];
 const percentage=projection?.casesPerClick,clicks=Number.isFinite(percentage)&&percentage>0&&percentage<=100?Math.ceil(100/percentage):null;
 return <section className="panel skill-presets" aria-label={t('Presets por objetivo')}>
  <div className="section-heading"><div><span className="kicker">{t('AUTO SKILL PRO · V17')}</span><h3>{t('Presets por objetivo')}</h3></div><button type="button" className="secondary-button" disabled={loading||disabled} onClick={onRefresh}>{t(loading?'A comparar mapas…':'Atualizar comparação')}</button></div>
  <p>{t('Escolhe entre geração de caixas, aberturas maiores e dinheiro por clique. A comparação usa os seis mapas da conta apresentada.')}</p>
  <p className="form-note">{t('Os valores com + são aumentos das habilidades do preset, não os totais finais da conta.')}</p>
  {loading&&<p role="status">{t('A comparar custos e efeitos nos mapas atuais…')}</p>}{error&&<p className="inline-error" role="alert">{t(error)}</p>}
  <div className="skill-preset-grid">{presets.filter(p=>!p.resetOnly).map(p=><SkillPresetCard key={p.id} preset={p} selected={p.id===selectedId} onSelect={onSelect} disabled={disabled}/>)}</div>
  <div className="skill-preset-selection">
   <label>{t('Preset')}<select value={selectedId} disabled={disabled} onChange={e=>onSelect(e.target.value)}><option value="">{t('Escolher preset…')}</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label className="progression-checkbox"><input type="checkbox" checked={reset} disabled={disabled} onChange={e=>onReset(e.target.checked)}/><span>{t('Incluir venda das habilidades atuais antes de aplicar o preset')}</span></label>
   {reset&&<p className="progression-notice">{t('Reset explícito: cada venda devolve apenas metade do custo. A revisão apresenta a perda, o reembolso e a sequência de dependências.')}</p>}
   {selected?.resetOnly&&<p className="progression-notice">{t('Este preset apenas vende as habilidades. Seleciona o reset explícito para continuar.')}</p>}
   {s?.available&&<div className="skill-preset-projection"><h4>{t('Estimativa para esta conta')}</h4><p>{t('Caixas por clique após a seleção: ')}<strong>{amount(percentage)}%</strong>{clicks&&<> · {clicks} {t('cliques por caixa')}</>}</p><p>{t('Pontos a comprar: ')}{reset?s.totalPoints:s.missingPoints} · {t('Dinheiro virtual a gastar')}: {formatMoney(reset?s.totalCost:s.missingCost)}</p>{s.warnings?.map(w=><p className="progression-notice" key={w}>{t(w)}</p>)}{!reset&&!s.canAdd&&<p className="progression-notice">{t('Há requisitos, saldo ou pontos por resolver. A revisão confirma o que esta conta pode aplicar.')}</p>}{reset&&<p>{t('Devolução prevista no reset: ')}{s.ownedPoints} {t('pontos')} · {formatMoney(s.resetRefund)}{t(' de reembolso e a mesma quantia de perda virtual.')}</p>}<p className="form-note">{t('Estimativa a partir do estado observado. Custos, requisitos e efeitos voltam a ser verificados na revisão.')}</p></div>}
   <button type="button" className="primary-button" disabled={!selected||disabled||(selected.resetOnly&&!reset)} onClick={()=>onPrepare('skill-preset',{presetId:selected.id,reset})}>{t('Rever preset')}{reset?' '+t('com reset'):''}</button>
  </div>
  {readAt&&<small className="form-note">{t('Comparação atualizada: ')}{new Date(readAt).toLocaleString(getLocale())}</small>}
 </section>;
}
