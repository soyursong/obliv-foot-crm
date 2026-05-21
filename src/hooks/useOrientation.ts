import { useEffect, useState } from 'react';

/**
 * T-20260522-foot-TABLET-DUAL-LAYOUT
 * 기기 orientation(landscape/portrait)을 추적하는 훅.
 * window.matchMedia('(orientation: landscape)') 기반.
 * SSR-safe: window 미존재 시 'landscape' fallback.
 */
export type Orientation = 'landscape' | 'portrait';

export function useOrientation(): Orientation {
  const [orientation, setOrientation] = useState<Orientation>(() => {
    if (typeof window === 'undefined') return 'landscape';
    return window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
  });

  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const handler = (e: MediaQueryListEvent) => {
      setOrientation(e.matches ? 'landscape' : 'portrait');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return orientation;
}
