# T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK — MIG-GATE 증거 (dry-run + ledger 대조)

- author: dev-foot
- date: 2026-08-02
- migration: `supabase/migrations/20260802160000_foot_closing_confirmed_edit.sql` (ADDITIVE)
- change-class: ADDITIVE (net-new: `closing_edit_log` 테이블 1 + `closing_confirmed_edit()` RPC 1).
  herald port GOLDEN(`daily_closings.revision` / `daily_closing_confirm_guard` / `enqueue_closing_confirmed`,
  20260718140000 deployed 2026-07-19) 소유 DDL 은 재사용(중복 신설 0).

## 1) dry-run (no-persistence) — PASS

러너: `node scripts/dryrun_lib.mjs`(canonical foot, Management API + txn-control strip + plpgsql
exception-rollback + post-probe). 표준: `migration_dryrun_no_persistence_standard.md`.

```
== dry-run 20260802160000_foot_closing_confirmed_edit.sql ==
   stripped top-level txn-control (INV-5): ["BEGIN;","COMMIT;"]
   harness response: []
   post-probe [closing_edit_log_absent]        absent? -> true
   post-probe [closing_confirmed_edit_absent]  absent? -> true
== DRY-RUN PASS == (txn-control stripped · plpgsql exception-rollback · post-probe absent)
```

- up.sql 이 herald port 전제(revision/unconfirmed_at/confirmed_by 컬럼 + confirm_guard + enqueue) 위에서
  깔끔히 실행(누락 의존성 0). 무영속 확인(objects 부재 = 리크 0).

## 2) ledger 대조 — ⚠ DIVERGENCE (phantom 원장 행)

prod `supabase_migrations.schema_migrations` 실측(2026-08-02):

| version        | ledger 행 | 실제 객체                                  | 판정 |
|----------------|-----------|--------------------------------------------|------|
| 20260802150000 | 있음      | `form_submissions.is_deleted` 존재         | 정합 |
| 20260802160000 | **있음**  | `closing_edit_log` **부재** · RPC **부재** | **DIVERGENT** |

- **20260802160000 ledger 행은 phantom** — 객체가 prod 에 미생성인데 원장에만 stamp 됨.
- **리스크**: 이 상태에서 `supabase db push`(ledger-gated) 실행 시 이미-적용으로 오판 → **DDL skip →
  `closing_edit_log`/`closing_confirmed_edit` 영영 미생성** → FE `supabase.rpc('closing_confirmed_edit')`·
  `.from('closing_edit_log')` prod 크래시/404.

### supervisor 적용 시 필수 조치 (prod 스키마 변경 = supervisor 권한)
Migration Ledger Reconciliation 표준(정본=prod 실재 기준 수렴) 적용, 둘 중 하나:
1. phantom 원장 행 선-정리 후 push:
   `DELETE FROM supabase_migrations.schema_migrations WHERE version='20260802160000';` → `supabase db push`
   (idempotent CREATE IF NOT EXISTS 이므로 재적용 무해), 또는
2. up.sql 을 Management API 로 직접 실행(멱등) → 객체 생성 확인 → ledger 행은 유지(이미 존재).

두 경로 모두 종결조건 = `to_regclass('public.closing_edit_log') IS NOT NULL`
AND `EXISTS(pg_proc proname='closing_confirmed_edit')` = true (deploy-precheck C11 prod-schema 실재).

## 3) rollback
`supabase/migrations/20260802160000_foot_closing_confirmed_edit.rollback.sql`
— RPC DROP(진입 차단), `closing_edit_log` 는 원장 무결성상 기본 보존(완전원복 시에만 DROP 주석 해제).
herald port 소유 DDL 무접촉.
