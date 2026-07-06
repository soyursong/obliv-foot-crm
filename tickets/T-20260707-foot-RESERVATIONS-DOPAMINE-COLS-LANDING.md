---
ticket_id: T-20260707-foot-RESERVATIONS-DOPAMINE-COLS-LANDING
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-07-07
build_ok: true
spec_added: e2e_spec_exempt=db_only (read/UI 무회귀는 sibling part a READ T-20260707-foot-RESERVATIONS-DOPAMINE-COLS-READ / spec T-20260707-foot-RESERVATIONS-DOPAMINE-COLS-READ.spec.ts 담당, (a)⊥(b) decouple)
db_changed: true
rollback_sql: supabase/migrations/20260707120500_foot_reservations_dopamine_call_cols_landing.rollback.sql
data_architect_consult: GO · ADDITIVE · 대표 게이트 불요 (CONSULT-REPLY DA-20260707-RESV-DOPAMINE-LANDING-TOPOLOGY, MSG-081145-8t3v). topology Q1=(b) CRM별 물리 분리(reservations=5 물리 포크), Q2 착지주체=dev-foot 자기 ADDITIVE + supervisor DDL-diff (dopamine cross-project write 금지). 부모 T-20260521-ops-CROSSPRODUCT-V1-GATE AC6(§3=A ADDITIVE)
db_gate: supabase/migrations/20260707120500_foot_reservations_dopamine_call_cols_landing.sql (ADD COLUMN IF NOT EXISTS ×3, 테이블/enum 무변경·상수 DEFAULT=PG11+ 메타-only rewrite/lock 없음, supervisor DDL-diff Gate 대기)
risk_level: GO (1/5 — ADDITIVE 3컬럼 자기 추가, nullable/defaulted, 파괴/RLS/스키마변형/대량 0. 풋 FE=read-only optional 필드, 역write 금지)
deploy_ready: true
commit_sha: 1a601184
# ── MIG-GATE 4필드 ──
mig_files: supabase/migrations/20260707120500_foot_reservations_dopamine_call_cols_landing.sql (ADD COLUMN IF NOT EXISTS 멱등 ×3 + COMMENT) / .rollback.sql 동봉 (DROP COLUMN IF EXISTS ×3, 콜마킹 소실 주석)
mig_dryrun: scripts/apply_20260707120500_reservations_dopamine_call_cols_landing.mjs (기본 dry-run=무write, --apply 게이트 후. dry-run 재현 [before] 3/3 실재·계획 확인)
mig_ledger_check: 3자 정합 PASS — (a) prod DDL 실재 3/3(prevention_call_done bool default false · cancellation_call_done bool default false · no_show_clicked_at timestamptz null, 타입·default 일치) · (b) schema_migrations 원장 등재 version=20260707120500 · (c) 파일 선언. apply=foot_migration_ledger helper 단일경로(applyMigration → schema_migrations 자동 INSERT)
mig_rollback: supabase/migrations/20260707120500_foot_reservations_dopamine_call_cols_landing.rollback.sql (3컬럼 DROP COLUMN IF EXISTS → schema 무손실 원복. DROP 시 축적 도파민 콜마킹 소실 주석 동봉, 롤백 전 잔여 마킹 count 확인 쿼리 포함)
---

# T-20260707-foot-RESERVATIONS-DOPAMINE-COLS-LANDING — reservations 도파민 3컬럼 ADDITIVE 착지 (part b)

## 요청 (NEW-TASK, planner P1 — MSG-20260707-082319-e9v9)

DA CONSULT-REPLY(DA-20260707-RESV-DOPAMINE-LANDING-TOPOLOGY, MSG-081145-8t3v)로 reservations
topology 확정. 08:02 PLANNER-HOLD 해제. 풋센터CRM prod `reservations` 에 도파민TM 콜 컬럼 3종을
자기 ADDITIVE 로 착지.

- **prevention_call_done** boolean default false — 예방콜(내원 전 리마인드 콜) 완료 여부
- **cancellation_call_done** boolean default false — 취소콜(취소 예약 사후 콜) 완료 여부
- **no_show_clicked_at** timestamptz null — 노쇼 클릭 처리 시각

- 타입 근거 = dopamine IMPL 20260707120500 (schema 계약 parity, 동일 version·동일 타입).
- ADD COLUMN IF NOT EXISTS (멱등) / 롤백 = DROP COLUMN IF EXISTS.
- write = 기존 콜백 재사용(도파민TM 발원→콜백 자기DB 기록 + no_show 는 CRM UI→crm-lifecycle-callback §6-6). cross-project write 없음.
- 풋 FE = read-only (sibling part a READ 9bf7538c 旣배포). 이 필드 역write 금지.

## 게이트

- `db_change=true` → MIG-GATE 4필드 필수 (frontmatter 상단).
- ADDITIVE + DA GO → **대표 게이트 면제**(autonomy §3.1), **supervisor DDL-diff만**.

## 착지 실측 (2026-07-07)

3자 정합 PASS:
1. **(a) prod DDL 실재 3/3** — dry-run [before] 재확인: cancellation_call_done bool nullable default false · no_show_clicked_at timestamptz nullable default null · prevention_call_done bool nullable default false.
2. **(b) schema_migrations 원장 등재** — ledgerVersions().has('20260707120500') = true.
3. **(c) 파일 선언** — .sql / .rollback.sql / apply.mjs 커밋(1a601184).

write 경로 정상: 격리 tx UPDATE(prevention/cancellation/no_show)→ROLLBACK, 23514(CHECK)/42703(undefined_column) = 0.

## 무회귀

- `npm run build` PASS.
- 신규/재진 이중 동선 예약화면: 풋 FE=read-only optional 필드 → 컬럼 존재 시에도 select('*') extra key 무해(part a READ tolerant 배포 9bf7538c), UPDATE는 명시 payload만 → 역write 위험 0. 예약 목록/상세·신규/재진 이중동선 무영향.
- E2E: `e2e_spec_exempt=db_only` — read/UI 무회귀는 sibling part a READ 담당((a)⊥(b) decouple).

## 결과

- commit 1a601184 (migration .sql/.rollback.sql/apply.mjs) push main → Vercel 자동.
- **DB변경: 있음** (ADDITIVE 3컬럼, 착지 완료·prod 실재 확인).
- → supervisor DDL-diff Gate (ADDITIVE+DA GO, 대표 게이트 면제).
