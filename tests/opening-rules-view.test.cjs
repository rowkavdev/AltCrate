const test=require('node:test'),assert=require('node:assert/strict'),{loadComponent,render}=require('./helpers/render.cjs');

test('case contents offer inventory, sell and storage choices for each named skin',async()=>{
 const Rules=await loadComponent('/src/pages/OpeningItemRules.jsx');
 const html=render(Rules,{items:[{name:'AK-47 | Point Disarray',image:'',rarity:'Classified',specialItems:[]},{name:'Rare Special Items',specialItems:[{name:'Karambit | Fade',image:''}]}],rules:{'AK-47 | Point Disarray':{action:'sell'}},onChange(){},accounts:[{id:'a1',label:'Principal'}],bridge:{},disabled:false,Artwork:({name})=>name});
 assert.match(html,/AK-47 \| Point Disarray/);assert.match(html,/Vender/);assert.match(html,/Inventário/);assert.match(html,/Storage/);assert.match(html,/Karambit \| Fade/);
 assert.match(html,/1 para vender/);
 assert.doesNotMatch(html,/AK-47 \| Point Disarray<\/strong><small>Faca/);
});

test('large knife groups are visible immediately and each knife has its own choices',async()=>{
 const Rules=await loadComponent('/src/pages/OpeningItemRules.jsx');
 const specials=Array.from({length:65},(_,index)=>({name:'Knife | Finish '+(index+1),image:''}));
 const html=render(Rules,{items:[{name:'Rare Special Items',specialItems:specials}],rules:{},onChange(){},accounts:[],bridge:{},disabled:false,Artwork:({name})=>name});
 assert.match(html,/Facas e itens especiais/);
 assert.match(html,/Knife \| Finish 65/);
 assert.match(html,/Destino de Knife \| Finish 65/);
});

test('ordered local variants display conditions, precedence controls and ranking limitation',async()=>{
 const Rules=await loadComponent('/src/pages/OpeningItemRules.jsx');
 const html=render(Rules,{items:[{name:'Karambit | Fade'}],rules:[{name:'Karambit | Fade',action:'keep',conditions:{floatMax:.01,patterns:['42'],statTrak:true,topN:10}},{name:'Karambit | Fade',action:'sell'}],onRulesChange(){},accounts:[],bridge:{},disabled:false,Artwork:({name})=>name});
 for(const text of ['Regras locais ordenadas','primeira regra','Float máximo','Padrões','StatTrak','Souvenir','Evento','Top N','Subir regra','Descer regra','Adicionar regra','cobertura agregada'])assert.ok(html.includes(text),text);
 assert.ok(html.indexOf('value="0.01"')<html.lastIndexOf('value="sell"'));
});
