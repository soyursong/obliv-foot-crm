---
id: T-20260713-foot-ACCOUNT-LOGIN-FAIL-FACEOFANGEL
domain: foot
priority: P2
status: done
type: auth-ops
deploy_ready: false
hotfix: false
code_changed: false
db_changed: true
db_change_scope: "auth.users 1행 (password reset). 스키마/DDL/데이터모델 무변경 → migration 아티팩트 없음, MIG-GATE N/A. snapshot+rollback 동봉."
e2e_spec: N/A (인증-운영 조치, 코드/빌드 무변경)
snapshot: rollback/T-20260713-foot-ACCOUNT-LOGIN-FAIL-FACEOFANGEL_before.json
created: 2026-07-13
completed: 2026-07-13
author: dev-foot
reporter: 김주연 총괄
sop_ref: T-20260526-body-STAFF-PW-RECOVERY
---

# T-20260713-foot-ACCOUNT-LOGIN-FAIL-FACEOFANGEL

## RC (한 줄)
**계정(`faceofangel9999@oblivseoul.kr`, 김지윤)은 GoTrue·프로필·staff 전 계층 구조 정상 — 로그인 실패는 자격증명(비밀번호) 불일치. GoTrue가 `invalid_credentials` 반환.** (계정 결함·배포회귀·다계정 공통 아님)

## 근거 (READ-ONLY 진단, prod write 0)
- **auth.users** (id `b36e74a3-…c05`): `email_confirmed_at` 있음(06:38), `banned_until`/`deleted_at` = null, `is_sso_user`=false, `has_password`=true. → 인증차단 플래그 **0**.
- **auth.identities**: email provider 1건 정상(id_email = `…@oblivseoul.kr`, sub 일치). `listUsers`가 identities를 빈배열로 반환하는 알려진 quirk → `getUserById`로 재검증(=1건). **Auth Identity Resolution 표준 준수**: `?email=` 서버필터 미신뢰, 전량 페이지네이션 후 exact match + id↔email 재검증 ✅.
- **런타임 확인**: `POST /token?grant_type=password` (오답 비번) → `400 invalid_credentials` (≠ `email_not_confirmed`/`user_banned`). = GoTrue가 로그인 가능 계정으로 취급, 오직 비밀번호만 게이트.
- **FE 게이트** (`src/pages/Login.tsx`): 실패경로 2개뿐 — (a) authError 원문 노출(= "Invalid login credentials"), (b) `!approved && role!=admin` → "관리자 승인 대기". 본 계정 `approved=true` → (b) 배제. 스샷 에러화면 = (a).
- **user_profiles**: role=coordinator, active=true, approved=true. **staff**: consultant, active=true, user_id 정상 링크.
- **시점("갑자기")**: `auth.users.updated_at` = **2026-07-13 10:00:24** (직전 성공 로그인 07:03 이후). `recovery_sent_at`/`email_change`/`reauthentication_sent_at`/pending token 전부 empty + `has_password`=true → **관리자측 비밀번호 재설정 성격**. ⚠ `auth.audit_log_entries` = 0건(24h) → 감사로깅 비활성 → 10:00 행위주체 audit 특정 불가.

## 회귀 대조
- **T-20260630-foot-STAFF-AUTH-LINK-BACKFILL**: dryrun 후 **apply 보류(auto 0건)** — prod write 없었음. 게다가 staff.user_id 링크만 다루며 auth 경로 무관. 본 계정 staff 링크는 정상. → **부수영향 없음**.
- 본 계정 staff.updated_at 09:06 = 별개 최근 갱신(로그인 경로 무관).

## 복구 (auth-ops, SOP = T-20260526-body-STAFF-PW-RECOVERY)
- recovery email 경로는 동일 조직(oblivseoul)에서 Site URL=localhost 리디렉트 broken 선례 → 임시 비밀번호 직접 설정 경로 채택.
- `admin.updateUserById(id, {password})` → **로그인 검증 `200 + access_token 발급` ✅** → 프로필 게이트 `approved=true/active=true` → `/admin` 진입 OK(권한화면 정상).
- ⚠ 임시 비밀번호 평문은 **git 미기재** — 현장(김주연 총괄) 전달은 responder MQ 경유. **최초 로그인 후 즉시 변경** 안내 동봉.
- **snapshot**: `rollback/…_before.json` (상태 시각만, 비번 해시 미포함). **rollback**: 본인 최초 로그인 후 자가 변경 / 또는 재-재설정(계정영향 0).

## 후속 (planner FOLLOWUP)
1. **다계정 하이진**: 동일인 김지윤이 `…@gmail.com`(6/9~, healthy) + `…@oblivseoul.kr`(오늘 02:53 생성, 마이그 대상) 2계정 병존. 도메인 마이그 정리(gmail 폐기/병합) 검토.
2. **감사로깅 OFF**: foot prod `auth.audit_log_entries` 0건 → 인증사고 시 행위주체 추적 불가. 활성화 검토.
3. **role 불일치**: user_profiles.role=`coordinator` vs staff/auth meta.role=`consultant`. SSOT(user_profiles) 기준 정합화 검토.
