import {t} from './language.js';
import React, {useEffect,useState} from 'react';

export function LocalAiControls({status,mode,setMode,running,reload}) {
  const ready=status.phase==='ready';
  const validation=status.validation;
  return <section className="local-ai-panel" aria-label={t("Motor de decisão Blackjack")}>
    <div><span className="kicker">{t("MATEMÁTICA E IA NO MAC")}</span><h3>{t("Motor de decisão")}</h3><p role="status">{t(mode==='math'?'Cálculo local · independente da IA':mode==='table'?'Tabela de estratégia básica':ready?'Modelo local pronto':status.phase==='loading'?'A carregar o modelo…':status.message||'A verificar o modelo…')}</p></div>
    <label>{t("Modo")}<select value={mode} disabled={running} onChange={event=>setMode(event.target.value)}>
      <option value="math">{t("Composição do baralho · experimental")}</option>
      <option value="table">{t("Estratégia básica")}</option>
      <option disabled={!ready} value="hybrid">{t("IA local + validação matemática")}</option>
      <option disabled={!ready} value="compare">{t("Comparar IA · joga a tabela")}</option>
      <option disabled={!ready} value="laya">{t("IA local · experimental")}</option>
    </select></label>
    <button type="button" className="game-secondary" disabled={running||status.phase==='loading'} onClick={reload}>{t("Recarregar IA")}</button>
    {validation&&<details className="local-ai-benchmark"><summary>{t("Avaliação da IA local")}</summary><div><b>{t("IA sozinha: ")}{t(validation.agreement)}/{t(validation.cases)}</b>{t(" escolhas iguais à referência · mediana ")}{t(validation.p50Ms)}{t(" ms")}{validation.validatedAgreement!=null&&<span>{t("Com validação: ")}{t(validation.validatedAgreement)}/{t(validation.cases)}{t(" · resultado da combinação com a referência, não aprendizagem da IA.")}</span>}<span>{t("Teste local de mãos sintéticas. Mede decisões, não ganhos.")}</span></div></details>}
    <p className="game-cost">{t("Composição usa apenas cartas reveladas, desde um início acompanhado, e regressa à tabela se faltar informação ou tempo. A IA local e a composição são experimentais. Nenhum modo prevê a carta oculta ou garante ganhos.")}</p>
    <details className="engine-explanation"><summary>{t("Como cada modo decide")}</summary><p>{t("Composição calcula todas as tuas mãos sem reposição de cartas, com saldo e divisões partilhados. Exige início vazio de uma mesa criada aqui ou renovação observada. IA com validação rejeita propostas piores no cálculo aproximado; Comparar joga a tabela. IA experimental usa a proposta do modelo, com tabela se falhar. Os cálculos ficam neste Mac; login e saldo não são enviados ao modelo.")}</p></details>
  </section>;
}
export default function LocalAiPanel({mode,setMode,running,onReady}) {
  const [status,setStatus]=useState({phase:'idle'});
  useEffect(()=>{
    let alive=true;
    const update=async()=>{try {const value=await window.caseClicker.localAiStatus();if(alive){setStatus(value);onReady(value.phase==='ready');}}catch{if(alive){setStatus({phase:'missing',message:'IA local indisponível nesta versão.'});onReady(false);}}};
    update();const timer=setInterval(update,3000);
    return()=>{alive=false;clearInterval(timer);};
  },[onReady]);
  async function reload(){setStatus({phase:'loading'});onReady(false);try{const value=await window.caseClicker.prepareLocalAi();setStatus(value);onReady(value.phase==='ready');}catch{const value=await window.caseClicker.localAiStatus().catch(()=>({phase:'error',message:'Não foi possível iniciar a IA local.'}));setStatus(value);onReady(false);}}
  return <LocalAiControls status={status} mode={mode} setMode={setMode} running={running} reload={reload}/>;
}
