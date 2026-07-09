const STARTING_WALLET = 1000;
const CHIP_VALUES = [10, 50, 100, 500];
const STORAGE_KEY = "lac-mam-viet-v1";
const MAX_HISTORY = 8;
const BIG_WIN_THRESHOLD = 300;
const SUPPORTED_LANGS = ["vi", "en", "zh"];

const dishes = [
  { id: "pho", color: "#bf3f2f" },
  { id: "banhmi", color: "#d1892b" },
  { id: "bunbo", color: "#b3202a" },
  { id: "comtam", color: "#2f7d49" },
  { id: "banhxeo", color: "#d0a018" },
  { id: "goicuon", color: "#2b8d80" },
];

const dishById = Object.fromEntries(dishes.map((dish) => [dish.id, dish]));

const state = {
  lang: "vi",
  wallet: STARTING_WALLET,
  selectedChip: 50,
  bets: emptyBets(),
  lastRoll: [],
  lastHits: {},
  history: [],
  lastBets: null,
  notice: { key: "notice.welcome", params: {} },
  rolling: false,
  roundDelta: 0,
  musicOn: false,
  volume: 0.7,
  stats: {
    rounds: 0,
    wins: 0,
    losses: 0,
    net: 0,
    hitCounts: emptyHitCounts(),
  },
};

const musicState = {
  context: null,
  master: null,
  sfx: null,
  musicBus: null,
  reverb: null,
  comp: null,
  tickTimer: null,
  step: 0,
};

/**
 * Casino lounge / Vegas floor style:
 * swing-ish groove, walking bass, vibraphone lead, brass stabs, jackpot chimes.
 * 1 step = 1 eighth note @ ~128 BPM → 234ms
 */
const MUSIC = {
  stepMs: 234,
  masterMul: 0.9,
  // Vibraphone-ish lead (0 = rest). Bright major / lucky motif.
  lead: [
    659.25, 0, 783.99, 0, 880.0, 783.99, 659.25, 587.33,
    523.25, 0, 659.25, 0, 783.99, 880.0, 1046.5, 0,
    987.77, 880.0, 783.99, 0, 659.25, 587.33, 523.25, 0,
    587.33, 659.25, 783.99, 880.0, 783.99, 659.25, 523.25, 0,
  ],
  // Walking jazz-casino bass (Hz)
  bass: [
    98.0, 123.47, 130.81, 146.83, 164.81, 146.83, 130.81, 123.47,
    110.0, 130.81, 146.83, 164.81, 174.61, 164.81, 146.83, 130.81,
  ],
  // Chord roots for brass stabs every half-bar feel
  brass: [261.63, 0, 0, 0, 293.66, 0, 0, 0, 329.63, 0, 0, 0, 349.23, 0, 392.0, 0],
  // High jackpot sparkle arpeggio (plays in second half of phrase)
  sparkle: [1046.5, 1318.5, 1568.0, 2093.0, 1568.0, 1318.5, 1046.5, 0],
};

const els = {
  walletValue: document.querySelector("#walletValue"),
  bettingGrid: document.querySelector("#bettingGrid"),
  diceTray: document.querySelector("#diceTray"),
  roundLabel: document.querySelector("#roundLabel"),
  roundResult: document.querySelector("#roundResult"),
  chipRack: document.querySelector("#chipRack"),
  selectedChip: document.querySelector("#selectedChip"),
  totalBet: document.querySelector("#totalBet"),
  potentialPayout: document.querySelector("#potentialPayout"),
  rollButton: document.querySelector("#rollButton"),
  rebetButton: document.querySelector("#rebetButton"),
  clearButton: document.querySelector("#clearButton"),
  resetButton: document.querySelector("#resetButton"),
  musicButton: document.querySelector("#musicButton"),
  musicButtonLabel: document.querySelector("#musicButtonLabel"),
  volumeSlider: document.querySelector("#volumeSlider"),
  notice: document.querySelector("#notice"),
  historyCount: document.querySelector("#historyCount"),
  historyList: document.querySelector("#historyList"),
  rulesButton: document.querySelector("#rulesButton"),
  rulesModal: document.querySelector("#rulesModal"),
  confirmModal: document.querySelector("#confirmModal"),
  confirmMessage: document.querySelector("#confirmMessage"),
  confirmOk: document.querySelector("#confirmOk"),
  confirmCancel: document.querySelector("#confirmCancel"),
  brokeBanner: document.querySelector("#brokeBanner"),
  brokeReset: document.querySelector("#brokeReset"),
  confettiLayer: document.querySelector("#confettiLayer"),
  statsRounds: document.querySelector("#statsRounds"),
  statsNet: document.querySelector("#statsNet"),
  statsWins: document.querySelector("#statsWins"),
  statsLosses: document.querySelector("#statsLosses"),
  statsHot: document.querySelector("#statsHot"),
  pageTitle: document.querySelector("#pageTitle"),
  metaDescription: document.querySelector("#metaDescription"),
};

/* ---------- i18n helpers ---------- */

