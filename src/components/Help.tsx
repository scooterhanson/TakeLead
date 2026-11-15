import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from './common.tsx';

type Audience = 'guest' | 'host';

interface Topic {
  q: string;
  a: ReactNode;
}
interface Section {
  title: string;
  topics: Topic[];
}

const GUEST_HELP: Section[] = [
  {
    title: 'Singing',
    topics: [
      {
        q: 'How do I sign up to sing?',
        a: (
          <>
            On the <b>Songs</b> tab, tap a song, enter your name, and tap <b>Add me to the queue</b>. Search by song, artist or
            genre, or change the sort order with the <b>Sort</b> buttons.
          </>
        ),
      },
      {
        q: "Why can't I pick a song?",
        a: (
          <>
            Songs marked <b>In queue</b> are already taken; each song can be in the queue once. If every song is grayed out, the
            host has paused sign-ups.
          </>
        ),
      },
      {
        q: 'When is my turn?',
        a: (
          <>
            The <b>Queue</b> tab shows the order. Your sign-ups are marked <b>You</b>, and a banner at the top tells you how many
            songs are ahead of you. When you're up, your name appears on the TV.
          </>
        ),
      },
      {
        q: 'How do I cancel a sign-up?',
        a: (
          <>
            On the <b>Queue</b> tab, tap <b>✕</b> next to your song. You can't cancel once your song has started; ask the host.
          </>
        ),
      },
    ],
  },
  {
    title: 'Your profile',
    topics: [
      {
        q: 'How do I add a photo or change my name?',
        a: (
          <>
            Tap your picture in the top-right corner. You can add a photo, change your name, and write a short line about
            yourself. Your photo and that line appear on the TV when it's your turn.
          </>
        ),
      },
      {
        q: 'Why was my name rejected?',
        a: <>Someone at this party is already using it. Add an initial or a nickname.</>,
      },
      {
        q: 'Who can see my photo?',
        a: <>Everyone at the party: it's shown in the queue and on the TV. The host can remove it.</>,
      },
    ],
  },
  {
    title: 'Problems',
    topics: [
      {
        q: "The page isn't updating.",
        a: <>Reload the page. Your sign-ups are saved on this phone and will still be there.</>,
      },
      {
        q: 'I switched phones or browsers.',
        a: (
          <>
            Each phone counts as a separate guest. Sign-ups made on another phone stay with that phone, and only the host can
            remove them.
          </>
        ),
      },
    ],
  },
];

