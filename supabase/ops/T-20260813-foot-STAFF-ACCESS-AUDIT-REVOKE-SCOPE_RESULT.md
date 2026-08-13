# T-20260813-foot-STAFF-ACCESS-AUDIT-REVOKE-SCOPE — 접근권한 감사 (READ-ONLY)

leg: dev-foot (cross-CRM 오프보딩 감사 sweep 6-leg 중 1)
target_system: obliv-foot-crm (Supabase rxlomoozakkjesdqjtvd)
requester: 이정환 (U05L4115SQ3) / coordinator: planner
subject: 이정원 수석(피부) 연관 계정·권한 잔여 확인
확인시각(KST): 2026-08-13 19:09:47 (+0900)
mutation: NONE (조회-only, SELECT/admin-list only, no UPDATE/DELETE/DDL)

## 감사 기준 (요청 원문)
사용자명·표시명·역할명에 `이정원`, `수석`, `피부` 가 연결된 계정·권한 + 활성여부·역할·범위·세션.

## 감사 방법 (전수 조회)
1. public.staff (name/role) — 전수 96행 ilike + eyeball
   query: /rest/v1/staff?or=(name.ilike.*이정원*,name.ilike.*수석*,name.ilike.*피부*)
2. public.user_profiles (email/name/role/active/approved) — 전수 70행 ilike + eyeball
   query: /rest/v1/user_profiles?or=(name.ilike.*이정원*,name.ilike.*수석*,name.ilike.*피부*,
          email.ilike.*ijeongwon*,email.ilike.*jeongwon*,email.ilike.*susu*)
3. auth.users (GoTrue admin list, email + user_metadata) — 전수 70 계정 패턴 스캔
   pattern: 이정원/수석/피부/jeongwon/ijeongwon/susu/derm/skin

## 결과 — NEGATIVE (0건)
- staff 96행 中 이정원/수석/피부 연관: **0건**
- user_profiles 70행 中 연관: **0건**
- auth.users 70 계정 中 email/metadata 패턴 매치: **0건**
- 정합성: auth.users(70) == user_profiles(70) → orphan 계정 0 (프로필 없는 auth 계정 부재)
- role enum 에 '수석' 역할 부재 (roles = admin/manager/consultant/coordinator/therapist/technician/tm/staff/director)

## 근접 동명이인 주의 (혼동 방지 명시)
- `이정인` (Lee Jeong-IN, therapist) — user_profiles id e1317caa-ac37-4e98-916e-63693b59c11e,
  staff id eed1d06d-9a55-44cf-96c9-e251d6febb34. **요청 대상 '이정원'(Jeong-WON) 아님** (정인≠정원).
  풋센터 활성 치료사이며 피부/수석 무관 → 회수 대상 아님. (오탐 방지 위해 명시)

## 세션 / 재로그인
- 매치 계정 0건 → 조회·회수 대상 세션 없음. 활성 세션/재로그인 검토 대상 없음(N/A).

## 회수 대상 식별
- **회수 대상 계정: 없음.** obliv-foot-crm 에 이정원 수석(피부) 연관 접근권한 부재.
- 별도 파괴적 회수(revocation) 액션 불요 (본 CRM 한정).

## PHI/보안 준수
- 환자정보·비밀번호·토큰 미포함(reporter 조건 준수). 계정 식별자·역할·활성상태만 기재.