function getNested(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function t(path, params = {}) {
  const pack = I18N[state.lang] || I18N.vi;
  let text = getNested(pack, path);
  if (text == null) text = getNested(I18N.vi, path);
  if (text == null) return path;

  return String(text).replace(/\{(\w+)\}/g, (_, key) =>
    params[key] != null ? String(params[key]) : `{${key}}`,
  );
}

function dishName(id) {
  return t(`dishes.${id}`);
}

function localeTag() {
  return LOCALE_MAP[state.lang] || "vi-VN";
}

function formatNumber(value) {
  return new Intl.NumberFormat(localeTag()).format(value);
}

function formatXu(value) {
  return `${formatNumber(value)} ${t("unit")}`;
}

function formatSignedXu(value) {
  if (value > 0) return `+${formatXu(value)}`;
  if (value < 0) return `-${formatXu(Math.abs(value))}`;
  return formatXu(0);
}

function setNotice(key, params = {}) {
  state.notice = { key, params };
}

function noticeText() {
  const params = { ...state.notice.params };
  if (params.amount != null && typeof params.amount === "number") {
    params.amount = formatXu(params.amount);
  }
  if (params.dishId) {
    params.dish = dishName(params.dishId);
  }
  return t(state.notice.key, params);
}

function detectBrowserLang() {
  const list = navigator.languages || [navigator.language || "vi"];
  for (const raw of list) {
    const code = String(raw).toLowerCase();
    if (code.startsWith("vi")) return "vi";
    if (code.startsWith("zh")) return "zh";
    if (code.startsWith("en")) return "en";
  }
  return "vi";
}

function setLang(lang, { persist = true } = {}) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = "vi";
  state.lang = lang;
  document.documentElement.lang = LANG_HTML[lang] || lang;
  document.documentElement.dataset.lang = lang;

  if (els.pageTitle) els.pageTitle.textContent = t("meta.title");
  if (els.metaDescription) els.metaDescription.setAttribute("content", t("meta.description"));

  applyStaticI18n();
  updateLangButtons();

  if (persist) saveState();
  render();
}

function applyStaticI18n() {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    const value = t(key);
    if (node.hasAttribute("data-i18n-html")) {
      node.innerHTML = value;
    } else {
      node.textContent = value;
    }
  });

  document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
    node.setAttribute("aria-label", t(node.getAttribute("data-i18n-aria")));
  });
}

