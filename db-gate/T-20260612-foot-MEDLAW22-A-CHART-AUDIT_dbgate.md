# DB Gate Evidence — T-20260612-foot-MEDLAW22-A-CHART-AUDIT

- **요청**: supervisor FIX-REQUEST MSG-20260612-191252-cgri (qa_fail: phase1 / db_apply_pending)
- **대상 DB**: prod foot (Supabase `rxlomoozakkjesdqjtvd`)
- **마이그레이션**: `supabase/migrations/20260612150000_medical_charts_body_audit.sql`
- **롤백**: `supabase/migrations/20260612150000_medical_charts_body_audit.rollback.sql`
- **실행자**: dev-foot (직접 실행) · 2026-06-12T10:14 UTC
- **패턴 원본**: obliv-body-crm `20260516_body_061_medical_audit_log.sql` (foot 스키마 정합 — clinic_id TEXT, is_approved_user())

## 적용 내용
1. `medical_charts_audit_log` 테이블 (append-only, old_data/new_data JSONB 전체 행 스냅샷)
2. `trg_medical_charts_body_audit` — `medical_charts` BEFORE UPDATE 트리거 (SECURITY DEFINER)
3. RLS: SELECT/INSERT = is_approved_user(), UPDATE/DELETE 정책 부재(위변조 불가)

## BEFORE (적용 전)
- medical_charts_audit_log: 없음(신규)
- medical_charts 트리거: `[trg_enforce_medchart_signing_doctor]`
- is_approved_user() 헬퍼: ✅ 존재
- 대상 트리거 기존 존재: 없음 → 충돌 없음

## DRY-RUN (BEGIN..ROLLBACK — 영속 변경 0)
- ✅ medical_charts_audit_log 테이블 생성
- ✅ trg_medical_charts_body_audit 트리거 생성
- ✅ append-only (UPDATE/DELETE 정책 부재)
- ✅ 기존 enforce 트리거와 공존 (중복/충돌 없음)
- **DRY-RUN PASS — 스키마 충돌 없음**

## APPLY (prod 영속, 마이그 자체 BEGIN..COMMIT + DO$$ 검증)
- ✅ 마이그레이션 실행 완료 (COMMIT)

## AFTER (적용 후 검증 — 증빙)
- ✅ medical_charts_audit_log 테이블 영속 존재
- ✅ trg_medical_charts_body_audit 트리거 영속 존재
- ✅ append-only (UPDATE/DELETE 정책 부재)
- ✅ medical_charts_body_audit() SECURITY DEFINER
- 컬럼: id:uuid, medical_chart_id:uuid, clinic_id:text, old_data:jsonb, new_data:jsonb, changed_by:uuid, changed_at:timestamptz, operation:text
- medical_charts 트리거(최종): `[trg_enforce_medchart_signing_doctor, trg_medical_charts_body_audit]`
- audit_log RLS 정책: `[mcal_insert_approved/INSERT, mcal_select_approved/SELECT]`

**결과: ✅✅ APPLY 검증 PASS — prod 적용 완료**

> raw 출력: `db-gate/T-20260612-foot-MEDLAW22-A-CHART-AUDIT_apply_evidence.txt`
> 실행 스크립트: `scripts/T-20260612-foot-MEDLAW22-A-CHART-AUDIT_apply.mjs`
