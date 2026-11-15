/** localStorage helpers. Every access is guarded: private mode or blocked storage must not break the app. */

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface HostedParty {
  code: string;
  name: string;
  hostToken: string;
  stageToken: string;
  createdAt: number;
}

export const storage = {
  hostedParties: () => read<HostedParty[]>('nos:hosted', []),
  hostedParty: (code: string) => storage.hostedParties().find((p) => p.code === code.toUpperCase()) ?? null,
  saveHostedParty(party: HostedParty) {
    write('nos:hosted', [party, ...storage.hostedParties().filter((p) => p.code !== party.code)].slice(0, 20));
  },
  forgetHostedParty(code: string) {
    write('nos:hosted', storage.hostedParties().filter((p) => p.code !== code));
  },

  guestId(): string {
    let id = read<string | null>('nos:guestId', null);
    if (!id) {
      id = randomId();
      write('nos:guestId', id);
    }
    return id;
  },
  singerName: () => read<string>('nos:singer', ''),
  setSingerName: (name: string) => write('nos:singer', name),

  songSort: (): 'artist' | 'title' | 'genre' => {
    const v = read<string>('nos:sort', 'artist');
    return v === 'title' || v === 'genre' ? v : 'artist';
  },
  setSongSort: (v: string) => write('nos:sort', v),

  myEntries: (code: string) => read<string[]>(`nos:mine:${code}`, []),
  addMyEntry: (code: string, id: string) => write(`nos:mine:${code}`, [...storage.myEntries(code), id].slice(-50)),
};
