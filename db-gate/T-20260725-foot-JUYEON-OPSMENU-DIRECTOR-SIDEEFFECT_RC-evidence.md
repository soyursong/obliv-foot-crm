# T-20260725-foot-JUYEON-OPSMENU-DIRECTOR-SIDEEFFECT — RC 진단 (READ-ONLY, mutation 0)

실행: 2026-07-25T01:28 UTC · prod rxlomoozakkjesdqjtvd · SELECT only (DB write/role 변경 없음)
스크립트: `scripts/T-20260725-foot-JUYEON-OPSMENU-DIRECTOR-SIDEEFFECT_diag.mjs`

## 판정: planner 가설 100% CONFIRMED

김주연 총괄 통계/매출집계/계정관리 접근불가 = JUYEON-DOCWRITE-1WK-TEMPACCESS pg_cron이
7/25 00:00 KST에 role을 admin→director로 전환 → single-role이라 has_ops_authority 없는
director가 되어 3개 ops 메뉴의 `requireOpsAuthority` 라우트 가드에서 /admin으로 튕김.

## 근거

### [1] role 실측 = 'director' (id↔email 삼중 재검증, Cross-CRM Auth Identity 표준)
- 1a. id=ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12 기준: **role=director**, approved=true, updated_at=**2026-07-24T15:00:00.178884+00**
- 1b. auth.getUserById(id) → email=**juyeon@medibuilder.com** → id↔email **MATCH ✓**
- 1c. email 역조회 → id=ee67fc6b… 수렴 ✓, role=director
- ⇒ `?email=` 서버필터 단독 아닌 id 권위조회 + auth 대조 + email 역수렴, 3경로 일치.

### [2] has_ops_authority 컬럼 prod **부재**
- `select has_ops_authority from user_profiles` → **ERROR: column user_profiles.has_ops_authority does not exist**
- 마이그 2건 모두 `.DDL_DIFF_HOLD`(미적용): `20260619220000_..._additive.sql.DDL_DIFF_HOLD`, `20260620020500_munjieun_has_ops_authority_set.sql.DDL_DIFF_HOLD`
- ROLE-MATRIX-3TIER-RBAC in_progress → prod 미적용 상태 그대로. director가 ops 권한을 보유할 수단이 없음.

### [3] cron 발동 시각 = grant_at 경계와 정확히 일치
- `foot_juyeon_tempgrant_tick`의 grant tick이 `updated_at=now()` 세팅.
- 실측 updated_at = **2026-07-24T15:00:00.178884+00** = 마이그 정의 `v_grant_at='2026-07-24 15:00:00+00'`(=2026-07-25 00:00 KST) **경계 후 178ms**.
- ⇒ */15 폴 cron이 00:00:00 KST에 발동, `UPDATE ... SET role='director' WHERE role='admin'` 실행 확정.
- (cron.job_run_details 직접 조회는 prod에 임의 SQL RPC 부재로 불가 — updated_at 경계일치가 권위 근거.)

## 코드 게이트 (grep 근거)

3메뉴 라우트 가드 (src/App.tsx):
| 메뉴 | route | RoleGuard |
|------|-------|-----------|
| 통계 | `stats` (L221) | `roles={['admin','manager','director','tm']} requireOpsAuthority` |
| 매출집계 | `sales` (L249) | `roles={['admin','manager','director']} requireOpsAuthority` |
| 계정관리 | `accounts` (L227) | `roles={['admin','director']} requireOpsAuthority` |

가드 로직 (src/components/ProtectedRoute.tsx L49):
```
if (requireOpsAuthority && profile.role === 'director' && !hasOpsAuthority(profile))
  return <Navigate to="/admin" replace />;
```
hasOpsAuthority (src/lib/permissions.ts L318):
```
if (subject.has_ops_authority === true) return true;
return subject.role === 'admin' || subject.role === 'manager';
```
- role='director' + has_ops_authority 컬럼 부재(→ undefined) ⇒ hasOpsAuthority=**false** ⇒ 3메뉴 전부 /admin 리다이렉트.
- role='admin'였을 때: hasOpsAuthority=true + 가드는 role==='director'만 트리거 ⇒ admin은 가드 자체 우회 ⇒ 정상 접근이었음.

## 시사점 (A/B/C 결정 참고 — 본 태스크는 진단만, fix 미실행)
- tempgrant 마이그는 원래 role이 'admin'임을 이미 인지·문서화(divergence 명시)했으나, **director 부여가 admin-implied ops-menu 접근을 박탈하는 부작용은 미예견** — has_ops_authority 미적재 상태라 director는 ops 권한 보유 수단이 없음.
- 자기치유 예정: 8/1 00:00 KST revert tick이 director→admin 원복 → ops 메뉴 자동 복구. 단 1주 window 동안 총괄 lockout.
- 후보 방향(planner/원장 결정 대기): (A) tempgrant 조기 revert(admin 원복, 서식점검 director 권한 회수) / (B) exempt_from_restrictions 활용 — 단 이건 ops 메뉴 route 가드(requireOpsAuthority)를 우회하지 않음(canAccess 경유만 honor, route 가드는 별도) → 무효 / (C) has_ops_authority 컬럼 landing + 김주연 flag=true set(ROLE-MATRIX 적용 선행, DDL_DIFF_HOLD 해제 = §S2.4 게이트 대상).
