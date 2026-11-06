window.__ModuleLoader__.load({
  id: 'dsh-pet',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const TYPE_ID = 'dsh-pet'
    const KIND = 'pet'

    // The arena is rendered at a fixed low resolution and scaled up by CSS,
    // which is what gives the panel its pixel-art look without image assets.
    const W = 160
    const H = 144
    const STEP = 1 / 60
    const LEGACY_KEY = 'dsh.pet.v1'
    const KEY_PREFIX = 'dsh.pet.v2.'
    const POLL_MS = 800
    const MAX_ENEMIES = 60
    const MAX_ELITES = 4
    // Comfort threshold: past this many bodies the arena stops being dodgeable,
    // so the token budget is spent on higher tiers instead of more bodies.
    const COMFORT_ENEMIES = 22
    const BASE_SPAWN_SECONDS = 5.5
    const MAX_PENDING = 5

    const COLORS = {
      bg: '#0a0d12',
      grid: '#121a24',
      frame: '#1c2733',
      player: '#cfe3ef',
      playerDark: '#7fa3b8',
      eye: '#0a0d12',
      enemy: '#c4534b',
      enemyDark: '#7e312c',
      elite: '#8f4bd6',
      eliteDark: '#4d2379',
      bullet: '#ffd166',
      spark: '#ffe9b0',
    }

    const CSS = [
      '.dsh-pet{display:flex;flex-direction:column;gap:6px;padding:10px;height:100%;box-sizing:border-box;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#c8d4de;background:#0a0d12;overflow:hidden}',
      '.dsh-pet-top{display:flex;align-items:center;gap:8px;font-size:11px}',
      '.dsh-pet-lv{color:#ffd166;font-weight:700}',
      '.dsh-pet-stat{color:#7f93a3}',
      '.dsh-pet-dot{font-size:10px;color:#5c6c7a}',
      '.dsh-pet-dot.on{color:#6ee7a8}',
      '.dsh-pet-usage{margin-left:auto;font-size:10px;color:#6ee7a8;white-space:nowrap}',
      '.dsh-pet-hot{color:#ffb74d}',
      '.dsh-pet-tiers{display:flex;gap:8px;font-size:10px;color:#7f93a3;align-items:center}',
      '.dsh-pet-tier{display:inline-flex;align-items:center;gap:3px}',
      '.dsh-pet-tier i{width:7px;height:7px;border-radius:2px;display:inline-block}',
      '.dsh-pet-tier.zero{opacity:.35}',
      '.dsh-pet-xp{height:2px;background:#1a2430;border-radius:2px;overflow:hidden}',
      '.dsh-pet-xp i{display:block;height:100%;background:#4ea3ff}',
      '.dsh-pet-stage{position:relative;flex:1;min-height:120px;display:flex;align-items:center;justify-content:center}',
      '.dsh-pet-canvas{width:100%;height:auto;max-height:100%;image-rendering:pixelated;border-radius:6px;display:block}',
      '.dsh-pet-cards{position:absolute;left:6px;right:6px;bottom:6px;max-height:78%;overflow-y:auto;',
      'display:flex;flex-direction:column;gap:4px;',
      'background:rgba(8,12,18,.94);border:1px solid #24313f;border-radius:8px;padding:8px}',
      '.dsh-pet-cards-list{display:flex;flex-direction:column;gap:4px}',
      '.dsh-pet-cards-title{font-size:10px;color:#7f93a3;margin-bottom:2px}',
      '.dsh-pet-card{display:flex;flex-direction:column;gap:2px;text-align:left;background:#111a24;color:#dbe7f0;',
      'border:1px solid #263342;border-radius:6px;padding:6px 8px;cursor:pointer;font:inherit;font-size:11px}',
      '.dsh-pet-card:hover{background:#16222e;border-color:#3a5470}',
      '.dsh-pet-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:6px}',
      '.dsh-pet-card-name{color:#ffd166;font-weight:700;white-space:nowrap}',
      '.dsh-pet-card-delta{font-size:10px;color:#6ee7a8;white-space:nowrap}',
      '.dsh-pet-card-desc{color:#8fa4b5}',
      '.dsh-pet-stats{display:flex;gap:10px;font-size:10px;color:#7f93a3}',
      '.dsh-pet-build{display:flex;flex-wrap:wrap;gap:4px}',
      '.dsh-pet-chip{font-size:9px;color:#8fa4b5;background:#111a24;border:1px solid #1f2a36;border-radius:4px;padding:0 4px}',
      '.dsh-pet-dead{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;',
      'justify-content:center;gap:4px;background:rgba(8,12,18,.72);border-radius:6px}',
      '.dsh-pet-dead-title{font-size:14px;color:#e35d5d;letter-spacing:.2em}',
      '.dsh-pet-dead-sub{font-size:10px;color:#7f93a3}',
      '.dsh-pet-hp{height:3px;background:#1a2430;border-radius:2px;overflow:hidden}',
      '.dsh-pet-hp i{display:block;height:100%;background:#e35d5d}',
      '.dsh-pet-bottom{display:flex;gap:8px;font-size:10px;color:#6c8091}',
      '.dsh-pet-pending{margin-left:auto;color:#ffd166}',
    ].join('')

    const UPGRADES = [
      { id: 'rate', name: '连射', desc: '攻速 +25%', apply: (p) => { p.fireEvery *= 0.8 }, delta: (p) => '间隔 ' + p.fireEvery.toFixed(2) + ' → ' + (p.fireEvery * 0.8).toFixed(2) + 's' },
      { id: 'dmg', name: '重弹', desc: '伤害 +30%', apply: (p) => { p.dmg *= 1.3 }, delta: (p) => '伤害 ' + Math.round(p.dmg) + ' → ' + Math.round(p.dmg * 1.3) },
      { id: 'hp', name: '强健', desc: '生命上限 +25 并回复', apply: (p) => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25) }, delta: (p) => '上限 ' + Math.round(p.maxHp) + ' → ' + Math.round(p.maxHp + 25) },
      { id: 'speed', name: '疾行', desc: '移动速度 +12%', apply: (p) => { p.speed *= 1.12 }, delta: (p) => '移速 ' + Math.round(p.speed) + ' → ' + Math.round(p.speed * 1.12) },
      { id: 'multi', name: '散射', desc: '每次多射 1 发', apply: (p) => { p.projectiles += 1 }, delta: (p) => '弹数 ' + p.projectiles + ' → ' + (p.projectiles + 1) },
      { id: 'leech', name: '汲取', desc: '击杀回复 1 点生命', apply: (p) => { p.leech += 1 }, delta: (p) => '吸血 ' + p.leech + ' → ' + (p.leech + 1) },
      { id: 'range', name: '远射', desc: '射击距离 +25%', apply: (p) => { p.range *= 1.25 }, delta: (p) => '射程 ' + Math.round(p.range) + ' → ' + Math.round(p.range * 1.25) },
      { id: 'armor', name: '甲壳', desc: '受到伤害 -15%', apply: (p) => { p.armor = Math.min(0.6, p.armor + 0.15) }, delta: (p) => '减伤 ' + Math.round(p.armor * 100) + '% → ' + Math.round(Math.min(0.6, p.armor + 0.15) * 100) + '%' },
    ]
    const UPGRADE_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]))

    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

    // The canvas is rendered at twice the logical resolution, so half-pixel
    // positions are real pixels. Quantizing to 0.5 halves the apparent jitter
    // of rounding compared with the old 1x buffer.
    const Q = (v) => Math.round(v * 2) / 2

    const nextXpFor = (level) => Math.round(8 + level * 4)

    function formatTokens(n) {
      if (!Number.isFinite(n) || n <= 0) return '0'
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
      return String(Math.round(n))
    }

    function readJSON(key) {
      try {
        const raw = window.localStorage.getItem(key)
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : null
      } catch {
        return null
      }
    }

    function readSave(key) {
      const own = readJSON(KEY_PREFIX + key)
      const legacy = own === null ? readJSON(LEGACY_KEY) : null
      const base = own !== null ? own : legacy !== null ? legacy : {}
      const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
      const upgrades = {}
      const src = base.upgrades
      if (src !== null && typeof src === 'object') {
        for (const [id, count] of Object.entries(src)) {
          if (typeof count === 'number' && count > 0) upgrades[id] = Math.floor(count)
        }
      }
      const level = Math.max(1, Math.floor(num(base.level, 1)))
      return {
        genes: num(base.genes, 0),
        runs: num(base.runs, 0),
        totalTokens: num(base.totalTokens, 0),
        consumed: num(base.consumed, 0),
        seenUsed:
          base.seenUsed !== null && typeof base.seenUsed === 'object' ? base.seenUsed : {},
        bestLevel: num(base.bestLevel, level),
        level,
        xp: Math.max(0, num(base.xp, 0)),
        xpNext: Math.max(1, num(base.xpNext, nextXpFor(level))),
        upgrades,
      }
    }

    function writeSave(game) {
      if (game === null || game.key === null) return
      try {
        window.localStorage.setItem(
          KEY_PREFIX + game.key,
          JSON.stringify({
            level: game.level,
            xp: game.xp,
            xpNext: game.xpNext,
            upgrades: game.upgrades,
            genes: game.genes,
            runs: game.runs,
            totalTokens: game.totalTokens,
            consumed: game.consumed,
            // Per-session utilization already counted, so reopening the panel
            // after a while still adds what was spent meanwhile.
            seenUsed: game.seenUsed,
            bestLevel: Math.max(game.bestLevel, game.level),
          }),
        )
      } catch {
        // a full or blocked storage must not break the run
      }
    }

    function makePlayer(genes) {
      const bonus = Math.min(80, genes * 2)
      return {
        x: W / 2,
        y: H / 2,
        vx: 0,
        vy: 0,
        hp: 100 + bonus,
        maxHp: 100 + bonus,
        speed: 52,
        dmg: 8,
        fireEvery: 0.55,
        fireTimer: 0,
        // Roughly a third of the arena: the old 96 covered almost its whole
        // half-diagonal (107), which made range look unlimited.
        range: 46,
        projectiles: 1,
        pierce: 1,
        leech: 0,
        armor: 0,
      }
    }

    // The build lives on the character, not on the run: every respawn rebuilds
    // the same stats from the saved upgrade counts.
    function applyBuild(game) {
      for (const [id, count] of Object.entries(game.upgrades)) {
        const upgrade = UPGRADE_BY_ID.get(id)
        if (upgrade === undefined) continue
        for (let i = 0; i < count; i++) upgrade.apply(game.player)
      }
    }

    function createGame(key) {
      const saved = readSave(key)
      const game = {
        key,
        tokens: 0,
        spawnDebt: 0,
        gold: 0,
        kills: 0,
        level: saved.level,
        xp: saved.xp,
        xpNext: saved.xpNext,
        runXp: 0,
        genes: saved.genes,
        runs: saved.runs,
        totalTokens: saved.totalTokens,
        // Whole-bill tokens (input + output) observed for this workspace.
        consumed: saved.consumed,
        seenUsed: saved.seenUsed,
        bestLevel: saved.bestLevel,
        upgrades: saved.upgrades,
        pending: 0,
        offer: [],
        dead: false,
        deadTimer: 0,
        lastGeneGain: 0,
        // work signals mirrored from the host
        running: false,
        online: true,
        activeSessions: 1,
        liveSessions: 1,
        busyMs: 0,
        toolCalls: 0,
        // pressure model
        pressure: 0.6,
        idleTimer: 1.5,
        eliteQueue: 0,
        // steering state: the character keeps its velocity between frames, so
        // direction changes bend the path instead of snapping it
        orbit: Math.random() * Math.PI * 2,
        orbitSign: 1,
        // per-session counters already accounted for
        seen: new Map(),
        acc: 0,
        player: makePlayer(saved.genes),
        enemies: [],
        bullets: [],
        sparks: [],
      }
      applyBuild(game)
      return game
    }

    function respawn(game) {
      game.player = makePlayer(game.genes)
      applyBuild(game)
      game.enemies = []
      game.bullets = []
      game.sparks = []
      game.dead = false
      game.deadTimer = 0
      game.runXp = 0
      game.spawnDebt = 0
      game.eliteQueue = 0
      game.idleTimer = 1.5
    }

    // Which edges a wave can come from: one hostile session is a lone straggler,
    // a second session means pincer pressure, and so on.
    function pickEdge(game) {
      const n = clamp(game.activeSessions, 1, 4)
      if (n === 1) return Math.floor(Math.random() * 4)
      const edges = n === 2 ? [1, 3] : n === 3 ? [1, 2, 3] : [0, 1, 2, 3]
      return edges[Math.floor(Math.random() * edges.length)]
    }

    function spawnPoint(edge) {
      if (edge === 0) return { x: Math.random() * W, y: -6 }
      if (edge === 1) return { x: W + 6, y: Math.random() * H }
      if (edge === 2) return { x: Math.random() * W, y: H + 6 }
      return { x: -6, y: Math.random() * H }
    }

    function groundSpeed(game) {
      return 13 + Math.min(16, game.level * 1.6) + Math.random() * 5
    }

    // Monster tiers. The tier is decided by how many tokens the player can spend
    // at once, and the colour tells the player which tier they are facing:
    // 1 橙 · 2 绿 · 3 紫 · 4 金.
    const TIERS = [
      { level: 1, cost: 50, hpMul: 1, r: 2.8, speedMul: 1, dmg: 9, xp: 1, gold: 0, size: 5 },
      { level: 2, cost: 110, hpMul: 3, r: 3.5, speedMul: 0.95, dmg: 12, xp: 4, gold: 1, size: 7 },
      { level: 3, cost: 220, hpMul: 6, r: 4.4, speedMul: 0.85, dmg: 18, xp: 10, gold: 3, size: 9 },
      { level: 4, cost: 400, hpMul: 10, r: 5.4, speedMul: 0.75, dmg: 24, xp: 22, gold: 6, size: 11 },
    ]

    const TIER_STYLE = {
      1: { rim: '#7e312c', body: '#c4534b', eye: '#ffd9d4' },
      2: { rim: '#2c5f34', body: '#4fae5a', eye: '#d6ffd9' },
      3: { rim: '#4d2379', body: '#8f4bd6', eye: '#ffd166' },
      4: { rim: '#7a5410', body: '#e0a526', eye: '#3a2a06' },
    }

    function spawnMonster(game, tier) {
      const at = spawnPoint(pickEdge(game))
      const hp = Math.round((6 + game.level * 3) * tier.hpMul)
      game.enemies.push({
        x: at.x,
        y: at.y,
        hp,
        maxHp: hp,
        r: tier.r,
        speed: groundSpeed(game) * tier.speedMul,
        dmg: tier.dmg,
        xp: tier.xp,
        gold: tier.gold,
        tier: tier.level,
        cool: 0,
        flash: 0,
      })
    }

    // Spend as much of the token debt as possible on the strongest tier the
    // player can afford: one big purchase beats a screen full of bodies.
    function pickTier(game) {
      const minLevel = game.enemies.length >= COMFORT_ENEMIES ? 2 : 1
      for (let i = TIERS.length - 1; i >= 0; i--) {
        const tier = TIERS[i]
        if (tier.level >= minLevel && game.spawnDebt >= tier.cost) return tier
      }
      return null
    }

    function highTierCount(game, level) {
      let n = 0
      for (const e of game.enemies) if (e.tier >= level) n += 1
      return n
    }

    function spark(game, x, y) {
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2
        game.sparks.push({ x, y, vx: Math.cos(a) * 26, vy: Math.sin(a) * 26, life: 0.25 })
      }
    }

    let CARD_SEQ = 0

    function rollCards() {
      const pool = UPGRADES.slice()
      const picked = []
      while (picked.length < 3 && pool.length > 0) {
        const upgrade = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
        // Each offered card is its own instance: the same upgrade can sit in the
        // pool twice after two level-ups, so it needs a unique identity.
        picked.push({
          uid: ++CARD_SEQ,
          id: upgrade.id,
          name: upgrade.name,
          desc: upgrade.desc,
          apply: upgrade.apply,
          delta: upgrade.delta,
        })
      }
      return picked
    }

    function buildSize(game) {
      let n = 0
      for (const count of Object.values(game.upgrades)) n += count
      return n
    }

    function buildEntries(game) {
      const rows = []
      for (const [id, count] of Object.entries(game.upgrades)) {
        const upgrade = UPGRADE_BY_ID.get(id)
        if (upgrade === undefined || count <= 0) continue
        rows.push([upgrade.name, count])
      }
      rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      return rows
    }

    function chooseCard(game, uid) {
      const index = game.offer.findIndex((entry) => entry.uid === uid)
      if (index < 0) return
      const card = game.offer[index]
      game.offer.splice(index, 1)
      card.apply(game.player)
      game.upgrades[card.id] = (game.upgrades[card.id] || 0) + 1
      game.pending = Math.max(0, game.pending - 1)
      // Outstanding picks are exhausted: whatever was left over is no longer
      // choosable, so clear it instead of leaving dead buttons around.
      if (game.pending <= 0) {
        game.pending = 0
        game.offer.length = 0
      }
      writeSave(game)
    }

    function movePlayer(game, dt) {
      const p = game.player
      let nearest = null
      let nd = Infinity
      for (const e of game.enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y)
        if (d < nd) {
          nd = d
          nearest = e
        }
      }

      // No mode switches at all: the orbit and the escape vector are both
      // evaluated every frame and blended by threat distance. A threshold (even
      // with hysteresis) still produces a back-and-forth cycle; a smooth blend
      // only changes how strongly each pull applies.
      game.orbit += dt * 0.5
      const tx = W / 2 + Math.cos(game.orbit) * 32
      const ty = H / 2 + Math.sin(game.orbit) * 26
      const ddx = tx - p.x
      const ddy = ty - p.y
      const dd = Math.hypot(ddx, ddy)
      let ovx = 0
      let ovy = 0
      if (dd > 0.001) {
        // Braking distance: a full-speed seek overshoots the target every frame.
        // The proportional speed makes the approach continuous, so no dead zone
        // is needed to stop it — it slows down to a stop instead of oscillating.
        const wanted = Math.min(p.speed, dd * 5)
        ovx = (ddx / dd) * wanted
        ovy = (ddy / dd) * wanted
      }

      let fvx = 0
      let fvy = 0
      let threat = 0
      if (nearest !== null) {
        // The kite distance follows the current range, so a long-range build
        // backs off earlier instead of standing still inside its own reach.
        const keepAway = clamp(p.range * 0.55, 20, 58)
        threat = clamp((keepAway * 1.35 - nd) / (keepAway * 0.75), 0, 1)
        if (threat > 0) {
          const inv = nd > 0.001 ? 1 / nd : 0
          const ax = (p.x - nearest.x) * inv
          const ay = (p.y - nearest.y) * inv
          // Away plus a sideways component: circle the threat instead of
          // running straight into a wall and stalling there.
          let dx = ax * 0.9 - ay * game.orbitSign * 0.55
          let dy = ay * 0.9 + ax * game.orbitSign * 0.55
          const len = Math.hypot(dx, dy)
          if (len > 0.001) {
            dx /= len
            dy /= len
          }
          fvx = dx * p.speed
          fvy = dy * p.speed
        }
      }

      let tvx = ovx * (1 - threat) + fvx * threat
      let tvy = ovy * (1 - threat) + fvy * threat

      // Soft wall avoidance: steer away from an edge before the position clamp
      // has to. Clamping alone makes the body press into the border and flip
      // between two directions every frame, which is the last source of
      // side-to-side vibration.
      const inset = 18
      const leftGap = p.x - 5
      const rightGap = W - 5 - p.x
      const topGap = p.y - 5
      const bottomGap = H - 5 - p.y
      if (leftGap < inset) tvx += p.speed * (1 - leftGap / inset) * 1.6
      if (rightGap < inset) tvx -= p.speed * (1 - rightGap / inset) * 1.6
      if (topGap < inset) tvy += p.speed * (1 - topGap / inset) * 1.6
      if (bottomGap < inset) tvy -= p.speed * (1 - bottomGap / inset) * 1.6

      const wantedMag = Math.hypot(tvx, tvy)
      const cap = p.speed * 1.15
      if (wantedMag > cap) {
        tvx = (tvx / wantedMag) * cap
        tvy = (tvy / wantedMag) * cap
      }

      // Velocity smoothing: the desired velocity is approached instead of
      // assigned, so a mode change bends the path rather than snapping it.
      const k = 1 - Math.exp(-dt * 9)
      p.vx += (tvx - p.vx) * k
      p.vy += (tvy - p.vy) * k

      // Exponential approach never reaches exactly zero. Snap it, otherwise
      // the sprite keeps flipping across a half-pixel rounding boundary.
      if (Math.hypot(p.vx, p.vy) < 1.5) {
        p.vx = 0
        p.vy = 0
      }

      let nx = p.x + p.vx * dt
      let ny = p.y + p.vy * dt
      if (nx < 5 || nx > W - 5) {
        nx = clamp(nx, 5, W - 5)
        p.vx = 0
      }
      if (ny < 5 || ny > H - 5) {
        ny = clamp(ny, 5, H - 5)
        p.vy = 0
      }
      p.x = nx
      p.y = ny
    }

    function fire(game) {
      const p = game.player
      let target = null
      let nd = p.range
      for (const e of game.enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y)
        if (d < nd) {
          nd = d
          target = e
        }
      }
      if (target === null) return
      const base = Math.atan2(target.y - p.y, target.x - p.x)
      for (let i = 0; i < p.projectiles; i++) {
        const a = base + (i - (p.projectiles - 1) / 2) * 0.18
        game.bullets.push({
          x: p.x,
          y: p.y,
          vx: Math.cos(a) * 130,
          vy: Math.sin(a) * 130,
          dmg: p.dmg,
          // The bullet must be able to reach the edge of the range it was fired
          // over, otherwise every range upgrade past ~140px does nothing.
          life: p.range / 130 + 0.05,
          pierce: p.pierce,
        })
      }
    }

    function updatePressure(game) {
      const active = clamp(game.activeSessions, 1, 4)
      const base = game.running ? 1 + (active - 1) * 0.5 : 0.6
      const busy = game.busyMs > 10000 ? 1.4 : 1
      game.pressure = base * busy
    }

    function tick(game, dt) {
      if (game.dead) {
        game.deadTimer -= dt
        if (game.deadTimer <= 0) respawn(game)
        return
      }
      const p = game.player
      updatePressure(game)

      // Baseline wanderers: the arena is never fully empty, even when no
      // tokens are being spent.
      game.idleTimer -= dt
      if (game.idleTimer <= 0) {
        if (game.enemies.length < MAX_ENEMIES) spawnMonster(game, TIERS[0])
        game.idleTimer = BASE_SPAWN_SECONDS / Math.max(0.2, game.pressure)
      }

      // Token-driven tiers: the debt is spent on the strongest tier it can
      // afford, so a big turn produces a few high-tier bodies, not a wall.
      let guard = 0
      while (guard < 64) {
        const tier = pickTier(game)
        if (tier === null) break
        game.spawnDebt -= tier.cost
        guard += 1
        if (game.enemies.length >= MAX_ENEMIES) {
          game.gold += 1
          continue
        }
        spawnMonster(game, tier)
      }

      // One tool dispatch = one tier-3 monster.
      while (game.eliteQueue > 0) {
        game.eliteQueue -= 1
        if (game.enemies.length >= MAX_ENEMIES) break
        if (highTierCount(game, 3) >= MAX_ELITES) spawnMonster(game, TIERS[0])
        else spawnMonster(game, TIERS[2])
      }

      game.prevX = p.x
      game.prevY = p.y
      movePlayer(game, dt)

      p.fireTimer -= dt
      if (p.fireTimer <= 0) {
        fire(game)
        p.fireTimer = p.fireEvery
      }

      for (let i = game.enemies.length - 1; i >= 0; i--) {
        const e = game.enemies[i]
        const dx = p.x - e.x
        const dy = p.y - e.y
        const d = Math.hypot(dx, dy) || 1
        if (d > e.r + 2) {
          e.x += (dx / d) * e.speed * dt
          e.y += (dy / d) * e.speed * dt
        }
        if (e.flash > 0) e.flash -= dt
        if (e.cool > 0) e.cool -= dt
        if (d < e.r + 3 && e.cool <= 0) {
          e.cool = 0.8
          p.hp -= e.dmg * (1 - p.armor)
        }
      }

      for (let i = game.bullets.length - 1; i >= 0; i--) {
        const b = game.bullets[i]
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.life -= dt
        if (b.life <= 0 || b.x < -4 || b.x > W + 4 || b.y < -4 || b.y > H + 4) {
          game.bullets.splice(i, 1)
          continue
        }
        for (let j = game.enemies.length - 1; j >= 0; j--) {
          const e = game.enemies[j]
          if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + 2) {
            e.hp -= b.dmg
            e.flash = 0.08
            b.pierce -= 1
            if (e.hp <= 0) {
              game.enemies.splice(j, 1)
              game.kills += 1
              game.xp += e.xp
              game.runXp += e.xp
              if (e.gold) game.gold += e.gold
              if (p.leech > 0) p.hp = Math.min(p.maxHp, p.hp + p.leech)
              spark(game, e.x, e.y)
            }
            if (b.pierce <= 0) {
              game.bullets.splice(i, 1)
              break
            }
          }
        }
      }

      for (let i = game.sparks.length - 1; i >= 0; i--) {
        const s = game.sparks[i]
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.life -= dt
        if (s.life <= 0) game.sparks.splice(i, 1)
      }

      if (game.xp >= game.xpNext) {
        game.xp -= game.xpNext
        game.level += 1
        game.xpNext = nextXpFor(game.level)
        if (game.pending < MAX_PENDING) {
          game.pending += 1
          // Roll at level-up time and keep every roll: options the player has
          // already been shown are never replaced by a fresh roll.
          for (const card of rollCards()) game.offer.push(card)
        } else {
          game.gold += 2
        }
      }

      if (p.hp <= 0) {
        p.hp = 0
        game.dead = true
        game.deadTimer = 2.6
        game.runs += 1
        const gain = Math.floor(game.runXp * 0.3)
        game.genes += gain
        game.lastGeneGain = gain
        game.bestLevel = Math.max(game.bestLevel, game.level)
        // Level and build stay on the character; only the run ends.
        writeSave(game)
      }
    }

    function drawPlayer(c, px, py, moving) {
      const x = Q(px) - 3
      const y = Q(py) - 3
      c.fillStyle = COLORS.playerDark
      c.fillRect(x, y + 5, 6, 1)
      c.fillStyle = COLORS.player
      c.fillRect(x, y, 6, 5)
      c.fillStyle = COLORS.eye
      c.fillRect(x + 1, y + 2, 1, 1)
      c.fillRect(x + 4, y + 2, 1, 1)
      if (moving) {
        c.fillStyle = COLORS.playerDark
        c.fillRect(x, y + 6, 1, 1)
        c.fillRect(x + 5, y + 6, 1, 1)
      }
    }

    function drawEnemy(c, e) {
      const lit = e.flash > 0
      const tier = TIERS[e.tier - 1] || TIERS[0]
      const style = TIER_STYLE[tier.level]
      const size = tier.size
      const half = Math.floor(size / 2)
      const x = Q(e.x) - half
      const y = Q(e.y) - half
      c.fillStyle = lit ? '#ffffff' : style.rim
      c.fillRect(x, y, size, size)
      c.fillStyle = lit ? '#ffffff' : style.body
      c.fillRect(x + 1, y + 1, size - 2, size - 2)
      if (!lit) {
        const inset = Math.floor(size / 4)
        c.fillStyle = style.eye
        c.fillRect(x + inset, y + inset, 1, 1)
        c.fillRect(x + size - 1 - inset, y + inset, 1, 1)
      }
      if (tier.level > 1 && e.hp < e.maxHp) {
        c.fillStyle = '#12161c'
        c.fillRect(x - 1, y - 3, size + 2, 1)
        c.fillStyle = style.body
        c.fillRect(x - 1, y - 3, Math.max(1, Math.round((e.hp / e.maxHp) * (size + 2))), 1)
      }
    }

    function drawRangeRing(c, p) {
      const r = p.range
      if (r < 8) return
      c.fillStyle = '#1d3a52'
      const steps = Math.max(24, Math.round(r * 1.4))
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2
        c.fillRect(Q(p.x + Math.cos(a) * r), Q(p.y + Math.sin(a) * r), 1, 1)
      }
    }

    function draw(c, game, time) {
      // The buffer is 2x the logical arena, so every logical unit is two
      // device pixels and half-pixel positions stay crisp.
      c.setTransform(2, 0, 0, 2, 0, 0)
      c.imageSmoothingEnabled = false
      c.fillStyle = COLORS.bg
      c.fillRect(0, 0, W, H)
      c.fillStyle = COLORS.grid
      for (let x = 8; x < W; x += 8) {
        for (let y = 8; y < H; y += 8) c.fillRect(x, y, 1, 1)
      }
      c.fillStyle = COLORS.frame
      c.fillRect(0, 0, W, 1)
      c.fillRect(0, H - 1, W, 1)
      c.fillRect(0, 0, 1, H)
      c.fillRect(W - 1, 0, 1, H)
      // Draw the firing reach so "range" is a visible boundary, not a number.
      drawRangeRing(c, game.player)
      for (const e of game.enemies) drawEnemy(c, e)
      c.fillStyle = COLORS.bullet
      for (const b of game.bullets) c.fillRect(Q(b.x), Q(b.y), 1, 2)

      // Render between the last two simulation steps: fixed-step updates land
      // unevenly on a display frame, and without this the whole scene stutters.
      const p = game.player
      const alpha = clamp(game.acc / STEP, 0, 1)
      const px = game.prevX === undefined ? p.x : game.prevX + (p.x - game.prevX) * alpha
      const py = game.prevY === undefined ? p.y : game.prevY + (p.y - game.prevY) * alpha
      drawPlayer(c, px, py, Math.hypot(p.vx, p.vy) > 8)

      c.fillStyle = COLORS.spark
      for (const s of game.sparks) {
        if (s.life > 0) c.fillRect(Q(s.x), Q(s.y), 1, 1)
      }
    }

    // One character per workspace: every panel showing that workspace shares
    // the same simulation, and only mounted panels keep it ticking.
    const ENTRIES = new Map()

    function startTicker(entry) {
      if (entry.raf !== 0) return
      entry.last = performance.now()
      const loop = (now) => {
        entry.raf = window.requestAnimationFrame(loop)
        const dt = Math.min(0.1, (now - entry.last) / 1000)
        entry.last = now
        entry.game.acc += dt
        let guard = 0
        while (entry.game.acc >= STEP && guard < 6) {
          tick(entry.game, STEP)
          entry.game.acc -= STEP
          guard += 1
        }
        if (guard >= 6) entry.game.acc = 0
      }
      entry.raf = window.requestAnimationFrame(loop)
    }

    function acquireEntry(key) {
      let entry = ENTRIES.get(key)
      if (entry === undefined) {
        entry = { game: createGame(key), subs: 0, raf: 0, last: 0 }
        ENTRIES.set(key, entry)
      }
      entry.subs += 1
      startTicker(entry)
      return entry
    }

    function releaseEntry(key) {
      const entry = ENTRIES.get(key)
      if (entry === undefined) return
      entry.subs = Math.max(0, entry.subs - 1)
      if (entry.subs === 0 && entry.raf !== 0) {
        window.cancelAnimationFrame(entry.raf)
        entry.raf = 0
        writeSave(entry.game)
      }
    }

    function PetBody(props) {
      const sessionId = props !== null && props.sessionId !== undefined ? String(props.sessionId) : ''
      const canvasRef = React.useRef(null)
      const gameRef = React.useRef(null)
      const [key, setKey] = React.useState(null)
      const bump = React.useReducer((n) => n + 1, 0)[1]

      React.useEffect(() => {
        if (key === null) return undefined
        const entry = acquireEntry(key)
        gameRef.current = entry.game
        bump()
        return () => {
          gameRef.current = null
          releaseEntry(key)
        }
      }, [key, bump])

      React.useEffect(() => {
        let raf = 0
        const loop = (now) => {
          raf = window.requestAnimationFrame(loop)
          const game = gameRef.current
          const canvas = canvasRef.current
          if (game === null || canvas === null) return
          const c = canvas.getContext('2d')
          if (c !== null) draw(c, game, now / 1000)
        }
        raf = window.requestAnimationFrame(loop)
        return () => window.cancelAnimationFrame(raf)
      }, [])

      React.useEffect(() => {
        let disposed = false
        let failures = 0
        let keyRef = null
        const poll = async () => {
          if (disposed) return
          try {
            const res = await window.fetch('/dsh-pet/usage', { headers: { accept: 'application/json' } })
            if (!res.ok) throw new Error('status ' + res.status)
            const data = await res.json()
            const table = data !== null && typeof data === 'object' ? data.sessions : undefined
            if (table === null || typeof table !== 'object') throw new Error('bad payload')

            const own = table[sessionId]
            const nextKey =
              own !== undefined && typeof own.workspaceKey === 'string' && own.workspaceKey.length > 0
                ? own.workspaceKey
                : 'session:' + sessionId
            if (keyRef !== nextKey) {
              keyRef = nextKey
              setKey(nextKey)
            }

            const game = gameRef.current
            if (game === null) return
            failures = 0
            game.online = true

            let active = 0
            let busy = 0
            let running = false
            for (const [sid, entry] of Object.entries(table)) {
              if (entry === null || typeof entry !== 'object') continue
              if (entry.workspaceKey !== nextKey) continue
              if (entry.running === true) {
                active += 1
                running = true
              }
              if (typeof entry.busyMs === 'number' && entry.busyMs > busy) busy = entry.busyMs

              const out = typeof entry.outputTokens === 'number' ? entry.outputTokens : 0
              const used = typeof entry.totalTokens === 'number' ? entry.totalTokens : 0
              const tools = typeof entry.toolCalls === 'number' ? entry.toolCalls : 0
              const seen = game.seen.get(sid)
              if (seen === undefined) {
                const prior = game.seenUsed[sid]
                const baseline = typeof prior === 'number' && Number.isFinite(prior) ? prior : used
                game.seen.set(sid, { out, used: baseline, tools })
                if (used > baseline) game.consumed += used - baseline
                game.seenUsed[sid] = used
                continue
              }
              const delta = out - seen.out
              if (delta > 0) {
                game.spawnDebt += delta
                game.tokens += delta
                game.totalTokens += delta
              }
              seen.out = out
              const usedDelta = used - seen.used
              if (usedDelta > 0) game.consumed += usedDelta
              seen.used = used
              game.seenUsed[sid] = used
              const toolDelta = tools - seen.tools
              if (toolDelta > 0) game.eliteQueue += Math.min(4, toolDelta)
              seen.tools = tools
            }

            game.running = running
            game.busyMs = busy
            game.activeSessions = Math.max(1, active)
            game.liveSessions = Object.keys(table).length
          } catch {
            failures += 1
            const game = gameRef.current
            if (game !== null && failures >= 3) {
              game.online = false
              game.running = true
              game.spawnDebt += 6
              game.tokens += 6
            }
          }
        }
        poll()
        const id = window.setInterval(poll, POLL_MS)
        return () => {
          disposed = true
          window.clearInterval(id)
        }
      }, [sessionId])

      React.useEffect(() => {
        const id = window.setInterval(() => bump(), 120)
        return () => window.clearInterval(id)
      }, [bump])

      React.useEffect(() => {
        if (key === null) return undefined
        const id = window.setInterval(() => {
          if (gameRef.current !== null) writeSave(gameRef.current)
        }, 3000)
        return () => {
          window.clearInterval(id)
          if (gameRef.current !== null) writeSave(gameRef.current)
        }
      }, [key])

      const game = gameRef.current
      if (game === null) {
        return h('div', { className: 'dsh-pet' },
          h('style', { key: 'style' }, CSS),
          h('div', { className: 'dsh-pet-top' },
            h('span', { className: 'dsh-pet-lv' }, '宠物'),
            h('span', { className: 'dsh-pet-dot' }, '连接中…'),
          ),
        )
      }

      const p = game.player
      const hpPct = clamp((p.hp / p.maxHp) * 100, 0, 100)
      const xpPct = clamp((game.xp / game.xpNext) * 100, 0, 100)
      const statusText = game.online ? (game.running ? '进行中' : '待机') : '离线演示'
      const build = buildSize(game)
      const tierRows = []
      for (const tier of TIERS) {
        let count = 0
        for (const enemy of game.enemies) if (enemy.tier === tier.level) count += 1
        tierRows.push({ level: tier.level, count })
      }

      return h('div', { className: 'dsh-pet' },
        h('style', { key: 'style' }, CSS),
        h('div', { className: 'dsh-pet-top' },
          h('span', { className: 'dsh-pet-lv' }, 'Lv.' + game.level),
          h('span', { className: 'dsh-pet-stat' }, '击杀 ' + game.kills),
          h('span', { className: 'dsh-pet-stat' }, '强化 ' + build),
          h('span', {
            className: 'dsh-pet-usage',
            title: '本工作区累计消耗 ' + Math.round(game.consumed) + ' token（输入 + 输出，自插件启用以来的观测值）',
          }, '累计 ' + formatTokens(game.consumed)),
          h('span', { className: 'dsh-pet-dot' + (game.running ? ' on' : '') }, statusText),
        ),
        h('div', { className: 'dsh-pet-xp' }, h('i', { style: { width: xpPct + '%' } })),
        h('div', { className: 'dsh-pet-stage' },
          h('canvas', { ref: canvasRef, width: W * 2, height: H * 2, className: 'dsh-pet-canvas' }),
          game.offer.length > 0
            ? h('div', { className: 'dsh-pet-cards' },
                h('div', { className: 'dsh-pet-cards-title' }, '升级 · 待选 ×' + game.pending),
                h('div', { className: 'dsh-pet-cards-list' },
                  game.offer.map((card) =>
                    h('button', {
                      key: card.uid,
                      type: 'button',
                      className: 'dsh-pet-card',
                      onClick: () => {
                        chooseCard(gameRef.current, card.uid)
                        bump()
                      },
                    },
                      h('span', { className: 'dsh-pet-card-head' },
                        h('span', { className: 'dsh-pet-card-name' }, card.name),
                        h('span', { className: 'dsh-pet-card-delta' }, card.delta(game.player)),
                      ),
                      h('span', { className: 'dsh-pet-card-desc' }, card.desc),
                    ),
                  ),
                ),
              )
            : null,
          game.dead
            ? h('div', { className: 'dsh-pet-dead' },
                h('div', { className: 'dsh-pet-dead-title' }, '阵亡'),
                h('div', { className: 'dsh-pet-dead-sub' }, '保留 Lv.' + game.level + ' 与全部强化'),
              )
            : null,
        ),
        h('div', { className: 'dsh-pet-hp' }, h('i', { style: { width: hpPct + '%' } })),
        h('div', { className: 'dsh-pet-stats' },
          h('span', null, '移速 ' + Math.round(p.speed)),
          h('span', null, '射程 ' + Math.round(p.range)),
          h('span', null, '伤害 ' + Math.round(p.dmg)),
          h('span', null, '间隔 ' + p.fireEvery.toFixed(2) + 's'),
        ),
        h('div', { className: 'dsh-pet-tiers' },
          tierRows.map((row) =>
            h('span', {
              key: row.level,
              className: 'dsh-pet-tier' + (row.count === 0 ? ' zero' : ''),
            },
              h('i', { style: { background: TIER_STYLE[row.level].body } }),
              row.count,
            ),
          ),
        ),
        build > 0
          ? h('div', { className: 'dsh-pet-build' },
              buildEntries(game).map((row) =>
                h('span', { key: row[0], className: 'dsh-pet-chip' }, row[0] + '×' + row[1]),
              ),
            )
          : null,
        h('div', { className: 'dsh-pet-bottom' },
          h('span', null, 'HP ' + Math.max(0, Math.round(p.hp)) + '/' + Math.round(p.maxHp)),
          h('span', { className: game.enemies.length >= COMFORT_ENEMIES ? 'dsh-pet-hot' : null },
            '敌 ' + game.enemies.length + '/' + MAX_ENEMIES),
          h('span', null, '会话 ' + clamp(game.activeSessions, 1, 4)),
          game.busyMs > 10000 ? h('span', null, '工具 ' + Math.round(game.busyMs / 1000) + 's') : null,
          game.pending > 0 ? h('span', { className: 'dsh-pet-pending' }, '待选 ×' + game.pending) : null,
        ),
      )
    }

    const TRIGGER_STYLE = {
      width: 26,
      height: 26,
      padding: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
      border: '1px solid transparent',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      fontSize: 14,
      lineHeight: 1,
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        const PetTrigger = () =>
          h('button', {
            type: 'button',
            className: 'dsh-pet-trigger',
            title: '打开宠物',
            'aria-label': '打开宠物',
            style: TRIGGER_STYLE,
            onClick: () => {
              ctx.sidebarRight.openTab(KIND)
            },
          }, h('span', { 'aria-hidden': true }, '🐾'))

        ctx.effect(() =>
          ctx.sidebarRightTabs.register({
            id: TYPE_ID,
            kind: KIND,
            title: () => '宠物',
            keepMounted: true,
            guide: [{ id: 'pet', title: '宠物', description: '用输出 token 驱动的自动战斗' }],
          }),
        )

        ctx.effect(() =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TYPE_ID }, PetBody),
          ),
        )

        ctx.effect(() =>
          ctx.slots.inject('conversation.input.right', () =>
            ctx.slots.register(
              { name: 'conversation.input.right', id: 'dsh-pet-trigger', order: 40 },
              PetTrigger,
            ),
          ),
        )
      },
    }
  },
})
