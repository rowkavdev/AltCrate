import React from 'react';
import {t} from '../language.js';
export default function BoostsPanel({capability}){
 return <section className="panel" aria-label={t('Boosts')}><div className="section-heading"><h2>{t('Boosts')}</h2><span className="status-tag">{t('Por verificar')}</span></div><p>{t(capability?.reason||'Falta confirmar a lista de boosts, a ativação, o consumo e o prazo de cada efeito.')}</p><p className="form-note">{t('A indicação de um efeito ativo no site não basta para confirmar a sua ativação nesta aplicação.')}</p>{capability?.nextChecks?.length>0&&<details><summary>{t('O que falta verificar')}</summary><ul>{capability.nextChecks.map(check=><li key={check}>{t(check)}</li>)}</ul></details>}<button className="secondary-button" type="button" disabled>{t('Ativação indisponível')}</button><p className="muted">{t('Sem validação no jogo')}{capability?.observedAt?` · ${t('Fontes consultadas em ')}${capability.observedAt}`:''}</p></section>;
}
