# T-20260810-foot-TESTACCT-CLEANUP-8ACCT — Leg B is_test 구현 증적 (dev-foot)

- 실행: dev-foot / 2026-08-11 / foot prod `rxlomoozakkjesdqjtvd` / Management API (read_only)
- DA SSOT: `agents/docs/da_replies/da_decision_foot_testacct_istest_additive_parity_20260810.md`
  (da_consult_ref = **DA-20260810-foot-TESTACCT-ISTEST-ADDITIVE-PARITY**, 조건부 GO)
- change-class: **ADDITIVE** (§3.1 CEO 파괴게이트 면제 YES) · DDL-0 carve **아님**(ADD COLUMN + view DDL 2종 + flag UPDATE)
- artifact-class: **db_only** (src/ 무변경 — v_daily_revenue FE 소비 0건·is_test FE 컬럼소비 0건)
- 클래스: 마이그 파일 작성 + READ-ONLY census + 무영속 dry-run. **prod WRITE/DDL 0 (apply = supervisor GO-token 後)**.

---

## 1. census (H3/H4/H6 — 명시 id whitelist, NFC exact, 유일성)
스크립트: `scripts/T-20260810-foot-TESTACCT-CLEANUP-8ACCT_legB_istest_census.mjs` (READ-ONLY, write/DDL REFUSE 가드)

| 계정 | chart_number | customer_id (freeze-set) | name 일치 | NFC | is_simulation | 유일성 |
|------|--------------|--------------------------|-----------|-----|---------------|--------|
| 서류테스트 | F-4990 | `78975d00-9d31-4ac3-848c-0f77c6f0d735` | ✅ | ✅ | false | 유일 |
| 총괄테스트중 | F-4574 | `351d34c5-2dd9-4583-bfb3-8e27025777a6` | ✅ | ✅ | false | 유일 |
| 서류테스트2 | F-5113 | `80df7a6b-077d-46db-b9db-31591f3977a4` | ✅ | ✅ | false | 유일 |
| 풋테스트1 (HOLD, flip 제외) | F-4427 | `e72022d0-7cf5-4f42-b5e3-b5162005b454` | ✅ | ✅ | false | 유일 |

- 유일성 위반 0행. 3계정 전건 NFC-exact 이름 일치.
- **재무 접점** (집계제외 정당성): F-4990 payments n=2 **net 0**(self-상쇄 phantom, DA §1-4 예측 부합)·sc n=2 / F-5113 payments n=4 **net 0**·sc n=2 / package_payments 0 / package_credit_ledger 0. → flag 시 매출집계 제외 정당(실매출 아님).
- **is_test 컬럼**: prod 부재 확인(적용 前 기대치) → 본 마이그로 신설.

## 2. dry-run (무영속 3요소 — dryrun_lib)
스크립트: `supabase/migrations/20260811020000_..._flag_vdailyrev.dryrun.mjs`
```
stripped top-level txn-control (INV-5): ["BEGIN;","COMMIT;"]
post-probe [customers.is_test 컬럼 부재(ADD COLUMN 롤백 → flag UPDATE 도 무영속)] absent? -> [{"absent":true}]
post-probe [v_daily_revenue 정의 is_test 미참조(뷰 재정의 롤백)] absent? -> [{"absent":true}]
== DRY-RUN PASS ==
```
- ① txn-strip(top-level BEGIN/COMMIT 제거) ② plpgsql exception-handler 롤백 ③ post-probe 부재실측 = 3요소 충족.
- 마이그 내 self-test DO 블록(D1~D4)이 dry-run 중 실행·통과 후 롤백 → 로직 정합 + 무영속 동시 실증.

## 3. ledger reconciliation (3자 정합)
- supabase_migrations.schema_migrations **존재**.
- 대상 version `20260811020000` **ledger 미기록**(기대 [] 확인) — forward, OOB divergence 0.
- 최근 ledger tip = `20260810240000` → 대상 version monotonic 후행.
- prod `customers.is_test` **부재** = 파일 선언(ADD COLUMN IF NOT EXISTS 신규)과 정합.
- ⟹ ledger ≡ prod실재 ≡ 파일선언 3자 일치 (ADDITIVE forward). **PASS**.

## 4. rollback (완전가역)
`supabase/migrations/20260811020000_..._flag_vdailyrev.rollback.sql`
- 순서: (C) v_daily_revenue 20260718 base 복원 → (B) flag 3건 false 원복 → (A) DROP COLUMN is_test.
- 의존성 준수: 뷰가 is_test 참조 → 뷰 복원 후 컬럼 DROP.

## 5. surface 분리 (DA H5)
- ① foot LOCAL v_daily_revenue = **is_test/is_simulation 이중 제외 적용** (customer_id 조인, body 555 준용).
- ② datalake fct_revenue_daily = **foot 무접점 no-op** (필터 미추가 = 정상, DA-20260724 dispositive).

## 6. firewall (DA H1)
- is_test 신설(별 컬럼·별 semantic) · is_simulation UNCHANGED. co-set/overload 0. NOT NULL 미부여(foot H2, nullable default false).

---
## apply 게이트 (AC-1 form-A — dev 선집행 금지)
DA GO ≠ apply 허가. **supervisor DDL-diff(ADD COLUMN up/down + view up/down) + DB-GATE(flag UPDATE freeze-set/rows-affected) + 물리 GO-token** 발행 후 `db_apply_guard.sh` lane 으로만 prod apply. `applied_at` = GO-token 後 prod apply 시점 기입(deploy-ready 4필드 아님).
