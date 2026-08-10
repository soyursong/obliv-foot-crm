# T-20260810-dopamine-UBASE-FOOTBODY-CRM-2ACCT-PROVISION (foot leg) — 증적

- 확정: 이정환 경영BO(U05L4115SQ3) **A안(일반직원권한)** @2026-08-10
- artifact-class: **ops_only** (계정 발급 데이터 write, DDL 0 / 신규 컬럼·테이블·enum 0 → DA CONSULT 비대상)
- canonical_repo: obliv-foot-crm
- 실행 스크립트: `scripts/provision_ubase_2acct_20260810.mjs` (idempotent, DRY_RUN default true)
- 실행 시각: 2026-08-11 01:14 (Asia/Seoul)

## AC-1 — 2계정 일반직원권한 발급 + 로그인 가능 VERIFY

| email | auth uid | role | approved | active | clinic | email_confirmed | login-verify |
|-------|----------|------|----------|--------|--------|-----------------|--------------|
| ubase.team01@nfavo.com | 191b42ac-ebc8-4dbc-88ce-b620a73bde33 | staff | true | true | jongno-foot (74967aea-…) | true | **OK** |
| ubase.team02@nfavo.com | 023b3625-616a-4487-9089-f589adad2636 | staff | true | true | jongno-foot (74967aea-…) | true | **OK** |

- 로그인 게이트(src/pages/Login.tsx / ProtectedRoute.tsx): `email_confirm=true` + `user_profiles.approved=true` + `role` → 3조건 모두 충족.
- login-verify = `signInWithPassword` 실제 세션 발급 성공(각 계정) 후 signOut. 실제 로그인 가능 실증.

### 권한 모델 결정 — 일반직원 = user_profiles.role='staff'
- `'staff'`(라벨 '스태프') = user_profiles.role(UserRole)의 일반직원 권한 (src/lib/status.ts USER_ROLE_LABEL).
- **staff 테이블 INSERT 안 함**: `'staff'`는 staff.role(StaffRole: director/consultant/coordinator/therapist/technician) enum이 아님 → 로스터·담당자 드롭다운 오염 방지. 앱 게이트는 user_profiles만 참조하므로 로그인·일반직원 접근에 staff row 불필요(파일럿 상담사 = 평가용 일반 접근).

## AC-3(분담) — 초기 비밀번호 안전경로

- 임시 PW는 **코드/로그/MQ/티켓 어디에도 평문 미노출**. crypto 랜덤 생성.
- 로컬 시크릿 파일에만 기록: `_artifacts/UBASE-2ACCT-credentials.SECURE.local.txt` (chmod 600, `.gitignore` 등재 → git 미추적).
- **안전경로 별도 전달 대상: jh.lee@medibuilder.com** — 실제 전달은 (분담) → planner/ops 안전채널 조율. dev-foot는 발급·verify·시크릿 보관까지. Slack/MQ/티켓 relay 본문에 PW 미포함.

## db_change
- 없음. 스키마 변경 0(DDL 0), 신규 컬럼/테이블/enum 0. 기존 auth.users INSERT + user_profiles UPDATE(기존 role 값 재사용). DA 자문 게이트 비대상.

## idempotent / 재실행
- auth.users 이메일 존재 시 생성 스킵 + userId 재사용(PW 미변경). 재실행 안전.
