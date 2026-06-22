---
ticket_id: T-20260622-foot-STAFF-ACCOUNT-CREATE-3
title: 풋센터 직원 계정 3개 생성·정합(이가연/김지윤=상담실장, 김지현=치료사)
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
db_change: true
db_change_note: |
  데이터 INSERT/state 보정만 — 스키마/CHECK 변경 없음(db_only, 비파괴).
  접지 결과: 3명 모두 auth 계정·user_profiles·staff 행 기존재(self-signup + 직전 세션 보정),
  전원 last_sign_in 존재(실제 로그인 실증).
  이번 세션 변경: 김지현(therapist) staff.active / user_profiles.active = false → true 보정(AC-2 활성).
  이가연·김지윤은 active=true 정합 → 무변경.
  role 매핑(접지): foot 로컬 실사용값 상담실장=consultant(8건)·치료사=therapist(20건),
  cross_crm_data_contract §2-3 일치.
build_ok: true
e2e_spec: none
e2e_spec_exempt_reason: db_only
qa_result: pass
qa_grade: Green
qa_fail_reason: null
bundle_hash: (db-only, bundle unchanged)
migration_file: none (data INSERT/UPDATE only, no schema change)
rollback_file: |
  UPDATE staff SET active=false WHERE user_id='3518b13d-86ee-44fb-bc29-8d2c3c6e0fbf';
  UPDATE user_profiles SET active=false WHERE id='3518b13d-86ee-44fb-bc29-8d2c3c6e0fbf';
created_at: 2026-06-22
reporter: 김주연 총괄(U0ATDB587PV)
---

# T-20260622-foot-STAFF-ACCOUNT-CREATE-3

풋센터 CRM 직원 계정 3개 생성·정합.

| 이름 | 역할 | 이메일 | role(접지 확정) | auth user_id |
|------|------|--------|-----------------|--------------|
| 이가연 | 상담실장 | dlrkdus10108@naver.com | consultant | 39fba137-6b01-465c-8686-7d51ef9a56e2 |
| 김지윤 | 상담실장 | faceofangel9999@gmail.com | consultant | a7e2e012-735c-4ecc-8f54-c7c5c545bddd |
| 김지현 | 치료사 | oing_woo@naver.com | therapist | 3518b13d-86ee-44fb-bc29-8d2c3c6e0fbf |

## AC 충족

- **AC-0 접지**: foot 로컬 실사용값 상담실장=consultant·치료사=therapist 확인(staff distinct). 계약 §2-3 일치. ✅
- **AC-1 auth 계정**: 3명 전원 존재·email_confirmed=true. 이메일 exact-match 검증(오타 0). ✅
- **AC-2 staff/user_profiles 행**: 이름·role·소속=풋센터(clinic 74967aea…)·활성 전원 충족. 김지현 active 보정 적용. ✅
- **AC-3 실제 로그인 가능**: 3명 전원 last_sign_in 존재 = 실제 로그인 성공 실증. ✅
- **AC-4 로그인 안내**: 3명 모두 이미 로그인 성공 상태(자격증명 전달·로그인 완료) → 임시비번 재설정/재발송 시 현 세션 혼란 유발하므로 불필요. 슬랙 평문 노출 없음. ✅
- **AC-5 목록 보고**: responder 경유 thread 1782094411.105909 보고. ✅

## 스크립트
- scripts/T-20260622-foot-STAFF-ACCOUNT-CREATE-3_diag.mjs (접지·진단, 읽기전용)
- scripts/T-20260622-foot-STAFF-ACCOUNT-CREATE-3_fix_kimjiyun.mjs (직전 세션 — 김지윤 email_confirm)
- scripts/T-20260622-foot-STAFF-ACCOUNT-CREATE-3_kjh_activate.mjs (김지현 active 보정, dry-run 게이트)
