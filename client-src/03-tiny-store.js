    // -------------------------------------------------------- tiny store

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
          for (const l of [...listeners]) l()
        },
        subscribe(l) { listeners.add(l); return () => listeners.delete(l) },
      }
    }
    const store = createStore({ datasources: [], loaded: false, error: null, schemas: {}, version: 0 })
    function useStore(selector) {
      const get = () => selector(store.get())
      return useSyncExternalStore(store.subscribe, get, get)
    }
    async function refreshDatasources() {
      try {
        const datasources = await call('listDatasources')
        store.set({ datasources, loaded: true, error: null })
      } catch (error) {
        store.set({ loaded: true, error: error.message })
      }
    }
    const sessionInfoCache = createStore({})
    async function loadSessionInfo(sessionId) {
      try {
        const info = await call('sessionInfo', { sessionId })
        sessionInfoCache.set({ [sessionId]: info })
      } catch {}
    }