function updateLangButtons() {
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    const active = btn.dataset.lang === state.lang;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

function emptyBets() {
  return Object.fromEntries(dishes.map((dish) => [dish.id, 0]));
}

function emptyHitCounts() {
  return Object.fromEntries(dishes.map((dish) => [dish.id, 0]));
}

function randomIndex(max) {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % max;
}

function randomRoll() {
  return Array.from({ length: 3 }, () => dishes[randomIndex(dishes.length)].id);
}

function getTotalBet() {
  return Object.values(state.bets).reduce((sum, amount) => sum + amount, 0);
}

function getRollCounts(roll) {
  return roll.reduce((counts, id) => {
    counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {});
}

function getPotentialPayout() {
  let total = 0;
  for (const dish of dishes) {
    const bet = state.bets[dish.id];
    if (bet > 0) total += bet * 2;
  }
  return total;
}

function isBroke() {
  return state.wallet <= 0 && getTotalBet() === 0;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/* ---------- Persistence ---------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state.lang = detectBrowserLang();
      return;
    }
    const data = JSON.parse(raw);
    if (SUPPORTED_LANGS.includes(data.lang)) {
      state.lang = data.lang;
    } else {
      state.lang = detectBrowserLang();
    }
    if (typeof data.wallet === "number" && data.wallet >= 0) {
      state.wallet = data.wallet;
    }
    if (Array.isArray(data.history)) {
      state.history = data.history.slice(0, MAX_HISTORY);
    }
    if (data.lastBets && typeof data.lastBets === "object") {
      state.lastBets = { ...emptyBets(), ...data.lastBets };
    }
    if (data.stats && typeof data.stats === "object") {
      state.stats = {
        rounds: Number(data.stats.rounds) || 0,
        wins: Number(data.stats.wins) || 0,
        losses: Number(data.stats.losses) || 0,
        net: Number(data.stats.net) || 0,
        hitCounts: { ...emptyHitCounts(), ...(data.stats.hitCounts || {}) },
      };
    }
    if (typeof data.volume === "number") {
      state.volume = Math.min(1, Math.max(0, data.volume));
    }
    if (CHIP_VALUES.includes(data.selectedChip)) {
      state.selectedChip = data.selectedChip;
    }
  } catch {
    state.lang = detectBrowserLang();
  }
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lang: state.lang,
        wallet: state.wallet,
        history: state.history,
        lastBets: state.lastBets,
        stats: state.stats,
        volume: state.volume,
        selectedChip: state.selectedChip,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

/* ---------- Audio (casino lounge style) ---------- */

function clearMusicTimers() {
  window.clearInterval(musicState.tickTimer);
  musicState.tickTimer = null;
}

function ensureAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;

  if (!musicState.context) {
    const ctx = new AudioContextClass();
    musicState.context = ctx;

    musicState.comp = ctx.createDynamicsCompressor();
    musicState.comp.threshold.value = -16;
    musicState.comp.knee.value = 20;
    musicState.comp.ratio.value = 5;
    musicState.comp.attack.value = 0.004;
    musicState.comp.release.value = 0.22;
    musicState.comp.connect(ctx.destination);

    // Simple room sheen via delay feedback (casino hall vibe)
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.18;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.22;
    const wet = ctx.createGain();
    wet.gain.value = 0.18;
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(musicState.comp);
    musicState.reverb = delay;

    musicState.master = ctx.createGain();
    musicState.musicBus = ctx.createGain();
    musicState.sfx = ctx.createGain();

    musicState.master.gain.value = state.volume * MUSIC.masterMul;
    musicState.musicBus.gain.value = 1;
    musicState.sfx.gain.value = state.volume * 1.2;

    musicState.musicBus.connect(musicState.master);
    musicState.musicBus.connect(musicState.reverb);
    musicState.master.connect(musicState.comp);
    musicState.sfx.connect(musicState.comp);
  }
  return true;
}

async function resumeAudio() {
  if (!ensureAudio()) return false;
  if (musicState.context.state === "suspended") {
    await musicState.context.resume();
  }
  applyVolume();
  return true;
}

function applyVolume() {
  if (!musicState.context) return;
  const now = musicState.context.currentTime;
  if (musicState.master) {
    musicState.master.gain.cancelScheduledValues(now);
    musicState.master.gain.setTargetAtTime(
      state.musicOn ? state.volume * MUSIC.masterMul : 0,
      now,
      0.05,
    );
  }
  if (musicState.sfx) {
    musicState.sfx.gain.cancelScheduledValues(now);
    musicState.sfx.gain.setTargetAtTime(state.volume * 1.2, now, 0.05);
  }
}

async function toggleMusic() {
  if (state.musicOn) {
    stopMusic();
    setNotice("notice.musicOff");
    render();
    return;
  }

  const started = await startMusic();
  if (started) setNotice("notice.musicOn");
  render();
}

async function startMusic() {
  if (!(await resumeAudio())) {
    setNotice("notice.noAudio");
    return false;
  }

  state.musicOn = true;
  musicState.step = 0;
  applyVolume();
  clearMusicTimers();
  playCasinoTick();
  musicState.tickTimer = window.setInterval(playCasinoTick, MUSIC.stepMs);
  return true;
}

function stopMusic() {
  state.musicOn = false;
  clearMusicTimers();
  applyVolume();
}

/** One sequencer tick = one 8th note — all casino layers fire here */
function playCasinoTick() {
  if (!state.musicOn || !musicState.context || !musicState.musicBus) return;

  const step = musicState.step;
  const bar = step % 32;
  const beat = step % 8;
  musicState.step += 1;

  // --- Walking bass ---
  const bassNote = MUSIC.bass[step % MUSIC.bass.length];
  if (bassNote) {
    playTone(bassNote, 0.2, "triangle", 0.13, musicState.musicBus, {
      filterFreq: 380,
      attack: 0.008,
    });
    playTone(bassNote, 0.24, "sine", 0.1, musicState.musicBus);
  }

  // --- Kick / snare lounge groove ---
  if (beat === 0 || beat === 4) playKick(beat === 0 ? 0.2 : 0.14);
  if (beat === 2 || beat === 6) playSnare(beat === 2 ? 0.13 : 0.1);
  // Chip-clink on the "and" of 2 (casino table feel)
  if (beat === 3 || beat === 7) playChipClink(0.045);

  // --- Swing-ish hi-hat: denser on off-beats ---
  const hatOpen = beat === 1 || beat === 5;
  playNoise(hatOpen ? 0.048 : 0.03, hatOpen ? 0.09 : 0.028, musicState.musicBus, {
    filterType: "highpass",
    filterFreq: hatOpen ? 5500 : 9500,
  });
  // Extra shuffle 16th ghost
  if (beat % 2 === 0) {
    window.setTimeout(() => {
      if (!state.musicOn) return;
      playNoise(0.018, 0.02, musicState.musicBus, {
        filterType: "highpass",
        filterFreq: 10000,
      });
    }, MUSIC.stepMs * 0.42);
  }

  // --- Vibraphone lead ---
  const lead = MUSIC.lead[step % MUSIC.lead.length];
  if (lead) {
    playVibraphone(lead, beat === 0 || beat === 4 ? 0.12 : 0.085);
  }

  // --- Brass / organ stabs ---
  const brassRoot = MUSIC.brass[step % MUSIC.brass.length];
  if (brassRoot) playBrassChord(brassRoot);

  // --- Jackpot sparkle every other phrase ---
  if (bar >= 24) {
    const spark = MUSIC.sparkle[bar - 24];
    if (spark) playChime(spark, 0.07);
  }

  // --- Big "lucky" chime cascade every 4 bars ---
  if (bar === 0 && step > 0) {
    playChime(1318.5, 0.08);
    window.setTimeout(() => playChime(1568.0, 0.07), 70);
    window.setTimeout(() => playChime(2093.0, 0.09), 140);
  }
}

function playVibraphone(freq, volume) {
  // Soft attack, bright decay — classic casino lounge mallet tone
  playTone(freq, 0.28, "sine", volume, musicState.musicBus, {
    attack: 0.004,
    decay: 0.28,
  });
  playTone(freq * 2.01, 0.18, "sine", volume * 0.35, musicState.musicBus, {
    attack: 0.003,
    decay: 0.18,
  });
  playTone(freq, 0.22, "triangle", volume * 0.45, musicState.musicBus, {
    detune: 4,
    attack: 0.006,
  });
}

function playBrassChord(root) {
  const third = root * 1.25;
  const fifth = root * 1.5;
  const opts = { filterFreq: 1400, attack: 0.02, filterType: "lowpass" };
  playTone(root, 0.26, "sawtooth", 0.045, musicState.musicBus, opts);
  playTone(third, 0.24, "sawtooth", 0.035, musicState.musicBus, opts);
  playTone(fifth, 0.22, "triangle", 0.04, musicState.musicBus, opts);
}

function playChime(freq, volume) {
  playTone(freq, 0.55, "sine", volume, musicState.musicBus, {
    attack: 0.002,
    decay: 0.55,
  });
  playTone(freq * 2.0, 0.35, "sine", volume * 0.4, musicState.musicBus, {
    attack: 0.002,
    decay: 0.35,
  });
  playTone(freq * 3.01, 0.2, "triangle", volume * 0.18, musicState.musicBus, {
    attack: 0.002,
    decay: 0.2,
  });
}

function playChipClink(volume) {
  playTone(2400, 0.04, "square", volume, musicState.musicBus, {
    filterFreq: 4200,
    attack: 0.001,
  });
  playTone(3200, 0.03, "triangle", volume * 0.7, musicState.musicBus, {
    attack: 0.001,
  });
}

function playKick(volume) {
  if (!musicState.context || !musicState.musicBus) return;
  const ctx = musicState.context;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, now);
  osc.frequency.exponentialRampToValueAtTime(45, now + 0.14);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  osc.connect(gain);
  gain.connect(musicState.musicBus);
  osc.start(now);
  osc.stop(now + 0.32);
  playNoise(volume * 0.28, 0.025, musicState.musicBus, {
    filterType: "lowpass",
    filterFreq: 700,
  });
}

function playSnare(volume) {
  // Brushier casino snare
  playNoise(volume, 0.11, musicState.musicBus, {
    filterType: "bandpass",
    filterFreq: 2200,
    q: 0.7,
  });
  playNoise(volume * 0.55, 0.07, musicState.musicBus, {
    filterType: "highpass",
    filterFreq: 5000,
  });
  playTone(210, 0.05, "triangle", volume * 0.35, musicState.musicBus);
}

function playTone(frequency, duration, type, volume, destination, opts = {}) {
  if (!musicState.context || !destination || !frequency) return;
  const context = musicState.context;
  const now = context.currentTime;
  const attack = opts.attack ?? 0.012;
  const decay = opts.decay ?? duration;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  if (opts.detune) oscillator.detune.setValueAtTime(opts.detune, now);

  let node = oscillator;
  if (opts.filterFreq) {
    const filter = context.createBiquadFilter();
    filter.type = opts.filterType || "lowpass";
    filter.frequency.value = opts.filterFreq;
    filter.Q.value = opts.q || 0.8;
    oscillator.connect(filter);
    node = filter;
  }

  node.connect(gain);
  gain.connect(destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(decay, attack + 0.02));
  oscillator.start(now);
  oscillator.stop(now + decay + 0.04);
}

function playNoise(volume, duration, destination, opts = {}) {
  if (!musicState.context || !destination) return;
  const context = musicState.context;
  const bufferSize = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const now = context.currentTime;

  filter.type = opts.filterType || "bandpass";
  filter.frequency.value = opts.filterFreq || 2400;
  filter.Q.value = opts.q || 0.7;
  gain.gain.setValueAtTime(Math.max(volume, 0.0001), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(now);
  source.stop(now + duration);
}

function playChimeTo(freq, volume, dest) {
  playTone(freq, 0.55, "sine", volume, dest, { attack: 0.002, decay: 0.55 });
  playTone(freq * 2.0, 0.35, "sine", volume * 0.4, dest, { attack: 0.002, decay: 0.35 });
  playTone(freq * 3.01, 0.2, "triangle", volume * 0.18, dest, { attack: 0.002, decay: 0.2 });
}

async function playSfx(kind) {
  if (state.volume <= 0) return;
  if (!(await resumeAudio())) return;

  const dest = musicState.sfx;
  if (kind === "chip") {
    playTone(2100, 0.04, "square", 0.08, dest, { filterFreq: 4500, attack: 0.001 });
    playTone(2800, 0.05, "triangle", 0.06, dest, { attack: 0.001 });
    playTone(3400, 0.03, "sine", 0.04, dest);
  } else if (kind === "remove") {
    playTone(1400, 0.05, "square", 0.05, dest, { filterFreq: 2800, attack: 0.001 });
    playTone(900, 0.06, "triangle", 0.04, dest);
  } else if (kind === "roll") {
    playNoise(0.11, 0.16, dest, { filterType: "bandpass", filterFreq: 1400 });
    playTone(220, 0.1, "triangle", 0.07, dest);
    window.setTimeout(() => {
      playTone(2400, 0.04, "square", 0.06, dest, { filterFreq: 4200, attack: 0.001 });
    }, 40);
    window.setTimeout(() => {
      playTone(2800, 0.035, "triangle", 0.05, dest, { attack: 0.001 });
    }, 100);
  } else if (kind === "win") {
    playChimeTo(1046.5, 0.11, dest);
    window.setTimeout(() => playChimeTo(1318.5, 0.11, dest), 90);
    window.setTimeout(() => playChimeTo(1568.0, 0.13, dest), 180);
  } else if (kind === "lose") {
    playTone(349.23, 0.14, "triangle", 0.07, dest);
    window.setTimeout(() => playTone(277.18, 0.2, "sine", 0.06, dest), 110);
  } else if (kind === "bigwin") {
    playChimeTo(1046.5, 0.13, dest);
    window.setTimeout(() => playChimeTo(1318.5, 0.13, dest), 80);
    window.setTimeout(() => playChimeTo(1568.0, 0.13, dest), 160);
    window.setTimeout(() => playChimeTo(2093.0, 0.17, dest), 240);
    window.setTimeout(() => {
      playTone(392.0, 0.28, "sawtooth", 0.06, dest, { filterFreq: 1400, attack: 0.02 });
      playTone(493.88, 0.26, "sawtooth", 0.05, dest, { filterFreq: 1400, attack: 0.02 });
      playTone(587.33, 0.24, "triangle", 0.05, dest);
    }, 200);
  }
}

/* ---------- Betting ---------- */

function placeBet(id) {
  if (state.rolling) return;

  if (isBroke()) {
    setNotice("notice.broke");
    render();
    return;
  }

  if (state.wallet < state.selectedChip) {
    setNotice("notice.notEnough");
    render();
    return;
  }

  state.wallet -= state.selectedChip;
  state.bets[id] += state.selectedChip;
  state.lastHits = {};
  state.roundDelta = 0;
  setNotice("notice.betAdd", { dishId: id, amount: state.selectedChip });
  playSfx("chip");
  saveState();
  render(id);
}

function removeBet(id) {
  if (state.rolling) return;

  const current = state.bets[id];
  if (!current) {
    setNotice("notice.noBetToRemove", { dishId: id });
    render(id);
    return;
  }

  const removeAmount = Math.min(state.selectedChip, current);
  state.bets[id] -= removeAmount;
  state.wallet += removeAmount;
  state.lastHits = {};
  state.roundDelta = 0;
  setNotice("notice.betRemove", { dishId: id, amount: removeAmount });
  playSfx("remove");
  saveState();
  render(id);
}

function clearBets() {
  if (state.rolling) return;

  const total = getTotalBet();
  if (!total) {
    setNotice("notice.nothingToClear");
    render();
    return;
  }

  state.wallet += total;
  state.bets = emptyBets();
  state.lastHits = {};
  state.roundDelta = 0;
  setNotice("notice.refunded", { amount: total });
  saveState();
  render();
}

function rebetLast() {
  if (state.rolling) return;

  if (!state.lastBets) {
    setNotice("notice.noLastRound");
    render();
    return;
  }

  const needed = Object.values(state.lastBets).reduce((s, v) => s + v, 0);
  if (!needed) {
    setNotice("notice.lastEmpty");
    render();
    return;
  }

  const alreadyOut = getTotalBet();
  const available = state.wallet + alreadyOut;
  if (available < needed) {
    setNotice("notice.rebetNotEnough", { amount: needed });
    render();
    return;
  }

  state.wallet += alreadyOut;
  state.bets = { ...state.lastBets };
  state.wallet -= needed;
  state.lastHits = {};
  state.roundDelta = 0;
  setNotice("notice.rebetOk", { amount: needed });
  playSfx("chip");
  saveState();
  render();
}

function requestReset() {
  if (state.rolling) return;
  openConfirm();
}

function resetGame() {
  if (state.rolling) return;

  state.wallet = STARTING_WALLET;
  state.bets = emptyBets();
  state.lastRoll = [];
  state.lastHits = {};
  state.history = [];
  state.lastBets = null;
  state.roundDelta = 0;
  state.stats = {
    rounds: 0,
    wins: 0,
    losses: 0,
    net: 0,
    hitCounts: emptyHitCounts(),
  };
  setNotice("notice.newGame");
  closeConfirm();
  saveState();
  render();
}

/* ---------- Roll ---------- */

async function rollRound() {
  if (state.rolling) return;

  const totalBet = getTotalBet();
  if (!totalBet) {
    setNotice(isBroke() ? "notice.brokeShort" : "notice.placeFirst");
    render();
    return;
  }

  state.rolling = true;
  state.lastHits = {};
  state.roundDelta = 0;
  setNotice("notice.shaking");
  render();
  playSfx("roll");

  let spinCount = 0;
  const spinTimer = window.setInterval(() => {
    state.lastRoll = randomRoll();
    spinCount += 1;
    renderDice();
    if (spinCount % 3 === 0) playSfx("roll");
    if (spinCount > 18) window.clearInterval(spinTimer);
  }, 70);

  await wait(1350);
  window.clearInterval(spinTimer);

  const finalRoll = randomRoll();
  const counts = getRollCounts(finalRoll);
  const hits = {};
  let returnAmount = 0;

  for (const dish of dishes) {
    const bet = state.bets[dish.id];
    const hitCount = counts[dish.id] || 0;
    hits[dish.id] = hitCount;

    if (bet > 0 && hitCount > 0) {
      returnAmount += bet * (hitCount + 1);
    }

    if (hitCount > 0) {
      state.stats.hitCounts[dish.id] = (state.stats.hitCounts[dish.id] || 0) + hitCount;
    }
  }

  const profit = returnAmount - totalBet;
  const snapshotBets = { ...state.bets };

  state.wallet += returnAmount;
  state.lastRoll = finalRoll;
  state.lastHits = hits;
  state.roundDelta = profit;
  state.lastBets = snapshotBets;
  state.history = [
    {
      id: Date.now(),
      roll: finalRoll,
      bets: snapshotBets,
      profit,
      totalBet,
    },
    ...state.history,
  ].slice(0, MAX_HISTORY);

  state.stats.rounds += 1;
  state.stats.net += profit;
  if (profit > 0) state.stats.wins += 1;
  else if (profit < 0) state.stats.losses += 1;

  state.bets = emptyBets();
  state.rolling = false;

  if (profit > 0) {
    setNotice("notice.win", { amount: profit });
    if (profit >= BIG_WIN_THRESHOLD) {
      playSfx("bigwin");
      burstConfetti();
    } else {
      playSfx("win");
    }
  } else if (profit < 0) {
    setNotice("notice.lose", { amount: Math.abs(profit) });
    playSfx("lose");
  } else {
    setNotice("notice.push");
  }

  if (isBroke()) {
    setNotice("notice.brokeEnd");
  }

  saveState();
  render();
}

/* ---------- Confetti ---------- */

function burstConfetti() {
  const layer = els.confettiLayer;
  if (!layer) return;
  layer.innerHTML = "";
  layer.classList.add("is-active");

  const colors = ["#efb33c", "#b83a2f", "#0f766e", "#2d7d46", "#315fa8", "#fff"];
  for (let i = 0; i < 48; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.25}s`;
    piece.style.animationDuration = `${1.2 + Math.random() * 0.9}s`;
    layer.appendChild(piece);
  }

  window.clearTimeout(burstConfetti._t);
  burstConfetti._t = window.setTimeout(() => {
    layer.classList.remove("is-active");
    layer.innerHTML = "";
  }, 2200);
}

/* ---------- Modals ---------- */

function openRules() {
  els.rulesModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeRules() {
  els.rulesModal.hidden = true;
  if (els.confirmModal.hidden) document.body.classList.remove("modal-open");
}

function openConfirm() {
  els.confirmMessage.textContent = t(isBroke() ? "confirm.broke" : "confirm.normal");
  els.confirmModal.hidden = false;
  document.body.classList.add("modal-open");
  els.confirmOk.focus();
}

function closeConfirm() {
  els.confirmModal.hidden = true;
  if (els.rulesModal.hidden) document.body.classList.remove("modal-open");
}

/* ---------- Render ---------- */

function render(focusDishId) {
  const active = document.activeElement;
  const focusChip = active?.dataset?.chip;
  const focusDish =
    focusDishId || active?.dataset?.dish || active?.closest?.("[data-dish]")?.dataset?.dish;
  const focusAction = active?.id;
  const focusLang = active?.dataset?.lang;

  els.walletValue.textContent = formatNumber(state.wallet);
  els.selectedChip.textContent = formatXu(state.selectedChip);
  els.totalBet.textContent = formatXu(getTotalBet());

  const potential = getPotentialPayout();
  els.potentialPayout.textContent =
    potential > 0
      ? t("ui.potentialValue", { amount: formatXu(potential) })
      : t("potentialEmpty");

  els.notice.textContent = noticeText();
  els.notice.classList.toggle("is-broke", isBroke());

  const totalBet = getTotalBet();
  els.rollButton.disabled = state.rolling || totalBet === 0;
  els.clearButton.disabled = state.rolling || totalBet === 0;
  els.resetButton.disabled = state.rolling;
  els.rebetButton.disabled = state.rolling || !state.lastBets;
  els.brokeBanner.hidden = !isBroke() || state.rolling;

  els.musicButton.classList.toggle("is-on", state.musicOn);
  els.musicButton.setAttribute("aria-pressed", String(state.musicOn));
  els.musicButton.setAttribute(
    "aria-label",
    state.musicOn ? t("ui.musicOffAria") : t("ui.musicOnAria"),
  );
  els.musicButtonLabel.textContent = state.musicOn ? t("ui.musicOff") : t("ui.musicOn");
  els.volumeSlider.value = String(Math.round(state.volume * 100));

  if (!els.confirmModal.hidden) {
    els.confirmMessage.textContent = t(isBroke() ? "confirm.broke" : "confirm.normal");
  }

  renderRoundStatus();
  renderChips();
  renderBoard();
  renderDice();
  renderHistory();
  renderStats();

  if (focusDish) {
    els.bettingGrid.querySelector(`[data-dish="${focusDish}"]`)?.focus({ preventScroll: true });
  } else if (focusChip) {
    els.chipRack.querySelector(`[data-chip="${focusChip}"]`)?.focus({ preventScroll: true });
  } else if (focusLang) {
    document.querySelector(`.lang-btn[data-lang="${focusLang}"]`)?.focus({ preventScroll: true });
  } else if (focusAction && document.getElementById(focusAction)) {
    document.getElementById(focusAction).focus({ preventScroll: true });
  }
}

function renderRoundStatus() {
  if (state.rolling) {
    els.roundLabel.textContent = t("ui.rolling");
  } else if (state.roundDelta !== 0 || state.lastRoll.length) {
    els.roundLabel.textContent = t("ui.thisRound");
  } else {
    els.roundLabel.textContent = t("ui.ready");
  }

  els.roundResult.textContent = formatSignedXu(state.roundDelta);

  const status = els.roundLabel.closest(".round-status");
  status.classList.toggle("is-win", state.roundDelta > 0);
  status.classList.toggle("is-loss", state.roundDelta < 0);
}

function renderChips() {
  for (const button of els.chipRack.querySelectorAll("[data-chip]")) {
    const value = Number(button.dataset.chip);
    button.classList.toggle("is-selected", value === state.selectedChip);
    button.disabled = state.rolling || state.wallet < value;
  }
}

function renderBoard() {
  els.bettingGrid.innerHTML = dishes
    .map((dish) => {
      const bet = state.bets[dish.id];
      const hitCount = state.lastHits[dish.id] || 0;
      const name = dishName(dish.id);
      const classes = [
        "dish-tile",
        bet > 0 ? "is-bet" : "",
        hitCount > 0 ? "is-hit" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `
        <div
          class="${classes}"
          style="--accent: ${dish.color}"
          data-dish-wrap="${dish.id}"
        >
          ${hitCount > 0 ? `<span class="hit-badge">x${hitCount}</span>` : ""}
          <button
            class="dish-main"
            type="button"
            data-dish="${dish.id}"
            ${state.rolling ? "disabled" : ""}
            aria-label="${t("aria.dishBet", { dish: name, amount: formatXu(bet) })}"
          >
            <span class="dish-visual" aria-hidden="true">${foodIcon(dish.id)}</span>
            <span class="dish-name">${name}</span>
            <span class="dish-meta">
              <span>${t("ui.betLabel")}</span>
              <strong>${formatXu(bet)}</strong>
            </span>
          </button>
          <div class="dish-actions">
            <button
              type="button"
              class="dish-step"
              data-remove-dish="${dish.id}"
              ${state.rolling || bet === 0 ? "disabled" : ""}
              aria-label="${t("aria.remove", {
                amount: formatXu(Math.min(state.selectedChip, bet || state.selectedChip)),
                dish: name,
              })}"
            >−</button>
            <button
              type="button"
              class="dish-step"
              data-add-dish="${dish.id}"
              ${state.rolling || state.wallet < state.selectedChip ? "disabled" : ""}
              aria-label="${t("aria.add", { amount: formatXu(state.selectedChip), dish: name })}"
            >+</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderDice() {
  const roll = state.lastRoll.length ? state.lastRoll : [null, null, null];
  els.diceTray.innerHTML = roll
    .map((id) => {
      if (!id) return '<div class="die is-empty"><span>?</span></div>';
      return `
        <div class="die ${state.rolling ? "is-spinning" : ""}" title="${dishName(id)}">
          ${foodIcon(id)}
        </div>
      `;
    })
    .join("");
}

