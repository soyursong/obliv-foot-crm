# T-20260819-foot-COPAY-VISIT-GRAIN — PROD APPLY evidence (fail-closed, pinned-worktree)

- 티켓: T-20260819-foot-COPAY-VISIT-GRAIN — 본인부담금 방문(visit) grain 교정 (design A · ADDITIVE money-billing DDL)
- prod ref: rxlomoozakkjesdqjtvd (obliv-foot-crm 운영)
- migration: `supabase/migrations/20260819200000_foot_calc_visit_copayment_additive.sql`
- migration_sha256: `bdd1d2b4cf55081c200043fc164f45ca358b6324bb6d16c99c986ed38f2b35ca`
- **apply_ts: 2026-08-19T08:20:53Z (17:20:53 KST)** — window exp 08:49:40Z(17:49:40 KST), margin ~29분
- applier: dev-foot / lane: prod / route: MIG-GATE mjs 러너 (applyMigration = 적용+원장기록 단일경로)

## GO-token 바인딩 검증 (apply 前)
- 토큰: `_handoff/db-gate/T-20260819-foot-COPAY-VISIT-GRAIN_GO.token(.json/.sig)` — commit `2730ae6e390`(SSOT 동기 확인)
- `node scripts/apply_gate_lib.mjs verify` → **DB-GATE GO ✔** : sigVerify=pass · key_id=supv-dbgate-2026a · nonce=a60f8b80b17ad8f7
- migration_sha256 일치(토큰 payload == 적용 SQL 파일 전문) · expires_at 08:49:40Z > now(미만료) · prod_ref 일치
- bound_commit `bb7980d448e1e6dd030988fcad19e53d428028d6` = pinned worktree HEAD (git worktree add --detach) — 적용 SQL byte-identical(sha256 재대조 일치)

## fail-closed 러너
- `scripts/apply_20260819200000_foot_copay_visit_grain.mjs` (정본 템플릿 `_TEMPLATE_apply_runner_gated.mjs` 카피, assertApplyGateForRunner chokepoint 배선)
- runner-gate 리허설 → `[APPLY 허용]` · 실 apply exit 0
- runner evidence: `db-gate/_apply_evidence/runner_apply.log.jsonl` (assertApplyGateForRunner gated=true, sql_sha256 일치)
- bus emit: `deploy_exec_done` (target_ref/sql_sha256/mig_version=20260819200000/status=applied)

## PRE-VERIFY (apply 前 prod 실측, read-only introspection)
| 축 | 실측 | 판정 |
|----|------|------|
| calc_visit_copayment | ABSENT | genuine ADD ✓ |
| record_insurance_consult_payment | 단일 7-arg(v2) | DROP v2 대상 정확 ✓ |
| schema_migrations 20260819200000 | ABSENT | ledger 충돌 0 ✓ |
| calc_copayment prosrc md5 | `1d5d28374199cf35d75cbe6d1c2bca6d` | baseline(무접촉 대상) ✓ |

## POST-VERIFY (apply 後 prod 실측)
| # | 항목 | 실측 | 판정 |
|---|------|------|------|
| 1 | calc_visit_copayment 생성 | PRESENT · args=`(p_service_ids uuid[], p_customer_id uuid, p_clinic_id uuid, p_visit_date date, p_surcharge_rate numeric)` · secdef=false(SECURITY INVOKER) | ✓ |
| 2 | record_insurance_consult_payment v3 | 단일 8-arg · `p_visit_service_ids uuid[] DEFAULT NULL` (7-arg caller backward-compat by DEFAULT · v2 overload 잔존 0) | ✓ |
| 3 | ledger 등재 | version=20260819200000 · name=foot_calc_visit_copayment_additive · created_by=`dev-foot:T-20260819-foot-COPAY-VISIT-GRAIN` | ✓ |
| 4 | calc_copayment 무접촉 | prosrc md5 = `1d5d28374199cf35d75cbe6d1c2bca6d` (PRE와 동일·불변) · secdef=false | ✓ UNTOUCHED |

## C19 baseline 정정 (supervisor GO-token PUSH note 반영)
- dev-foot dbgate ledger 구 기록 `calc_copayment baseline md5=eb2637a4…` = 실제로 **md5(pg_get_functiondef)** (functiondef md5) 였음(라벨 오류).
- canonical **prosrc(body) md5 = 1d5d2837…** (라이브 실측·PRE/POST 동일). drift 아님(동일 미접촉 함수의 서로 다른 측정축).
- 티켓 frontmatter `mig_ledger_check` + dbgate.md §③ 정정 반영.

## 잔여 (supervisor 소관)
- POST-VERIFY 8항 中 값-검증 게이트(의급 합계 min(1000,총액) · 노인 36,594→10,900 · 정률 general/foreigner/infant 회귀0 · client footBilling↔server calc_visit_copayment 동일값 · autodraft/EDI verbatim · 멱등 재호출 no-op) = supervisor deployed-전환 QA + POST-VERIFY gate.
- 소급 정정(BACKFILL)은 별건(§4-C).
