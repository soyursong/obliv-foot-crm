# STEP3 EVIDENCE — foot RLS ungated admin-func gate sweep (remediation + BLOCKING/선결 gates)

- **Ticket**: T-20260806-foot-RLS-ADMINFUNC-UNGATED-PHILEAK-INHERIT-SWEEP
- **DA SSOT**: `agents/docs/da_replies/da_decision_foot_rls_adminfunc_ungated_phileak_inherit_sweep_20260806.md` (committed a40248a1a8e) — STEP3 write GO.
- **STEP1 census**: commit c202008a
- **DB**: foot prod (rxlomoozakkjesdqjtvd) — READ-ONLY introspection (Management API pure SELECT). DDL 0.
- **migration (forward-only, single atomic)**: `supabase/migrations/20260807100000_foot_rls_adminfunc_ungated_gate_sweep.sql`
- **rollback (down)**: `..._gate_sweep.rollback.sql` (pre-STEP3 ungated 정의 정확 복원)
- **dry-run**: `..._gate_sweep.dryrun.mjs` → `scripts/_evidence/step3_dryrun.out` (PASS)
- **raw evidence**: `scripts/_evidence/step3_introspect.out` · `step3_census2.out` · `step3_oracle.out` · `step3_oracle_detail.out` · `step3_dryrun.out`

---

## 선결 C2 — non-authz caller census (3 ungated 헬퍼) = **CLEAN → in-place 게이팅 GO**

각 헬퍼의 authz 외(표시 badge·역할-check UI 등) 호출부 존재 여부 (DA §DA-ask1 선결):

| 헬퍼 | RLS 정책 참조 | DB 함수 caller | DB view caller | FE(src) RPC caller | 판정 |
|------|---------------|----------------|-----------------|---------------------|------|
| `current_user_is_admin_or_manager` | 5 (전건 authz) | 0 | 0 | 0 | 순수 authz → in-place |
| `is_admin` (word-boundary) | 0 | 0 | 0 | 0 | 순수 authz(참조 0) → forward-safe |
| `is_manager_or_above` | 0 | 0 | 0 | 0 | 순수 authz(참조 0) → forward-safe |

- `current_user_is_admin_or_manager` 참조 5정책 = check_ins_delete_admin · daily_closings_write · insurance_sync_runs_read_admin · packages_delete_admin · payments_delete_admin → **헬퍼 게이팅 = chokepoint 로 by-construction 힐링**(재작성 안 함).
- **NO non-authz caller across DB fn / view / FE** → DA C2 default(in-place 게이팅) 채택. **재-CONSULT 트리거 #1 미발동.**
- evidence: `step3_census2.out` (I3a/I3b/I3c=0) · FE grep 0건.

---

## BLOCKING C5 — SET-DIFF per-surface verify-gate = **PASS (false lockout 0)**

불변식: NEW_eligible(S) = OLD_eligible(S) ∩ (approved∧active). 따라서 OLD∖NEW(S) = {role∈R(S) ∧ ¬(approved∧active)}. approved∧active 계정은 **구조적으로** 어떤 OLD∖NEW 에도 출현 불가.

`is_approved_user()` = `user_profiles.approved=true AND user_profiles.active=true` (prod 실측 def, `step3_introspect.out` I1).

### per-surface SET-DIFF (counts only, no PII — `step3_census2.out` I4d)

| surface(role-set) | role_members | NEW_eligible(approved∧active) | OLD∖NEW(lockout) | └ approved∧inactive | └ ¬approved | approved∧active in diff? |
|---|---|---|---|---|---|---|
| admin_manager (helper) | 16 | 15 | 1 | 1 | 0 | **0** |
| is_admin {ADMIN} | 13 | 12 | 1 | 1 | 0 | **0** |
| is_manager_or_above {admin,manager} | 16 | 15 | 1 | 1 | 0 | **0** |
| 6menu {consultant,coordinator,therapist} | 33 | 23 | 10 | 6 | 4 | **0** |
| therapist carve→gate | 15 | 11 | 4 | 4 | 0 | **0** |
| write4 {admin,manager,consultant,coordinator} | 34 | 27 | 7 | 3 | 4 | **0** |
| write5 (+therapist) = ② union | 49 | 38 | **11** | 7 | 4 | **0** |
| director_admin {director,admin} | 15 | 14 | 1 | 1 | 0 | **0** |

- 모든 surface: `NEW_eligible + lockout = role_members`, `approved∧inactive + ¬approved = lockout` → **lockout 전건 ¬(approved∧active). approved∧active diff 출현 0.**
- **② union(write5) lockout = 11 = DA §DA-ask3 census 정확 일치**: admin 1(approved∧inactive) + consultant 2(approved∧inactive) + coordinator 4(¬approved∧inactive) + therapist 4(approved∧inactive).
- **dispositive HARD-lockout = admin 1(approved∧inactive)** — 현재 payments/packages/check_ins DELETE + daily_closings ALL live 통과(누수) → gated 후 fail-closed. INTENDED narrowing(회귀 0).
- **재-CONSULT 트리거 #2(정직 approved∧active 계정 diff 출현) 미발동.** 계정 조치(approve/activate)는 HR/센터장 authority — 정책 되돌리기 아님(DA v3.28 계승).

