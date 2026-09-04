// ============================================================
// Basic setup
// ============================================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // Keep the player inside the new bounds instead of letting it get stuck off-screen
  if (player) {
    player.x = Math.max(0, Math.min(canvas.width - player.size, player.x));
    player.y = Math.max(0, Math.min(canvas.height - player.size, player.y));
  }
}

// ============================================================
// Sound (procedural WebAudio - no external files needed)
// ============================================================
const SFX = (() => {
  let audioCtx = null;
  let muted = false;

  function ctxReady() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone({ freq = 440, duration = 0.1, type = 'square', gain = 0.06, slideTo = null, delay = 0 }) {
    if (muted) return;
    const ac = ctxReady();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime + delay);
    if (slideTo !== null) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + delay + duration);
    }
    g.gain.setValueAtTime(gain, ac.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + duration);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(ac.currentTime + delay);
    osc.stop(ac.currentTime + delay + duration + 0.02);
  }

  return {
    shoot: () => tone({ freq: 880, slideTo: 1200, duration: 0.06, type: 'square', gain: 0.035 }),
    hit: () => tone({ freq: 160, slideTo: 60, duration: 0.15, type: 'sawtooth', gain: 0.08 }),
    kill: () => tone({ freq: 300, slideTo: 700, duration: 0.09, type: 'triangle', gain: 0.05 }),
    powerup: () => {
      tone({ freq: 520, slideTo: 900, duration: 0.12, type: 'triangle', gain: 0.06 });
      tone({ freq: 780, slideTo: 1200, duration: 0.12, type: 'triangle', gain: 0.05, delay: 0.06 });
    },
    playerHurt: () => tone({ freq: 220, slideTo: 90, duration: 0.2, type: 'sawtooth', gain: 0.09 }),
    laserWarn: () => tone({ freq: 500, duration: 0.4, type: 'sine', gain: 0.03 }),
    laserFire: () => tone({ freq: 140, slideTo: 40, duration: 0.25, type: 'sawtooth', gain: 0.09 }),
    bossShot: () => tone({ freq: 340, slideTo: 200, duration: 0.12, type: 'square', gain: 0.05 }),
    levelComplete: () => {
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, duration: 0.16, type: 'square', gain: 0.06, delay: i * 0.09 }));
    },
    victory: () => {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, duration: 0.22, type: 'triangle', gain: 0.07, delay: i * 0.11 }));
    },
    gameOver: () => {
      [400, 300, 200, 120].forEach((f, i) => tone({ freq: f, duration: 0.22, type: 'sawtooth', gain: 0.07, delay: i * 0.12 }));
    },
    achievement: () => {
      tone({ freq: 660, duration: 0.1, type: 'square', gain: 0.055 });
      tone({ freq: 990, duration: 0.14, type: 'square', gain: 0.055, delay: 0.08 });
    },
    setMuted(v) { muted = v; },
    isMuted() { return muted; }
  };
})();

const muteBtn = document.getElementById('mute-btn');
muteBtn.addEventListener('click', () => {
  const nowMuted = !SFX.isMuted();
  SFX.setMuted(nowMuted);
  muteBtn.textContent = nowMuted ? '🔇' : '🔊';
});

// ============================================================
// Game state
// ============================================================
const STATE = {
  SELECT: 'select',
  PLAYING: 'playing',
  PAUSED: 'paused',
  LEVEL_COMPLETE: 'level_complete',
  FINAL: 'final',
  GAME_OVER: 'game_over'
};

let currentState = STATE.SELECT;
let currentLevel = 1;
let selectedCharacter = null;

// Teacher characters
const teachers = [
  {
    name: 'Mr. Deepesh Khatri',
    title: 'Chief Resource Optimizer',
    flavor: 'Gets software running even when the budget says "access denied".',
    stats: { speed: 6, power: 9, debug: 7 },
    color: '#00f2ff'
  },
  {
    name: 'Mr. Chirag Sharma',
    title: 'Keeper of the Legendary ThinkPad',
    flavor: 'His ThinkPad has survived more updates than our new lab PCs.',
    stats: { speed: 9, power: 6, debug: 7 },
    color: '#00ff9c'
  },
  {
    name: 'Mrs. Archana Jaimini',
    title: 'System Admin of the School',
    flavor: 'Even without teaching me, she keeps the entire school from crashing.',
    stats: { speed: 6, power: 9, debug: 8 },
    color: '#ff0055'
  },
  {
    name: 'Mrs. Rutuja Gorantiwar',
    title: 'Silent Debugger',
    flavor: 'Fixes everything quietly so the lab looks like it never had issues.',
    stats: { speed: 7, power: 7, debug: 10 },
    color: '#ffaa00'
  }
];

