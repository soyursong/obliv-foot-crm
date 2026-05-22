---
id: T-20260522-foot-PENCHART-FORM-AUDIT
domain: foot
priority: P2
deadline: 2026-05-28
status: deploy-ready
deploy_ready: true
db_changed: true
e2e_spec: EXEMPT (db_only)
e2e_spec_exempt_reason: DB 데이터 수정 전용 — UI 렌더 코드 변경 없음
migration_file: supabase/migrations/20260522060000_form_templates_audit_fix.sql
risk: GO (0/5)
parent: T-20260522-foot-PENCHART-ERASER-CLARITY
approved_by: 김주연 총괄 (사전 승인)
completed_at: 2026-05-22
---

# T-20260522-foot-PENCHART-FORM-AUDIT

## 개요

form_templates 테이블 foot-service 양식 전수 검토 (AC-6 FOLLOWUP, 건 2).

## 검토 결과 요약

### foot-service 양식 현황 (검토 전)

| sort_order | form_key | format | active | 이슈 |
|---|---|---|---|---|
| 10 | diag_opinion | html | ✓ | - |
| 15 | rx_standard | html | ✓ | - |
| 20 | diagnosis | html | ✓ | - |
| 30 | bill_detail | html | ✓ | - |
| 35 | bill_receipt | html | ✓ | - |
| **40** | treat_confirm | html | ✓ | ⚠️ sort_order 중복 |
| **40** | visit_confirm | html | ✓ | ⚠️ sort_order 중복 |
| 85 | payment_cert | html | ✓ | - |
| **90** | pen_chart | png | ✓ | ⚠️ sort_order 중복 |
| **90** | referral_letter | html | ✓ | ⚠️ sort_order 중복 |
| 91 | health_questionnaire_general | png | ✓ | - |
| 91 | personal_checklist_general | pdf_overlay | ❌ inactive | ℹ️ 의도적 soft-delete |
| 92 | personal_checklist_senior | pdf_overlay | ❌ inactive | ℹ️ 의도적 soft-delete |
| 92 | health_questionnaire_senior | png | ✓ | - |
| 95 | medical_record_request | html | ✓ | - |
| 100 | diag_opinion_v2 | html | ✓ | - |
| ❌ **없음** | **refund_consent** | - | - | ⚠️ **DB 레코드 누락** |

### 발견 이슈 3건

| # | 심각도 | 유형 | 조치 |
|---|---|---|---|
| WARN-1 | ⚠️ | sort_order 40 중복 (treat_confirm + visit_confirm) | visit_confirm → 45 |
| WARN-2 | ⚠️ | sort_order 90 중복 (pen_chart + referral_letter) | referral_letter → 96 |
| CRIT-1 | 🔴 | refund_consent.png 존재 / DB 레코드 없음 | INSERT sort_order=93 |

### 비이슈 (정상 확인)

- template_path 비어있는 html 포맷: 정상 (HTML/CSS 렌더링, 이미지 불필요)
- template_path 있는 png/pdf_overlay 포맷: 모두 public/forms/ 파일 존재 확인
- personal_checklist_* inactive: 2026-05-21 현장 요청으로 의도적 soft-delete (정상)
- sort_order 91/92 active+inactive 공존: UI active 필터 통과, 영향 없음

### 적용된 수정 (DB 직접 실행 완료)

```sql
-- WARN-1: visit_confirm 45로 보정
UPDATE form_templates SET sort_order=45
WHERE clinic_id='74967aea...' AND form_key='visit_confirm' AND sort_order=40;

-- WARN-2: referral_letter 96으로 보정
UPDATE form_templates SET sort_order=96
WHERE clinic_id='74967aea...' AND form_key='referral_letter' AND sort_order=90;

-- CRIT-1: refund_consent 신규 등록
INSERT INTO form_templates (...) VALUES ('refund_consent', sort_order=93, active=true, ...);
```

### foot-service 최종 상태 (수정 후)

| sort | form_key | format | active |
|---|---|---|---|
| 10 | diag_opinion | html | ✓ |
| 15 | rx_standard | html | ✓ |
| 20 | diagnosis | html | ✓ |
| 30 | bill_detail | html | ✓ |
| 35 | bill_receipt | html | ✓ |
| 40 | treat_confirm | html | ✓ |
| 45 | visit_confirm | html | ✓ |
| 85 | payment_cert | html | ✓ |
| 90 | pen_chart | png | ✓ |
| 91 | health_questionnaire_general | png | ✓ |
| 92 | health_questionnaire_senior | png | ✓ |
| **93** | **refund_consent** | **png** | **✓ 신규** |
| 95 | medical_record_request | html | ✓ |
| 96 | referral_letter | html | ✓ |
| 100 | diag_opinion_v2 | html | ✓ |

active 양식: 15개 | inactive: 2개 (personal_checklist_general/senior, 의도적)

## 실행 내용

- migration: `20260522060000_form_templates_audit_fix.sql` (+ .down.sql)
- DB 변경: 3건 직접 실행 (PATCH×2 + POST×1)
- 코드 변경: 없음 (db_only)
- E2E spec: EXEMPT (db_only)
