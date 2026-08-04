/**
 * CbandBetaBadge.tsx — 코밴 'BETA' 표기 배지 (단일 지점 SSOT · 토글)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260804-foot-CBAND-TERMINAL-CANCEL-BETA-BADGE
 *
 * ★ AC-2(단일 지점 토글/상수): BETA 표기는 이 파일 한 곳에서 관리한다.
 *   안정화 후 제거 = CBAND_BETA 를 false 로 바꾸면 전 호출부에서 배지가 사라진다
 *   (호출부 JSX 삭제 없이 원복 가능). "도입 중이라 문제 시 기존 방식 복귀 → 안정화되면 뗀다" 대비.
 *
 * ★ 재사용(신규 배지 구현 지양): T-20260803-foot-CBAND-DIRECTPAY-BETA-BADGE(결제 버튼 BETA, deployed)
 *   의 배지 스타일/문구(amber-100/amber-700 · text-[10px] · uppercase)를 그대로 계승.
 *   ※ DIRECTPAY(CbandPayEntryButton) 는 deployed 자산이라 무접촉 — 본 컴포넌트는 [단말기 취소]에만 적용.
 */

/** BETA 표기 전역 토글 — 안정화되면 false (AC-2 단일 지점). */
export const CBAND_BETA = true;

/**
 * 'BETA' 배지 1개. DIRECTPAY 배지와 동일 룩앤필(위치 규칙 동일 = 라벨 옆).
 *  · className: 호출부에서 margin 등 미세 위치 보정(기본 ml-1 = 라벨 옆).
 *  · testid   : 호출부별 고유 지정(동일 목록 다중 렌더 대비).
 */
export function CbandBetaBadge({
  testid = 'cband-beta-badge',
  className = 'ml-1',
}: {
  testid?: string;
  className?: string;
}) {
  if (!CBAND_BETA) return null;
  return (
    <span
      className={`${className} inline-block rounded-sm bg-amber-100 px-1 py-px text-[10px] font-bold uppercase leading-none tracking-wide text-amber-700`}
      data-testid={testid}
    >
      BETA
    </span>
  );
}