const HOST_HELP: Section[] = [
  {
    title: 'Getting started',
    topics: [
      {
        q: 'How do I set up the TV?',
        a: (
          <>
            On the computer connected to the TV, open the host dashboard and click <b>Open Now Playing screen</b>. Click{' '}
            <b>Start the show</b> once (browsers block sound until you click), then go full screen. You can also cast the
            browser tab from Chrome (⋮ menu → Cast).
          </>
        ),
      },
      {
        q: 'How do guests join?',
        a: (
          <>
            They scan the QR code on the TV or in the <b>Invite guests</b> card. You can also send them the guest link, or they
            can enter the 4-letter party code on the home page.
          </>
        ),
      },
      {
        q: 'Can I run the party from my phone?',
        a: (
          <>
            Yes. Sign in on your phone if the party is saved to your account, or use <b>Copy host link</b> and open it on your
            phone. Keep the host link private: anyone with it can control the party.
          </>
        ),
      },
    ],
  },
  {
    title: 'Running the queue',
    topics: [
      {
        q: 'What happens between singers?',
        a: (
          <>
            When a song ends, the TV shows the next singer's name and waits. Press <b>Play</b> when they have the mic.{' '}
            <b>Next singer</b> skips ahead; <b>Restart</b> starts the current song over.
          </>
        ),
      },
      {
        q: 'How do I change the order or remove someone?',
        a: (
          <>
            Drag a row, or use the arrows (<b>⤒</b> moves to the top). <b>✕</b> removes a sign-up. <b>🙈</b> hides a guest's
            photo and blurb.
          </>
        ),
      },
      {
        q: 'Can I add someone who has no phone?',
        a: (
          <>
            Yes: <b>+ Add singer</b> in the Queue card. Guest rules (one name per person, no repeated songs) don't apply to
            singers you add.
          </>
        ),
      },
      {
        q: 'How do I stop new sign-ups?',
        a: (
          <>
            Turn off <b>Sign-ups open</b> in the Queue card. People already in the queue keep their places.
          </>
        ),
      },
    ],
  },
  {
    title: 'Songs',
    topics: [
      {
        q: 'Whole catalog or my playlist?',
        a: (
          <>
            In <b>Song library</b>, choose whether guests see every song on the server or only your party playlist. Use{' '}
            <b>+ Playlist</b> to add songs to the party playlist.
          </>
        ),
      },
      {
        q: 'How do I add YouTube songs?',
        a: (
          <>
            Open <b>Add songs</b> and paste a YouTube video or playlist link. Search YouTube for the song name plus
            &quot;karaoke&quot;. Videos whose owners block playback on other sites are skipped and listed.
          </>
        ),
      },
      {
        q: 'Can I use my own karaoke files?',
        a: (
          <>
            Yes, if you run the server. Put files in its <code>media</code> folder named <code>Artist - Title.mp4</code>, or an
            audio file plus a matching <code>.lrc</code> lyrics file, then click <b>Rescan media folder</b>.
          </>
        ),
      },
      {
        q: 'A song has the wrong name or genre.',
        a: (
          <>
            Names and genres are filled in automatically and are sometimes wrong. Click <b>✎</b> next to the song to fix
            them; your changes are kept.
          </>
        ),
      },
      {
        q: 'How do I reuse a playlist at another party?',
        a: (
          <>
            Sign in, then under <b>Saved playlists</b> save the party playlist with a name. Load it into any party later, or
            pick it when you create a new party.
          </>
        ),
      },
    ],
  },
  {
    title: 'Problems',
    topics: [
      {
        q: "There's no sound on the TV.",
        a: (
          <>
            Click <b>Start the show</b> on the Now Playing screen. Check that the browser tab isn't muted and that the
            computer's audio goes to the TV.
          </>
        ),
      },
      {
        q: 'The TV says "Can\'t play this one".',
        a: (
          <>
            The video was removed or its owner blocks playback on other sites. Click <b>Next singer</b>, then delete the song
            in Full catalog and add a different version.
          </>
        ),
      },
      {
        q: 'Ads play before YouTube songs.',
        a: <>Sign in to YouTube Premium in the browser that shows the Now Playing screen.</>,
      },
      {
        q: "The TV doesn't move on to the next singer.",
        a: (
          <>
            Open the Now Playing screen from the host dashboard's <b>Open Now Playing screen</b> button. A screen opened from a
            plain link can show the party but can't advance it.
          </>
        ),
      },
    ],
  },
];

function Sections({ sections }: { sections: Section[] }) {
  return (
    <div className="help">
      {sections.map((s) => (
        <section key={s.title}>
          <h3 className="section-label">{s.title}</h3>
          {s.topics.map((t) => (
            <details key={t.q} className="help-topic">
              <summary>{t.q}</summary>
              <div className="help-answer">{t.a}</div>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}

/** Help panel over the current page. */
export function HelpSheet({ audience, onClose }: { audience: Audience; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet help-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{audience === 'host' ? 'Hosting help' : 'Help'}</h2>
        <Sections sections={audience === 'host' ? HOST_HELP : GUEST_HELP} />
        <div className="row">
          <a className="small" href="/help" target="_blank" rel="noreferrer">
            All help topics
          </a>
          <button className="btn btn-primary grow" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function HelpButton({ audience, label = 'Help' }: { audience: Audience; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-sm btn-ghost help-btn" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <HelpSheet audience={audience} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The full help page at /help. */
export function HelpPage() {
  const [tab, setTab] = useState<Audience>(() => (window.location.hash === '#host' ? 'host' : 'guest'));
  return (
    <div className="page help-page">
      <header className="row spread">
        <Link to="/" className="plain">
          <Logo small />
        </Link>
      </header>
      <h1>Help</h1>
      <nav className="tabs">
        <button className={tab === 'guest' ? 'active' : ''} onClick={() => setTab('guest')}>
          Guests
        </button>
        <button className={tab === 'host' ? 'active' : ''} onClick={() => setTab('host')}>
          Hosts
        </button>
      </nav>
      <div className="card">
        <Sections sections={tab === 'host' ? HOST_HELP : GUEST_HELP} />
      </div>
    </div>
  );
}
