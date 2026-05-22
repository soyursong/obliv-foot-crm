// LOGIC-LOCK: L-003 — 차트 수정사항 CRM 전체 고객 동일 적용. 변경 시 현장 승인 필수
// LOGIC-LOCK: L-004 — 차트 접근 경로 잠금. useChart() hook / ChartContext 단일 경로만 허용. 변경 시 현장 승인 필수
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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CRITICAL: DO NOT MODIFY — Chart Open Guard
 * T-20260519-foot-CHART-OPEN-GUARD: ChartContext(openChart/closeChart/chartId)는
 * 초진·재진·체험 전 경로의 1·2번 차트 열림의 단일 게이트웨이.
 * 이 인터페이스를 변경하면 CHART2-REOPEN 류 버그가 즉시 재발함.
 * 변경 전 반드시 supervisor 승인 필요. 회귀 방지 spec:
 * tests/e2e/T-20260519-foot-CHART-OPEN-GUARD.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createContext, useContext } from 'react';

export interface ChartContextValue {
  chartId: string | null;
  openChart: (customerId: string) => void;
  closeChart: () => void;
}

// LOGIC-LOCK: L-004 [CHART-LOCK-002] — ChartContext 단일 소스. 우회·복제 금지.
export const ChartContext = createContext<ChartContextValue>({
  chartId: null,
  openChart: () => {},
  closeChart: () => {},
});

/** 2번차트 열기/닫기/ID 읽기. AdminLayout 하위 어디서나 사용 가능. */
// LOGIC-LOCK: L-004 [CHART-LOCK-001] — useChart() 단일 게이트웨이. 직접 useContext(ChartContext) 우회 금지.
export function useChart(): ChartContextValue {
  return useContext(ChartContext);
}
