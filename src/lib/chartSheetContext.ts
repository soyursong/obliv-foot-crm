// LOGIC-LOCK: L-003 — 차트 수정사항 CRM 전체 고객 동일 적용. 변경 시 현장 승인 필수
/**
 * T-20260514-foot-CHART2-OPEN-BUG
 * CustomerChartSheet ↔ CustomerChartPage 순환 참조 방지를 위해 별도 파일로 분리.
 * CustomerChartSheet: Provider 설정
 * CustomerChartPage: useChartSheetClose() 로 읽기
 */
import { createContext, useContext } from 'react';

/** Sheet 모드에서 패널 닫기 콜백. null이면 독립 페이지(/chart/:id 직접 접근) 모드 */
export const ChartSheetCloseCtx = createContext<(() => void) | null>(null);

/** Sheet 모드 여부 감지 + 닫기 함수 반환. CustomerChartPage 헤더에서 사용 */
export function useChartSheetClose(): (() => void) | null {
  return useContext(ChartSheetCloseCtx);
}
