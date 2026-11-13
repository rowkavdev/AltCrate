import {t,getLocale} from './language.js';
import React from 'react';
import {resolveBlackjackRules} from './blackjackRules.js';
import {createFiniteEvaluator} from './finiteClient.js';
import simulation from './blackjackSimulation.json';
import {analyzeBlackjackPayouts,summarizeEngineCoverage} from './blackjackResearch.js';
const number=n=>n.toLocaleString(getLocale(),{maximumFractionDigits:3});

export function ProgressionControl({value,onChange,running}) {
  return <label>{t("Regra da próxima aposta")}<select value={value} disabled={running} onChange={event=>onChange(event.target.value)}><option value="edge">{t("Vantagem estimada · reserva para mãos")}</option><option value="win-double-loss-half">{t("Vitória ×2 · derrota ÷2")}</option><option value="fixed">{t("Aposta fixa")}</option></select><small>{t(value==='edge'?'Simulação local antes da aposta. Usa uma fração conservadora do saldo, dentro do teto e com espaço para até quatro mãos duplicadas. As hipóteses do baralho continuam por confirmar.':'Empate mantém. Metades arredondadas para baixo; respeita o mínimo e máximo da mesa. Cada conta tem a sua progressão.')}</small></label>;
}
export function ShoeReadout({shoe,stake}) {
  return <div className="shoe-readout" role="status">
    {stake&&<div><span>{t("PRÓXIMA APOSTA")}</span><strong>{t(Number.isFinite(stake.amount)?`${number(stake.amount)} tokens`:'A calcular')}</strong><small>{t(({initial:'Aposta inicial',win:'Após vitória · regra ×2',loss:'Após derrota · regra ÷2',push:'Empate: mantida',planning:'A avaliar saldo e composição',minimum:'Aposta pequena · sem margem positiva demonstrada',edge:'Margem positiva no modelo · aposta ajustada',deadline:'Prazo curto · aposta mínima',unavailable:'Estimativa indisponível · aposta mínima'})[stake.reason])}{t(" · limites da mesa aplicados")}</small></div>}
    <div><span>{t("BARALHO OBSERVADO")}</span><strong>{t(shoe.usable?`${shoe.observed} cartas · ${shoe.remaining} desconhecidas`:'Contagem sem início confirmado')}</strong><small>{t(shoe.usable?`Hi-Lo ${shoe.runningCount>=0?'+':''}${shoe.runningCount} · por baralho ${number(shoe.trueCount??0)} · ${shoe.origin==='new-private-table'?'início de mesa privada observado':'renovação observada'} ${shoe.shuffleCount}`:shoe.reason)}</small></div>
    <small>{t("Conta apenas cartas reveladas após início vazio de uma mesa criada pela app ou renovação observada. Usa os 6 baralhos anunciados; não comprova o embaralhamento no backend. A contagem não revela a carta oculta. O modo de vantagem usa uma simulação separada para calcular a aposta.")}</small>
  </div>;
}
export default function PayoutReview({rows}) {
  const audit=analyzeBlackjackPayouts(rows);
  return <section className="payout-review"><div><span className="kicker">{t("PAGAMENTO DO BLACKJACK")}</span><h3>{t("3:2 anunciado · resultado recebido")}</h3></div><p>{t(audit.naturals?`${audit.naturals} Blackjack(s) naturais · ${audit.exact} pagos exatamente a 3:2 · ${audit.short} abaixo desse valor`:'A aguardar um Blackjack natural com aposta e pagamento confirmados.')}</p>{audit.short>0&&<p className="audit-deviation">{t("Diferença acumulada: ")}{t(number(audit.shortfall))}{t(" tokens. ")}{t(audit.floorCompatible)}/{t(audit.naturals)}{t(" pagamentos compatíveis com arredondamento para baixo. Esta observação não confirma a regra do servidor.")}</p>}<div className="payout-examples">{audit.examples.slice(-6).map(row=><span key={`${row.accountId}:${row.roundNumber}:${row.handIndex}`}>{t("Ronda ")}{t(row.roundNumber)}{t(" · aposta ")}{t(number(row.bet))}{t(" · recebido ")}{t(number(row.payout))}{t(" · 3:2 devolveria ")}{t(number(row.expected))}</span>)}</div><small>{t("Os valores incluem a devolução da aposta. Só analisa naturais confirmados; empates e mãos divididas ficam excluídos.")}</small></section>;
}

