const VOICES = {
  tanpura: { name: "Tanpura", kind: "pluck", description: "Four overlapping plucks with a blooming jawari-like buzz." },
  sitar: { name: "Sitar Chikari", kind: "pluck", description: "A bright repeating drone with a sympathetic shimmer." },
  violin: { name: "Bowed Violin", kind: "sustain", description: "A high, singing double stop with light bow texture." },
  cello: { name: "Bowed Cello", kind: "sustain", description: "A low octave drone with a woody body and a slow bow." },
  shruti: { name: "Shruti Box", kind: "sustain", description: "A free-reed drone with gentle bellows movement." },
  harmonium: { name: "Harmonium", kind: "sustain", description: "Two slightly detuned reed ranks with a warm octave." },
  pipe: { name: "Pipe Organ", kind: "sustain", description: "A steady flute stop with a low supporting octave." },
  ambient: { name: "Ambient Synth", kind: "sustain", description: "Wide, slow-moving octaves with soft overtones." },
};

export const DRONE_VOICES = Object.freeze(Object.fromEntries(
  Object.entries(VOICES).map(([id, voice]) => [id, Object.freeze({ ...voice })]),
));

export const DRONE_TUNINGS = Object.freeze({
  pa: Object.freeze({ name: "Sa + Pa", ratio: 3 / 2 }),
  ma: Object.freeze({ name: "Sa + Ma", ratio: 4 / 3 }),
  ni: Object.freeze({ name: "Sa + Ni", ratio: 15 / 8 }),
  sa: Object.freeze({ name: "Sa only", ratio: 1 }),
});

export const TANPURA_PITCHES = Object.freeze({
  companion: "Follow companion", tonic: "Sa", low: "Low Sa", high: "High Sa",
  pa: "Low Pa", ma: "Low Ma", ni: "Low Ni",
});

export const TANPURA_STRING_RANGES = Object.freeze({
  cents: Object.freeze({ min: -50, max: 50, step: 0.1 }),
  level: Object.freeze({ min: 0, max: 1, step: 0.01 }),
  decay: Object.freeze({ min: 0.4, max: 2.4, step: 0.01 }),
  jawari: Object.freeze({ min: 0, max: 1, step: 0.01 }),
});

const TANPURA_STRINGS = Object.freeze([
  Object.freeze({ pitch: "companion", cents: -0.7, level: 0.80, decay: 1.42, jawari: 0.54 }),
  Object.freeze({ pitch: "tonic", cents: 1.1, level: 0.96, decay: 1.42, jawari: 0.54 }),
  Object.freeze({ pitch: "tonic", cents: -1.5, level: 0.89, decay: 1.42, jawari: 0.54 }),
  Object.freeze({ pitch: "low", cents: 0.1, level: 1, decay: 1.42, jawari: 0.54 }),
]);

export const DRONE_DEFAULTS = Object.freeze({
  voice: "tanpura", midi: 48, octave: 0, tuning: "pa", a4: 440, cycle: 4.4,
  brightness: 0.64, motion: 0.46, room: 0.22, volume: 0.65,
  pluckVariation: 0.35, tanpuraStrings: TANPURA_STRINGS,
});

const TAU = 2 * Math.PI;
const FADE = 0.095;
const PLUCK_RATE = 24000;
const VOLUME = 0.64;
const prepareVoice = Symbol("prepareVoice");
const scheduleVoice = Symbol("scheduleVoice");

function copySettings(settings) {
  return { ...settings, tanpuraStrings: settings.tanpuraStrings.map(string => ({ ...string })) };
}

function sameStrings(first, second) {
  return first === second || first.every((string, index) => Object.keys(string).every(
    key => string[key] === second[index][key],
  ));
}

export function normalizeDroneSettings(settings = {}) {
  return copySettings(checkedSettings(DRONE_DEFAULTS, settings));
}

