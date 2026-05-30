---
ticket_id: T-20260530-foot-CLOSING-PAYMETHOD-FILTER
domain: foot
status: deploy-ready
deploy_ready: true
build_ok: true
db_change: false
e2e_spec_exempt: false
commit: b90e0b4
---

# T-20260530-foot-CLOSING-PAYMETHOD-FILTER — 일마감 결제내역 결제수단별 필터

## 요약

일마감(Closing) 결제내역 탭에 담당자 필터 옆 **[결제수단] 필터 드롭다운** 신규 추가.
선택 시 해당 결제수단 행만 표시. 담당자 + 결제수단 AND 조합 동작.

## 변경 파일

| 파일 | 변경 |
|------|------|
| `src/pages/Closing.tsx` | methodFilter state 추가, useMemo AND 조건 결합, 결제수단 native select 드롭다운 + 리셋(✕) UI |

### 핵심 구현
- `methodFilter` state 추가 (담당자 `staffFilter` 패턴 재사용).
- `filteredEnrichedRows` useMemo: `(!staffFilter || ...) && (!methodFilter || r.method === methodFilter)` AND 결합.
- 옵션: 전체 / 카드(card) / 현금(cash) / 이체(transfer) / 패키지(membership) — `METHOD_KO` 라벨 사용.
- 리셋(✕) 버튼 담당자 필터와 동일 UX.

### 무파괴
- 기존 담당자 필터 / 합계 집계(tfoot, 결제수단별 소계) / 타 탭 영향 없음.
- DB 변경 없음. 코드 레벨 필터만 적용.

## E2E
`tests/e2e/T-20260530-foot-CLOSING-PAYMETHOD-FILTER.spec.ts` (3 AC)
- AC-1: [결제수단] 드롭다운 + 옵션(전체/카드/현금/이체/패키지) 존재
- AC-2: 결제수단 선택 시 해당 method 행만 표시
- AC-3: 담당자+결제수단 AND 조합 + 리셋(✕) + 화면 무파괴

## 검증
- `npm run build` ✅ (built in 3.69s)
- `npx tsc -p tsconfig.app.json --noEmit` ✅
- `playwright --list` ✅ 3 spec 인식
- deadline 2026-06-03