export function RulesReadout({config}) {
 const resolved=resolveBlackjackRules(config);
 return <details className="payout-review"><summary>{t("Regras e cobertura do cálculo")}</summary><p>{t("Cliente público: 6 baralhos · dealer para em soft 17 · Blackjack 3:2 · até 4 mãos · dobrar após dividir · uma carta nos ases divididos.")}</p><p>{t(Object.keys(resolved.announced).length?`Servidor anunciou ${Object.keys(resolved.announced).length} regra(s). ${resolved.compatible?'Compatíveis com o cliente.':`Diferenças: ${resolved.conflicts.join(', ')}. Automático suspenso.`}`:'O servidor ainda não anunciou regras detalhadas nesta sessão.')}</p><small>{t("Peek do dealer, arredondamento de prémios e método de embaralhamento continuam por confirmar. O cálculo testa peek e ausência de peek; só muda a tabela quando ambas concordam. A renovação observada confirma o contador público, não a aleatoriedade do servidor.")}</small></details>;
}
export function FiniteSelfCheck({running}) {
 const [result,setResult]=React.useState(null),[busy,setBusy]=React.useState(false);
 const evaluator=React.useRef(null),mounted=React.useRef(true);
 React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;evaluator.current?.dispose();};},[]);
 async function check() {
  if(busy||running)return;setBusy(true);setResult(null);
  if(!evaluator.current)evaluator.current=createFiniteEvaluator();
  const fixtures=[
   {name:'Carta oculta',state:{cards:['K','Q'],dealer:'10',counts:[1,0,0,0,0,1,0,0,0,1],canDouble:true},expected:.5,move:'stand'},
   {name:'Dividir e dobrar',state:{cards:['2','2'],dealer:'9',counts:[0,0,0,0,0,0,0,12,0,0],canDouble:true,canSplit:true,availableUnits:3,rules:{maxHandsPerSeat:2}},expected:4,move:'split'},
   {name:'Saldo para a divisão',state:{cards:['2','2'],dealer:'9',counts:[0,0,0,0,0,0,0,12,0,0],canDouble:true,canSplit:true,availableUnits:1,rules:{maxHandsPerSeat:2}},expected:2,move:'split'},
   {name:'Vantagem antes da aposta',kind:'edge',state:{counts:[20,0,0,0,0,0,0,0,0,80],stakeUnit:2}}
  ];
  const rows=[];
  for(const fixture of fixtures){const answer=await evaluator.current.evaluate(fixture.state,{kind:fixture.kind||'finite'});if(!mounted.current)return;rows.push({name:fixture.name,passed:answer.complete&&(fixture.kind==='edge'?answer.lowerBound>0:Math.abs(answer.peek[fixture.move]-fixture.expected)<1e-9),reason:answer.reason,latencyMs:answer.latencyMs});}
  setResult(rows);setBusy(false);
 }
 return <section className="payout-review finite-self-check" aria-label={t("Verificação local do motor")}><div><span className="kicker">{t("VERIFICAÇÃO LOCAL")}</span><h3>{t("Cálculo pronto neste Mac")}</h3></div><button type="button" className="game-secondary" disabled={running||busy} onClick={check}>{t(busy?'A verificar…':'Verificar cálculo sem apostar')}</button><p>{t(result?`${result.filter(row=>row.passed).length}/${result.length} verificações passaram no motor desta app.`:'Confirma o processamento em segundo plano com cartas fictícias. Não envia pedidos ao site nem altera contas.')}</p>{result?.map(row=><small key={row.name}>{t(row.passed?'✓':'✗')} {row.name} · {t(row.passed?`${row.latencyMs} ms`:row.reason||'resultado inesperado')}<br/></small>)}</section>;
}

export function EngineCoverage({rows}) {
 const out=summarizeEngineCoverage(rows);
 const labels={coverage:'Sem início acompanhado',rules:'Regras diferentes',hole:'Carta oculta desconhecida','other-seats':'Outros jogadores',budget:'Limite de cálculo',exhausted:'Composição insuficiente',timeout:'Prazo do motor',worker:'Motor indisponível',invalid:'Estado incompleto',unknown:'Motivo não registado'};
 return <section className="payout-review"><span className="kicker">{t("DECISÕES REALMENTE ENVIADAS")}</span><h3>{t(out.computed)}{t(" por composição · ")}{t(out.reference)}{t(" por referência · ")}{t(out.fallback)}{t(" com recurso à tabela")}</h3><p>{t(Object.entries(out.reasons).map(([reason,n])=>`${labels[reason]||reason}: ${n}`).join(' · ')||'Os próximos comandos confirmam qual motor foi usado. Ganhar uma ronda não prova que o cálculo por composição esteve ativo.')}</p><small>{t("Conta comandos de jogo registados nesta sessão. Estes números medem uso do motor, não vitórias.")}</small></section>;
}

