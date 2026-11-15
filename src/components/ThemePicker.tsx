import { THEMES, type PartyTheme } from '../shared/types.ts';

/** Grid of live mini-previews; each tile renders with its own theme's variables. */
export function ThemePicker({ value, onChange }: { value: PartyTheme; onChange: (t: PartyTheme) => void }) {
  return (
    <div className="theme-grid" role="radiogroup" aria-label="Party theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={value === t.id}
          className={`theme-tile ${value === t.id ? 'selected' : ''}`}
          onClick={() => onChange(t.id)}
        >
          <span className="theme-preview" data-theme={t.id}>
            <span className="tp-window">
              <span className="tp-title" />
              <span className="tp-line" />
              <span className="tp-line short" />
              <span className="tp-button" />
            </span>
          </span>
          <span className="theme-label">
            {t.label}
            {t.id === 'classic' && <small className="muted"> (default)</small>}
          </span>
        </button>
      ))}
    </div>
  );
}
