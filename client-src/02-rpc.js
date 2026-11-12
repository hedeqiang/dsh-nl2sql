    // --------------------------------------------------------------- RPC

    async function call(method, payload) {
      const response = await fetch(RPC_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, payload: payload ?? {} }),
        credentials: 'same-origin',
      })
      let result
      try {
        result = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!result.ok) {
        const err = new Error(result.error.message)
        err.code = result.error.code
        throw err
      }
      return result.value
    }

