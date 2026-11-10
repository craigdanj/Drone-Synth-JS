# Drone Synth JS

A dependency-free stereo Web Audio instrument for continuous drones. It runs entirely in the browser. The voices are synthesized approximations inspired by acoustic and electronic instruments.

## Try it

Open `index.html` in a modern browser and click **Start mix**. The demo works offline and includes its own copy of the engine. Layer A starts as Tanpura. Enable Layer B to add a second voice, or load one of the three starter mixes under **Mix presets**.

Both layers follow the shared tonic (Sa) and A4 reference. Each layer has its own instrument, octave offset, level, pan, and mute. Use **Edit sound** on a layer to show its companion note, tone controls, and Tanpura editor when applicable. **Reset layer sound** resets those tone controls for the selected layer.

With Tanpura selected, open **Tanpura strings** to edit each string's pitch, fine tuning, level, decay, and jawari (bridge buzz). String 1 follows the companion note by default. Level 0 mutes the string. **Pluck variation** changes timing and strength across four passes of the pattern without changing its nominal cycle length. Set it to 0 for a uniform repeat.

Open **Mix presets** to name and save both layers and their shared tuning. Use **Load** to recall a preset while stopped or playing. Older single-voice presets load into Layer A with Layer B off. Presets are stored locally for this page in the current browser. The hosted demo and offline copy have separate preset collections.

| Voice | Sound |
| --- | --- |
| Tanpura | Four staggered plucks, with a low Sa and a jawari-inspired overtone bloom |
| Sitar Chikari | Faster, brighter plucks with a high Sa and sympathetic ringing |
| Bowed Violin | A higher register with vibrato and bow texture |
| Bowed Cello | A low octave with woody resonances and slow bow movement |
| Shruti Box | Free-reed tones with a soft bellows pulse |
| Harmonium | Warm, slightly detuned reed ranks |
| Pipe Organ | A stable flute-like stop with octave support |
| Ambient Synth | A wide, slowly moving pad |

## Use it in your app

Copy `drone-synth.mjs` into your project and import it from an ES module. Resume a real-time context from a click or tap. This example assumes your page has a button with the ID `start-drone`.

```js
import { DroneSynth } from "./drone-synth.mjs";

const context = new AudioContext();
const trackBus = context.createGain();
trackBus.connect(context.destination);

const drone = new DroneSynth(context, {
  destination: trackBus,
  voice: "tanpura",
  midi: 50, // D3
  tuning: "pa",
  cycle: 4.8,
  room: 0.20,
});

document.querySelector("#start-drone").addEventListener("click", async () => {
  await context.resume();
  drone.start();
});

function switchToCello() {
  drone.setSettings({ voice: "cello", motion: 0.28 });
}

function fadeOut() {
  drone.stop();
}
```

You can pass your DAW's EQ, gain node, or track bus as `destination`. Pass `null` to connect the read-only `output` node yourself. Use one instance per independently mixed layer.

### Use the two-layer mixer

```js
import { DroneMixer } from "./drone-synth.mjs";

const mix = new DroneMixer(context, {
  destination: trackBus,
  midi: 50, // shared D3 tonic
  layers: [
    { voice: "tanpura", volume: 0.65, pan: -0.1 },
    { enabled: true, voice: "cello", octave: -1, volume: 0.35, pan: 0.1 },
  ],
});

// Start both layers together on the audio context clock.
mix.start(context.currentTime + 0.25);
mix.setSettings({ midi: 52 });

const { layers } = mix.getSettings();
layers[1].muted = true;
mix.setSettings({ layers });
```

`DroneMixer` provides `start(when?)`, `stop(when?)`, `active`, `output`, and `dispose()` like `DroneSynth`. Use `getSettings()` for a serializable copy. `setSettings()` accepts a partial mixer update, with both layer entries when changing `layers`. Each layer takes the voice settings below except `midi` and `a4`, which are shared. It also accepts `pan` (−1 to +1), `muted`, and `enabled` (Layer B only). Muting leaves the layer's pattern running so you can bring it back in place. Enabling both layers adds about 3 dB of mix headroom. Use `normalizeDroneMix(saved)` to validate a mix or migrate a saved single-voice settings object.

### Settings