function checkedStrings(strings) {
  if (!Array.isArray(strings) || strings.length !== TANPURA_STRINGS.length) {
    throw new RangeError("Tanpura needs exactly four string settings");
  }
  return Array.from(strings, (string, index) => {
    const label = `Tanpura string ${index + 1}`;
    if (!string || typeof string !== "object" || Array.isArray(string)) {
      throw new TypeError(`${label} settings must be an object`);
    }
    for (const key of Object.keys(string)) {
      if (!Object.hasOwn(TANPURA_STRINGS[index], key)) throw new TypeError(`Unknown string setting: ${key}`);
    }
    const result = { ...TANPURA_STRINGS[index], ...string };
    if (!Object.hasOwn(TANPURA_PITCHES, result.pitch)) throw new RangeError(`${label} has an unknown pitch`);
    for (const [key, { min, max }] of Object.entries(TANPURA_STRING_RANGES)) {
      if (!Number.isFinite(result[key]) || result[key] < min || result[key] > max) {
        throw new RangeError(`${label} ${key} must be between ${min} and ${max}`);
      }
    }
    return result;
  });
}

function checkedSettings(previous, changes) {
  if (changes === null || typeof changes !== "object" || Array.isArray(changes)) {
    throw new TypeError("Drone settings must be an object");
  }
  for (const key of Object.keys(changes)) {
    if (!Object.hasOwn(DRONE_DEFAULTS, key)) throw new TypeError(`Unknown drone setting: ${key}`);
  }
  const next = { ...previous, ...changes };
  if (!Object.hasOwn(VOICES, next.voice)) throw new RangeError("Unknown drone voice");
  if (!Object.hasOwn(DRONE_TUNINGS, next.tuning)) throw new RangeError("Unknown drone tuning");
  for (const [key, min, max] of [
    ["midi", 36, 72], ["a4", 415, 466], ["cycle", 2, 8],
    ["brightness", 0, 1], ["motion", 0, 1], ["room", 0, 1], ["volume", 0, 1],
    ["pluckVariation", 0, 1],
  ]) {
    if (!Number.isFinite(next[key]) || next[key] < min || next[key] > max) {
      throw new RangeError(`${key} must be between ${min} and ${max}`);
    }
  }
  if (!Number.isInteger(next.midi)) throw new RangeError("midi must be an integer");
  if (![-1, 0, 1].includes(next.octave)) throw new RangeError("octave must be -1, 0, or 1");
  if (Object.hasOwn(changes, "tanpuraStrings")) next.tanpuraStrings = checkedStrings(changes.tanpuraStrings);
  return next;
}

function noise(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 2147483648 - 1;
  };
}

function soften(parameter, value, time) {
  parameter.setTargetAtTime(value, time, 0.035);
}

function filter(context, type, frequency, q) {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = Math.min(frequency, context.sampleRate * 0.46);
  node.Q.value = q;
  return node;
}

function roomImpulse(context) {
  const length = Math.ceil(context.sampleRate * 1.45);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel);
    const random = noise(13507 + channel * 597);
    let warm = 0;
    const preDelay = Math.round(context.sampleRate * (0.014 + channel * 0.003));
    for (let i = preDelay; i < length; i++) {
      warm = 0.69 * warm + 0.31 * random();
      samples[i] = warm * Math.exp(-6 * (i - preDelay) / length);
    }
  }
  return impulse;
}

const PLUCKS = {
  tanpura: {
    position: 0.235, bloom: 0.72, spread: 0.36, level: 0.47,
    // Nominal phase within the cycle and stereo position for each string.
    placement: [[0, -0.62], [0.24, -0.22], [0.47, 0.37], [0.68, 0.16]],
  },
  sitar: {
    position: 0.135, decay: 0.78, shine: 0.87, bloom: 0.52, spread: 1, level: 0.39,
    events: [
      [0, "tonic", 0.91, -0.24, 0.3],
      [0.18, "high", 0.65, 0.61, 0.8],
      [0.37, "companion", 0.77, -0.56, -0.7],
      [0.55, "tonic", 0.86, 0.24, -0.9],
      [0.72, "high", 0.62, 0.56, 0.2],
      [0.83, "companion", 0.72, -0.42, 1.3],
    ],
  },
};