function renderHistory() {
  els.historyCount.textContent = state.history.length;

  if (!state.history.length) {
    els.historyList.innerHTML = `<li class="empty-history">${t("ui.emptyHistory")}</li>`;
    return;
  }

  els.historyList.innerHTML = state.history
    .map((entry) => {
      const profitClass =
        entry.profit > 0 ? "is-win" : entry.profit < 0 ? "is-loss" : "";
      const betLabels = dishes
        .filter((d) => entry.bets[d.id] > 0)
        .map((d) => `${dishName(d.id)} ${formatNumber(entry.bets[d.id])}`)
        .join(" · ");

      return `
        <li class="history-item">
          <div class="history-main">
            <div class="history-roll" aria-label="${entry.roll.map((id) => dishName(id)).join(", ")}">
              ${entry.roll
                .map(
                  (id) =>
                    `<span class="mini-dish" aria-hidden="true">${foodIcon(id)}</span>`,
                )
                .join("")}
            </div>
            <div class="history-meta">
              <span class="history-bets">${betLabels || t("potentialEmpty")}</span>
              <span class="history-stake">${t("ui.stake")} ${formatXu(entry.totalBet)}</span>
            </div>
          </div>
          <span class="history-profit ${profitClass}">${formatSignedXu(entry.profit)}</span>
        </li>
      `;
    })
    .join("");
}

