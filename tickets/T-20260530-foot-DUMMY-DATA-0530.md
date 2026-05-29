---
id: T-20260530-foot-DUMMY-DATA-0530
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
db_change: true
rollback_sql: scripts/rollback_dummy_20260530.sql
spec_file: tickets/T-20260530-foot-DUMMY-DATA-0530.md
summary: "5/30 현장 테스트용 더미 데이터 128건 — 16슬롯(10:00~17:30, 30분 간격), 초진64+재진64 (V5)"
created: 2026-05-30
updated: 2026-05-30
reporter: planner (MSG-20260530-083644-qdv8)
---

# T-20260530-foot-DUMMY-DATA-0530 — 풋센터 CRM 5/30 현장 테스트 더미 데이터 (V5)

## 배경

5/30 풋센터 원내 CRM 현장 테스트. V4(5/29, 80건 10슬롯)에서 V5로 스펙 확장.
슬롯 16개(30분 간격 10:00~17:30), 초진64+재진64 = 128건.

## AC (Acceptance Criteria)

- [x] **AC-1**: 초진 고객 64명 + 재진 고객 64명 = 128명 (customers INSERT, is_simulation=true)
- [x] **AC-2**: 예약 128건 (reservations, 날짜 2026-05-30, 30분 간격)
  - 슬롯 16개: 10:00 / 10:30 / 11:00 / 11:30 / 12:00 / 12:30 / 13:00 / 13:30 / 14:00 / 14:30 / 15:00 / 15:30 / 16:00 / 16:30 / 17:00 / 17:30
  - 슬롯당 초진 4명 + 재진 4명 = 8건
- [x] **AC-3**: is_simulation=true 마킹 필수
- [x] **AC-4**: 전화번호 +82109906XXXX — V4(+82109905XXXX) 및 기존 데이터와 비중복
- [x] **AC-5**: 재진 64명 — 과거 체크인 1건씩 (2026-05-01, status=done) — 재진 판별 충족
- [x] **AC-6**: 롤백 SQL 및 JS 롤백 스크립트 제공 (is_simulation 기반 DELETE, FK 순서 준수)
- [x] **AC-7**: DB only — 코드 변경 없음

## 구현 내용

### 생성 파일
- `scripts/seed_testdata_20260530.mjs` — 메인 시드 스크립트 (V5)
- `scripts/rollback_testdata_20260530.mjs` — JS 롤백 스크립트
- `scripts/rollback_dummy_20260530.sql` — SQL 롤백 스크립트

### 데이터 구성

| 구분 | 슬롯 | 인원 | 총계 |
|------|------|------|------|
| 초진 | 16슬롯 (10:00~17:30, 30분), 슬롯당 4명 | 4명/슬롯 | **64명** |
| 재진 | 16슬롯 (10:00~17:30, 30분), 슬롯당 4명 | 4명/슬롯 | **64명** |
| **합계** | 16슬롯 × 8명 | | **128명 / 128예약** |

### 전화번호 범위
- 초진(동물): `+821099060001` ~ `+821099060064` (010-9906-0001 ~ 010-9906-0064)
- 재진(과일): `+821099060065` ~ `+821099060128` (010-9906-0065 ~ 010-9906-0128)

### 이름 패턴
- 초진: 동물이름 64종 (얼룩말·알파카·라마·고릴라·침팬지·오랑우탄·이구아나·도마뱀 외 56종)
- 재진: 과일·식물열매 64종 (올리브·비파·망고스틴·람부탄·롱안·금귤 외 58종)

### 과거 체크인 (재진 판별용)
- 대상: 재진 64명 전원
- 날짜: 2026-05-01T10:00:00+09:00
- queue_number: 9200 ~ 9263
- status: done

## 셀프접수 테스트 방법

1. URL: `https://obliv-foot-crm.vercel.app/checkin/jongno-foot`
2. 초진 전화번호: `010-9906-0001` ~ `010-9906-0064`
3. 재진 전화번호: `010-9906-0065` ~ `010-9906-0128`
4. 슬롯 10:00부터 4명씩 할당

## 실행 방법

```bash
cd ~/Documents/GitHub/obliv-foot-crm
node scripts/seed_testdata_20260530.mjs
```

## 정리 (테스트 종료 후)

```bash
# JS 버전
node scripts/rollback_testdata_20260530.mjs

# SQL 버전
psql $DATABASE_URL < scripts/rollback_dummy_20260530.sql
```

## 버전 이력

| 버전 | 날짜 | 티켓 | 슬롯 | 고객 수 | 전화번호 범위 |
|------|------|------|------|---------|-------------|
| V1 | 5/21 | T-20260521-foot-DUMMY-TEST-DATA | 12슬롯 | 96명 | +8210000002XX~02XX |
| V4 | 5/29 | T-20260529-foot-DUMMY-RESV-80 | 10슬롯 | 80명 | +821000002901~2980 |
| **V5** | **5/30** | **T-20260530-foot-DUMMY-DATA-0530** | **16슬롯** | **128명** | **+821099060001~0128** |

## DB 변경 사항

- **INSERT**: customers ×128, reservations ×128, check_ins ×64 (재진 과거 체크인)
- **DELETE 가이드**: phone BETWEEN '+821099060001' AND '+821099060128' AND is_simulation=true 기준 일괄 삭제
- **실 고객 충돌 방지**: +82109906XXXX 범위는 기존 고객 및 이전 버전 테스트 데이터와 완전 분리
