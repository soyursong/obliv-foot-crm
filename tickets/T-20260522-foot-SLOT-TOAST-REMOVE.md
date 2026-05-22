---
id: T-20260522-foot-SLOT-TOAST-REMOVE
title: "슬롯 이동 완료 토스트 알림 제거"
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-05-22
deadline: 2026-05-26
deploy_ready_at: 2026-05-22
deploy_ready_by: dev-foot
db_migration: false
build_passed: true
build_time: "3.38s"
commit_sha: 1badbae
e2e_spec: ""
e2e_spec_exempt_reason: "FE-only 토스트 조건부 분기 제거. DB 변경 없음. 리스크 0/5."
related: T-20260522-foot-SLOT-TIMETABLE-POPUP (deploy-ready, same commit), T-20260520-foot-SLOT-MOVE-REVERT (deployed, 14f3727), T-20260522-foot-SLOT-POPUP-REGRESS (approved, resolved by same commit)
reporter: 김주연 총괄
reporter_slack_id: null
slack_channel: C0ATE5P6JTH
slack_thread_ts: 1779394750.209069
---

# T-20260522-foot-SLOT-TOAST-REMOVE

## 배경

대시보드 슬롯 간 드래그 이동 완료 시 우측 상단 토스트 팝업("레이저대기로 이동", "수납대기로 변경" 등)이 표시됨. 김주연 총괄 현장 판단: **불필요 — 제거 요청**.

- T-20260520-foot-SLOT-MOVE-REVERT(14f3727)로 **확인 모달**은 이미 제거됨
- 이번 건은 이동 **성공 후 표시되는 토스트 알림** 제거 (별개 UI 요소)
- 현장 승인: "굿 진행해줘"

## 구현 요약

**T-20260522-foot-SLOT-TIMETABLE-POPUP 커밋(1badbae)에서 함께 처리됨 (AC-2)**

### 제거 항목
- `undoDrag` + `toastWithUndo` 함수 제거
- `handleDragEnd` 내 8개 `toastWithUndo` 호출 제거 (상태별 이동 성공 토스트 전부)
- `handleContextStatusChange`: `toast.success(... (으)로 변경)` 제거
- `handleContextConsultStatusChange`: `toast.success(... 상담실 입실)` 제거
- `handleContextTreatmentStatusChange`: `toast.success(... 치료실 입실)` 제거
- `handleContextLaserStatusChange`: `toast.success(... 레이저실 입실)` 제거
- `executeSlotDrag`: `toast.success(... 이동 완료)` 제거

### 유지 항목 (AC-2)
- `toast.error(...)` 계열 전부 유지 (이동 실패 / DB 오류 안내)
- `toast.success('패키지 1회 자동 소진')` — 슬롯 이동 토스트가 아닌 패키지 회차 소진 업무 알림, 유지

## 수용기준 충족 확인

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | 슬롯 이동 성공 토스트 미표시 | ✅ toastWithUndo 전부 제거 |
| AC-2 | 에러 토스트 유지 | ✅ toast.error 전건 유지 |
| AC-3 | 기존 슬롯 이동 동작(DnD) 무영향 | ✅ SLOT-SNAP-FIX/DRAG-RESP-OPT/CHART-TAP-DELAY 코드 무변경 |

## 변경 파일
- `src/pages/Dashboard.tsx` (FE-only, DB 변경 없음, commit 1badbae와 동일)
