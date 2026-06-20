# T-20260620-foot-JUYEON-DOCTORDASH-FULL-ACCESS — RC 판정 + 검증 (CODE-0 / NO-DDL)

- 일시: 2026-06-20
- 작업: dev-foot
- 입력: planner NEW-TASK MSG-20260620-150439-qr2v (P1)
- 결론: **db_change=NO-DDL, code=0.** juyeon(role=admin)은 진료 대시보드(의사영역)에 이미 전권 접근 가능. 접근 게이트는 FE role-gate(서버 RLS가 의사영역 read를 clinical-role로 강제하지 않음). PHI/RRN 카브아웃 불변(held).

## 1. RC 판정 — 접근 게이트 = FE role-gate (ticket RC 질의 응답)

| 게이트 | 위치 | admin 포함? | 종류 |
|--------|------|-------------|------|
| 진료 대시보드 라우트 | `App.tsx:231` RoleGuard `['admin','manager','director','therapist','technician','part_lead','consultant','coordinator']` | ✓ | FE |
| 진료 대시보드 nav 가시화 | `AdminLayout.tsx:103` roles `['admin','manager','director','consultant','coordinator','therapist']` | ✓ | FE |
| DoctorTools 내부 sub-gate | `pages/DoctorTools.tsx` — role/profile/isAdmin 게이트 **없음**(grep 0건) | n/a | 전체 공개 |

- **서버 RLS로 의사영역 read를 clinical-role(director/doctor)로 강제하는 경로 없음.** 진료 대시보드 4탭은 라우트 통과 후 전체 공개.
- ∴ **RC = FE role-gate**. ticket 분기 중 "FE role-gate면 NO-DDL(flag/계정 권한설정)" 경로 확정. ADDITIVE 정책조정·DA CONSULT·DDL-diff 불요.

## 2. live prod 상태 검증 (Supabase rxlomoozakkjesdqjtvd · user_profiles, service role)

```
id=ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12  email=juyeon@medibuilder.com  name=김주연
role=admin  access_tier=admin  active=true  approved=true  clinic_id=74967aea(jongno-foot)
updated_at=2026-06-20T06:28:46Z  (incident 후 restore stuck)
```

- **[self-read RLS 시뮬]** juyeon 본인 토큰(RLS 적용) → `user_profiles` self-read = **OK role=admin**. ∴ 브라우저 세션에서 profile 정상 로드 → 메뉴 정상 렌더(진료 대시보드 포함). profile=null 차단 가설 기각.
- AC1 충족: admin role-flag 기반(특정 user_id 하드코딩 0). canAccess(PERM_MATRIX SSOT) + FE role-gate 전부 admin 통과.

## 3. AC2 — PHI/RRN 카브아웃 불변 (전권 개방에 RRN 미포함)

- `permissions.ts §77-78`: PHI audit·RRN 가드·승인 게이트·clinic 스코프·의사/진료 publish 는 admin escape **우회 X**(canAccess 비경유 별 게이트). AC-6 자동 안전.
- RRN decrypt DB RPC: held migration 2건 **미적용** 유지 →
  - `20260618190000_rrn_decrypt_staff_read_restore.sql.PHI_GATE_HOLD`
  - `20260620120100_rrn_decrypt_a2_role_restore.sql.PHI_GATE_HOLD`
- **본 작업에서 RRN 관련 코드/DDL 0 변경** → 대표 승인 게이트(PHI_GATE_HOLD) 그대로. AC2 충족.

## 4. 별건 held flag 인지 (본 티켓 비대상)

- `has_ops_authority` 컬럼: prod **부재**(DDL_DIFF_HOLD). 본 access 에 불요(admin role 이 이미 달성).
- `exempt_from_restrictions` 컬럼: prod **부재**(SUPERADMIN-EXEMPT 미적용, DA GO·held). "grant 아님 = 제거 방지만"이라 doctor dashboard grant 와 무관.
- → 두 durable flag 는 본 티켓에서 추가하지 않음(별건 in-flight, 중복 dispatch 금지).

## 5. §11 진료대시보드 컨펌 게이트 충족

- 본 작업 = '권한 개방 검증', **진료대시보드/진료관리 코드 변경 0**. standing_gate(문지은 대표원장 U0ALGAAAJAV 컨펌 필수 = code 수정 시) 충족(code-0). 향후 두 화면 로직/UI 변경은 별도 컨펌.

## 6. PERM-STILL-BLOCKED-REVERIFY 종결 근거 + 잔여 가설

- juyeon은 진료 대시보드에서 **차단되지 않음**(role=admin, self-read OK, 전 게이트 PASS).
- 만약 현장에서 여전히 차단 보고 시 잔여 원인 = **incident window 잔존 세션**: juyeon이 grant 사고로 staff/approved=false 강등되었던 구간(→ 06:28 restore)의 브라우저 캐시 프로필. **재로그인 시 해소**(코드/DDL 아님).
- 진단 아티팩트 주의: `_precheck.mjs`가 부재 컬럼 `has_ops_authority`를 select → 에러로 data=null → "user_profiles 없음" 거짓표기. 실제는 `_diag.mjs`(select *) 기준 row 존재·role=admin.

## 7. 회귀 / race 점검 (AC1 단서)

- ROLE-MATRIX Phase1 / MUNJIEUN-CLINICMGMT-LOCKOUT 동일 코드경로 race: **코드 변경 0 → 회귀 위험 0**. canEditClinicMgmt / AdminLayout / RoleGuard 미변경.
- 타 계정·role 영향 0(데이터·코드 모두 무변경).
