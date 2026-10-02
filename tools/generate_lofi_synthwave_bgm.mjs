import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const MUSIC_DIR = path.join(ROOT_DIR, 'public', 'assets', 'audio', 'music');

if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

// ============================================================================
// AUDIO BUFFER & WAV ENCODER
// ============================================================================
class AudioBuffer {
  constructor(numberOfChannels, length, sampleRate = 44100) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channelIndex) {
    return this.channels[channelIndex];
  }
}

function encodeWAV(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = Buffer.alloc(totalSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(totalSize - 8, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const left = audioBuffer.getChannelData(0);
  const right = numChannels > 1 ? audioBuffer.getChannelData(1) : left;

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    let sL = Math.max(-1, Math.min(1, left[i]));
    let sR = Math.max(-1, Math.min(1, right[i]));

    const intL = sL < 0 ? Math.floor(sL * 32768) : Math.floor(sL * 32767);
    const intR = sR < 0 ? Math.floor(sR * 32768) : Math.floor(sR * 32767);

    buffer.writeInt16LE(intL, offset);
    buffer.writeInt16LE(intR, offset + 2);
    offset += 4;
  }

  return buffer;
}

// ============================================================================
// DSP & SYNTHESIS HELPERS
// ============================================================================
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteToFreq(noteStr) {
  if (typeof noteStr === 'number') return noteStr;
  const match = noteStr.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 440;
  const note = match[1];
  const octave = parseInt(match[2], 10);
  const noteIndex = NOTE_NAMES.indexOf(note);
  const midi = (octave + 1) * 12 + noteIndex;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class BiquadFilter {
  constructor(type, fc, q = 0.707, sampleRate = 44100) {
    this.sampleRate = sampleRate;
    this.type = type;
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
    this.setParams(fc, q);
  }

  setParams(fc, q = 0.707) {
    fc = Math.max(20, Math.min(fc, this.sampleRate * 0.49));
    const w0 = 2 * Math.PI * fc / this.sampleRate;
    const cosw0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);

    let b0, b1, b2, a0, a1, a2;
    if (this.type === 'lowpass') {
      b0 = (1 - cosw0) / 2;
      b1 = 1 - cosw0;
      b2 = (1 - cosw0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
    } else if (this.type === 'highpass') {
      b0 = (1 + cosw0) / 2;
      b1 = -(1 + cosw0);
      b2 = (1 + cosw0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
    } else { // default lowpass
      b0 = (1 - cosw0) / 2;
      b1 = 1 - cosw0;
      b2 = (1 - cosw0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
    }

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// Basic Oscillator
function osc(type, freq, t, phase = 0, pulseWidth = 0.5) {
  const p = (t * freq + phase) % 1;
  const pNorm = p < 0 ? p + 1 : p;
  if (type === 'sine') {
    return Math.sin(2 * Math.PI * (t * freq + phase));
  } else if (type === 'triangle') {
    return 4 * Math.abs(pNorm - 0.5) - 1;
  } else if (type === 'square' || type === 'pulse') {
    return pNorm < pulseWidth ? 1 : -1;
  } else if (type === 'saw' || type === 'sawtooth') {
    return 2 * pNorm - 1;
  } else if (type === 'noise') {
    return Math.random() * 2 - 1;
  }
  return 0;
}

// ADSR envelope generator
function getADSR(t, attack, decay, sustain, release, duration) {
  if (t < 0) return 0;
  if (t < attack) {
    return t / attack;
  } else if (t < attack + decay) {
    const progress = (t - attack) / decay;
    return 1.0 - (1.0 - sustain) * progress;
  } else if (t < duration) {
    return sustain;
  } else if (t < duration + release) {
    const progress = (t - duration) / release;
    return sustain * (1.0 - progress);
  }
  return 0;
}

// Add reverb / stereo echo to buffer
function applyDelayAndReverb(buffer, delayTime = 0.35, feedback = 0.3, mix = 0.25) {
  const sr = buffer.sampleRate;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const delaySamplesL = Math.floor(delayTime * sr);
  const delaySamplesR = Math.floor((delayTime * 1.15) * sr);

  const tempL = new Float32Array(left.length);
  const tempR = new Float32Array(right.length);

  for (let i = 0; i < left.length; i++) {
    const prevL = i >= delaySamplesL ? tempL[i - delaySamplesL] : 0;
    const prevR = i >= delaySamplesR ? tempR[i - delaySamplesR] : 0;
    tempL[i] = left[i] + prevR * feedback;
    tempR[i] = right[i] + prevL * feedback;

    left[i] = left[i] * (1 - mix) + tempL[i] * mix;
    right[i] = right[i] * (1 - mix) + tempR[i] * mix;
  }
}

// Master normalization
function normalizeBuffer(buffer, targetPeak = 0.88) {
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let maxPeak = 0;
  for (let i = 0; i < left.length; i++) {
    const absL = Math.abs(left[i]);
    const absR = Math.abs(right[i]);
    if (absL > maxPeak) maxPeak = absL;
    if (absR > maxPeak) maxPeak = absR;
  }
  if (maxPeak > 0) {
    const gain = targetPeak / maxPeak;
    for (let i = 0; i < left.length; i++) {
      left[i] *= gain;
      right[i] *= gain;
    }
  }
}

// ============================================================================
// TRACK 1: mus_lofi_cozy.wav
// Warm lofi chiptune theme with vinyl crackle, cozy chord progressions & gentle synth melody
// ============================================================================
function generateLofiCozy() {
  console.log('Generating Track 1: mus_lofi_cozy.wav...');
  const sampleRate = 44100;
  const bpm = 80;
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const totalBars = 16;
  const totalDuration = barSec * totalBars;
  const numSamples = Math.floor(totalDuration * sampleRate);

  const buffer = new AudioBuffer(2, numSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // 1. Vinyl Crackle Layer
  const vinylFilterL = new BiquadFilter('lowpass', 3500, 0.707, sampleRate);
  const vinylFilterR = new BiquadFilter('lowpass', 3500, 0.707, sampleRate);

  for (let i = 0; i < numSamples; i++) {
    let noiseL = (Math.random() * 2 - 1) * 0.015;
    let noiseR = (Math.random() * 2 - 1) * 0.015;

    // Dust pop / crackle
    if (Math.random() < 0.0006) {
      const pop = (Math.random() * 2 - 1) * 0.12;
      noiseL += pop;
      noiseR += pop * 0.8;
    }
    if (Math.random() < 0.002) {
      const tick = (Math.random() * 2 - 1) * 0.04;
      noiseL += tick * 0.7;
      noiseR += tick;
    }

    left[i] += vinylFilterL.process(noiseL) * 0.7;
    right[i] += vinylFilterR.process(noiseR) * 0.7;
  }

  // 2. Cozy Chords (Fmaj7 -> Em7 -> Dm7 -> Cmaj7)
  const chordProgressions = [
    { notes: ['F3', 'C4', 'E4', 'A4'], bars: 2 },
    { notes: ['E3', 'B3', 'D4', 'G4'], bars: 2 },
    { notes: ['D3', 'A3', 'C4', 'F4'], bars: 2 },
    { notes: ['C3', 'G3', 'B3', 'E4'], bars: 2 },
  ];

  const padFilterL = new BiquadFilter('lowpass', 1200, 0.707, sampleRate);
  const padFilterR = new BiquadFilter('lowpass', 1200, 0.707, sampleRate);

  for (let bar = 0; bar < totalBars; bar += 2) {
    const chordIndex = (bar / 2) % chordProgressions.length;
    const chord = chordProgressions[chordIndex];
    const startTime = bar * barSec;
    const duration = chord.bars * barSec;

    // Strum or hit chord twice per 2 bars
    for (let hit = 0; hit < 4; hit++) {
      const hitTime = startTime + hit * (barSec * 0.5);
      const hitStartSample = Math.floor(hitTime * sampleRate);
      const hitDur = barSec * 0.48;
      const hitSamples = Math.floor(hitDur * sampleRate);

      chord.notes.forEach((noteStr, idx) => {
        const freq = noteToFreq(noteStr);
        const pan = (idx / (chord.notes.length - 1)) * 0.6 - 0.3; // subtle stereo spread

        for (let s = 0; s < hitSamples; s++) {
          const sampleIdx = hitStartSample + s;
          if (sampleIdx >= numSamples) break;

          const t = s / sampleRate;
          const absTime = sampleIdx / sampleRate;
          // LFO wow/flutter (0.3Hz vibrato)
          const wow = 1.0 + Math.sin(2 * Math.PI * 0.35 * absTime) * 0.002;
          const env = getADSR(t, 0.04, 0.3, 0.4, 0.25, hitDur - 0.25);

          // Blend triangle + soft pulse for warm lofi keys
          const wave1 = osc('triangle', freq * wow, t);
          const wave2 = osc('pulse', freq * wow * 1.001, t, 0, 0.35) * 0.3;
          const rawSig = (wave1 + wave2) * env * 0.08;

          left[sampleIdx] += padFilterL.process(rawSig * (0.5 - pan * 0.3));
          right[sampleIdx] += padFilterR.process(rawSig * (0.5 + pan * 0.3));
        }
      });
    }
  }

  // 3. Gentle Chiptune Lead Melody (Game Boy pulse 25% style)
  // Catchy cozy melody in C Major / F Lydian
  const leadMelody = [
    // Bar 1-2
    { note: 'A4', startBeat: 0.5, dur: 1.0 },
    { note: 'C5', startBeat: 1.5, dur: 0.5 },
    { note: 'E5', startBeat: 2.0, dur: 1.5 },
    { note: 'D5', startBeat: 4.0, dur: 1.0 },
    { note: 'C5', startBeat: 5.5, dur: 0.5 },
    { note: 'A4', startBeat: 6.0, dur: 1.5 },

    // Bar 3-4
    { note: 'G4', startBeat: 8.5, dur: 1.0 },
    { note: 'B4', startBeat: 9.5, dur: 0.5 },
    { note: 'D5', startBeat: 10.0, dur: 1.5 },
    { note: 'C5', startBeat: 12.0, dur: 1.0 },
    { note: 'B4', startBeat: 13.5, dur: 0.5 },
    { note: 'G4', startBeat: 14.0, dur: 1.5 },

    // Bar 5-6
    { note: 'F4', startBeat: 16.5, dur: 1.0 },
    { note: 'A4', startBeat: 17.5, dur: 0.5 },
    { note: 'C5', startBeat: 18.0, dur: 1.5 },
    { note: 'E5', startBeat: 20.0, dur: 1.0 },
    { note: 'D5', startBeat: 21.0, dur: 1.0 },
    { note: 'C5', startBeat: 22.0, dur: 1.5 },

    // Bar 7-8
    { note: 'E5', startBeat: 24.5, dur: 0.5 },
    { note: 'D5', startBeat: 25.0, dur: 0.5 },
    { note: 'C5', startBeat: 25.5, dur: 1.0 },
    { note: 'B4', startBeat: 26.5, dur: 1.0 },
    { note: 'C5', startBeat: 28.0, dur: 2.5 },
  ];

  const leadFilterL = new BiquadFilter('lowpass', 2400, 0.707, sampleRate);
  const leadFilterR = new BiquadFilter('lowpass', 2400, 0.707, sampleRate);

  // Play melody across all 16 bars (repeat pattern twice)
  for (let loop = 0; loop < 2; loop++) {
    const loopOffsetBeat = loop * 32;

    leadMelody.forEach(item => {
      const beat = item.startBeat + loopOffsetBeat;
      const noteTime = beat * beatSec;
      const startSample = Math.floor(noteTime * sampleRate);
      const durSec = item.dur * beatSec;
      const durSamples = Math.floor((durSec + 0.2) * sampleRate);
      const freq = noteToFreq(item.note);

      for (let s = 0; s < durSamples; s++) {
        const sampleIdx = startSample + s;
        if (sampleIdx >= numSamples) break;

        const t = s / sampleRate;
        const absTime = sampleIdx / sampleRate;

        // Sweet 5Hz vibrato
        const vibrato = Math.sin(2 * Math.PI * 5.0 * t) * 0.006 * Math.min(1.0, t * 4);
        const curFreq = freq * (1.0 + vibrato);

        // Chiptune pulse wave (25% duty cycle)
        const env = getADSR(t, 0.015, 0.15, 0.6, 0.15, durSec);
        const sig = osc('pulse', curFreq, t, 0, 0.25) * env * 0.09;

        left[sampleIdx] += leadFilterL.process(sig);
        right[sampleIdx] += leadFilterR.process(sig);
      }
    });
  }

  // 4. Warm Bassline (Root notes)
  const bassRoots = ['F2', 'F2', 'E2', 'E2', 'D2', 'D2', 'C2', 'C2'];
  for (let bar = 0; bar < totalBars; bar++) {
    const rootNote = bassRoots[bar % bassRoots.length];
    const freq = noteToFreq(rootNote);

    // Hit bass on beat 0 and beat 2.5
    [0, 2.5].forEach(beatOffset => {
      const startTime = (bar * 4 + beatOffset) * beatSec;
      const dur = 1.2 * beatSec;
      const startSample = Math.floor(startTime * sampleRate);
      const samples = Math.floor(dur * sampleRate);

      for (let s = 0; s < samples; s++) {
        const sampleIdx = startSample + s;
        if (sampleIdx >= numSamples) break;

        const t = s / sampleRate;
        const env = getADSR(t, 0.02, 0.2, 0.5, 0.2, dur);
        // Triangle + sine sub bass
        const sig = (osc('triangle', freq, t) * 0.7 + osc('sine', freq * 0.5, t) * 0.5) * env * 0.2;

        left[sampleIdx] += sig;
        right[sampleIdx] += sig;
      }
    });
  }

  // 5. Soft Lofi Drums (Kick, Rimshot/Snare, Hi-hats)
  const kickFilter = new BiquadFilter('lowpass', 250, 0.707, sampleRate);

  for (let bar = 0; bar < totalBars; bar++) {
    const barStartBeat = bar * 4;

    // Kick pattern: beats 0, 2.5
    [0, 2.5].forEach(b => {
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.25;
      const samples = Math.floor(dur * sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        // Pitch drop from 110Hz to 45Hz
        const pFreq = 45 + (110 - 45) * Math.exp(-t * 35);
        const env = Math.exp(-t * 15);
        const sig = kickFilter.process(osc('sine', pFreq, t) * env * 0.35);

        left[idx] += sig;
        right[idx] += sig;
      }
    });

    // Rimshot / Soft Snare pattern: beats 1, 3
    [1, 3].forEach(b => {
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.18;
      const samples = Math.floor(dur * sampleRate);
      const snareFilter = new BiquadFilter('highpass', 800, 0.707, sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const body = osc('triangle', 180, t) * Math.exp(-t * 30);
        const snap = snareFilter.process(osc('noise', 0, t)) * Math.exp(-t * 22);
        const sig = (body * 0.3 + snap * 0.25);

        left[idx] += sig * 0.85;
        right[idx] += sig * 1.15; // wide snare pan
      }
    });

    // Soft Hi-hats: 8th notes
    for (let h = 0; h < 8; h++) {
      const b = h * 0.5;
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.06;
      const samples = Math.floor(dur * sampleRate);
      const hatFilter = new BiquadFilter('highpass', 4500, 0.707, sampleRate);
      const accent = (h % 2 === 0) ? 0.08 : 0.05;

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const sig = hatFilter.process(osc('noise', 0, t)) * Math.exp(-t * 60) * accent;

        left[idx] += sig * 0.9;
        right[idx] += sig * 1.1;
      }
    }
  }

  // Apply stereo delay & normalize
  applyDelayAndReverb(buffer, 0.375, 0.28, 0.2);
  normalizeBuffer(buffer, 0.88);

  const wavData = encodeWAV(buffer);
  const outPath = path.join(MUSIC_DIR, 'mus_lofi_cozy.wav');
  fs.writeFileSync(outPath, wavData);
  console.log(`Saved: ${outPath} (${(wavData.length / 1024 / 1024).toFixed(2)} MB)`);
}

// ============================================================================
// TRACK 2: mus_synthwave_sunset.wav
// Retrowave 80s synthwave beat with analog basslines & lush pads
// ============================================================================
function generateSynthwaveSunset() {
  console.log('Generating Track 2: mus_synthwave_sunset.wav...');
  const sampleRate = 44100;
  const bpm = 108;
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const totalBars = 20;
  const totalDuration = barSec * totalBars;
  const numSamples = Math.floor(totalDuration * sampleRate);

  const buffer = new AudioBuffer(2, numSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // 1. Lush Retrowave Detuned Saw Pads (Am -> F -> C -> G)
  const padChords = [
    { name: 'Am', root: 'A2', notes: ['A3', 'C4', 'E4', 'G4'] },
    { name: 'F',  root: 'F2', notes: ['F3', 'A3', 'C4', 'E4'] },
    { name: 'C',  root: 'C2', notes: ['C3', 'E3', 'G3', 'B3'] },
    { name: 'G',  root: 'G2', notes: ['G3', 'B3', 'D4', 'F#4'] }
  ];

  for (let bar = 0; bar < totalBars; bar++) {
    const chord = padChords[bar % padChords.length];
    const startTime = bar * barSec;
    const startSample = Math.floor(startTime * sampleRate);
    const durSamples = Math.floor((barSec + 0.1) * sampleRate);

    // Dynamic Filter sweep for pads
    const filterL = new BiquadFilter('lowpass', 1500, 0.707, sampleRate);
    const filterR = new BiquadFilter('lowpass', 1500, 0.707, sampleRate);

    chord.notes.forEach((noteStr, idx) => {
      const baseFreq = noteToFreq(noteStr);

      for (let s = 0; s < durSamples; s++) {
        const sampleIdx = startSample + s;
        if (sampleIdx >= numSamples) break;

        const t = s / sampleRate;
        const absTime = sampleIdx / sampleRate;
        const env = getADSR(t, 0.25, 0.4, 0.75, 0.3, barSec);

        // 3 detuned sawtooth waves per note
        const detune1 = 1.002;
        const detune2 = 0.998;
        const saw1 = osc('saw', baseFreq, t);
        const saw2 = osc('saw', baseFreq * detune1, t + 0.1);
        const saw3 = osc('saw', baseFreq * detune2, t + 0.2);

        const rawSig = (saw1 + saw2 + saw3) * 0.33 * env * 0.07;

        // Sidechain compression when kick hits (beat 0, 1, 2, 3)
        const beatInBar = (absTime % barSec) / beatSec;
        const distFromBeat = beatInBar - Math.floor(beatInBar);
        const sidechainDuck = 1.0 - 0.45 * Math.exp(-distFromBeat * 8);

        const pan = (idx % 2 === 0) ? -0.3 : 0.3;
        left[sampleIdx] += filterL.process(rawSig * (0.5 - pan)) * sidechainDuck;
        right[sampleIdx] += filterR.process(rawSig * (0.5 + pan)) * sidechainDuck;
      }
    });
  }

  // 2. Driving 16th-note Analog Octave Bassline
  const bassFilter = new BiquadFilter('lowpass', 400, 1.2, sampleRate);

  for (let bar = 0; bar < totalBars; bar++) {
    const chord = padChords[bar % padChords.length];
    const rootMidiLow = noteToFreq(chord.root);
    const rootMidiHigh = rootMidiLow * 2;

    for (let sixteenth = 0; sixteenth < 16; sixteenth++) {
      const bTime = (bar * 4 + sixteenth * 0.25) * beatSec;
      const startSample = Math.floor(bTime * sampleRate);
      const sixteenthDur = 0.25 * beatSec;
      const samples = Math.floor(sixteenthDur * sampleRate);

      // Octave pattern: Low, High, Low, High...
      const freq = (sixteenth % 2 === 0) ? rootMidiLow : rootMidiHigh;

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;

        const t = s / sampleRate;
        const absTime = idx / sampleRate;
        const env = Math.exp(-t * 22);

        // Filter envelope sweep per bass note
        const cutoff = 200 + 1200 * Math.exp(-t * 28);
        bassFilter.setParams(cutoff, 1.4);

        const saw = osc('saw', freq, t);
        const sub = osc('square', freq * 0.5, t) * 0.5;
        const sig = bassFilter.process(saw + sub) * env * 0.16;

        // Sidechain ducking on kick beats (0, 1, 2, 3)
        const beatInBar = (absTime % barSec) / beatSec;
        const distFromBeat = beatInBar - Math.floor(beatInBar);
        const duck = (sixteenth % 4 === 0) ? 0.3 : (1.0 - 0.5 * Math.exp(-distFromBeat * 10));

        left[idx] += sig * duck;
        right[idx] += sig * duck;
      }
    }
  }

  // 3. 80s Synthwave Lead Melody
  const retrowaveMelody = [
    // Section A (Bars 4-12)
    { note: 'E5', beat: 16, dur: 1.5 },
    { note: 'D5', beat: 18, dur: 1.0 },
    { note: 'C5', beat: 19, dur: 1.0 },
    { note: 'B4', beat: 20, dur: 1.5 },
    { note: 'C5', beat: 22, dur: 1.0 },
    { note: 'A4', beat: 23, dur: 2.5 },

    { note: 'E5', beat: 26, dur: 1.5 },
    { note: 'G5', beat: 28, dur: 1.0 },
    { note: 'F5', beat: 29, dur: 1.0 },
    { note: 'E5', beat: 30, dur: 1.5 },
    { note: 'D5', beat: 32, dur: 3.0 },

    // Section B (Bars 12-20)
    { note: 'A5', beat: 48, dur: 1.5 },
    { note: 'G5', beat: 50, dur: 1.0 },
    { note: 'E5', beat: 51, dur: 1.0 },
    { note: 'C5', beat: 52, dur: 1.5 },
    { note: 'D5', beat: 54, dur: 1.0 },
    { note: 'E5', beat: 55, dur: 2.5 },

    { note: 'D5', beat: 58, dur: 1.0 },
    { note: 'C5', beat: 59, dur: 1.0 },
    { note: 'B4', beat: 60, dur: 1.5 },
    { note: 'G4', beat: 62, dur: 1.0 },
    { note: 'A4', beat: 63, dur: 4.0 },
  ];

  const leadFilterL = new BiquadFilter('lowpass', 3200, 0.707, sampleRate);
  const leadFilterR = new BiquadFilter('lowpass', 3200, 0.707, sampleRate);

  retrowaveMelody.forEach(item => {
    const noteTime = item.beat * beatSec;
    const startSample = Math.floor(noteTime * sampleRate);
    const durSec = item.dur * beatSec;
    const samples = Math.floor((durSec + 0.15) * sampleRate);
    const freq = noteToFreq(item.note);

    for (let s = 0; s < samples; s++) {
      const idx = startSample + s;
      if (idx >= numSamples) break;

      const t = s / sampleRate;
      // Vibrato & pitch bend
      const vibrato = Math.sin(2 * Math.PI * 5.5 * t) * 0.007 * Math.min(1.0, t * 3);
      const curFreq = freq * (1.0 + vibrato);

      const env = getADSR(t, 0.02, 0.1, 0.7, 0.15, durSec);
      // Dual detuned saw lead
      const sig1 = osc('saw', curFreq, t);
      const sig2 = osc('pulse', curFreq * 1.003, t, 0, 0.4) * 0.6;
      const sig = (sig1 + sig2) * env * 0.095;

      left[idx] += leadFilterL.process(sig * 0.85);
      right[idx] += leadFilterR.process(sig * 1.15);
    }
  });

  // 4. Punchy 80s Synth Drums (Four-on-the-floor kick, gated snare, 16th hats)
  const synthKickFilter = new BiquadFilter('lowpass', 300, 0.707, sampleRate);

  for (let bar = 0; bar < totalBars; bar++) {
    const barStartBeat = bar * 4;

    // Four-on-the-floor Kick
    for (let k = 0; k < 4; k++) {
      const tStart = (barStartBeat + k) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.22;
      const samples = Math.floor(dur * sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const pFreq = 40 + (160 - 40) * Math.exp(-t * 40);
        const env = Math.exp(-t * 18);
        const sig = synthKickFilter.process(osc('sine', pFreq, t) * env * 0.42);

        left[idx] += sig;
        right[idx] += sig;
      }
    }

    // Gated 80s Snare on Beats 1 & 3 (2nd and 4th quarter notes)
    [1, 3].forEach(b => {
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.22;
      const samples = Math.floor(dur * sampleRate);
      const snareFilter = new BiquadFilter('highpass', 400, 0.707, sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;

        // Snare tone + gated noise burst
        const tone = osc('sine', 200, t) * Math.exp(-t * 25);
        const noise = snareFilter.process(osc('noise', 0, t)) * (t < 0.16 ? 0.35 : 0); // Gated cut
        const sig = tone * 0.3 + noise;

        left[idx] += sig * 0.95;
        right[idx] += sig * 1.05;
      }
    });

    // Crisp 16th-note Hi-hats
    for (let h = 0; h < 16; h++) {
      const b = h * 0.25;
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.05;
      const samples = Math.floor(dur * sampleRate);
      const hatFilter = new BiquadFilter('highpass', 6000, 0.707, sampleRate);
      const accent = (h % 4 === 2) ? 0.09 : 0.04;

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const sig = hatFilter.process(osc('noise', 0, t)) * Math.exp(-t * 80) * accent;

        left[idx] += sig * 0.85;
        right[idx] += sig * 1.15;
      }
    }
  }

  applyDelayAndReverb(buffer, 0.3, 0.32, 0.22);
  normalizeBuffer(buffer, 0.88);

  const wavData = encodeWAV(buffer);
  const outPath = path.join(MUSIC_DIR, 'mus_synthwave_sunset.wav');
  fs.writeFileSync(outPath, wavData);
  console.log(`Saved: ${outPath} (${(wavData.length / 1024 / 1024).toFixed(2)} MB)`);
}

// ============================================================================
// TRACK 3: mus_lofi_marketplace.wav
// Relaxed lofi marketplace trade music
// ============================================================================
function generateLofiMarketplace() {
  console.log('Generating Track 3: mus_lofi_marketplace.wav...');
  const sampleRate = 44100;
  const bpm = 78;
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const totalBars = 16;
  const totalDuration = barSec * totalBars;
  const numSamples = Math.floor(totalDuration * sampleRate);

  const buffer = new AudioBuffer(2, numSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // 1. Cozy Vinyl & Ambience Layer
  for (let i = 0; i < numSamples; i++) {
    let noiseL = (Math.random() * 2 - 1) * 0.012;
    let noiseR = (Math.random() * 2 - 1) * 0.012;

    if (Math.random() < 0.0005) {
      const pop = (Math.random() * 2 - 1) * 0.1;
      noiseL += pop;
      noiseR += pop * 0.85;
    }

    left[i] += noiseL * 0.5;
    right[i] += noiseR * 0.5;
  }

  // 2. Jazz-Lofi Marketplace Chord Progression
  // Dmaj7 -> C#m7 -> Bm7 -> Amaj7
  const marketChords = [
    { notes: ['D3', 'F#3', 'A3', 'C#4'], bars: 2 },
    { notes: ['C#3', 'E3', 'G#3', 'B3'], bars: 2 },
    { notes: ['B2', 'D3', 'F#3', 'A3'],  bars: 2 },
    { notes: ['A2', 'C#3', 'E3', 'G#3'], bars: 2 },
  ];

  const chordFilterL = new BiquadFilter('lowpass', 1600, 0.707, sampleRate);
  const chordFilterR = new BiquadFilter('lowpass', 1600, 0.707, sampleRate);

  for (let bar = 0; bar < totalBars; bar += 2) {
    const chordIndex = (bar / 2) % marketChords.length;
    const chord = marketChords[chordIndex];
    const startTime = bar * barSec;

    // Soft jazzy chord rhythm (beat 0, 1.5, 3)
    [0, 1.5, 3, 4, 5.5, 7].forEach(beatOffset => {
      const hitTime = startTime + beatOffset * beatSec;
      const startSample = Math.floor(hitTime * sampleRate);
      const dur = beatSec * 1.2;
      const samples = Math.floor(dur * sampleRate);

      chord.notes.forEach((noteStr, idx) => {
        const freq = noteToFreq(noteStr);
        const pan = (idx / (chord.notes.length - 1)) * 0.5 - 0.25;

        for (let s = 0; s < samples; s++) {
          const sampleIdx = startSample + s;
          if (sampleIdx >= numSamples) break;

          const t = s / sampleRate;
          const env = getADSR(t, 0.03, 0.2, 0.5, 0.3, dur);

          // Warm Electric Keys (Sine + Triangle blend)
          const s1 = osc('sine', freq, t);
          const s2 = osc('triangle', freq * 2, t) * 0.2;
          const sig = (s1 + s2) * env * 0.07;

          left[sampleIdx] += chordFilterL.process(sig * (0.5 - pan));
          right[sampleIdx] += chordFilterR.process(sig * (0.5 + pan));
        }
      });
    });
  }

  // 3. Rhythmic Marimba / Kalimba Pluck Arpeggio
  for (let bar = 0; bar < totalBars; bar++) {
    const chord = marketChords[Math.floor((bar % 8) / 2)];
    const barStartBeat = bar * 4;

    // 16th-note kalimba pluck pattern
    for (let p = 0; p < 8; p++) {
      const bOffset = p * 0.5; // 8th notes
      const noteStr = chord.notes[p % chord.notes.length];
      const freq = noteToFreq(noteStr) * 2; // octave higher

      const startTime = (barStartBeat + bOffset) * beatSec;
      const startSample = Math.floor(startTime * sampleRate);
      const dur = 0.15;
      const samples = Math.floor(dur * sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;

        const t = s / sampleRate;
        // Fast decaying kalimba pluck
        const env = Math.exp(-t * 28);
        const sig = osc('sine', freq, t) * env * 0.045;

        left[idx] += sig * 1.1;
        right[idx] += sig * 0.9;
      }
    }
  }

  // 4. Relaxed Market Flute / Whistle Lead Melody
  const marketMelody = [
    // Bar 1-4
    { note: 'F#5', beat: 0.5, dur: 1.0 },
    { note: 'A5',  beat: 1.5, dur: 1.0 },
    { note: 'G#5', beat: 2.5, dur: 1.5 },
    { note: 'E5',  beat: 4.5, dur: 1.0 },
    { note: 'F#5', beat: 5.5, dur: 2.0 },

    { note: 'D5',  beat: 8.5, dur: 1.0 },
    { note: 'F#5', beat: 9.5, dur: 1.0 },
    { note: 'E5',  beat: 10.5, dur: 1.5 },
    { note: 'C#5', beat: 12.5, dur: 1.0 },
    { note: 'D5',  beat: 13.5, dur: 2.0 },

    // Bar 5-8
    { note: 'B4',  beat: 16.5, dur: 1.0 },
    { note: 'D5',  beat: 17.5, dur: 1.0 },
    { note: 'F#5', beat: 18.5, dur: 1.5 },
    { note: 'A5',  beat: 20.5, dur: 1.0 },
    { note: 'G#5', beat: 21.5, dur: 2.5 },

    { note: 'E5',  beat: 24.5, dur: 1.0 },
    { note: 'F#5', beat: 25.5, dur: 1.0 },
    { note: 'E5',  beat: 26.5, dur: 1.0 },
    { note: 'C#5', beat: 27.5, dur: 1.0 },
    { note: 'A4',  beat: 28.5, dur: 3.0 },
  ];

  const fluteFilterL = new BiquadFilter('lowpass', 2200, 0.707, sampleRate);
  const fluteFilterR = new BiquadFilter('lowpass', 2200, 0.707, sampleRate);

  for (let loop = 0; loop < 2; loop++) {
    const loopOffsetBeat = loop * 32;

    marketMelody.forEach(item => {
      const beat = item.beat + loopOffsetBeat;
      const noteTime = beat * beatSec;
      const startSample = Math.floor(noteTime * sampleRate);
      const durSec = item.dur * beatSec;
      const samples = Math.floor((durSec + 0.2) * sampleRate);
      const freq = noteToFreq(item.note);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;

        const t = s / sampleRate;
        const vibrato = Math.sin(2 * Math.PI * 4.8 * t) * 0.005 * Math.min(1.0, t * 3);
        const curFreq = freq * (1.0 + vibrato);

        const env = getADSR(t, 0.04, 0.15, 0.65, 0.2, durSec);
        // Soft sine flute with subtle breath noise
        const breath = (Math.random() * 2 - 1) * 0.05;
        const sig = (osc('sine', curFreq, t) + breath) * env * 0.09;

        left[idx] += fluteFilterL.process(sig * 0.9);
        right[idx] += fluteFilterR.process(sig * 1.1);
      }
    });
  }

  // 5. Walking Lofi Bassline
  for (let bar = 0; bar < totalBars; bar++) {
    const chord = marketChords[Math.floor((bar % 8) / 2)];
    const rootFreq = noteToFreq(chord.notes[0].replace('3', '2').replace('2', '1'));

    [0, 2.5].forEach((bOffset, i) => {
      const freq = i === 0 ? rootFreq : rootFreq * 1.5; // Root & 5th
      const startTime = (bar * 4 + bOffset) * beatSec;
      const startSample = Math.floor(startTime * sampleRate);
      const dur = 1.2 * beatSec;
      const samples = Math.floor(dur * sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;

        const t = s / sampleRate;
        const env = getADSR(t, 0.02, 0.25, 0.45, 0.2, dur);
        const sig = osc('triangle', freq, t) * env * 0.18;

        left[idx] += sig;
        right[idx] += sig;
      }
    });
  }

  // 6. Relaxed Percussion (Soft kick, woodblock rimshot, shaker)
  const marketKickFilter = new BiquadFilter('lowpass', 220, 0.707, sampleRate);

  for (let bar = 0; bar < totalBars; bar++) {
    const barStartBeat = bar * 4;

    // Kick: Beat 0 & Beat 2.5
    [0, 2.5].forEach(b => {
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.25;
      const samples = Math.floor(dur * sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const pFreq = 40 + (100 - 40) * Math.exp(-t * 30);
        const env = Math.exp(-t * 16);
        const sig = marketKickFilter.process(osc('sine', pFreq, t) * env * 0.32);

        left[idx] += sig;
        right[idx] += sig;
      }
    });

    // Woodblock / Rimshot on Beat 1 & Beat 3
    [1, 3].forEach(b => {
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.12;
      const samples = Math.floor(dur * sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const woodTone = osc('sine', 850, t) * Math.exp(-t * 50);
        const sig = woodTone * 0.25;

        left[idx] += sig * 0.9;
        right[idx] += sig * 1.1;
      }
    });

    // Shaker / Hihat 16ths
    for (let h = 0; h < 16; h++) {
      const b = h * 0.25;
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.05;
      const samples = Math.floor(dur * sampleRate);
      const shakerFilter = new BiquadFilter('highpass', 5000, 0.707, sampleRate);
      const accent = (h % 2 === 1) ? 0.06 : 0.03;

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const sig = shakerFilter.process(osc('noise', 0, t)) * Math.exp(-t * 70) * accent;

        left[idx] += sig * 0.85;
        right[idx] += sig * 1.15;
      }
    }
  }

  // Coin / Bell accent every 4 bars
  for (let bar = 3; bar < totalBars; bar += 4) {
    const startTime = (bar * 4 + 3.5) * beatSec;
    const startSample = Math.floor(startTime * sampleRate);
    const dur = 0.8;
    const samples = Math.floor(dur * sampleRate);
    const bellFreq = 1850;

    for (let s = 0; s < samples; s++) {
      const idx = startSample + s;
      if (idx >= numSamples) break;

      const t = s / sampleRate;
      const env = Math.exp(-t * 8);
      const sig = (osc('sine', bellFreq, t) + osc('sine', bellFreq * 2.4, t) * 0.3) * env * 0.06;

      left[idx] += sig * 1.2;
      right[idx] += sig * 0.8;
    }
  }

  applyDelayAndReverb(buffer, 0.35, 0.28, 0.2);
  normalizeBuffer(buffer, 0.88);

  const wavData = encodeWAV(buffer);
  const outPath = path.join(MUSIC_DIR, 'mus_lofi_marketplace.wav');
  fs.writeFileSync(outPath, wavData);
  console.log(`Saved: ${outPath} (${(wavData.length / 1024 / 1024).toFixed(2)} MB)`);
}

// ============================================================================
// TRACK 4: mus_bog_swamp.wav (Mireland / Bog Swamp Ambient Lofi)
// ============================================================================
function generateBogSwamp() {
  console.log('Generating Track 4: mus_bog_swamp.wav...');
  const sampleRate = 44100;
  const durationSec = 20;
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = new AudioBuffer(2, numSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const bpm = 70;
  const beatSec = 60 / bpm;

  // Mystical chords: Dm7 -> Bbmaj7 -> Gm7 -> A7
  const chords = [
    [noteToFreq('D3'), noteToFreq('F3'), noteToFreq('A3'), noteToFreq('C4')],
    [noteToFreq('A#2'), noteToFreq('D3'), noteToFreq('F3'), noteToFreq('A3')],
    [noteToFreq('G2'), noteToFreq('A#2'), noteToFreq('D3'), noteToFreq('F3')],
    [noteToFreq('A2'), noteToFreq('C#3'), noteToFreq('E3'), noteToFreq('G3')],
  ];

  const totalBars = Math.floor(durationSec / (beatSec * 4));

  for (let bar = 0; bar < totalBars; bar++) {
    const chord = chords[bar % chords.length];
    const barStartSample = Math.floor(bar * 4 * beatSec * sampleRate);
    const barDurationSamples = Math.floor(4 * beatSec * sampleRate);

    // Warm pad swell
    for (let s = 0; s < barDurationSamples; s++) {
      const idx = barStartSample + s;
      if (idx >= numSamples) break;
      const t = s / sampleRate;
      const env = Math.sin(Math.PI * (s / barDurationSamples));
      let padSig = 0;
      for (const f of chord) {
        padSig += osc('triangle', f, t) * 0.1;
      }
      left[idx] += padSig * env * 0.7;
      right[idx] += padSig * env * 0.7;
    }

    // Woodwind solo melody
    const melodyNotes = [noteToFreq('F4'), noteToFreq('A4'), noteToFreq('C5'), noteToFreq('D5'), noteToFreq('C5'), noteToFreq('A4')];
    for (let beat = 0; beat < 4; beat++) {
      const noteFreq = melodyNotes[(bar * 4 + beat) % melodyNotes.length];
      const tStart = (bar * 4 + beat) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const samples = Math.floor(beatSec * sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const env = Math.exp(-t * 2.5);
        const sig = (osc('sine', noteFreq, t) + osc('triangle', noteFreq * 2, t) * 0.2) * env * 0.12;

        left[idx] += sig * 0.9;
        right[idx] += sig * 1.1;
      }
    }
  }

  applyDelayAndReverb(buffer, 0.45, 0.35, 0.25);
  normalizeBuffer(buffer, 0.86);

  const wavData = encodeWAV(buffer);
  const outPath = path.join(MUSIC_DIR, 'mus_bog_swamp.wav');
  fs.writeFileSync(outPath, wavData);
  console.log(`Saved: ${outPath} (${(wavData.length / 1024 / 1024).toFixed(2)} MB)`);
}

// ============================================================================
// TRACK 5: mus_frostpeak_chill.wav (Frostpeak Snow Map Icy Synthwave)
// ============================================================================
function generateFrostpeakChill() {
  console.log('Generating Track 5: mus_frostpeak_chill.wav...');
  const sampleRate = 44100;
  const durationSec = 20;
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = new AudioBuffer(2, numSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const bpm = 100;
  const beatSec = 60 / bpm;
  const totalBars = Math.floor(durationSec / (beatSec * 4));

  // Icy Glass Bell Chords: Am -> F -> C -> G
  const bellChords = [
    [noteToFreq('A4'), noteToFreq('C5'), noteToFreq('E5')],
    [noteToFreq('F4'), noteToFreq('A4'), noteToFreq('C5')],
    [noteToFreq('C5'), noteToFreq('E5'), noteToFreq('G5')],
    [noteToFreq('G4'), noteToFreq('B4'), noteToFreq('D5')],
  ];

  for (let bar = 0; bar < totalBars; bar++) {
    const chord = bellChords[bar % bellChords.length];
    const barStartBeat = bar * 4;

    for (let step = 0; step < 16; step++) {
      const tStart = (barStartBeat + step * 0.25) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.2;
      const samples = Math.floor(dur * sampleRate);

      const freq = chord[step % chord.length] * 2; // High glassy octave
      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const env = Math.exp(-t * 12);
        const sig = (osc('sine', freq, t) + osc('sine', freq * 2.76, t) * 0.3) * env * 0.12;

        left[idx] += sig * 0.95;
        right[idx] += sig * 1.05;
      }
    }
  }

  applyDelayAndReverb(buffer, 0.3, 0.3, 0.22);
  normalizeBuffer(buffer, 0.87);

  const wavData = encodeWAV(buffer);
  const outPath = path.join(MUSIC_DIR, 'mus_frostpeak_chill.wav');
  fs.writeFileSync(outPath, wavData);
  console.log(`Saved: ${outPath} (${(wavData.length / 1024 / 1024).toFixed(2)} MB)`);
}

// ============================================================================
// TRACK 6: mus_cavern_echo.wav (Dark Crypt / Caverns Ambient Chiptune)
// ============================================================================
function generateCavernEcho() {
  console.log('Generating Track 6: mus_cavern_echo.wav...');
  const sampleRate = 44100;
  const durationSec = 20;
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = new AudioBuffer(2, numSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const droneFreq = noteToFreq('C2');
  const filter = new BiquadFilter('lowpass', 250, 0.707, sampleRate);

  // Deep Bass Drone
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const lfo = 1 + 0.15 * Math.sin(2 * Math.PI * 0.2 * t);
    const sig = filter.process(osc('sawtooth', droneFreq * lfo, t)) * 0.25;
    left[i] += sig;
    right[i] += sig;
  }

  // Echoing Crystal Plucks
  const notes = [noteToFreq('C4'), noteToFreq('D#4'), noteToFreq('G4'), noteToFreq('A#4'), noteToFreq('C5')];
  const totalPlucks = 24;
  for (let p = 0; p < totalPlucks; p++) {
    const startTime = (p / totalPlucks) * durationSec;
    const startSample = Math.floor(startTime * sampleRate);
    const freq = notes[p % notes.length];
    const dur = 0.5;
    const samples = Math.floor(dur * sampleRate);

    for (let s = 0; s < samples; s++) {
      const idx = startSample + s;
      if (idx >= numSamples) break;
      const t = s / sampleRate;
      const env = Math.exp(-t * 6);
      const sig = osc('sine', freq, t) * env * 0.14;

      left[idx] += sig * (p % 2 === 0 ? 1.2 : 0.8);
      right[idx] += sig * (p % 2 === 0 ? 0.8 : 1.2);
    }
  }

  applyDelayAndReverb(buffer, 0.5, 0.4, 0.3);
  normalizeBuffer(buffer, 0.85);

  const wavData = encodeWAV(buffer);
  const outPath = path.join(MUSIC_DIR, 'mus_cavern_echo.wav');
  fs.writeFileSync(outPath, wavData);
  console.log(`Saved: ${outPath} (${(wavData.length / 1024 / 1024).toFixed(2)} MB)`);
}

// ============================================================================
// TRACK 7: mus_boss_synth.wav (Tidehollow High-Octane Boss Retrowave)
// ============================================================================
function generateBossSynth() {
  console.log('Generating Track 7: mus_boss_synth.wav...');
  const sampleRate = 44100;
  const durationSec = 20;
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = new AudioBuffer(2, numSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const bpm = 128;
  const beatSec = 60 / bpm;
  const totalBars = Math.floor(durationSec / (beatSec * 4));

  // Intense Boss Progression: Fm -> C# -> G# -> D#
  const bassRoots = [noteToFreq('F2'), noteToFreq('C#2'), noteToFreq('G#2'), noteToFreq('D#2')];

  for (let bar = 0; bar < totalBars; bar++) {
    const root = bassRoots[bar % bassRoots.length];
    const barStartBeat = bar * 4;

    // Driving 16th note bassline & heavy kick
    for (let step = 0; step < 16; step++) {
      const tStart = (barStartBeat + step * 0.25) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const samples = Math.floor(0.12 * sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const env = Math.exp(-t * 15);
        const sig = osc('sawtooth', root, t) * env * 0.22;

        left[idx] += sig;
        right[idx] += sig;
      }
    }

    // Heavy Drums (Kick on 1,2,3,4; Snare on 2 & 4)
    for (let b = 0; b < 4; b++) {
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);

      // Kick
      for (let s = 0; s < Math.floor(0.12 * sampleRate); s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const kickSig = Math.sin(2 * Math.PI * (140 - t * 800) * t) * Math.exp(-t * 30) * 0.5;
        left[idx] += kickSig;
        right[idx] += kickSig;
      }

      // Snare on 2 and 4
      if (b === 1 || b === 3) {
        for (let s = 0; s < Math.floor(0.15 * sampleRate); s++) {
          const idx = startSample + s;
          if (idx >= numSamples) break;
          const t = s / sampleRate;
          const snareSig = (osc('noise', 0, t) * 0.35 + osc('sine', 180, t) * 0.2) * Math.exp(-t * 20);
          left[idx] += snareSig;
          right[idx] += snareSig;
        }
      }
    }
  }

  applyDelayAndReverb(buffer, 0.25, 0.22, 0.15);
  normalizeBuffer(buffer, 0.9);

  const wavData = encodeWAV(buffer);
  const outPath = path.join(MUSIC_DIR, 'mus_boss_synth.wav');
  fs.writeFileSync(outPath, wavData);
  console.log(`Saved: ${outPath} (${(wavData.length / 1024 / 1024).toFixed(2)} MB)`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================
async function main() {
  console.log('=== Generating Wayfarer Online Lofi/Synthwave Tracks ===');
  const startMs = Date.now();

  generateLofiCozy();
  generateSynthwaveSunset();
  generateLofiMarketplace();
  generateBogSwamp();
  generateFrostpeakChill();
  generateCavernEcho();
  generateBossSynth();

  const durationSec = ((Date.now() - startMs) / 1000).toFixed(2);
  console.log(`=== Done in ${durationSec}s ===`);
}

main().catch(err => {
  console.error('Error generating audio:', err);
  process.exit(1);
});
