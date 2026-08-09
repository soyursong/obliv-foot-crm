# DB-GATE evidence — T-20260606-foot-CHART-DIAG-MULTI-PRIMARY-PRINT

- **artifact-class**: web_fe (FE + E2E) **+ db_only** (chart_diagnoses 신규 연결테이블 · ADDITIVE)
- **da_consult_ref**: `agents/docs/da_replies/da_decision_foot_chart_diagnoses_multi_primary_20260809.md` (commit 7819ccfee18) — 조건부 GO · change-class=ADDITIVE · §3.1 CEO 파괴게이트 면제 YES · 잔여=supervisor DDL-diff only
- **date**: 2026-08-09 (KST)
- **prod apply**: **미적용 — supervisor DB-GATE GO-token 대기** (§10 v1.8 apply_before_go 금지). deploy-ready 마킹은 dry-run 무영속 4필드로 충족.

## DA HARD 3조건 반영 결과

| 조건 | 요구 | 반영 | 증적 |
|------|------|------|------|
| **HARD-1** (dispositive·RLS) | 4 RLS permissive `USING(true)/WITH CHECK(true)` → 부모 `medical_charts` clinic 격리 상속 재작성, cross-clinic PHI 누출 차단, anon 0 | ✅ 4정책 전부 `chart_id JOIN medical_charts` + 부모 `mc_clinic_isolated_v3` 동형 술어(`current_user_clinic_id()::text` + NULL-role fallback)로 재작성. governance anchor=hardened 부모 20260527 | dry-run: `HARD-1 permissive 잔재 없음`✅ / `4정책 전부 부모 clinic 격리 상속`✅ / `anon 0 TO authenticated 한정`✅ |
| **HARD-2** (주상병 무결성·AC-2) | chart당 primary at-most-one 강제 (partial-unique 권장) | ✅ `create unique index uq_chart_diagnoses_one_primary on chart_diagnoses(chart_id) where diagnosis_type='primary'` (DB belt-and-suspenders) + 앱 validation(MedicalChartPanel 주상병 최소1건 방어선) 이중 | dry-run: `HARD-2 partial-unique … WHERE primary`✅ |
| **HARD-3** (backfill 파생안전) | parseIcdFromText 마이크로규율 4항 | ✅ (a)fail-open-to-text CONFIRM (b)no-fabrication(code=NULL) CONFIRM (c)idempotency `WHERE NOT EXISTS(chart_id)`+HARD-2 결속 CONFIRM (d)STEP1 sample20 parse-accuracy 사람검수 명문화 | `.backfill.sql` 헤더 4항 CONFIRM 주석. (d) 육안검수 = backfill 실행게이트(DA gate order step5, supervisor+대표) 시점 |

## Q1 선례 스키마 재대조 (da_consult_ref 정본)

- 티켓 `ac0_resolution` 인용 `claim_diagnoses(claim_id+kcd_code+is_primary+sort_order)` = **misremembered**.
- 실측(`20260515000010_sales_common_db.sql`): `disease_code`(free-text·master FK 없음)+`disease_name`+`sort_order`. **is_primary/kcd_code 부재**.
- ⟹ chart_diagnoses `diagnosis_code/diagnosis_name` = 선례 snapshot free-text와 동형 · `diagnosis_type` enum + nullable `service_id` FK = 구조 SUPERSET(개선). primary rank 축=신규 → HARD-2 DB 강제로 무결성 확보. 마이그 설계메모 주석 정정 반영.

## mig 4필드 (deploy-ready 무영속 증적)

- **mig_files**: `supabase/migrations/20260606140000_chart_diagnoses.sql` · `.rollback.sql` · `.backfill.sql` (+ runner `scripts/…_dryrun.mjs`)
- **mig_dryrun**: `node scripts/T-20260606-foot-CHART-DIAG-MULTI-PRIMARY-PRINT_dryrun.mjs` → **ALL PASS**. txn-control 부재(sentinel-bypass 불가)·PRE/POST 무영속 probe(table 부재)·BEGIN…ROLLBACK 내 introspection. FK(CASCADE/SET NULL)·CHECK enum·RLS 4정책 hardened·HARD-2 index 검증.
- **mig_ledger_check**: `supabase_migrations.schema_migrations` 에 `20260606140000` **부재(unapplied — 정상, GO-token 대기)** · prod `chart_diagnoses` 테이블 **부재** · `20260606%` version collision **NONE**.
- **mig_rollback**: `.rollback.sql` 대칭 — up→down 후 테이블/인덱스(uq_ 포함)/정책 전량 소거 확인(dry-run 트랜잭션 내).

## 빌드 / E2E

- `npm run build` → exit 0 (vite built in ~6.85s).
- `npx playwright test …CHART-DIAG-MULTI-PRIMARY-PRINT.spec.ts` → **12 passed** (AC-1/2/3 순수 로직 정합 + AC-0 하위호환 + AC-2 주상병 강제 방어선).

## 잔여 게이트 (DA gate order)

1. ✅ DA 조건부 GO
2. ✅ dev-foot HARD-1/2/3 반영 + Q1 재확인 (본 증적)
3. → planner deploy-ready flip
4. → **supervisor DDL-diff** (additive·rollback 대칭·RLS clinic-격리 parity assert·anon-EXEC 무증가·FK correctness·primary partial-unique 존재 assert) + **DB-GATE GO-token**
5. → backfill (STEP1 dry-run count+sample20 parse-accuracy 사람확인 → STEP2 INSERT·idempotent)
6. → prod apply (GO-token 후)

## ⚠ 통합 노트 (planner/supervisor 주지)

- FE 구현물(feat `410861b1`: MedicalChartPanel/DiagnosisFolderPicker/autoBindContext + E2E spec)은 원래 feature 브랜치 `foot/T-20260606-chart-diag-multi-primary-print`에만 있고 **main 미병합** 상태였음(planner 인지 HEAD e1ac5ea0 = 브랜치 tip). 본 작업에서 해당 feat를 **main으로 cherry-pick**(대상 FE 3파일 branch-point 이후 main 무변경 → 무충돌) + HARD 델타를 main 마이그에 반영. ⟹ FE + hardened 마이그 + spec 전부 배포 브랜치(main)에 정합.
