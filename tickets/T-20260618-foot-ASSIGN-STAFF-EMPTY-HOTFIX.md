---
ticket_id: T-20260618-foot-ASSIGN-STAFF-EMPTY-HOTFIX
domain: foot
priority: P0
status: deploy-ready
requester: planner (NEW-TASK MSG-20260618-134531-2gx1)
risk: GO
owner: agent-fdd-dev-foot
stage_done: [diag, impl, build, spec]
stage_pending: []
deploy-ready: true
db-change: false
build: pass
spec: tests/e2e/T-20260618-foot-ASSIGN-STAFF-EMPTY-HOTFIX.spec.ts (3 scenarios, 4 cases) + 회귀 T-20260618-foot-ASSIGN-CONSULT-THERAPY-TABS (9) = 13 PASS
qa_result: pending-supervisor
---

# 배정화면 [상담]/[치료] 탭 직원 0건 — P0 HOTFIX

## 사고
배포 051b8c3 이후 상담·치료사 배정 화면(Assignments.tsx)의 [상담]/[치료] 탭에 직원 항목이
전혀 안 뜸 → 배정/토스/당김/수동 모두 불가, 현장 즉시 사용 불가.

## 근본 원인 (diag 확정 — 원인 A·B 아닌 제3원인 C)
`staff` 테이블에 `display_name` 컬럼이 **DB에 없음**(STAFF-NAME-UNIFY가 타입만 추가, 마이그레이션 미적용).
그런데 두 곳이 select 에 `display_name`을 포함:
- `src/pages/Assignments.tsx` L126 (staff active 로드)
- `src/lib/autoAssign.ts` L82 (fetchActiveStaff → 출근자 매칭·배정 풀)

→ PostgREST 400 `column staff.display_name does not exist` → 쿼리 전체 실패 → `staff = []`
→ 배정 풀(poolFor)·직원별 통계(staffStats)·드롭다운 **전부 0건**.

**원인 A/B 배제 근거 (DB 진단):**
- active staff 35명, role 분포 정상: **consultant 6 · therapist 10** (+ director/coordinator/technician)
  → 원인 B(role 표류) **아님**.
- `display_name` 제거 후 동일 쿼리 → 35행 정상 반환 확인.
- staff 자체가 비어 있었으므로 출근자 공집합(원인 A)은 증상의 원인이 아니라 가려졌던 것.

이 결함은 이미 같은 코드베이스의 Closing/CustomerChartPage/ReservationDetailPopup/Handover 가
**select 에서 display_name 제거 + UI는 `display_name || name` fallback 유지**로 고친 알려진 안티패턴.
Assignments.tsx · autoAssign.ts 두 곳만 이 수정을 누락.

## 조치 (FE-only, DB 무변경)
- 두 staff select 에서 `display_name`만 제거. role/name/필수 컬럼 보존.
- UI 표시(`display_name ?? name`)는 그대로 유지 → 마이그레이션 적용 시 자동 호환, 미적용 시 name fallback(무해).
- ⇒ supervisor DB 게이트·data-architect CONSULT 비해당 (신규 컬럼/테이블/enum 없음).

## AC 충족
- [x] AC: [상담]탭=상담사 표시 / [치료]탭=치료사 표시 → staff 로드 복구로 양 탭 풀·통계 노출.
- [x] AC(graceful): 시트 장애(출근자 공집합)여도 직원별 누적은 role 만으로 노출(poolFor 드롭다운만 출근 필터).
- [x] AC: 토스·당김·탭 로직 회귀 0 (select 만 수정).

## 잔여 (스코프 외 — planner FOLLOWUP)
동일 `display_name`-select 결함이 `Reservations.tsx` L646 · `Customers.tsx` L366 에도 존재
(staff 이름 resolve 무음 실패 — 담당자명 빈값/미표시). 별도 티켓 권고.

## 산출
- commit: (아래 push)
- spec: tests/e2e/T-20260618-foot-ASSIGN-STAFF-EMPTY-HOTFIX.spec.ts (13 PASS, 회귀 포함)
- diag: scripts/T-20260618-foot-ASSIGN-STAFF-EMPTY-HOTFIX_diag.mjs (READ-ONLY)
