// The same account shares one in-flight read across events, manual and automatic refresh.
export function createRequestPool(read) {
  const pending = new Map();
  return key => {
    if (pending.has(key)) return pending.get(key);
    const promise = Promise.resolve().then(() => read(key));
    pending.set(key, promise);
    const done = () => { if (pending.get(key) === promise) pending.delete(key); };
    promise.then(done, done);
    return promise;
  };
}
