# T-20260705-ops-GOTRUE-ADMIN-EMAIL-FILTER-BAN — obliv-foot-crm 감사 결과

**판정: N/A (해당 안티패턴 부재). 코드/스키마/데이터 변경 없음.**
날짜: 2026-07-05 · 담당: dev-foot

## 사고 요약 (참조)
scalp 비번리셋 중 GoTrue `/auth/v1/admin/users?email=` 필터가 무시되고 임의 유저 반환 →
실 상담사 계정 비번 1회 오염. 5 CRM 동일 스택 → foot repo 재발 여부 grep 청소.

## grep 결과 (obliv-foot-crm 전량)

### 1) GoTrue admin `?email=` REST 필터 사용처
- `admin/users?email=` / `auth/v1/admin` / `listUsers({ email })` / `getUserByEmail`
  → **0건** (`Grep admin/users|listUsers({...email}|getUserByEmail|auth/v1/admin` no matches)

### 2) admin 유저 조회 실제 사용처 (모두 안전 패턴)
| 위치 | 조회 방식 | 안전성 |
|------|-----------|--------|
| `supabase/functions/user-lookup-by-email/index.ts` | **`user_profiles` 테이블** `.ilike('email', escapeLike)` (PostgREST, 실 SQL 필터) — GoTrue admin 엔드포인트 아님 | 안전. 서버측 `?email=` 필터 신뢰 없음 |
| `src/pages/Accounts.tsx` (submitReset) | `resetUser.id`(=`user_profiles` row) → RPC `admin_reset_user_password(target_user_id)` | 안전. id는 DB에서 email과 바인딩된 권위값. 이메일 필터 미경유 |
| `scripts/*_grant/precheck.mjs` (JUYEON 등) | `listUsers({page,perPage:1000})` **전량 페이지네이션 + 앱레벨 정확매칭** `(u.email||'').toLowerCase() === EMAIL` | 안전. 정확히 권고 하드닝 패턴 |
| `scripts/evidence_handover_ui_coordinator.mjs` | `deleteUser(userId)` — 같은 스크립트에서 생성한 임시계정 id(바인딩) | 안전. 이메일 필터 미경유 |
| `getUserById(id)` 사용처 | id 직접 | 안전 |

## 결론
GoTrue admin `?email=` 필터를 신뢰해 destructive admin 호출(비번리셋/삭제/권한변경) 대상을
확정하는 취약 경로가 **foot repo에 존재하지 않음**.
모든 admin 유저 확정은 (a) 앱 소유 `user_profiles` 테이블 id 바인딩 또는
(b) 전량 페이지네이션 + 앱레벨 email 정확매칭으로 이미 하드닝됨.
→ ADDITIVE 하드닝 대상 없음. **N/A 종결.**

공용 헬퍼 채택은 data-architect CONSULT 후 후속 수렴 (본 티켓 스코프 밖).