function renderStats() {
  const { rounds, wins, losses, net, hitCounts } = state.stats;
  els.statsRounds.textContent = t("ui.rounds", { n: rounds });
  els.statsNet.textContent = formatSignedXu(net);
  els.statsNet.classList.toggle("is-win", net > 0);
  els.statsNet.classList.toggle("is-loss", net < 0);
  els.statsWins.textContent = String(wins);
  els.statsLosses.textContent = String(losses);

  let hotId = null;
  let hotMax = 0;
  for (const dish of dishes) {
    const c = hitCounts[dish.id] || 0;
    if (c > hotMax) {
      hotMax = c;
      hotId = dish.id;
    }
  }
  els.statsHot.textContent = hotId
    ? `${dishName(hotId)} (${hotMax})`
    : t("potentialEmpty");
}

function foodIcon(id) {
  if (!dishById[id]) return "";
  const name = dishName(id);
  return `
    <img
      class="food-icon"
      src="assets/dishes/${id}.jpg"
      alt="${name}"
      width="120"
      height="120"
      loading="lazy"
      decoding="async"
      draggable="false"
    />
  `;
}

/* ---------- Events ---------- */

els.bettingGrid.addEventListener("click", (event) => {
  const removeBtn = event.target.closest("[data-remove-dish]");
  if (removeBtn) {
    removeBet(removeBtn.dataset.removeDish);
    return;
  }

  const addBtn = event.target.closest("[data-add-dish]");
  if (addBtn) {
    placeBet(addBtn.dataset.addDish);
    return;
  }

  const tile = event.target.closest("[data-dish]");
  if (tile) placeBet(tile.dataset.dish);
});

