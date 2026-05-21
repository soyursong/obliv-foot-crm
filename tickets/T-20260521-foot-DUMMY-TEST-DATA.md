---
id: T-20260521-foot-DUMMY-TEST-DATA
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
db_change: true
rollback_sql: scripts/rollback_testdata_20260522.mjs
spec_file: tickets/T-20260521-foot-DUMMY-TEST-DATA.md
summary: "5/22 현장 테스트용 더미 데이터 96건 — 30분 간격, 12슬롯(10:00~12:00, 14:00~18:00), 초진48+재진48"
created: 2026-05-21
updated: 2026-05-21 (시간 범위 확정 2026-05-21 22:19)
reporter: 김주연 총괄 (U0ATDB587PV)
---

# T-20260521-foot-DUMMY-TEST-DATA — 풋센터 CRM 5/22 현장 테스트 더미 데이터

## 배경

5/22 풋센터 원내 CRM 실사용 테스트. 초진/재진 시간대별 4명씩 더미 고객+예약 필요.
김주연 총괄 직접 요청, P1 승격.

## AC (Acceptance Criteria)

- [x] **AC-1**: 초진 고객 48명 + 재진 고객 48명 = 96명 (customers INSERT, is_simulation=true)
- [x] **AC-2**: 예약 96건 (reservations, 날짜 2026-05-22, **30분 간격**, **시간 범위 확정: 10:00~12:00, 14:00~18:00 / 12슬롯**)
  - 오전 4슬롯: 10:00 / 10:30 / 11:00 / 11:30
  - 오후 8슬롯: 14:00 / 14:30 / 15:00 / 15:30 / 16:00 / 16:30 / 17:00 / 17:30
  - 점심시간(12:00~14:00) 제외
  - 확정 출처: 현장 MSG-20260521-30854049 (김주연 총괄 2026-05-21 22:17)
- [x] **AC-3**: 셀프접수 매칭 보장 — E.164 phone 정합, 초진=new플로우 / 재진=returning플로우
- [x] **AC-4**: 재진 고객 과거 check_in 1건 (2026-05-01, status=done) — 재진 판별 로직 충족
- [x] **AC-5**: 정리 가이드 — `WHERE name LIKE '테스트초진%' OR name LIKE '테스트재진%'  AND is_simulation=true` 일괄 삭제

## 구현 내용

### 생성 파일
- `scripts/seed_testdata_20260522.mjs` — 메인 시드 스크립트 (파라미터 상단 집중)
- `scripts/rollback_testdata_20260522.mjs` — 정리 스크립트

### 데이터 구성

| 구분 | 슬롯 | 인원 | 총계 |
|------|------|------|------|
| 초진 | 12슬롯 (오전4+오후8), 30분 간격 | 4명/슬롯 | **48명** |
| 재진 | 12슬롯 (오전4+오후8), 30분 간격 | 4명/슬롯 | **48명** |
| **합계** | 12슬롯 × 8명 | | **96명** |

확정 슬롯: 10:00 / 10:30 / 11:00 / 11:30 / 14:00 / 14:30 / 15:00 / 15:30 / 16:00 / 16:30 / 17:00 / 17:30

### 전화번호 범위
- 초진: `+821000000201` ~ `+821000000248` (010-0000-0201 ~ 010-0000-0248)
- 재진: `+821000000249` ~ `+821000000296` (010-0000-0249 ~ 010-0000-0296)

> ⚠️ 범위 shift 이력: 010-0000-0001~0096 → 0201~0296 (기존 테스트환자21/22/23 충돌 회피, 2026-05-21)

### 이름 패턴
- `테스트초진01` ~ `테스트초진48`
- `테스트재진01` ~ `테스트재진48`

### 파라미터 (확정)
```javascript
// scripts/seed_testdata_20260522.mjs 상단
const TARGET_DATE = '2026-05-22';
const PAST_DATE   = '2026-05-01'; // 재진 과거 체크인

/** 확정 12슬롯 (2026-05-21 22:17 김주연 총괄) */
const SLOTS = [
  '10:00', '10:30', '11:00', '11:30',           // 오전 4타임
  '14:00', '14:30', '15:00', '15:30',            // 오후 전반 4타임
  '16:00', '16:30', '17:00', '17:30',            // 오후 후반 4타임
];

const NEW_PER_SLOT = 4; // 슬롯당 초진
const RET_PER_SLOT = 4; // 슬롯당 재진
```

## 셀프접수 테스트 방법

1. URL: `https://obliv-foot-crm.vercel.app/checkin/jongno-foot`
2. 초진 전화번호: `010-0000-0201` ~ `010-0000-0248` (슬롯 10:00 부터 4명씩 할당)
3. 재진 전화번호: `010-0000-0249` ~ `010-0000-0296` (슬롯 10:00 부터 4명씩 할당)
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

- **INSERT**: customers ×96, reservations ×96, check_ins ×48 (재진 과거 체크인)
- **DELETE 가이드**: is_simulation=true + 이름 LIKE '테스트초진%' OR '테스트재진%' 일괄 삭제 가능
- **실 고객 충돌 방지**: 전화번호 범위 +82100000020X~029X는 기존 고객 범위와 분리됨

## 이력

| 일시 | 내용 |
|------|------|
| 2026-05-21 21:55 | AC-2 슬롯 간격 30분 확정 (초기 1시간→30분 변경) |
| 2026-05-21 22:10 | 전화번호 0001~0096→0201~0296 shift (기존 충돌 3건 회피) |
| 2026-05-21 22:19 | **시간 범위 확정**: 10:00~12:00 / 14:00~18:00 (MSG-20260521-30854049, 김주연 총괄) — 96건 최종 확정 |

## 실행 방법

```bash
cd ~/Documents/GitHub/obliv-foot-crm
node scripts/seed_testdata_20260522.mjs
```
