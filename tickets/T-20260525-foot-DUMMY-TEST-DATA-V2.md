---
id: T-20260525-foot-DUMMY-TEST-DATA-V2
domain: foot
priority: P1
status: deployed
deploy_ready: true
db_change: true
rollback_sql: scripts/rollback_testdata_20260525.mjs
spec_file: tickets/T-20260525-foot-DUMMY-TEST-DATA-V2.md
summary: "5/25 현장 테스트용 더미 데이터 136건 — 기본 96(12슬롯×8) + 16시이후 추가 40(4슬롯×10)"
created: 2026-05-25
updated: 2026-05-25
reporter: planner
assignee: dev-foot
e2e_spec_exempt_reason: db_only
risk_verdict: GO
risk_reason: "INSERT only, 더미 데이터(롤백 SQL 포함). 스키마 변경 없음. V1(5/22) 전화번호 범위와 완전 분리."
qa_result: pass
qa_grade: Yellow
deployed_at: 2026-05-25T09:03:37+09:00
deploy_commit: cbbafd577a3106177ff1262daab51e13bc2ac4b6
bundle_hash: 0dae4e625e8750be1743dede0f8bdd54
field_soak_until: 2026-05-26T09:03:37+09:00
---

# T-20260525-foot-DUMMY-TEST-DATA-V2 — 풋센터 CRM 5/25 현장 테스트 더미 데이터

## 배경

5/25 풋센터 원내 CRM 실사용 테스트 (V2).
선례: T-20260521-foot-DUMMY-TEST-DATA (5/22 96건, deployed).
16시 이후 슬롯 부하 테스트를 위해 슬롯당 추가 10건 요구.

## AC (Acceptance Criteria)

- [x] **AC-1**: 초진 고객 68명 (customers INSERT, is_simulation=true)
  - 기본: 12슬롯 × 4명 = 48명
  - 추가: 16시이후 4슬롯 × 5명 = 20명
- [x] **AC-2**: 재진 고객 68명 (같은 구조)
- [x] **AC-3**: 예약 136건 (reservations, 날짜 2026-05-25, 30분 간격)
  - 기본 슬롯: 10:00/10:30/11:00/11:30 / 14:00/14:30/15:00/15:30 / 16:00/16:30/17:00/17:30
  - 16시 이후 추가: 16:00/16:30/17:00/17:30 각 10건 추가
- [x] **AC-4**: 셀프접수 매칭 보장 — E.164 phone 정합, 초진=new플로우 / 재진=returning플로우
- [x] **AC-5**: 재진 고객 과거 check_in 1건 (2026-05-10, status=done) — 재진 판별 로직 충족
- [x] **AC-6**: 롤백 SQL 필수 — 전화번호 범위(`+82109905%`) 기반 일괄 삭제 가능
- [x] **AC-7**: V1(5/22) 데이터와 비중복 — 전화번호 범위 완전 분리

## 슬롯별 인원 구성

| 시간대 | 슬롯 | 기본(초진+재진) | 추가(초진+재진) | 슬롯당 합계 |
|--------|------|----------------|----------------|-------------|
| 오전 | 10:00~11:30 (4슬롯) | 4+4=8 | - | 8명 |
| 오후 전반 | 14:00~15:30 (4슬롯) | 4+4=8 | - | 8명 |
| 오후 후반 | 16:00~17:30 (4슬롯) | 4+4=8 | 5+5=10 | **18명** |

| 구분 | 기본 | 추가 | 총계 |
|------|------|------|------|
| 초진 | 48명 | 20명 | **68명** |
| 재진 | 48명 | 20명 | **68명** |
| **합계** | 96명 | 40명 | **136명** |

## 데이터 구성

### 이름 패턴
- `테스트초진01` ~ `테스트초진68`
- `테스트재진01` ~ `테스트재진68`

### 전화번호 범위 (V2 전용)
- 초진: `+821099060001` ~ `+821099060068` (010-9906-0001 ~ 010-9906-0068)
- 재진: `+821099060069` ~ `+821099060136` (010-9906-0069 ~ 010-9906-0136)
- ※ V1(5/22) 범위 `+82100000020X~029X` 와 완전 분리
- ※ `+82109905XXXX` 는 5/17 [TEST5] 20건 점유로 `+82109906XXXX` 로 shift (2026-05-25)

## 구현 파일

- `scripts/seed_testdata_20260525.mjs` — 메인 시드 스크립트
- `scripts/rollback_testdata_20260525.mjs` — 정리 스크립트

## 실행 방법

```bash
cd ~/Documents/GitHub/obliv-foot-crm
node scripts/seed_testdata_20260525.mjs
```

## 셀프접수 테스트 방법

1. URL: `https://obliv-foot-crm.vercel.app/checkin/jongno-foot`
2. 초진 전화번호: `010-9906-0001` ~ `010-9906-0068`
3. 재진 전화번호: `010-9906-0069` ~ `010-9906-0136`
4. 슬롯별 배정 (slotIdx × 9):
   - 10:00 → 초진#01~09, 재진#01~09
   - 10:30 → 초진#10~18, 재진#10~18 ... (기본슬롯 4명씩)
   - 16:00 → 기본 4명 + 추가 5명 = 9명 (초진), 9명 (재진)

## 정리 (테스트 종료 후)

```bash
node scripts/rollback_testdata_20260525.mjs
```

또는 Supabase SQL:
```sql
-- check_ins, reservations, customers 순서로 삭제 (FK 의존)
DELETE FROM check_ins
WHERE customer_id IN (SELECT id FROM customers WHERE phone LIKE '+82109906%' AND is_simulation = true);
DELETE FROM reservations
WHERE customer_id IN (SELECT id FROM customers WHERE phone LIKE '+82109906%' AND is_simulation = true);
DELETE FROM customers WHERE phone LIKE '+82109906%' AND is_simulation = true;
```

## 리스크 평가

| 항목 | 결과 |
|------|------|
| DB 스키마 변경 | X (INSERT only) |
| 외부 서비스 | X |
| 비즈니스 로직 변경 | X |
| V1 데이터 충돌 | X (전화번호 범위 분리) |
| 새 패키지 | X |
| **종합** | **GO (0/5)** |

## 이력

| 일시 | 내용 |
|------|------|
| 2026-05-25 | 티켓 생성, 스크립트 구현 (T-20260521 선례 재사용) |
| 2026-05-25 | seed 실행, DB INSERT 완료 → deploy-ready |
