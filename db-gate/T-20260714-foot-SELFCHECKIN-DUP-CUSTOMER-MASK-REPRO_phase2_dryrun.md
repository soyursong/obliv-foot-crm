# T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO — Phase 2 dry-run 증거 (supervisor DDL-diff 입력)

> NO-PERSISTENCE dry-run (Management API, txn-strip + BEGIN..ROLLBACK + post-probe). mutation 0.
> 실행: dev-foot / 2026-07-14 · 스크립트 `scripts/…_phase2_dryrun.mjs`, `scripts/…_phase2_introspect.mjs`
> 마이그: `supabase/migrations/20260714120000_selfcheckin_upsert_masked_pii_reject_guard.sql`
> DA CONSULT-REPLY: MSG-20260714-095358-vdna / DA-20260714-FOOT-MASKREJECT-HELPER (predicate-only helper GO)

---

## 0. 게이트 상태
- **db_change=true**, 분류 = **ADDITIVE**(helper 신규 + call-site 가드 가산 · 파괴변경 0 · 스키마 무변경).
- **DA CONSULT-REPLY GO 수신** → autonomy §3.1 **대표 게이트 면제**. supervisor DDL-diff 단일 게이트.
- 롤백 SQL 동봉(가역): 4함수 가드-前 정의 복원 + helper DROP.

## 1. prod introspect (READ-ONLY) — 대상 4 RPC 실태
| 함수 | 시그니처 | 반환 | secdef | anon | auth |
|---|---|---|---|---|---|
| fn_selfcheckin_upsert_customer | (uuid,text,text,text,boolean,text,text,text,text) | uuid | ✓ | ✓ | ✓ |
| fn_selfcheckin_upsert_customer_resolve_v2 | (…12 arg) | TABLE(customer_id,link_status) | ✓ | ✓ | ✓ |
| fn_selfcheckin_upsert_customer_resolve_v3 | (…15 arg) | TABLE(customer_id,link_status) | ✓ | ✓ | ✓ |
| self_checkin_create | (p_clinic_slug text, p_phone text, p_name text) | jsonb | ✓ | ✓ | ✓ |

- helper `_fn_is_masked_pii` 사전 부재 확인 (n=0).
- self_checkin_create 는 **repo 소스 부재** → prod `pg_get_functiondef`(2026-07-14) 확보분에 가드만 가산, 본문·search_path verbatim 보존. (phone-only find-or-create → masked payload 시 신규 masked customers INSERT = 2차 벡터 정합.)

## 2. helper predicate 정오탐 (name AND phone 양축 · 임계 <8 = v_canon 공유)
| 입력 | 기대 | 결과 |
|---|---|---|
| name `총**트` / phone `7754` | true (마스킹) | ✅ true |
| name `홍길동` / phone `010****5453` | true (phone `*`) | ✅ true |
| name `홍길동` / phone `5453` (4자리) | true (digits 1~7) | ✅ true |
| name `홍길동` / phone `1234567` (7자리) | true (digits 1~7) | ✅ true |
| name `홍길동` / phone `010-9999-8888` | false (raw) | ✅ false |
| name `홍길동` / phone `+821099998888` (e164) | false (raw) | ✅ false |
| name `홍길동` / phone `12345678` (8자리) | false (임계 경계) | ✅ false |
| name `` / phone `` (빈) | false | ✅ false |
| name `John Doe` / phone `` (외국인 email-only) | false | ✅ false |
| name `홍길동` / phone `DUMMY-abc` (0 digits) | false | ✅ false |

→ **false-reject 0 자동 충족**(정상 raw·e164·외국인·DUMMY 전부 통과). 마스킹 지문만 true.

## 3. 가드 fail-closed (DA 스펙: errcode 22023)
- `fn_selfcheckin_upsert_customer_resolve_v3(clinic, '총**트','7754','new')` → **SQLSTATE 22023** raise 확인 (INSERT 전 차단).
- `self_checkin_create('__slug__','7754','총**트')` → **SQLSTATE 22023** raise 확인.
- 탐지=helper(1벌) / raise=call-site(4벌) 분리 — 미래 reject 정책 경로별 divergence 대비.

## 4. DA 회귀검증 3종 (CONSULT-REPLY 부가판정 3) 매핑
- **(a) masked ingress 4경로 각각 reject**: 가드가 4 RPC(upsert_customer/v2/v3/self_checkin_create) 최상단 공통 → §3 대표 2종 실증 + §5 spec 소스단언으로 4/4 커버.
- **(b) raw 정상접수 통과**: §2 raw/e164/8자리/외국인/DUMMY 전부 false → 가드 미발화(통과).
- **(c) 기존 raw row resolve 재현**: v_canon 복합키 [name AND phone-canonical] 매칭 로직 **무변경**(가드 외 본문 verbatim) — reject-at-ingress 로 raw 만 진입 → 기존 linked/created/ambiguous 정상 작동. **masked 값 fuzzy/부분매칭 미추가**(DA false-merge 금지 준수).

## 5. 무영속(no-persistence) post-probe
- ROLLBACK 후 `_fn_is_masked_pii` 존재수 **n=0** → prod 무영속 확인. sentinel-bypass hazard 없음(내장 COMMIT strip + 외부 ROLLBACK).

## 6. supervisor DDL-diff 점검 포인트
1. helper = STABLE·**SECURITY DEFINER 아님**·순수 predicate·DB무접근. search_path=pg_catalog,pg_temp 고정.
2. 4 RPC = 기존 signature **정확 일치** CREATE OR REPLACE(오버로드 생성 0). 기존 grant 보존(REPLACE).
3. 가드 = 각 함수 BEGIN 직후 최상단 1블록, `_fn_is_masked_pii(p_name,p_phone)` → RAISE 22023(fail-closed).
4. 스키마 무변경(신규 컬럼/테이블/enum 0) → data-architect 신규객체 CONSULT 대상 아님(helper=함수, DA GO 범위).
5. 가드 외 본문 무변경(v_canon·복합키·consent persist·EXCEPTION 블록 verbatim) = 회귀면 최소.
6. 롤백 = 4함수 가드-前 복원 + helper DROP, 단일 tx.
