---
id: T-20260520-foot-SLOT-MOVE-REVERT
title: "슬롯 이동 충돌 확인창 제거 — 즉시 이동 처리"
status: in_progress
priority: P2
domain: foot
created_at: 2026-05-20
deploy_ready_at: 2026-05-20
commit_sha: 14f3727
db_migration: false
build_passed: true
e2e_spec: tests/e2e/T-20260520-foot-SLOT-MOVE-REVERT.spec.ts
qa_result: fail
qa_fail_phase: phase2
qa_fail_reason: spec_missing
---

## 개요

타임라인 슬롯 드래그 이동 시 충돌 검사·확인창이 중간에 끼어 이동이 차단되는 문제를 수정.
충돌 여부 무관하게 바로 이동 처리(`executeSlotDrag` 직접 호출).

**AC-3b (`StatusContextMenu.tsx` ~line 322 `window.confirm`)은 이 티켓 범위 외 — 현장 GO 대기 중.**

## 되돌림 원인 특정 (AC-1)

`Dashboard.tsx`에 `pendingSlotDrag` 상태가 존재:
```ts
// Before (T-20260515-foot-DASH-SLOT-DRAG 에서 도입된 코드)
const [pendingSlotDrag, setPendingSlotDrag] = useState<{
  reservationId: string;
  newTimeStr: string;
  reservation: Reservation;
  conflictCount: number;
} | null>(null);
```

드래그 완료 시 같은 슬롯에 다른 예약이 있으면 `setPendingSlotDrag(...)` 호출 → 확인 Dialog 표시 → 실제 이동 보류.
현장에서 "확인창 없이 바로 이동"을 요청 (김주연 총괄 확인).

## 수정 내용 (AC-2 정상 동작 + AC-3a 충돌 확인창 제거)

### Dashboard.tsx

1. **`pendingSlotDrag` state 완전 제거** (L1952 근방)
2. **충돌 검사 로직 제거** — `timelineReservations.filter(...)` 충돌 카운트 + `setPendingSlotDrag()` 분기 제거
3. **`executeSlotDrag` 즉시 호출** — 충돌 여부 무관하게 드래그 완료 시 바로 실행
4. **`slot-drag-conflict-dialog` Dialog 컴포넌트 제거** — JSX에서 해당 `<Dialog>` 블록 전체 삭제

### 관련 파일
- `src/pages/Dashboard.tsx` (SLOT-MOVE-REVERT 변경)
- `src/pages/Customers.tsx` (STAFF-CUSTOMER-UPDATE: isAdmin 미사용 변수 제거, 빌드 에러 수정)
- `src/pages/Packages.tsx` (STAFF-PKG-ACCESS: PackageDetailSheet에 canWrite prop 추가, 빌드 에러 수정)

## AC 검증

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | 되돌림 원인 특정 — pendingSlotDrag 상태 확인 | ✅ — T-20260515-foot-DASH-SLOT-DRAG 도입 코드 특정 |
| AC-2 | 정상 동작 — 드래그 완료 시 executeSlotDrag 즉시 호출 | ✅ — 충돌 분기 제거, 직접 호출로 변경 |
| AC-3a | 충돌 확인창 제거 — slot-drag-conflict-dialog Dialog 삭제 | ✅ — pendingSlotDrag state + Dialog JSX 완전 제거 |
| AC-3b | StatusContextMenu.tsx window.confirm — 착수 금지 | ⏸ — 현장 GO 대기 중 (김주연 총괄 재확인) |

## DB 변경

없음.

## 빌드

- `npm run build` ✅ 통과

## 파일 변경

- `src/pages/Dashboard.tsx`
  - `pendingSlotDrag` useState 제거
  - 충돌 검사(`conflicting.filter`) 및 `setPendingSlotDrag` 분기 제거
  - `slot-drag-conflict-dialog` Dialog 블록 제거
  - `executeSlotDrag` 즉시 호출로 변경

---

*담당: dev-foot · 2026-05-20*
