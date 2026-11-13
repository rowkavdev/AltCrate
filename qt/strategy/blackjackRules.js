// Public client declaration, read on 2026-10-08. This is not backend proof.
export const PUBLIC_BLACKJACK_RULES=Object.freeze({deckCount:6,reshufflePenetration:.25,dealerStandsOnSoft17:true,blackjackPayout:1.5,maxHandsPerSeat:4,splitAcesOneCard:true,splitAnyTenValue:true,doubleAfterSplit:true});
export const PUBLIC_RULES_SOURCE='https://case-clicker.com/_next/static/chunks/pages/game/blackjack-394c05e4053bde2b.js';
export function resolveBlackjackRules(config) {
 const announced=config?.rules||{};
 const rules={...PUBLIC_BLACKJACK_RULES,...announced};
 const conflicts=Object.keys(announced).filter(key=>key in PUBLIC_BLACKJACK_RULES&&announced[key]!==PUBLIC_BLACKJACK_RULES[key]);
 return {rules,announced,conflicts,compatible:conflicts.length===0,source:Object.keys(announced).length?'server-announced':'public-client'};
}
export function jointStateForSeat(table,shoe,tokens,canDouble,canSplit,rules) {
 const seat=table?.seats?.find(s=>s?.mine),hand=seat?.hands?.[seat.activeHandIndex];
 if(!hand?.bet||!Number.isFinite(tokens)||tokens<0||!seat.hands.every(h=>h.bet>0&&Array.isArray(h.cards)))return null;
 const unit=Math.min(...seat.hands.map(h=>h.bet));
 return {cards:hand.cards.map(c=>c.rank),dealer:table.dealerCards[0].rank,counts:shoe.counts,canDouble,canSplit,rules,activeHandIndex:seat.activeHandIndex,availableUnits:tokens/unit,hands:seat.hands.map(h=>({...h,cards:h.cards.map(c=>c.rank),betUnits:h.bet/unit}))};
}