function addPartial(left, right, length, tail, shape) {
  const { frequency, amplitude, decay, bloom, pan, phase } = shape;
  if (frequency >= PLUCK_RATE * 0.44) return;
  const step = TAU * frequency / PLUCK_RATE;
  const rotation = 2 * Math.cos(step);
  let wave = Math.sin(phase);
  let prior = Math.sin(phase - step);
  const loss = Math.exp(-1 / (PLUCK_RATE * decay));
  const bloomRate = Math.exp(-1 / (PLUCK_RATE * 0.093));
  const leftGain = Math.sqrt((1 - pan) / 2);
  const rightGain = Math.sqrt((1 + pan) / 2);
  let envelope = amplitude;
  let bloomEnvelope = 1;

  for (let i = 0; i < length; i++) {
    const edge = Math.min(1, i / 100, (length - 1 - i) / tail);
    const sample = wave * envelope * (1 - bloom * bloomEnvelope) * edge;
    left[i] += sample * leftGain;
    right[i] += sample * rightGain;

    const next = rotation * wave - prior;
    prior = wave;
    wave = next;
    envelope *= loss;
    bloomEnvelope *= bloomRate;
  }
}

function renderPluck(voice, event, fundamental, ring, random, maxLength) {
  const { level, pan, decay, jawari } = event;
  const tail = Math.round(0.16 * PLUCK_RATE);
  const ringLength = Math.round(2.75 * PLUCK_RATE);
  const length = Math.max(ringLength, Math.round(Math.min(decay * 4.2, maxLength) * PLUCK_RATE));
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const strike = 1 + 0.09 * random();
  for (let harmonic = 1; harmonic <= 34; harmonic++) {
    const frequency = fundamental * harmonic * Math.sqrt(1 + 0.000024 * harmonic ** 2);
    const pluckShape = Math.sin(Math.PI * harmonic * voice.position) / Math.sin(Math.PI * voice.position);
    const body = 0.70 + 0.46 * Math.exp(-(((frequency - 320) / 160) ** 2))
      + 0.31 * Math.exp(-(((frequency - 1180) / 420) ** 2));
    const buzz = harmonic > 3 ? jawari * (0.82 + 0.18 * Math.cos(harmonic * 2.24)) : 0;
    const amplitude = voice.level * level * strike * body * (pluckShape + buzz) / harmonic ** 0.99;
    const partialDecay = decay / harmonic ** 0.49;
    const partialLength = Math.round(Math.min(partialDecay * 4.2, maxLength) * PLUCK_RATE);
    addPartial(left, right, partialLength, tail, {
      frequency, amplitude, decay: partialDecay, pan,
      phase: harmonic * 0.24 + 0.30 * random(),
      bloom: harmonic > 3 ? voice.bloom * Math.min(1, jawari / 0.54) : 0,
    });
  }
  for (const [index, frequency] of [...new Set(ring)].entries()) {
    addPartial(left, right, ringLength, tail, {
      frequency: frequency * (1 + 0.00065 * random()),
      amplitude: level * 0.052 * voice.spread / (1 + 0.15 * index),
      decay: 0.86, bloom: 0.97, pan: -pan, phase: random() * Math.PI,
    });
  }
  return { left, right };
}

