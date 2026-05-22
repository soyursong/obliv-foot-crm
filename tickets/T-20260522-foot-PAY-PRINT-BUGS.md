---
ticket_id: T-20260522-foot-PAY-PRINT-BUGS
title: 풋센터 수납/결제/서류출력 버그 4건 수정
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
deploy_ready_at: "2026-05-22T18:42:00+09:00"
db_change: true
db_change_note: |
  supabase/migrations/20260522100000_staff_role_perm_gap.sql — prod 직접 적용 완료
  - payments_coord_insert / payments_therap_insert (Bug B: 수납저장 INSERT RLS)
  - package_sessions_coord_insert / package_sessions_coord_update (Bug C: 선수금차감)
  - check_in_services_coord_insert / check_in_services_therap_insert (Bug D: 수납목록 INSERT)
  - check_in_services_coord_delete / check_in_services_therap_delete (Bug D: delete-then-insert 패턴)
  - form_templates required_role UPDATE — 임상 행정 서류 7종에 consultant|coordinator|therapist 추가 (Bug A)
  - form_templates required_role UPDATE — ins_claim_form: consultant+coordinator (therapist 제외)
migration_file: supabase/migrations/20260522100000_staff_role_perm_gap.sql
rollback_file: supabase/migrations/20260522100000_staff_role_perm_gap.down.sql
build_ok: true
e2e_spec: tests/e2e/T-20260522-foot-PAY-PRINT-BUGS.spec.ts
risk_verdict: GO_WARN
risk_reason: "수납/결제 핵심 경로 4건. RLS 추가 + FE draft 보존 수정. admin/manager 회귀 없음(기존 정책 유지)."
created_at: 2026-05-22
deadline: 2026-05-26
implemented_by: dev-foot
ordered_by: 김주연 총괄
depends_on: T-20260522-foot-STAFF-REEXPAND
related_tickets:
  - T-20260520-foot-RBAC-MENU-EXPAND
  - T-20260521-foot-STAFF-RLS-ROLLBACK
  - T-20260521-foot-STAFF-PKG-ROLLBACK
  - T-20260522-foot-STAFF-ROLE-PERM-GAP
---

# 풋센터 수납/결제/서류출력 버그 4건

## 구현 요약

### Bug A: 서류출력 인쇄 안됨 (form_templates required_role)
- **원인**: form_templates.required_role에 consultant|coordinator|therapist 미포함
- **수정**: 임상 행정 서류 7종(bill_detail, bill_receipt, treat_confirm*, visit_confirm, med_record*, medical_record_request) required_role에 3역할 추가
- **검증**: DocumentPrintPanel canAccess() 로직 — spec 14/14 통과

### Bug B: 수납처리 저장실패 (payments INSERT RLS)
- **원인**: payments 테이블에 coordinator/therapist INSERT RLS 정책 없음
- **수정**: payments_coord_insert (payment_type='payment' 한정) + payments_therap_insert 추가
- **검증**: pg_policies 조회로 정책 존재 확인

### Bug C: 선수금차감 안됨 (package_sessions RLS)
- **원인**: package_sessions 테이블에 coordinator INSERT/UPDATE RLS 정책 없음
- **수정**: package_sessions_coord_insert + package_sessions_coord_update 추가
- **검증**: pg_policies 조회로 정책 존재 확인

### Bug D: 수납목록 저장 후 사라짐 (check_in_services RLS + FE draft 보존)
- **원인 1 (DB)**: check_in_services 테이블에 coordinator/therapist INSERT+DELETE RLS 정책 없음
  - DELETE가 필요한 이유: saveCheckInServices()가 delete-then-insert 패턴 사용
- **원인 2 (FE)**: PaymentMiniWindow.tsx handleClose — INSERT 에러 시 draft 삭제하여 목록 소실
- **수정 (DB)**: check_in_services 4개 정책 추가 (coord/therap × insert/delete)
- **수정 (FE)**: handleClose에서 INSERT 에러 체크 추가 — 실패 시 localStorage draft 보존
- **검증**: spec + PaymentMiniWindow.tsx diff 확인

## 파일 변경

### DB (migration)
- `supabase/migrations/20260522100000_staff_role_perm_gap.sql` — prod 적용 완료

### FE
- `src/components/PaymentMiniWindow.tsx` — handleClose INSERT 에러 시 draft 보존

### E2E
- `tests/e2e/T-20260522-foot-PAY-PRINT-BUGS.spec.ts` — 14/14 통과

## 수용 기준 (AC) 검증

- **AC-1** ✅ Bug A: form_templates required_role에 consultant|coordinator|therapist 포함 (7종 서류)
- **AC-2** ✅ Bug B: payments coordinator/therapist INSERT RLS 정책 존재 (payment_type='payment' 한정)
- **AC-3** ✅ Bug C: package_sessions coordinator INSERT/UPDATE RLS 정책 존재
- **AC-4** ✅ Bug D: check_in_services coordinator/therapist INSERT+DELETE RLS + FE draft 보존 수정
- **AC-5** ✅ admin/manager 기존 정책 유지 (DROP IF EXISTS 후 동일 범위 CREATE — 회귀 없음)
- **AC-6** ✅ STAFF-REEXPAND 독립 배포 가능 (migration 분리)

## 업데이트 로그

- 2026-05-22 13:33 — 티켓 생성(MSG-20260522-132049-wpj0). 버그 4건. 현장 확인 대기.
- 2026-05-22 18:42 — 구현 완료. DB migration prod 적용. FE fix. E2E 14/14. deploy-ready.
