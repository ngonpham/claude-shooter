// In-process message bus between shard services.
//
// Ryzom Core's services are separate processes that talk through NeL's
// unified network: each registers callbacks by message name and sends to a
// service by name. Here every service lives in one process (or one browser
// tab, for the local shard), so the same shape is kept without the sockets:
// services subscribe to message names and anyone can publish. Delivery is
// synchronous and in subscription order, which keeps tests deterministic.
export function createBus(log){
  const subs = new Map();
  return {
    on(name, fn){
      if (!subs.has(name)) subs.set(name, []);
      subs.get(name).push(fn);
    },
    emit(name, payload){
      const list = subs.get(name);
      if (!list) return;
      for (const fn of list){
        try { fn(payload); }
        catch (e){ log && log('bus', name, e && e.stack || e); }
      }
    },
    /* a request answered by the first subscriber that returns non-undefined */
    ask(name, payload){
      const list = subs.get(name);
      if (!list) return undefined;
      for (const fn of list){
        const r = fn(payload);
        if (r !== undefined) return r;
      }
      return undefined;
    }
  };
}
