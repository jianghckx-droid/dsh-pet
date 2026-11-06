window.__ModuleLoader__.load({
  id: 'dsh-pet',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // <core>
    // 由 tools/build-client.mjs 从 src/game/*.js 生成，不要手改这一段。
    // ---- rules.js ----
    // 战斗规则：唯一一份。
    //
    // 游戏端（client.js）与数值模拟器（tools/balance-sim.mjs）都必须从这里取规则，
    // 否则"设计用的数字"和"跑起来的游戏"会各算各的。
    //
    // 三条硬规则，改动前先看 docs/design.md §5 与 docs/cards.md §1：
    //   1. 结算顺序固定：基础格 → +锋锐 → 锁裁决 → 扣格
    //   2. 锁永远最后裁决，所以属性无法覆盖锁
    //   3. 锋锐只加主攻击，不加灼烧跳/雷跳/碎冰/尸爆/斩杀

    const BURN = Object.freeze({
      cap: 5, // 每个目标最多 5 层
      tickSeconds: 1.5, // 每层每 1.5 秒造成 1 格
      durationSeconds: 6, // 叠层后 6 秒内没有新层就熄灭
      damagePerStack: 1,
    });

    const PLAYER = Object.freeze({
      baseCells: 12,
      cellsPerBody: 2, // 体魄：+2 格/点
      pointsPerEdgeCell: 2, // 锋锐：每 2 点 +1 格
    });

    const ATTR_MAX = 10;

    const ATTRIBUTES = Object.freeze([
      Object.freeze({ id: 'edge', label: '锋锐', max: ATTR_MAX, desc: '每 2 点 +1 格' }),
      Object.freeze({ id: 'swift', label: '迅捷', max: ATTR_MAX, desc: '冷却 −4%/点' }),
      Object.freeze({ id: 'body', label: '体魄', max: ATTR_MAX, desc: '生命 +2 格/点' }),
      Object.freeze({ id: 'tough', label: '坚韧', max: ATTR_MAX, desc: '受伤 −3%/点' }),
      Object.freeze({ id: 'recover', label: '复原', max: ATTR_MAX, desc: '每秒 +0.2 格' }),
      Object.freeze({ id: 'vision', label: '视野', max: ATTR_MAX, desc: '射程 +6%/点' }),
    ]);

    const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(v) ? v : lo)));

    function normalizeAttrs(attrs = {}) {
      const out = {};
      for (const attr of ATTRIBUTES) out[attr.id] = clampInt(attrs[attr.id] ?? 0, 0, attr.max);
      return out;
    }

    function attrsSpent(attrs = {}) {
      let n = 0;
      for (const attr of ATTRIBUTES) n += attrs[attr.id] ?? 0;
      return n;
    }

    function playerCells(attrs = {}) {
      return PLAYER.baseCells + (attrs.body ?? 0) * PLAYER.cellsPerBody;
    }

    function edgeCells(attrs = {}) {
      return Math.floor((attrs.edge ?? 0) / PLAYER.pointsPerEdgeCell);
    }

    /** 坚韧：受伤 −3%/点，至少还是掉 1 格以下（不取整，格数允许小数）。 */
    function damageTaken(cells, attrs = {}) {
      const cut = (attrs.tough ?? 0) * 0.03;
      return Math.max(0.1, cells * (1 - cut));
    }

    /** 迅捷：冷却 −4%/点。 */
    function cooldown(cd, attrs = {}) {
      return cd * (1 - (attrs.swift ?? 0) * 0.04);
    }

    /** 复原：每秒 +0.2 格。 */
    function regenPerSecond(attrs = {}) {
      return (attrs.recover ?? 0) * 0.2;
    }

    /** 视野：射程 / 领域半径 +6%/点。 */
    function visionScale(attrs = {}) {
      return 1 + (attrs.vision ?? 0) * 0.06;
    }

    /** 主攻击的格数：卡面基础格 + 锋锐。衍生效果不要调这个函数。 */
    function attackCells(card, attrs = {}) {
      return (card.cells ?? 1) + edgeCells(attrs);
    }

    function locksOf(enemy) {
      if (Array.isArray(enemy.locks)) return enemy.locks;
      return enemy.lock ? [enemy.lock] : [];
    }

    /**
     * 锁裁决。
     * main=true 表示主攻击（吃护盾正面减伤），false 表示衍生伤害（灼烧跳等）。
     */
    function resolveHit(enemy, cells, { main = true } = {}) {
      let dealt = cells;
      for (const lock of locksOf(enemy)) {
        if (lock === 'carapace') {
          dealt = Math.min(dealt, 1); // 单次最多 1 格
        } else if (lock === 'shield' && main) {
          dealt = Math.max(0, dealt - 1); // 正面直接命中 -1 格
        }
      }
      return Math.max(0, dealt);
    }

    function createStatus() {
      return { burn: 0, burnLeft: 0, burnTick: BURN.tickSeconds };
    }

    function applyBurn(status, stacks) {
      if (stacks <= 0) return;
      status.burn = Math.min(BURN.cap, status.burn + stacks);
      status.burnLeft = BURN.durationSeconds;
    }

    /**
     * 推进状态，返回这一帧的灼烧伤害（0 表示没有跳）。
     * 调用方负责再走一次 resolveHit(..., { main: false })。
     */
    function advanceStatus(status, dt) {
      if (status.burn <= 0) return 0;
      status.burnLeft -= dt;
      if (status.burnLeft <= 0) {
        status.burn = 0;
        return 0;
      }
      status.burnTick -= dt;
      if (status.burnTick > 0) return 0;
      status.burnTick += BURN.tickSeconds;
      return status.burn * BURN.damagePerStack;
    }

    /**
     * 稳态 DPS：忽略预热与目标死亡，用来比较 build 的形状。
     * 数值模拟器与单测共用，保证"设计稿里的 5 倍差距"能被复现。
     */
    function steadyDps(cards, attrs, enemy) {
      let direct = 0;
      let burnPerSecond = 0;
      for (const card of cards) {
        direct += resolveHit(enemy, attackCells(card, attrs), { main: true }) / card.cd;
        burnPerSecond += (card.burn ?? 0) / card.cd;
      }
      // 层数只在"连续 6 秒没有新层"时整体熄灭，不会逐层衰减。
      // 所以平衡态是"6 秒内能叠到几层"，再受 5 层上限约束。
      const stacks = Math.min(BURN.cap, burnPerSecond * BURN.durationSeconds);
      return direct + (stacks * BURN.damagePerStack) / BURN.tickSeconds;
    }

    // ---- cards.js ----
    // 卡片数据（MVP 子集：灼烧包）。
    //
    // 只收录"行为已经实现"的卡。docs/cards.md 里的 24 张是完整设计，
    // 但没实现的卡不进代码——否则会出现"有数据、没行为"的死卡。
    //
    // 与 cards.md §7 的偏差：MVP 用「斩杀 / 时锚」替换了「压缩 / 禁疗」，
    // 因为 MVP 没有回血敌人，禁疗无处生效。

    const STARTER_ID = 'orb_phys';

    const CARDS = Object.freeze({
      orb_phys: Object.freeze({
        id: 'orb_phys',
        name: '铁弹',
        carrier: 'orb',
        effect: 'phys',
        cells: 1,
        cd: 0.7,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['phys', 'single']),
        solves: Object.freeze(['shield']),
        desc: '击退；对护盾 +1 格',
      }),
      orb_fire: Object.freeze({
        id: 'orb_fire',
        name: '火箭',
        carrier: 'orb',
        effect: 'fire',
        cells: 1,
        cd: 0.9,
        burn: 1,
        aoe: 0,
        tags: Object.freeze(['fire', 'single', 'dot']),
        solves: Object.freeze(['carapace', 'regen']),
        desc: '灼烧 +1 层',
      }),
      field_fire: Object.freeze({
        id: 'field_fire',
        name: '火海',
        carrier: 'field',
        effect: 'fire',
        cells: 1,
        cd: 1.5,
        burn: 1,
        aoe: 3,
        tags: Object.freeze(['fire', 'aoe', 'dot']),
        solves: Object.freeze(['carapace', 'summon']),
        desc: '半径内最多 3 个目标，各 1 格 + 灼烧 +1',
      }),
      summon_fire: Object.freeze({
        id: 'summon_fire',
        name: '火灵',
        carrier: 'summon',
        effect: 'fire',
        cells: 1,
        cd: 1.2,
        burn: 1,
        aoe: 0,
        tags: Object.freeze(['fire', 'single', 'dot']),
        solves: Object.freeze(['carapace', 'regen']),
        desc: '射程 36，灼烧 +1；生命 4',
      }),
      self_fire: Object.freeze({
        id: 'self_fire',
        name: '燃身',
        carrier: 'self',
        effect: 'fire',
        cells: 1,
        cd: 3,
        burn: 2,
        aoe: 0,
        tags: Object.freeze(['fire', 'self', 'dot']),
        solves: Object.freeze(['carapace']),
        desc: '每 3 秒：周围 1 格 + 灼烧 2 层',
      }),
      rule_boom: Object.freeze({
        id: 'rule_boom',
        name: '尸爆',
        carrier: 'rule',
        effect: 'fire',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'aoe']),
        solves: Object.freeze(['split', 'summon']),
        desc: '击杀时对周围造成 2 次 1 格',
      }),
      rule_combo: Object.freeze({
        id: 'rule_combo',
        name: '连击',
        carrier: 'rule',
        effect: 'fire',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'multi']),
        solves: Object.freeze(['carapace']),
        desc: '每 4 次命中，追加 1 次 1 格',
      }),
      rule_execute: Object.freeze({
        id: 'rule_execute',
        name: '斩杀',
        carrier: 'rule',
        effect: 'fire',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'execute']),
        solves: Object.freeze(['split', 'summon']),
        desc: '命中后，2 格以下的目标直接移除',
      }),
      rule_anchor: Object.freeze({
        id: 'rule_anchor',
        name: '时锚',
        carrier: 'rule',
        effect: 'fire',
        cells: 0,
        cd: 0,
        burn: 0,
        aoe: 0,
        tags: Object.freeze(['rule', 'control']),
        solves: Object.freeze(['bomb']),
        desc: '每 10 秒冻结全场 1.2 秒',
      }),
    });

    /** 灼烧包的抽卡池：已拥有铁弹 + 三件套时，从这 8 张里出三选一。 */
    const FIRE_PACK = Object.freeze([
      'orb_fire',
      'field_fire',
      'summon_fire',
      'self_fire',
      'rule_boom',
      'rule_combo',
      'rule_execute',
      'rule_anchor',
    ]);

    /** 灼烧包的开局 build（模拟器与单测用）。 */
    const FIRE_BUILD = Object.freeze(['orb_phys', 'orb_fire', 'field_fire', 'summon_fire']);

    function cardsById(ids) {
      return ids.map((id) => {
        const card = CARDS[id];
        if (card === undefined) throw new Error(`unknown card: ${id}`);
        return card;
      });
    }

    // ---- floors.js ----
    // 层数表（1–12 层，MVP 用 1–8）。
    //
    // 数值来自 docs/floors.md，改动前先跑 `node tools/balance-sim.mjs --sweep`
    // 确认第 6 层那道墙还在。
    //
    // "双锁混编"的实现是：同一层的敌人轮换携带不同的单锁，而不是一只怪同时带两个锁。
    // 同时带两个锁的怪留给以后（倍率相乘已经是按这个设计的）。

    const FLOOR_SECONDS = 30;

    /** 锁对格数的倍率。一只怪带多个锁时相乘。 */
    const LOCK_CELLS = Object.freeze({
      carapace: 2,
      split: 1.2,
      regen: 1.5,
      shield: 1.5,
    });

    function baseCells(floor) {
      return 3 + 1.2 * floor;
    }

    function lockMultiplier(locks = []) {
      return locks.reduce((m, lock) => m * (LOCK_CELLS[lock] ?? 1), 1);
    }

    /** 先乘倍率再取整，否则 ×2 的锁会比设计值少 1 格（第 7 层就是例子）。 */
    function enemyCells(floor, locks = []) {
      return Math.round(baseCells(floor) * lockMultiplier(locks));
    }

    function enemyDamage(floor) {
      return floor >= 8 ? 2 : 1;
    }

    function spawnSeconds(def) {
      return FLOOR_SECONDS / def.enemies;
    }

    const FLOORS = Object.freeze([
      Object.freeze({ floor: 1, enemies: 6, locks: Object.freeze([]) }),
      Object.freeze({ floor: 2, enemies: 7, locks: Object.freeze([]) }),
      Object.freeze({ floor: 3, enemies: 8, locks: Object.freeze([]) }),
      Object.freeze({ floor: 4, enemies: 9, locks: Object.freeze([]) }),
      Object.freeze({ floor: 5, enemies: 10, locks: Object.freeze([]) }),
      Object.freeze({ floor: 6, enemies: 10, locks: Object.freeze(['carapace']) }),
      Object.freeze({ floor: 7, enemies: 10, locks: Object.freeze(['carapace']) }),
      Object.freeze({ floor: 8, enemies: 11, locks: Object.freeze(['carapace']) }),
      Object.freeze({ floor: 9, enemies: 10, locks: Object.freeze(['split']) }),
      Object.freeze({ floor: 10, enemies: 11, locks: Object.freeze(['split']) }),
      Object.freeze({ floor: 11, enemies: 12, locks: Object.freeze(['carapace', 'split']) }),
      Object.freeze({ floor: 12, enemies: 12, locks: Object.freeze(['carapace', 'split']) }),
    ]);

    /** MVP 只做到第 8 层（第 6 层是墙，第 8 层是切片上限）。 */
    const MVP_FLOOR_COUNT = 8;

    const MVP_FLOORS = Object.freeze(FLOORS.filter((f) => f.floor <= MVP_FLOOR_COUNT));

    function floorDef(n) {
      const def = FLOORS.find((f) => f.floor === n);
      if (def === undefined) throw new Error(`floor not in table: ${n}`);
      return def;
    }

    // ---- arena.js ----
    // 战斗状态机（无渲染、无 DOM、可复现）。
    //
    // 这一层是游戏真正的核心：位置、走位、刷怪、命中、状态、层推进、三选一。
    // client.js 只负责把 battle 画出来；测试直接跑这里。
    //
    // 设计约束：
    //   - 纯函数式推进：step(battle, dt)，不读全局、不用 Math.random
    //   - 同一 seed + 同一 dt 序列 → 同一结果
    //   - 所有伤害都走 rules.js 的 resolveHit，锁不会在这里被绕过
    //   - 抽卡只在 arena 里发生，UI 只调用 chooseCard
    //
    // 已知取舍：
    //   - 没有寻路，敌人直线追玩家；160×144 的场地不需要
    //   - 走位是"绕最近目标 + 回中心"的启发式，不是完整 AI（轮次 5 再做）
    //   - 召唤物是炮台：会攻击，但不会被敌人选为目标
    //   - 分裂子体不给经验，避免刷经验

    const ARENA = Object.freeze({ w: 160, h: 144 });
    const TIME_LIMIT = 45;
    const MAX_SLOTS = 3;

    const PLAYER_SPEED = 52;
    const PLAYER_RADIUS = 3;
    const CONTACT_PAD = 1.5;
    const ENEMY_ATTACK_INTERVAL = 1.6;
    const ENEMY_SPEED_BASE = 24;
    const ENEMY_SPEED_PER_FLOOR = 1.2;
    const ORB_RANGE = 74;
    const FIELD_RADIUS = 30;
    const SUMMON_RANGE = 42;
    const BULLET_SPEED = 180;
    const BULLET_HIT_RADIUS = 3.5;
    const KEEP_DISTANCE = 42;
    const CENTER_PULL = 56;

    const SELF_RADIUS = 20;
    const BOOM_RADIUS = 14;
    const FREEZE_SECONDS = 1.2;
    const ANCHOR_SECONDS = 10;
    const COMBO_EVERY = 4;
    const EXECUTE_THRESHOLD = 2;
    const XP_PER_CELL = 3;

    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    function mulberry32(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function enemyRadius(cells) {
      return 2.5 + Math.min(3.5, cells / 10);
    }

    function spawnPoint(rng) {
      const edge = Math.floor(rng() * 4);
      if (edge === 0) return { x: rng() * ARENA.w, y: -6 };
      if (edge === 1) return { x: ARENA.w + 6, y: rng() * ARENA.h };
      if (edge === 2) return { x: rng() * ARENA.w, y: ARENA.h + 6 };
      return { x: -6, y: rng() * ARENA.h };
    }

    const hasRule = (battle, id) => battle.rules.some((rule) => rule.id === id);
    const orbRange = (battle) => ORB_RANGE * visionScale(battle.attrs);
    const fieldRadius = (battle) => FIELD_RADIUS * visionScale(battle.attrs);
    const selfRadius = (battle) => SELF_RADIUS * visionScale(battle.attrs);
    const summonRange = (battle) => SUMMON_RANGE * visionScale(battle.attrs);

    /** 把一张卡加进当前战斗。开局 build 与抽卡都走这里。 */
    function addCard(battle, id) {
      const card = cardsById([id])[0];
      battle.cards.push(card);
      if (card.carrier === 'rule') {
        battle.rules.push(card);
        return card;
      }
      if (card.carrier === 'self') {
        battle.selfs.push({ card, timer: cooldown(card.cd, battle.attrs) });
        return card;
      }
      if (card.carrier === 'summon') {
        battle.summons.push({
          id: battle.nextId++,
          card,
          x: battle.player.x - 8,
          y: battle.player.y - 8,
          timer: cooldown(card.cd, battle.attrs) * 0.5,
        });
        return card;
      }
      battle.sources.push({ card, timer: cooldown(card.cd, battle.attrs) * 0.5 });
      return card;
    }

    function rollOffer(battle) {
      if (battle.offer !== null || battle.pending <= 0) return;
      if (battle.slots.length >= MAX_SLOTS) return;
      const owned = new Set(battle.cards.map((card) => card.id));
      const available = battle.pool.filter((id) => !owned.has(id));
      if (available.length === 0) return;
      const picked = [];
      while (picked.length < 3 && available.length > 0) {
        const index = Math.floor(battle.rng() * available.length);
        picked.push(available.splice(index, 1)[0]);
      }
      battle.offer = picked;
    }

    function awardXp(battle, amount) {
      battle.xp += amount;
      while (battle.xp >= battle.xpNext) {
        battle.xp -= battle.xpNext;
        battle.level += 1;
        battle.xpNext = 6 + battle.level * 2;
        battle.points += 1;
        if (battle.level % 2 === 0) battle.pending += 1;
      }
      rollOffer(battle);
    }

    /** 选中一张卡：进槽、生效、刷新下一次 offer。 */
    function chooseCard(battle, id) {
      if (battle.offer === null || !battle.offer.includes(id)) return false;
      if (battle.slots.length >= MAX_SLOTS) return false;
      battle.slots.push(id);
      battle.offer = null;
      battle.pending = Math.max(0, battle.pending - 1);
      addCard(battle, id);
      battle.events.push({ type: 'draft', id });
      rollOffer(battle);
      return true;
    }

    function createBattle({
      floor,
      build,
      attrs = {},
      seed = 1,
      pool = [],
      drafted = [],
      points = 0,
      level = 1,
      xp = 0,
      xpNext = 6,
      pending = 0,
    }) {
      const def = floorDef(floor);
      const normalized = normalizeAttrs(attrs);
      const maxCells = playerCells(normalized);
      const battle = {
        def,
        floor,
        attrs: normalized,
        points,
        pool: [...pool],
        slots: [...drafted],
        cards: [],
        rules: [],
        selfs: [],
        sources: [],
        summons: [],
        enemies: [],
        bullets: [],
        rng: mulberry32(seed),
        time: 0,
        state: 'fighting',
        player: {
          x: ARENA.w / 2,
          y: ARENA.h / 2,
          cells: maxCells,
          maxCells,
          speed: PLAYER_SPEED,
        },
        level,
        xp,
        xpNext,
        pending,
        offer: null,
        hitCount: 0,
        anchorTimer: 0,
        spawned: 0,
        kills: 0,
        events: [],
        nextId: 1,
        seed,
      };
      for (const id of build) addCard(battle, id);
      return battle;
    }

    function nearestEnemy(battle, from, range = Infinity) {
      let best = null;
      let bestD = range;
      for (const e of battle.enemies) {
        if (e.cells <= 0) continue;
        const d = dist(from, e);
        if (d < bestD) {
          best = e;
          bestD = d;
        }
      }
      return best;
    }

    function spawnTick(battle) {
      const interval = spawnSeconds(battle.def);
      while (battle.spawned < battle.def.enemies && battle.time >= battle.spawned * interval) {
        const index = battle.spawned;
        const lock = battle.def.locks.length ? battle.def.locks[index % battle.def.locks.length] : null;
        const locks = lock ? [lock] : [];
        const cells = enemyCells(battle.floor, locks);
        const at = spawnPoint(battle.rng);
        battle.enemies.push({
          id: battle.nextId++,
          x: at.x,
          y: at.y,
          cells,
          maxCells: cells,
          locks,
          primary: true,
          canSplit: lock === 'split',
          r: enemyRadius(cells),
          speed: ENEMY_SPEED_BASE + battle.floor * ENEMY_SPEED_PER_FLOOR + battle.rng() * 4,
          damage: enemyDamage(battle.floor),
          attackTimer: ENEMY_ATTACK_INTERVAL,
          status: createStatus(),
          freeze: 0,
          flash: 0,
        });
        battle.spawned += 1;
      }
    }

    function playerMove(battle, dt) {
      const p = battle.player;
      const nearest = nearestEnemy(battle, p);
      let vx = 0;
      let vy = 0;
      if (nearest) {
        const dx = p.x - nearest.x;
        const dy = p.y - nearest.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < KEEP_DISTANCE - 8) {
          vx += dx / d;
          vy += dy / d;
        } else if (d > KEEP_DISTANCE + 8) {
          vx -= dx / d;
          vy -= dy / d;
        } else {
          vx += -dy / d;
          vy += dx / d;
        }
      }
      const cx = ARENA.w / 2 - p.x;
      const cy = ARENA.h / 2 - p.y;
      const cd = Math.hypot(cx, cy) || 1;
      if (cd > CENTER_PULL) {
        vx += (cx / cd) * 0.7;
        vy += (cy / cd) * 0.7;
      }
      const len = Math.hypot(vx, vy);
      if (len < 0.001) return;
      p.x = clamp(p.x + (vx / len) * p.speed * dt, 6, ARENA.w - 6);
      p.y = clamp(p.y + (vy / len) * p.speed * dt, 6, ARENA.h - 6);
    }

    function rawHit(battle, enemy, cells, burn = 0) {
      const dealt = resolveHit(enemy, cells, { main: true });
      enemy.cells -= dealt;
      enemy.flash = 0.12;
      if (burn) applyBurn(enemy.status, burn);
      battle.events.push({ type: 'hit', x: enemy.x, y: enemy.y, cells: dealt });
      return dealt;
    }

    function hitEnemy(battle, enemy, card) {
      rawHit(battle, enemy, attackCells(card, battle.attrs), card.burn ?? 0);

      if (hasRule(battle, 'rule_execute') && enemy.cells > 0 && enemy.cells <= EXECUTE_THRESHOLD) {
        enemy.cells = 0;
        battle.events.push({ type: 'execute', x: enemy.x, y: enemy.y });
      }

      if (hasRule(battle, 'rule_combo')) {
        battle.hitCount += 1;
        if (battle.hitCount % COMBO_EVERY === 0) {
          const extra = nearestEnemy(battle, battle.player, orbRange(battle));
          if (extra && extra !== enemy && extra.cells > 0) rawHit(battle, extra, 1);
        }
      }
    }

    function fireBullet(battle, from, card, target) {
      battle.bullets.push({
        id: battle.nextId++,
        x: from.x,
        y: from.y,
        targetId: target.id,
        cells: attackCells(card, battle.attrs),
        burn: card.burn ?? 0,
        life: 1.2,
      });
      battle.events.push({ type: 'shot', x: from.x, y: from.y, card: card.id });
    }

    function pulse(battle, card) {
      const targets = battle.enemies
        .filter((e) => e.cells > 0 && dist(battle.player, e) <= fieldRadius(battle) + e.r)
        .slice(0, card.aoe || 1);
      for (const e of targets) hitEnemy(battle, e, card);
      if (targets.length > 0) {
        battle.events.push({ type: 'pulse', x: battle.player.x, y: battle.player.y, card: card.id });
      }
    }

    function attackTick(battle, dt) {
      for (const source of battle.sources) {
        source.timer -= dt;
        if (source.timer > 0) continue;
        source.timer += cooldown(source.card.cd, battle.attrs);
        if (source.card.carrier === 'field') {
          pulse(battle, source.card);
          continue;
        }
        const target = nearestEnemy(battle, battle.player, orbRange(battle));
        if (target) fireBullet(battle, battle.player, source.card, target);
      }

      for (const summon of battle.summons) {
        const tx = battle.player.x - 10;
        const ty = battle.player.y - 10;
        summon.x += (tx - summon.x) * Math.min(1, dt * 3);
        summon.y += (ty - summon.y) * Math.min(1, dt * 3);
        summon.timer -= dt;
        if (summon.timer > 0) continue;
        summon.timer += cooldown(summon.card.cd, battle.attrs);
        const target = nearestEnemy(battle, summon, summonRange(battle));
        if (target) fireBullet(battle, summon, summon.card, target);
      }
    }

    function selfTick(battle, dt) {
      for (const self of battle.selfs) {
        self.timer -= dt;
        if (self.timer > 0) continue;
        self.timer += cooldown(self.card.cd, battle.attrs);
        const targets = battle.enemies.filter(
          (e) => e.cells > 0 && dist(battle.player, e) <= selfRadius(battle) + e.r,
        );
        for (const e of targets) hitEnemy(battle, e, self.card);
        if (targets.length > 0) {
          battle.events.push({ type: 'pulse', x: battle.player.x, y: battle.player.y, card: self.card.id });
        }
      }
    }

    function rulesTick(battle, dt) {
      if (!hasRule(battle, 'rule_anchor')) return;
      battle.anchorTimer += dt;
      if (battle.anchorTimer < ANCHOR_SECONDS) return;
      battle.anchorTimer -= ANCHOR_SECONDS;
      for (const e of battle.enemies) {
        if (e.cells > 0) e.freeze = Math.max(e.freeze, FREEZE_SECONDS);
      }
      battle.events.push({ type: 'freeze' });
    }

    function bulletsTick(battle, dt) {
      const alive = [];
      for (const bullet of battle.bullets) {
        const target = battle.enemies.find((e) => e.id === bullet.targetId && e.cells > 0);
        if (!target) {
          bullet.life -= dt;
          if (bullet.life > 0) alive.push(bullet);
          continue;
        }
        const dx = target.x - bullet.x;
        const dy = target.y - bullet.y;
        const d = Math.hypot(dx, dy) || 1;
        const travel = BULLET_SPEED * dt;
        if (d <= travel + BULLET_HIT_RADIUS) {
          hitEnemy(battle, target, { cells: bullet.cells, burn: bullet.burn });
          continue;
        }
        bullet.x += (dx / d) * travel;
        bullet.y += (dy / d) * travel;
        alive.push(bullet);
      }
      battle.bullets = alive;
    }

    function enemiesTick(battle, dt) {
      const p = battle.player;
      for (const e of battle.enemies) {
        if (e.cells <= 0) continue;
        e.flash = Math.max(0, e.flash - dt);
        if (e.freeze > 0) {
          e.freeze = Math.max(0, e.freeze - dt);
          continue;
        }
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        const reach = e.r + PLAYER_RADIUS + CONTACT_PAD;
        if (d > reach) {
          const step = Math.min(e.speed * dt, d - reach);
          e.x += (dx / d) * step;
          e.y += (dy / d) * step;
          e.attackTimer = Math.min(e.attackTimer, ENEMY_ATTACK_INTERVAL);
          continue;
        }
        e.attackTimer -= dt;
        if (e.attackTimer > 0) continue;
        e.attackTimer += ENEMY_ATTACK_INTERVAL;
        const dmg = damageTaken(e.damage, battle.attrs);
        p.cells -= dmg;
        battle.events.push({ type: 'hurt', x: p.x, y: p.y, cells: dmg });
        if (p.cells <= 0) {
          p.cells = 0;
          battle.state = 'dead';
          return;
        }
      }
    }

    function statusTick(battle, dt) {
      for (const e of battle.enemies) {
        if (e.cells <= 0) continue;
        const burn = advanceStatus(e.status, dt);
        if (burn <= 0) continue;
        const dealt = resolveHit(e, burn, { main: false });
        e.cells -= dealt;
        battle.events.push({ type: 'burn', x: e.x, y: e.y, cells: dealt });
      }
    }

    function resolveDeaths(battle) {
      const alive = [];
      const booms = [];
      for (const e of battle.enemies) {
        if (e.cells > 0) {
          alive.push(e);
          continue;
        }
        battle.kills += 1;
        battle.events.push({ type: 'kill', x: e.x, y: e.y, id: e.id });
        if (e.primary) {
          awardXp(battle, Math.max(1, Math.round(e.maxCells / XP_PER_CELL)));
          if (hasRule(battle, 'rule_boom')) booms.push({ x: e.x, y: e.y });
        }
        if (e.canSplit && e.primary) {
          const child = Math.max(1, Math.ceil(e.maxCells * 0.5));
          for (let i = 0; i < 2; i += 1) {
            alive.push({
              ...e,
              id: battle.nextId++,
              cells: child,
              maxCells: child,
              primary: false,
              canSplit: false,
              locks: [],
              r: enemyRadius(child),
              status: createStatus(),
              freeze: 0,
              flash: 0,
            });
          }
        }
      }
      battle.enemies = alive;

      for (const at of booms) {
        for (const e of alive) {
          if (e.cells <= 0) continue;
          if (dist(e, at) > BOOM_RADIUS) continue;
          e.cells -= 1;
          e.cells -= 1;
          e.flash = 0.1;
          battle.events.push({ type: 'burn', x: e.x, y: e.y, cells: 2 });
        }
      }
    }

    function checkEnd(battle) {
      if (battle.state !== 'fighting') return;
      if (battle.player.cells <= 0) {
        battle.state = 'dead';
        return;
      }
      if (battle.spawned >= battle.def.enemies && battle.enemies.length === 0) {
        battle.state = 'cleared';
        return;
      }
      if (battle.time >= TIME_LIMIT) {
        battle.state = 'timeout';
      }
    }

    /** 花 1 点属性。体魄当场提高上限并补回等量生命。 */
    function spendPoint(battle, id) {
      const attr = ATTRIBUTES.find((a) => a.id === id);
      if (attr === undefined) return false;
      if (battle.points <= 0) return false;
      if ((battle.attrs[id] ?? 0) >= attr.max) return false;
      const before = playerCells(battle.attrs);
      battle.attrs[id] += 1;
      battle.points -= 1;
      const after = playerCells(battle.attrs);
      if (after !== before) {
        battle.player.maxCells = after;
        battle.player.cells = Math.min(after, battle.player.cells + (after - before));
      }
      battle.events.push({ type: 'spend', id });
      return true;
    }

    /** 推进一帧，返回这一帧产生的事件。 */
    function step(battle, dt) {
      if (battle.state !== 'fighting') return [];
      battle.events = [];
      battle.time += dt;
      spawnTick(battle);
      playerMove(battle, dt);
      attackTick(battle, dt);
      selfTick(battle, dt);
      rulesTick(battle, dt);
      bulletsTick(battle, dt);
      enemiesTick(battle, dt);
      statusTick(battle, dt);
      const regen = regenPerSecond(battle.attrs);
      if (regen > 0 && battle.player.cells > 0 && battle.player.cells < battle.player.maxCells) {
        battle.player.cells = Math.min(battle.player.maxCells, battle.player.cells + regen * dt);
      }
      resolveDeaths(battle);
      checkEnd(battle);
      return battle.events;
    }

    /** 一直跑到结束，返回同一场战斗。dt 固定，保证可复现。 */
    function runToEnd(battle, { dt = 1 / 60, maxSeconds = 120 } = {}) {
      while (battle.state === 'fighting' && battle.time < maxSeconds) {
        step(battle, dt);
      }
      return battle;
    }
