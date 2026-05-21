---
id: T-20260522-foot-CHART2-TAB-PENCHART
status: deploy-ready
deploy_ready: true
build_ok: true
db_migration: false
e2e_spec: tests/e2e/T-20260522-foot-CHART2-TAB-PENCHART.spec.ts
summary: "2번차트 1구역 기본 탭을 [문진]에서 [펜차트]로 변경. CLINICAL_TABS 배열 순서 재배치 + chartTab 초기값 pen_chart."
---

# T-20260522-foot-CHART2-TAB-PENCHART: 2번차트 기본 탭 → 펜차트

## AC 체크리스트

- [x] AC-1: 2번차트 진입 시 1구역 기본 선택 탭 = [펜차트]
- [x] AC-2: CLINICAL_TABS 배열에서 [펜차트] 첫 번째 위치
- [x] AC-3: [문진] 탭 기존 기능 회귀 없음 (클릭 전환 정상)
- [x] AC-4: 전체 고객 차트에 일괄 적용 (useState 초기값 변경으로 일괄 적용)

## 구현 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/pages/CustomerChartPage.tsx` | `chartTab` 초기값 `'checklist'` → `'pen_chart'` (L1077) |
| `src/pages/CustomerChartPage.tsx` | `CLINICAL_TABS` 배열 순서 변경: `pen_chart` 첫 번째 (L2412) |

## 기술 노트

- FE-only, DB 변경 없음
- `useState<string>('pen_chart')` 단순 초기값 변경 → 전체 고객 일괄 적용
- `CLINICAL_TABS` 순서 변경으로 탭 UI 표시 순서 동기화
- [문진] 탭 로직 / 콘텐츠 코드 무변경 — 회귀 없음

## deadline

2026-05-22