// Player
const player = {
  x: 0,
  y: 0,
  size: 36,
  speed: 11,
  color: '#ffffff',
  bullets: [],
  lastShot: 0,
  hp: 100,
  maxHp: 100,
  invincibleTime: 0,
  score: 0,
  combo: 0,
  maxCombo: 0,
  comboTimer: 0,
  rapidFireTime: 0,
  shieldTime: 0
};

// Level & enemies
let enemies = [];
let powerups = [];
let particles = [];
let stars = [];
let boss = null;
let bossProjectiles = [];
let bossLasers = [];
let keys = {};
let shake = { time: 0, mag: 0 };
let noHitRun = true;

// Achievements
const achievements = [
  { id: 'first_blood', name: 'First Blood', desc: 'Destroy your first enemy', unlocked: false },
  { id: 'combo_10', name: 'Combo Master', desc: 'Reach a 10x combo', unlocked: false },
  { id: 'no_hit_level', name: 'Untouchable', desc: 'Finish a level without getting hit', unlocked: false },
  { id: 'boss_slayer', name: 'Boss Slayer', desc: 'Defeat the Great System Crash', unlocked: false }
];

let levelStartedWithoutHit = false;

// ============================================================
// UI elements
// ============================================================
const characterSelectEl = document.getElementById('character-select');
const charactersEl = document.getElementById('characters');
const levelCompleteEl = document.getElementById('level-complete');
const levelTitleEl = document.getElementById('level-title');
const levelSummaryEl = document.getElementById('level-summary');
const nextLevelBtn = document.getElementById('next-level-btn');
const finalScreenEl = document.getElementById('final-screen');
const replayBtn = document.getElementById('replay-btn');
const pauseScreenEl = document.getElementById('pause-screen');
const resumeBtn = document.getElementById('resume-btn');

// Game over overlay
const gameOverEl = document.createElement('div');
gameOverEl.id = 'game-over';
gameOverEl.className = 'overlay hidden';
gameOverEl.innerHTML = `
  <h2>System Crash</h2>
  <p class="subtitle">You ran out of HP</p>
  <button id="retry-btn">Retry Level</button>
`;
document.getElementById('game-container').appendChild(gameOverEl);
const gameOverScreen = document.getElementById('game-over');
const retryBtn = document.getElementById('retry-btn');

// Achievement toast overlay
const achievementEl = document.createElement('div');
achievementEl.id = 'achievement-toast';
achievementEl.className = 'overlay hidden';
achievementEl.innerHTML = `
  <div class="achieve-inner">
    <h2 id="achieve-name">🏆 Achievement!</h2>
    <p id="achieve-desc" class="subtitle"></p>
  </div>
`;
document.getElementById('game-container').appendChild(achievementEl);
const achievementToast = document.getElementById('achievement-toast');
const achieveNameEl = document.getElementById('achieve-name');
const achieveDescEl = document.getElementById('achieve-desc');

function showAchievement(id) {
  const ach = achievements.find(a => a.id === id);
  if (!ach || ach.unlocked) return;
  ach.unlocked = true;
  SFX.achievement();
  achieveNameEl.textContent = `🏆 ${ach.name}`;
  achieveDescEl.textContent = ach.desc;
  achievementToast.classList.remove('hidden');
  setTimeout(() => {
    achievementToast.classList.add('hidden');
  }, 2500);
}

