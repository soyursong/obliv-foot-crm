---
id: T-20260724-foot-ASSIGNHIST-CHARTNO-CHART2-LINK
domain: foot
priority: P2
status: deploy-ready
qa_result: pending (supervisor QA 대기)
deploy_commit: b4c406d8
deployed_at: n/a (NOT yet deployed — supervisor QA 대기)
bundle_hash: n/a (NOT yet deployed)
db_change: false
summary: "「상담·치료사 배정 > 금일 배분 이력」 고객 성함 셀 개선. AC-1 성함 옆 차트번호 병기(chartNoBadge, 예 '홍길동 #F-4790') — customers.chart_number 기존 컬럼을 monthCustomers map 으로 조인(신규 컬럼/뷰 없음, db_change=false, DA CONSULT 불요). 미발번(null)이면 배지 미렌더 → 성함 단독(잔여기호 금지). AC-2 성함 클릭 → 고객 2번차트(/chart/:customerId) 별도 팝업창(window.open, 1200x900) — Closing.tsx CLOSING-CHARTNUM-POPUP 패턴 재사용. customers PK(customerId) 기준 라우팅 → 동명이인 오라우팅 방지. customer_id 없는 행은 링크 비활성(성함 텍스트만). AC-3 정렬(at desc)·4컬럼(고객/담당/방식/시각)·ROW-EDIT-DELETE 인라인 수정 select 무회귀. presentation only / DB·RPC 무변경. build OK(5.88s). spec 7/7 PASS(AC1~3 결정론+회귀) + 형제 same-screen spec 회귀 무결(ROW-EDIT-DELETE 6 PASS, DISTRIB-SYNC 정적윈도 1600→2200 확장 후 PASS — 단언 의미 불변)."
created: 2026-07-24
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260724-foot-ASSIGNHIST-CHARTNO-CHART2-LINK.spec.ts
medical_confirm_gate: n/a (상담·치료사 배정 surface — 진료대시보드/진료관리 비대상, §11 게이트 무관)
coordination: "同 surface 병행 티켓 — ROW-EDIT-DELETE(요청1(A) 담당 인라인 수정, 旣 commit 6064bb5d) / DISTRIB-SYNC(담당자 하향전파). 본 티켓은 고객 성함 셀만 변경(담당 컬럼 무접점) → 상보적 병행, 렌더 충돌 없음. DISTRIB-SYNC 정적 spec 고정윈도 확장 외 인접코드 무수정."
---

## 요청 (planner NEW-TASK · MSG-20260724-144133-yc3n)

화면: 「상담·치료사 배정 > 상담 > 금일 배분 이력」
- AC-1: 고객 성함 셀에 차트번호 병기 (check_ins→customers.chart_number 조인, 예 "홍길동 F-4790"). 미발번 고객은 성함만(잔여기호 금지).
- AC-2: 성함 클릭 시 해당 고객 2번차트(/chart/:customerId)로 이동. 링크 스타일. 동명이인 오라우팅 금지(PK/차트번호 식별).
- AC-3: 정렬/페이징/타 컬럼 회귀 없음.

## 착수 전 확인 (planner 요구)

- ✅ 2번차트 실제 라우트 = `/chart/:customerId` → CustomerChartPage (App.tsx line 181). window.open 팝업 컨벤션(Closing CLOSING-CHARTNUM-POPUP) 확인.
- ✅ chart_number = customers 기존 컬럼(코드베이스 전반 사용: PaymentMiniWindow/InlinePatientSearch/CustomerHoverCard 등). 신규 컬럼/뷰 불요 → DA CONSULT 불요, db_change=false.
- ✅ 병행 티켓: DISTRIB-SYNC/ROW-EDIT-DELETE 旣 landed(HEAD 6064bb5d 위에 rebase). 담당 컬럼 무접점 → 상보적 병행.

## 구현 요약

1. `CustomerLite` 타입 + customers select 2경로(오늘분·당월분)에 `chart_number` 추가.
2. `todayDistribution` useMemo: monthCustomers map 에서 chart_number 파생 → TodayDistRow.chartNumber/customerId 채움 (deps 에 monthCustomers 추가).
3. 고객 셀 렌더: 성함=window.open 링크(teal, customerId 있을 때만) + chartNoBadge(null 이면 미렌더).

## 다음 (supervisor)

- 맥스튜디오 실브라우저: 차트번호 실표기 / 성함 클릭 팝업 / 동명이인 2건 각각 정확 라우팅 / 미발번 성함 단독 확인.
