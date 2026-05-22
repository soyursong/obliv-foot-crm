---
id: T-20260522-foot-SLOT-TIMETABLE-POPUP
title: "통합시간표 확인창 + 슬롯 이동 성공 토스트 제거"
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-05-22
deadline: 2026-05-26
deploy_ready_at: 2026-05-22
deploy_ready_by: dev-foot
db_migration: false
build_passed: true
build_time: "3.16s"
commit_sha: 1badbae
e2e_spec: ""
e2e_spec_exempt_reason: "FE-only 팝업/토스트 조건부 분기. DB 변경 없음. 리스크 0/5."
related: T-20260522-foot-RESV-MOVE-CONFIRM (deployed), T-20260522-foot-SLOT-SNAP-FIX (deployed), T-20260522-foot-DRAG-RESP-OPT (deployed), T-20260522-foot-TIMETABLE-FOLD (deployed)
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
slack_channel: C0ATE5P6JTH
slack_thread_ts: 1779417682.362319
---

# T-20260522-foot-SLOT-TIMETABLE-POPUP

## 구현 요약

### AC-1 (완료): 통합시간표 예약 시간 변경 확인 다이얼로그
- T-20260522-foot-RESV-MOVE-CONFIRM에서 이미 구현 완료
- `slotMoveConfirm` 상태 + Dialog 컴포넌트 (data-testid="slot-move-confirm-dialog")
- [확인] → `executeSlotDrag` 실행, [취소] → `setSlotMoveConfirm(null)` (원위치)

### AC-2 (이번 구현): 슬롯 이동 성공 토스트 제거
- `undoDrag` + `toastWithUndo` 함수 제거 (handleDragEnd에서 8개 호출 제거)
- `handleContextStatusChange`: `toast.success(...(으)로 변경)` 제거
- `handleContextConsultStatusChange`: `toast.success(... 입실)` 제거
- `handleContextTreatmentStatusChange`: `toast.success(... 입실)` 제거
- `handleContextLaserStatusChange`: `toast.success(... 입실)` 제거
- `executeSlotDrag`: `toast.success(... 이동 완료)` 제거
- 에러 토스트(`toast.error`)는 모두 유지 (AC-3)

### AC-4 (회귀 없음)
- SLOT-MOVE-REVERT: 취소 시 원위치 동작은 slotMoveConfirm 상태 미업데이트로 유지
- SLOT-SNAP-FIX: snapToCursorModifier 코드 미변경
- DRAG-RESP-OPT: DnD 최적화 코드 미변경
- TIMETABLE-FOLD: 접기/펼치기 코드 미변경

## 변경 파일
- `src/pages/Dashboard.tsx` (FE-only, DB 변경 없음)
