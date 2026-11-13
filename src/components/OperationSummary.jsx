import {t} from '../language.js';
import React from 'react';
import {ArrowUpRight} from 'lucide-react';
import {Card} from './ui/card.jsx';
import {Badge} from './ui/badge.jsx';
import {farmRunSummary} from '../farmViewModel.js';
import {formatTime} from '../format.js';
export default function OperationSummary({status={},onNavigate}){
 const entries=status.accounts||[],running=['running','stopping'].includes(status.phase);
 const paused=entries.filter(item=>item.paused).length;
 const summary=farmRunSummary(status);
 return <Card className="panel"><div className="section-heading"><h2>{t("Estado da automação")}</h2><Badge variant="secondary" className={running?'automation-running':undefined}>{t(running?'Em execução':'Parada')}</Badge></div><div className="operation-summary"><span><strong>{t(summary.active)}</strong>{t("Em curso")}</span><span><strong>{t(summary.queued)}</strong>{t("Na fila")}</span><span><strong>{t(summary.waiting)}</strong>{t("Em espera")}</span><span><strong>{t(summary.paused+summary.login)}</strong>{t("Por resolver")}</span></div><div className="operation-next"><p>{t(running&&status.budget?.waitUntil>Date.now()?'Próxima janela de cliques às '+formatTime(status.budget.waitUntil):running?String(status.clicksAvailable??status.budget?.combinedRemaining??'—')+' cliques disponíveis':paused?paused+' '+(paused===1?'conta pausada.':'contas pausadas.')+' Usa Retomar em Automação antes de Iniciar.':'Escolhe as contas e os modos para começar.')}</p>{onNavigate&&<a className="text-link" href="#automation" onClick={event=>{event.preventDefault();onNavigate('automation');}}>{t("Gerir automação ")}<ArrowUpRight size={16}/></a>}</div></Card>;
}
