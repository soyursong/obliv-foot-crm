# T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM — AC-6 portion 검증 (code-0)

- 일시: 2026-06-20
- 작업: dev-foot
- 입력: planner PUSH MSG-20260620-163708-83o2 (문지은 대표원장 U0ALGAAAJAV 명시 재확인 / 김주연 총괄 요구)
- 결론: **코드 변경 0건.** juyeon(admin)이 진료대시보드 + 서비스관리>진료관리 두 surface의 보기/수정 게이트를 admin escape로 전부 통과. AC-6 충족.

## 1. live prod role 확인 (Supabase rxlomoozakkjesdqjtvd · user_profiles)

| email | name | role |
|-------|------|------|
| juyeon@medibuilder.com | 김주연 총괄 (id ee67fc6b-…-70d12) | **admin** |
| mne@yonsei.ac.kr | 문지은 대표원장 (id d343769a-…) | director (admin→director swap 旣반영, 별건 MUNJIEUN-CLINICMGMT-LOCKOUT stopgap 커버) |

- prod `user_profiles` 컬럼: id, email, name, role, clinic_id, active, approved, created_at, access_tier, updated_at
- `has_ops_authority` / `exempt_from_restrictions` 컬럼 **부재**(DDL_DIFF_HOLD) → AC-4 durable flag 별건(DA CONSULT 회신 대기).

## 2. 게이트 전수 검증 (juyeon = admin)

### 진료 대시보드 (`/admin/doctor-tools`, DoctorTools.tsx)
- App.tsx route RoleGuard `['admin','manager','director','therapist','technician','part_lead','consultant','coordinator']` → admin ✓
- AdminLayout nav roles `['admin','manager','director','consultant','coordinator','therapist']` → admin ✓
- 내부 role 게이트 없음(4탭 전체공개: 진료알림판·진료환자목록·균검사지·소견서) → VIEW 완전개방

### 서비스관리 > 진료관리 (`/admin/clinic-management` + Services 서브탭, ClinicManagement.tsx)
- App.tsx route RoleGuard `['admin','manager','director','consultant','coordinator','therapist']` → admin ✓
- Services 서브탭 `canViewClinicMgmt = !!profile?.role` → admin ✓
- `isAdmin` → 금기증·소견서상용구 탭 노출 ✓
- 각 탭 EDIT 게이트(전 13탭) 시뮬레이션 결과 = 전부 true:
  - `role==='admin'`: Contraindications, DocumentTemplates, TreatmentSets, QuickRxButtons, SuperPhrases, PhrasesTab(medchart)
  - `canEditClinicMgmt(admin escape)`: DiagnosisNames, DiagnosisSets, DrugFolders, PrescriptionSets, ProgressPlans, OpinionPhrases
  - `canEditStaffArea(admin∈ALL_STAFF_ROLES)`: FeeSet

→ **두 surface 보기/수정 전 게이트 PASS = true** (게이트 simulation 로그 첨부, mq 회신).

## 3. AC 준수
- AC-2 (타 계정/role 회귀 0, BLOCKING): 코드 변경 0 → 회귀 위험 0.
- AC-5 (RRN PHI audit 면제 아님): 코드 미변경, RRN/audit 게이트 불변.
- AC-6 (의사영역 보기/수정 admin 통과): 통과 = 코드 0.
- ※ 임상 publish 게이트(KOH 발급=KOH_ISSUE_ROLES director/consultant/coordinator/therapist · 소견서/진료차트 publish)는 admin escape 비대상 = by-design(permissions.ts §76-82, 의사/진료 publish 우회 X). 총괄(admin·비의사)은 임상발행 대상 아님 → AC-6 "자동 안전" 범위.

## 4. standing_gate 인지
- 진료대시보드·진료관리 두 화면의 코드수정/개발(dev)은 문지은 대표원장(U0ALGAAAJAV) 명시 컨펌 필수. 본 작업은 '권한 개방 검증'이며 코드 변경 0 → 게이트 충족(향후 두 화면 로직/UI 변경은 별도 컨펌).
