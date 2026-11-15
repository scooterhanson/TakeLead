/**
 * LRC timed-lyrics parser. Supports:
 *   [mm:ss.xx] line text                          (line timing)
 *   [mm:ss.xx]<mm:ss.xx>word <mm:ss.xx>word ...   (enhanced/A2 word timing)
 *   a trailing <mm:ss.xx> with no text marks when the line ends
 *   [offset:+/-ms], [ti:], [ar:] metadata
 */

export interface LrcWord {
  time: number;
  end: number;
  text: string;
}
export interface LrcLine {
  time: number;
  end: number;
  text: string;
  words: LrcWord[];
}
export interface Lrc {
  title?: string;
  artist?: string;
  lines: LrcLine[];
}

const TIME = /(\d+):(\d{1,2}(?:[.:]\d{1,3})?)/;
const toSeconds = (m: string, s: string) => Number(m) * 60 + Number(s.replace(':', '.'));

export function parseLrc(text: string): Lrc {
  let offset = 0;
  const meta: Record<string, string> = {};
  const raw: { time: number; body: string }[] = [];

  for (const line of text.split(/\r?\n/)) {
    const metaMatch = line.match(/^\s*\[([a-z]+):(.*)\]\s*$/i);
    if (metaMatch && !/^\d+$/.test(metaMatch[1])) {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      continue;
    }
    const tags: number[] = [];
    let rest = line;
    let m: RegExpMatchArray | null;
    while ((m = rest.match(new RegExp(`^\\s*\\[${TIME.source}\\]`)))) {
      tags.push(toSeconds(m[1], m[2]));
      rest = rest.slice(m[0].length);
    }
    for (const t of tags) raw.push({ time: t, body: rest });
  }
  if (meta.offset) offset = Number(meta.offset) / 1000 || 0;
  raw.sort((a, b) => a.time - b.time);

  const lines: LrcLine[] = raw.map(({ time, body }) => {
    const words: LrcWord[] = [];
    let explicitEnd: number | undefined;
    const wordRe = new RegExp(`<${TIME.source}>([^<]*)`, 'g');
    let wm: RegExpExecArray | null;
    let sawWordTag = false;
    while ((wm = wordRe.exec(body))) {
      sawWordTag = true;
      const t = toSeconds(wm[1], wm[2]) - offset;
      if (wm[3].length) words.push({ time: t, end: 0, text: wm[3] });
      else explicitEnd = t;
    }
    const plain = sawWordTag ? words.map((w) => w.text).join('') : body;
    return { time: time - offset, end: explicitEnd ?? NaN, text: plain.trim(), words };
  });

  // Fill in end times.
  lines.forEach((line, i) => {
    const next = lines[i + 1]?.time;
    if (Number.isNaN(line.end)) {
      const lastWord = line.words.at(-1);
      line.end = next ?? (lastWord ? lastWord.time + 2 : line.time + 5);
      if (next !== undefined) line.end = Math.min(line.end, line.time + 10);
    }
    if (line.words.length === 0 && line.text) line.words = [{ time: line.time, end: line.end, text: line.text }];
    line.words.forEach((w, j) => (w.end = line.words[j + 1]?.time ?? line.end));
  });

  return { title: meta.ti, artist: meta.ar, lines };
}
