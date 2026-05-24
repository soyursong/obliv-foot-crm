---
id: T-20260525-foot-RESV-CANCEL-CTX
domain: foot
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: true
e2e-spec: true
summary: "예약 취소 컨텍스트메뉴 경로 완료. 대시보드 우클릭+모달 연결(handleReservationContext+handleDashCancelConfirm). 예약관리 CustomerQuickMenu onCancelReservation 연결. DB: reservations.cancelled_by 마이그레이션 포함. 빌드 3.16s OK."
---

## T-20260525-foot-RESV-CANCEL-CTX — 예약 취소 컨텍스트메뉴 경로

### 구현 완료 (commit 201e940)

**AC-1**: 예약 박스 우클릭(데스크탑)/롱프레스(태블릿) → `ReservationContextMenu` "예약 취소" 버튼
- `DashboardTimeline` `onReservationContext` 콜백 → `handleReservationContext` 함수
- `ReservationBox` `onContextMenu` 핸들러 추가 (신규/재진 양쪽)

**AC-2**: `ReservationCancelModal` — 취소사유 textarea 필수 입력 (미입력 시 확인 버튼 비활성)

**AC-3**: `handleDashCancelConfirm` — reservations.status→cancelled + cancel_reason/cancelled_at/cancelled_by + reservation_logs 감사 로그

**AC-4**: 낙관적 업데이트 — `setTimelineReservations` 즉시 반영 (대시보드+예약관리)

### 변경 파일

| 파일 | 내용 |
|------|------|
| `src/components/ReservationCancelModal.tsx` | 신규: 취소사유 입력 모달 |
| `src/components/ReservationContextMenu.tsx` | 신규: 우클릭/롱프레스 컨텍스트메뉴 |
| `src/components/CustomerQuickMenu.tsx` | onCancelReservation optional prop 추가 |
| `src/pages/Dashboard.tsx` | handleReservationContext + handleDashCancelConfirm + JSX 렌더링 |
| `src/pages/Reservations.tsx` | cancelTarget/handleResvCancelConfirm + ReservationCancelModal 렌더링 |
| `src/lib/types.ts` | Reservation.cancelled_by 필드 추가 |
| `supabase/migrations/20260525000001_reservation_cancel_by.sql` | cancelled_by 컬럼 마이그레이션 |
| `tests/e2e/T-20260525-foot-RESV-CANCEL-CTX.spec.ts` | E2E 5개 테스트 |

### DB 변경

```sql
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT NULL;
```

### 빌드

```
✓ built in 3.16s
```