---

## AC3 acceptance-oracle — 완전성 census (`step3_oracle.out` / `step3_oracle_detail.out`)

foot 전 테이블 pg_policies 중 role-check ∧ `is_approved_user` 부재 후보 전수 = **71건** 분류:

| disposition | n | 처리 |
|---|---|---|
| **TOUCHED (wrapped)** | 34 | 본 마이그 ②-conjoin/③-exempt/carve/6menu wrap |
| **HELPER-HEALED (chokepoint)** | 5 | current_user_is_admin_or_manager 게이팅으로 by-construction 힐링 |
| out-of-scope: 이미 inline-gated | 25 | `EXISTS(user_profiles … active=true AND approved=true AND role=ANY(...))` = 이미 approved∧active fail-closed (is_approved_user 함수만 미사용) → 누수 아님 |
| **out-of-scope: partial-gate(approved 누락)** | 7 | 별건 follow-up (아래 §follow-up) |

→ 본 티켓의 **ungated-helper/bare-role scope(39=34+5) 완전 커버**. AC3(scope 내 ungated 술어 잔존 0) 충족.

---

## finance-material flag (비-blocking · business-review 별건) — DA §DA-ask2/4

`daily_closings` + `package_payments` 6menu = floor-staff tier{consultant,coordinator,therapist} 에 finance 원장 write 부여. 본 스윕은 **approved∧active 게이트만 가산(wrap NOW)**. 'floor staff 가 finance write 를 가져야 하는가' 재고 = business role 결정(센터장 authority) = scope 밖 별건. (v3.28 DAILYCLOSE finance-tier flag 계승.)

---

## follow-up findings (비-blocking · fold 금지 · umbrella phi_rls_drift_guard)

DA Q6 doctrine(`package_payments_read` = fold 금지·별건 RC follow-up) 동형 처리:

1. **`package_payments_read` qual=true** (authenticated 전체 SELECT 개방·PHI-인접) — DA Q6 명시 scope 밖.
2. **★신규 발견 — active-only(approved 누락) partial-gate 7정책**: `admin_write_document_templates` · `admin_write_phrase_templates` · `staffarea_write_phrases` · `admin_write_prescription_sets` · `admin_write_quick_rx_buttons` · `admin_write_super_phrases` · `room_role_write`. 모두 `EXISTS(user_profiles … role=ANY(...) AND active=true)` 로 **active 는 걸지만 approved 미검**. 본 티켓의 fully-ungated 클래스와 **구조적으로 다른 클래스(partial-gate)** — STEP1 census(current_user_role()/helper 기반 검색)가 미포착. **현재 live 노출 0**(census: active∧¬approved 계정 0건) → 비-blocking. → umbrella `T-20260629-meta-RLS-DRIFT-GUARD-PROD-PERIODIC` 에 "미봉합 approved gate" 클래스로 등재 권고(DA §계약자산 편입 NONE 의 drift-guard leg 정합).

→ 이 두 항목 모두 **본 마이그에 fold 안 함**(DA scope 준수·재-CONSULT 트리거 #7 회피).

---

## §11 medical-view gate 고려 (chart_doctor_memos / medical_charts)

PART 6(cdm_director_clinic_v2 · mc_clinic_isolated_v3 · mc_deleted_rows_director_only) = medical PHI 테이블 RLS. 본 변경은 **데이터층 fail-closed narrowing**이며 진료대시보드/진료관리 **화면(코드)** 를 수정하지 않는다(src/ touch 0). approved∧active director/admin/manager 접근 100% 보존(회귀 0·SET-DIFF director_admin surface lockout=1=approved∧inactive admin뿐) → 정당 의료 사용자에 behaviorally invisible. DA(데이터 권위) STEP3 write GO 에 명시 포함(§DA-ask2 lines 56-57). supervisor PHI DB-GATE 에서 재확인 대상으로 flag.

---

## MIG-GATE 4필드 요약

- **mig_files**: `supabase/migrations/20260807100000_foot_rls_adminfunc_ungated_gate_sweep.sql` (+ `.rollback.sql` + `.dryrun.mjs`)
- **mig_dryrun**: PASS — No-Persistence(txn-control strip · plpgsql exception-rollback · 9 post-probe gate-ABSENT). `step3_dryrun.out`.
- **mig_ledger_check**: schema_migrations 충돌 0(`20260807100000` 미존재) · ledger max=`20260806150000` < 신규 timestamp(forward-only) · prod 현 ungated(apply=genuine tighten).
- **mig_rollback**: `..._gate_sweep.rollback.sql` = pre-STEP3 정의 정확 복원(3헬퍼 ungated + 34정책 원 술어, prod 실측 I1/I2b 기반).

## forward-only 하드가드 준수

공유 계보 `20260423000000_rls_role_policies.sql` **무수정**. 신규 foot 타임스탬프 마이그로 forward CREATE OR REPLACE + ALTER POLICY. (재-CONSULT 트리거 #6 미발동.)
