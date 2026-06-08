---
id: T-20260608-foot-CHART-LAYOUT-SHIFT
domain: foot
priority: P2
status: deploy-ready
title: 진료차트 데이터 로드 시 화면 상하 점프(CLS) 제거
created: 2026-06-08
assignee: dev-foot
reporter: 문지은 대표원장
db-change: false
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260608-foot-CHART-LAYOUT-SHIFT.spec.ts
---

# T-20260608-foot-CHART-LAYOUT-SHIFT — 진료차트 로드 CLS 제거

## AC-0 (read-only 규명) — 점프 주원인 특정
점프 주원인 = **"fetch 전후 컨테이너 높이변화"**.

`MedicalChartPanel`(진료차트, `fixed right-0 h-full` 드로어)의 본문은 3-컬럼(타임라인 | 진료폼 | 우측패널).
- 메인 `loadData()`는 `loading` 게이트로 본문 전체를 스피너 처리 → 닫히면 3-컬럼이 `flex-1` 전체를 채움(드로어 레벨 높이변화 없음).
- **그러나** `loadVisitPayments()`는 메인 `loading` 게이트 **밖**에서 `resetForm()` 안에서 `await` 없이 별도 비동기로 발사된다. loadData(8쿼리 Promise.all)는 먼저 끝나고, 느린 visitPayments(check_ins→payments **순차 2쿼리**)가 나중에 resolve되며 `visitPayments.length > 0` 가 flip → "치료·시술(결제내역 자동연동)" 섹션이 **[진단명 ↔ 치료사차트] 사이에 뒤늦게 삽입** → 치료사차트/임상경과가 아래로 점프(중앙 폼은 `flex-1 overflow-y-auto` 독립 스크롤).

부차:
- 토글(특이사항): 좌측 타임라인 컬럼·`max-h-40` 바운드 → 중앙 폼 형제에 영향 없음(구조적 비점프).
- 드롭다운(진단명 picker / 상용구 팝오버): portal/fixed → 레이아웃 비점프.
- 입력행(처방내역): 폼 하단이라 하방 확장(상단 콘텐츠 불변).

진단 스크립트(코드 규명) — 본 분석은 정적 코드 추적으로 확정.

## AC-1 — skeleton/min-height 자리 점유
`visitPaymentsLoading` 상태 신설. `loadVisitPayments` in-flight 동안 동일 높이 skeleton(`min-h-[2.75rem]`)으로 섹션 자리 미리 점유. 결과 도착 시 pop-in 점프 제거. early-return(결제없음) 포함 모든 경로 `finally`로 로딩 해제.

## AC-2 — 토글/드롭다운 비점프 (구조적 충족)
중앙 폼 형제 점프 원인 토글 없음(특이사항=좌측 바운드, picker/팝오버=portal). 기존 chevron transition 유지.

## AC-3 — 입력행 추가/삭제 최소화
중앙 폼 스크롤 컨테이너에 `[overflow-anchor:auto]` 명시 → 브라우저 스크롤 앵커링으로 행 변경 시 보이는 콘텐츠 안정.

## 변경
- `src/components/MedicalChartPanel.tsx`: visitPaymentsLoading 상태 + skeleton 슬롯 + overflow-anchor.
- 데이터경로·쿼리·스키마 무변경. 신규 패키지 없음(순수 state/CSS).

## 검증
- build OK. 신규 E2E 8/8(슬롯 상태머신·라이프사이클·overflow-anchor). MEDCHART 회귀 14/14.
