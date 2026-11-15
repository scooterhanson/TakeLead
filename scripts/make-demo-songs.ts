/**
 * Generates public-domain demo karaoke tracks (synthesized backing audio + word-timed LRC)
 * into media/Public Domain Demos/. Run: npm run demo-songs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SR = 44100;
const OUT = path.resolve('media', 'Public Domain Demos');

interface Phrase {
  lyric: string; // syllables split by spaces and hyphens
  notes: string; // one note per syllable, e.g. "C4 C4 G4"
  beats: string; // one duration (in beats) per syllable
  chords: string; // "C:2 F:2" chord:beats, must sum to the phrase length
}
interface SongDef {
  title: string;
  bpm: number;
  countIn: number;
  phrases: Phrase[];
}

const SONGS: SongDef[] = [
  {
    title: 'Twinkle Twinkle Little Star',
    bpm: 96,
    countIn: 4,
    phrases: [
      { lyric: 'Twin-kle twin-kle lit-tle star', notes: 'C4 C4 G4 G4 A4 A4 G4', beats: '1 1 1 1 1 1 2', chords: 'C:2 C:2 F:2 C:2' },
      { lyric: 'How I won-der what you are', notes: 'F4 F4 E4 E4 D4 D4 C4', beats: '1 1 1 1 1 1 2', chords: 'F:2 C:2 G:2 C:2' },
      { lyric: 'Up a-bove the world so high', notes: 'G4 G4 F4 F4 E4 E4 D4', beats: '1 1 1 1 1 1 2', chords: 'C:2 F:2 C:2 G:2' },
      { lyric: 'Like a dia-mond in the sky', notes: 'G4 G4 F4 F4 E4 E4 D4', beats: '1 1 1 1 1 1 2', chords: 'C:2 F:2 C:2 G:2' },
      { lyric: 'Twin-kle twin-kle lit-tle star', notes: 'C4 C4 G4 G4 A4 A4 G4', beats: '1 1 1 1 1 1 2', chords: 'C:2 C:2 F:2 C:2' },
      { lyric: 'How I won-der what you are', notes: 'F4 F4 E4 E4 D4 D4 C4', beats: '1 1 1 1 1 1 2', chords: 'F:2 C:2 G:2 C:2' },
    ],
  },
  {
    title: 'Row Row Row Your Boat',
    bpm: 84,
    countIn: 4,
    phrases: [
      { lyric: 'Row row row your boat', notes: 'C4 C4 C4 D4 E4', beats: '1 1 .75 .25 1', chords: 'C:4' },
      { lyric: 'Gent-ly down the stream', notes: 'E4 D4 E4 F4 G4', beats: '.75 .25 .75 .25 2', chords: 'C:2 C:2' },
      {
        lyric: 'Mer-ri-ly mer-ri-ly mer-ri-ly mer-ri-ly',
        notes: 'C5 C5 C5 G4 G4 G4 E4 E4 E4 C4 C4 C4',
        beats: '.3333 .3333 .3334 .3333 .3333 .3334 .3333 .3333 .3334 .3333 .3333 .3334',
        chords: 'C:4',
      },
      { lyric: 'Life is but a dream', notes: 'G4 F4 E4 D4 C4', beats: '.75 .25 .75 .25 2', chords: 'G:2 C:2' },
    ],
  },
  {
    title: 'Happy Birthday',
    bpm: 100,
    countIn: 3,
    phrases: [
      { lyric: 'Hap-py birth-day to you', notes: 'G4 G4 A4 G4 C5 B4', beats: '.75 .25 1 1 1 2', chords: 'C:3 G:3' },
      { lyric: 'Hap-py birth-day to you', notes: 'G4 G4 A4 G4 D5 C5', beats: '.75 .25 1 1 1 2', chords: 'G:3 C:3' },
      { lyric: 'Hap-py birth-day dear sing-er', notes: 'G4 G4 G5 E5 C5 B4 A4', beats: '.75 .25 1 1 1 1 2', chords: 'C:4 F:3' },
      { lyric: 'Hap-py birth-day to you', notes: 'F5 F5 E5 C5 D5 C5', beats: '.75 .25 1 1 1 2', chords: 'C:2 G:2 C:2' },
    ],
  },
];

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(note: string) {
  const m = note.match(/^([A-G])(#|b)?(\d)$/)!;
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const freq = (m: number) => 440 * 2 ** ((m - 69) / 12);
const CHORDS: Record<string, number[]> = { C: [48, 52, 55], F: [53, 57, 60], G: [55, 59, 62] };

function addTone(buf: Float32Array, start: number, dur: number, f: number, amp: number, harmonics: number[], attack = 0.01, release = 0.08) {
  const s0 = Math.floor(start * SR);
  const n = Math.floor((dur + release) * SR);
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / SR;
    let env = t < attack ? t / attack : 1 - 0.25 * Math.min(1, (t - attack) / 0.3);
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / release);
    let v = 0;
    harmonics.forEach((h, k) => (v += h * Math.sin(2 * Math.PI * f * (k + 1) * t)));
    buf[s0 + i] += amp * env * v;
  }
}

function addClick(buf: Float32Array, start: number, accent: boolean) {
  addTone(buf, start, 0.03, accent ? 1600 : 1100, 0.25, [1], 0.002, 0.03);
}

const ts = (s: number) => {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

function writeWav(file: string, buf: Float32Array) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const gain = 0.9 / (peak || 1);
  const data = Buffer.alloc(buf.length * 2);
  buf.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

function render(song: SongDef) {
  const spb = 60 / song.bpm;
  const lead = 0.6;
  const totalBeats = song.countIn + song.phrases.reduce((a, p) => a + p.beats.split(' ').reduce((x, b) => x + Number(b), 0), 0) + 2;
  const buf = new Float32Array(Math.ceil((lead + totalBeats * spb + 1.5) * SR));

  for (let i = 0; i < song.countIn; i++) addClick(buf, lead + i * spb, i === 0);

  const lrc = [`[ti:${song.title}]`, '[ar:Traditional]', '[by:TakeLead demo generator]', ''];
  let t = lead + song.countIn * spb;
  for (const ph of song.phrases) {
    // Chord pad + bass
    let ct = t;
    for (const c of ph.chords.split(' ')) {
      const [name, beats] = c.split(':');
      const d = Number(beats) * spb;
      for (const m of CHORDS[name]) addTone(buf, ct, d * 0.95, freq(m), 0.07, [1, 0.3], 0.04, 0.15);
      addTone(buf, ct, d * 0.9, freq(CHORDS[name][0] - 12), 0.16, [1, 0.5, 0.2], 0.01, 0.1);
      ct += d;
    }
    // Melody guide + word timing
    const syllables = ph.lyric.split(' ').flatMap((word) => {
      const parts = word.split('-');
      return parts.map((p, i) => (i === parts.length - 1 ? p + ' ' : p));
    });
    const notes = ph.notes.split(' ');
    const beats = ph.beats.split(' ').map(Number);
    if (syllables.length !== notes.length || notes.length !== beats.length)
      throw new Error(`Mismatch in "${ph.lyric}": ${syllables.length} syllables, ${notes.length} notes, ${beats.length} beats`);
    let line = `[${ts(t)}]`;
    let last = t;
    syllables.forEach((syl, i) => {
      const d = beats[i] * spb;
      addTone(buf, t, d * 0.88, freq(midi(notes[i])), 0.22, [1, 0.45, 0.2, 0.08]);
      line += `<${ts(t)}>${syl}`;
      last = t + d * 0.9;
      t += d;
    });
    lrc.push(line.trimEnd() + `<${ts(last)}>`);
  }
  lrc.push(`[${ts(t + 0.5)}]`);
  return { buf, lrc: lrc.join('\n') + '\n' };
}

fs.mkdirSync(OUT, { recursive: true });
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
for (const song of SONGS) {
  const base = path.join(OUT, `Traditional - ${song.title}`);
  const { buf, lrc } = render(song);
  writeWav(base + '.wav', buf);
  fs.writeFileSync(base + '.lrc', lrc);
  if (hasFfmpeg) {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', base + '.wav', '-b:a', '128k', base + '.mp3']);
    if (r.status === 0) fs.rmSync(base + '.wav');
  }
  console.log(`✓ ${song.title}`);
}
console.log(`\nWrote ${SONGS.length} demo songs to ${OUT}`);
