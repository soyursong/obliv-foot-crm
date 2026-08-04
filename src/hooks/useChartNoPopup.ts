import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useChart } from '@/lib/chartContext';

/**
 * T-20260804-foot-CHARTNUM-POPUP-GLOBALIZE — 차트번호 클릭 → 2번차트 팝업 공통 훅.
 *
 * 배경: T-20260717-foot-CLOSING-CHARTNUM-POPUP 이 일마감>결제내역 차트번호 셀에만 준
 * "클릭 → 고객 2번차트 별도 팝업" UX 를, 차트번호가 노출되는 모든 화면으로 커버리지 확장한다.
 *
 * 단일 게이트웨이 재사용(LOGIC-LOCK L-004 정합): 새 window.open 을 복제하지 않고
 * AdminLayout 의 ChartContext.openChart(=차트 접근 단일 경로)를 소비한다. openChart 는
 * 사용자 제스처 안에서 window.open(별도 팝업창) → 팝업차단/자동화 시 in-page 서랍(CustomerChartSheet)
 * 폴백까지 이미 처리한다(§11 의료게이트 비대상: 직원용 1·2번 차트 = 미니홈피).
 *
 * AC-3(이벤트 전파 충돌 방지): 차트번호가 클릭 가능한 부모(행/카드/메뉴/모달) 안에 있을 때
 * 부모 onClick 으로 버블링되지 않도록 stopPropagation 한다. customerId 없으면 no-op(비활성).
 *
 * 사용:
 *   const openChartNo = useChartNoPopup();
 *   <span className={cn('...', customerId && CHARTNO_LINK_CLASS)}
 *         onClick={customerId ? (e) => openChartNo(customerId, e) : undefined} />
 */

/** 차트번호가 클릭 활성일 때 붙이는 공통 클래스(호버 강조 + 포인터). */
export const CHARTNO_LINK_CLASS = 'cursor-pointer hover:text-primary hover:underline';

export function useChartNoPopup() {
  const { openChart } = useChart();
  return useCallback(
    (customerId: string | null | undefined, e?: ReactMouseEvent) => {
      if (!customerId) return;
      // AC-3: 부모 행/카드/메뉴 onClick 전파 차단(중복 액션·오오픈 방지).
      e?.stopPropagation();
      openChart(customerId);
    },
    [openChart],
  );
}
