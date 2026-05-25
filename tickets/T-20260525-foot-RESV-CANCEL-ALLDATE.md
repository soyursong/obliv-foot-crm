---
id: T-20260525-foot-RESV-CANCEL-ALLDATE
domain: foot
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: true
summary: "예약 취소 날짜 제한 해제. Dashboard.tsx DashboardTimeline onReservationContext prop의 !isPast 가드 제거 → 과거 날짜 포함 전체 날짜 취소 컨텍스트메뉴 표시. Reservations.tsx는 이미 날짜 무관 동작. 빌드 3.38s OK."
qa_result: pending
---

## T-20260525-foot-RESV-CANCEL-ALLDATE — 예약 취소 날짜 제한 해제 (당일 외 전체 날짜)

### 배경

commit 201e940(RESV-CANCEL-CTX)에서 대시보드 타임라인 onReservationContext 를 `!isPast` 조건으로 전달함.
→ 과거 날짜 이동 시 예약 카드 우클릭 메뉴 비활성화됨.
김주연 총괄 요청: 날짜 무관하게 모든 예약 취소 가능하게 확장.

### 변경 내용

**파일**: `src/pages/Dashboard.tsx`
**위치**: DashboardTimeline 컴포넌트 prop (라인 ~5574)

| Before | After |
|--------|-------|
| `onReservationContext={!isPast ? handleReservationContext : undefined}` | `onReservationContext={handleReservationContext}` |

- `handleReservationContext` 자체는 날짜 체크 없음 (단순 state setter)
- `ReservationContextMenu` — `cancelled` 상태만 비활성 처리 (AC-3 유지)
- `Reservations.tsx` — 이미 날짜 무관 동작 (변경 없음)

### 수용기준 달성

| AC | 상태 | 근거 |
|----|------|------|
| AC-1: 날짜 무관 취소 컨텍스트메뉴 노출 | ✅ | Dashboard.tsx !isPast 가드 제거 |
| AC-2: 기존 취소 모달·DB 업데이트 재사용 | ✅ | handleDashCancelConfirm 그대로 사용 |
| AC-3: cancelled 예약 버튼 비활성 | ✅ | ReservationContextMenu disabled 조건 유지 |

### 빌드
- `npm run build` → ✅ 3.38s OK

### DB 변경
없음 (FE only)
