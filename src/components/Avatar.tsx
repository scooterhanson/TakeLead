import { useEffect, useState } from 'react';

/** Round avatar: the guest's photo, or their initials on a color picked from their name. */
export function Avatar({ name, url, size = 40, className = '' }: { name: string; url?: string | null; size?: number; className?: string }) {
  // If the photo can't load, show initials rather than an empty circle.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => [...w][0] ?? '')
      .join('')
      .toUpperCase() || '?';
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  if (!name.trim() && !(url && !failed))
    return (
      <span
        className={`avatar avatar-initials avatar-empty ${className}`}
        aria-hidden
        style={{ width: size, height: size, background: 'var(--card-2)' }}
      >
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="currentColor">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" />
        </svg>
      </span>
    );
  return url && !failed ? (
    <img
      className={`avatar ${className}`}
      src={url}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  ) : (
    <span
      className={`avatar avatar-initials ${className}`}
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 55% 45%)` }}
    >
      {initials}
    </span>
  );
}
