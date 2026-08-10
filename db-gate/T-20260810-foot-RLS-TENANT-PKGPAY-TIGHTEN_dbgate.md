# DB-GATE — T-20260810-foot-RLS-TENANT-PKGPAY-TIGHTEN

**verdict: GO** (DB-GATE-GO token signed) · supervisor · 2026-08-10 13:41 KST
prod_ref `rxlomoozakkjesdqjtvd` (foot) · migration_sha256 `1474d5ee5bdd00e39c3a488bc8388b1d915e29d889b3be4d4fd9a0b89998f870`

## 대상
`supabase/migrations/20260810200000_foot_rls_tenant_pkgpay_tighten.sql`
CREATE POLICY `package_payments_tenant_isolation` AS RESTRICTIVE FOR ALL TO authenticated
USING (clinic_id = current_user_clinic_id()) WITH CHECK (clinic_id = current_user_clinic_id())
change-class = exposure-REDUCING ADDITIVE (permissive DROP 0 · mutation 0 · reversible=DROP 1줄).

## DA 근거
DA CONSULT-REPLY MSG-20260810-125800-uohg · verdict = **조건부 GO**.
canonical 술어 `clinic_id = current_user_clinic_id()` (USING+WITH CHECK) CONFIRM.
SSOT = `agents/docs/da_replies/da_decision_foot_rls_tenant_pkgpay_tighten_20260810.md`.
신규티켓/fold 금지 (부모 T-20260629-meta-RLS-DRIFT-GUARD-PROD-PERIODIC B4-foot arm).

## 독립 prod DDL-diff (verdict-time 실측 — Management API, READ-ONLY)
| # | precondition | 실측 | 판정 |
|---|---|---|---|
| 1 | package_payments 실재 + RLS ENABLE | relrowsecurity=true | PASS (RESTRICTIVE 전제 충족) |
| 2 | current_user_clinic_id() resolver 실재 | proname 존재, 0-arg | PASS |
| 3 | target policy 부재 + permissive census | tenant_isolation 부재 · permissive 정확 6종(admin_all/approved_read/consult_insert/read/staff_unlock_6menu/write, 전부 TO authenticated) | PASS (멱등 safe · ADDITIVE ≥6 충족) |
| 4 | clinic_id 컬럼 실재 | uuid, nullable | PASS |
| 5 | H3 verdict-time 재실측 | total=169 · NULL=0 · distinct_clinics=1 | PASS (dev census drift 0 · 백필 불요 · own-clinic lockout 위험0) |

## deploy-precheck matrix (mode=db-gate, artifact_class=db_only)
- **PASS**: C0(no prior NO-GO) · C2(db_only exempt VALID — commit e4cb68c6 src/ diff 0) · C3(rollback 대칭 DROP 1줄 동봉) · C4(policy-only, cross-CRM 계약 무접촉) · C11(prod-realness PREFLIGHT 내장 + verdict-time 실측) · C12(ref-col clinic_id prod-present) · C18(DA HOLD/additive-binding CLEAR — signals+MQ) · C21(fresh frontmatter re-read: status=deploy-ready · block_reason 부재 · deploy_hold 부재)
- **N/A**: C1/C5(FE touch 0) · C10/C19/C23(CREATE FUNCTION/OR REPLACE 0) · C13/C24/C29/C30(web bundle/push deploy 0) · C14(db_only) · C17(archive INSERT 0) · C25(APK 0) · C26(ON CONFLICT 0) · C27(EF 0) · C28(staff role/active/owner 0) · C31(codeploy 0)

## up.sql 내장 가드 (dev)
- PREFLIGHT: 대상실재 + RLS ENABLE + H3 NULL0 apply시점 재확인 + resolver 실재 + 멱등abort
- VERIFY: RESTRICTIVE/authenticated/ALL 매칭 + USING&WITH CHECK canonical 술어 + permissive≥6 존치(ADDITIVE 불변식)
- dry-run PASS (무영속 post-probe: 신규 restrictive 부재 + permissive 존치)

## apply 계약 (dev-foot 책임 — C20 apply_before_go 준수)
1. GO-token = `db-gate/T-20260810-foot-RLS-TENANT-PKGPAY-TIGHTEN_GO.token.json` + `.sig` (ed25519, key_id supv-dbgate-2026a). **expires_at = 2026-08-10T10:41:07Z (19:41 KST) — TTL 6h**. 만료 시 supervisor 재서명 요청.
2. apply evidence 3필드 기록 의무: `go_token_path` · `go_issued_at` · `apply_ts`(issued_at ≤ apply_ts ≤ expires_at).
3. apply → up.sql VERIFY 통과 → `applied_at`(YYYY-MM-DD HH:MM + information_schema/pg_policies POSTCHECK) 기록.
4. apply-후 QA1~5 coherence = supervisor 사후검증: cross-clinic 0-row read / own-clinic read+write 지속 / clinic_id NULL0 / own INSERT WITH CHECK 성공 / cross-clinic principal write deny.
