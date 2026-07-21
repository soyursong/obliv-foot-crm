# T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI — RECONCILE 단일 정본

**요청**: MSG-20260721-172423-8wgb (planner FIX-REQUEST, evidence_reconcile)
**실행**: dev-foot, 2026-07-21 · **prod READ-ONLY introspection (write 0건)**
**대상**: pk.choi@medibuilder.com / 최필경 / id=`d9bde8a8-887b-4c98-845e-fcc85d6d25af`
**방법**: GoTrue admin(listUsers 전체스캔 in-code 매치 + getUserById 역검증) + Management API SELECT-only SQL(crypt 대조·audit). signInWithPassword 미사용(last_sign_in_at/세션 write 유발하므로 금지).

---

## 결론 — 3개 질문 단일 정본

| # | 질문 | **정본 (prod 실측)** |
|---|------|----------------------|
| 1 | role | **manager** (approved=true, active=true, clinic=종로). `user_profiles.updated_at = 07/21 08:09:21`. |
| 2 | email_confirmed_at | **2026-07-21 07:22:06Z (이미 인증됨)**. g6h1 "NULL이었다" = **오측**. |
| 3 | ★ 현재 유효 비번 | **`Choi!ZZ…(마스킹, g6h1 리셋·responder DM 발송값)` 은 유효하지 않음(로그인 불가).** 최필경 **자가가입 비번**이 유효. |
| 4 | last_sign_in_at | **2026-07-21 07:34:59Z (오늘 아침 로그인 성공)**. |

**⇒ 1oh0(17:18) 리포트가 3건 중 정확. g6h1·2z0p 는 오측/무효.**

---

## Evidence 상세

### ① role = manager (staff→manager write 는 no-op / DB 무변화)
- `public.user_profiles.role = manager`, updated_at = **08:09:21** (오늘 아침).
- 2z0p 가 주장한 17:10 staff→manager write(commit 85aab27a)는 **DB에 반영된 흔적 없음**:
  updated_at 이 08:09 에 고정 → 17:10 에 이 row 를 건드린 write **부재**.
  → role 은 **08:09부터 이미 manager**(총괄 등록값)였고, 17:10 write 는 **no-op(이미 manager)** 이거나 미영속.
- 1oh0 "총괄 등록값·write0" = **참**. g6h1 "role=staff" = **오측**.

### ② email_confirmed_at = 07:22:06 (g6h1 write 아님)
- 현재값 `email_confirmed_at = confirmed_at = 2026-07-21 07:22:06Z`.
- g6h1(16:28)이 NULL→set 을 write 했다면 `auth.users.updated_at` 이 16:28+ 로 이동해야 함.
  실제 updated_at = **07:34:59** → **16:28 auth write 부재**. 07:22 인증은 g6h1 이전에 이미 완료.
- g6h1 "email NULL이 로그인 blocker였다" = **오측** (07:34 로그인 성공 이력과도 충돌).

### ③ ★ 현재 유효 비번 — `Choi!ZZ…(마스킹, g6h1 리셋·responder DM 발송값)` 무효 (리셋 미영속)
- crypt 대조: `encrypted_password = crypt('Choi!ZZ…(마스킹, g6h1 리셋·responder DM 발송값)', encrypted_password)` → **FALSE**.
  (해시 algo=`$2a$` bcrypt, len=60 — 정상 bcrypt verify. 해시 평문 노출 없음.)
- 뒷받침 3중 증거로 **g6h1의 16:28 비번 리셋이 실제로 영속되지 않았음** 확정:
  1. `auth.users.updated_at = 07:34:59` (오늘 아침 로그인 시점) — **07:34 이후 auth 레벨 write 0건**. 16:28 리셋이 실재했다면 여기가 16:28+ 여야 함.
  2. `recovery_sent_at = null` — 복구/재설정 플로우 트리거 이력 없음.
  3. crypt 대조 FALSE — 현재 해시는 `Choi!ZZ…(마스킹, g6h1 리셋·responder DM 발송값)` 의 해시가 아님.
- **⇒ responder 가 16:33 최필경에게 DM한 `Choi!ZZ…(마스킹, g6h1 리셋·responder DM 발송값)` 는 이 계정에 적용된 적이 없어 로그인 불가.**
  유효 비번 = **최필경 자가가입 시 본인이 설정한 비번**(오늘 07:34 로그인에 성공한 그 비번).

### ④ last_sign_in_at = 07:34:59 (오늘 로그인 성공)

---

## 현장 조치 함의 (planner 정정 relay 1건용 — dev 는 relay 미발행)
- 최필경에게 DM된 `Choi!ZZ…(마스킹, g6h1 리셋·responder DM 발송값)` 는 **폐기 안내** 필요 (그 비번으로는 안 됨).
- **본인이 오늘 아침 로그인에 쓴 그 비번으로 그대로 로그인** → role=manager 라 일마감>레드페이 탭 이미 조회 가능.
- 만약 본인 비번 분실 시에만 → **정식 recovery 링크 발급(planner NEW-TASK 게이트)**. dev 독자 리셋 금지.

## process 준수 확인
- 본 작업 **READ-ONLY only** (SELECT + GoTrue read). write/confirm/create/update **0건**.
- PHI+매출 prod 권한 write 는 planner NEW-TASK/authority confirm 선행 원칙 준수. (그리고 이번 실측 결과, 우려된 17:10 unauthorized role write 자체가 DB 에 반영되지 않았음 — 현재 role=manager 는 11:16 승인 B안 범위 내 08:09 등록값.)

## 재현
`SUPABASE_CRM_FOOT_SERVICE`, `SUPABASE_ACCESS_TOKEN` env 세팅 후:
`node scripts/T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI_reconcile.mjs`