function pluckCycle(context, settings, tonic, interval) {
  const voice = PLUCKS[settings.voice];
  const isTanpura = settings.voice === "tanpura";
  const variation = isTanpura ? settings.pluckVariation : 0;
  const cycleFrames = Math.round(PLUCK_RATE * settings.cycle);
  // Reuse each synthesized strike, then vary its placement and level over four passes.
  const cycles = variation > 0 ? 4 : 1;
  const frames = cycleFrames * cycles;
  const buffer = context.createBuffer(2, frames, PLUCK_RATE);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const ratios = {
    low: 0.5, tonic: 1, high: 2, companion: interval === 1 ? 1 : interval / 2,
    pa: DRONE_TUNINGS.pa.ratio / 2, ma: DRONE_TUNINGS.ma.ratio / 2, ni: DRONE_TUNINGS.ni.ratio / 2,
  };
  const events = isTanpura
    ? voice.placement.map(([phase, pan], index) => ({ ...settings.tanpuraStrings[index], phase, pan }))
    : voice.events.map(([phase, pitch, level, pan, cents]) => ({
      phase, pitch, level, pan, cents, decay: voice.decay, jawari: voice.shine,
    }));
  const ring = [tonic, tonic * interval, tonic * 2, tonic * 3, tonic * 4];
  const sitarNoise = noise(15753);
  for (const [index, event] of events.entries()) {
    if (event.level === 0) continue;
    const fundamental = tonic * ratios[event.pitch] * 2 ** (event.cents / 1200);
    const strikeNoise = isTanpura ? noise(15753 + index * 2087) : sitarNoise;
    const strike = renderPluck(voice, event, fundamental, ring, strikeNoise, isTanpura ? 8 : 5.5);
    const performanceNoise = noise(90283 + index * 7919);
    for (let cycle = 0; cycle < cycles; cycle++) {
      const timing = performanceNoise() * 0.085 * variation * PLUCK_RATE;
      const gain = 1 + performanceNoise() * 0.14 * variation;
      const start = Math.round((cycle + event.phase) * cycleFrames + timing);
      let frame = (start + frames) % frames;
      for (let i = 0; i < strike.left.length; i++) {
        left[frame] += strike.left[i] * gain;
        right[frame] += strike.right[i] * gain;
        if (++frame === frames) frame = 0;
      }
    }
  }
  // Wrapped decays make the end of the cycle flow into the next pluck.
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const scale = 0.72 / Math.max(0.72, peak);
  for (let i = 0; i < frames; i++) {
    left[i] *= scale;
    right[i] *= scale;
  }
  return buffer;
}

const BOW_VIOLIN = [1, 0.76, 0.58, 0.26, 0.31, 0.22, 0.16, 0.09, 0.12, 0.065, 0.04];
const BOW_CELLO = [1, 0.59, 0.38, 0.31, 0.17, 0.12, 0.11, 0.09, 0.04, 0.026];
const REED = [1, 0.49, 0.54, 0.22, 0.26, 0.14, 0.17, 0.07, 0.09, 0.05];
const FLUTE = [1, 0.12, 0.17, 0.037, 0.035, 0.018];
const PAD = [1, 0.24, 0.28, 0.09, 0.14, 0.056, 0.05];
const SUSTAINS = {
  // Tone tuples hold ratio, gain, stereo pan and detune in cents.
  violin: { harmonics: BOW_VIOLIN, tones: [[2, 0.26, -0.26, 0], ["interval", 0.16, 0.30, -2], [2, 0.052, 0.66, 4]], pitchRate: 4.9, cents: 9, swell: 0.24, breath: [2100, 0.040], body: [[490, 2, 1.8], [2500, 3, 2.1]] },
  cello: { harmonics: BOW_CELLO, tones: [[1, 0.26, -0.21, 0], [0.5, 0.20, 0.16, 0], ["interval", 0.105, 0.53, 2]], pitchRate: 3.6, cents: 6, swell: 0.22, breath: [730, 0.055], body: [[225, 2, 3.1], [620, 2, 1.8]] },
  shruti: { harmonics: REED, tones: [[1, 0.26, -0.15, 0], ["interval", 0.18, 0.17, 1], [0.5, 0.12, 0.04, 0]], pitchRate: 0.68, cents: 1.4, swell: 0.22, breath: [980, 0.015], body: [[820, 2, 1.6]] },
  harmonium: { harmonics: REED, tones: [[1, 0.23, -0.45, -2], [1, 0.14, 0.43, 4], ["interval", 0.15, 0.1, 0], [2, 0.10, 0.19, -1]], pitchRate: 0.42, cents: 2.1, swell: 0.20, breath: [1250, 0.020], body: [[1160, 2, 2.0]] },
  pipe: { harmonics: FLUTE, tones: [[1, 0.25, -0.31, 0], [0.5, 0.22, 0.12, 0], ["interval", 0.11, 0.28, 0], [2, 0.07, -0.14, 0]], pitchRate: 0.24, cents: 1, swell: 0.09, breath: [1550, 0.025], body: [] },
  ambient: { harmonics: PAD, tones: [[1, 0.22, -0.55, -7], [1, 0.22, 0.55, 7], ["interval", 0.17, 0.17, 1], [0.5, 0.16, 0, 0], [2, 0.092, -0.15, 2]], pitchRate: 0.29, cents: 5, swell: 0.48, breath: null, body: [] },
};

