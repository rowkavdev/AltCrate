export function pendingLoginIds(accounts, snapshots, sessionStates = []) {
  const needsLogin = new Set(sessionStates.filter(account => account.needsLogin === true).map(account => account.id));
  return accounts.filter(account => {
    if (account.session) return account.session.reusable !== true || account.session.validationPending === true;
    const snapshot = snapshots[account.id];
    return needsLogin.has(account.id) || !snapshot || Boolean(snapshot.error);
  }).map(account => account.id);
}
