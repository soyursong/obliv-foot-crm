---
id: T-20260521-foot-ROLE-BULK-SYNC
domain: foot
priority: P1
status: deployed
title: 18개 계정 user_profiles.role 일괄 UPDATE (staff 잔존 해소)
created: 2026-05-21
assignee: dev-foot
deploy-ready: true
build-ok: true
db-change: true
regression-risk: low
e2e-spec: none
e2e_spec_exempt_reason: db_only
deploy_note: "DB-only. 코드 변경 없음. 정혜인(jhy314631@naver.com) 1건 staff→admin UPDATE 완료. 나머지 17건은 이미 이전에 올바르게 업데이트되어 있었음."
deployed_at: "2026-05-21T19:30:00+09:00"
---

# T-20260521-foot-ROLE-BULK-SYNC

## 배경

RBAC-MENU-EXPAND(e412f94) 배포 후 수기 역할 변경한 18계정의 `user_profiles.role`이 `staff`로 잔존.  
총괄 직접 지시로 일괄 UPDATE 요청. deadline: 5/22.

## Dry-Run 결과

```
=== DRY-RUN: 현재 user_profiles 상태 (실행 전) ===
총 조회: 18 건

[staff       ] 정혜인   jhy314631@naver.com  approved=true active=false  ← 유일 잔존
[consultant  ] 엄경은   a1208789@naver.com
[consultant  ] 정연주   joo4442@naver.com
[consultant  ] 김수린   ksl5777@naver.com
[consultant  ] 송지현   marissong@naver.com
[coordinator ] 김민경   alsrud102938@naver.com
[coordinator ] 박민석   jungs5322@naver.com
[therapist   ] 강혜인   kanghyein1477@naver.com
[therapist   ] 김규리   angelgrgr12@gmail.com
[therapist   ] 백민영   baekmy1004@naver.com
[therapist   ] 임별    byulim12@gmail.com
[therapist   ] 조선미   gkdlt609@gmail.com
[therapist   ] 서은정   bonny_31@naver.com
[therapist   ] 김유리   0195958397@hanmail.net
[therapist   ] 윤시하   miso3295@naver.com
[therapist   ] 최민지   minji9336@naver.com
[therapist   ] 최다혜   chxmrrmqxn@naver.com
[therapist   ] 김성우   say093092@naver.com

역할 분포: {"staff":1, "consultant":4, "coordinator":2, "therapist":11}
```

**핵심 발견**: 17건은 이미 올바르게 업데이트되어 있었음. 잔존은 정혜인(staff) 1건만.

## CHECK constraint 확인

파일: `supabase/migrations/20260513000040_contract_align_roles.sql`

```sql
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN (
    'admin','manager','director','consultant',
    'coordinator','therapist','technician','tm','staff'
  ));
```

- `admin` ✅ 허용값 (consultant_lead ❌ 없음 — Cross-CRM §2-3 표준 준수)

## auth.users.raw_user_meta_data 동기화 여부

- 조회 결과: `raw_user_meta_data = null` (모든 18계정 동일)
- FE auth.tsx가 role을 `user_profiles`에서만 로딩 (`src/lib/auth.tsx:28`)
- **동기화 불필요** — user_profiles UPDATE만으로 충분

## UPDATE 실행

### 실행 SQL

```sql
-- T-20260521-foot-ROLE-BULK-SYNC
-- 조건부 안전장치: role = 'staff'인 경우만 UPDATE (이미 다른 역할이면 미변경)
UPDATE public.user_profiles
SET role = 'admin'
WHERE email = 'jhy314631@naver.com'
  AND role = 'staff';
-- 영향 행: 1건 (정혜인, admin 1조건부)
```

### 실행 결과

| 이메일 | 이름 | 변경 전 | 변경 후 | 영향 |
|--------|------|---------|---------|------|
| jhy314631@naver.com | 정혜인 | staff | **admin** | ✅ 변경 |

영향 행 수: **1건**

## 최종 검증 (UPDATE 후)

```
역할 분포: {"admin":1, "consultant":4, "coordinator":2, "therapist":11}
staff 잔존: 0건 ✅
```

| 역할 | 인원 | 계획 | 일치 |
|------|------|------|------|
| admin | 1 | 1 (조건부) | ✅ |
| consultant | 4 | 4 | ✅ |
| coordinator | 2 | 2 | ✅ |
| therapist | 11 | 11 | ✅ |

## 롤백 SQL

```sql
-- T-20260521-foot-ROLE-BULK-SYNC 롤백
-- 정혜인 admin → staff 원복
UPDATE public.user_profiles
SET role = 'staff'
WHERE email = 'jhy314631@naver.com'
  AND role = 'admin';
-- 실행 후 확인:
-- SELECT id, email, name, role, active FROM user_profiles WHERE email = 'jhy314631@naver.com';
```

## 주의사항

- 정혜인(jhy314631@naver.com)은 현재 `active=false` 상태. role 변경만 수행했으며 active 는 변경하지 않음.
  - active=false 이면 Accounts 페이지 '비활성' 탭에 표시됨. 활성화 필요 시 총괄 별도 지시 필요.
- admin 권한이므로 로그인 시 approved 체크 우회 (ProtectedRoute.tsx:17 `role !== 'admin'` 예외 처리됨)
- staff.role과 user_profiles.role은 독립 관리됨. admin/manager/tm은 staff 행 없음 (admin_register_user RPC 정책)

## AC 검증

| AC | 설명 | 상태 |
|----|------|------|
| AC-1 | 18개 email dry-run (현재 role 확인) | ✅ 17건 이미 정상, 1건(정혜인) staff 잔존 확인 |
| AC-2 | CHECK constraint 표준 enum 일치 확인 | ✅ admin ∈ 허용값 |
| AC-3 | UPDATE 실행 (user_profiles + auth.users 동기화 판단) | ✅ user_profiles 1건 UPDATE, auth.users 동기화 불필요 |
| AC-4 | 변경 행 수 확인 | ✅ 1건 (정혜인 staff→admin) |
| AC-5 | 롤백 SQL | ✅ 본문 첨부 |
| AC-6 | 대표 1계정 로그인 RBAC 메뉴 수동 확인 | ⏳ 총괄 직접 검증 필요 (정혜인 jhy314631@naver.com로 로그인 → 계정관리 메뉴 접근 확인) |
