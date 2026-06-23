---
id: T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND
domain: foot
status: deploy-ready
deploy-ready: true
db_change: true
build_ok: true
spec_added: tests/e2e/T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND.spec.ts
summary: "원장정보>병원정보 폼에 병원 이메일 칸 추가 + 처방전 의료기관 E-mail 자동 연동(clinics.email ADDITIVE 신설)"
implementation_commit: b7898044
priority: P2
created_at: 2026-06-23
deployed_at: ""
da_consult: GO (CONSULT-REPLY MSG-20260623-134112-a9fu · ADDITIVE 확정 · clinics.email TEXT 신규)
db_migration: supabase/migrations/20260623160000_clinics_email.sql (dev-foot 직접 적용 완료 · verify PASS text/YES/null)
db_rollback: supabase/migrations/20260623160000_clinics_email.rollback.sql (ALTER TABLE clinics DROP COLUMN IF EXISTS email)
db_gate_evidence: db-gate/T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND_evidence.md
---

# T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND

## 요청 (김주연 총괄)

사이드바 공간·배정 > 원장정보 > 병원정보 입력 폼에 **"병원 이메일"** 칸 추가 +
처방전 서류 이메일 주소 칸에 그 값 자동 연동.

- 병원(기관) 이메일 — 환자 이메일(customers.customer_email, EMAIL-BINDING-FIX 계열)과 **별개**.
- 처방전 미입력 시 빈칸 동작 유지(회귀 금지).

## 구현

| 레이어 | 변경 |
|--------|------|
| DB | `clinics.email TEXT` nullable 신설 (ADDITIVE·멱등·가역, DA GO). dev-foot 직접 적용 완료. |
| autoBindContext | `clinic.email` → `clinic_email` 바인딩 토큰. `loadAutoBindContext` clinics select에 email 추가. |
| htmlFormTemplates | 처방전(rx_standard) 의료기관 블록 E-mail 주소 빈칸 → `{{clinic_email}}`. |
| ClinicSettings | 섹션 A(병원 기본정보)에 '병원 이메일' Input + state/load/save + 안내문구. admin/manager만 편집(canEdit). |

## AC (E2E 9 케이스 PASS)

- **AC-1**: clinic.email 존재 → clinic_email 바인딩.
- **AC-2**: null/undefined/clinic null → 공란('') fallback (회귀 방지, 빈칸 유지).
- **AC-3**: 처방전 의료기관 E-mail 주소 칸에 {{clinic_email}} 실제 렌더 + 미입력 시 빈칸.
- **AC-4**: clinic_email ↔ patient_email 독립 (서로 침범 없음).

## 데이터 정책 게이트

- §S2.4 CONSULT → data-architect GO (ADDITIVE 확정). 대표 게이트 면제, supervisor DDL-diff + 롤백SQL 게이트만.
- 클릭 시나리오: 공간·배정 > 원장정보 > 병원정보 폼에서 '병원 이메일' 입력 → 저장 → 해당 클리닉 처방전 출력 시 의료기관 E-mail 주소 칸에 자동 표기.
