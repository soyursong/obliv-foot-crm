---
id: T-20260615-foot-MEDCHART-MEMO-WIDTH-25P
title: "[진료차트] 의료진메모(원장메모) + 치료메모 입력영역 너비 25% 확대"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 5227791
created: 2026-06-15
deadline: 2026-06-17
assignee: dev-foot
reporter: 문지은 대표원장
source_msg: MSG-20260615-134312-5s67
risk_verdict: GO
---

# T-20260615-foot-MEDCHART-MEMO-WIDTH-25P

진료차트(MedicalChartPanel) 의료진메모(원장메모) + 치료메모 입력 영역 너비를 둘 다 현재 대비 25% 확대.
100% FE presentation(CSS 전용), DB/계약/권한 무변경.

## 요청 (문지은 대표원장)
의료진메모(원장메모) + 치료메모 입력 영역 너비를 둘 다 현재 대비 25% 확대.

## SEQUENCING (충돌 대조 §13.1.A)
같은 메모 패널이 converged grid로 이미 prod 재배치 완료(T-20260612-MEDREC-DATE-DIAG-UI-REFINE,
c9f0143). 25% 확대는 **현 prod의 grid 비율 위에서** 적용. 옛 단일 width 가정 금지.

- 현 비율: 두 메모 행 모두 좌(치료사차트/임상경과) `sm:flex-[4]` : 우(치료메모/의료진전용메모) `sm:flex-[1]`
  → 우측 메모 컬럼 = 1/(4+1) = **20%** of row.

## 구현
- 좌측 컬럼 `sm:flex-[4]` → `sm:flex-[3]` (두 행 모두): 치료사차트(L3322 부근), 임상경과(L3401 부근).
  → 우측 메모 컬럼 = 1/(3+1) = **25%** of row = 20%→25% = **정확히 +25%**.
- 우 `sm:flex-[1]` 토큰 무변경. 좌측 80%→75% 자연 축소(인접 overflow/squeeze/잘림 없음).
- 두 컬럼(치료메모·의료진전용메모) 동시 비율 상향.

## AC
- AC1: 데스크톱(≥sm)에서 두 메모 행 우측 컬럼이 ≈25%(옛 20% 대비 +25%). ✅
- AC2: 좌측 ≈75% — 인접 컬럼 overflow/squeeze/잘림 없음(좌+우 ≤ row, right-edge 경계 안). ✅
- AC3: 모바일(<sm) 1단 세로 collapse 유지(반응형 회귀 가드). ✅

## 현장 클릭 시나리오
1. 원장 로그인 → 환자 진료차트 열기 → 임상경과/의료진전용메모 행에서 우측 메모칸이 이전보다 넓게 보임.
2. 치료사차트/치료메모 행에서 우측 치료메모 뷰어 칸이 이전보다 넓게, 좌측 차트칸 잘림 없음.

## 검증
- build: tsc -b && vite build PASS (무관 WIP KohReportTab 격리 후 클린 빌드 확인).
- E2E: tests/e2e/T-20260615-foot-MEDCHART-MEMO-WIDTH-25P.spec.ts — HARNESS seed-free 6/6 PASS
  (치료메모 25% · 의료진메모 25% · 대조군 대비 ×1.25 · baseline 20% · 모바일 collapse).
- commit: 5227791
