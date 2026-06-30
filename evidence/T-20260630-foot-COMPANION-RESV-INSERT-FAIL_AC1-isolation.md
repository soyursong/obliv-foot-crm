# T-20260630-foot-COMPANION-RESV-INSERT-FAIL — AC-1 격리 진단 (prod 접지)

- 일시: 2026-06-30
- 담당: dev-foot
- 부모: T-20260630-dopamine-FOOT-COMPANION-RESV-SAVE-FAIL (origin=dopamine)
- 성격: **read-only 진단 (비파괴)**. prod `rxlomoozakkjesdqjtvd`. 재현 스크립트 `scripts/T-20260630-foot-COMPANION-RESV-INSERT-FAIL_diag{,2}.mjs`.

## 결론 (AC-1)
동행(companion) 예약은 **foot 수신 경계(ingest EF + reservations 스키마)에서 영속 불가**다. foot 측에 동행 지원이 **스키마·EF·RPC 전 계층에서 0**이며, 그 중 **decisive 비호환 = `reservations.external_id` UUID 타입**(2026-05-20 TEXT→UUID 변환)이 동행 composite external_id(`{cue_card}#companion-N`, 계약 §459)를 **22P02로 거부**한다. 어느 경계가 먼저 터지든 fix는 동일(=foot 동행 지원 신설)이므로 단일 first-fail 핀포인트는 moot.

`customer_id NOT NULL(23502)` 후보는 **REFUTED** — prod `reservations.customer_id`는 nullable(아래 [E4]).

## prod 증거

| # | 검증 | 결과 | 함의 |
|---|------|------|------|
| E1 | `reservations.customer_real_name` SELECT | **42703 column does not exist** | §4-2b v2.1 동행 본명 스냅샷 컬럼 **prod 부재**. 동행명 영속처 없음. |
| E2 | `reservations.external_id` 타입 | **UUID** (`.ilike`→`uuid ~~*` 연산자 부재 / 비-UUID `.eq`→error) | 동행 composite external_id(text) INSERT 시 **22P02 invalid uuid**. |
| E3 | external_id 타입 출처 | `20260520000040_dopamine_integration_schema.sql` L32 `ALTER COLUMN external_id TYPE uuid` | 동행 계약(§459, 2026-06-23) **이전** foot이 UUID로 하드닝 → 근본 비호환. |
| E4 | `customer_id IS NULL` 예약 수 | **126건 존재** | customer_id nullable 확정 → **23502 REFUTED** (table-level). |
| E5 | 더미폰 customer `+821000000000` | **1건** (`빈혜린(원내촬영)`, 6 예약 연결) | 더미폰 동행 경로 시 全 동행이 단일 customer로 collapse(name churn). |
| E6 | dopamine 인입 예약 **총수** | **1건** (name/phone NULL, customer_id set) | dopamine→foot push가 사실상 미작동(동행 이전에 기본 인입도 빈약). |

## foot 측 동행 지원 부재 (코드 정적 분석)

1. **ingest EF `reservation-ingest-from-dopamine`** (동행 실제 수신 경로):
   - L151–160: `customer.phone_e164` + `name` **필수** + `isE164` 검증 → 동행 name-only/무폰 → **400 MISSING_FIELD**.
   - L295–391: 항상 `(clinic_id, phone)` customer upsert → `reservations.customer_id = customerId`(**항상 non-NULL**). `is_companion`→customer_id=NULL 분기 **없음**.
   - payload(L390–417): `customer_real_name` 미적재(컬럼 부재), composite external_id 인지 **없음**.
   - 단, EF는 400/422/500/`applied:false`를 **정직하게 반환** — 무음 삼킴 아님.
2. **RPC `upsert_reservation_from_source`**: `20260513000050` **8-arg** 동결 — `p_customer_real_name`(§4-2b 15th)·`p_is_companion`(§441-447) **부재**. (실제 인입은 EF 직접 write 경로; RPC는 vestigial.)
3. **foot 네이티브 예약화면**(`Reservations.tsx`/`ReservationDetailPopup.tsx`): **동행(다인) UI 자체가 없음** + 신규고객 **전화번호 필수**(popup L1179) → 네이티브 경로로 동행 생성 불가.

## AC-2 (토스트 결속) — foot 네이티브는 이미 결속됨, 미스파이어는 dopamine caller 측
`ReservationDetailPopup.submitNewReservation` L1219–1226: `if (!res.ok) toast.error(...)` → `toast.success`는 **`res.ok`일 때만** 발화. foot 네이티브 토스트는 이미 write 성공에 결속. + 네이티브는 동행 경로 자체가 없음. ⇒ 현장이 본 "예약됐다 토스트 + 미반영"은 foot 네이티브가 아니라 **dopamine push UI(EF의 400/500/applied:false를 미노출)** 측. foot EF는 정직한 에러를 이미 반환하므로, 무음실패 차단(AC-2)의 잔여 결속점은 **dopamine 호출측**(cross-domain).

## fix는 비파괴 아님 → AC-4 재게이트 (db_change=true, risk#1)
동행 영속(AC-3)에는 foot 스키마/EF 변경 필수:
- **DDL-A** `reservations.external_id` UUID→TEXT (또는 동행키 별도 설계). ⚠ cross-CRM 멱등키 타입 + `payments.external_id`(uuid, reservation carry-over, `20260520000040` L58) carry 영향 → **data-architect CONSULT 필수**.
- **DDL-B** `reservations.customer_real_name text NULL` ADD (ADDITIVE, §4-2b canonical, backfill 0).
- **EF-C** `is_companion` 분기(customer_id=NULL + customer_real_name 적재, 동행 무폰 수용, composite external_id 수용).
- **RPC-D** `upsert_reservation_from_source` 8→17-arg(계약 §4-1 준수 시).
- **dopamine 캘린더 미러**(AC-3 양쪽 반영)는 foot가 영속하면 read-only 미러로 자동 귀결.

### 설계 결정 필요 (DA CONSULT)
동행키 전략: (a) external_id UUID→TEXT 후 composite(`{uuid}#companion-N`) / (b) external_id UUID 유지 + `companion_index smallint` 보조컬럼 + 멱등 유니크 `(source_system, external_id, companion_index)` / (c) 동행 별도 테이블. + payments.external_id carry-over 정합.

## 권고
- AC-1 격리 = **완료(본 문서)**. 정확 wire-level first-fail = dopamine 동행 push payload(external_id 포맷·is_companion·phone) 필요 = **cross-domain(부모 스레드/dev-dopamine)**.
- AC-3/AC-4 = **risk#1 재게이트**(supervisor DDL-diff + 롤백SQL) + **data-architect CONSULT**(external_id 타입·동행키·payments 영향). db_change=true 전환.
- AC-2 잔여 = dopamine caller 토스트 결속(cross-domain).
