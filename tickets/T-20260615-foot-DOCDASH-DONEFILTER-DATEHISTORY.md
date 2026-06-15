---
id: T-20260615-foot-DOCDASH-DONEFILTER-DATEHISTORY
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260615-foot-DOCDASH-DONEFILTER-DATEHISTORY.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-15
assignee: dev-foot
reporter: 문지은 대표원장 (#foot thread 1781526107.092559) — 진료대시보드 UX 6종 中 ⑤⑥
db-gate-handoff: null
commit_sha: e943d9a9
---

# T-20260615-foot-DOCDASH-DONEFILTER-DATEHISTORY

진료대시보드 UX 6종 中 **신규 2종**(①②③=3FIX, ④=REVAMP item7 디둡 완료 — 본건 미접촉).
FE-only, DB/EF/스키마 변경 0 (data-architect CONSULT 불요 — 기존 컬럼 prescription_status 재사용).

## ⑤ 진료 알림판 '진료완료' 섹션 처방상태 필터 태그 (DoctorCallDashboard.tsx)

- 진료완료 섹션 헤더 아래 필터 태그 추가: **전체 / 처방확인 대기 / 처방완료**.
- 재활용 SSOT = DoctorPatientList 처방환자목록 필터(prescription_status 'pending'/'confirmed') — 동일 술어·동일 태그 스타일(rounded-md, teal-600 active).
- `completedFilter` state + `completedPendingCount`/`completedConfirmedCount`/`filteredCompleted` useMemo 추가.
- 태그는 진료완료 환자 ≥1명일 때만 노출(`completedPatients.length > 0`). tbody는 `filteredCompleted` 매핑.
- 필터 결과 0행 시 별도 빈상태 메시지(`doctor-completed-filter-empty`). 전체 0명 빈상태(`아직 진료 완료된 환자가 없어요.`) 보존.
- 회귀가드: CompletedRow 로직·data-testid(`doctor-completed-section/table/rows`)·colgroup·행구조 무변경 — 표시 대상 행만 축소.
- 신규 data-testid: `doctor-completed-filter`, `doctor-completed-filter-{all|pending|confirmed}`, `doctor-completed-filter-empty`.

## ⑥ 진료환자목록 데이터정의 통일 + 날짜 히스토리 (DoctorPatientList.tsx) — 코드 변경 0 (확인만)

- **데이터정의**: `usePatientsByDate` 반환 필터(L285 `!!row.completed_at || row.status_flag === 'pink'`) = RXLIST-RENAME-DOCFILTER item2 SSOT(= DoctorCallDashboard.completedPatients L508)와 **글자 그대로 1:1 동일** → 이미 통일됨. 중복 정의·재구현 없음. 회귀가드만 추가.
- **날짜 히스토리**: `selectedDate` state(L851) + `usePatientsByDate(clinicId, selectedDate)`(L857) + 날짜 < > '오늘' 네비 UI(L930~971) **이미 노출** → ⑥ 날짜부분 충족(실브라우저 확인 완료).

## QA 검증
- `npm run build` PASS (4.50s).
- E2E 11 passed (S1 모집단 / S2 처방상태 필터 4탭 / S3 ⑥ 데이터정의 통일 회귀가드 / S4 ⑥ 날짜 이동).
- 실브라우저 렌더(8092 preview): ⑤ doctor-completed-section 렌더(에러 0), ⑥ 날짜 네비 prev/next/header 노출 확인.
  evidence: `evidence/T-20260615-foot-DOCDASH-DONEFILTER-DATEHISTORY_done-section.png` / `_date-nav.png`.
- ⚠ 필드 QA 요망: 필터 태그는 진료완료 환자 ≥1명일 때만 노출 → 시드 데이터(완료+처방완료/처방대기 혼재)에서 탭 클릭 시 행 축소 시각 확인.

## COORDINATE
- 同 파일 DoctorCallDashboard.tsx in-flight 3FIX(①②③)·REVAMP(items1~6)는 본 작업 시점 working tree에 미반영(이미 머지됨) → hunk 경합 없음. data-testid·행구조·colgroup 전부 보존.
