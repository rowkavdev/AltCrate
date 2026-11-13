const test = require('node:test');
const assert = require('node:assert/strict');
const card = rank => ({ rank: String(rank), suit: 'S' });
const names = { h: 'Pedir carta', s: 'Parar', d: 'Dobrar', p: 'Dividir' };

// Independent reference: six decks, S17, DAS, no surrender.
// https://github.com/AttackingOrDefending/Blackjack-Strategy-Simulator/tree/main/data
test('strategy matches all 380 hard, soft and pair cells and double fallbacks', async () => {
  const { blackjackAdvice } = await import('../strategy/blackjackAuto.js');
  const hard = { 4:'hhhhhhhhhh',5:'hhhhhhhhhh',6:'hhhhhhhhhh',7:'hhhhhhhhhh',8:'hhhhhhhhhh',9:'hddddhhhhh',10:'ddddddddhh',11:'dddddddddh',12:'hhssshhhhh',13:'ssssshhhhh',14:'ssssshhhhh',15:'ssssshhhhh',16:'ssssshhhhh',17:'ssssssssss',18:'ssssssssss',19:'ssssssssss',20:'ssssssssss',21:'ssssssssss' };
  const soft = { 12:'hhhhdhhhhh',13:'hhhddhhhhh',14:'hhhddhhhhh',15:'hhdddhhhhh',16:'hhdddhhhhh',17:'hddddhhhhh',18:'sddddsshhh',19:'ssssssssss',20:'ssssssssss',21:'ssssssssss' };
  const pair = { 2:'pppppphhhh',3:'pppppphhhh',4:'hhhpphhhhh',5:'ddddddddhh',6:'ppppphhhhh',7:'pppppphhhh',8:'pppppppppp',9:'pppppsppss',10:'ssssssssss',11:'pppppppppp' };
  let cells = 0;
  for (const [kind, matrix] of [['hard',hard],['soft',soft],['pair',pair]]) for (const [value, row] of Object.entries(matrix)) {
    const total = Number(value);
    const ranks = kind === 'soft' ? ['A', total === 12 ? 'A' : total - 11] : kind === 'pair' ? [total === 11 ? 'A' : total, total === 11 ? 'A' : total] : total <= 11 ? [2, total - 2] : total === 21 ? [10,9,2] : [10,total - 10];
    for (let index=0; index<10; index++) {
      const hand = { cards: ranks.map(card) }, dealer = card(index===9 ? 'A' : index+2);
      assert.equal(blackjackAdvice(hand,dealer,true,kind==='pair'),names[row[index]],`${kind} ${total} vs ${index+2}`);
      if (row[index]==='d') assert.equal(blackjackAdvice(hand,dealer,false,false),names[kind==='soft' && total===18 ? 's':'h']);
      cells++;
    }
  }
  assert.equal(cells,380);
});

test('hard 17 loss against dealer 20 is a correct stand, invalid cards have no advice', async () => {
  const { blackjackAdvice } = await import('../strategy/blackjackAuto.js');
  assert.equal(blackjackAdvice({ cards:[card(4),card(3),card('K')] },card('K'),false,false),'Parar');
  assert.equal(blackjackAdvice({ cards:[card(0),card(6)] },card(4),false,false),null);
});
