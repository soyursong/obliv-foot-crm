# DB-GATE — T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN (no-persistence dry-run)

- **migration**: `supabase/migrations/20260721100000_foot_selfcheckin_create_phone_e164_conformance.sql`
- **rollback**: `supabase/migrations/20260721100000_foot_selfcheckin_create_phone_e164_conformance.rollback.sql`
- **runner**: `scripts/T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN_dryrun.mjs` (dryrun_lib.mjs / std v1.0)
- **DA CONSULT-REPLY**: MSG-20260721-030943-9hj0 / DA-20260721-FOOT-SELFCHECKIN-NORMALIZE → **GO · ADDITIVE-equivalent: YES**

## 결과: DRY-RUN PASS

```
== dry-run 20260721100000_foot_selfcheckin_create_phone_e164_conformance.sql ==
   stripped top-level txn-control (INV-5): ["BEGIN;","COMMIT;"]
   harness response: []
   post-probe [prod self_checkin_create 정의에 normalize_phone 부재 (정규화 변경 미영속)] absent? -> [{"absent":true}]

== DRY-RUN PASS == (txn-control stripped · plpgsql exception-rollback · post-probe absent)
```

## 판정 근거
- **clean apply**: CREATE OR REPLACE FUNCTION self_checkin_create 가 plpgsql exception-handler 내 EXECUTE 로 에러 없이 적용됨(문법·의존성 valid). sentinel RAISE 로 무영속 rollback.
- **무영속 실증 (INV-3)**: post-probe = prod 현행 self_checkin_create 정의에 `normalize_phone` **부재**(absent=true) → 정규화 변경이 prod 에 샌 흔적 0.
- **부수 확인 (carve-out 관련)**: post-probe 가 반환한 absent=true 는 곧 **prod 현행 정의가 아직 raw p_phone(07-14 def)** 임을 의미 = 계약 이탈 상태 실재 재확인.

## ADDITIVE 근거 (DA GO 정합)
- 스키마 무변경(no DDL): ALTER/CREATE TABLE·TYPE·ADD COLUMN 0. 함수 본문 CREATE OR REPLACE 1건.
- 기존 `normalize_phone`(IMMUTABLE STRICT, idempotent, 20260513000040) 재사용 · 신규 의존성 0.
- GRANT/ACL: CREATE OR REPLACE 보존(batch2 REVOKE/KEEP-7 상태 무훼손).
- 되돌림: rollback.sql = raw p_phone 정의(07-14) 원복. 가역.

## 필수조건 (DA) 충족
- 조회 WHERE `phone = v_phone` + customers INSERT `v_phone` + check_ins INSERT `v_phone` = **동일 v_phone 일관 적용** (find/create 페어 정규화 불일치로 인한 중복 customers row 방지).
- masked-PII guard(`_fn_is_masked_pii(p_name, p_phone)`) + `length(digits) >= 9` = **raw p_phone 에 pre-normalize 유지**(방어 보존, normalize 는 non-KR/invalid 원본 반환 → garbage 는 CHECK 에서 여전히 차단).

## 후속 (비블로킹)
- DA carve-out 등급 probe(07-14 이후 check_violation 로그 / 셀프접수 기원 customers row 도수)는 하드닝 블로킹 아님(병행). planner FOLLOWUP 로 통지 — 실버그 판정 시 우선순위 격상.
- 정합 배포 후 self-checkin 기원 신규 customers.phone E.164 100% 여부 = DA 일일 정합감사 A3(phone 매칭)에서 자동 확인.

author: dev-foot / 2026-07-21
