---
id: T-20260522-foot-PENCHART-DEFAULT-TAB
status: deploy-ready
deploy_ready: true
build_ok: true
db_migration: false
e2e_spec: tests/e2e/T-20260522-foot-CHART2-TAB-PENCHART.spec.ts
summary: "2번차트 1구역 기본 탭 [문진]→[펜차트] 변경. T-20260522-foot-CHART2-TAB-PENCHART로 이미 구현·배포 완료."
---

# T-20260522-foot-PENCHART-DEFAULT-TAB: 2번차트 기본 탭 [문진]→[펜차트] 변경

## 상태

**중복 티켓 — 이미 구현 완료**

동일 변경이 `T-20260522-foot-CHART2-TAB-PENCHART` 로 선(先) 구현되어 `main` 브랜치에 배포된 상태.

- 커밋: `6cbef5d3a26fadf5e8d40d5f5e72bf56a733dca1`
- 배포: Vercel main 자동 배포 완료

## AC 체크리스트

- [x] AC-1: CustomerChartPage 진입 시 1구역 기본 활성 탭 = [펜차트]
  - `useState<string>('pen_chart')` — L1077
- [x] AC-2: [문진] 탭 클릭 시 기존 기능 정상 동작
  - CLINICAL_TABS `checklist` 항목 무변경, 로직 회귀 없음
- [x] AC-3: 재진입 시에도 [펜차트] 기본
  - useState 초기값 변경이므로 모든 고객·세션에 일괄 적용

## 구현 참조

| 파일 | 내용 |
|------|------|
| `src/pages/CustomerChartPage.tsx` L1077 | `useState<string>('pen_chart')` |
| `src/pages/CustomerChartPage.tsx` L2412-2413 | CLINICAL_TABS 펜차트 첫 번째 |
| `tickets/T-20260522-foot-CHART2-TAB-PENCHART.md` | 원(原) 티켓 |
| `tests/e2e/T-20260522-foot-CHART2-TAB-PENCHART.spec.ts` | E2E spec 3건 |

## reporter

김주연 총괄 (U0ATDB587PV)

## deadline

2026-05-27
