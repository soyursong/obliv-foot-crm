---
ticket_id: T-20260613-foot-CUSTLIST-STAFF-FILTER
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-14
deploy_ready_at: 2026-06-14
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260613-foot-CUSTLIST-STAFF-FILTER.spec.ts
db_changed: false
rollback_sql: none
risk_level: GO (1/5)
commit_sha: PENDING
---

## 요청

원천: NEW-TASK MSG-20260613-235629-hie5 (planner, P2). 김주연 총괄 요청.
고객관리 화면 개선 — 검색창 우측에 담당자 드롭다운 필터 추가.

기존 자산 재사용:
- `customers.assigned_staff_id` (담당자, T-20260508-foot-C2-STAFF-DROPDOWN closed 旣구현)
- 옵션소스 = staff role consultant/coordinator/director (active, 이름순) — CustomerChartPage 옵션소스와 동일 규약

## 구현

src/pages/Customers.tsx 단일 파일.
- `staffFilter` state: '' = 전체(필터해제), '__unassigned__' = 미지정(IS NULL), 그 외 = staff.id 일치
- `staffOptions` 로드 effect: staff role in (consultant/coordinator/director), active, name asc
- runSearch 쿼리에 필터 분기 추가 (검색어와 AND):
  - '__unassigned__' → `.is('assigned_staff_id', null)`
  - staff.id → `.eq('assigned_staff_id', staffFilter)`
  - '' → 미적용
- 검색창 우측에 `<select data-testid="cust-staff-filter">` (담당자 전체 / 미지정 / 직원리스트)
- staffFilter 변경 시 runSearch 재생성 → 디바운스 effect 재실행 → page=1 리셋 + 재조회

신규 컬럼/테이블/enum 없음 → data-architect CONSULT 게이트 미해당.

## AC (E2E)

- AC-1: 담당자 드롭다운 렌더 (전체/미지정/직원옵션)
- AC-2: 특정 직원 선택 → customers 쿼리에 assigned_staff_id=eq.<id>
- AC-3: 미지정 선택 → customers 쿼리에 assigned_staff_id=is.null
- AC-4: 전체 선택 → assigned_staff_id 필터 미적용 (해제)

E2E: 5 passed (setup 포함). 회귀(CHART1-CHARTNO-DEDUP-REORDER) 7 passed.
build: OK.
