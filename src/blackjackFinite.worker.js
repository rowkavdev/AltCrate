import {finiteShoeExpectedValues} from './blackjackFinite.js';
import {estimatePreBetEdge} from './blackjackEdge.js';
self.onmessage=event=>{
  const {id,state,kind}=event.data;
  self.postMessage({id,result:kind==='edge'?estimatePreBetEdge(state):finiteShoeExpectedValues(state)});
};
