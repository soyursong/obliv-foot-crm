---
ticket_id: T-20260613-foot-CLINICMGMT-SUBTAB-STAFF-OPEN
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-13
deploy_ready_at: 2026-06-14
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260613-foot-CLINICMGMT-SUBTAB-STAFF-OPEN.spec.ts
db_changed: false
rollback_sql: none
risk_level: GO (2/5)
commit_sha: 7fed414
---

## 요청

원천: NEW-TASK MSG-20260613-234222-6k47 (planner, P2, FE-only, db_change=false).
김주연 총괄: "서비스 목록 | 상용구관리 | 진료관리 3개 전부 직원도 볼 수 있게,
굳이 권한 막을 필요 없어."

실제 delta = **진료관리(clinic) 서브탭 직원 노출** (서비스목록·상용구관리는
이미 직원 노출 / PHRASEMGMT 소관). PHRASEMGMT-SUBTAB-SPLIT과 동일 Services.tsx
top-tab 영역 → 별도 PR 분리 말고 1 delivery 동봉.

정책 근거: umbrella open-all-except-3 정합(진료관리=일반=직원개방이 본래 정책).
§13.1.A reporter-authorized.

## 수행

대상: `src/pages/Services.tsx` 진입 게이트 1곳만. ClinicManagement.tsx 내부 미접촉.

1. **CLINIC_MGMT_ROLES(['admin','manager','director']) 상수 제거** — 진료관리
   서브탭을 좁히던 role 화이트리스트 폐기.
2. **canViewClinicMgmt = !!profile?.role** — 서비스 페이지 자체가 route
   RoleGuard(admin/manager/consultant/coordinator/therapist)로 게이트됨 →
   이 컴포넌트 도달 = 진료관리 서브탭 노출 자격(직원 포함). 게이팅 제거.
3. 서브탭 버튼(`svc-top-tab-clinic`) + 렌더(`ClinicManagementPanel`)·순서(서비스목록
   →상용구관리→진료관리) 그대로 유지 — 노출만 확대.

### SUPERSEDED
- T-20260607 AC-4 (진료관리 admin/manager/director 한정).
- PHRASEMGMT-SUBTAB-SPLIT AC-3 후단 (진료관리 게이팅 유지) → 본 티켓으로 제거.

### scope 경계 (불변)
- FE 메뉴 가시성만 확대. 진료관리 내부 각 패널 데이터 RLS/WRITE 권한 불변(메뉴 노출만).
- 진료관리 뒤 테이블 staff SELECT parity = umbrella RLS-MENU-ROLE-PARITY-POLICY
  Phase2 소관(본 티켓 밖). 직원 진입 후 일부 패널 비어보여도 화면 무파손이면 OK(시나리오3).
- App.tsx 독립 /admin/clinic-management route RoleGuard 는 본 티켓 밖(불변).
- PROCMENU-RX-UNIFY(in_progress)와 ClinicManagement.tsx 충돌 회피 — 진입 게이트만, 내부 미접촉.

## 검증

- `npm run build` PASS.
- E2E 신규 spec: 소스 불변식 5 (CLINIC_MGMT_ROLES 제거 / canViewClinicMgmt=!!profile.role
  / 서브탭 버튼·렌더 잔존 / 내부 RLS·WRITE 토큰 미도입 / 탭 순서 보존) +
  브라우저 렌더 2 (진료관리 서브탭 노출 / 클릭 시 패널 렌더·무파손) → 7 PASS.
- 회귀: PHRASEMGMT-SUBTAB-SPLIT 소스 불변식 7 PASS (동봉 Services.tsx 무손상 확인).
- **DB변경: 없음** (FE 가시성만, 신규 컬럼/테이블/enum 0 → CONSULT §S2.4·DB게이트 불요).

commit 7fed414 → main push (Vercel 자동). 동봉: PHRASEMGMT-SUBTAB-SPLIT(Services.tsx 미커밋분).

## supervisor QA 포인트

- 서비스관리(/admin/services) 진입 → 상단 탭에 **진료관리**가 직원 계정으로도 노출.
- 진료관리 탭 클릭 → 패널 렌더, 화면 파손 없음(일부 패널이 RLS로 비어보일 수 있으나 무파손이면 OK).
- 서비스 목록 → 상용구관리 → 진료관리 탭 순서 유지.
