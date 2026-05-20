---
id: T-20260520-foot-PKG-SORT
title: 구매 패키지(티켓) 목록 정렬 — 최신 생성순 DESC
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
commit: 9102c69
db_change: false
spec_file: tests/e2e/T-20260520-foot-PKG-SORT.spec.ts
risk: 0/5
created_at: 2026-05-20
completed_at: 2026-05-20
---

## 작업 요약

2번차트 > 패키지 > 구매 패키지(티켓) 리스트 정렬 기준 변경.

### 변경 내용

| 파일 | 위치 | 변경 |
|------|------|------|
| `src/pages/CustomerChartPage.tsx` | L905 (초기 로드) | `order('contract_date', { ascending: false })` → `order('created_at', { ascending: false })` |
| `src/pages/CustomerChartPage.tsx` | L4702 (구입 티켓 추가 콜백) | 동일 변경 |
| `src/pages/CustomerChartPage.tsx` | L4723 (항목 추가 콜백) | 동일 변경 |

### 이유
`contract_date` 컬럼은 NULL 허용 — 미기입 시 이름순(이름 포함 default sort)으로 렌더링. `created_at` 은 항상 존재(NOT NULL)하므로 신규 티켓이 안정적으로 최상단에 표시됨.

## AC 충족 여부

- [x] AC-1: created_at DESC 정렬
- [x] AC-2: 최신 구매 티켓 최상단
- [x] AC-3: 데이터 누락 없음 (ORDER 변경만, SELECT/WHERE 불변)
- [x] AC-4: 빌드 통과 (✓ built in 3.10s), E2E spec 신규 작성

## DB 변경
없음.
