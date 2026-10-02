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
// DSP HELPERS
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

function applyDelayAndReverb(buffer, delayTime = 0.22, feedback = 0.35, mix = 0.25) {
  const sr = buffer.sampleRate;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const delaySamplesL = Math.floor(delayTime * sr);
  const delaySamplesR = Math.floor((delayTime * 1.25) * sr);

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

function normalizeBuffer(buffer, targetPeak = 0.92) {
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
// GENERATOR: mus_jobs_trailer.wav
// Fast-paced 132 BPM retrowave synthwave track with driving basslines & upbeat lead synths
// ============================================================================
export function generateJobsTrailerMusic() {
  console.log('Generating Track: mus_jobs_trailer.wav (132 BPM Fast-Paced Retrowave Synthwave)...');
  const sampleRate = 44100;
  const bpm = 132;
  const beatSec = 60 / bpm; // ~0.4545s
  const barSec = beatSec * 4; // ~1.818s
  const totalBars = 16;
  const totalDuration = barSec * totalBars; // ~29.1s
  const numSamples = Math.floor(totalDuration * sampleRate);

  const buffer = new AudioBuffer(2, numSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Chord Progression: Am -> F -> C -> G (Classic driving synthwave minor key)
  const chordProg = [
    { name: 'Am', root: 'A1', arpNotes: ['A3', 'C4', 'E4', 'A4'], padNotes: ['A3', 'C4', 'E4'] },
    { name: 'F',  root: 'F1', arpNotes: ['F3', 'A3', 'C4', 'F4'], padNotes: ['F3', 'A3', 'C4'] },
    { name: 'C',  root: 'C2', arpNotes: ['C4', 'E4', 'G4', 'C5'], padNotes: ['C3', 'E3', 'G3'] },
    { name: 'G',  root: 'G1', arpNotes: ['G3', 'B3', 'D4', 'G4'], padNotes: ['G3', 'B3', 'D4'] },
  ];

  // 1. Driving 16th-note Synthwave Saw Bassline with Resonant Filter Envelope
  const bassFilter = new BiquadFilter('lowpass', 500, 1.6, sampleRate);

  for (let bar = 0; bar < totalBars; bar++) {
    const chord = chordProg[bar % chordProg.length];
    const rootFreqLow = noteToFreq(chord.root);
    const rootFreqHigh = rootFreqLow * 2;

    for (let sixteenth = 0; sixteenth < 16; sixteenth++) {
      const bTime = (bar * 4 + sixteenth * 0.25) * beatSec;
      const startSample = Math.floor(bTime * sampleRate);
      const sixteenthDur = 0.25 * beatSec;
      const samples = Math.floor(sixteenthDur * sampleRate);

      // Octave jump: Low, High, Low, High... with extra accent on beat start
      const freq = (sixteenth % 2 === 0) ? rootFreqLow : rootFreqHigh;
      const isAccent = (sixteenth % 4 === 0);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;

        const t = s / sampleRate;
        const env = Math.exp(-t * 24);

        // Dynamic resonant filter sweep per bass hit
        const cutoff = (isAccent ? 3500 : 1800) * Math.exp(-t * 30) + 180;
        bassFilter.setParams(cutoff, 1.5);

        const saw = osc('saw', freq, t);
        const sub = osc('square', freq * 0.5, t) * 0.65;
        const sig = bassFilter.process(saw + sub) * env * 0.18;

        left[idx] += sig;
        right[idx] += sig;
      }
    }
  }

  // 2. Upbeat 16th-note Arpeggio Pluck Synth
  const arpFilterL = new BiquadFilter('lowpass', 2800, 0.707, sampleRate);
  const arpFilterR = new BiquadFilter('lowpass', 2800, 0.707, sampleRate);

  for (let bar = 0; bar < totalBars; bar++) {
    const chord = chordProg[bar % chordProg.length];

    for (let sixteenth = 0; sixteenth < 16; sixteenth++) {
      const bTime = (bar * 4 + sixteenth * 0.25) * beatSec;
      const startSample = Math.floor(bTime * sampleRate);
      const sixteenthDur = 0.25 * beatSec;
      const samples = Math.floor(sixteenthDur * sampleRate);

      const noteStr = chord.arpNotes[sixteenth % chord.arpNotes.length];
      const freq = noteToFreq(noteStr);
      const pan = (sixteenth % 2 === 0) ? -0.4 : 0.4;

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;

        const t = s / sampleRate;
        const env = Math.exp(-t * 28);
        const pulse = osc('pulse', freq, t, 0, 0.3) * env * 0.08;
        const saw = osc('saw', freq * 1.002, t) * env * 0.04;
        const sig = (pulse + saw);

        left[idx] += arpFilterL.process(sig * (0.5 - pan));
        right[idx] += arpFilterR.process(sig * (0.5 + pan));
      }
    }
  }

  // 3. Upbeat Catchy Retrowave Lead Synth
  // Upbeat melody in A Minor / C Major (energetic 132 BPM trailer hook)
  const leadMelody = [
    // Bar 1-2 (Am)
    { note: 'E5', startBeat: 0.0, dur: 0.75 },
    { note: 'A5', startBeat: 0.75, dur: 0.75 },
    { note: 'B5', startBeat: 1.5, dur: 0.5 },
    { note: 'C6', startBeat: 2.0, dur: 1.0 },
    { note: 'B5', startBeat: 3.0, dur: 0.5 },
    { note: 'A5', startBeat: 3.5, dur: 0.5 },
    { note: 'E5', startBeat: 4.0, dur: 1.5 },
    { note: 'G5', startBeat: 5.5, dur: 0.5 },
    { note: 'A5', startBeat: 6.0, dur: 1.5 },

    // Bar 3-4 (F)
    { note: 'F5', startBeat: 8.0, dur: 0.75 },
    { note: 'A5', startBeat: 8.75, dur: 0.75 },
    { note: 'C6', startBeat: 9.5, dur: 0.5 },
    { note: 'D6', startBeat: 10.0, dur: 1.0 },
    { note: 'C6', startBeat: 11.0, dur: 0.5 },
    { note: 'A5', startBeat: 11.5, dur: 0.5 },
    { note: 'C6', startBeat: 12.0, dur: 1.5 },
    { note: 'B5', startBeat: 13.5, dur: 0.5 },
    { note: 'A5', startBeat: 14.0, dur: 1.5 },

    // Bar 5-6 (C)
    { note: 'G5', startBeat: 16.0, dur: 0.75 },
    { note: 'C6', startBeat: 16.75, dur: 0.75 },
    { note: 'D6', startBeat: 17.5, dur: 0.5 },
    { note: 'E6', startBeat: 18.0, dur: 1.0 },
    { note: 'D6', startBeat: 19.0, dur: 0.5 },
    { note: 'C6', startBeat: 19.5, dur: 0.5 },
    { note: 'G5', startBeat: 20.0, dur: 1.5 },
    { note: 'A5', startBeat: 21.5, dur: 0.5 },
    { note: 'C6', startBeat: 22.0, dur: 1.5 },

    // Bar 7-8 (G)
    { note: 'D6', startBeat: 24.0, dur: 1.0 },
    { note: 'C6', startBeat: 25.0, dur: 0.5 },
    { note: 'B5', startBeat: 25.5, dur: 0.5 },
    { note: 'G5', startBeat: 26.0, dur: 1.0 },
    { note: 'A5', startBeat: 27.0, dur: 1.0 },
    { note: 'B5', startBeat: 28.0, dur: 2.0 },
  ];

  const leadFilterL = new BiquadFilter('lowpass', 3200, 0.707, sampleRate);
  const leadFilterR = new BiquadFilter('lowpass', 3200, 0.707, sampleRate);

  // Play lead melody for 2 full loops (16 bars)
  for (let loop = 0; loop < 2; loop++) {
    const loopOffsetBeat = loop * 32;

    leadMelody.forEach(item => {
      const beat = item.startBeat + loopOffsetBeat;
      const noteTime = beat * beatSec;
      const startSample = Math.floor(noteTime * sampleRate);
      const durSec = item.dur * beatSec;
      const durSamples = Math.floor((durSec + 0.15) * sampleRate);
      const freq = noteToFreq(item.note);

      for (let s = 0; s < durSamples; s++) {
        const sampleIdx = startSample + s;
        if (sampleIdx >= numSamples) break;

        const t = s / sampleRate;
        const env = getADSR(t, 0.02, 0.15, 0.7, 0.15, durSec);

        // Vibrant 5.5Hz pitch vibrato
        const vibrato = Math.sin(2 * Math.PI * 5.5 * t) * 0.007 * Math.min(1.0, t * 5);
        const curFreq = freq * (1.0 + vibrato);

        // Blend dual detuned saws + square wave for bright retrowave lead
        const saw1 = osc('saw', curFreq, t);
        const saw2 = osc('saw', curFreq * 1.003, t + 0.05);
        const sqr  = osc('square', curFreq * 0.997, t, 0, 0.4) * 0.5;

        const sig = (saw1 + saw2 + sqr) * 0.35 * env * 0.12;

        left[sampleIdx] += leadFilterL.process(sig);
        right[sampleIdx] += leadFilterR.process(sig);
      }
    });
  }

  // 4. Detuned Synth Brass / Pads for Harmony
  for (let bar = 0; bar < totalBars; bar++) {
    const chord = chordProg[bar % chordProg.length];
    const startTime = bar * barSec;
    const startSample = Math.floor(startTime * sampleRate);
    const durSamples = Math.floor((barSec + 0.1) * sampleRate);

    const padFilterL = new BiquadFilter('lowpass', 1600, 0.707, sampleRate);
    const padFilterR = new BiquadFilter('lowpass', 1600, 0.707, sampleRate);

    chord.padNotes.forEach((noteStr, idx) => {
      const baseFreq = noteToFreq(noteStr);

      for (let s = 0; s < durSamples; s++) {
        const sampleIdx = startSample + s;
        if (sampleIdx >= numSamples) break;

        const t = s / sampleRate;
        const env = getADSR(t, 0.12, 0.3, 0.7, 0.25, barSec);

        const saw1 = osc('saw', baseFreq, t);
        const saw2 = osc('saw', baseFreq * 1.0025, t + 0.1);
        const sig = (saw1 + saw2) * 0.5 * env * 0.05;

        // Sidechain compression pump on quarter beats
        const absTime = sampleIdx / sampleRate;
        const beatInBar = (absTime % barSec) / beatSec;
        const distFromBeat = beatInBar - Math.floor(beatInBar);
        const sidechainDuck = 1.0 - 0.4 * Math.exp(-distFromBeat * 10);

        const pan = (idx % 2 === 0) ? -0.25 : 0.25;
        left[sampleIdx] += padFilterL.process(sig * (0.5 - pan)) * sidechainDuck;
        right[sampleIdx] += padFilterR.process(sig * (0.5 + pan)) * sidechainDuck;
      }
    });
  }

  // 5. Punchy Retrowave Drums (Kick, Gated Snare, 16th Hi-Hats, Crash)
  const kickFilter = new BiquadFilter('lowpass', 300, 0.707, sampleRate);

  for (let bar = 0; bar < totalBars; bar++) {
    const barStartBeat = bar * 4;

    // Crash cymbal at start of bar 0 and bar 8
    if (bar % 8 === 0) {
      const tStart = barStartBeat * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const crashDur = 1.2;
      const samples = Math.floor(crashDur * sampleRate);
      const crashFilter = new BiquadFilter('highpass', 3000, 0.707, sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const noise = crashFilter.process(osc('noise', 0, t));
        const env = Math.exp(-t * 4);
        const sig = noise * env * 0.12;

        left[idx] += sig * 0.9;
        right[idx] += sig * 1.1;
      }
    }

    // Driving Synthwave Kick (4-on-the-floor + extra syncopation on 3.5)
    [0, 1, 2, 3, 3.5].forEach(b => {
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.22;
      const samples = Math.floor(dur * sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const pFreq = 40 + (160 - 40) * Math.exp(-t * 40);
        const env = Math.exp(-t * 18);
        const sig = kickFilter.process(osc('sine', pFreq, t) * env * 0.42);

        left[idx] += sig;
        right[idx] += sig;
      }
    });

    // Big Gated Retrowave Snare on beats 1 & 3 (2nd and 4th beats)
    [1, 3].forEach(b => {
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.24;
      const samples = Math.floor(dur * sampleRate);
      const snareFilter = new BiquadFilter('highpass', 600, 0.707, sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const tone = osc('sine', 190, t) * Math.exp(-t * 35);
        const noise = snareFilter.process(osc('noise', 0, t)) * Math.exp(-t * 16);
        const sig = (tone * 0.3 + noise * 0.35);

        left[idx] += sig * 0.9;
        right[idx] += sig * 1.1;
      }
    });

    // Crisp 16th Hi-Hats
    for (let h = 0; h < 16; h++) {
      const b = h * 0.25;
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.05;
      const samples = Math.floor(dur * sampleRate);
      const hatFilter = new BiquadFilter('highpass', 5500, 0.707, sampleRate);
      const accent = (h % 4 === 2) ? 0.09 : (h % 2 === 0 ? 0.07 : 0.04);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const sig = hatFilter.process(osc('noise', 0, t)) * Math.exp(-t * 70) * accent;

        left[idx] += sig * 0.85;
        right[idx] += sig * 1.15;
      }
    }
  }

  // Master Delay & Reverb + Normalization
  applyDelayAndReverb(buffer, 0.22, 0.32, 0.22);
  normalizeBuffer(buffer, 0.92);

  const wavData = encodeWAV(buffer);
  const outPath = path.join(MUSIC_DIR, 'mus_jobs_trailer.wav');
  fs.writeFileSync(outPath, wavData);
  console.log(`✔ Generated: ${outPath} (${(wavData.length / 1024 / 1024).toFixed(2)} MB)`);
}

// Main execution if run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    generateJobsTrailerMusic();
  } catch (err) {
    console.error('Error generating jobs trailer music:', err);
    process.exit(1);
  }
}
