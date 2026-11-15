import { LrcPlayer } from './LrcPlayer.tsx';
import { VideoPlayer } from './VideoPlayer.tsx';
import { YouTubePlayer } from './YouTubePlayer.tsx';
import type { PlayerProps } from './types.ts';

export function SongPlayer(props: PlayerProps) {
  switch (props.song.source.kind) {
    case 'youtube':
      return <YouTubePlayer {...props} />;
    case 'video':
      return <VideoPlayer {...props} />;
    case 'lrc':
      return <LrcPlayer {...props} />;
  }
}
