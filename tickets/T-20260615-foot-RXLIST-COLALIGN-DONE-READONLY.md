---
id: T-20260615-foot-RXLIST-COLALIGN-DONE-READONLY
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260615-foot-RXLIST-COLALIGN-DONE-READONLY.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-15
assignee: dev-foot
reporter: 문지은 대표원장 (#foot, MSG-20260615-115926-h2ek 3항목 中 2·3번)
db-gate-handoff: null
---

# T-20260615-foot-RXLIST-COLALIGN-DONE-READONLY

진료 대시보드 '처방 환자 목록'(DoctorPatientList) — 컬럼 일치(item2) + 완료=읽기전용(item3).
같은 message 3항목 中 item1(SHAKE→즉시완료)은 P0 hotfix T-20260615-foot-DOCDASH-SHAKE-ACK-NOT-COMPLETE 로 분리(DEDUP) → 본 티켓은 item2·3.

## 직렬화 (AC5)
같은 파일 수정 선행 티켓 T-20260615-foot-RXLIST-RENAME-DOCFILTER(approved) **머지 완료(4a1af35)** 확인 후 본건 진행. 충돌 0.

## 구현 (FE-only, `src/components/doctor/DoctorPatientList.tsx`, DB/EF/스키마 변경 0)

### item2 — 컬럼 일치 (기본 행, 오늘 모드)
- 공통 컬럼 순서를 진료 알림판(DoctorCallDashboard CallFeedRow) 기준으로 재정렬.
  - 알림판 공통열 순서 = 방 → 상태 → 이름 → 차트번호 → 처방.
  - 새 grid: `4.75rem_3.75rem_3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto`
    (방→상태→방문유형→이름→차트번호→처방→예약메모→액션).
- A 고유 2열(방문유형 배지·예약메모)은 '무리 통합 금지' → 의미 다른 알림판열(생년/오늘시술/임상경과)과 합치지 않고
  자연 위치 유지: 방문유형=이름 바로 왼쪽(식별 prefix), 예약메모=유연폭 끝(처방 뒤).
- 폭/비율 보존(각 rem 값 그대로, 순서만 재배열). data-testid 전부 유지(patient-room/status-cell/visit-type-badge/patient-name/patient-chartno/prescription-badge/booking-memo/confirm-prescription-btn).
- 과거(이력) 모드 grid는 미변경(방·상태 컬럼 없음 — 범위 외, '기본 행'만).
- ※ 선행 Step1 분석 T-20260615-foot-DOCPATIENTLIST-DASHCOL-REALIGN(blocked-on-field) §5 제안과 동일 결론 → 본건이 그 구현분을 흡수(supersede). planner FOLLOWUP 로 reconcile 통지.

### item3 — 완료=읽기전용
- '진료완료' 판정 SSOT = RENAME-DOCFILTER 목록 필터 · DoctorCallDashboard.completedPatients(L504)와 1:1 동일:
  `isVisitDone = !!completed_at || status_flag==='pink'`.
- 편집(QuickRxBar) 분기 가드 강화: `expanded && !isConfirmed` → `expanded && !isVisitDone && !isConfirmed`.
  → 진료완료 환자는 펼침 시 편집폼 진입 금지, 읽기전용 요약/임상경과만(빈 편집폼 금지).
- confirm-prescription-btn(메인 행 확정 버튼)·읽기전용 요약(isConfirmed)·임상경과(MedicalChartPanel embed) 동선 불변.

## 검증
- build OK.
- E2E: 신규 spec 12 PASS + 관련 회귀 (RENAME-DOCFILTER/MIRROR-MONOTONE/EXPAND-COURSE-RXHISTORY/QUICKRX-CHARTBTN/SORT-LAYOUT/DATEMODE-HISTORY/SIGNDOCTOR) 전체 PASS.
- 회귀 spec 4건 grid/분기 정본 assertion 갱신(MIRROR-MONOTONE×2, EXPAND-COURSE-RXHISTORY R2, QUICKRX-CHARTBTN R2[기존 stale 정정]).
- ⚠ 실브라우저(갤탭) 진료완료-only 시드 렌더 + 컬럼 시각 정합 + 펼침 읽기전용 확인은 supervisor QA / 현장 confirm 요망.