els.bettingGrid.addEventListener("contextmenu", (event) => {
  const wrap = event.target.closest("[data-dish-wrap], [data-dish]");
  if (!wrap) return;
  event.preventDefault();
  const id = wrap.dataset.dishWrap || wrap.dataset.dish;
  if (id) removeBet(id);
});

els.chipRack.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-chip]");
  if (!chip || state.rolling || chip.disabled) return;

  state.selectedChip = Number(chip.dataset.chip);
  setNotice("notice.chipLevel", { amount: state.selectedChip });
  saveState();
  render();
});

document.querySelectorAll(".lang-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.lang === state.lang) return;
    setLang(btn.dataset.lang);
  });
});

els.rollButton.addEventListener("click", rollRound);
els.rebetButton.addEventListener("click", rebetLast);
els.clearButton.addEventListener("click", clearBets);
els.resetButton.addEventListener("click", requestReset);
els.brokeReset.addEventListener("click", requestReset);
els.musicButton.addEventListener("click", toggleMusic);

els.volumeSlider.addEventListener("input", () => {
  state.volume = Number(els.volumeSlider.value) / 100;
  ensureAudio();
  applyVolume();
  saveState();
});

els.rulesButton.addEventListener("click", openRules);
els.rulesModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-modal]")) closeRules();
});
els.confirmModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-confirm]")) closeConfirm();
});
els.confirmCancel.addEventListener("click", closeConfirm);
els.confirmOk.addEventListener("click", resetGame);

