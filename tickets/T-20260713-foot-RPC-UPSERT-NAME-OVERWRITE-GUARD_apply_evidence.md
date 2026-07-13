# T-20260713-foot-RPC-UPSERT-NAME-OVERWRITE-GUARD — PROD APPLY EVIDENCE

- **작업**: dev-foot / FIX-REQUEST MSG-20260713-224829-qm2p (supervisor, P0 action request)
- **대상**: prod `rxlomoozakkjesdqjtvd` · `public.upsert_reservation_from_source`
- **유형**: 비파괴 CREATE OR REPLACE FUNCTION only (스키마/트리거/signature 무변경)
- **적용 파일**: `supabase/migrations/20260713150000_foot_rpc_upsert_name_never_downgrade_guard.sql`
- **적용 스크립트**: `scripts/apply_20260713150000_foot_rpc_upsert_name_never_downgrade_guard.mjs`
- **rollback**: `supabase/migrations/20260713150000_foot_rpc_upsert_name_never_downgrade_guard.rollback.sql`

## MIG-GATE evidence (4필드)
- **mig_files**: up.sql + rollback.sql + apply.mjs 동봉.
- **mig_dryrun (No-Persistence Protocol)**: `DRYRUN=1` 실행 → Status 201, COMMIT→ROLLBACK 치환. 사후 무영속 확인 = 적용 전 prod introspection `[{"has_never_downgrade":false,"has_old_override":true}]` (DRYRUN 미반영 확정).
- **mig_ledger_check**: CREATE OR REPLACE only, 18-arg 단일 signature 유지(오버로드 잔존 0). schema_migrations 원장 무변경 DDL(함수 body 교체).
- **mig_rollback**: rollback.sql = 직전 권위 body(20260708150000 preserve-on-NULL CASE) CREATE OR REPLACE 복원. 인자수 무변경 → DROP 불요.

## 실행 결과
| 단계 | 결과 |
|------|------|
| PRE-APPLY prod probe | `has_never_downgrade=false, has_old_override=true` (OLD body) |
| DRYRUN | Status 201 green (롤백됨, 미반영) |
| APPLY (COMMIT) | Status 201 ✅ |
| POST-VERIFY pg_proc | `has_never_downgrade=true, has_old_override=false` ✅ |
| signature | 18-arg 단일 (오버로드 0) ✅ |

## pg_proc 결선 (post-apply, live)
- never-downgrade 결선: `pg_get_functiondef ILIKE '%COALESCE(NULLIF(btrim(customers.name)%'` → **true**
- 舊 CASE override 제거: `ILIKE '%WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name <>%'` → **false**
- args: `... p_is_companion boolean, p_brief_note text` (18-arg, 단일 signature)

→ supervisor post-verify + deployed 마킹 대기.

---

## 재확인 + 원장 정합 (FIX-REQUEST MSG-20260713-230427-znag, 2026-07-13)

supervisor 재요청("PROD apply + pg_proc/schema_migrations 확인 결과 공유")에 대한 dev-foot 재검증.

### 발견
- **pg_proc body = 이미 never-downgrade canon (live)**: PRE-APPLY probe `[{"has_never_downgrade":true,"has_old_override":false}]`. 함수 body 는 선행 apply(MSG-224829-qm2p)로 이미 prod-LIVE.
- **schema_migrations 원장 결여**: `version='20260713150000'` 행 **부재** (mgmt-API apply 경로가 CLI 원장 미기입). → prod실재(canon) = OK, 원장 divergence.

### 조치 (Migration Ledger Reconciliation — forward-doc)
1. **APPLY 재실행** (멱등 CREATE OR REPLACE): Status 201 ✅. body/ACL 정본 재확정.
2. **원장 forward-doc reconcile**: `INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by, rollback) ... ON CONFLICT (version) DO NOTHING` → Status 201 ✅. (prod실재=canon 기준으로 원장을 수렴 — 종이선언 아님, 실재 우선.)

### FINAL POST-VERIFY (live)
| 항목 | 결과 |
|------|------|
| pg_proc `has_never_downgrade` | **true** ✅ |
| pg_proc `has_old_override` (舊 CASE) | **false** ✅ |
| overload_count | **1** (18-arg 단일 signature) ✅ |
| schema_migrations `20260713150000` | **present** ✅ (name=foot_rpc_upsert_name_never_downgrade_guard, created_by=dev-foot:T-..., statements+rollback 동봉) |
| 원장 tail | 20260713150000 → 20260713120000 → 20260711120000 → 20260710190000 (정합) |

→ PROD apply 완료 + 원장 정합 확보. deploy-ready 재마킹.
