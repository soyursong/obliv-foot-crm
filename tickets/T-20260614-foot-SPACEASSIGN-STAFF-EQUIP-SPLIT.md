---
ticket_id: T-20260614-foot-SPACEASSIGN-STAFF-EQUIP-SPLIT
domain: foot
priority: P2
status: deploy-ready
requester: planner (NEW-TASK MSG-20260614-012749-yl7h)
risk: GO
owner: agent-fdd-dev-foot
stage_done: [impl, build, spec]
stage_pending: []
deploy-ready: true
db-change: false
build: pass
spec: tests/e2e/T-20260614-foot-SPACEASSIGN-STAFF-EQUIP-SPLIT.spec.ts (2 scenarios)
qa_result: pending-supervisor
---

# 공간배정 드롭다운 치료사/장비 섹션 분리

공간배정 리스트 드롭다운의 평면 `<option>` 리스트를 role 기준 `<optgroup>`(치료사/장비)으로 분리.

## 구현

- `Staff.tsx` `renderStaffOptionGroups(roomType)` 헬퍼 신설 (getFilteredStaff 뒤).
  - `role === 'technician'`(장비명) → "장비" optgroup
  - 그 외 역할(원장·상담·코디·치료사) → "치료사" optgroup
  - 빈 그룹은 렌더하지 않음 (AC-4)
  - option value/구성원 무변경 — 표시 구조(섹션 라벨)만 분리 → 선택·저장·carry-over 무영향
- 카드뷰 드롭다운(구 961행) + 주간 테이블뷰 드롭다운(구 1028행) 두 곳에 동일 헬퍼 적용 → 표시 로직 drift 차단.

## AC

1. 치료사·장비 별도 섹션(optgroup) 분리 표시 — OK
2. 섹션 라벨 명확("치료사"/"장비") — OK
3. 선택·저장·carry-over 회귀無 (FE only, value 바인딩 무변경) — OK
4. 빈 그룹 미렌더 — OK

## 검증

- `npm run build` exit 0 (pass)
- `tsc --noEmit` Staff.tsx 타입 에러 0
- spec 2 시나리오 (AC-1/2/4 섹션 분리 · AC-3 선택→저장 회귀無)
- db_change=false, FE only, risk GO
