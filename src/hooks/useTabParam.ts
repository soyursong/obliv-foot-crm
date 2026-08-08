import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * T-20260808-foot-CRM-REFRESH-ROUTE-PERSIST (AC-2): 서브탭 상태를 URL query(?tab=...)에 반영해
 *   브라우저 새로고침(F5/Cmd+R) 후에도 마지막 서브탭이 복원되도록 하는 재사용 훅.
 *
 * 배경(RC): 메인 라우트(/admin/*)는 BrowserRouter + URL path 기반이라 SPA fallback(_redirects /*→index.html)만
 *   있으면 새로고침에 이미 유지된다. 하지만 각 페이지 내부 '서브탭'은 useState 기본값으로만 관리되어
 *   URL에 미반영 → 새로고침 시 초기 탭으로 리셋된다(현장이 느끼는 '튕김'의 실체). 일부 페이지는 진입 시
 *   ?tab= 를 '읽기'만 하고 탭 전환 시 '되쓰지' 않아 사용자 전환분이 새로고침에 유실된다.
 *
 * 설계:
 *   - URL(?tab=)을 단일 진실원(source of truth)으로 삼는다 → 별도 local state 불필요, 새로고침/딥링크 정합.
 *   - 유효값 화이트리스트(valid)로 검증, 미지정·무효 → fallback(기본 탭). 딥링크 오염 방어.
 *   - setTab 은 replace:true (history push 아님) → 탭 클릭이 브라우저 뒤로가기 히스토리를 오염시키지 않음.
 *   - 다른 query 파라미터는 보존(기존 ?id= 등 딥링크 회귀 방지).
 *   - key 로 페이지 내 복수 탭 그룹(예: 주탭 'tab' + 보조탭 'sub')을 독립 관리.
 *
 * 회귀 무결: 기존 라우트/딥링크(AC-4)에 영향 없음 — path 는 건드리지 않고 query 만 추가/갱신한다.
 */
export function useTabParam<T extends string>(options: {
  /** URL query key. 페이지 내 탭 그룹이 여러 개면 그룹별로 다른 key 사용. 기본 'tab'. */
  key?: string;
  /** 허용 탭 값 화이트리스트 — URL 오염/무효값 방어. */
  valid: readonly T[];
  /** 미지정·무효 시 기본 탭. */
  fallback: T;
}): [T, (next: T) => void] {
  const { key = 'tab', valid, fallback } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get(key);
  const current = (raw && (valid as readonly string[]).includes(raw) ? raw : fallback) as T;

  const setTab = useCallback(
    (next: T) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set(key, next);
          return p;
        },
        { replace: true },
      );
    },
    [key, setSearchParams],
  );

  return [current, setTab];
}