// </core>

    const W = ARENA.w
    const H = ARENA.h
    const STEP = 1 / 60
    const POLL_MS = 800
    const CLEAR_PAUSE = 1.1
    const FAIL_PAUSE = 3.4
    const MAX_FLOOR = 8
    const TYPE_ID = 'dsh-pet'
    const KIND = 'pet'

    const BUILDS = {
      fire: {
        id: 'fire',
        label: '灼烧',
        cards: [...FIRE_BUILD],
        pool: [...FIRE_PACK],
      },
      pure: {
        id: 'pure',
        label: '纯数值',
        cards: ['orb_phys'],
        pool: [],
      },
    }

    const COLORS = {
      bg: '#0a0d12',
      grid: '#121a24',
      frame: '#1c2733',
      player: '#cfe3ef',
      playerDark: '#7fa3b8',
      eye: '#0a0d12',
      bullet: '#ffd166',
      burn: '#ff9f45',
      enemy: { rim: '#7e312c', body: '#c4534b' },
      carapace: { rim: '#2f4a5c', body: '#6f97b0' },
      split: { rim: '#4d2379', body: '#8f4bd6' },
      summon: { rim: '#7a5410', body: '#e0a526' },
    }

    const CSS = [
      '.dsh-pet{display:flex;flex-direction:column;gap:6px;padding:8px;color:#dbe7f0;font-size:11px;',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;height:100%;box-sizing:border-box;overflow-y:auto}',
      '.dsh-pet-top{display:flex;align-items:center;gap:6px}',
      '.dsh-pet-floor{font-weight:700;color:#ffd166;letter-spacing:.04em}',
      '.dsh-pet-muted{color:#7f93a3}',
      '.dsh-pet-spacer{margin-left:auto}',
      '.dsh-pet-btn{font:inherit;font-size:10px;color:#cfe3ef;background:#111a24;border:1px solid #24313d;',
      'border-radius:4px;padding:2px 6px;cursor:pointer}',
      '.dsh-pet-btn:hover{background:#16222e;border-color:#3a5470}',
      '.dsh-pet-dot{width:6px;height:6px;border-radius:50%;background:#41505f}',
      '.dsh-pet-dot.on{background:#6ee7a8;box-shadow:0 0 6px #6ee7a8}',
      '.dsh-pet-stage{position:relative;border-radius:4px;overflow:hidden;background:#0a0d12}',
      '.dsh-pet-canvas{display:block;width:100%;height:auto;image-rendering:pixelated}',
      '.dsh-pet-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;',
      'justify-content:center;gap:4px;padding:8px;text-align:center;background:rgba(8,12,18,.72)}',
      '.dsh-pet-overlay-title{font-size:15px;letter-spacing:.18em}',
      '.dsh-pet-overlay-title.bad{color:#e35d5d}',
      '.dsh-pet-overlay-title.good{color:#6ee7a8}',
      '.dsh-pet-overlay-sub{font-size:10px;color:#9fb2c2;line-height:1.5}',
      '.dsh-pet-cells{height:4px;background:#18212b;border-radius:2px;overflow:hidden}',
      '.dsh-pet-cells i{display:block;height:100%;background:#6ee7a8;transition:width .12s linear}',
      '.dsh-pet-bottom{display:flex;gap:8px;color:#6c8091;font-size:10px}',
      '.dsh-pet-offer{position:absolute;left:5px;right:5px;bottom:5px;display:flex;flex-direction:column;gap:3px;',
      'background:rgba(10,14,20,.94);border:1px solid #2a3a4a;border-radius:5px;padding:5px}',
      '.dsh-pet-offer-title{font-size:9px;color:#ffd166;letter-spacing:.08em}',
      '.dsh-pet-card{display:flex;flex-direction:column;gap:1px;text-align:left;font:inherit;font-size:10px;',
      'color:#dbe7f0;background:#111a24;border:1px solid #1f2a36;border-radius:4px;padding:3px 5px;cursor:pointer}',
      '.dsh-pet-card:hover{background:#16222e;border-color:#3a5470}',
      '.dsh-pet-card-name{color:#ffd166;font-weight:700}',
      '.dsh-pet-card-desc{color:#8fa4b5;font-size:9px}',
      '.dsh-pet-attrs{display:flex;flex-direction:column;gap:3px}',
      '.dsh-pet-attrs-head{display:flex;justify-content:space-between;font-size:10px;color:#7f93a3}',
      '.dsh-pet-points{color:#ffd166}',
      '.dsh-pet-attr-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px}',
      '.dsh-pet-attr{display:flex;justify-content:space-between;font:inherit;font-size:10px;color:#cfe3ef;',
      'background:#111a24;border:1px solid #1f2a36;border-radius:4px;padding:2px 5px;cursor:pointer}',
      '.dsh-pet-attr:hover:not(:disabled){background:#16222e;border-color:#3a5470}',
      '.dsh-pet-attr:disabled{opacity:.45;cursor:default}',
      '.dsh-pet-attr-val{color:#8fa4b5}',
    ].join('')

    // ---- 进度 ----

    const SAVE_PREFIX = 'dsh.pet.v3.'

    function loadAccount(key) {
      try {
        const store = window.localStorage
        if (store === undefined || store === null) return { attrs: {}, points: 0 }
        const raw = store.getItem(SAVE_PREFIX + key)
        if (raw === null) return { attrs: {}, points: 0 }
        const parsed = JSON.parse(raw)
        return {
          attrs: normalizeAttrs(parsed !== null && typeof parsed === 'object' ? parsed.attrs : {}),
          points: Math.max(0, Math.floor(Number(parsed.points) || 0)),
        }
      } catch {
        return { attrs: {}, points: 0 }
      }
    }

    function saveAccount(entry) {
      try {
        const store = window.localStorage
        if (store === undefined || store === null) return
        store.setItem(
          SAVE_PREFIX + entry.key,
          JSON.stringify({ attrs: entry.attrs, points: entry.points }),
        )
      } catch {
        // 存档失败不能打断战斗
      }
    }

    const ENTRIES = new Map()

    function syncAccount(entry) {
      const battle = entry.battle
      if (battle === null) return
      entry.points = battle.points
      entry.attrs = { ...battle.attrs }
      entry.level = battle.level
      entry.xp = battle.xp
      entry.xpNext = battle.xpNext
      entry.pending = battle.pending
      saveAccount(entry)
    }

    function startFloor(entry, floor) {
      syncAccount(entry)
      const build = BUILDS[entry.buildId]
      entry.floor = floor
      entry.phase = 'fight'
      entry.fx = []
      entry.acc = 0
      entry.battle = createBattle({
        floor,
        build: [...build.cards, ...entry.drafted],
        attrs: entry.attrs,
        points: entry.points,
        level: entry.level,
        xp: entry.xp,
        xpNext: entry.xpNext,
        pending: entry.pending,
        seed: entry.seed++,
        pool: build.pool,
        drafted: entry.drafted,
      })
    }

    function createEntry(key, seed) {
      const account = loadAccount(key)
      const entry = {
        key,
        battle: null,
        floor: 1,
        best: 1,
        buildId: 'fire',
        attrs: account.attrs,
        points: account.points,
        level: 1,
        xp: 0,
        xpNext: 6,
        pending: 0,
        phase: 'fight',
        lastResult: null,
        resultTimer: 0,
        fx: [],
        acc: 0,
        drafted: [],
        seed: seed === undefined ? (Date.now() % 100000) + 1 : seed,
        running: false,
        online: true,
        consumed: 0,
        raf: 0,
        last: 0,
        subs: 0,
      }
      startFloor(entry, 1)
      return entry
    }

    function resetRun(entry, floor) {
      entry.drafted = []
      entry.level = 1
      entry.xp = 0
      entry.xpNext = 6
      entry.pending = 0
      entry.battle = null
      startFloor(entry, floor)
    }

    function advance(entry) {
      const cleared = entry.lastResult !== null && entry.lastResult.kind === 'cleared'
      if (!cleared) {
        resetRun(entry, 1)
        return
      }
      // 没选的三选一跨层保留，否则玩家一不留神就丢了这次升级。
      const carried = entry.battle === null ? null : entry.battle.offer
      const carriedPending = entry.battle === null ? 0 : entry.battle.pending
      const next = entry.floor + 1
      if (next > MAX_FLOOR) {
        resetRun(entry, 1)
        return
      }
      startFloor(entry, next)
      if (carried !== null && entry.battle !== null && entry.battle.offer === null) {
        entry.battle.offer = carried
        entry.battle.pending = Math.max(1, carriedPending)
      }
    }

    function pickCard(entry, id) {
      const battle = entry.battle
      if (battle === null) return false
      if (!chooseCard(battle, id)) return false
      entry.drafted.push(id)
      return true
    }

    function spend(entry, id) {
      const battle = entry.battle
      if (battle === null) return false
      if (!spendPoint(battle, id)) return false
      entry.attrs = { ...battle.attrs }
      entry.points = battle.points
      saveAccount(entry)
      return true
    }

    function tick(entry, dt) {
      for (const f of entry.fx) {
        f.life -= dt
        f.r += dt * 46
      }
      if (entry.fx.length > 0) entry.fx = entry.fx.filter((f) => f.life > 0)

      if (entry.phase === 'result') {
        entry.resultTimer -= dt
        if (entry.resultTimer <= 0) advance(entry)
        return
      }

      const battle = entry.battle
      if (battle === null) return
      const events = step(battle, dt)
      for (const ev of events) {
        if (ev.type === 'pulse') entry.fx.push({ x: ev.x, y: ev.y, r: 6, life: 0.4 })
        else if (ev.type === 'kill') entry.fx.push({ x: ev.x, y: ev.y, r: 2, life: 0.28 })
      }
      if (battle.state !== 'fighting') {
        entry.lastResult = {
          kind: battle.state,
          floor: entry.floor,
          kills: battle.kills,
          cells: battle.player.cells,
        }
        entry.phase = 'result'
        entry.resultTimer = battle.state === 'cleared' ? CLEAR_PAUSE : FAIL_PAUSE
        if (battle.state === 'cleared') entry.best = Math.max(entry.best, entry.floor)
      }
    }

    function startTicker(entry) {
      if (entry.raf !== 0) return
      entry.last = performance.now()
      const loop = (now) => {
        entry.raf = window.requestAnimationFrame(loop)
        const dt = Math.min(0.1, (now - entry.last) / 1000)
        entry.last = now
        entry.acc += dt
        let guard = 0
        while (entry.acc >= STEP && guard < 8) {
          tick(entry, STEP)
          entry.acc -= STEP
          guard += 1
        }
        if (guard >= 8) entry.acc = 0
      }
      entry.raf = window.requestAnimationFrame(loop)
    }

    function acquireEntry(key) {
      let entry = ENTRIES.get(key)
      if (entry === undefined) {
        entry = createEntry(key)
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
      }
    }

    // ---- 绘制 ----

    function drawEnemy(c, e) {
      const size = Math.round(4 + Math.min(6, e.cells / 4))
      const half = Math.floor(size / 2)
      const x = Math.round(e.x) - half
      const y = Math.round(e.y) - half
      const style = e.locks.includes('carapace')
        ? COLORS.carapace
        : e.locks.includes('split')
          ? COLORS.split
          : COLORS.enemy
      const lit = e.flash > 0
      c.fillStyle = lit ? '#ffffff' : style.rim
      c.fillRect(x, y, size, size)
      c.fillStyle = lit ? '#ffffff' : style.body
      c.fillRect(x + 1, y + 1, Math.max(1, size - 2), Math.max(1, size - 2))

      // 格数条
      const barW = Math.max(3, size)
      c.fillStyle = '#101820'
      c.fillRect(x, y - 4, barW, 1)
      c.fillStyle = style.body
      const filled = Math.max(1, Math.round((e.cells / e.maxCells) * barW))
      c.fillRect(x, y - 4, Math.min(barW, filled), 1)

      // 锁标记
      if (e.locks.includes('carapace')) {
        c.fillStyle = '#8fd8ff'
        c.fillRect(x - 2, y - 2, 1, 2)
      }
      // 灼烧标记
      if (e.status.burn > 0) {
        c.fillStyle = COLORS.burn
        c.fillRect(x + size + 1, y, 1, 1)
        if (e.status.burn >= 3) c.fillRect(x + size + 1, y + 2, 1, 1)
      }
    }

    function drawSummon(c, s) {
      const x = Math.round(s.x) - 2
      const y = Math.round(s.y) - 2
      c.fillStyle = COLORS.summon.rim
      c.fillRect(x, y, 4, 4)
      c.fillStyle = COLORS.summon.body
      c.fillRect(x + 1, y + 1, 2, 2)
    }

    function drawPlayer(c, p) {
      const x = Math.round(p.x) - 3
      const y = Math.round(p.y) - 3
      c.fillStyle = COLORS.playerDark
      c.fillRect(x, y + 5, 6, 1)
      c.fillStyle = COLORS.player
      c.fillRect(x, y, 6, 5)
      c.fillStyle = COLORS.eye
      c.fillRect(x + 1, y + 2, 1, 1)
      c.fillRect(x + 4, y + 2, 1, 1)
    }

    function draw(c, entry) {
      c.setTransform(2, 0, 0, 2, 0, 0)
      c.imageSmoothingEnabled = false
      c.fillStyle = COLORS.bg
      c.fillRect(0, 0, W, H)
      c.fillStyle = COLORS.grid
      for (let x = 8; x < W; x += 8) for (let y = 8; y < H; y += 8) c.fillRect(x, y, 1, 1)
      c.fillStyle = COLORS.frame
      c.fillRect(0, 0, W, 1)
      c.fillRect(0, H - 1, W, 1)
      c.fillRect(0, 0, 1, H)
      c.fillRect(W - 1, 0, 1, H)

      const battle = entry.battle
      if (battle === null) return

      for (const f of entry.fx) {
        const alpha = Math.max(0, f.life * 2.4)
        c.fillStyle = 'rgba(255,209,102,' + alpha.toFixed(2) + ')'
        for (let i = 0; i < 10; i += 1) {
          const a = (i / 10) * Math.PI * 2
          c.fillRect(Math.round(f.x + Math.cos(a) * f.r), Math.round(f.y + Math.sin(a) * f.r), 1, 1)
        }
      }

      for (const e of battle.enemies) drawEnemy(c, e)
      for (const s of battle.summons) drawSummon(c, s)
      c.fillStyle = COLORS.bullet
      for (const b of battle.bullets) c.fillRect(Math.round(b.x), Math.round(b.y), 1, 1)
      drawPlayer(c, battle.player)
    }

    // ---- 诊断 ----

    function diagnose(entry) {
      const r = entry.lastResult
      if (r === null) return ''
      if (r.kind === 'cleared') return '进入第 ' + (entry.floor + 1) + ' 层'
      const def = floorDef(r.floor)
      const lock = def.locks.length > 0 ? def.locks[0] : null
      if (lock === 'carapace') {
        return entry.buildId === 'pure'
          ? '锁：甲壳（单次最多 1 格）。锋锐被完全浪费，换灼烧。'
          : '锁：甲壳。灼烧能穿过去，但这一层的厚度压过了输出。'
      }
      return TIME_LIMIT + ' 秒内没清完：输出不够。'
    }

    // ---- 界面 ----

    function formatTokens(n) {
      if (!Number.isFinite(n) || n <= 0) return '0'
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
      return String(Math.round(n))
    }

    function PetBody(props) {
      const sessionId = props !== null && props !== undefined && props.sessionId !== undefined
        ? String(props.sessionId)
        : ''
      const canvasRef = React.useRef(null)
      const entryRef = React.useRef(null)
      const [key, setKey] = React.useState(null)
      const bump = React.useReducer((n) => n + 1, 0)[1]

      React.useEffect(() => {
        if (key === null) return undefined
        const entry = acquireEntry(key)
        entryRef.current = entry
        bump()
        return () => {
          entryRef.current = null
          releaseEntry(key)
        }
      }, [key, bump])

      React.useEffect(() => {
        let raf = 0
        const loop = () => {
          raf = window.requestAnimationFrame(loop)
          const entry = entryRef.current
          const canvas = canvasRef.current
          if (entry === null || canvas === null) return
          const c = canvas.getContext('2d')
          if (c !== null) draw(c, entry)
        }
        raf = window.requestAnimationFrame(loop)
        return () => window.cancelAnimationFrame(raf)
      }, [])

      React.useEffect(() => {
        const id = window.setInterval(() => bump(), 200)
        return () => window.clearInterval(id)
      }, [bump])

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
            const table = data !== null && typeof data === 'object' ? data.sessions : null
            if (table === null || typeof table !== 'object') throw new Error('bad payload')
            const own = table[sessionId]
            const nextKey =
              own !== undefined && typeof own.workspaceKey === 'string' && own.workspaceKey.length > 0
                ? own.workspaceKey
                : 'session:' + sessionId
            if (nextKey !== keyRef) {
              keyRef = nextKey
              setKey(nextKey)
            }
            const entry = entryRef.current
            if (entry === null) return
            failures = 0
            entry.online = true
            let running = false
            let consumed = 0
            for (const row of Object.values(table)) {
              if (row === null || typeof row !== 'object') continue
              if (row.workspaceKey !== nextKey) continue
              if (row.running === true) running = true
              if (typeof row.totalTokens === 'number') consumed += row.totalTokens
            }
            entry.running = running
            entry.consumed = consumed
          } catch {
            failures += 1
            const entry = entryRef.current
            if (entry !== null && failures >= 3) entry.online = false
          }
        }
        poll()
        const id = window.setInterval(poll, POLL_MS)
        return () => {
          disposed = true
          window.clearInterval(id)
        }
      }, [sessionId])

      const entry = entryRef.current
      if (entry === null) {
        return h('div', { className: 'dsh-pet' },
          h('style', { key: 'style' }, CSS),
          h('div', { className: 'dsh-pet-top' }, h('span', { className: 'dsh-pet-muted' }, '连接中…')),
        )
      }

      const battle = entry.battle
      const cells = battle === null ? 0 : battle.player.cells
      const maxCells = battle === null ? 1 : battle.player.maxCells
      const pct = Math.max(0, Math.min(100, (cells / maxCells) * 100))
      const build = BUILDS[entry.buildId]
      const attrs = battle !== null ? battle.attrs : entry.attrs
      const points = battle !== null ? battle.points : entry.points
      const result = entry.phase === 'result' ? entry.lastResult : null
      const lockName = battle !== null && battle.def.locks.length > 0 ? battle.def.locks[0] : '—'

      return h('div', { className: 'dsh-pet' },
        h('style', { key: 'style' }, CSS),
        h('div', { className: 'dsh-pet-top' },
          h('span', { className: 'dsh-pet-floor' }, '第 ' + entry.floor + ' 层'),
          h('span', { className: 'dsh-pet-muted' }, 'Lv.' + (battle === null ? 1 : battle.level)),
          h('span', { className: 'dsh-pet-muted' }, '最佳 ' + entry.best),
          h('span', { className: 'dsh-pet-muted' }, '锁 ' + lockName),
          h('span', { className: 'dsh-pet-spacer' }),
          h('button', {
            type: 'button',
            className: 'dsh-pet-btn',
            title: '切换 build 并重新开始',
            onClick: () => {
              const e = entryRef.current
              if (e === null) return
              e.buildId = e.buildId === 'fire' ? 'pure' : 'fire'
              resetRun(e, 1)
              bump()
            },
          }, build.label),
          h('span', { className: 'dsh-pet-dot' + (entry.online ? ' on' : '') }),
        ),
        h('div', { className: 'dsh-pet-stage' },
          h('canvas', { ref: canvasRef, width: W * 2, height: H * 2, className: 'dsh-pet-canvas' }),
          result !== null
            ? h('div', { className: 'dsh-pet-overlay' },
                h('div', {
                  className: 'dsh-pet-overlay-title ' + (result.kind === 'cleared' ? 'good' : 'bad'),
                }, result.kind === 'cleared' ? '清层' : result.kind === 'dead' ? '阵亡' : '超时'),
                h('div', { className: 'dsh-pet-overlay-sub' }, diagnose(entry)),
              )
            : null,
          result === null && battle !== null && battle.offer !== null
            ? h('div', { className: 'dsh-pet-offer' },
                h('div', { className: 'dsh-pet-offer-title' },
                  '升级 · 三选一（剩余 ' + battle.pending + '）'),
                battle.offer.map((id) => {
                  const card = CARDS[id]
                  return h('button', {
                    key: id,
                    type: 'button',
                    className: 'dsh-pet-card',
                    onClick: () => {
                      if (pickCard(entry, id)) bump()
                    },
                  },
                    h('span', { className: 'dsh-pet-card-name' }, card.name),
                    h('span', { className: 'dsh-pet-card-desc' }, card.desc),
                  )
                }),
              )
            : null,
        ),
        h('div', { className: 'dsh-pet-cells' }, h('i', { style: { width: pct + '%' } })),
        h('div', { className: 'dsh-pet-attrs' },
          h('div', { className: 'dsh-pet-attrs-head' },
            h('span', null, '属性'),
            h('span', { className: 'dsh-pet-points' }, '可分配 ' + points),
          ),
          h('div', { className: 'dsh-pet-attr-grid' },
            ATTRIBUTES.map((attr) =>
              h('button', {
                key: attr.id,
                type: 'button',
                className: 'dsh-pet-attr',
                title: attr.desc,
                disabled: points <= 0 || attrs[attr.id] >= attr.max,
                onClick: () => {
                  if (spend(entry, attr.id)) bump()
                },
              },
                h('span', null, attr.label),
                h('span', { className: 'dsh-pet-attr-val' }, attrs[attr.id] + '/' + attr.max),
              ),
            ),
          ),
        ),
        h('div', { className: 'dsh-pet-bottom' },
          h('span', null, '格 ' + Math.max(0, cells) + '/' + maxCells),
          h('span', null, '槽 ' + (battle === null ? 0 : battle.slots.length) + '/' + MAX_SLOTS),
          h('span', null, '击杀 ' + (battle === null ? 0 : battle.kills)),
          h('span', null, '敌 ' + (battle === null ? 0 : battle.enemies.length)),
          h('span', { className: 'dsh-pet-spacer' }),
          h('span', null, formatTokens(entry.consumed) + ' token'),
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
            guide: [{ id: 'pet', title: '宠物', description: '按层推进的自动战斗' }],
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
      // 供 node --test 验证接入路径；运行时不使用。
      __debug: { createEntry, tick, startFloor, draw, BUILDS, pickCard, awardXp, chooseCard, spend },
    }
  },
})
