function fillLoginForm(credentials) {
  if (location.origin !== 'https://case-clicker.com' || location.pathname !== '/auth/login') return false;
  const email = document.querySelector('input[type="email"]');
  const password = document.querySelector('input[type="password"]');
  if (!email || !password) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  for (const [field, value] of [[email, credentials.email], [password, credentials.password]]) {
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

function createLoginProbe({ automatic, step, validate, now = Date.now }) {
  let submitted = false, lastValidation = -Infinity;
  return {
    async check({ force = false } = {}) {
      const stage = automatic ? await step(!submitted) : 'manual';
      if (stage === 'failed') return { step: stage };
      if (stage === 'submitted') submitted = true;
      if (automatic && !submitted && stage !== 'other-page') return { step: stage };
      if (!force && now() - lastValidation < 1000) return { step: stage };
      lastValidation = now();
      return { step: stage, response: await validate() };
    },
  };
}

function createLoginQueue({ list, isConnected, login, emit }) {
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
          if (signal.aborted) break;
          state.accountId = account.id; state.label = account.label; publish();
          if (await isConnected(account)) { state.alreadyConnected++; publish(); continue; }
          if (signal.aborted) break;
          if (!account.hasPassword) { state.withoutPassword++; publish(); continue; }
          if (!await login(account, { signal })) { state.phase = signal.aborted ? 'stopped' : 'paused'; state.message = 'Login cancelado; as contas seguintes ficam por ligar.'; break; }
          state.connected++; publish();
        }
        if (signal.aborted) state.phase = 'stopped';
        else if (state.phase === 'running') state.phase = 'complete';
      } catch (error) { state.phase = signal.aborted ? 'stopped' : 'paused'; state.message = error.message || 'Não foi possível concluir o login.'; }
      finally { active = false; controller = null; publish(); }
      return { ...state };
    },
  };
}
module.exports = { loginFillScript, loginStepScript, createLoginQueue, createLoginProbe };