The constructor accepts the settings below alongside the optional `destination`. `setSettings(patch)` accepts a partial settings object and returns the updated settings. `getSettings()` returns a plain copy you can save as JSON.

| Setting | Values | Default |
| --- | --- | --- |
| `voice` | `tanpura`, `sitar`, `violin`, `cello`, `shruti`, `harmonium`, `pipe`, `ambient` | `tanpura` |
| `midi` | Integer MIDI tonic, 36–72 (C2–C5) | 48 (C3) |
| `octave` | Offset relative to tonic, −1, 0, or +1 | 0 |
| `tuning` | `pa` (3/2), `ma` (4/3), `ni` (15/8), `sa` (unison) | `pa` |
| `a4` | Concert A reference, 415–466 Hz | 440 |
| `cycle` | 2–8 seconds per nominal pluck sequence | 4.4 |
| `brightness` | 0–1, low-pass cutoff | 0.64 |
| `motion` | 0–1, modulation depth | 0.46 |
| `room` | 0–1, stereo room blend | 0.22 |
| `volume` | 0–1, output level | 0.65 |
| `pluckVariation` | 0–1, Tanpura timing and strength variation | 0.35 |
| `tanpuraStrings` | Four Tanpura string settings in pluck order | Follow companion, Sa, Sa, Low Sa |

The tonic uses equal-tempered MIDI pitch against the selected A4 reference. The companion uses the ratio listed above, with its octave chosen by the voice. Sa only keeps tonic and octave layers for strings that follow the companion choice. Changing voice, tuning, A4, tonic, or the pluck cycle rebuilds and crossfades the playing voice. The other controls smooth changes in place. Pluck cycle has an effect on Tanpura and Sitar Chikari.

Each Tanpura string accepts `pitch` (`companion`, `tonic`, `low`, `high`, `pa`, `ma`, or `ni`), `cents` (−50 to +50), `level` (0–1), `decay` (0.4–2.4 seconds), and `jawari` (0–1). The fixed Pa, Ma, and Ni options use the lower register and are independent of the shared companion choice. Omitted properties fall back to that string's defaults. Pass all four entries to change a single string and preserve the others.

```js
const { tanpuraStrings } = drone.getSettings();
tanpuraStrings[0] = { ...tanpuraStrings[0], pitch: "ma", jawari: 0.72 };
drone.setSettings({ tanpuraStrings, pluckVariation: 0.25 });
```

String and variation edits rebuild the playing Tanpura pattern with a short crossfade. The variation is deterministic, so the same settings produce the same four-cycle pattern when rendered again.

### Playback

- `start(when?)` starts or schedules one voice. Call `stop()` before starting it again.
- `stop(when?)` starts a short release at the scheduled time. The room tail rings out after the voice releases. Scheduling a stop at or before a pending start cancels that start.
- `active` indicates that a start is held or scheduled. Calling `stop()` clears it when the release is scheduled.
- `dispose()` disconnects the instrument and ends playback and the room tail immediately. Your audio context stays open.

Times are seconds on the supplied audio context's clock and default to `context.currentTime`. Use an `OfflineAudioContext` with the same API for a DAW bounce. Allow extra render time for the 220 ms release and room tail. For example, call `drone.start(0)` and `drone.stop(8)` before rendering a ten-second buffer.

The module also exports `DRONE_DEFAULTS`, `DRONE_VOICES`, `DRONE_TUNINGS`, `TANPURA_PITCHES`, and `TANPURA_STRING_RANGES`. Call `normalizeDroneSettings(settings)` to validate a saved preset and fill in missing defaults without creating an audio context.

## Synthesis

The plucked voices use additive partials with different decay rates, a delayed high-frequency bloom, and softly detuned sympathetic partials. Their decays wrap through the loop boundary, and native buffer looping keeps the pattern running without timer-driven retriggering. Sustained voices use custom periodic waves, body filters, and, where appropriate, filtered bow or breath noise. A short synthesized stereo impulse supplies the shared room effect.

The jawari-inspired envelope takes its cue from the evolving overtones described in Van Walstijn and Chatziioannou's [Numerical Simulation of Tanpura String Vibrations](https://pure.qub.ac.uk/en/publications/numerical-simulation-of-tanpura-string-vibrations/).
