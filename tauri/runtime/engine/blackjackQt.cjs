'use strict';
const {Worker}=require('node:worker_threads');
const path=require('node:path');

function createEvaluator(){
  const slots=[],queue=[],tasks=new Map();let sequence=0,disposed=false;
  function dispatch(){
    for(const slot of slots){
      if(slot.id||!queue.length)continue;
      const task=queue.shift();if(!tasks.has(task.id))continue;
      slot.id=task.id;slot.worker.postMessage(task);
    }
  }
  function start(){
    for(let i=0;i<4;i++){
      const slot={id:null,worker:new Worker(path.join(__dirname,'../strategy/evaluator-worker.cjs'))};
      slot.worker.on('message',message=>{
        const task=tasks.get(message.id);tasks.delete(message.id);clearTimeout(task?.timer);task?.resolve(message.value);slot.id=null;dispatch();
      });
      slot.worker.on('error',()=>{const task=tasks.get(slot.id);tasks.delete(slot.id);clearTimeout(task?.timer);task?.resolve({complete:false,reason:'worker'});slot.id=null;});
      slots.push(slot);
    }
  }
  return {
    evaluate(state,kind='finite'){
      if(disposed||tasks.size>=64)return Promise.resolve({complete:false,reason:'worker'});
      if(!slots.length)start();const id=++sequence;
      return new Promise(resolve=>{
        const timer=setTimeout(()=>{tasks.delete(id);resolve({complete:false,reason:'timeout'});},2000);
        tasks.set(id,{resolve,timer});queue.push({id,state,kind});dispatch();
      });
    },
    dispose(){disposed=true;for(const task of tasks.values()){clearTimeout(task.timer);task.resolve({complete:false,reason:'worker'});}tasks.clear();for(const slot of slots)slot.worker.terminate();queue.length=0;},
  };
}

