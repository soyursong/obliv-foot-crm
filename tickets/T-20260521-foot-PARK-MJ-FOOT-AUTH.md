---
ticket_id: T-20260521-foot-PARK-MJ-FOOT-AUTH
title: 박민지 TM팀장 풋CRM 계정 등록
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
e2e_spec_exempt_reason: db_only
db_changed: false
code_changed: false
migration_file: none
deploy_note: auth 계정 기존재(a36bc2cc-1fb1-46c5-83cf-84210a02ac93) + user_profiles admin 권한 확인. 임시 비밀번호 설정. responder INFO 발행 완료.
completed_at: 2026-05-21T14:03:00+09:00
---

## 작업 내용

### 상태
- auth.users: 기존재 (id=a36bc2cc-1fb1-46c5-83cf-84210a02ac93, 오늘 04:59 생성)
- user_profiles: admin role, approved=true, active=true, clinic_id=74967aea(jongno-foot)
- 임시 비밀번호: FootCRM@2026! (Admin API PUT으로 설정)
- responder MQ INFO 발행: MSG-20260521-140307-55fv

### 검증
- user_profiles.role = 'admin' ✅
- user_profiles.approved = true ✅  
- user_profiles.active = true ✅
- user_profiles.clinic_id = 74967aea-a60b-4da3-a0e7-9c997a930bc8 (jongno-foot) ✅
- 임시 비밀번호 설정 완료 ✅
- responder 알림 발행 ✅

### e2e_spec_exempt_reason
db_only — 코드 변경 없음, DB 계정/권한 작업만.
