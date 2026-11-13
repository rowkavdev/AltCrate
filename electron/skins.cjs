function eligibleForConversion(skin, maxPrice) {
  const cheapRarities = new Set(['Consumer Grade', 'Industrial Grade', 'Mil-Spec Grade']);
  return Boolean(
    skin && typeof skin._id === 'string' && skin._id.length > 0 &&
    typeof skin.price === 'number' && Number.isFinite(skin.price) && skin.price >= 0 &&
    Number.isFinite(maxPrice) && maxPrice >= 0 && skin.price <= maxPrice &&
    skin.quality === 0 && cheapRarities.has(skin.rarity) && skin.isFavorite === false &&
    skin.isTerminal === false && skin.isSticker === false && skin.isKeychain === false &&
    skin.isStatTrak !== true && skin.isSouvenir !== true && skin.statTrak !== true && skin.souvenir !== true &&
    !skin.event && !skin.pattern && skin.isPattern !== true && skin.isEvent !== true &&
    typeof skin.name === 'string' && !/StatTrak|Souvenir|★/i.test(skin.name)
  );
}

function selectForConversion(skins, knownIds, maxPrice, cap) {
  if (!Array.isArray(skins) || !(knownIds instanceof Set) || !Number.isSafeInteger(cap) || cap < 0) throw new Error('Seleção de inventário inválida');
  return skins.filter((skin) => !knownIds.has(skin?._id) && eligibleForConversion(skin, maxPrice)).slice(0, cap);
}

module.exports = { eligibleForConversion, selectForConversion };
