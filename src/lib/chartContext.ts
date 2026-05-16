/**
 * T-20260516-foot-CHART2-STATE-UNIFY — 2번차트 열림 단일 소스
 *
 * AC-1: "2번차트가 열렸다"는 사실을 AdminLayout 레벨 단일 Context로 통합.
 * URL 쿼리 대신 Context 채택 이유:
 *   - /admin → /admin/customers 등 페이지 전환 시 searchParams 소실
 *   - AdminLayout이 모든 admin 페이지를 <Outlet>으로 감쌈 → 자연스러운 provider 위치
 *   - 이미 ChartSheetCloseCtx 패턴 존재 — 일관성 유지
 *
 * 제거 대상 (이 파일로 통합):
 *   - Dashboard.tsx:1768 `dashChartSheetId`
 *   - CheckInDetailSheet.tsx:517 `chartSheetId`
 *   - Customers.tsx:81 `chart2Id`
 *   - CustomerChartSheet 4곳 중복 렌더 → AdminLayout 1곳으로 단일화
 */
import { createContext, useContext } from 'react';

export interface ChartContextValue {
  chartId: string | null;
  openChart: (customerId: string) => void;
  closeChart: () => void;
}

export const ChartContext = createContext<ChartContextValue>({
  chartId: null,
  openChart: () => {},
  closeChart: () => {},
});

/** 2번차트 열기/닫기/ID 읽기. AdminLayout 하위 어디서나 사용 가능. */
export function useChart(): ChartContextValue {
  return useContext(ChartContext);
}