document.addEventListener("keydown", (event) => {
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if (event.key === "Escape") {
    if (!els.confirmModal.hidden) {
      closeConfirm();
      return;
    }
    if (!els.rulesModal.hidden) {
      closeRules();
      return;
    }
  }

  if (!els.rulesModal.hidden || !els.confirmModal.hidden) return;
  if (state.rolling) return;

  if (event.key === "?" || (event.shiftKey && event.key === "/")) {
    event.preventDefault();
    openRules();
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    rollRound();
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "c") {
    clearBets();
    return;
  }
  if (key === "r") {
    rebetLast();
    return;
  }

  const chipIndex = Number(event.key) - 1;
  if (chipIndex >= 0 && chipIndex < CHIP_VALUES.length) {
    const value = CHIP_VALUES[chipIndex];
    if (state.wallet >= value) {
      state.selectedChip = value;
      setNotice("notice.chipLevel", { amount: value });
      saveState();
      render();
    }
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.musicOn) {
    clearMusicTimers();
    if (musicState.master && musicState.context) {
      const now = musicState.context.currentTime;
      musicState.master.gain.setTargetAtTime(0, now, 0.05);
    }
  } else if (!document.hidden && state.musicOn) {
    applyVolume();
    clearMusicTimers();
    musicState.tickTimer = window.setInterval(playCasinoTick, MUSIC.stepMs);
  }
});

window.addEventListener("beforeunload", () => {
  stopMusic();
  saveState();
});

/* ---------- Boot ---------- */

loadState();
setLang(state.lang, { persist: false });
