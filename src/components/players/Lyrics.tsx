import type { CSSProperties } from 'react';
import type { Lrc, LrcLine } from '../../lib/lrc.ts';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function Line({ line, time, active }: { line: LrcLine; time: number; active: boolean }) {
  if (!line.text) return <div className="lyric-line lyric-gap">♪</div>;
  return (
    <div className={`lyric-line ${active ? 'active' : ''}`}>
      {line.words.map((w, i) => {
        const p = active ? clamp01((time - w.time) / Math.max(0.05, w.end - w.time)) : 0;
        return (
          <span key={i} className="lyric-word" style={{ '--p': `${(p * 100).toFixed(1)}%` } as CSSProperties}>
            {w.text}
          </span>
        );
      })}
    </div>
  );
}

/** Karaoke lyric display: the current line wipes word by word, upcoming lines wait below. */
export function Lyrics({ lrc, time, title, artist }: { lrc: Lrc; time: number; title: string; artist: string }) {
  const lines = lrc.lines;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].time <= time) idx = i;

  const first = lines.find((l) => l.text);
  const beforeStart = !first || time < first.time - 0.05;
  const countdown = first ? Math.ceil(first.time - time) : 0;

  // Show the current line (if still sounding) plus the next couple of lines.
  const current = idx >= 0 && time <= lines[idx].end + 0.6 ? lines[idx] : null;
  const upcoming = lines.slice(idx + 1).filter((l) => l.text).slice(0, current ? 1 : 2);

  return (
    <div className="lyrics">
      {beforeStart && (
        <div className="lyrics-title">
          <div className="lyrics-song">{title}</div>
          <div className="lyrics-artist">{artist}</div>
          {countdown > 0 && countdown <= 4 && (
            <div className="lyrics-countdown">
              {Array.from({ length: countdown }, (_, i) => (
                <span key={i}>●</span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="lyrics-lines">
        {current && <Line line={current} time={time} active />}
        {upcoming.map((l) => (
          <Line key={l.time} line={l} time={time} active={false} />
        ))}
      </div>
    </div>
  );
}
