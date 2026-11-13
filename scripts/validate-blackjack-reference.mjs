import fs from 'node:fs';
import {finiteShoeExpectedValues,chooseFiniteMove} from '../src/blackjackFinite.js';
import {estimatePreBetEdge} from '../src/blackjackEdge.js';
const [referencePath,outPath]=process.argv.slice(2);
const lines=fs.readFileSync(referencePath,'utf8').trim().split(/\r?\n/),overall=Number(lines.shift().split(' ')[1]);
const rank=n=>n===1?'A':String(n);
const cases=[];
for(const line of lines){const [a,b,up,stand,hit,double]=line.split(' ').map(Number);const counts=[24,24,24,24,24,24,24,24,24,96];for(const r of [a,b,up])counts[r-1]--;
 const result=finiteShoeExpectedValues({cards:[rank(a),rank(b)],dealer:rank(up),counts,canDouble:true},{maxNodes:4000000,maxMs:1500});
 const differences=result.complete?Object.fromEntries(Object.entries({stand,hit,double}).map(([move,value])=>[move,result.peek[move]-value])):null;
 cases.push({cards:[rank(a),rank(b)],dealer:rank(up),complete:result.complete,reason:result.reason,differences,match:result.complete&&Object.values(differences).every(x=>Math.abs(x)<1e-9),move:chooseFiniteMove(result,'stand')});
}
const estimates=[];
for(const [name,counts] of [['fresh',[24,24,24,24,24,24,24,24,24,96]],['synthetic-favorable',[20,0,0,0,0,0,0,0,0,80]],['synthetic-unfavorable',[0,0,0,0,80,0,0,0,0,0]]]){const result=estimatePreBetEdge({counts,stakeUnit:2});estimates.push({name,...result});}
const report={reference:{url:'https://github.com/possibly-wrong/blackjack',commit:'a1f7dbb74266fb39296292bdff568b076120a61c',license:'GPL; external verification process only, not copied or bundled in app',rules:'six decks, S17, DAS, max four hands, no resplit aces, no surrender, 3:2, dealer negative peek'},overallOptimalCdz:overall,cases,estimates,limits:['Reference comparison covers single-hand stand/hit/double EV, not all joint split paths.','Sampling bounds are conditional on a declared finite-shoe model, not confirmation of the server.','No live wagers are sent.','This validates calculations, not higher real-world profit.']};
fs.writeFileSync(outPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases,estimates:estimates.map(e=>({name:e.name,complete:e.complete,peek:e.peek?.mean,lowerBound:e.lowerBound,latencyMs:e.latencyMs}))},null,2));
if(cases.some(c=>!c.match)||estimates.some(e=>!e.complete))process.exitCode=1;
