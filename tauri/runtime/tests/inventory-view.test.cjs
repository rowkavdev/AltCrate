const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInventoryPage, imageUrl, inventoryQuery } = require('../engine/inventoryView.cjs');

test('inventory view keeps display fields and strips account secrets', () => {
  const page = normalizeInventoryPage({ pages: 2, count: 101, skins: [{
    _id: '691f90c11ff412261c423a3f', name: 'USP-S | Test', iconUrl: '-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04',
    price: 12.5, rarity: 'Restricted', rarityColor: '8847ff', exterior: 'Field-Tested', float: 0.25, quality: 0,
    isFavorite: true, statTrak: false, souvenir: false, origin: { name: 'Test Case', type: 'case' }, userId: 'private', token: 'secret',
  }] });
  assert.equal(page.count, 101);
  assert.equal(page.skins[0].origin, 'Test Case');
  assert.equal(page.skins[0].image.startsWith('https://steamcommunity-a.akamaihd.net/economy/image/'), true);
  assert.equal(JSON.stringify(page).includes('private'), false);
  assert.equal(JSON.stringify(page).includes('secret'), false);
});

test('image source and inventory filters are allowlisted', () => {
  assert.equal(imageUrl('https://evil.test/asset'), null);
  assert.equal(imageUrl('../../etc/passwd'), null);
  assert.match(inventoryQuery(2, { search: 'USP-S', sort: 'price', rarity: 'Covert', favorites: 'only' }), /^\/api\/inventory\?page=2&/);
  assert.throws(() => inventoryQuery(0), /Página/);
  assert.throws(() => inventoryQuery(1, { sort: 'bad' }), /Ordenação/);
});

test('game pattern photographs resolve to the observed public skin image directory',()=>{
  assert.equal(imageUrl('ak_ch_bg.png'),'https://case-clicker.com/pictures/skins/ak_ch_bg.png');
  assert.equal(normalizeInventoryPage({skins:[{_id:'pattern',name:'Blue Gem',iconUrl:'m9_bayonet_ch_bg.png'}]}).skins[0].image,'https://case-clicker.com/pictures/skins/m9_bayonet_ch_bg.png');
  assert.equal(imageUrl('../ak_ch_bg.png'),null);
  assert.equal(imageUrl('https://evil.test/ak_ch_bg.png'),null);
  assert.equal(imageUrl('photo.svg'),null);
});

test('real accessories preserve photographs and names without private fields',()=>{
 const item=normalizeInventoryPage({skins:[{_id:'item',name:'AK-47',iconUrl:'ak_ch_bg.png',event:{name:'Christmas 2025',gradient:'unsafe'},patternId:'pattern',stickers:[{name:'Christmas Cat',iconUrl:'/pictures/events/christmas25/cat.png',isSticker:true,rarity:'Exotic',owner:'private'}],appliedKeychain:{name:'Charm',iconUrl:'charm.png',token:'secret'}}]}).skins[0];
 assert.equal(item.stickers?.[0]?.image,'https://case-clicker.com/pictures/events/christmas25/cat.png');
 assert.equal(item.stickers[0].name,'Christmas Cat');assert.equal(item.charm.name,'Charm');assert.equal(item.eventName,'Christmas 2025');
 assert.equal(JSON.stringify(item).includes('private'),false);assert.equal(JSON.stringify(item).includes('unsafe'),false);assert.equal(JSON.stringify(item).includes('secret'),false);
});
test('unsafe image paths and malformed accessories stay unavailable',()=>{
 assert.equal(imageUrl('/pictures/events/cat.png'),'https://case-clicker.com/pictures/events/cat.png');
 for(const value of ['/pictures/../private.png','/pictures/%2e%2e/private.png','/pictures/events\\cat.png','/pictures/cat.svg','javascript:alert(1)','https://other.test/pictures/cat.png'])assert.equal(imageUrl(value),null,value);
 assert.equal(imageUrl('https://case-clicker.com/pictures/skins/ak_ch_bg.png'),'https://case-clicker.com/pictures/skins/ak_ch_bg.png');
 const items=normalizeInventoryPage({skins:[{stickers:'invalid',appliedKeychain:'invalid'},{stickers:Array.from({length:9},()=>({name:'Sticker'}))}]}).skins;
 assert.deepEqual(items[0].stickers,[]);assert.equal(items[0].charm,null);assert.equal(items[1].stickers.length,5);
});
