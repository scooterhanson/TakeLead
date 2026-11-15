/* YouTube IFrame API loader and helpers (official embed API, no key required). */

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlaylist(): string[] | null;
  destroy(): void;
}
export interface YTNamespace {
  Player: new (el: HTMLElement, opts: unknown) => YTPlayer;
  PlayerState: { ENDED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytPromise: Promise<YTNamespace> | null = null;
export function loadYouTubeApi(): Promise<YTNamespace> {
  ytPromise ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      ytPromise = null;
      reject(new Error("Couldn't reach YouTube. Check the internet connection."));
    };
    document.head.appendChild(s);
  });
  return ytPromise;
}

/** Client-side mirror of the server's playlist-ID parser, used to adapt the form. */
export function playlistIdFromUrl(input: string): string | null {
  try {
    const list = new URL(input.trim()).searchParams.get('list');
    return list && /^[\w-]{10,64}$/.test(list) ? list : null;
  } catch {
    return null;
  }
}

export function hasVideoId(input: string): boolean {
  try {
    const u = new URL(input.trim());
    return !!u.searchParams.get('v') || u.hostname.endsWith('youtu.be');
  } catch {
    return false;
  }
}

/** Embed errors meaning "this particular video can't play here"; the playlist itself is fine. */
const VIDEO_BLOCKED_ERRORS = new Set([5, 100, 101, 150]);
const MAX_START_ATTEMPTS = 25;

/**
 * Read a playlist's video IDs by cueing it in a hidden embedded player (YouTube returns up to ~200).
 *
 * If the starting video can't be embedded, the player errors before exposing the playlist, so we
 * retry starting from the next index. Call the server's playlistInfo first: a nonexistent playlist
 * produces the same error code as a blocked video.
 */
export async function fetchPlaylistVideoIds(listId: string, onAttempt?: (startIndex: number) => void): Promise<string[]> {
  const YT = await loadYouTubeApi();
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;pointer-events:none;';
  document.body.appendChild(holder);

  const attempt = (index: number) => {
    const mount = document.createElement('div');
    holder.replaceChildren(mount);
    let player: YTPlayer | null = null;
    return new Promise<string[] | 'blocked'>((resolve, reject) => {
      let poll: ReturnType<typeof setInterval> | undefined;
      const finish = (fn: () => void) => {
        clearTimeout(timer);
        clearInterval(poll);
        try {
          player?.destroy();
        } catch {
          /* ignore */
        }
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error('YouTube took too long to respond. Try again.'))), 12000);
      player = new YT.Player(mount, {
        width: 320,
        height: 180,
        playerVars: { listType: 'playlist', list: listId, index, autoplay: 0 },
        events: {
          onReady: () => {
            poll = setInterval(() => {
              const ids = player?.getPlaylist();
              if (ids && ids.length) finish(() => resolve(ids));
            }, 200);
          },
          onError: (e: { data: number }) => {
            const ids = player?.getPlaylist();
            if (ids && ids.length) finish(() => resolve(ids));
            else if (VIDEO_BLOCKED_ERRORS.has(e.data)) finish(() => resolve('blocked'));
            else finish(() => reject(new Error(`YouTube couldn't open that playlist (error ${e.data}).`)));
          },
        },
      });
    });
  };

  try {
    for (let index = 0; index < MAX_START_ATTEMPTS; index++) {
      onAttempt?.(index);
      const result = await attempt(index);
      if (result !== 'blocked') return result;
    }
    throw new Error(
      `Couldn't read this playlist: its first ${MAX_START_ATTEMPTS} videos can't play outside YouTube. ` +
        'Try a playlist of karaoke videos from channels that allow it.',
    );
  } finally {
    holder.remove();
  }
}
