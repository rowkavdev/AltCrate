const test = require('node:test');
const assert = require('node:assert/strict');
const { eligibleForConversion, selectForConversion } = require('../engine/skins.cjs');

const common = { _id: 'one', name: 'Cheap item', price: 2, quality: 0, rarity: 'Mil-Spec Grade', isFavorite: false, isTerminal: false, isSticker: false, isKeychain: false };

test('conversion accepts only known cheap common ordinary skins', () => {
  assert.equal(eligibleForConversion(common, 5), true);
  for (const patch of [
    { price: 6 }, { price: null }, { quality: 1 }, { quality: 2 }, { quality: undefined },
    { rarity: 'Restricted' }, { rarity: undefined }, { name: 'StatTrak™ Cheap item' },
    { isFavorite: true }, { isTerminal: true }, { isSticker: true },
    { isKeychain: true }, { _id: '' }, { isStatTrak: true }, { isSouvenir: true },
  ]) assert.equal(eligibleForConversion({ ...common, ...patch }, 5), false, JSON.stringify(patch));
});

test('conversion selection is capped and excludes pre-existing items', () => {
  const skins = [common, { ...common, _id: 'two' }, { ...common, _id: 'three' }];
  assert.deepEqual(selectForConversion(skins, new Set(['one']), 5, 1).map((skin) => skin._id), ['two']);
});
