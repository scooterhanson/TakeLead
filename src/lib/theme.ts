import { useEffect } from 'react';
import type { PartyTheme } from '../shared/types.ts';

/** Apply a party theme to the whole page (CSS variables keyed off <html data-theme>). */
export function useTheme(theme: PartyTheme | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme ?? 'classic';
    return () => {
      root.dataset.theme = 'classic';
    };
  }, [theme]);
}
