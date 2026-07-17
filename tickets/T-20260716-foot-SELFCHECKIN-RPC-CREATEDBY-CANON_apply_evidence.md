# T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON — PROD APPLY EVIDENCE

- **작업**: dev-foot / FIX-REQUEST MSG-20260717-143359-0kau (supervisor, P1)
- **대상**: prod `rxlomoozakkjesdqjtvd` · `public.fn_selfcheckin_upsert_customer` / `_resolve_v2` / `_resolve_v3`
- **유형**: 비파괴 CREATE OR REPLACE FUNCTION x3 (스키마/컬럼/enum/signature 무변경 — customers.created_by 컬럼 기존재)
- **적용 경로**: Supabase Management API `/database/query` (SUPABASE_ACCESS_TOKEN, .env.local)
- **배포 순서 게이트**: 부모(T-20260715) 先적용 → 자식(T-20260716) 後적용 (순차 준수)

## qa_fail 해소 (2건)

### (1) 배포 순서 게이트 — 부모 PROD 先적용 완료
- **부모 티켓**: T-20260715-foot-UPSERT-RPC-NORMALIZE-BEFORE-WRITE
- **부모 파일**: `supabase/migrations/20260716230000_foot_selfcheckin_upsert_writepath_phone_normalize.sql`
- **applied_at**: 2026-07-17 15:57:16 KST (2026-07-17 06:57:16 UTC)
- **PRE-probe**: 3함수 모두 `normalize_write=false`
- **POSTCHECK**: 3함수 모두 `normalize_write=true` ✅ (INSERT VALUES phone → `public.normalize_phone(NULLIF(p_phone,''))`)

### (2) DDL-diff 파일 경로 / 리포 동기화
- **RC**: 자식 마이그 파일이 feature 브랜치에만 존재, main 미병합 → supervisor 로컬(main) 미검출.
- **파일 위치(정확 경로)**: `origin/feat/T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON`
  - `supabase/migrations/20260717120000_foot_selfcheckin_upsert_created_by_canon.sql`
  - `supabase/migrations/20260717120000_foot_selfcheckin_upsert_created_by_canon.rollback.sql`
  - `supabase/migrations/20260717120000_foot_selfcheckin_upsert_created_by_canon.dryrun.sql`
- **동기화 확인**: local HEAD == origin/feat/... (0 ahead / 0 behind). 브랜치 origin push 완료.
- **supervisor DDL-diff 재확인 명령**:
  ```
  git fetch origin
  git show origin/feat/T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON:supabase/migrations/20260717120000_foot_selfcheckin_upsert_created_by_canon.sql
  ```

## 자식(T-20260716) 적용 결과
- **파일**: `supabase/migrations/20260717120000_foot_selfcheckin_upsert_created_by_canon.sql`
- **applied_at**: 2026-07-17 15:57:24 KST (2026-07-17 06:57:24 UTC)

| 함수 | normalize_write | INSERT created_by='self_checkin' | UPDATE SET created_by 누출 |
|------|-----------------|----------------------------------|----------------------------|
| fn_selfcheckin_upsert_customer | true ✅ | ✅ | 없음(clean) ✅ |
| fn_selfcheckin_upsert_customer_resolve_v2 | true ✅ | ✅ | 없음(clean) ✅ |
| fn_selfcheckin_upsert_customer_resolve_v3 | true ✅ | ✅ | 없음(clean) ✅ |

- **new-write-only 불변식**: 문별(statement-level) 정밀 검증 — UPDATE customers 블록에 created_by 부재(기존 스태프 귀속 보존), INSERT 경로만 `'self_checkin'` stamp. ✅

## MIG-GATE evidence (4필드)
- **mig_files**: up.sql + rollback.sql + dryrun.sql + dryrun.mjs 동봉 (부모/자식 각각).
- **mig_dryrun (No-Persistence Protocol)**: 부모/자식 dryrun.out.json — `C_no_persistence_confirmed=true`, `B_apply_in_txn.in_txn_assertion=PASS`.
- **mig_ledger_check**: Management API apply 경로는 CLI 원장 미기입 → `supabase_migrations.schema_migrations` 에 두 version 수동 reconcile INSERT (prod실재=원장=파일선언 3자 수렴).
  - `20260716230000 / foot_selfcheckin_upsert_writepath_phone_normalize`
  - `20260717120000 / foot_selfcheckin_upsert_created_by_canon`
- **mig_rollback**: 각 `*.rollback.sql` = 직전 권위 body CREATE OR REPLACE 복원 (signature 무변경 → DROP 불요). 순서: 자식 rollback(created_by 제거, post-normalize 복원) → 부모 rollback(normalize 제거).

## §S2.4 데이터 정책 게이트
- 신규 컬럼/테이블/enum 0. `customers.created_by`(text/nullable/no-default) 기존재(20260419000000 initial_schema).
- DA CONSULT 신규 불요: 부모 DA CONSULT-REPLY Q5(created_by = phone canon 직교 판정 + 값=planner 위임)로 커버.

→ 부모/자식 PROD-live 확정. supervisor DDL-diff 재확인 + deployed 마킹 대기.
