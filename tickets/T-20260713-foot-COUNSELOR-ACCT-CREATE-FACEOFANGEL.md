---
id: T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL
domain: foot
priority: P2
status: done
type: auth-ops
resolution: superseded-as-create (계정 旣존 → 신규생성 금지) + 상태정정 적용
deploy_ready: false
hotfix: false
code_changed: false
db_changed: true
db_change_scope: "user_profiles 1행 UPDATE (role coordinator→consultant, clinic_id NULL→74967aea). 기존 enum/값, 스키마/DDL/데이터모델 무변경 → migration 아티팩트 없음, MIG-GATE N/A, DA CONSULT 불요. snapshot+rollback 동봉."
e2e_spec: N/A (인증-운영 조치, 코드/빌드 무변경)
snapshot: rollback/T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL_before.json
rollback_sql: rollback/T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL_rollback.sql
created: 2026-07-13
completed: 2026-07-13
author: dev-foot
reporter: 김주연 총괄
related: T-20260713-foot-ACCOUNT-LOGIN-FAIL-FACEOFANGEL
identity_resolution_standard: 준수 (전량 페이지네이션 exact match + getUserById id↔email 재검증, ?email= 서버필터 미신뢰)
---

# T-20260713-foot-COUNSELOR-ACCT-CREATE-FACEOFANGEL

## 요청
상담실장(김지윤, `faceofangel9999@oblivseoul.kr`) 계정 신규 생성. reporter=김주연 총괄.
⚠ 동일 이메일 LOGIN-FAIL 진단 티켓(T-20260713-foot-ACCOUNT-LOGIN-FAIL-FACEOFANGEL)과 오버랩 → 단일 조사로 처리, 생성 전 auth.users 실재부터 확인.

## 판정 (한 줄)
**계정은 이미 존재(GoTrue `b36e74a3-…c05`, 로그인 정상) → 신규생성 금지(duplicate). 단, 도메인 마이그(gmail→oblivseoul.kr) 중 신규 계정이 role/clinic_id 오프로비저닝된 상태이상 → 상태정정으로 상담실장 요청 충족.**

## 실재 재검증 (READ-ONLY, Identity Resolution 표준 준수)
- auth.users 47계정 전량 페이지네이션 스캔 → exact email match **1건**(`?email=` 서버필터 미신뢰).
- `getUserById(b36e74a3)` id↔email 재검증 ✅: email confirmed(06:38), banned/deleted=null, is_sso=false, email identity 1건(sub 일치), auth meta.role=consultant, **last_sign_in 2026-07-13 10:10:54**(LOGIN-FAIL 비번복구 후 로그인 성공 실증).
- 동일인 2계정 병존 확인: gmail(`a7e2e012`, 6/9~) + oblivseoul.kr(`b36e74a3`, 오늘 02:53 생성).

## 상태이상 (마이그 오프로비저닝)
도메인 마이그 타임라인(오늘): 02:49 old gmail profile 비활성(active→false) → 02:53 신규 oblivseoul 계정+profile 생성(**role=coordinator·clinic_id=NULL 오설정**) → 09:06 staff row 신규 uid 재링크 → 10:00 비번리셋(LOGIN-FAIL) → 10:10 로그인 성공.

| | old gmail `a7e2e012` (마이그 소스) | new oblivseoul `b36e74a3` (수정 전) |
|---|---|---|
| role | consultant (상담실장 ✓) | **coordinator** ✗ |
| clinic_id | 74967aea (jongno-foot) | **NULL** ✗ (47계정 중 유일 이상치) |
| active | false (02:49 은퇴) | true |

- FE 권한 게이트는 `user_profiles.role`(=profile.role) 기준(ProtectedRoute 등) → coordinator면 상담실장으로 동작 불가.
- 링크된 staff(`c23d4491`).role = consultant + clinic_id=74967aea + active (마이그 소스와 동일).

## 상태정정 (apply, 근거 4중)
`user_profiles(b36e74a3)` → **role=consultant + clinic_id=74967aea**.
근거: ① 마이그 소스 old profile 값 ② 링크된 staff row 값 ③ 46/47 계정 clinic_id 채워짐(b36e74a3만 NULL) ④ 총괄 명시 요청=상담실장(contract §2-3 = `consultant`).
- change-class = 단일행 mutable UPDATE, 기존 enum/값(coordinator·consultant 공존, clinic 기존 값) → 스키마/enum 추가 0 → **MIG-GATE N/A · DA CONSULT 불요**.
- write 직전 uid↔email 재검증 guard + before 스냅샷 + rollback SQL 기록.
- **최종 정합**: user_profiles.role=consultant(상담실장 ✓) / staff.role=consultant ✓ / clinic_id 일치 / active·approved=true / 로그인 OK.

## 후속 (planner FOLLOWUP)
1. **old gmail 계정 폐기/병합**: `a7e2e012`(gmail, active=false) 잔존. 마이그 완료됐으니 최종 decommission(soft-delete/삭제)은 별도 결정 — 파괴적이라 본 티켓 범위 밖.
2. (LOGIN-FAIL 후속 승계) 감사로깅 OFF, 임시비번 최초 로그인 후 변경 안내.

## 산출물
- `scripts/…_verify.mjs` (READ-ONLY 재검증), `scripts/…_apply.mjs` (dry-run→APPLY 상태정정)
- `rollback/…_before.json` (스냅샷), `rollback/…_rollback.sql` (되돌리기 SQL)
