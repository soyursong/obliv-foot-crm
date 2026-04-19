# Round 3 수정 완료 요약

> 완료일: 2026-04-10
> 커밋: 760f07c `fix: Round 3 — data integrity + features + lazy loading`

## DB 변경 (Supabase ose_execute)

### 함수
- `cleanup_daily_check_ins()` — 자정 시 전일 미완료 check_ins 삭제 (pg_cron 필요 → Dashboard에서 활성화 후 `SELECT cron.schedule('cleanup-daily-checkins', '0 0 * * *', 'SELECT cleanup_daily_check_ins()')`)
- `next_queue_number()` — `pg_advisory_xact_lock`으로 레이스 컨디션 방지
- `reservation_to_checkin()` — 예약→체크인 atomic 트랜잭션 (queue 번호 + check_in insert + reservation status 업데이트를 단일 함수로)

### 스키마
- **인덱스 12개**: check_ins(clinic_id,created_date), check_ins(customer_id), reservations(clinic_id,reservation_date), reservations(customer_id,reservation_date), payments(check_in_id), payments(customer_id), check_in_services(check_in_id), room_assignments(clinic_id,work_date), staff(clinic_id,active), services(clinic_id,active), daily_closings(clinic_id,close_date) UNIQUE, reservation_logs(reservation_id)
- **CHECK 제약**: check_ins.status (7값), reservations.status (4값), payments.method (card/cash)
- **컬럼 추가**: reservations.service_id, reservations.created_by, check_ins.created_by, clinics.deleted_at
- **신규 테이블**: `reservation_logs` (id, reservation_id, action, old_values, new_values, created_by, created_at)
- **REPLICA IDENTITY FULL**: payments, customers

### 데이터 정리
- reservations.status = 'no_show' → 'cancelled' (4건) — CHECK 제약 적용 위해

## 프론트엔드 변경

### src/App.tsx
- 6개 Admin 페이지 `React.lazy()` + `Suspense` + `LoadingSpinner` 적용

### src/types/index.ts (신규)
- 공통 인터페이스: Customer, VisitRecord, PaymentRecord, ReservationRecord, ServiceRecord

### src/pages/AdminDashboard.tsx
- `updateStatus()`: optimistic update 실패 시 이전 상태로 rollback + destructive toast

### src/pages/AdminReservations.tsx
- 시술 종류 드롭다운 (services 테이블에서 로드, service_id 저장)
- created_by: 현재 로그인 이메일 자동 기록
- 중복 예약 경고: 같은 고객/같은 날짜 시 confirm
- 예약 변경 이력: 생성/수정/취소 시 reservation_logs에 자동 기록
- 주간뷰 요일 헤더에 예약 건수 표시
- 체크인: atomic `reservation_to_checkin` RPC 사용
- URL param `?customer_id=xxx` → 자동 고객 선택 + 모달 오픈
- 예약 상세에 작성자(created_by) 표시

### src/components/AdminLayout.tsx
- 고객 상세 패널에 "예약 잡기" 버튼 → `/admin/reservations?customer_id=xxx`

### src/pages/AdminCustomers.tsx
- 리콜 뱃지: 마지막 방문 60일 이상 경과 시 오렌지 "리콜" 뱃지

## 미완료 / 후속 필요

1. **pg_cron 활성화**: Supabase Dashboard > Database > Extensions에서 pg_cron 활성화 후 cron.schedule() 실행 필요
2. **NOT NULL 제약 4건**: 기존 데이터에 NULL이 있을 수 있어 데이터 정리 후 적용 필요 (check_ins.clinic_id, reservations.clinic_id, reservations.customer_id, check_in_services.check_in_id)
