/**
 * DSH Pet — host half.
 *
 * Folds per-session work signals for the game panel: provider output tokens,
 * tool dispatches, and whether the session's agent is running. It also maps
 * each session to its workspace so one character can serve a whole workspace.
 */

const ROUTE = '/dsh-pet/usage'

export const inject = ['webServer']

export function apply(ctx) {
  /**
   * sessionId -> {
   *   outputTokens, lastEventAt, toolCalls,
   *   open: Map<callId, startedAt>, session
   * }
   */
  const sessions = new Map()

  const record = (id, session) => {
    let entry = sessions.get(id)
    if (entry === undefined) {
      entry = { outputTokens: 0, usageTokens: 0, lastEventAt: 0, toolCalls: 0, open: new Map(), session }
      sessions.set(id, entry)
    } else if (session !== undefined) {
      entry.session = session
    }
    return entry
  }

  const onEvent = (session, event) => {
    if (session === undefined || event === undefined) return
    const type = event.type
    if (type !== 'assistant/message' && type !== 'tool/call' && type !== 'tool/result' && type !== 'turn/end') {
      return
    }
    const entry = record(session.id, session)
    entry.lastEventAt = Date.now()

    if (type === 'assistant/message') {
      const usage = event.data === undefined ? undefined : event.data.usage
      if (usage === undefined) return
      const out = usage.outputTokens
      // Output tokens are the game's fuel; the panel's cumulative counter shows
      // the whole bill, so it needs input tokens too.
      if (typeof out === 'number' && Number.isFinite(out) && out > 0) entry.outputTokens += out
      const input = typeof usage.inputTokens === 'number' ? usage.inputTokens : 0
      const total =
        typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
          ? usage.totalTokens
          : input + (typeof out === 'number' ? out : 0)
      if (Number.isFinite(total) && total > 0) entry.usageTokens += total
      return
    }

    if (type === 'tool/call') {
      entry.toolCalls += 1
      const callId = event.data === undefined ? undefined : event.data.callId
      if (callId !== undefined) entry.open.set(callId, Date.now())
      return
    }

    if (type === 'tool/result') {
      const message = event.data === undefined ? undefined : event.data.message
      const callId = message === undefined ? undefined : message.toolCallId
      if (callId !== undefined) entry.open.delete(callId)
      return
    }

    // A turn boundary means no tool call of that turn can still be in flight.
    entry.open.clear()
  }

  // Sessions of one workspace share one character. The working directory is
  // the identity every Session already carries, so no registry lookup is
  // needed and a workspace with no registered row still works.
  const workspaceKeyOf = (id, entry) => {
    const session = entry === undefined ? undefined : entry.session
    const header = session === undefined ? undefined : session.header
    const cwd = header === undefined ? undefined : header.cwd
    if (typeof cwd !== 'string' || cwd.length === 0) return 'session:' + id
    let key = cwd.replace(/[\\/]+$/, '')
    if (key.length === 0) key = cwd
    return process.platform === 'win32' ? key.toLowerCase() : key
  }

  const isRunning = (id) => {
    const agents = ctx.get('agents')
    if (agents !== undefined && agents !== null && typeof agents.get === 'function') {
      try {
        const agent = agents.get(id)
        const status = agent === undefined || agent === null ? undefined : agent.status
        if (status === 'running') return true
        if (status === 'idle') return false
      } catch {
        // fall through to the activity heuristic
      }
    }
    const entry = sessions.get(id)
    return entry !== undefined && Date.now() - entry.lastEventAt < 6000
  }

  const snapshot = () => {
    const out = { now: Date.now(), activeSessions: 0, liveSessions: 0, sessions: {} }
    const ids = new Set(sessions.keys())
    const live = ctx.get('sessions')
    if (live !== undefined && live !== null && typeof live.list === 'function') {
      try {
        for (const session of live.list()) {
          ids.add(session.id)
          record(session.id, session)
        }
      } catch {
        // a store that cannot list live sessions still serves the folded ones
      }
    }
    let active = 0
    for (const id of ids) {
      const entry = sessions.get(id)
      const running = isRunning(id)
      if (running) active += 1
      let busyMs = 0
      if (entry !== undefined && entry.open.size > 0) {
        let earliest = Infinity
        for (const startedAt of entry.open.values()) {
          if (startedAt < earliest) earliest = startedAt
        }
        busyMs = Math.max(0, Date.now() - earliest)
      }
      out.sessions[id] = {
        workspaceKey: workspaceKeyOf(id, entry),
        outputTokens: entry === undefined ? 0 : entry.outputTokens,
        totalTokens: entry === undefined ? 0 : entry.usageTokens,
        toolCalls: entry === undefined ? 0 : entry.toolCalls,
        busyMs,
        running,
      }
    }
    out.activeSessions = active
    out.liveSessions = ids.size
    return out
  }

  ctx.on('session/event', onEvent)

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      resource: async () =>
        new Response(JSON.stringify(snapshot()), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          },
        }),
    }),
  )
}
