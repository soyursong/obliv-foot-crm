# T-20260727-foot-CHOI-PK-LOGIN-BLOCKED — 진단 evidence

- 대상: 최필경 / pk.choi@medibuilder.com / slack U05L6HE7QF6
- auth uid: d9bde8a8-887b-4c98-845e-fcc85d6d25af (foot prod rxlomoozakkjesdqjtvd) <!-- UUID(비밀 아님) gitleaks:allow -->
- 진단 일시(UTC): 2026-07-27
- db_change: **없음** (READ-ONLY 진단 + 비파괴 복구링크 발급)

## 표준 준수
- Cross-CRM Auth Identity Resolution: `?email=` 서버필터 단독 신뢰 금지.
  → `listUsers` 페이지네이션 전수 스캔(55 users) + 클라이언트 email 매칭(1 hit) + `getUserById` id↔email 재검증(일치 true). 발급 직전 재검증 재수행.
- GoTrue admin email filter ban 표준 준수.

## AC#1 — auth.users 상태 스냅샷 (BEFORE, 조치 후 동일 — 비파괴)
| 항목 | 값 | 판정 |
|------|----|----|
| banned_until | `<omitempty ABSENT>` (raw GoTrue GET) | 차단 아님 |
| deleted_at | `<omitempty ABSENT>` | 삭제 아님 |
| email_confirmed_at | 2026-07-21T07:22:06.216083Z | 확인됨 |
| last_sign_in_at | 2026-07-21T09:04:43.133811Z | 7/21 마지막 성공 로그인 |
| created_at | 2026-07-21T02:11:30.933861Z | |
| **updated_at** | **2026-07-27T00:34:27.201841Z** | **오늘(7/27 09:34 KST) auth row 갱신 — 자격증명(비밀번호) 변경 정황** |
| app_metadata.provider | email | |

> GoTrue는 `banned_until`/`deleted_at`을 omitempty로 직렬화 → 응답에서 필드 부재 = null = 미차단/미삭제. supabase-js 매핑 객체의 undefined 재확인 위해 raw admin REST(`/auth/v1/admin/users/{id}`)로 교차검증함.

## AC#2 — user_profiles(uid) 대조 (7/21값과 일치, 변화 없음)
```
id:        d9bde8a8-887b-4c98-845e-fcc85d6d25af
email:     pk.choi@medibuilder.com
name:      최필경
role:      manager          ← 7/21값 유지 (정상)
approved:  true             ← 7/21값 유지 (정상)
active:    true             ← 7/21값 유지 (정상)
clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8 (종로 풋센터)
updated_at:2026-07-21T08:09:21.800857+00:00  ← 7/21 이후 무변경
```
by-id / by-email 조회 동일 1행 (uid 미연결 유령 프로필 없음).

## AC#3 — 판정: **분기 (b) 정상**
- auth 인가상태(차단/삭제/미확인) **이상 없음**, user_profiles(manager/approved/active) **모두 정상·7/21값 유지**.
- 되돌릴 인가상태 오염 **없음** → 단일-row 비파괴 복구 대상 **없음**(파괴적 조치 불요).
- 유일 변화축 = auth `updated_at`이 오늘 갱신됨 = **자격증명(비밀번호) 레벨 변화**로 로그인 불가 정황. (앱 로그인은 approved/active 통과, 차단은 credential 단계)
- ⇒ **비밀번호 재설정 링크 발급** 경로.

## AC#4 — 조치: 비밀번호 재설정 링크 발급 (비파괴, 평문비번 미생성)
- `admin.generateLink({type:'recovery', redirectTo: https://obliv-foot-crm.pages.dev/login})` — 이메일 미발송, 1회용 복구 링크만 생성.
- 발급 직전 id↔email 재검증 통과 후 생성.
- 앱 구조: `detectSessionInUrl` 기본 true(implicit flow) → 링크 클릭 시 세션 자동수립·자동로그인 → 계정메뉴 > 비밀번호 변경(ChangePasswordDialog)에서 새 비번 설정 가능.
- **action_link 원문은 1회용 secret → 본 evidence/신호/커밋에 미기재.** responder 경유 최필경 본인에게만 비공개 전달.

## 스크립트
- `scripts/T-20260727-foot-CHOI-PK-LOGIN-BLOCKED_diag.mjs` (READ-ONLY 진단)
- `scripts/T-20260727-foot-CHOI-PK-LOGIN-BLOCKED_gen_recovery_link.mjs` (링크 발급, env-only key)