async function createBlackjackQt({commands,emit,listAccounts,localAi,socketGames}){
  const {createBlackjackAutoRunner,blackjackCardValue,nextBlackjackCommand}=await import('../strategy/blackjackAuto.js');
  const {createShoeTracker,analyzeBlackjackPayouts,summarizeEngineCoverage}=await import('../strategy/blackjackResearch.js');
  const {chooseFiniteMove}=await import('../strategy/blackjackFinite.js');
  const {resolveBlackjackRules,jointStateForSeat}=await import('../strategy/blackjackRules.js');
  const {planAdvantageStake}=await import('../strategy/blackjackEdge.js');
  const {validateLocalProposal}=await import('../strategy/blackjackEv.js');
  const {addBlackjackResult,summarizeBlackjackResults}=await import('../strategy/blackjackStats.js');
  const fs=require('node:fs');
  const simulation=JSON.parse(fs.readFileSync(path.join(__dirname,'../strategy/blackjackSimulation.json'),'utf8'));
  const evaluator=createEvaluator(),entries=new Map();let stats={rounds:{},byAccount:{}},startGeneration=0;
  function get(id){
    if(!entries.has(id))entries.set(id,{id,connected:false,events:{},tokens:null,shoe:createShoeTracker(),runner:null,mode:'math',stake:null,decision:null,edge:null,reason:null});
    return entries.get(id);
  }
  function view(entry){return {accountId:entry.id,active:entry.runner?.active===true,mode:entry.mode,reason:entry.reason,stake:entry.stake,decision:entry.decision,edge:entry.edge,shoe:entry.shoe.snapshot(),rules:resolveBlackjackRules(entry.events.blackjackConfig),stats:stats.byAccount[entry.id]||null,reference:nextBlackjackCommand({...context(entry),amount:entry.stake?.amount||1})?.payload?.move||null};}
  function publish(entry){emit({type:'blackjack-qt',accountId:entry.id,state:view(entry)});}
  function context(entry){return {connected:entry.connected,events:entry.events,tokens:entry.tokens,pending:false};}
  async function choosePlay(entry,current,command){
    const table=current.events.blackjackTableState,seat=table?.seats.find(s=>s?.mine),hand=seat?.hands?.[seat.activeHandIndex];
    if(!hand||!table.dealerCards?.[0])return null;
    const extra=hand.bet||seat.bet,funded=Number.isFinite(extra)&&current.tokens>=extra;
    const canDouble=funded&&hand.cards.length===2&&!hand.splitAces;
    const canSplit=canDouble&&seat.hands.length<4&&blackjackCardValue(hand.cards[0])===blackjackCardValue(hand.cards[1]);
    const input={cards:hand.cards.map(card=>card.rank),dealer:table.dealerCards[0].rank,canDouble,canSplit,fromSplit:hand.fromSplit===true};
    if(entry.mode==='table')return {move:command.payload.move,engine:'table'};
    if(entry.mode==='math'){
      const shoe=entry.shoe.snapshot(),resolved=resolveBlackjackRules(current.events.blackjackConfig);
      const reason=!resolved.compatible?'rules':!shoe.usable||table.shuffleCount!==shoe.shuffleCount?'coverage':table.dealerHoleCardHidden!==true?'hole':table.seats.filter(s=>s?.hands?.length).length!==1?'other-seats':null;
      const joint=jointStateForSeat(table,shoe,current.tokens,canDouble,canSplit,resolved.rules);
      if(reason||!joint){entry.decision={complete:false,reason:reason||'invalid'};return {move:command.payload.move,engine:'table',math:{complete:false,reason:reason||'invalid',remaining:shoe.remaining,shuffleCount:shoe.shuffleCount}};}
      const calculated=await evaluator.evaluate(joint),move=chooseFiniteMove(calculated,command.payload.move);
      entry.decision={...calculated,move,reference:command.payload.move};
      return {move,engine:calculated.complete?'finite-shoe':'table',math:{complete:calculated.complete,reason:calculated.reason,scope:calculated.scope,origin:shoe.origin,ruleSource:resolved.source,remaining:shoe.remaining,runningCount:shoe.runningCount,shuffleCount:shoe.shuffleCount,chosenEv:calculated.peek?.[move]}};
    }
    const answer=await localAi.predict(input),checked=validateLocalProposal(input,command.payload.move,answer.move);
    const move=entry.mode==='laya'?answer.move:entry.mode==='hybrid'?checked.move:command.payload.move;
    entry.decision={...answer,reference:command.payload.move,chosen:move,checked};
    return {move,engine:entry.mode==='laya'?'laya':entry.mode==='hybrid'?'laya-validated':'table-compare',aiMove:answer.move,latencyMs:answer.latencyMs};
  }
  async function chooseBet(entry,current,{ceiling}){
    const table=current.events.blackjackTableState,shoe=entry.shoe.snapshot(),resolved=resolveBlackjackRules(current.events.blackjackConfig);
    const options={tokens:current.tokens,minBet:table.minBet??1,maxBet:table.maxBet??5000000,ceiling};
    const minimum=planAdvantageStake(options,null);
    const reason=!resolved.compatible?'rules':!shoe.usable||table.shuffleCount!==shoe.shuffleCount?'coverage':!minimum.reserveCovered?'reserve':table.seats.some(s=>s?.occupied&&!s.mine)?'other-seats':null;
    const result=reason?{complete:false,reason}:await evaluator.evaluate({counts:shoe.counts,rules:resolved.rules,stakeUnit:minimum.unit},'edge');
    const plan=planAdvantageStake(options,result);entry.edge={...result,...plan};
    return {...plan,betting:{policy:'edge',complete:result.complete,reason:result.reason||plan.reason,lowerBound:result.lowerBound,meanPeek:result.peek?.mean,meanNoPeek:result.noPeek?.mean,secondMoment:result.secondMoment,samples:result.samples,confidence:result.assumptions?.confidence,unit:minimum.unit,ceiling,reserveCovered:plan.reserveCovered,remaining:shoe.remaining,shuffleCount:shoe.shuffleCount,origin:shoe.origin}};
  }
  async function start(config){
    const generation=++startGeneration;
    const ids=config?.accountIds,known=await listAccounts();
    if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>!known.some(a=>a.id===id))||!Number.isSafeInteger(config.amount)||config.amount<1||config.amount>5000000||!['table','math','compare','hybrid','laya'].includes(config.mode)||!['fixed','edge','win-double-loss-half'].includes(config.progression))throw Error('Configuração de Blackjack automático inválida');
    if(['compare','hybrid','laya'].includes(config.mode)&&localAi.status().phase!=='ready')throw Error('A IA local não está pronta');
    for(const id of ids){
      if(generation!==startGeneration)break;
      const entry=get(id);entry.runner?.stop();entry.reason=null;entry.mode=config.mode;
      entry.runner=createBlackjackAutoRunner({
        send:async(action,payload)=>{
          if(action==='create')entry.shoe.beginCreation();
          const result=await commands.execute('games:action',[id,'blackjack',action,{...payload,source:'auto'}]);
          return result.sent===true;
        },choosePlay:(current,command)=>choosePlay(entry,current,command),chooseBet:(current,options)=>chooseBet(entry,current,options),
        onStop:reason=>{entry.reason=reason;publish(entry);},onHalt:()=>{entry.connected=false;entry.events={};entry.shoe.invalidate('Mesa desligada; aguarda uma nova renovação');void commands.execute('games:leave',[id,'blackjack']).catch(()=>{});publish(entry);},onStake:stake=>{entry.stake=stake;publish(entry);},
      });
      const loaded=await commands.execute('games:load',[id,'blackjack',{resume:true}]);
      if(generation!==startGeneration){await commands.execute('games:leave',[id,'blackjack']);break;}
      entry.connected=loaded.socket?.connected===true;entry.events=loaded.socket?.events||{};entry.tokens=loaded.tokens;
      entry.runner.start(Date.now(),config.amount,{progression:config.progression});publish(entry);
      void entry.runner.observe(context(entry));
    }
    return status();
  }
  function stop(ids){startGeneration++;for(const entry of entries.values())if(!ids||ids.includes(entry.id)){entry.runner?.stop();publish(entry);}return status();}
  function status(){return {rows:[...entries.values()].map(view),stats:summarizeBlackjackResults(stats)};}
  function observe(event){
    if(event.type!=='socket-game-update'||event.game!=='blackjack')return;
    const entry=get(event.accountId);
    if(event.event==='connect')entry.connected=true;
    else if(['disconnect','connect_error'].includes(event.event))entry.connected=false;
    else entry.events[event.event]=event.data;
    if(event.event==='userstats'&&Number.isFinite(event.data?.tokens))entry.tokens=event.data.tokens;
    if(event.event==='blackjackTableState'){entry.shoe.observe(event.data);stats=addBlackjackResult(stats,entry.id,event.data);}
    void entry.runner?.observe(context(entry)).catch(error=>{entry.runner.stop(error.message);});
    publish(entry);
  }
  commands.handle('blackjack:auto-start',(_event,config)=>start(config));
  commands.handle('blackjack:auto-stop',(_event,ids)=>{if(ids!==undefined&&(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')))throw Error('Contas inválidas');return stop(ids);});
  commands.handle('blackjack:qt-status',()=>status());
  commands.handle('blackjack:research',(_event,id)=>{const rows=socketGames.history(id);return {rows,payouts:analyzeBlackjackPayouts(rows),coverage:summarizeEngineCoverage(rows),simulation:simulation.validation,engine:id?view(get(id)):status()};});
  commands.handle('blackjack:self-check',async()=>{
    const fixtures=[{name:'Carta oculta',state:{cards:['K','Q'],dealer:'10',counts:[1,0,0,0,0,1,0,0,0,1],canDouble:true},expected:.5,move:'stand'},
      {name:'Dividir e dobrar',state:{cards:['2','2'],dealer:'9',counts:[0,0,0,0,0,0,0,12,0,0],canDouble:true,canSplit:true,availableUnits:3,rules:{maxHandsPerSeat:2}},expected:4,move:'split'},
      {name:'Saldo para a divisão',state:{cards:['2','2'],dealer:'9',counts:[0,0,0,0,0,0,0,12,0,0],canDouble:true,canSplit:true,availableUnits:1,rules:{maxHandsPerSeat:2}},expected:2,move:'split'},
      {name:'Vantagem antes da aposta',kind:'edge',state:{counts:[20,0,0,0,0,0,0,0,0,80],stakeUnit:2}}];
    const rows=[];for(const fixture of fixtures){const result=await evaluator.evaluate(fixture.state,fixture.kind);rows.push({name:fixture.name,passed:result.complete&&(fixture.kind==='edge'?result.lowerBound>0:Math.abs(result.peek[fixture.move]-fixture.expected)<1e-9),reason:result.reason,latencyMs:result.latencyMs});}return rows;
  });
  const timer=setInterval(()=>{for(const entry of entries.values())if(entry.runner?.active)void entry.runner.observe(context(entry));},250);timer.unref();
  return {observe,stop,beginCreation:id=>get(id).shoe.beginCreation(),loaded(id,value){const entry=get(id);entry.connected=value.socket?.connected===true;entry.events=value.socket?.events||{};entry.tokens=value.tokens;},dispose(){stop();clearInterval(timer);evaluator.dispose();}};
}
module.exports={createBlackjackQt,createEvaluator};
