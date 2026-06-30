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
3. **STEP 0d 롤백 스냅샷 선실행 (필수)**: UPDATE 전에 touched 행 PK+old값을
   `_rollback_t20260630_custname_null` 테이블로 백업. `snapshot_rows` = STEP 0 값 일치 확인.
4. **트랜잭션 dry-run 권장**: `BEGIN; STEP0d; STEP1 UPDATE; STEP2 재검증; ROLLBACK;` 로 실측 후 판단.
5. 이상 없으면 `BEGIN; STEP0d; STEP1; STEP2; COMMIT;` (★ 스냅샷도 같은 트랜잭션에 포함해 COMMIT — 보관).
6. **STEP 2 재검증**: `remaining_null_after` ≈ 0 (고아 잔존 가능), 비-도파민 무변경.
7. COMMIT 운영반영 시 스냅샷 테이블 **DROP 금지** — post-COMMIT 롤백 근거로 보관(retention).

## ★ 롤백(원상복원) 계획 — qa_fail_reason: rollback_sql_missing 해소
backfill 은 데이터 변경(UPDATE)이므로 **post-COMMIT 복원 경로**를 명시한다.
- **사전조건**: STEP 0d 스냅샷(`_rollback_t20260630_custname_null`)이 UPDATE *전에* 떠 있어야 함.
  IS NULL 가드로 touched 행 old값은 전부 NULL 이지만, "어느 행을 건드렸나"(id 집합)는
  UPDATE 후 IS NULL 필터로 못 찾으므로 **반드시 사전 스냅샷 필요**.
- **복원 동작(RB-1)**: 스냅샷에 잡힌 행 중, *현재 값이 backfill 이 쓴 값과 동일한* 행만
  old값(NULL)으로 되돌림. 가드 `r.customer_name IS NOT DISTINCT FROM s.backfilled_value`
  → backfill 이후 다른 경로(EF 신규 fix·수기수정)로 바뀐 이름은 절대 NULL 로 날리지 않음(2차 사고 방지).
- **멱등**: RB-1 재실행 시 첫 회만 복원, 이후 매칭 0행.
- **검증(RB-2)**: `reverted_to_null` = 복원 행수, `still_named_other_path` = 다른 경로 변경분(불복원).
- **정리(RB-3)**: 재backfill 가능성 없을 때만 스냅샷 테이블 DROP (선택).
- 롤백 dry-run: `BEGIN; RB-1; RB-2; ROLLBACK;` 로 실측 후 COMMIT 판단.

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

-- STEP 0d: ★ ROLLBACK 스냅샷 (UPDATE 전 필수 선실행 — touched 행 PK+old값 백업)
DROP TABLE IF EXISTS _rollback_t20260630_custname_null;
CREATE TABLE _rollback_t20260630_custname_null AS
SELECT
  r.id,
  r.customer_id,
  r.customer_name AS old_customer_name,                                  -- 변경 전 값 (정의상 NULL)
  (SELECT c.name FROM customers c WHERE c.id = r.customer_id) AS backfilled_value,  -- 변경 후 예상값
  now() AS snapshot_at
FROM reservations r
WHERE r.source_system = 'dopamine' AND r.customer_name IS NULL;
SELECT count(*) AS snapshot_rows FROM _rollback_t20260630_custname_null;  -- = STEP 0 값 일치

-- STEP 1: UPDATE (★ supervisor count-verify + STEP 0d 후에만. dry-run: BEGIN; 0d; 1; 2; ROLLBACK; 권장)
-- BEGIN;
UPDATE reservations r
SET customer_name = (SELECT c.name FROM customers c WHERE c.id = r.customer_id)
WHERE r.source_system = 'dopamine'
  AND r.customer_name IS NULL;          -- ★ NULL 가드: 기존 이름 절대 미덮어씀
-- COMMIT;   -- ※ STEP 0d 스냅샷 동봉 COMMIT, 스냅샷 테이블 보관(DROP 금지)

-- STEP 2: 사후 재검증
SELECT count(*) AS remaining_null_after
FROM reservations
WHERE source_system = 'dopamine' AND customer_name IS NULL;


-- ═══ ROLLBACK (원상복원) — post-COMMIT 으로 backfill 되돌릴 때만 ═══
-- 전제: STEP 0d 스냅샷 테이블 존재. 가드로 backfill 값일 때만 NULL 복원(타 경로 변경분 미접촉).

-- RB-0: 롤백 영향 예상 행 수
SELECT count(*) AS will_rollback
FROM reservations r
JOIN _rollback_t20260630_custname_null s ON s.id = r.id
WHERE r.customer_name IS NOT DISTINCT FROM s.backfilled_value;

-- RB-1: 복원 실행 (dry-run: BEGIN; RB-1; RB-2; ROLLBACK; 권장)
-- BEGIN;
UPDATE reservations r
SET customer_name = s.old_customer_name                 -- = NULL (변경 전 값)
FROM _rollback_t20260630_custname_null s
WHERE r.id = s.id
  AND r.customer_name IS NOT DISTINCT FROM s.backfilled_value;  -- ★ backfill 값일 때만 복원
-- COMMIT;

-- RB-2: 롤백 사후 검증
SELECT
  count(*) FILTER (WHERE r.customer_name IS NULL)     AS reverted_to_null,
  count(*) FILTER (WHERE r.customer_name IS NOT NULL) AS still_named_other_path
FROM reservations r
JOIN _rollback_t20260630_custname_null s ON s.id = r.id;

-- RB-3: (선택) 스냅샷 정리 — 재backfill 가능성 없을 때만
-- DROP TABLE IF EXISTS _rollback_t20260630_custname_null;
```
