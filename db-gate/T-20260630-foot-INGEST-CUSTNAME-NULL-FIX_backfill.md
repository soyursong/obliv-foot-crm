# T-20260630-foot-INGEST-CUSTNAME-NULL-FIX — backfill 게이트 핸드오프

- **DB**: rxlomoozakkjesdqjtvd (obliv-foot-crm PROD)
- **SQL**: `db-gate/T-20260630-foot-INGEST-CUSTNAME-NULL-FIX_backfill.sql` (GATE_HOLD, gitignore=`*backfill*.sql` → 본 md에 인라인 동봉)
- **준비**: dev-foot · **실행**: supervisor (count-verify 게이트 후)
- **risk**: GO_WARN — 코드 fix 는 일반 플로우 즉시 / backfill 만 supervisor count-verify 게이트

## 문제
도파민→풋 예약 생성 시 `rsvPayload.customer_name` 누락 → `reservations.customer_name = NULL` →
풋 예약관리 **목록** '이름없음'. (상세팝업은 customers JOIN 폴백으로 정상)

- **코드 fix**(이번 커밋): EF rsvPayload 에 `customer_name: name` 추가 → *신규* 예약 교정.
- **backfill**(본 게이트): 기존 NULL 행 소급. customers.name (정상 적재값) → reservations.customer_name.

## supervisor 실행 절차 (count-verify 게이트)
1. **STEP 0 dry-run count** 실행 → `dopamine_null_name_rows` = 영향 행 수 기록.
2. **STEP 0b/0c** 로 `will_update` = `backfillable_rows` 인지 확인 (차이=고아 행 = 소스 name 없음).
3. **트랜잭션 dry-run 권장**: `BEGIN; STEP1 UPDATE; STEP2 재검증; ROLLBACK;` 로 실측 후 판단.
4. 이상 없으면 `BEGIN; STEP1; STEP2; COMMIT;`.
5. **STEP 2 재검증**: `remaining_null_after` ≈ 0 (고아 잔존 가능), 비-도파민 무변경.

## ★ 안전 가드 (T-20260629 NAME-BULK-OVERWRITE 사고클래스 회피)
- UPDATE WHERE 절에 **`customer_name IS NULL` 가드 필수** = 기존에 채워진 이름 절대 미덮어씀.
- WHERE `source_system='dopamine'` 스코핑 = 비-도파민 예약 정의상 미접촉.
- 소스 = `customers.name` (도파민 payload `customer.name` 으로 정상 적재된 값).

## 현장 클릭 시나리오 (검증 AC)
- 목록 실명 표시: backfill 후 도파민 인입 예약이 목록에서 실제 고객명으로 표시 (이전 '이름없음').
- backfill 전후 count: STEP 0 `null` → STEP 2 `remaining_null_after` 감소(고아 제외 0).
- 비-NULL 행 무변경: `untouched_not_null` 수 backfill 전후 불변.

## 인라인 SQL (gitignore 백업 — 권위본은 db-gate/*_backfill.sql)
```sql
-- STEP 0: dry-run count (supervisor 검증 기준값)
SELECT count(*) AS dopamine_null_name_rows
FROM reservations
WHERE source_system = 'dopamine' AND customer_name IS NULL;

-- STEP 0b: 비-NULL 무변경 사전 입증
SELECT
  count(*) FILTER (WHERE customer_name IS NULL)     AS will_update,
  count(*) FILTER (WHERE customer_name IS NOT NULL) AS untouched_not_null
FROM reservations
WHERE source_system = 'dopamine';

-- STEP 0c: 소스 가용성 (customers.name 존재 행)
SELECT count(*) AS backfillable_rows
FROM reservations r
WHERE r.source_system = 'dopamine'
  AND r.customer_name IS NULL
  AND EXISTS (SELECT 1 FROM customers c WHERE c.id = r.customer_id AND c.name IS NOT NULL);

-- STEP 1: UPDATE (★ supervisor count-verify 후에만. dry-run: BEGIN; ... ; ROLLBACK; 권장)
-- BEGIN;
UPDATE reservations r
SET customer_name = (SELECT c.name FROM customers c WHERE c.id = r.customer_id)
WHERE r.source_system = 'dopamine'
  AND r.customer_name IS NULL;          -- ★ NULL 가드: 기존 이름 절대 미덮어씀
-- COMMIT;

-- STEP 2: 사후 재검증
SELECT count(*) AS remaining_null_after
FROM reservations
WHERE source_system = 'dopamine' AND customer_name IS NULL;
```
