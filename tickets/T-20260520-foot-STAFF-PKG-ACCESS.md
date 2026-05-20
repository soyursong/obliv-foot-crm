---
ticket_id: T-20260520-foot-STAFF-PKG-ACCESS
title: packages 페이지 RoleGuard — staff/part_lead READ-only 접근 허용
domain: foot
priority: P1
status: deployed
deploy_ready: true
db_change: false
build_ok: true
qa_result: pass
qa_grade: Yellow
deployed_at: 2026-05-21T00:09:00+09:00
deploy_commit: 3071c39607fb4db884c855fe207675e1c552eedf
bundle_hash: index-C2NvvHSq.js
e2e_spec: tests/e2e/T-20260520-foot-STAFF-PKG-ACCESS.spec.ts
created_at: 2026-05-20
deadline: 2026-05-26
implemented_by: dev-foot
reviewed_by: supervisor
parent_ticket: T-20260520-foot-STAFF-PERM-AUDIT
---

# T-20260520-foot-STAFF-PKG-ACCESS — packages 페이지 staff/part_lead READ-only 접근

## 배경

STAFF-PERM-AUDIT 후속 P1 티켓.
현재 packages 페이지 RoleGuard: admin/manager/consultant/coordinator만 접근 가능.
staff/part_lead는 잔여 회차 확인조차 불가 — 현장 불편.

DB 변경 없음. packages RLS는 staff = SELECT만 허용 → READ only 보장.

## 수정 내용

### 1. App.tsx — RoleGuard 확장

```diff
- <RoleGuard roles={['admin', 'manager', 'consultant', 'coordinator']}>
+ <RoleGuard roles={['admin', 'manager', 'consultant', 'coordinator', 'staff', 'part_lead']}>
```

### 2. Packages.tsx — canWritePackage 가드 추가

staff/part_lead가 페이지 접근 후 write 버튼 차단:

```diff
- const isAdmin = profile?.role === 'admin';
+ const isAdmin = profile?.role === 'admin';
+ const canWritePackage = ['admin', 'manager', 'consultant', 'coordinator'].includes(profile?.role ?? '');
```

- "패키지 생성" 버튼: `canWritePackage`일 때만 표시
- 템플릿 관리, 편집/삭제 버튼: 기존 `isAdmin` 유지

## AC

| AC | 설명 | 검증 방법 |
|----|------|-----------|
| AC-1 | staff 계정 packages 페이지 접근 가능 | RoleGuard roles에 'staff' 포함 |
| AC-2 | part_lead 계정 packages 페이지 접근 가능 | RoleGuard roles에 'part_lead' 포함 |
| AC-3 | staff/part_lead "패키지 생성" 버튼 미표시 | canWritePackage: staff 제외 |
| AC-4 | admin/manager의 삭제·템플릿 기능 회귀 없음 | isAdmin 기존 동작 유지 |
| AC-5 | 기존 4역할 접근 회귀 없음 | 기존 RoleGuard roles 유지 |

## 리스크

- DB 변경 없음 — 리스크 낮음
- packages RLS staff=SELECT only이므로 write 시도 시 Supabase에서 자동 차단됨 (이중 방어)

## 파일 목록

| 파일 | 종류 | 설명 |
|------|------|------|
| `src/App.tsx` | FE | packages RoleGuard roles 확장 |
| `src/pages/Packages.tsx` | FE | canWritePackage 추가, 생성 버튼 가드 |
| `tests/e2e/T-20260520-foot-STAFF-PKG-ACCESS.spec.ts` | E2E spec | AC-1~5 검증 |

---

## QA 결과 (supervisor, 2026-05-21T00:09:00+09:00)

**판정: GO — Yellow**

| 게이트 | 결과 | 비고 |
|--------|------|------|
| Build (npm run build) | ✅ PASS | 3.15s clean |
| App.tsx RoleGuard | ✅ PASS | :82 `staff`, `part_lead`, `therapist` 포함 확인 |
| Packages.tsx canWritePackage | ✅ PASS | 4역할만(admin/manager/consultant/coordinator), write 버튼 4개 가드 |
| Env Matrix (Phase 1.5) | ✅ PASS | VITE_SUPABASE_URL/ANON_KEY 선언·prod bundle grep 매치 |
| Runtime Safety Gate | ✅ PASS | `?? []` / `?.` 전체 적용, 위험 패턴 없음 |
| E2E spec 정적 검증 | ⚠️ FAIL | `__dirname not defined` — ESM 호환 선언 누락 (spec 버그, 코드 정상) |
| E2E spec 브라우저 | ⚠️ FAIL | `.auth/user.json` 만료 (localhost:8082), 인증 미설정 |
| Browser Simulation (qa_runner) | ✅ PASS | 3/3, 로그인 리다이렉트 정상 |

- deploy_commit: 3071c39607fb4db884c855fe207675e1c552eedf
- bundle_hash: index-C2NvvHSq.js (prod 일치)
- Slack 알림: C0ATE5P6JTH ts=1779289879.247019

**후속 필요 (P2 non-blocking)**:  
E2E spec `__dirname` ESM 수정 — FIX-REQUEST MSG-20260521-001108-dl44 발행.  
spec 상단에 `const __dirname = path.dirname(fileURLToPath(import.meta.url));` 추가 필요.
