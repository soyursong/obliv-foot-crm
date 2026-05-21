---
id: T-20260521-foot-DUMMY-TEST-DATA
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
db_change: true
rollback_sql: scripts/rollback_testdata_20260522.mjs
spec_file: tickets/T-20260521-foot-DUMMY-TEST-DATA.md
summary: "5/22 현장 테스트용 더미 데이터 64명 생성 (초진32+재진32, 8슬롯×4+4)"
created: 2026-05-21
updated: 2026-05-21
reporter: 김주연 총괄 (U0ATDB587PV)
---

# T-20260521-foot-DUMMY-TEST-DATA — 풋센터 CRM 5/22 현장 테스트 더미 데이터

## 배경

5/22 풋센터 원내 CRM 실사용 테스트. 초진/재진 시간대별 4명씩 더미 고객+예약 필요.
김주연 총괄 직접 요청, P1 승격.

## AC (Acceptance Criteria)

- [x] **AC-1**: 초진 고객 32명 + 재진 고객 32명 (customers INSERT, is_simulation=true)
- [x] **AC-2**: 예약 64건 (reservations, 날짜 2026-05-22, 10~17시 1h간격)
- [x] **AC-3**: 셀프접수 매칭 보장 — E.164 phone 정합, 초진=new플로우 / 재진=returning플로우
- [x] **AC-4**: 재진 고객 과거 check_in 1건 (2026-05-01, status=done) — 재진 판별 로직 충족
- [x] **AC-5**: 정리 가이드 — `WHERE name LIKE '[TEST6]%' AND is_simulation=true` 일괄 삭제

## 구현 내용

### 생성 파일
- `scripts/seed_testdata_20260522.mjs` — 메인 시드 스크립트 (파라미터 상단 집중)
- `scripts/rollback_testdata_20260522.mjs` — 정리 스크립트

### 데이터 구성

| 구분 | 슬롯 | 인원 | 총계 |
|------|------|------|------|
| 초진 | 10:00~17:00 (8슬롯) | 4명/슬롯 | 32명 |
| 재진 | 10:00~17:00 (8슬롯) | 4명/슬롯 | 32명 |
| **합계** | | | **64명** |

### 전화번호 범위
- 신규: `+821099060001` ~ `+821099060032` (010-9906-0001 ~ 010-9906-0032)
- 재진: `+821099061001` ~ `+821099061032` (010-9906-1001 ~ 010-9906-1032)

### 이름 패턴
- `[TEST6] 신규01` ~ `[TEST6] 신규32`
- `[TEST6] 재진01` ~ `[TEST6] 재진32`

### 파라미터 (조정 가능)
```javascript
// scripts/seed_testdata_20260522.mjs 상단
const TARGET_DATE   = '2026-05-22';
const START_HOUR    = 10;   // 시작 시간
const END_HOUR      = 17;   // 마지막 슬롯
const SLOT_INTERVAL = 1;    // 간격(시간)
const NEW_PER_SLOT  = 4;    // 슬롯당 초진
const RET_PER_SLOT  = 4;    // 슬롯당 재진
```

## 셀프접수 테스트 방법

1. URL: `https://obliv-foot-crm.vercel.app/checkin/jongno-foot`
2. 신규 전화번호: `010-9906-0001` (슬롯 10:00, 1번째 환자)
3. 재진 전화번호: `010-9906-1001` (슬롯 10:00, 1번째 재진)
4. 슬롯별 4명 순차 테스트 가능

## 정리 (테스트 종료 후)

```bash
node scripts/rollback_testdata_20260522.mjs
```

또는 Supabase SQL:
```sql
-- check_ins, reservations, customers 순서로 삭제 (FK 의존)
DELETE FROM check_ins
WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE '[TEST6]%' AND is_simulation = true);
DELETE FROM reservations
WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE '[TEST6]%' AND is_simulation = true);
DELETE FROM customers WHERE name LIKE '[TEST6]%' AND is_simulation = true;
```

## DB 변경 사항

- **INSERT**: customers ×64, reservations ×64, check_ins ×32 (재진 과거 체크인)
- **DELETE 가이드**: is_simulation=true + [TEST6] prefix 일괄 삭제 가능
- **실 고객 충돌 방지**: 전화번호 범위 +82109906XXXX는 기존 고객 범위와 분리됨

## 실행 방법

```bash
cd ~/Documents/GitHub/obliv-foot-crm
node scripts/seed_testdata_20260522.mjs
```
