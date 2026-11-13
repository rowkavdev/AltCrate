'use strict';
const {parentPort}=require('node:worker_threads');
parentPort.on('message',async message=>{
  try{
    const value=message.kind==='edge'
      ? (await import('./blackjackEdge.js')).estimatePreBetEdge(message.state,{maxMs:750})
      : (await import('./blackjackFinite.js')).finiteShoeExpectedValues(message.state,{maxMs:300});
    parentPort.postMessage({id:message.id,value});
  }catch{parentPort.postMessage({id:message.id,value:{complete:false,reason:'worker'}});}
});
