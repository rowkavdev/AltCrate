const test=require('node:test'),assert=require('node:assert/strict');const {loadComponent,render}=require('./helpers/render.cjs');
test('inventory offers account choice and an appropriate empty account state',async()=>{
 const Page=await loadComponent('/src/pages/InventoryPage.jsx');
 const html=render(Page,{model:{accounts:[],bridge:null},ui:{},onUiChange(){},onNavigate(){}});
 assert.match(html,/Adicionar conta/);assert.match(html,/inventário/i);
});
test('inventory cards display real image URLs and item details without fake placeholder prices',async()=>{
 const InventoryCard=await loadComponent('/src/pages/InventoryPage.jsx','InventoryCard');
 const html=render(InventoryCard,{item:{id:'s',name:'USP-S | Test',image:'https://steamcommunity-a.akamaihd.net/economy/image/abc',price:12.5,rarity:'Restricted',isFavorite:true},onOpen(){}});
 assert.match(html,/economy\/image\/abc/);assert.match(html,/USP-S/);assert.match(html,/12,50/);assert.match(html,/Restricted/);
 const absent=render(InventoryCard,{item:{id:'s',name:'Sem dados',image:null,price:null},onOpen(){}});assert.match(absent,/Imagem indisponível/);assert.match(absent,/—/);
});
