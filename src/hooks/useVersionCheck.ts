/**
 * T-20260610-foot-SPA-VERSION-AUTORELOAD
 *
 * 배포 후 현장 태블릿이 in-memory 구번들로 도는 stale-app 재발방지.
 * 번들에 박힌 로컬 BUILD_ID(vite define) 와 서버의 /version.json(no-cache)을
 * 주기적으로(또는 탭이 visible 로 전환될 때) 비교해, 다르면 '새 버전 있음'을 알린다.
 *
 * 설계 원칙 (AC-2 안전시점 제약):
 *   이 훅은 자동 reload 를 절대 트리거하지 않는다. updateAvailable 플래그만 노출한다.
 *   실제 reload 는 사용자가 배너의 '새로고침' 을 클릭할 때만 발생(UpdateBanner).
 *   → 문자 발송 모달·차트 편집·폼 입력 중 강제 reload 로 인한 작업 유실을 구조적으로 차단.
 *
 * 무패키지: fetch + visibilitychange/focus 이벤트 + setInterval 만 사용.
 */
import { useEffect, useRef, useState } from 'react';

/**
 * 빌드 시 vite.config define(__APP_BUILD_ID__) 으로 치환되는 전역 상수.
 * import.meta.env.* 대신 plain global 을 쓰는 이유: dev 모드에서도 안정적으로 주입되어
 * dev/E2E 에서 버전 비교가 실제로 동작한다(부모 QA 실패 #1 의 근본원인).
 */
declare const __APP_BUILD_ID__: string;
const LOCAL_BUILD_ID: string | undefined =
  typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : undefined;

// E2E/디버깅용: import.meta(직렬화 불가) 없이 page.evaluate 로 로컬 빌드 ID 를 읽도록 노출.
if (typeof window !== 'undefined') {
  (window as unknown as { __BUILD_ID__?: string }).__BUILD_ID__ = LOCAL_BUILD_ID;
}

/** 폴링 주기 — 과하지 않게 10분 (AC-4). visibility/focus 전환 시엔 즉시 체크. */
const POLL_INTERVAL_MS = 10 * 60 * 1000;
/** 과도한 중복 체크 방지 — 최소 60초 간격 보장. */
const MIN_CHECK_GAP_MS = 60 * 1000;
const VERSION_URL = '/version.json';

async function fetchRemoteBuildId(signal?: AbortSignal): Promise<string | null> {
  try {
    // 캐시 우회: no-store + 캐시버스터 쿼리 (vercel.json 도 no-cache 헤더 부여)
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { buildId?: unknown };
    return typeof data.buildId === 'string' ? data.buildId : null;
  } catch {
    // 네트워크 오류·오프라인·dev 404 등은 조용히 무시 (정상 사용 방해 금지)
    return null;
  }
}

export function useVersionCheck(): { updateAvailable: boolean } {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const lastCheckRef = useRef(0);
  const detectedRef = useRef(false);

  useEffect(() => {
    // 로컬 빌드 ID 가 없으면(define 미주입 등) 비교 불가 → 비활성 (안전)
    if (!LOCAL_BUILD_ID) return;

    let cancelled = false;
    const controller = new AbortController();

    // force=true: throttle 무시(최초 마운트 체크). StrictMode dev 이중 마운트에서
    //   1차 마운트의 fetch 가 cleanup 으로 abort 되며 lastCheckRef 만 갱신해두면,
    //   2차 마운트의 일반 체크가 MIN_CHECK_GAP 에 막혀 끝까지 fetch 를 못 하는 race 가 있다.
    //   최초 체크를 강제하면 2차 마운트에서 새 controller 로 정상 fetch 가 완료된다.
    const check = async (force = false) => {
      if (detectedRef.current) return; // 이미 감지됨 → 추가 폴링 불필요
      const now = Date.now();
      if (!force && now - lastCheckRef.current < MIN_CHECK_GAP_MS) return;
      lastCheckRef.current = now;

      const remote = await fetchRemoteBuildId(controller.signal);
      if (cancelled || !remote) return;
      if (remote !== LOCAL_BUILD_ID) {
        detectedRef.current = true;
        setUpdateAvailable(true);
      }
    };

    // 최초 1회 체크 (throttle 우회 — 마운트 직후 즉시 1회 보장)
    void check(true);

    const interval = window.setInterval(() => void check(), POLL_INTERVAL_MS);
    const onActive = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onActive);
    window.addEventListener('focus', onActive);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onActive);
      window.removeEventListener('focus', onActive);
    };
  }, []);

  return { updateAvailable };
}
