# 데이터 관리자 관점 리뷰

- [x] DB 스키마 점검: 인덱스 누락, 외래키 관계, 중복 데이터 가능성, NULL 처리 — 12개 인덱스 누락, NOT NULL 4건, CHECK 3건, UNIQUE 1건 발견
- [x] RLS 정책 점검: 모든 테이블에 적절한 행 수준 보안, 지점 간 데이터 격리 — CRITICAL: 익명 사용자가 전체 고객/체크인 데이터 접근 가능. 지점 간 격리 없음
- [x] 데이터 정합성: 예약-체크인-결제 간 연결 무결성, 고아 레코드 가능성 — next_queue_number 레이스 컨디션, 예약→체크인 비원자적 트랜잭션, 환불 고아 레코드
- [x] 개인정보: 전화번호 마스킹 일관성, 당일 자정 삭제 정책 구현 여부, 로그 보관 — 전화번호 평문 저장 + 익명 REST API 접근 가능(CRITICAL), PII 보관 기한 없음
- [x] 성능: N+1 쿼리, 불필요한 전체 테이블 스캔, 페이지네이션 누락 — Dashboard realtime 과도 리패치, AdminCustomers 비효율 집계, ilike full scan
- [x] 백업/복구: 실수로 삭제한 데이터 복구 방법, 마감 확정 취소 시 데이터 무결성 — 마감 스냅샷 없음, 소프트 삭제 미적용, CASCADE 삭제 위험
- [x] Supabase Realtime: REPLICA IDENTITY 설정, 구독 필터 효율성 — check_ins/reservations FULL OK, payments/customers DEFAULT
- [x] 발견 이슈 + SQL 수정문을 .dispatch/tasks/data-review/output.md에 작성 — 12개 이슈, 우선순위별 정리 완료