function voiceGraph(context, input, settings, attack) {
  const nodes = [];
  const sources = [];
  const use = node => { nodes.push(node); return node; };
  const source = node => { sources.push(node); return use(node); };
  const amp = use(context.createGain());
  const tone = use(filter(context, "lowpass", 20000, 0.3));
  const swell = use(context.createGain());
  amp.gain.value = 0;
  amp.connect(input);
  tone.connect(amp);
  swell.connect(tone);

  const tonic = settings.a4 * 2 ** ((settings.midi + 12 * settings.octave - 69) / 12);
  const interval = DRONE_TUNINGS[settings.tuning].ratio;
  const isPluck = VOICES[settings.voice].kind === "pluck";
  const voice = SUSTAINS[settings.voice];
  const swellDepth = use(context.createGain());
  const amplitudeLfo = source(context.createOscillator());
  let pitchDepth;
  const wobble = isPluck ? 0.095 : voice.swell;
  amplitudeLfo.frequency.value = isPluck ? 0.21 : 0.27 + voice.pitchRate * 0.08;
  amplitudeLfo.connect(swellDepth).connect(swell.gain);
  swell.gain.value = 1 - wobble * 0.55;

  if (isPluck) {
    const loop = source(context.createBufferSource());
    loop.buffer = pluckCycle(context, settings, tonic, interval);
    loop.loop = true;
    loop.connect(swell);
  } else {
    let bodyInput = swell;
    for (const [frequency, q, gain] of voice.body) {
      const resonance = use(filter(context, "peaking", frequency, q));
      resonance.gain.value = gain;
      resonance.connect(bodyInput);
      bodyInput = resonance;
    }
    const imaginary = Float32Array.of(0, ...voice.harmonics);
    const wave = context.createPeriodicWave(new Float32Array(imaginary.length), imaginary);
    pitchDepth = use(context.createGain());
    const pitchLfo = source(context.createOscillator());
    pitchLfo.frequency.value = voice.pitchRate;
    pitchLfo.connect(pitchDepth);

    for (const [ratio, level, pan, cents] of voice.tones) {
      const oscillator = source(context.createOscillator());
      const levelNode = use(context.createGain());
      const panner = use(context.createStereoPanner());
      oscillator.setPeriodicWave(wave);
      oscillator.frequency.value = tonic * (ratio === "interval" ? interval : ratio);
      oscillator.detune.value = cents;
      levelNode.gain.value = level;
      panner.pan.value = pan;
      pitchDepth.connect(oscillator.detune);
      oscillator.connect(levelNode).connect(panner).connect(bodyInput);
    }

    if (voice.breath) {
      const [frequency, level] = voice.breath;
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const samples = buffer.getChannelData(0);
      const random = noise(28113);
      for (let i = 0; i < samples.length; i++) samples[i] = random();
      const texture = source(context.createBufferSource());
      const band = use(filter(context, "bandpass", frequency, 0.85));
      const levelNode = use(context.createGain());
      levelNode.gain.value = level;
      texture.buffer = buffer;
      texture.loop = true;
      texture.connect(band).connect(levelNode).connect(bodyInput);
    }
  }

  function shape(parameters, time, immediate = false) {
    const cutoff = 360 * 37 ** parameters.brightness;
    const values = [
      [tone.frequency, Math.min(cutoff, context.sampleRate * 0.46)],
      [swellDepth.gain, wobble * parameters.motion],
    ];
    if (pitchDepth) values.push([pitchDepth.gain, voice.cents * parameters.motion]);
    for (const [parameter, value] of values) {
      if (immediate) parameter.value = value;
      else soften(parameter, value, time);
    }
  }

  shape(settings, context.currentTime, true);
  let when;
  let stopTime = Infinity;
  return {
    get when() { return when; },
    start(time) {
      when = time;
      amp.gain.setValueAtTime(0, when);
      amp.gain.linearRampToValueAtTime(1, when + attack);
      for (const node of sources) node.start(when);
    },
    shape,
    release(time, duration, onEnded) {
      if (time >= stopTime) return;
      // Start from the value the attack envelope has at the release time.
      const level = Math.max(0, Math.min(1, (time - when) / attack));
      amp.gain.cancelScheduledValues(time);
      amp.gain.linearRampToValueAtTime(level, time);
      amp.gain.linearRampToValueAtTime(0, time + duration);
      stopTime = time + duration;
      sources[0].onended = () => {
        for (const node of nodes) node.disconnect();
        onEnded();
      };
      for (const node of sources) node.stop(stopTime);
    },
    dispose() {
      const now = context.currentTime;
      sources[0].onended = null;
      if (when !== undefined && now < stopTime) for (const node of sources) node.stop(now);
      for (const node of nodes) node.disconnect();
    },
  };
}