// Build character select cards
teachers.forEach((teacher) => {
  const card = document.createElement('div');
  card.className = 'character-card';
  card.tabIndex = 0;
  card.innerHTML = `
    <div class="char-name">${teacher.name}</div>
    <div class="char-title">${teacher.title}</div>
    <div class="char-flavor">${teacher.flavor}</div>
    <div class="char-stats">
      Speed: ${teacher.stats.speed} | Power: ${teacher.stats.power} | Debug: ${teacher.stats.debug}
    </div>
  `;
  const pick = () => {
    selectedCharacter = teacher;
    player.color = teacher.color;
    player.speed = 9 + teacher.stats.speed * 0.6;
    noHitRun = true;
    startLevel(1);
  };
  card.addEventListener('click', pick);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
  });
  charactersEl.appendChild(card);
});

// ============================================================
// Input handling
// ============================================================
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
    keys[key] = true;
    if (currentState === STATE.PLAYING) e.preventDefault();
  }
  if (['w', 'a', 's', 'd'].includes(key)) keys[key] = true;

  if (e.code === 'Space' && currentState === STATE.PLAYING) {
    e.preventDefault();
    shoot();
  }

  if (key === 'p' || key === 'escape') {
    if (currentState === STATE.PLAYING) {
      togglePause(true);
    } else if (currentState === STATE.PAUSED) {
      togglePause(false);
    }
  }
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) keys[key] = false;
  if (['w', 'a', 's', 'd'].includes(key)) keys[key] = false;
});

function togglePause(pause) {
  if (pause) {
    currentState = STATE.PAUSED;
    pauseScreenEl.classList.remove('hidden');
  } else {
    currentState = STATE.PLAYING;
    pauseScreenEl.classList.add('hidden');
  }
}
resumeBtn.addEventListener('click', () => togglePause(false));

// ============================================================
// Starfield background
// ============================================================
function initStars() {
  stars = [];
  const count = Math.floor((canvas.width * canvas.height) / 9000);
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 1.8 + 0.4,
      speed: Math.random() * 1.2 + 0.3,
      twinkle: Math.random() * Math.PI * 2
    });
  }
}

function updateStars() {
  stars.forEach(s => {
    s.y += s.speed;
    s.twinkle += 0.05;
    if (s.y > canvas.height) {
      s.y = -2;
      s.x = Math.random() * canvas.width;
    }
  });
}

