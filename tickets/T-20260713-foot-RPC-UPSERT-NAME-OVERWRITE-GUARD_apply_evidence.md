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
