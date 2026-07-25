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

---

## [ADDENDUM 2026-07-25T01:42 UTC] MSG-20260725-102056-x5ts 재진단 — role 재실측 + D안 선결(소견서 템플릿 편집 UI role-gating)

리포터 정정: "직무 바꾸지 말고 소견서 '템플릿' 검토·수정 권한만" → **D안**(admin 원복 + 템플릿 편집권 별도 제공) 유력. 아래 3항 read-only 실측(mutation 0).

### [1·2 재확인] role 재실측 = 여전히 'director', has_ops_authority 여전히 부재
- 재실행 2026-07-25T01:42:39Z: id=ee67fc6b… → **role=director**, approved=true, updated_at=2026-07-24T15:00:00.178884+00 (불변).
- id↔email 삼중 재검증(Cross-CRM Auth Identity 표준): auth.getUserById→juyeon@medibuilder.com **MATCH ✓**, email 역조회 id 수렴 ✓.
- `select has_ops_authority` → **column does not exist** (prod 부재 불변, DDL_DIFF_HOLD 2건 미적용 그대로).
- ⇒ 초기 판정(director lockout RC) 100% 유지. baseline=admin(MSG-yrek) 대비 현재=director 확정.

### [2 재확인] 3메뉴 게이트 근거 (src/App.tsx 실측)
| 메뉴 | route(L) | RoleGuard | requireOpsAuthority |
|------|----------|-----------|---------------------|
| 계정관리 | accounts (L227) | `['admin','director']` | **YES** → director 차단(admin/superadmin류만 통과) |
| 통계 | stats (L221) | `['admin','manager','director','tm']` | **YES** → director는 has_ops_authority 필요 |
| 매출집계 | sales (L249) | `['admin','manager','director']` | **YES** → director는 has_ops_authority 필요 |
- 3메뉴 공통 `requireOpsAuthority` 가드 → director + has_ops_authority(undefined) ⇒ hasOpsAuthority=false ⇒ 전부 /admin 리다이렉트. admin이면 route 가드가 role==='director'만 트리거하므로 통과. **planner 지시 2항 코드 확인 완료**.

### [3 ★핵심] 소견서 '템플릿(양식)' 편집 UI = physician 전용 아님 — admin/manager 접근 가능한 **설정성(ClinicManagement)** 화면
두 surface가 명확히 분리됨:

**(a) 소견서 템플릿(양식) 편집 = admin-settings — D안이 겨냥하는 화면**
- 컴포넌트: `src/components/admin/OpinionPhrasesTab.tsx`(소견서 좌측 버튼/자동삽입 멘트 = 소견서 양식 구성) + `src/components/admin/DocumentTemplatesTab.tsx`(서류 템플릿 CRUD — 진단서/소견서 양식).
- 마운트: `/admin/clinic-management`(ClinicManagement 페이지, '서비스관리' 영역) — `src/pages/ClinicManagement.tsx` L230/L234.
- **Route 가드(src/App.tsx L236)**: `RoleGuard roles={['admin','manager','director','consultant','coordinator','therapist']}` — **requireOpsAuthority 없음** ⇒ admin·director 모두 진입.
- **편집(CRUD) 게이트**: `canEditClinicMgmt`(permissions.ts L338) = admin OR director(stopgap) OR has_ops_authority=true ⇒ **admin/manager/director 편집 가능**.
- **Write RLS**: `form_templates_admin_all` = `is_admin_or_manager()` = **role IN ('admin','manager','director')**(20260426000000 L61) ⇒ admin write 통과.
- ⇒ **physician/director 전용 임상 gating이 아니라, admin/manager도 접근·수정 가능한 설정성 화면**.

**(b) 소견서 임상 발행(per-patient issue/write) = 진료의 전용 — (a)와 구분됨**
- 컴포넌트: `src/components/doctor/OpinionDocTab.tsx` — publish_opinion_doc RPC(환자별 소견서 발행).
- 발행 게이트: `is_doctor_role()` = **role IN ('director','doctor')**(20260616160000 L153, 의료법 제17조 발급주체 한정).
- ⇒ admin/manager 불가. **이건 '템플릿 편집'이 아니라 '임상 발행'** — 리포터 문구 "템플릿(양식) 검토·수정"과는 별개 축.

### [3 결론 — D안 실행 함의]
- 리포터가 원하는 "소견서 **템플릿(양식)** 검토·수정"은 (a) = **admin 자격으로 이미 접근·수정 가능**(route admin 포함 + canEditClinicMgmt admin=true + RLS is_admin_or_manager admin 포함).
- ⇒ **D안: 김주연을 admin으로 원복하면 3 ops 메뉴 복구 + 소견서 템플릿 편집권이 동시 충족.** director tempgrant도, 별도 신규 권한 부여도 불필요(no-DDL). 즉 tempgrant→director는 목적(템플릿 편집) 달성엔 애초에 불필요했고 3메뉴 lockout 부작용만 유발.
- ⚠ 단 예외: 만약 리포터 실제 의도가 (b) 임상 소견서 **발행**(is_doctor_role)까지라면 admin으로는 불가 → director 유지가 필요하고, 그 경우엔 3메뉴 복구를 위해 has_ops_authority 컬럼 landing(C안 요소, §S2.4 DDL 게이트)이 병행돼야 함. 문구상 "템플릿(양식)"은 (a)를 가리키므로 D안 성립이 유력하나, **최종 A/B/C/D 결정 시 (a)설정편집 vs (b)임상발행 중 어느 것을 원하는지 원장/리포터 확인 권장**.
- 본 태스크는 진단만 — mutation·배포 0건. fix(admin 원복 등)는 결정 게이트(문지은 대표원장 A/B/C/D) 통과 후 별도 티켓.
