---
id: T-20260525-foot-DUMMY-DATA-GEN
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
db_change: true
rollback_sql: scripts/rollback_dummy_20260526.mjs
spec_file: tickets/T-20260525-foot-DUMMY-DATA-GEN.md
summary: "5/26 초진/재진 시간대별 더미 예약 데이터 72건 생성 (9슬롯 × 초진4+재진4, 2026-05-26)"
created: 2026-05-25
updated: 2026-05-25
assignee: dev-foot
reporter: planner
e2e_spec_exempt_reason: db_only
risk_verdict: GO_WARN
risk_reason: "대량 INSERT 72건. 롤백 스크립트(scripts/rollback_dummy_20260526.mjs) 준비 완료. is_simulation=true 마킹으로 실 운영 데이터와 구분."
qa_result: pass
---

# T-20260525-foot-DUMMY-DATA-GEN — 5/26 더미 예약 72건 생성

## 배경

김주연 총괄 요청. T-20260525-foot-DUMMY-DATA-CLEANUP(232건 삭제) 직후 클린 상태에서
5/26 현장 시뮬레이션용 신규 더미 예약 데이터 생성.

## 스펙

| 항목 | 값 |
|------|----|
| 날짜 | 2026-05-26 |
| 슬롯 | 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00, 18:00, 19:00 (9슬롯) |
| 초진(new) | 슬롯당 4명 × 9슬롯 = 36건 |
| 재진(returning) | 슬롯당 4명 × 9슬롯 = 36건 |
| **합계** | **72건** |
| 이름 패턴 | `더미_초진_HHMM_N` / `더미_재진_HHMM_N` |
| 전화(초진) | +821099050201 ~ +821099050236 |
| 전화(재진) | +821099050237 ~ +821099050272 |
| 마킹 | `is_simulation=true`, `created_by='dummy-seed-20260526'` |

## AC (Acceptance Criteria)

- [x] **AC-1**: customers 72건 INSERT (초진36 + 재진36, is_simulation=true)
- [x] **AC-2**: reservations 72건 INSERT (2026-05-26, 9슬롯 × 8건)
- [x] **AC-3**: 재진 36건 과거 체크인(2026-05-01) INSERT — 재진 판별 근거
- [x] **AC-4**: 롤백 스크립트 작성 (`scripts/rollback_dummy_20260526.mjs`)
- [x] **AC-5**: 빌드 확인 불필요 (코드 변경 없음, db_only)

## 실행 결과

### 삽입 완료

```
✅ customers 72건 (is_simulation=true, created_by='dummy-seed-20260526')
✅ reservations 72건 (2026-05-26, 9슬롯)
✅ check_ins 36건 (재진 과거체크인, 2026-05-01)
```

### AC 검증

| AC | 결과 |
|----|------|
| AC-1 customers 72건 | ✅ 72건 확인 |
| AC-2 reservations(2026-05-26) 72건 | ✅ 72건 확인 |
| AC-3 재진 과거체크인 | ✅ 36건 삽입 완료 |
| AC-4 롤백 스크립트 | ✅ scripts/rollback_dummy_20260526.mjs |
| AC-5 빌드 (db_only) | ✅ 코드 변경 없음 |

### 전화번호 충돌 검증

| 기존 범위 | 용도 | 상태 |
|----------|------|------|
| +821099050001~0020 | 5/17 [TEST5] 20건 | 분리됨 (0001~0020) |
| +821000000201~0296 | 5/22 V1 96건 | 클린업 완료 |
| +821099060001~0136 | 5/25 V2 136건 | 클린업 완료 |
| +82109999XXXX | 5/25 timeslot 64건 | 별도 범위 |
| **+821099050201~0272** | **이번 72건** | ✅ 충돌 없음 |

### 슬롯별 명단 (이름 패턴)

| 슬롯 | 초진 | 재진 |
|------|------|------|
| 11:00 | 더미_초진_1100_1~4 | 더미_재진_1100_1~4 |
| 12:00 | 더미_초진_1200_1~4 | 더미_재진_1200_1~4 |
| 13:00 | 더미_초진_1300_1~4 | 더미_재진_1300_1~4 |
| 14:00 | 더미_초진_1400_1~4 | 더미_재진_1400_1~4 |
| 15:00 | 더미_초진_1500_1~4 | 더미_재진_1500_1~4 |
| 16:00 | 더미_초진_1600_1~4 | 더미_재진_1600_1~4 |
| 17:00 | 더미_초진_1700_1~4 | 더미_재진_1700_1~4 |
| 18:00 | 더미_초진_1800_1~4 | 더미_재진_1800_1~4 |
| 19:00 | 더미_초진_1900_1~4 | 더미_재진_1900_1~4 |

## 롤백

```bash
node scripts/rollback_dummy_20260526.mjs
```

롤백 실행 시 삭제 전 백업 SQL 자동 생성: `scripts/rollback_dummy_backup_20260526.sql`

## 스크립트

- **생성**: `scripts/seed_dummy_20260526.mjs`
- **롤백**: `scripts/rollback_dummy_20260526.mjs`

## 이력

| 일시 | 내용 |
|------|------|
| 2026-05-25 | 태스크 수신 (MSG-20260525-200404-1obg, planner) |
| 2026-05-25 | 스크립트 작성 완료 (seed + rollback) |
| 2026-05-25 | 실행 완료: customers 72건 + reservations 72건 + check_ins 36건 |
| 2026-05-25 | AC 검증 통과 (customers 72 ✅, reservations 72 ✅) |
