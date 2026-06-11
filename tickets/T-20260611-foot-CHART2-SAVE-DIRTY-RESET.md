---
ticket_id: T-20260611-foot-CHART2-SAVE-DIRTY-RESET
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-11
deploy_ready_at: 2026-06-12
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260611-foot-CHART2-SAVE-DIRTY-RESET.spec.ts
db_changed: false
rollback_sql: ""
risk_level: GO (0/5)
commit_sha: 3cbd175
---

# T-20260611-foot-CHART2-SAVE-DIRTY-RESET — 2번차트 본문 저장 성공 시 미저장 가드 dirty 리셋

## 배경 (현장 버그)

풋센터 2번차트(CustomerChartSheet) 본문 [저장] 버튼 직접 클릭 → 저장 성공해도, 닫기(백드롭/X/ESC) 시
"작성 중인 내용이 있습니다" 미저장 가드 팝업이 여전히 노출됨.
= 저장 성공이 Sheet 의 dirty 플래그(onInput proxy)를 clean 으로 안 풀어줌.

## 진단

- 페이지(CustomerChartPage)의 `isDirty` 는 handleInfoPanelSave 성공 시 `setIsDirty(false)` 로 리셋되지만,
  Sheet(CustomerChartSheet)의 미저장 가드를 구동하는 `dirtyRef`(패널 `onInput` proxy)는 별개 상태라 리셋되지 않음.
- 본문 [저장](chart-info-save-btn)은 handleInfoPanelSave 를 Sheet 경유 없이 직접 호출 → Sheet 가 저장 성공을 인지 못함.

## 수정 (신규 dirty 메커니즘 신설 X)

- `chartSheetContext.ts`: `ChartSheetMarkCleanCtx` + `useChartSheetMarkClean()` 추가 — Sheet→Page clean 알림 채널.
- `CustomerChartSheet.tsx`: `markChartClean = () => { dirtyRef.current = false; }` 를 Provider 로 제공
  (기존 dirtyRef 그대로 끈다 = baseline 을 방금 저장값으로 갱신). 독립 페이지 모드는 null→no-op.
- `CustomerChartPage.tsx`: handleInfoPanelSave 전체 성공(`allOk===true`) 시 `markChartClean()` 호출.
  부분 실패(allOk=false)면 미저장 내용 잔존 → 가드 유지(리셋 안 함).

## AC

- AC-1: 본문 저장 성공 시 dirty=clean 초기화 + baseline = 방금 저장값. ✅
- AC-2: 저장 후 추가입력 없으면 닫기 시 confirm 미노출 / 저장 후 재수정하면 onInput 재발화로 confirm 재노출. ✅
- AC-3: SAVE-CLOSE-BTN "저장 후 닫기"·UNSAVED-GUARD 3선택지 동작 무변경. CustomerChartSheet 한정(CheckInDetailSheet 범위 밖). ✅

## E2E 회귀 (tests/e2e/T-20260611-foot-CHART2-SAVE-DIRTY-RESET.spec.ts)

- S1: 본문 [저장] 성공 후 ESC 닫기 → 가드 미노출
- S1b: 본문 [저장] 성공 후 백드롭 클릭 → 가드 미노출
- S2: 저장 성공 후 재수정 → ESC 닫기 시 가드 3선택지 재노출
- S3: 저장 없이 수정만 → ESC 시 가드 3선택지 정상 노출 + 취소(계속 작성) 보존

## 비고

- DB 변경 없음. FE-only.
- 테스트 타깃 testid 추가: `chart-info-save-btn`, `chart-email-input`.
- commit: 3cbd175
