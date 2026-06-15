---
id: T-20260615-foot-DASH-GLOBALSEARCH-CHART-OPEN
title: "[대시보드] 헤더 고객검색 결과 클릭 시 선택 고객 차트 자동 오픈"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: d8cc55bd
created: 2026-06-15
assignee: dev-foot
reporter: planner
source_msg: MSG-20260615-135239-rtz3
risk_verdict: GO
---

# T-20260615-foot-DASH-GLOBALSEARCH-CHART-OPEN

## 증상
대시보드 우측 맨 상단 [고객 검색]에서 고객을 선택하면 고객관리 탭으로 전환만 되고
그 고객의 차트(2번차트)가 자동으로 열리지 않음.

## 원인 (RCA)
헤더 검색 결과 클릭 핸들러(`AdminLayout.tsx`)가 `navigate('/admin/customers?id=${c.id}')`만 호출.
- `Customers.tsx`는 `location.state.openCustomerId` 로만 차트를 오픈 (T-20260506-foot-CHART-CONSOLIDATE 패턴).
- `?id=` 쿼리 파라미터는 어디서도 소비되지 않음 → 탭만 전환되고 차트 미오픈.

## 수정
클릭 핸들러에 차트 오픈 분기만 보강(신규 컴포넌트·검색동작 변경 없음):
```
navigate('/admin/customers');   // 탭 전환
openChart(c.id);                // 단일 게이트웨이(useChart) 통한 2번차트 오픈
```
`CustomerChartSheet`는 AdminLayout 레벨(`chartId`)에서 단일 마운트로 렌더되므로
`openChart(c.id)` 호출 시 페이지와 독립적으로 즉시 열림. (LOGIC-LOCK L-004 단일 경로 준수)

## 비범위
- 검색 동작 자체·결과 리스트 레이아웃 불변
- DB 무변경

## 검증
- `npm run build` ✅
- E2E spec: `tests/e2e/T-20260615-foot-DASH-GLOBALSEARCH-CHART-OPEN.spec.ts`
  - S1: 검색→고객 클릭→고객관리 탭 전환 + `role=dialog[name=고객차트]` 가시화
  - S2: 결과 없음 검색어 → '검색 결과 없음' 안내 + 차트 미오픈 회귀
- pre-push 차트 접근 가드 PASS (필수 심볼 0종 클린)

## commit
- 75a1176 fix(foot-search): 헤더 고객검색 결과 클릭 시 선택 고객 차트 자동 오픈
- d8cc55bd test(foot-search): QA FIX — E2E BASE_URL 8089 정합 + 대시보드 /admin 라우트 교정

## QA FIX (MSG-20260616-040943-pt9h, phase2/spec_fail_new)
- 원인: spec BASE_URL 기본값이 `localhost:5173` 하드코딩 → playwright webServer 포트(8089) 불일치로 연결거부, S1/S2 모두 실패.
- 추가 발견: 대시보드는 별도 `/dashboard` 경로 없이 `/admin` 인덱스 라우트(`*` → `/admin` 리다이렉트). S2의 `/dashboard` URL 잔류 단언이 항상 실패.
- 수정: BASE_URL 기본값 → `localhost:8089`(config 정합), goto/단언을 `/admin` 기준으로 교정(S2 잔류 회귀 = `/admin/customers` 아님 + `/admin` 잔류).
- 재검증: `npx playwright test` 3 PASS(setup+S1+S2), `npm run build` ✅, pre-push 차트 가드 클린.
