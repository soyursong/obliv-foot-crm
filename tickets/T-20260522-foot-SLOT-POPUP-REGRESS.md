---
id: T-20260522-foot-SLOT-POPUP-REGRESS
title: 슬롯 이동 확인 팝업 회귀 제거
domain: foot
status: deploy-ready
priority: P1
created: 2026-05-22
completed: 2026-05-22
deploy_ready: true
db_changes: false
commit: 94bfd83
build: ok
---

## 배경

T-20260520-foot-SLOT-MOVE-REVERT에서 슬롯 이동 확인 다이얼로그가 이미 제거되어 즉시 이동 동작이 확정됐음.
T-20260522-foot-RESV-MOVE-CONFIRM(취소됨)이 확인 팝업을 재삽입하여 회귀 발생.

대표 방침: "슬롯 이동할 때 안내창 팝업 굳이 필요없다." → 즉시 이동이 올바른 동작.

## 수용 기준

- AC-1: `slotMoveConfirm` useState 선언 제거
- AC-2: handleDragEnd 내 setSlotMoveConfirm 호출 → `await executeSlotDrag(...)` 직접 호출로 교체
- AC-3: JSX Dialog 블록(T-20260522-foot-RESV-MOVE-CONFIRM 주석 포함) 제거
- AC-4: `npm run build` 성공

## 대상 파일

- `src/pages/Dashboard.tsx`

## 원인 티켓

T-20260522-foot-RESV-MOVE-CONFIRM (CANCELLED)
