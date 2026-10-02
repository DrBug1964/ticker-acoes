export function latestOnly(fn) {
  let seq = 0;
  return async (...args) => {
    const mine = ++seq;
    try {
      const value = await fn(...args);
      return mine === seq ? { stale: false, value } : { stale: true };
    } catch (err) {
      if (mine === seq) throw err;
      return { stale: true };
    }
  };
}
