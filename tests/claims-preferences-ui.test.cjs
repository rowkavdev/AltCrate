const test=require('node:test'),assert=require('node:assert/strict');
const {loadComponent,render}=require('./helpers/render.cjs');
test('missions expose reviewed collection only for completed unredeemed and unexpired goals',async()=>{
 const Content=await loadComponent('/src/pages/RewardsPage.jsx','MissionsContent');
 const eligible={id:'mission',title:'Cliques para caixas',current:25,target:25,eligible:true,redeemed:false,duration:'week',validTill:'2099-10-20T00:00:00Z'};
 const html=render(Content,{data:{missions:[eligible,{...eligible,id:'incomplete',current:1},{...eligible,id:'claimed',redeemed:true}]},pending:false,onPrepare(){}});
 assert.match(html,/Rever missão/);assert.equal((html.match(/disabled=""/g)||[]).length,1);assert.match(html,/25 pontos no passe mensal/);
});
test('monthly pass offers both tracks but locks Premium without entitlement or a reward',async()=>{
 const Content=await loadComponent('/src/pages/RewardsPage.jsx','MonthlyPassContent');
 const pass={period:'2026-10',endsAt:'2099-11-01T00:00:00Z',tier:2,isPremium:false,claimedFreeTiers:[],claimedPremiumTiers:[],claimableFreeTiers:[2],claimablePremiumTiers:[2],track:[{tier:2,freeReward:'Dinheiro virtual',premiumReward:'Tokens'}]};
 const html=render(Content,{pass,pending:false,onPrepare(){}});assert.equal((html.match(/Rever recolha/g)||[]).length,2);assert.match(html,/Premium não ativo/);assert.equal((html.match(/disabled=""/g)||[]).length,1);assert.doesNotMatch(html,/são consultas/);
});
test('settings make opening preferences explicitly optional and default to hidden',async()=>{
 const Page=await loadComponent('/src/pages/SettingsPage.jsx');
 const html=render(Page,{preferencesController:{preferences:{enableSiteOpening:false},loading:false,saving:false,update(){}}});
 assert.match(html,/Mostrar preferências de abertura/);assert.match(html,/type="checkbox"/);assert.doesNotMatch(html,/checked=""/);
});
test('opening preferences group favorites, sale threshold and presets with clear wording',async()=>{
 const Fields=await loadComponent('/src/pages/SiteAutoOpenPage.jsx','AutoOpenFields');
 const draft={favoriteLowFloats:true,favoriteHighFloats:false,favoriteCustomFloats:false,favoritePatterns:false,autosellActivated:false,autosellAmount:5000,autosellVariant:'money',customLowFloat:0,customHighFloat:1,customSelectedFloats:'',patternBlacklist:''};
 const html=render(Fields,{draft,pending:false,onChange(){}});assert.match(html,/Favoritos/);assert.match(html,/Venda automática/);assert.match(html,/Vender itens abaixo de/);assert.doesNotMatch(html,/Quantidade de venda automática/);
});
