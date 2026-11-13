const test=require('node:test');
const assert=require('node:assert/strict');
const {loadComponent,render}=require('./helpers/render.cjs');

test('overview totals include fractional tokens from all current accounts and ignore unavailable readings',async()=>{
 const {calculateAccountTotals}=await import('../src/useWorkspaceModel.js');
 assert.equal(typeof calculateAccountTotals,'function');
 const accounts=['a','b','zero','missing','failed','legacy'].map(id=>({id}));
 const snapshots={a:{tokens:123.45,money:10,casesTotal:2},b:{tokens:6.78,money:20,casesTotal:3},zero:{tokens:0},failed:{tokens:999,error:'Sessão expirada'},legacy:{money:5},removed:{tokens:1000}};
 assert.deepEqual(calculateAccountTotals(accounts,snapshots),{connected:4,cases:5,money:35,tokens:130.23});
 assert.deepEqual(calculateAccountTotals([],snapshots),{connected:0,cases:0,money:0,tokens:0});
});

test('home displays total tokens with decimals without a currency symbol',async()=>{
 const Page=await loadComponent('/src/pages/OverviewPage.jsx');
 const model={accounts:[{id:'a'},{id:'b'}],snapshots:{},totals:{connected:2,cases:5,money:35,tokens:130.23},farmStatus:{phase:'idle',accounts:[]},events:[],awards:[],loading:false};
 const html=render(Page,{model,onNavigate(){}});
 const card=html.split(/(?=<div data-slot="card")/).find(fragment=>/\bmetric\b/.test(fragment)&&fragment.includes('Tokens nas contas'));
 assert.ok(card,'The home must include the aggregate token balance');
 assert.match(card,/<strong>130,23<\/strong>/);
 assert.doesNotMatch(card,/\$/);
 const loadingHtml=render(Page,{model:{...model,loading:true},onNavigate(){}});
 assert.doesNotMatch(loadingHtml,/130,23/);
});
