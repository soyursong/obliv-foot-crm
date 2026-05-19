// LOGIC-LOCK: L-003 — 차트 수정사항 CRM 전체 고객 동일 적용. 변경 시 현장 승인 필수
/**
 * T-20260516-foot-CHART-OPEN-UNIFY AC-2 — 진료차트 열림 단일 소스
 *
 * MedicalChartPanel(진료차트)을 AdminLayout 레벨 단일 Context로 통합.
 * chartContext.ts(2번차트)와 동일 패턴.
 *
 * 제거 대상 (이 파일로 통합):
 *   - Dashboard.tsx: medicalChartOpen / medicalChartCustomerId + MedicalChartPanel 렌더
 *   - Customers.tsx: medicalChartOpen / medicalChartCustomerId + MedicalChartPanel 렌더
 *   - Reservations.tsx: resvMedicalChartOpen / resvMedicalChartCustomerId + MedicalChartPanel 렌더
 *   → AdminLayout 1곳 단일 렌더로 통합
 */
import { createContext, useContext } from 'react';

export interface MedicalChartContextValue {
  medicalChartId: string | null;
  openMedicalChart: (customerId: string) => void;
  closeMedicalChart: () => void;
}

export const MedicalChartContext = createContext<MedicalChartContextValue>({
  medicalChartId: null,
  openMedicalChart: () => {},
  closeMedicalChart: () => {},
});

/** 진료차트 열기/닫기/ID 읽기. AdminLayout 하위 어디서나 사용 가능. */
export function useMedicalChart(): MedicalChartContextValue {
  return useContext(MedicalChartContext);
}
