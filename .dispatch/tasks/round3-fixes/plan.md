# Round 3 — 미수정 24건 수정

- [x] 데이터 Critical: pg_cron으로 당일 자정 check_ins 삭제 구현 — cleanup_daily_check_ins() 함수 생성 완료. pg_cron은 Supabase Dashboard에서 활성화 필요
- [x] 데이터 High: next_queue_number를 advisory lock으로 레이스 컨디션 방지, reservation_to_checkin 단일 RPC 트랜잭션 생성
- [x] 데이터 Medium: CHECK 3건 (check_ins.status, reservations.status, payments.method), 인덱스 12개, daily_closings UNIQUE, soft delete(deleted_at), REPLICA IDENTITY FULL (payments, customers)
- [x] 프론트엔드 High: optimistic update 실패 시 rollback 패턴 — updateStatus에서 DB 에러 시 이전 상태 복원 + toast
- [x] 프론트엔드 Medium: lazy loading (6개 Admin 페이지), 공통 인터페이스 src/types/index.ts 생성, Suspense + LoadingSpinner
- [x] 기능 High: 예약 등록 모달에 시술 종류 선택 드롭다운 추가 (services 테이블에서 로드, reservations.service_id 컬럼 추가)
- [x] 기능 High: 고객 상세 패널에 "예약 잡기" 버튼 → /admin/reservations?customer_id=xxx 이동, 자동 고객 선택 + 모달 오픈
- [x] 기능 High: 주간뷰 요일 헤더에 해당 일자 예약 건수 표시
- [x] 기능 High: TM 팀원 계정 — reservations/check_ins에 created_by 컬럼 추가, 현재 로그인 이메일 기록, 예약 상세에 작성자 표시
- [x] 기능 Medium: 같은 고객 동일 날짜 중복 예약 시 경고 confirm
- [x] 기능 Medium: 리콜 대상 표시 — 고객 목록에서 마지막 방문 60일 이상 경과 시 "리콜" 뱃지
- [x] 기능 Medium: 예약 변경 이력 — reservation_logs 테이블 생성 (id, reservation_id, action, old_values, new_values, created_by, created_at), 생성/수정/취소 시 자동 기록
- [x] URGENT: 일마감/직원관리 백지 — 빌드 성공 확인. Suspense + LoadingSpinner 추가로 로딩 중 표시 개선
- [x] npx vite build + git commit + push
- [x] Write summary to .dispatch/tasks/round3-fixes/output.md