export class DroneSynth {
  #context;
  #settings;
  #graph;
  #prepared;
  #retiring = new Set();
  #input;
  #dry;
  #wet;
  #room;
  #output;
  #disposed = false;

  constructor(context, { destination = context.destination, ...settings } = {}) {
    this.#settings = checkedSettings(DRONE_DEFAULTS, settings);
    this.#context = context;
    this.#input = context.createGain();
    this.#dry = context.createGain();
    this.#wet = context.createGain();
    this.#room = context.createConvolver();
    this.#room.buffer = roomImpulse(context);
    this.#output = context.createGain();
    this.#input.connect(this.#dry).connect(this.#output);
    this.#input.connect(this.#room).connect(this.#wet).connect(this.#output);
    if (destination !== null) this.#output.connect(destination);
    this.#mix(this.#settings, true);
  }

  get output() { return this.#output; }
  get active() { return Boolean(this.#graph); }

  getSettings() { return copySettings(this.#settings); }

  #assertOpen() {
    if (this.#disposed) throw new Error("DroneSynth has been disposed");
  }

  #time(when) {
    if (!Number.isFinite(when) || when < 0) throw new RangeError("Time must be nonnegative seconds");
    return Math.max(when, this.#context.currentTime);
  }

  #mix(settings, immediate = false) {
    const now = this.#context.currentTime;
    for (const [parameter, value] of [
      [this.#dry.gain, 1 - 0.25 * settings.room],
      [this.#wet.gain, 0.65 * settings.room],
      [this.#output.gain, VOLUME * settings.volume],
    ]) {
      if (immediate) parameter.value = value;
      else soften(parameter, value, now);
    }
  }

  #retire(graph, time, fade) {
    this.#retiring.add(graph);
    graph.release(time, fade, () => this.#retiring.delete(graph));
  }

  setSettings(changes) {
    this.#assertOpen();
    const next = checkedSettings(this.#settings, changes);
    const now = this.#context.currentTime;
    const previousSettings = this.#settings;
    const rebuild = ["voice", "midi", "octave", "tuning", "a4"].some(key => next[key] !== previousSettings[key])
      || (VOICES[next.voice].kind === "pluck" && next.cycle !== previousSettings.cycle)
      || (next.voice === "tanpura" && (next.pluckVariation !== previousSettings.pluckVariation
        || !sameStrings(next.tanpuraStrings, previousSettings.tanpuraStrings)));

    if (this.#graph && rebuild) {
      const previous = this.#graph;
      const replacement = voiceGraph(this.#context, this.#input, next, FADE);
      replacement.start(Math.max(this.#context.currentTime, previous.when));
      this.#graph = replacement;
      if (previous.when >= replacement.when) previous.dispose();
      else this.#retire(previous, replacement.when, FADE);
    } else {
      this.#graph?.shape(next, now);
    }
    if (rebuild && this.#prepared) {
      this.#prepared.dispose();
      this.#prepared = undefined;
    } else {
      this.#prepared?.shape(next, now, true);
    }

    this.#mix(next);
    this.#settings = next;
    return this.getSettings();
  }

  [prepareVoice]() {
    this.#assertOpen();
    if (this.#graph || this.#prepared) return;
    const plucked = VOICES[this.#settings.voice].kind === "pluck";
    this.#prepared = voiceGraph(this.#context, this.#input, this.#settings, plucked ? 0.014 : 0.21);
  }

  [scheduleVoice](time) {
    this.#graph = this.#prepared;
    this.#prepared = undefined;
    this.#graph.start(time);
  }

  start(when = this.#context.currentTime) {
    this.#assertOpen();
    const time = this.#time(when);
    if (this.#graph) return this;
    this[prepareVoice]();
    this[scheduleVoice](this.#time(time));
    return this;
  }

  stop(when = this.#context.currentTime) {
    this.#assertOpen();
    const time = this.#time(when);
    if (!this.#graph) return this;
    const graph = this.#graph;
    this.#graph = undefined;
    if (time <= graph.when) graph.dispose();
    else this.#retire(graph, time, 0.22);
    return this;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#prepared?.dispose();
    this.#prepared = undefined;
    this.#graph?.dispose();
    this.#graph = undefined;
    for (const graph of this.#retiring) graph.dispose();
    this.#retiring.clear();
    for (const node of [this.#input, this.#dry, this.#wet, this.#room, this.#output]) node.disconnect();
  }
}

function normalizeLayer(layer, index) {
  if (!layer || typeof layer !== "object" || Array.isArray(layer)) throw new TypeError("Layer settings must be an object");
  if (Object.hasOwn(layer, "midi") || Object.hasOwn(layer, "a4")) throw new TypeError("The mixer shares MIDI tonic and A4");
  const { enabled = index === 0, muted = false, pan = 0, ...patch } = layer;
  if (typeof enabled !== "boolean" || typeof muted !== "boolean") throw new TypeError("Layer enabled and muted must be booleans");
  if (index === 0 && !enabled) throw new RangeError("Use mute to silence Layer A");
  if (!Number.isFinite(pan) || pan < -1 || pan > 1) throw new RangeError("Layer pan must be between -1 and 1");
  const defaults = index === 0 ? {} : { voice: "cello", octave: -1, volume: 0.35, tuning: "sa" };
  const { midi, a4, ...voice } = normalizeDroneSettings({ ...defaults, ...patch });
  return { ...voice, enabled, muted, pan };
}

export function normalizeDroneMix(settings = {}) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new TypeError("Mixer settings must be an object");
  if (!Object.hasOwn(settings, "layers")) {
    const { midi, a4, ...voice } = normalizeDroneSettings(settings);
    return { midi, a4, layers: [normalizeLayer(voice, 0), normalizeLayer({}, 1)] };
  }
  const { layers, ...shared } = settings;
  for (const key of Object.keys(shared)) {
    if (key !== "midi" && key !== "a4") throw new TypeError(`Unknown mixer setting: ${key}`);
  }
  if (!Array.isArray(layers) || layers.length !== 2) throw new RangeError("The mixer needs exactly two layers");
  const { midi, a4 } = normalizeDroneSettings(shared);
  return { midi, a4, layers: [normalizeLayer(layers[0], 0), normalizeLayer(layers[1], 1)] };
}

function layerVoice({ enabled, muted, pan, ...patch }, { midi, a4 }) {
  return { ...patch, midi, a4 };
}

export class DroneMixer {
  #context;
  #settings;
  #output;
  #tracks;
  #startTime;
  #disposed = false;

  constructor(context, { destination = context.destination, ...settings } = {}) {
    this.#context = context;
    this.#settings = normalizeDroneMix(settings);
    this.#output = context.createGain();
    this.#output.gain.value = this.#settings.layers[1].enabled ? Math.SQRT1_2 : 1;
    this.#tracks = this.#settings.layers.map(layer => {
      const gate = context.createGain();
      const panner = context.createStereoPanner();
      gate.gain.value = Number(layer.enabled && !layer.muted);
      panner.pan.value = layer.pan;
      gate.connect(panner).connect(this.#output);
      const synth = new DroneSynth(context, { ...layerVoice(layer, this.#settings), destination: gate });
      return { gate, panner, synth };
    });
    if (destination !== null) this.#output.connect(destination);
  }

  get output() { return this.#output; }
  get active() { return this.#startTime !== undefined; }
  getSettings() { return normalizeDroneMix(this.#settings); }

  #assertOpen() {
    if (this.#disposed) throw new Error("DroneMixer has been disposed");
  }

  #time(when) {
    if (!Number.isFinite(when) || when < 0) throw new RangeError("Time must be nonnegative seconds");
    return Math.max(when, this.#context.currentTime);
  }

  setSettings(changes) {
    this.#assertOpen();
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new TypeError("Mixer settings must be an object");
    const next = normalizeDroneMix({ ...this.#settings, ...changes });
    for (const [index, track] of this.#tracks.entries()) {
      const layer = next.layers[index];
      const previous = this.#settings.layers[index];
      if (!layer.enabled && track.synth.active) track.synth.stop();
      const nextVoice = layerVoice(layer, next);
      const previousVoice = layerVoice(previous, this.#settings);
      const patch = Object.fromEntries(Object.entries(nextVoice).filter(([key, value]) => key === "tanpuraStrings"
        ? !sameStrings(value, previousVoice[key])
        : value !== previousVoice[key]));
      if (Object.keys(patch).length) track.synth.setSettings(patch);
      const now = this.#context.currentTime;
      if (layer.pan !== previous.pan) soften(track.panner.pan, layer.pan, now);
      if (layer.enabled !== previous.enabled || layer.muted !== previous.muted) {
        soften(track.gate.gain, Number(layer.enabled && !layer.muted), now);
      }
      if (this.active && layer.enabled && !track.synth.active) track.synth.start(this.#startTime);
    }
    if (next.layers[1].enabled !== this.#settings.layers[1].enabled) {
      soften(this.#output.gain, next.layers[1].enabled ? Math.SQRT1_2 : 1, this.#context.currentTime);
    }
    this.#settings = next;
    return this.getSettings();
  }

  start(when = this.#context.currentTime) {
    this.#assertOpen();
    const time = this.#time(when);
    if (this.active) return this;
    const layers = this.#tracks.filter((_, index) => this.#settings.layers[index].enabled);
    for (const { synth } of layers) synth[prepareVoice]();
    this.#startTime = this.#time(time);
    for (const { synth } of layers) synth[scheduleVoice](this.#startTime);
    return this;
  }

  stop(when = this.#context.currentTime) {
    this.#assertOpen();
    const time = this.#time(when);
    for (const { synth } of this.#tracks) synth.stop(time);
    this.#startTime = undefined;
    return this;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#startTime = undefined;
    for (const { synth, gate, panner } of this.#tracks) {
      synth.dispose();
      gate.disconnect();
      panner.disconnect();
    }
    this.#output.disconnect();
  }
}
