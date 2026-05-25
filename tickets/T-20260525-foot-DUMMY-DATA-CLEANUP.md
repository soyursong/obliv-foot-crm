---
id: T-20260525-foot-DUMMY-DATA-CLEANUP
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
db_change: true
rollback_sql: scripts/rollback_dummy_all_20260525.sql
spec_file: tickets/T-20260525-foot-DUMMY-DATA-CLEANUP.md
summary: "운영 DB 테스트 더미 데이터 232건 전건 삭제 — V1(96건, 5/22) + V2(136건, 5/25) 통합 클린업"
created: 2026-05-25
updated: 2026-05-25
assignee: dev-foot
reporter: planner
e2e_spec_exempt_reason: db_only
risk_verdict: GO_WARN
risk_reason: "대량 삭제 232건. 롤백 SQL(scripts/rollback_dummy_all_20260525.sql) 사전 생성 완료. is_simulation=true 조건으로 실 고객 영향 없음."
qa_result: pass
---

# T-20260525-foot-DUMMY-DATA-CLEANUP — 운영 DB 테스트 더미 데이터 232건 제거

## 배경

5/22(V1, 96건) + 5/25(V2, 136건) 현장 테스트용 더미 데이터가 운영 DB에 잔존하여 아코디언 패널 등에 노출.
UNREQ-BOTTOM-UI 조사 중 발견. AC-7 아코디언은 정상 기능(QA PASS, a8c0517), 문제는 데이터임.

## AC (Acceptance Criteria)

- [x] **AC-1**: 이름 LIKE '테스트초진%' / '테스트재진%' AND is_simulation=true 전건 삭제
  - V1 (5/22): 테스트초진01~48 + 테스트재진01~48 (96건, +821000000201~296)
  - V2 (5/25): 테스트초진01~68 + 테스트재진01~68 (136건, +821099060001~136)
- [x] **AC-2**: 롤백 SQL 사전 생성 — `scripts/rollback_dummy_all_20260525.sql`
  - 삭제 전 customers(232), reservations(237), check_ins(182), payments(26+6), service_charges(3), timer_records(3), check_in_services(59), status_transitions(280), form_submissions(5), customer_treatment_memos(2) 전량 백업
- [x] **AC-3**: 삭제 후 테스트 데이터 0건 확인 (검증 완료)
- [x] **AC-4**: 빌드 확인 불필요 (코드 변경 없음, DB data-fix only)

## 실행 결과

### 사전 현황 (삭제 전)
| 테이블 | 건수 |
|--------|------|
| customers | 232명 |
| check_ins | 182건 |
| reservations | 237건 |
| payments | 32건 |
| service_charges | 3건 |
| timer_records | 3건 |
| check_in_services | 59건 |
| status_transitions | 280건 |
| form_submissions | 5건 |
| customer_treatment_memos | 2건 |

### FK 체인 (발견된 순서)
1. `payments.check_in_id` → check_ins
2. `form_submissions.check_in_id` → check_ins  
3. `check_in_services.check_in_id` → check_ins
4. `status_transitions.check_in_id` → check_ins
5. `service_charges.check_in_id` → check_ins (NOT NULL, RESTRICT)
6. `timer_records.check_in_id` → check_ins
7. `payments.customer_id` → customers (잔존 6건 — customer_id로 2차 삭제)

### 삭제 완료 (실행 스크립트)
- `scripts/cleanup_testdata_dummy_20260525.mjs` — V1+V2 통합 클린업 (FK 전체 체인 대응)

### 검증
- `node scripts/dryrun_dummy_cleanup.mjs` → customers: **0명** ✅

## 비표준 전화번호 주의 사항

`테스트초진04 / 010-6354-9255` — 이름은 테스트 패턴, 전화번호는 일반 번호 형식.
`is_simulation=true` 확인 후 삭제 포함. 실 고객 아님 (is_simulation 플래그 기준).

## 롤백

```bash
# Supabase SQL 편집기에서 실행
# 또는 psql $DATABASE_URL < scripts/rollback_dummy_all_20260525.sql
```

## 이력

| 일시 | 내용 |
|------|------|
| 2026-05-25 | 태스크 수신 (MSG-20260525-185216-vabx, planner) |
| 2026-05-25 | dry-run 조회: 232명 확인 |
| 2026-05-25 | 롤백 SQL 생성 완료 |
| 2026-05-25 | cleanup 실행: FK 체인(payments/service_charges/timer_records 등) 순차 해결 후 232명 삭제 완료 |
| 2026-05-25 | 검증: customers 0건 확인 ✅ |
