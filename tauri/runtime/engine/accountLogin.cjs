function fillLoginForm(credentials) {
  if (location.origin !== 'https://case-clicker.com' || location.pathname !== '/auth/login') return false;
  const email = document.querySelector('input[type="email"]');
  const password = document.querySelector('input[type="password"]');
  if (!email || !password) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  for (const [field, value] of [[email, credentials.email], [password, credentials.password]]) {
    if (field.value === value) continue;
    set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}
function loginFillScript(credentials) {
  return `(${fillLoginForm.toString()})(${JSON.stringify(credentials)})`;
}
function stepLoginForm(submit) {
  if (location.origin !== 'https://case-clicker.com' || location.pathname !== '/auth/login') return 'other-page';
  if (/just a moment|verifying|verification required/i.test(document.title || '')) return 'challenge';
  const email = document.querySelector('input[type="email"]'), password = document.querySelector('input[type="password"]');
  const form = email?.closest('form');
  if (!form || password?.closest('form') !== form || !email.value || !password.value) return 'waiting';
  if ([...document.querySelectorAll('[role="alert"]')].some(item => item.textContent.trim())) return 'failed';
  if (!submit || form.dataset.casepilotLoginSubmitted === 'true') return 'waiting';
  const challenge = form.querySelector('input[name="cf-turnstile-response"]');
  if (challenge && !challenge.value.trim()) return 'challenge';
  const button = form.querySelector('button[type="submit"]');
  if (!button || button.disabled) return 'waiting';
  form.dataset.casepilotLoginSubmitted = 'true';
  button.click();
  return 'submitted';
}
function loginStepScript(submit) { return `(${stepLoginForm.toString()})(${submit === true})`; }

function createLoginProbe({ automatic, step, validate, fill, now = Date.now, minIntervalMs=1000 }) {
  let submitted = false, lastValidation = -Infinity, inFlight=null;
  return {
    check() {
      if(inFlight)return inFlight;
      inFlight=(async()=>{
      if(automatic && !submitted && fill)await fill();
      const stage = automatic ? await step(!submitted) : 'manual';
      if (stage === 'failed') return { step: stage };
      if (stage === 'submitted') submitted = true;
      if (automatic && !submitted && stage !== 'other-page') return { step: stage };
      if (now() - lastValidation < minIntervalMs) return { step: stage };
      lastValidation = now();
      return { step: stage, response: await validate() };
      })().finally(()=>{inFlight=null;});
      return inFlight;
    },
  };
}

function createLoginQueue({ list, isConnected, login, emit, minIntervalMs=0,now=Date.now,wait=(ms,signal)=>require('node:timers/promises').setTimeout(ms,null,{signal}),maxRateLimitRetries=3 }) {
  let lastAttemptAt=-Infinity;
  let active = false, controller, state = { phase: 'idle', connected: 0, alreadyConnected: 0, withoutPassword: 0, total: 0 };
  const publish = () => emit({ type: 'account-login-progress', status: { ...state } });
  return {
    status: () => ({ ...state }),
    stop() { controller?.abort(); if (active) { state.phase = 'stopping'; publish(); } return { ...state }; },
    async start(ids) {
      if (active) throw Error('Já existe um login em curso.');
      active = true; controller = new AbortController();
      const signal = controller.signal;
      state = { phase: 'running', connected: 0, alreadyConnected: 0, withoutPassword: 0, total: 0, accountId: null, label: '', message: '' };
      try {
        const all = await list();
        if (ids !== undefined && (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !all.some(a => a.id === id)))) throw Error('Seleciona contas válidas para entrar.');
        const selected = all.filter(account => !ids || ids.includes(account.id));
        state.total = selected.length; publish();
        for (const account of selected) {
          let limits=0;
          while(!signal.aborted){
          if (signal.aborted) break;
          state.accountId = account.id; state.label = account.label; publish();
          state.waitUntil=0;state.stage='checking';state.message='';
          try{
          let connected;
          try { connected = await isConnected(account,{signal}); }
          catch (error) {
            if (error?.code !== 'AUTHENTICATION_REQUIRED' && error?.status !== 401) throw error;
            connected = false;
          }
          if (connected) { state.alreadyConnected++; publish(); break; }
          if (signal.aborted) break;
          if (!account.hasPassword) { state.withoutPassword++; publish(); break; }
          const remaining=minIntervalMs-(now()-lastAttemptAt);if(remaining>0)await wait(remaining,signal);
          if(signal.aborted)break;
          lastAttemptAt=now();
          state.stage='login';publish();
          if (!await login(account, { signal })) { state.phase = signal.aborted ? 'stopped' : 'paused'; state.message = 'Login cancelado; as contas seguintes ficam por ligar.'; break; }
          state.connected++; publish();
          break;
          }catch(error){
            if(error?.status!==429||error.safeToRetry!==true||!Number.isFinite(error.retryAt))throw error;
            if(++limits>maxRateLimitRetries)throw Error('O site continua a limitar. A fila ficou em pausa; as sessões estão guardadas.');
            state.stage='waiting';state.waitUntil=Math.max(now()+1000,error.retryAt);state.message=error.message;state.rateLimit=error.rateLimit;publish();
            await wait(state.waitUntil-now(),signal);
          }
          }
          if(state.phase==='paused')break;
        }
        if (signal.aborted) state.phase = 'stopped';
        else if (state.phase === 'running') state.phase = 'complete';
      } catch (error) { state.phase = signal.aborted ? 'stopped' : 'paused'; state.message = error.message || 'Não foi possível concluir o login.'; }
      finally { active = false; controller = null; state.waitUntil=0;state.stage='';publish(); }
      return { ...state };
    },
  };
}
module.exports = { loginFillScript, loginStepScript, createLoginQueue, createLoginProbe };
