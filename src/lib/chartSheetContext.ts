// LOGIC-LOCK: L-003 — 차트 수정사항 CRM 전체 고객 동일 적용. 변경 시 현장 승인 필수
/**
 * T-20260514-foot-CHART2-OPEN-BUG
 * CustomerChartSheet ↔ CustomerChartPage 순환 참조 방지를 위해 별도 파일로 분리.
 * CustomerChartSheet: Provider 설정
 * CustomerChartPage: useChartSheetClose() 로 읽기
 */
import { createContext, useContext, useEffect } from 'react';
import type { MutableRefObject } from 'react';

/** Sheet 모드에서 패널 닫기 콜백. null이면 독립 페이지(/chart/:id 직접 접근) 모드 */
export const ChartSheetCloseCtx = createContext<(() => void) | null>(null);

/** Sheet 모드 여부 감지 + 닫기 함수 반환. CustomerChartPage 헤더에서 사용 */
export function useChartSheetClose(): (() => void) | null {
  return useContext(ChartSheetCloseCtx);
}

/**
 * T-20260609-foot-CHART2-SAVE-CLOSE-BTN
 * "저장 후 닫기"용 저장 핸들러 등록 채널.
 * - Sheet(CustomerChartSheet)가 MutableRef를 Provider로 내려주고,
 *   Page(CustomerChartPage)가 본문 저장 버튼과 "동일한" 저장 핸들러(handleInfoPanelSave)를
 *   매 렌더마다 ref.current에 등록한다(신규 저장 경로 추가 X — 기존 핸들러 재사용).
 * - 저장 성공/실패를 Sheet가 판단하도록 Promise<boolean>(true=성공/닫기 가능)을 반환.
 * - null이면 독립 페이지 모드(Sheet 아님) → 등록 무시.
 */
export type ChartSaveFn = () => Promise<boolean>;
export const ChartSheetSaveRegistryCtx =
  createContext<MutableRefObject<ChartSaveFn | null> | null>(null);

/** 본문 저장 핸들러를 Sheet에 등록. 매 렌더마다 최신 클로저로 갱신, 언마운트 시 해제. */
export function useRegisterChartSave(saveFn: ChartSaveFn): void {
  const reg = useContext(ChartSheetSaveRegistryCtx);
  useEffect(() => {
    if (!reg) return; // 독립 페이지 모드
    reg.current = saveFn;
    return () => {
      reg.current = null;
    };
  }); // deps 없음 — 매 렌더 최신 saveFn 반영(stale closure 방지)
}

/**
 * T-20260611-foot-CHART2-SAVE-DIRTY-RESET
 * 본문 [저장] 직접 클릭으로 저장 성공 시, Sheet의 미저장 가드 dirty 상태(onInput proxy)를
 * clean으로 리셋하는 알림 채널. 신규 dirty 메커니즘 신설 X — 기존 dirtyRef를 그대로 끈다.
 * - Sheet(CustomerChartSheet)가 markChartClean(dirtyRef=false)을 Provider로 내려주고,
 *   Page(CustomerChartPage)가 handleInfoPanelSave 성공 시 호출.
 * - null이면 독립 페이지 모드(Sheet 아님) → no-op.
 */
export const ChartSheetMarkCleanCtx = createContext<(() => void) | null>(null);

/** Sheet dirty 가드를 clean으로 리셋. Sheet 모드 아니면 no-op 반환(독립 페이지 안전). */
export function useChartSheetMarkClean(): () => void {
  return useContext(ChartSheetMarkCleanCtx) ?? (() => {});
}
