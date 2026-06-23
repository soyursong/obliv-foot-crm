---
id: T-20260622-foot-BLOODTEST-RESULT-PUBLISH-BACKEND
domain: foot
status: deploy-ready
deploy-ready: true
db_change: true
build_ok: true
spec_added: tests/e2e/T-20260622-foot-BLOODTEST-RESULT-PUBLISH-BACKEND.spec.ts
summary: "혈액검사 결과지 업로드/보기 백엔드(B안 파일보관) — patient_file_records 메타 테이블 + documents 버킷 재사용"
migration: supabase/migrations/20260623150000_patient_file_records.sql
rollback_sql: supabase/migrations/20260623150000_patient_file_records.rollback.sql
da_consult: MSG-20260623-083432-0ov6 (CONSULT-REPLY GO, ADDITIVE)
priority: P2
created_at: 2026-06-23
deployed_at: ""
---

# T-20260622-foot-BLOODTEST-RESULT-PUBLISH-BACKEND (B안 파일보관)

치료 테이블 §B '균검사 & 피검사 대상자' — 혈액검사 결과지 업로드/보기 백엔드.
DA CONSULT-REPLY GO(MSG-20260623-083432-0ov6, ADDITIVE·파괴0·계약충돌0). 대표 게이트 면제.

## 확정 설계 (DA 채택)
- **버킷**: 기존 `documents` 재사용(신규버킷 X). path = `customer/{customerId}/blood_result_{ts}.{ext}`.
  기존 `useDocumentUpload` 훅 + 1h signedURL 그대로. ext = pdf·jpg·png만(FE/훅 검증).
- **신규 메타 테이블** `patient_file_records`(derm 미러링, ADDITIVE):
  id/clinic_id(NOT NULL→clinics)/customer_id(NOT NULL→customers ON DELETE CASCADE)/file_name/file_path/
  file_size/mime_type(CHECK in application/pdf,image/jpeg,image/png)/kind(NOT NULL DEFAULT 'blood_result')/
  uploaded_by(→auth.users)/note/created_at.
  인덱스 idx_pfr_customer(customer_id, created_at DESC) / idx_pfr_clinic(clinic_id).
  RLS clinic_id 스코프(계약 §1, current_user_clinic_id()) — select/insert + own_delete(uploaded_by).
  롤백 SQL 동반: `DROP TABLE IF EXISTS patient_file_records;`

## 수용기준
- AC-1 업로드(다중)+메타 적재 ✅ — `BloodResultDialog` uploadMany(documents, prefix=blood_result) → patient_file_records insert.
- AC-2 결과지 보기 열람(signedUrl, read-after-write) ✅ — 목록(customer_id+kind) + on-demand createSignedUrl(1h) + 업로드 후 load() 재조회 + 부모 카운트 invalidate.
- AC-3 기존 documents·결제·차트 회귀 0 ✅ — 버킷·훅·경로 컨벤션 재사용(신규버킷 0), 부모 섹션 read-only.
- AC-4 마이그 롤백SQL 동반·RLS clinic_id ✅ — 마이그+롤백 SQL 파일, RLS 3정책 dev 적용·검증.
- AC-5 ext pdf/jpg/png만·mime CHECK 정합 ✅ — FE ALLOWED_EXT/accept ↔ DB mime CHECK 3종 일치.

## 구현
- 신규: `src/components/BloodResultDialog.tsx` (업로드+보기 다이얼로그)
- 변경: `src/components/treatment/ExamTargetsSection.tsx` (피검사 '준비중' 비활성 → '결과지 업로드'/'결과지 보기 (N)' 활성, useBloodResultCounts 인덱스)
- 마이그: `supabase/migrations/20260623150000_patient_file_records.sql` + `.rollback.sql` (dev 적용 완료: RLS on, 3정책, mime CHECK 거부 검증)
- 적용 스크립트: `scripts/apply_20260623150000_patient_file_records_pg.mjs`
- spec: `tests/e2e/T-20260622-foot-BLOODTEST-RESULT-PUBLISH-BACKEND.spec.ts` + EXAMTARGET 회귀 spec 갱신

## 게이트
- supervisor DDL-diff(patient_file_records 마이그+롤백SQL) = deploy-ready 마킹 후 QA 시점 집행. 롤백 SQL 동봉됨.
- 빌드 OK / spec 18 PASS(신규 11 + EXAMTARGET 회귀 7, desktop-chrome).
- **prod 마이그레이션 미적용** — dev DB만 적용. prod 적용은 supervisor 배포 게이트에서.
