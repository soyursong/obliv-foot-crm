import { useEffect, useState } from 'react';
import { getClinic } from '@/lib/clinic';
import type { Clinic } from '@/lib/types';

/**
 * 클리닉 정보를 가져오는 공용 훅.
 * 8개+ 페이지에서 반복되던 useState + useEffect + getClinic() 보일러플레이트를 통합.
 *
 * T-20260616-foot-LASER-TIMER-SETTING-NOREFLECT:
 *   mount 시 1회만 읽으면, 다른 스테이션에서 clinics 설정(laser_time_units 등)을 바꿔도
 *   이미 열려 있는 화면(2번차트 태블릿)이 갱신되지 않는다. 키오스크 환경에선 하드리로드도
 *   불확실하므로, 창이 다시 포커스/가시화될 때 force 재조회해 최신 설정을 반영한다.
 *   (clinic row 는 작아 focus 재조회 비용 무시 가능)
 */
export function useClinic(): Clinic | null {
  const [clinic, setClinic] = useState<Clinic | null>(null);

  useEffect(() => {
    let alive = true;
    const load = (force = false) => {
      getClinic(force ? { force: true } : undefined)
        .then((c) => { if (alive) setClinic(c); })
        .catch(() => { if (alive) setClinic((prev) => prev ?? null); });
    };
    load();

    const onFocus = () => load(true);
    const onVisible = () => { if (document.visibilityState === 'visible') load(true); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return clinic;
}
