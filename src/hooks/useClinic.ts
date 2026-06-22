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
        // T-20260622-foot-LOADING-FLICKER-TRIAGE RC 수정:
        //   focus/visibility 시 force 재조회는 매번 새 객체 reference 를 반환한다.
        //   다수 화면(통계·예약·대시보드 등)이 `clinic` 객체를 data-fetch useEffect 의존성에
        //   넣어두어, 내용이 동일해도 reference 변경만으로 effect 가 재실행 → setLoading(true)
        //   → 전체 로딩 화면으로 깜빡임("숨바꼭질"). 다른 탭/채팅 보고 복귀할 때마다 재현.
        //   → 내용이 실제로 바뀐 경우에만 새 reference 로 교체(stable identity). LASER-TIMER
        //     설정 반영 의도는 보존(값이 바뀌면 reference 도 바뀌어 소비처가 갱신됨).
        .then((c) => {
          if (!alive) return;
          setClinic((prev) =>
            prev && JSON.stringify(prev) === JSON.stringify(c) ? prev : c,
          );
        })
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
