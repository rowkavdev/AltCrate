"""Private stdio worker: no sockets, remote inference, identities or account access."""
import json
import sys
import time
import contextlib

def evaluate(agent, state):
    cards = state['cards']
    values = [11 if r == 'A' else 10 if r in ('10','J','Q','K') else int(r) for r in cards]
    total, aces = sum(values), values.count(11)
    while total > 21 and aces:
        total -= 10
        aces -= 1
    criteria = {'hit':'Draw another card.', 'stand':'Keep the hand and end the turn.'}
    if state['canDouble']:
        criteria['double'] = 'Double the stake, draw exactly one card and end the turn.'
    if state['canSplit']:
        criteria['split'] = 'Split the pair into two hands, paying another stake.'
    # No hidden dealer card, expected answer or result is supplied to the model.
    request = f"Blackjack: six decks, dealer stands on soft 17, double after split, no surrender. My cards: {','.join(cards)}. Total: {total}. Soft: {aces > 0}. Dealer upcard: {state['dealer']}. Choose the legal move with highest expected return. The dealer's hidden card is unknown."
    start = time.perf_counter()
    result = agent.predict(request, {'move':{'type':'choice','instructions':'Which blackjack move has the highest expected return?', 'criteria':criteria}})
    answer = result['answers']['move']
    return {'move':answer['choice'],'probabilities':answer['probabilities'],'latencyMs':(time.perf_counter()-start)*1000}

def main():
    try:
        with contextlib.redirect_stdout(sys.stderr):
            import laya_mlx
            agent = laya_mlx.load(sys.argv[1], dtype='float16')
        print(json.dumps({'type':'ready','model':'laya-typed-decisions-mlx'}),flush=True)
    except Exception:
        print(json.dumps({'type':'error'}),flush=True)
        return
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                answer = evaluate(agent,request['state'])
            print(json.dumps({'id':request['id'],**answer},allow_nan=False),flush=True)
        except Exception:
            print(json.dumps({'id':request.get('id') if isinstance(request,dict) else None,'error':True}),flush=True)

if __name__ == '__main__':
    main()
