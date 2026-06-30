# T-20260630-foot-STAFFCRUD-CODY-PERM — RC & 동반 landing 계획

요청: 김주연 총괄(U0ATDB587PV) / #project-doai-crm-풋확장 / 2026-06-30 16:50 KST
요지: 사이드바 > 직원·공간 > 직원 탭의 근무자 **추가/삭제**를 `coordinator` 에게도 ADDITIVE 허용.
출처: T-20260620-foot-STAFF-PERM-UNLOCK-6MENU line172 `[DEFERRED] §④` 보류분의 실티켓.

## RC (dev-foot 2026-06-30) — 분기 판정 = (b) RLS-backed
- **surface = `staff` 로스터 테이블** (StaffPage>StaffTab, `supabase.from('staff').insert` / `.update({active})`).
  - ⚠️ `user_profiles`(로그인 계정)가 **아님**. `staff.role` enum = director/consultant/coordinator/therapist/technician
    (admin/manager 부재). **staff 로스터 생성 ≠ 계정 생성 = 권한상승 경로 아님.**
  - 6MENU `[DEFERRED] §④` 의 user_profiles(계정관리·권한상승)는 본건 **미포함**(admin-only 불변).
- **FE gate**: `StaffTab.isAdmin = admin||manager||director` 가 행 edit/delete 게이팅. (add 버튼은 게이트 부재였으나
  write-RLS 가 막아 coordinator 는 이미 lock-out-in-disguise 상태였음.)
- **DB gate**: `staff_admin_all` (20260426000000_rls_role_separation.sql:209)
  = `FOR ALL USING/CHECK is_admin_or_manager()` = role IN (admin/manager/director). **coordinator 거부.**
  → FE 만 풀면 lock-out-in-disguise → **동반 RLS 필수**.

## 변경 (FE↔DB 동반)
- **FE** (`fe_and_spec.patch`):
  - `permissions.ts`: `STAFF_CRUD_ROLES = [admin,manager,director,coordinator]` + `canManageStaff()` +
    `assignableStaffRolesFor()`(coordinator 는 'director' 옵션 제외 = guard1).
  - `Staff.tsx`: add 버튼·행 edit/delete 를 `canManageStaff` 단일 게이트로 일원화. coordinator 의 원장(director)
    행 수정/비활성 차단. Create/Edit 다이얼로그 role 옵션을 `assignableStaffRolesFor` 로 제한.
  - spec: `tests/e2e/T-20260630-foot-STAFFCRUD-CODY-PERM.spec.ts` (4 시나리오 + 방어, 8 PASS).
- **DB** (`20260630220000_staff_coordinator_crud_rls_additive.sql.DA_CONSULT_HOLD`):
  - ADDITIVE 2종(coordinator INSERT/UPDATE, `role<>'director'`, clinic-scoped). 하드 DELETE 미부여(최소권한).
  - 기존 `staff_admin_all` 무변경(무회귀).

## 가드
1. **권한상승 차단**: coordinator 는 'director' 행 생성/수정/비활성 불가 — FE(assignableStaffRolesFor) + RLS(role<>director) **이중**. staff 로스터는 로그인 계정 아님 → admin/manager 승격 경로 자체 없음.
2. **무회귀**: admin/manager/director = `staff_admin_all` 그대로. consultant/therapist 등 본 요청 외 역할에 add/delete 신설 0.
3. **permissions.ts 동시수정 주의**: ROLE-MATRIX-3TIER-RBAC(in_progress)와 머지충돌 대비 — 신규 export 격리 블록으로 추가(기존 함수 무수정).

## 게이트 / 진행
- [x] RC 확정(case b)
- [ ] **data-architect CONSULT (1차 게이트)** — ADDITIVE staff write 정책. 권한상승/cross-product 위험 평가 요청.
- [ ] CONSULT-REPLY GO
- [ ] supervisor DDL-diff
- [ ] suffix(.DA_CONSULT_HOLD) 제거 → dev-foot 직접 apply + FE patch 적용 → **FE↔DB 동반 landing** → build → deploy-ready 마킹
- ⚠️ FE 단독 merge 금지(lock-out-in-disguise). 본건 FE/spec 는 main 미반영(이 패키지에 보존), 동반 landing 시 적용.
