# T-20260721-foot-PAYVIEWER-ACCOUNT-CHOI — 결과 (verify+activate)

**정정된 task**: MSG-20260721-113300 (INFO) — nuph step1 '계정 생성' → '기존 계정 활성화(confirm)'
**db_change**: false (실제 write 0건 — 아래 3.결과 참조)
**실행**: dev-foot, 2026-07-21 (READ-ONLY 인벤토리만)

## 1. 존재/식별 확인 (Cross-CRM Auth Identity Resolution 표준 준수)
- 방법: `admin.listUsers` 전체 페이지네이션 → in-code exact email 매치 (`?email=` 서버필터 미신뢰).
- target: `pk.choi@medibuilder.com` → **1건 정확 매치**.
- id↔email 재검증: `getUserById(d9bde8a8-887b-4c98-845e-fcc85d6d25af).email == pk.choi@medibuilder.com` → ✅ 일치.

## 2. auth 상태 (스냅샷)
| field | value |
|-------|-------|
| id | d9bde8a8-887b-4c98-845e-fcc85d6d25af |
| email | pk.choi@medibuilder.com |
| name | 최필경 |
| created_at | 2026-07-21T02:11:30Z |
| **email_confirmed_at** | **2026-07-21T07:22:06Z (이미 인증됨)** |
| **last_sign_in_at** | **2026-07-21T07:34:59Z (이미 로그인 성공)** |
| banned_until | null |
| provider | email |

## 3. 결과 — 활성화(confirm) 불필요 (no-op)
계정이 이미 (a) email_confirmed_at 세팅, (b) user_profiles.approved=true / active=true,
(c) 오늘 07:34 로그인 성공 이력까지 있음 → **이미 완전 활성 상태**.
→ email confirm write / fresh create **미실행** (불필요). DB 변경 0건.

## 4. 권한 확인 (WARN — 변동 없음)
- user_profiles.role = **manager**, approved=true, active=true, clinic_id=74967aea…(종로).
- 최필경 원 의도 = 일마감>레드페이 탭 **조회전용(read-only)**.
- 총괄(김주연, foot 데이터오너) 등록 = **manager** (over-privilege: edit + 매출/통계/계정 화면 노출).
- 총괄 지시 = "설정된 권한 확인 후 이상 없으면 그대로 진행" → over-privilege = authority 수용 범위(기존 WARN). 추가 게이트 불요.
- ⚠ **임시부여 성격 / 회수 가능**: manager ≠ read-only. ROLE-MATRIX-3TIER-RBAC(in_progress) 완료 시 정식 read-only(A안) 승격 권장.

## 5. relay (planner → responder → 현장)
- 로그인 URL: https://obliv-foot-crm.pages.dev/login
- email: pk.choi@medibuilder.com
- 접속 방법: **이미 활성 + 오늘 로그인 성공** → 신규 비번 발급/재설정 불필요. (분실 시에만 재설정 링크 별도 요청)
- 자격증명 노출 최소화: 공개 스레드 대신 최필경님(U05L6HE7QF6) DM 권장.