function drawStars() {
  stars.forEach(s => {
    const alpha = 0.4 + Math.sin(s.twinkle) * 0.35;
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0.15, alpha)})`;
    ctx.fillRect(s.x, s.y, s.size, s.size);
  });
}

resizeCanvas();
initStars();
window.addEventListener('resize', () => {
  resizeCanvas();
  initStars();
});

// ============================================================
// Particles
// ============================================================
function spawnParticles(x, y, color, count = 12, speedMul = 1) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 3 + 1.5) * speedMul;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 4 + 2,
      color,
      life: 1
    });
  }
}

function updateParticles() {
  particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.05;
    p.life -= 0.025;
  });
  particles = particles.filter(p => p.life > 0);
}

function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  });
  ctx.globalAlpha = 1;
}

function triggerShake(mag, time) {
  shake.mag = mag;
  shake.time = time;
}

// ============================================================
// Player damage helper (shared by enemies, boss contact, boss attacks)
// ============================================================
function damagePlayer(amount, now) {
  if (player.shieldTime > now) {
    player.shieldTime = 0; // shield absorbs the hit
    spawnParticles(player.x + player.size / 2, player.y + player.size / 2, '#00ff9c', 10, 0.8);
    return;
  }
  if (now <= player.invincibleTime) return; // still flashing from the last hit

  player.hp -= amount;
  player.invincibleTime = now + 600;
  levelStartedWithoutHit = false;
  noHitRun = false;
  SFX.playerHurt();
  triggerShake(6, 220);
  spawnParticles(player.x + player.size / 2, player.y + player.size / 2, '#ff3366', 14, 1);
  if (player.hp <= 0) showGameOver();
}

// ============================================================
// Shooting
// ============================================================
function shoot() {
  const now = Date.now();
  let cooldown = 130;
  if (player.rapidFireTime > now) {
    cooldown = 70; // rapid fire
  }
  if (now - player.lastShot < cooldown) return;
  player.lastShot = now;
  SFX.shoot();

  const playerCenterX = player.x + player.size / 2;

  player.bullets.push({
    x: playerCenterX - 5,
    y: player.y,
    size: 10, // wider bullet - easier to line up with a moving target
    speed: 16
  });
}

// Compute 6 fixed lane X positions
function getLaneX(laneIndex, laneCount) {
  const margin = 40;
  const usableWidth = canvas.width - margin * 2;
  const step = usableWidth / (laneCount - 1);
  return margin + laneIndex * step - player.size / 2;
}

// ============================================================
// Level setup
// ============================================================
function startLevel(level) {
  currentLevel = level;
  currentState = STATE.PLAYING;
  characterSelectEl.classList.add('hidden');
  levelCompleteEl.classList.add('hidden');
  finalScreenEl.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  pauseScreenEl.classList.add('hidden');
  achievementToast.classList.add('hidden');

  // Always start each level with full HP
  player.hp = player.maxHp;
  player.combo = 0;
  player.comboTimer = 0;
  player.rapidFireTime = 0;
  player.shieldTime = 0;

  // Only reset score & achievements at the very start of a run
  if (level === 1) {
    player.score = 0;
    player.maxCombo = 0;
    achievements.forEach(a => a.unlocked = false);
  }

  player.x = canvas.width / 2 - player.size / 2;
  player.y = canvas.height - 120;
  player.bullets = [];
  // Brief grace period so a fresh level never sneak-damages the player on frame one
  player.invincibleTime = Date.now() + 1200;
  levelStartedWithoutHit = true;

  enemies = [];
  powerups = [];
  particles = [];
  bossProjectiles = [];
  bossLasers = [];
  boss = null;

  if (level <= 4) {
    // 6 lanes, but enemies spawn at random Y offsets, not in perfect horizontal lines
    const laneCount = 6;
    const enemiesPerLane = 4 + level;

    for (let lane = 0; lane < laneCount; lane++) {
      const laneX = getLaneX(lane, laneCount);
      for (let i = 0; i < enemiesPerLane; i++) {
        enemies.push({
          x: laneX + (Math.random() * 20 - 10), // small random within lane
          y: -i * (120 + Math.random() * 60), // random vertical spacing
          size: 28,
          speed: 2.5 + level * 0.5,
          color: '#ff3366',
          lane: lane,
          hp: 1
        });
      }
    }
  } else {
    // Boss level
    boss = {
      x: canvas.width / 2 - 40,
      y: 70,
      w: 90,
      h: 90,
      hp: 140,
      maxHp: 140,
      speed: 3.2,
      dir: 1,
      color: '#aa00ff',
      nextAttackIn: 1400
    };
  }
}

// Collision helper. Pass a negative pad to make the hitbox more forgiving
// (used for bullets vs. small enemies, since lining up a thin bullet with
// a fast-moving box is otherwise unreasonably fiddly).
function rectCollide(ax, ay, aw, ah, bx, by, bw, bh, pad = 5) {
  return (
    ax < bx + bw - pad &&
    ax + aw > bx + pad &&
    ay < by + bh - pad &&
    ay + ah > by + pad
  );
}

// Spawn power-up
function spawnPowerup(x, y) {
  // 15% chance
  if (Math.random() > 0.15) return;
  const types = ['rapid', 'shield', 'heal'];
  const type = types[Math.floor(Math.random() * types.length)];
  let color = '#ffffff';
  if (type === 'rapid') color = '#00f2ff';
  if (type === 'shield') color = '#00ff9c';
  if (type === 'heal') color = '#ffaa00';

  powerups.push({
    x, y, size: 16, speed: 2, color, type
  });
}

// ============================================================
// Boss attacks - rays & aimed shots
// ============================================================
function spawnBossAttack() {
  const roll = Math.random();
  if (roll < 0.55) {
    // Telegraphed vertical laser beam, straight down from the boss's current x
    bossLasers.push({
      x: boss.x + boss.w / 2,
      width: 26,
      state: 'warning',
      timer: 550,
      hasHit: false
    });
    SFX.laserWarn();
  } else {
    // A 3-shot spread aimed at the player's position right now
    const originX = boss.x + boss.w / 2;
    const originY = boss.y + boss.h;
    const targetX = player.x + player.size / 2;
    const targetY = player.y + player.size / 2;
    const baseAngle = Math.atan2(targetY - originY, targetX - originX);
    [-0.22, 0, 0.22].forEach((offset) => {
      const angle = baseAngle + offset;
      bossProjectiles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * 6,
        vy: Math.sin(angle) * 6,
        size: 12,
        color: '#ff66ff'
      });
    });
    SFX.bossShot();
  }
  boss.nextAttackIn = 1100 + Math.random() * 700;
}

function updateBossAttacks(now) {
  // Lasers
  bossLasers.forEach((l) => {
    l.timer -= 16;
    if (l.state === 'warning' && l.timer <= 0) {
      l.state = 'active';
      l.timer = 260;
      SFX.laserFire();
      triggerShake(4, 150);
    } else if (l.state === 'active') {
      if (!l.hasHit && Math.abs((player.x + player.size / 2) - l.x) < (l.width / 2 + player.size / 2)) {
        l.hasHit = true;
        damagePlayer(18, now);
      }
    }
  });
  bossLasers = bossLasers.filter((l) => !(l.state === 'active' && l.timer <= 0));

  // Aimed projectiles
  bossProjectiles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    if (rectCollide(player.x, player.y, player.size, player.size, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)) {
      p.hit = true;
      spawnParticles(p.x, p.y, p.color, 8, 0.8);
      damagePlayer(12, now);
    }
  });
  bossProjectiles = bossProjectiles.filter((p) => !p.hit && p.x > -50 && p.x < canvas.width + 50 && p.y > -50 && p.y < canvas.height + 50);
}

function drawBossAttacks() {
  bossLasers.forEach((l) => {
    if (l.state === 'warning') {
      ctx.globalAlpha = 0.35 + Math.sin(Date.now() / 60) * 0.15;
      ctx.fillStyle = '#ff0055';
      ctx.fillRect(l.x - 2, 0, 4, canvas.height);
      ctx.globalAlpha = 1;
    } else {
      const grad = ctx.createLinearGradient(l.x - l.width / 2, 0, l.x + l.width / 2, 0);
      grad.addColorStop(0, 'rgba(255,0,85,0)');
      grad.addColorStop(0.5, 'rgba(255,120,180,0.9)');
      grad.addColorStop(1, 'rgba(255,0,85,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(l.x - l.width / 2, 0, l.width, canvas.height);
    }
  });

  bossProjectiles.forEach((p) => {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ============================================================
// Update game logic
// ============================================================
function update() {
  updateStars();
  if (currentState !== STATE.PLAYING) return;

  const now = Date.now();

  if (shake.time > 0) shake.time -= 16;

  // Combo timer
  if (player.comboTimer > 0) {
    player.comboTimer -= 16;
    if (player.comboTimer <= 0) {
      player.combo = 0;
    }
  }
  if (player.rapidFireTime > 0 && player.rapidFireTime < now) {
    player.rapidFireTime = 0;
  }
  if (player.shieldTime > 0 && player.shieldTime < now) {
    player.shieldTime = 0;
  }

  // Player movement
  if (keys['arrowleft'] || keys['a']) player.x -= player.speed;
  if (keys['arrowright'] || keys['d']) player.x += player.speed;
  if (keys['arrowup'] || keys['w']) player.y -= player.speed;
  if (keys['arrowdown'] || keys['s']) player.y += player.speed;

  player.x = Math.max(0, Math.min(canvas.width - player.size, player.x));
  player.y = Math.max(0, Math.min(canvas.height - player.size, player.y));

  // Bullets
  player.bullets.forEach((b) => {
    b.y -= b.speed;
  });
  player.bullets = player.bullets.filter((b) => b.y + b.size > 0);

  updateParticles();

  // Enemies
  if (currentLevel <= 4) {
    const laneCount = 6;

    enemies.forEach((e) => {
      e.y += e.speed;
      if (e.y > canvas.height) {
        e.y = -20;
        e.x = getLaneX(e.lane, laneCount) + (Math.random() * 20 - 10);
      }
    });

    // Bullets vs enemies - generous hitbox so aiming feels fair
    player.bullets.forEach((b) => {
      enemies.forEach((e) => {
        if (rectCollide(b.x, b.y, b.size, b.size, e.x, e.y, e.size, e.size, -6)) {
          e.hp -= 1;
          spawnParticles(e.x + e.size / 2, e.y + e.size / 2, e.color, 6, 0.7);
          e.y = -1000;
          b.y = -1000;
          if (e.hp <= 0) {
            player.score += 10 + player.combo;
            player.combo += 1;
            player.maxCombo = Math.max(player.maxCombo, player.combo);
            player.comboTimer = 2000;
            SFX.kill();
            if (player.combo >= 10) showAchievement('combo_10');
            spawnPowerup(e.x, e.y);
            if (!achievements.find(a => a.id === 'first_blood').unlocked) {
              showAchievement('first_blood');
            }
          }
        }
      });
    });
    enemies = enemies.filter((e) => e.y > -100);

    // Power-ups
    powerups.forEach((p) => {
      p.y += p.speed;
      if (rectCollide(player.x, player.y, player.size, player.size, p.x, p.y, p.size, p.size)) {
        p.y = -1000;
        SFX.powerup();
        spawnParticles(player.x + player.size / 2, player.y + player.size / 2, p.color, 10, 0.8);
        if (p.type === 'rapid') {
          player.rapidFireTime = now + 5000;
        } else if (p.type === 'shield') {
          player.shieldTime = now + 7000;
        } else if (p.type === 'heal') {
          player.hp = Math.min(player.maxHp, player.hp + 20);
        }
      }
    });
    powerups = powerups.filter((p) => p.y > -50);

    // Enemies vs player
    enemies.forEach((e) => {
      if (rectCollide(player.x, player.y, player.size, player.size, e.x, e.y, e.size, e.size)) {
        damagePlayer(20, now);
      }
    });

    if (enemies.length === 0 && currentState === STATE.PLAYING) {
      if (levelStartedWithoutHit && !achievements.find(a => a.id === 'no_hit_level').unlocked) {
        showAchievement('no_hit_level');
      }
      currentState = STATE.LEVEL_COMPLETE;
      SFX.levelComplete();
      levelTitleEl.textContent = `Level ${currentLevel} Complete`;
      levelSummaryEl.textContent = `Score: ${player.score} · Best combo: ${player.maxCombo}x`;
      levelCompleteEl.classList.remove('hidden');
    }
  } else {
    // Boss
    boss.x += boss.speed * boss.dir;
    if (boss.x <= 0 || boss.x + boss.w >= canvas.width) boss.dir *= -1;

    boss.nextAttackIn -= 16;
    if (boss.nextAttackIn <= 0) {
      spawnBossAttack();
    }
    updateBossAttacks(now);

    player.bullets.forEach((b) => {
      if (rectCollide(b.x, b.y, b.size, b.size, boss.x, boss.y, boss.w, boss.h)) {
        boss.hp -= 3;
        spawnParticles(b.x, b.y, boss.color, 5, 0.6);
        b.y = -1000;
      }
    });

    if (rectCollide(player.x, player.y, player.size, player.size, boss.x, boss.y, boss.w, boss.h)) {
      damagePlayer(15, now);
    }

    if (boss.hp <= 0 && currentState === STATE.PLAYING) {
      if (!achievements.find(a => a.id === 'boss_slayer').unlocked) {
        showAchievement('boss_slayer');
      }
      spawnParticles(boss.x + boss.w / 2, boss.y + boss.h / 2, '#aa00ff', 40, 1.6);
      spawnParticles(boss.x + boss.w / 2, boss.y + boss.h / 2, '#ffd166', 30, 1.3);
      triggerShake(10, 400);
      SFX.victory();
      currentState = STATE.FINAL;
      setTimeout(showFinalScreen, 500);
    }
  }
}

// ============================================================
// Draw
// ============================================================
function draw() {
  ctx.save();

  if (shake.time > 0) {
    const dx = (Math.random() - 0.5) * shake.mag;
    const dy = (Math.random() - 0.5) * shake.mag;
    ctx.translate(dx, dy);
  }

  ctx.fillStyle = '#0f1420';
  ctx.fillRect(-20, -20, canvas.width + 40, canvas.height + 40);
  drawStars();

  if (currentState === STATE.PLAYING || currentState === STATE.PAUSED || currentState === STATE.GAME_OVER) {
    const now = Date.now();

    if (currentLevel > 4) drawBossAttacks();

    // Player (flicker while invincible, for feedback)
    const flickerOff = player.invincibleTime > now && Math.floor(now / 90) % 2 === 0;
    if (!flickerOff) {
      ctx.fillStyle = player.color;
      ctx.fillRect(player.x, player.y, player.size, player.size);
      if (player.shieldTime > now) {
        ctx.strokeStyle = '#00ff9c';
        ctx.lineWidth = 3;
        ctx.strokeRect(player.x - 4, player.y - 4, player.size + 8, player.size + 8);
      }
    }

    // Bullets
    ctx.fillStyle = '#ffffff';
    player.bullets.forEach((b) => {
      ctx.fillRect(b.x, b.y, b.size, b.size);
    });

    // Enemies
    if (currentLevel <= 4) {
      enemies.forEach((e) => {
        ctx.fillStyle = e.color;
        ctx.fillRect(e.x, e.y, e.size, e.size);
      });
    }

    // Boss
    if (boss) {
      ctx.fillStyle = boss.color;
      ctx.fillRect(boss.x, boss.y, boss.w, boss.h);
      const hpPercent = Math.max(0, boss.hp / boss.maxHp);
      ctx.fillStyle = '#333';
      ctx.fillRect(boss.x, boss.y - 18, boss.w, 10);
      ctx.fillStyle = '#00ff9c';
      ctx.fillRect(boss.x, boss.y - 18, boss.w * hpPercent, 10);
    }

    // Power-ups
    powerups.forEach((p) => {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });

    drawParticles();

    // HP bar
    const hpPercent = Math.max(0, player.hp / player.maxHp);
    const barW = 200, barH = 14, barX = 20, barY = 20;
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = hpPercent > 0.5 ? '#00ff9c' : hpPercent > 0.25 ? '#ffaa00' : '#ff3366';
    ctx.fillRect(barX, barY, barW * hpPercent, barH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, barH);
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(`HP: ${Math.max(0, player.hp)}/${player.maxHp}`, barX, barY - 4);

    // Score + combo
    const scoreText = `Score: ${player.score}`;
    const comboText = player.combo > 1 ? `Combo x${player.combo}` : '';
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'right';
    const scoreX = canvas.width - 20, scoreY = 30;
    ctx.fillText(scoreText, scoreX, scoreY);
    if (comboText) ctx.fillText(comboText, scoreX, scoreY + 18);
    ctx.textAlign = 'left';

    // Power-up timers
    let yOff = 50;
    if (player.rapidFireTime > now) {
      ctx.fillStyle = '#00f2ff';
      ctx.fillText('Rapid Fire', barX, barY + yOff);
      yOff += 18;
    }
    if (player.shieldTime > now) {
      ctx.fillStyle = '#00ff9c';
      ctx.fillText('Shield Active', barX, barY + yOff);
    }

    // Enemies left (only for levels 1-4)
    if (currentLevel <= 4) {
      const enemiesLeft = enemies.length;
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`Enemies left: ${enemiesLeft}`, canvas.width - 20, 60);
      ctx.textAlign = 'left';
    } else if (boss) {
      const bossHPText = `Boss HP: ${Math.max(0, boss.hp)}/${boss.maxHp}`;
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(bossHPText, canvas.width - 20, 30);
      ctx.textAlign = 'left';
    }
  }

  ctx.restore();
}

// ============================================================
// Loop
// ============================================================
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}
loop();

// ============================================================
// Buttons / screen flow
// ============================================================
nextLevelBtn.addEventListener('click', () => {
  if (currentLevel < 5) startLevel(currentLevel + 1);
});

function showFinalScreen() {
  currentState = STATE.FINAL;
  finalScreenEl.classList.remove('hidden');
}

function showGameOver() {
  currentState = STATE.GAME_OVER;
  SFX.gameOver();
  gameOverScreen.classList.remove('hidden');
}

retryBtn.addEventListener('click', () => startLevel(currentLevel));

replayBtn.addEventListener('click', () => {
  currentState = STATE.SELECT;
  characterSelectEl.classList.remove('hidden');
  finalScreenEl.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  achievementToast.classList.add('hidden');
  selectedCharacter = null;
  currentLevel = 1;
});
