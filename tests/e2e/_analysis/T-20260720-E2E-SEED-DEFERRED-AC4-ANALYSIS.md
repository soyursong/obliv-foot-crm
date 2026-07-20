# T-20260720-foot-E2E-SEED-DEFERRED-AC4-ANALYSIS

풋 E2E deferred 로컬포맷 phone 시드 per-spec AC-4 분석 — blanket-DUMMY 미전환 잔존분 개별 안전전환 판정.
테스트 하네스(`tests/e2e/**`) 전용. 제품 코드·FE·DB·RPC 무변경 (db_change=false).

## 제약 근거 (AC-1 (a): 어느 제약 테이블에 직삽입되는가)

phone E.164 CHECK 제약이 걸린 컬럼 = **`customers.phone`, `reservations.customer_phone` 2개뿐**
(mig `20260713160000_foot_phone_e164_chk_expr_fix.sql`; `20260426090000_phone_e164_migration.sql`).

허용 형식: `NULL` / `LIKE 'DUMMY-%'` / `= '+821000000000'` / `~ '^\+82(1[016789]\d{7,8})$'`.

**비제약 컬럼(위반 불가)**: `check_ins.customer_phone`, `notification_opt_outs.phone`,
문서 렌더 payload의 `patient_phone`·`customer_phone`(in-memory 객체) 등.
추가로 `customers(clinic_id, phone)` UNIQUE INDEX(`idx_customers_clinic_phone`) 존재 → 시드 phone 은 clinic 내 유일해야 함.

## per-spec 판정 (AC-1 (b) / AC-2)

| # | spec | 직삽입 제약테이블 | 깨지는 assert | 판정 | 전환 |
|---|------|------------------|--------------|------|------|
| 1 | PAYMENT-CODE-PERSIST (slot A/B 블록) | customers.phone | slot distinctness(A≠B) + (clinic,phone) UNIQUE | **안전전환** | `DUMMY-${ts}-a` / `-b` (distinct 유지). check_ins.customer_phone 는 비제약이나 정합 위해 동반 전환 |
| 2 | INSGRADE-VERIFY-RESETTLE `seedCoveredVisit` | customers.phone | (없음 — grade 가 subject, phone 은 lookup 키 아님·cleanup=customerId) | **안전전환** | `DUMMY-${grade}-${Date.now()}` (grade+ts distinctness) |
| 3 | RESV-DUPGUARD-SAMEDAY (AC-1/3/4/6·RPC) | customers.phone + reservations.customer_phone | dedup `phoneDigits.length>=10` 숫자매칭 | **DUMMY 불가 → +82 보존전환** | 로컬 `010X${sfx}` → `+8210X${sfx}`. stored/queried 양측 동일 E.164 → digit-match 정합 유지. (AC-2 블록 L105 는 이미 +82, 무변경) |
| 4 | foot-006-rls-self-assignment L61 | (RPC 경유) customers.phone | — | **예외 유지 (paper-over 금지)** | 미전환. 아래 실신호 참조 |
| 5 | OPTOUT-LIST-UNIFY L106 | 없음 (notification_opt_outs) | — | **무해 (전환 불요)** | 미전환. UI `.fill()` 앱정규화 경유 |
| + | RESV-CHECKIN-NOSAVE (0109/0108/0107 seed 블록) | customers.phone + reservations.customer_phone | (없음 — 유일성=`reservation_id`/`unique_reservation_checkin`, 23505 assert. phone 비-subject) | **안전전환** | `DUMMY-9${sfx}`/`-8`/`-7` (prefix distinctness). UI `#sc-phone.fill('010…')` 경로는 앱정규화 → 미전환 |

> `+` 행(CHECKIN-NOSAVE)은 dispatch 표 item 1~5 에 미포함이나, 티켓 배경 대상표(§대상 L36)에 명시되고
> AC-3(all-specs INSERT 위반 0건)의 하드 요건이라 전수 스윕에서 잔존 `customers.insert` 위반 확정 → 동반 전환.

## AC-4: 무해 분류 근거 문서화

- **foot-006 L61 (실신호 · 무해 아님으로 정정)**: `self_checkin_create`(mig `20260714120000` L489-491)는
  `p_phone` 을 **normalize 없이 `customers.phone` 에 as-is INSERT**. 입력 검증은 `length(digits) >= 9` 뿐.
  → 로컬 `010…` 입력 시 E.164 CHECK 위반(check_violation) → RPC 예외 → **트랜잭션 롤백**(persist 없음).
  테스트는 `createErr` 분기에서 `test.skip` → red·잔존행 없음(AC-3 충족). 그러나 이는 **제품 RPC 정규화 누락
  실신호**이므로 DUMMY화로 은폐 금지. self_checkin_create 정합(insert 전 `normalize_phone` 적용)은 **별도
  제품코드 티켓 소관** → dev-foot→planner FOLLOWUP.
  (대비: `upsert_reservation_from_source` mig `20260715120000` L271 은 `normalize_phone` 적용 → TM 경로 무해.)
- **OPTOUT-LIST-UNIFY L106 (무해)**: `010…` = UI `.fill()` 입력값 → FE/앱 정규화 경유 + 대상 테이블은
  `notification_opt_outs`(E.164 CHECK 없음) → 직삽입 위반 아님.
- **DOCPRINT 계열 `patient_phone`/렌더 payload `customer_phone`**: `buildAutoBindValues` 등 순수 렌더 함수에
  넘기는 in-memory 객체 필드 → DB insert 아님. 비제약. (SEAL-MOON/DOCTOR-SELECT-DROPDOWN/OBLIVORIGIN 등)
- **TM-EDIT-CANCEL `p_customer_phone: '010…'`**: `upsert_reservation_from_source` RPC 가 insert 전 정규화 → 무해.
- **CUSTINFO-PHONE-EDIT / CUSTCONTACT-EDIT `newPhone='010…'`**: UI `.fill()` 앱정규화 경유 → 무해.

## AC-3: ci-nightly(all-specs) 시드 INSERT 위반 0건

전환 후 잔존 로컬-포맷 직삽입 위반원 = 0.
- 안전전환 4건(item1/2/3/+)으로 `customers.phone`·`reservations.customer_phone` 직삽입 로컬포맷 제거.
- foot-006(item4)은 RPC 내부 롤백·test.skip 로 persist·red 없음(실신호는 별도 티켓 트랙).
- 무해군(item5·DOCPRINT·TM·CUSTINFO/CONTACT)은 비제약/앱정규화 경로로 위반 원천 아님.
</content>
</invoke>
