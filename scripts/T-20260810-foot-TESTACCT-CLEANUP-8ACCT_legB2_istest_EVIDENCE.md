# T-20260810-foot-TESTACCT-CLEANUP-8ACCT — Leg B 2차 is_test flag EVIDENCE

**dev-foot authoring · 2026-08-12 · READ-ONLY census + no-persistence dry-run (prod 미적용)**

## 배경
3-of-4 leg APPLIED 종결(applied_at frontmatter):
- Leg B infra(is_test 컬럼 + v_daily_revenue 필터 + 3계정 flag) — APPLIED 01:08, POSTCHECK 5/5 PASS
- Leg A-(a) 정상삭제 3행(F-4691/F-4703/F-4468) — APPLIED, POSTCHECK PASS
- Leg A-(b) Path-B 물리삭제 2행(F-4425/F-4692) — APPLIED, POST-VERIFY 종결

**잔여 유일 leg = Leg B 2차 is_test flag 2건(F-4427/F-4445).** 본 authoring 이 그 fresh dry-run + 마이그.

## READ-ONLY census (2026-08-12, foot prod rxlomoozakkjesdqjtvd, NFC exact)
| F-id | 이름 | customer_id | 현 is_test | 처분 |
|------|------|-------------|-----------|------|
| F-4427 | 풋테스트1 | e72022d0-7cf5-4f42-b5e3-b5162005b454 | false | is_test=true (printed serial74 발번문서 → 물리삭제 HARD REJECT·의료법 §22/§40) |
| F-4445 | 박민석(별건) | 66c08e48-c708-4e50-963d-aaa56b27d9ea | false | is_test=true (진료의뢰서1+상쇄결제 → 물리삭제 NO-GO·동명이인 4jg4 확정) |
| F-4790 | 박민석 본계정 | 1c61bad2-ad49-4e7d-92ae-2d132aae95cb | false | **KEEP — flag 금지(버그확인용 유지)** |

## 마이그 (flag-only, DDL 없음 — is_test 컬럼 Leg B infra 旣존재)
- `20260812080000_foot_testacct8_legB2_istest_flag_2acct.sql` — per-row whitelist UPDATE 2행 + `DO $$` rows-affected=2 자기검증 + KEEP guard(본계정 미오염) ABORT
- `.rollback.sql` — 2행 false 원복(컬럼 DROP 안 함, infra 소관)
- `.dryrun.mjs` — dryrun_lib 3요소

## dry-run 결과 (no-persistence PASS)
- stripped top-level txn-control: ["BEGIN;","COMMIT;"] (INV-5)
- plpgsql exception-handler 경유 실행 → `DO $$` 자기검증(rows=2, KEEP guard) 통과 후 롤백
- post-probe [2행 여전히 is_test false] absent=true ✓
- post-probe [KEEP 본계정 무오염] absent=true ✓
- **== DRY-RUN PASS ==** (무영속 실증)

## 잔여 게이트 (apply-order)
- change-class = ADDITIVE flag-only(DDL-0: ADD COLUMN IF NOT EXISTS = 멱등 no-op). CEO 게이트 불요(§3.1 파괴 아님).
- **supervisor DB-GATE** = flag UPDATE freeze-set(2 uuid) + rows-affected=2 + 물리 GO-token. apply_before_go 금지.
- da_consult_ref = DA-20260810-foot-TESTACCT-ISTEST-ADDITIVE-PARITY (조건부 GO) + 총괄 '완전정리' confirm(1786403792.800929).
