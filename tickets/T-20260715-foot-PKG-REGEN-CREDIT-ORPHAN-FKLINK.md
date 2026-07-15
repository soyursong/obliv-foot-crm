---
id: T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK
domain: foot
priority: P1
status: deploy-ready
qa_result: pending (supervisor DDL-diff 게이트)
resolution: grain-antipattern 구조해소 — §10-5 ledger-SSOT 적용(FK linkage + credit ledger + supersede lineage)
db_change: true
db_migration: 20260715190000_foot_pkg_regen_credit_ledger_fklink.sql (+ .rollback.sql / .dryrun.sql / orphan freeze report)
mig_files:
  - supabase/migrations/20260715190000_foot_pkg_regen_credit_ledger_fklink.sql
  - supabase/migrations/20260715190000_foot_pkg_regen_credit_ledger_fklink.rollback.sql
  - supabase/migrations/20260715190000_foot_pkg_regen_credit_ledger_fklink.dryrun.sql
  - supabase/migrations/20260715190000_foot_pkg_orphan_credit_freeze.report.sql
mig_dryrun: "PASS — supabase/ops/T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK_dryrun_20260715_RESULT.log (Mgmt API, 2026-07-15T11:02Z, commit 703d2bb4). No-Persistence: baseline 부재 / canary ROLLBACK 실효 / apply in-txn assert 통과 / post-probe 무영속 확증."
mig_ledger_check: "3-way OK(pre-apply, divergence 0): 파일 staged / schema_migrations 미등록 / prod 부재. 최신 20260715140000 < 190000 순서정합. 적용 후 forward-consistent."
mig_rollback: "20260715190000_foot_pkg_regen_credit_ledger_fklink.rollback.sql — ADDITIVE 역순, 0-row 전제, canary로 ROLLBACK 실효 선증명."
db_gate: |
  CONSULT-REPLY GO(조건부) 수신(MSG-20260715-153541, DA-20260715-...-FKLINK.md).
  구조 = 전부 ADDITIVE(payments.package_id NULLABLE FK + packages.superseded_by NULLABLE
  + package_credit_ledger/package_amendments 신규 0-row) → agent_autonomy_policy §3.1 대표게이트 면제,
  supervisor DDL-diff only. 백필(credit re-anchor)은 data lane 별도 게이트(freeze report 제출 → data-diff).
build: pass (npm run build ✓ 5.91s — FE 무변경, 신규 컬럼 NULL 기본 회귀0)
scenario_count: 1 (구조 4객체 착지 + 불변식: FK RESTRICT / balance 파생 / append-only 앵커)
e2e_spec: tests/e2e/T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK.spec.ts
spec: tests/e2e/T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK.spec.ts
created: 2026-07-15
completed: 2026-07-15
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: dev-foot CONSULT (MSG-20260715-153033) → data-architect CONSULT-REPLY (MSG-20260715-153541)
consult_reply: DA-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK.md
---

# T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK — 패키지 재생성 credit 고아화 구조 해소

## 근본 원인 (F-4716)
"패키지 크레딧을 mutable 패키지 행(`packages.paid_amount`)에 권위 저장" grain 안티패턴.
재생성(cancel + 신규 INSERT) 시 새 행이 `paid_amount=0` 으로 출발 → 원 패키지의 선납 credit 이
계보 없이 stranded(고아). `package_payments.package_id` 는 ON DELETE CASCADE 라 물리삭제 시 소실.

## 처방 (DA CONSULT-REPLY — §10-5 ledger-SSOT 적용, 신규정책 아님)
- **Q1 권위 grain = NEITHER**: 현금흐름=`payments`(append-only 수납), 크레딧 권위=append-only ledger.
  - `payments.package_id` FK 추가(ADDITIVE, ON DELETE RESTRICT) = traceability + 무단삭제 fail-closed.
  - `package_credit_ledger`(charge/use/refund/transfer, polymorphic account_ref) — balance=Σ 파생.
  - `paid_amount/credit '승계 로직'` = **REJECT**(§10-5 기각한 이중 balance 캐시 재도입 금지).
- **Q2 재생성 = decouple**: `packages.superseded_by`(old→new lineage) + `package_amendments`(누가/왜 audit).
  파괴적 delete-then-insert 금지.
- **Q3 백필 = re-anchor(연결복원)**: freeze→건별 probe→ledger charge tx re-anchor. blanket UPDATE 금지.
  잔존분 규모 미상 → freeze report 로 count 산출 제출(별도 data-diff 게이트).

## 착지물 (구조 lane — 본 티켓)
- `supabase/migrations/20260715190000_foot_pkg_regen_credit_ledger_fklink.sql` (+ .rollback / .dryrun)
- `supabase/migrations/20260715190000_foot_pkg_orphan_credit_freeze.report.sql` (READ-ONLY 술어+count)
- `tests/e2e/T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK.spec.ts`

## 후속 (별도 티켓/lane)
1. **백필(data lane)**: 구조 적용 후 freeze report 실행 → count 제출 → supervisor data-diff 게이트로 re-anchor.
2. **FE 수렴(end-state)**: 재생성 UX 를 ledger charge/use + superseded_by 링크로 전환(paid_amount → ledger 이관).
   구조 선착지 원칙(§10-7) — 백필로 ledger 채운 뒤 FE 소비. cross-CRM(body/scalp) 공통표준 seed(§10-5 fold).
