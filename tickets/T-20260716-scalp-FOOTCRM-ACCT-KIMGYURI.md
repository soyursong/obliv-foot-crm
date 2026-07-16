---
id: T-20260716-scalp-FOOTCRM-ACCT-KIMGYURI
domain: foot
priority: P2
status: done
type: auth-ops
resolution: already-provisioned (계정 旣존 → 신규생성 금지, role/활성 점검 PASS, 로그인 旣성공)
deploy_ready: false
hotfix: false
code_changed: false
db_changed: false
db_change_scope: "N/A — write 0건. auth.users/user_profiles/staff 전량 READ-ONLY 재검증만. 스키마/enum/데이터 무변경 → MIG-GATE N/A · DA CONSULT 불요."
e2e_spec: N/A (인증-운영 조회, 코드/빌드/DB 무변경)
created: 2026-07-16
completed: 2026-07-16
author: dev-foot
reporter: planner (MSG-20260716-202818-mtcu) / 김규리 총괄 계정 요청
related: T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL (동일 auth-ops 패턴)
identity_resolution_standard: 준수 (전량 페이지네이션 exact match 50계정 + getUserById id↔email 재검증, ?email= 서버필터 미신뢰)
---

# T-20260716-scalp-FOOTCRM-ACCT-KIMGYURI

## 요청
김규리 총괄(`rwdqda@naver.com`) obliv-foot-crm 계정 생성. role=staff(최소권한 고정, 원장/실장 권한 금지).
WARN-1 폴백(두피 CRM 공통 평문 비번 부재) 확정 → 임시비번(crypto 랜덤) 발급 + 최초 로그인 재설정 경로.

## 판정 (한 줄)
**계정은 이미 존재(GoTrue `2ec0b57a-d81a-4739-ac13-f81254c056e1`) + 요청 스펙과 정확히 일치(role=staff·active·approved·clinic 정합) + 오늘 20:45 KST 로그인 이미 성공 → 신규생성 금지(duplicate). 추가 조치 불요.**

## 실재 재검증 (READ-ONLY, Identity Resolution 표준 준수)
- auth.users 50계정 전량 페이지네이션 스캔 → exact email match **1건**(`?email=` 서버필터 미신뢰).
- `getUserById(2ec0b57a…)` id↔email 재검증 ✅: email_matches=true, email_confirmed_at=`2026-07-16T11:44:39Z`(20:44 KST), banned/deleted=null, is_sso=false, identity email 1건(sub 일치).
- **last_sign_in_at = `2026-07-16T11:45:23Z`(20:45 KST)** → 계정 생성 직후 로그인 성공 실증 (현장 로그인 확인 已충족).
- 생성 시각(20:44 KST)은 본 MQ 발송(20:28 KST) 이후 → 요청 스펙대로 이미 프로비저닝 완료된 상태.

## role / 최소권한 점검 (PASS)
| 항목 | 값 | 판정 |
|---|---|---|
| user_profiles.role | `staff` | ✓ 최소권한 (원장/실장/admin/manager 아님) |
| user_profiles (email 중복) | 1건 (uid=2ec0b57a) | ✓ 중복 0 |
| active / approved | true / true | ✓ 활성 |
| clinic_id | `74967aea…` (jongno-foot) | ✓ 정합 |
| staff roster (user_id=2ec0b57a) | **없음** | ✓ 로그인 전용 계정, 배정풀 미오염 |
| auth user_metadata / app_metadata | role 상향 없음 (name·email_verified만) | ✓ |

- 참고: staff 로스터에 `김규리`(therapist, `3a0c6774`, user_id=`63c387c0`) 별도 1행 존재 = **동명이인 치료사**(다른 user_id, 총괄 계정과 미링크). 총괄 로그인 계정에는 무영향.

## 결론 / 후속
- **신규 생성 안 함**(duplicate ban, MQ 지침 #1 "이미 존재 시 중복생성 금지"). 임시비번 발급 불요 — 이미 로그인 성공.
- 코드·DB·빌드 무변경. deploy 불요.
- planner FOLLOWUP: 계정 旣존·로그인 旣성공 보고. relay 필요 시 "이미 접속 정상" 안내로 갈음.

## 산출물
- `scripts/T-20260716-scalp-FOOTCRM-ACCT-KIMGYURI_verify.mjs` (READ-ONLY 재검증, prod write 0)
