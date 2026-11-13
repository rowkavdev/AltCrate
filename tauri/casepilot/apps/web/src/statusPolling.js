// Schedule after completion, so slow IPC or server responses cannot accumulate overlapping polls.
export function createStatusPoller({ poll, active = () => false, visible = () => true, setTimer = setTimeout, clearTimer = clearTimeout, activeMs = 5000, idleMs = 30000 }) {
  let timer = null, pending = null, stopped = false, failures = 0;
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const schedule = () => {
    clear();
    if (!stopped && visible()) timer = setTimer(run, Math.min(60000, (active() ? activeMs : idleMs) * 2 ** Math.min(failures, 4)));
  };
  const run = () => {
    clear();
    if (stopped || !visible()) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve().then(poll).then(() => { failures = 0; }, () => { failures++; }).finally(() => { pending = null; schedule(); });
    return pending;
  };
  return { schedule, wake: run, stop() { stopped = true; clear(); } };
}
