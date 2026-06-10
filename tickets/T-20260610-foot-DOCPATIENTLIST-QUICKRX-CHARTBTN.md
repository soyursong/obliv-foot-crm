---
id: T-20260610-foot-DOCPATIENTLIST-QUICKRX-CHARTBTN
title: "[진료환자목록] 미확정 환자 펼침 패널 '차트 열기' 버튼 누락 — QuickRxBar onOpenChart 배선 가드"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: b7befe8
impl_commit: 351dd72
created: 2026-06-10
assignee: dev-foot
reporter: 문지은(대표원장)
source_msg: MSG-20260610-132842-jka6
needs_field_confirm: true
related_tickets:
  - T-20260610-foot-QUICKRX-BLOCK-PANEL-HIDE
  - T-20260609-foot-DOCPATIENTLIST-RXCANCEL-DISCHARGE-GATE
  - T-20260609-foot-QUICKRX-INCLINIC-GATE
  - T-20260609-foot-DOCPATIENTLIST-DATEMODE-HISTORY
  - T-20260609-foot-DOCPATIENTLIST-SORT-LAYOUT
---

# T-20260610-foot-DOCPATIENTLIST-QUICKRX-CHARTBTN

## 신고
진료환자목록(DoctorPatientList)에서 미확정(pending/none) 환자 행을 펼치면, 원내 비잔류
(귀가/전날/미래/취소) 환자의 빠른처방 차단 패널에 '차트 열기' 버튼이 보이지 않음.
확정 환자(RxConfirmedSummary)에는 차트 진입이 있으나 미확정 분기(QuickRxBar)에만 누락.

## 원인
`PatientRow → QuickRxBar` 렌더 시 `onOpenChart` prop 미전달.
- `PatientRow` 는 부모에서 `onOpenChart` 수령 (DoctorPatientList line 731,
  `row.customer_id ? () => openChart(row.customer_id) : undefined`).
- `RxConfirmedSummary`(확정 분기)에는 전달했으나 `QuickRxBar`(미확정 분기)만 누락.

## 수정
`QuickRxBar` 에 `onOpenChart={onOpenChart}` 1줄 배선 (DoctorPatientList line 506).
- 신규 경로/컴포넌트 신설 금지 — 기존 `openChart`(LOGIC-LOCK L-004 단일 게이트웨이=useChart) 재사용.
- QuickRxBar 차단 분기: `blockedByUiGate && onOpenChart` → 미니멀 '차트 열기' 버튼
  (`data-testid="quick-rx-open-chart"`), 미제공 시 `return null`.
- 실 구현은 commit **351dd72** (T-20260610-foot-QUICKRX-BLOCK-PANEL-HIDE 와 동시 처리)에
  이미 반영됨 → 본 티켓은 누락됐던 **E2E 회귀가드 spec** 을 보강하고 배포를 확정.

## AC
- AC1: 미확정 펼침 패널(QuickRxBar)에 onOpenChart 전달 — 원내 비잔류 시 '차트 열기' 버튼 렌더.
- AC2: 차트 진입 = useChart.openChart(LOGIC-LOCK L-004) 단일 게이트웨이 경유(신규 경로 0).
- AC3: onOpenChart 미제공 시 null. 원내 잔류 환자는 정상 처방 버튼 노출(무회귀).

## 회귀가드
- R1 (DATEMODE-HISTORY): isPast 과거 read-only 행 클릭 = onOpenChart 차트 진입 보존.
- R2 (SORT-LAYOUT): 기본 행 grid 고정 열 + 원내 우선 그룹·시간/이름 정렬 토글 보존.
- R3 (확정패널 차트열기): RxConfirmedSummary onOpenChart 차트 진입 회귀금지.

## 검증
- E2E spec: `tests/e2e/T-20260610-foot-DOCPATIENTLIST-QUICKRX-CHARTBTN.spec.ts` — 12/12 pass.
- `npm run build` OK.
- 실브라우저: prod QuickRxBar 청크에 fix(quick-rx-open-chart) 반영 + 옛 'quick-rx-blocked'
  앰버 패널 소거 확인(배포 반영 후).
