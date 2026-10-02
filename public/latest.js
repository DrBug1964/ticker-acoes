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

// Executa as tarefas uma de cada vez, pela ordem em que chegam; um erro não bloqueia as seguintes.
export function serial() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => {});
    return run;
  };
}
