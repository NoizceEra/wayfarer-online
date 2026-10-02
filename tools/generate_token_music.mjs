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

function applyDelayAndReverb(buffer, delayTime = 0.234, feedback = 0.35, mix = 0.25) {
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
// GENERATOR: mus_token_trailer.wav
// Energetic 128 BPM lofi/synthwave beat with driving bassline & uplifting synth leads
// ============================================================================
export function generateTokenTrailerMusic() {
  console.log('Generating Track: mus_token_trailer.wav (128 BPM Energetic Lofi/Synthwave Beat)...');
  const sampleRate = 44100;
  const bpm = 128;
  const beatSec = 60 / bpm; // 0.46875s
  const barSec = beatSec * 4; // 1.875s
  const totalBars = 16;
  const totalDuration = barSec * totalBars; // 30.0s
  const numSamples = Math.floor(totalDuration * sampleRate);

  const buffer = new AudioBuffer(2, numSamples, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Uplifting Synthwave Chord Progression: Am -> F -> C -> G
  const chordProg = [
    { name: 'Am', root: 'A1', arpNotes: ['A3', 'C4', 'E4', 'A4'], padNotes: ['A3', 'C4', 'E4'] },
    { name: 'F',  root: 'F1', arpNotes: ['F3', 'A3', 'C4', 'F4'], padNotes: ['F3', 'A3', 'C4'] },
    { name: 'C',  root: 'C2', arpNotes: ['C4', 'E4', 'G4', 'C5'], padNotes: ['C3', 'E3', 'G3'] },
    { name: 'G',  root: 'G1', arpNotes: ['G3', 'B3', 'D4', 'G4'], padNotes: ['G3', 'B3', 'D4'] },
  ];

  // Uplifting Melody Notes for Lead Synth
  const leadMelody = [
    // Bar 0..3 (Phrase A)
    ['E5', 'G5', 'A5', 'C6', 'B5', 'G5', 'E5', 'G5'],
    ['F5', 'A5', 'C6', 'E6', 'D6', 'C6', 'A5', 'C6'],
    ['G5', 'C6', 'E6', 'G6', 'F6', 'E6', 'C6', 'E6'],
    ['D5', 'G5', 'B5', 'D6', 'C6', 'B5', 'G5', 'B5'],
    // Bar 4..7 (Phrase B - Higher energy & octave flourishes)
    ['E5', 'A5', 'C6', 'E6', 'A6', 'G6', 'E6', 'C6'],
    ['F5', 'C6', 'F6', 'A6', 'G6', 'F6', 'C6', 'A5'],
    ['G5', 'E6', 'G6', 'C7', 'B6', 'G6', 'E6', 'C6'],
    ['D6', 'B6', 'G6', 'D6', 'C6', 'B5', 'A5', 'G5'],
  ];

  const bassFilter = new BiquadFilter('lowpass', 650, 0.707, sampleRate);
  const padFilter = new BiquadFilter('lowpass', 1200, 0.707, sampleRate);
  const arpFilter = new BiquadFilter('lowpass', 2400, 0.707, sampleRate);
  const leadFilter = new BiquadFilter('lowpass', 3500, 0.707, sampleRate);
  const kickFilter = new BiquadFilter('lowpass', 200, 0.707, sampleRate);

  for (let bar = 0; bar < totalBars; bar++) {
    const chord = chordProg[bar % chordProg.length];
    const barStartBeat = bar * 4;

    // ------------------------------------------------------------------------
    // 1. DRIVING SYNTHBASS (16th-note rolling bassline with sidechain dip)
    // ------------------------------------------------------------------------
    const rootFreq = noteToFreq(chord.root);
    for (let i = 0; i < 16; i++) {
      const stepBeat = barStartBeat + (i * 0.25);
      const tStart = stepBeat * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const noteDur = beatSec * 0.22;
      const samples = Math.floor(noteDur * sampleRate);

      // Sidechain ducking effect on downbeats
      const posInBeat = (i % 4) / 4;
      const sidechain = 0.45 + 0.55 * Math.pow(posInBeat, 0.8);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;

        const env = getADSR(t, 0.005, 0.06, 0.6, 0.04, noteDur);
        const saw1 = osc('saw', rootFreq, t);
        const sq2 = osc('square', rootFreq * 0.5, t, 0, 0.35);
        const sig = bassFilter.process((saw1 * 0.6 + sq2 * 0.4) * env * 0.32 * sidechain);

        left[idx] += sig;
        right[idx] += sig;
      }
    }

    // ------------------------------------------------------------------------
    // 2. WARM SYNTH LOFI PAD (Sustained chords)
    // ------------------------------------------------------------------------
    const padStart = barStartBeat * beatSec;
    const padStartSample = Math.floor(padStart * sampleRate);
    const padDur = barSec * 0.98;
    const padSamples = Math.floor(padDur * sampleRate);

    chord.padNotes.forEach(n => {
      const freq = noteToFreq(n);
      for (let s = 0; s < padSamples; s++) {
        const idx = padStartSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;

        const env = getADSR(t, 0.2, 0.4, 0.7, 0.3, padDur);
        const tone1 = osc('saw', freq, t);
        const tone2 = osc('saw', freq * 1.003, t); // Slight detune for warmth
        const sig = padFilter.process((tone1 + tone2) * 0.5 * env * 0.09);

        left[idx] += sig * 0.8;
        right[idx] += sig * 1.2;
      }
    });

    // ------------------------------------------------------------------------
    // 3. ENERGETIC ARPEGGIATOR (16th notes)
    // ------------------------------------------------------------------------
    for (let i = 0; i < 16; i++) {
      const arpNote = chord.arpNotes[i % chord.arpNotes.length];
      const freq = noteToFreq(arpNote);
      const stepBeat = barStartBeat + (i * 0.25);
      const tStart = stepBeat * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const noteDur = beatSec * 0.2;
      const samples = Math.floor(noteDur * sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;

        const env = getADSR(t, 0.003, 0.04, 0.3, 0.03, noteDur);
        const tone = osc('square', freq, t, 0, 0.3);
        const sig = arpFilter.process(tone * env * 0.11);

        // Stereo panning alternating
        const pan = (i % 2 === 0) ? 0.7 : 1.3;
        left[idx] += sig * (2 - pan);
        right[idx] += sig * pan;
      }
    }

    // ------------------------------------------------------------------------
    // 4. UPLIFTING SYNTH LEAD (Melodic line over bars)
    // ------------------------------------------------------------------------
    if (bar >= 2) {
      const mel = leadMelody[(bar - 2) % leadMelody.length];
      mel.forEach((noteStr, idxInMel) => {
        const freq = noteToFreq(noteStr);
        const stepBeat = barStartBeat + (idxInMel * 0.5); // 8th note lead steps
        const tStart = stepBeat * beatSec;
        const startSample = Math.floor(tStart * sampleRate);
        const noteDur = beatSec * 0.42;
        const samples = Math.floor(noteDur * sampleRate);

        for (let s = 0; s < samples; s++) {
          const idx = startSample + s;
          if (idx >= numSamples) break;
          const t = s / sampleRate;

          const env = getADSR(t, 0.01, 0.08, 0.65, 0.1, noteDur);
          const saw1 = osc('saw', freq, t);
          const saw2 = osc('saw', freq * 1.005, t); // Chorus detune
          const sig = leadFilter.process((saw1 * 0.5 + saw2 * 0.5) * env * 0.22);

          left[idx] += sig * 0.95;
          right[idx] += sig * 1.05;
        }
      });
    }

    // ------------------------------------------------------------------------
    // 5. DRUMS & PERCUSSION (128 BPM 4-on-the-floor + Snare + Hats + Crash)
    // ------------------------------------------------------------------------
    // Crash cymbal at start of bar 0, 4, 8, 12
    if (bar % 4 === 0) {
      const tStart = barStartBeat * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const crashDur = 1.4;
      const samples = Math.floor(crashDur * sampleRate);
      const crashFilter = new BiquadFilter('highpass', 3200, 0.707, sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const noise = crashFilter.process(osc('noise', 0, t));
        const env = Math.exp(-t * 3.8);
        const sig = noise * env * 0.14;

        left[idx] += sig * 0.9;
        right[idx] += sig * 1.1;
      }
    }

    // Kick on beats 0, 1, 2, 3 (4-on-the-floor) + syncopation on beat 3.5
    [0, 1, 2, 3, 3.5].forEach(b => {
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.2;
      const samples = Math.floor(dur * sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const pFreq = 45 + (170 - 45) * Math.exp(-t * 42);
        const env = Math.exp(-t * 19);
        const sig = kickFilter.process(osc('sine', pFreq, t) * env * 0.44);

        left[idx] += sig;
        right[idx] += sig;
      }
    });

    // Snare on beats 1 & 3
    [1, 3].forEach(b => {
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.22;
      const samples = Math.floor(dur * sampleRate);
      const snareFilter = new BiquadFilter('highpass', 550, 0.707, sampleRate);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const tone = osc('sine', 185, t) * Math.exp(-t * 36);
        const noise = snareFilter.process(osc('noise', 0, t)) * Math.exp(-t * 18);
        const sig = (tone * 0.3 + noise * 0.38);

        left[idx] += sig * 0.95;
        right[idx] += sig * 1.05;
      }
    });

    // 16th Hi-Hats
    for (let h = 0; h < 16; h++) {
      const b = h * 0.25;
      const tStart = (barStartBeat + b) * beatSec;
      const startSample = Math.floor(tStart * sampleRate);
      const dur = 0.05;
      const samples = Math.floor(dur * sampleRate);
      const hatFilter = new BiquadFilter('highpass', 6000, 0.707, sampleRate);
      const accent = (h % 4 === 2) ? 0.1 : (h % 2 === 0 ? 0.075 : 0.045);

      for (let s = 0; s < samples; s++) {
        const idx = startSample + s;
        if (idx >= numSamples) break;
        const t = s / sampleRate;
        const sig = hatFilter.process(osc('noise', 0, t)) * Math.exp(-t * 75) * accent;

        left[idx] += sig * 0.85;
        right[idx] += sig * 1.15;
      }
    }
  }

  // Master Effects & Normalization
  applyDelayAndReverb(buffer, 0.234, 0.33, 0.22);
  normalizeBuffer(buffer, 0.92);

  const wavData = encodeWAV(buffer);
  const outPath = path.join(MUSIC_DIR, 'mus_token_trailer.wav');
  fs.writeFileSync(outPath, wavData);
  console.log(`✔ Generated: ${outPath} (${(wavData.length / 1024 / 1024).toFixed(2)} MB)`);
}

// Direct execution
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    generateTokenTrailerMusic();
  } catch (err) {
    console.error('Error generating token trailer music:', err);
    process.exit(1);
  }
}
