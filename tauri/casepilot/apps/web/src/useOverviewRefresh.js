import {useEffect, useState} from 'react';
import {planOverviewRefresh} from './overviewRefresh.js';

export function useOverviewRefresh(model) {
  const [environment, setEnvironment] = useState(() => ({visible:document.visibilityState === 'visible', online:navigator.onLine !== false}));
  const {refreshAccounts, stopAutomaticRefresh} = model.actions;
  useEffect(() => {
    const update = () => setEnvironment({visible:document.visibilityState === 'visible', online:navigator.onLine !== false});
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      stopAutomaticRefresh();
    };
  }, [stopAutomaticRefresh]);
  const {accounts, snapshots, loading, loadError, busy, running, autoRefreshPaused, refreshStatus} = model;
  const cooldownUntil = model.farmStatus?.budget?.cooldownUntil || 0;
  useEffect(() => {
    const plan = planOverviewRefresh({accounts, snapshots, loading, busy, running, paused:autoRefreshPaused, refreshStatus, cooldownUntil, enabled:!loadError, ...environment});
    if (plan.phase === 'inactive') stopAutomaticRefresh();
    if (plan.nextAt === null) return;
    const timer = setTimeout(() => refreshAccounts({automatic:true}), Math.max(1000, plan.nextAt - Date.now()));
    return () => clearTimeout(timer);
  }, [accounts, snapshots, loading, loadError, busy, running, autoRefreshPaused, refreshStatus, cooldownUntil, environment, refreshAccounts, stopAutomaticRefresh]);
  return {paused:autoRefreshPaused || refreshStatus.phase === 'paused' && refreshStatus.errorStatus !== 429};
}
