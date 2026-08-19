# T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL — dispositive READ-ONLY census evidence

- **러너**: `scripts/T-20260820-foot-RLS-NEWTABLES-RESIDUAL-SEAL_census_readonly.mjs`
- **project**: rxlomoozakkjesdqjtvd (prod, Management API) · **WRITE 0 · DDL 0** · 2026-08-20
- **DA SSOT**: `agents/docs/da_replies/da_decision_foot_rls_newtables_residual_timer_waiting_20260820.md`

## ① timer_records — dispositive lockout-safety = (i) CLEAN SEAL = GO

| probe | 결과 |
|-------|------|
| T1_count | total=**691** · clinic_id NULL=**0** · empty=**0** · distinct=**1** |
| T1_distinct_values | 단일 distinct clinic_id = `74967aea-a60b-4da3-a0e7-9c997a930bc8` · is_valid_uuid_shape=**TRUE** |
| T1_clinics | jongno-foot id=`74967aea-…-930bc8`(timer_rows=**691**) / songdo-foot(timer_rows=0·LATENT) |
| T1_dispositive_resolve | total=691 · rows_resolving_to_a_clinic=**691** · rows_resolving_to_jongno=**691** |
| T1_policies | offending permissive **3종** 실재: SELECT USING(true)·INSERT WITH CHECK(true)·UPDATE USING(true)+WITH CHECK(true) → write **WIDE-OPEN** → grain=**FOR ALL** |
| T1_rls_enabled | rls_enabled=**true** (RESTRICTIVE 유효 전제 충족) |
| T1_helpers | current_user_clinic_id()→**uuid** · is_admin_or_manager()→**boolean** 실재 |

**판정**: 단일 distinct TEXT 값 = valid-uuid == jongno clinic_id(text) → text-side cast `clinic_id = current_user_clinic_id()::text` 가 jongno staff **691행 전건 TRUE** → clean seal · lockout 0 = **(i) GO 경로**. (H1 (ii)slug-lockout / (iii)NULL 실측 배제.)

## ② waiting_board — operational-display = DEFER (tracked-informational)

| probe | 결과 |
|-------|------|
| W2_columns | id·clinic_id·queue_number·room·status·display_name·checked_in_at·updated_at (8) |
| W2_phi_column_scan | phi_named_cols=**0** · display_name_col=1 · total=8 |
| W2_display_name_sample | total=90 · masked=**90/90** · possibly_unmasked_multichar=**0** |
| W2_anon_scope | total=90 · distinct_clinics=**1** (jongno-only·songdo LATENT) |

**판정**: PHI 컬럼 0 · display_name 전량 마스킹(mask_display_name·write-time) · zero-PII sanitized projection(by design·T-20260628-foot-WAITING-REALTIME) → **operational-display** = DA (a) **DEFER 수용**. authenticated-seal-in-isolation=anon superset(공개 대기현황판) 하 confidentiality NO-OP → 본 마이그 seal 미대상(NO-OP). 현 단일-clinic public=legit · **songdo 활성 = cross-clinic anon leak material trigger(planner tracked)**.

## 배포 게이트 상태 (READ-ONLY, 2026-08-20)
- schema_migrations 20260820120000: **부재**(slot free·reconcile 불요).
- timer_records_tenant_isolation prod: **부재**(count 0·applied_at 공란 정합).
- no-persistence dry-run: **PASS**(post-probe policy absent).
- **apply-gate=supervisor**: CREATE POLICY=DDL → MIG-GATE(DDL-diff)+물리 GO-token 선행 REQUIRED. GO-token 前 prod DDL 선집행 금지(C20).