export function SimulationReadout() {
 const data=simulation.validation;
 const format=n=>n.toLocaleString(getLocale(),{minimumFractionDigits:3,maximumFractionDigits:3});
 const formatCi=n=>n.toLocaleString(getLocale(),{minimumFractionDigits:5,maximumFractionDigits:5});
 return <details className="payout-review simulation-readout"><summary>{t("Comparação offline v0.2.14 · resultado inconclusivo")}</summary><p>{t("Estudo da versão 0.2.14, anterior à aposta por vantagem. 2 000 pares de rondas em cada cenário; cada motor recebe as mesmas cartas. Aposta inicial fixa de 1 unidade, sem a progressão ×2/÷2.")}</p><table><thead><tr><th>{t("Cenário")}</th><th>{t("Tabela · resultado")}</th><th>{t("Composição · resultado")}</th><th>{t("Diferença média por ronda")}</th><th>{t("Intervalo aproximado de 95%")}</th></tr></thead><tbody>{Object.entries(data.scenarios).map(([key,row])=><tr key={key}><td>{t(key==='peek'?'Com peek':'Sem peek')}</td><td>{t(format(row.table.net))}{t(" unidades")}</td><td>{t(format(row.math.net))}{t(" unidades")}</td><td>{t(format(row.pairedDifferencePerInitialUnit))}</td><td>{t(row.approximate95PercentCI.map(formatCi).join(' a '))}</td></tr>)}</tbody></table><p>{t("Os dois intervalos incluem zero: não demonstram superioridade. A primeira amostra, de 500 pares, favoreceu a tabela. Estes valores são de uma simulação; não são ganhos das tuas contas.")}</p><small>{t(data.decisions.computed)}{t(" decisões calculadas · ")}{t(data.decisions.fallback)}{t(" usaram a tabela por limite de cálculo · ")}{t(data.decisions.changed)}{t(" escolhas diferentes. Regras de peek, arredondamento e embaralhamento reais continuam por confirmar.")}</small></details>;
}

export function EdgeReadout({data}) {
 const percent=n=>Number.isFinite(n)?`${(100*n).toLocaleString(getLocale(),{minimumFractionDigits:2,maximumFractionDigits:2})}%`:'—';
 const labels={coverage:'Aguarda início acompanhado do baralho',rules:'Regras diferentes',reserve:'Saldo insuficiente para financiar todas as mãos',budget:'Estimativa excedeu o tempo disponível',timeout:'Prazo do motor excedido',worker:'Motor indisponível',exhausted:'Cartas insuficientes para o modelo','other-seats':'Outros jogadores na mesa'};
 return <div className="edge-readout" role="status"><span className="kicker">{t("APOSTA POR VANTAGEM ESTIMADA")}</span><h4>{t(data.reason==='edge'?'Aposta ajustada à margem do modelo':'Aposta pequena nesta ronda')} · {t(Number.isFinite(data.amount)?`${number(data.amount)} tokens`:'Sem aposta válida')}</h4>{data.complete?<p>{t(data.samples.toLocaleString(getLocale()))}{t(" simulações por cenário · retorno médio: ")}{t(percent(data.peek.mean))}{t(" com peek / ")}{t(percent(data.noPeek.mean))}{t(" sem peek · limite inferior conservador: ")}{t(percent(data.lowerBound))}</p>:<p>{t(labels[data.reason]||'Estimativa indisponível nesta ronda')}</p>}<small>{t(data.reserveCovered?'Saldo permite até quatro mãos duplicadas.':'O saldo atual não financia todas as divisões/duplicações; as ações continuam limitadas ao saldo.')}{t(" Estimativa condicional: 6 baralhos, S17, 3:2 arredondado para baixo. O intervalo mede incerteza da simulação; não valida as regras nem o embaralhamento do servidor.")}</small></div>;
}
