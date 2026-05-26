---
id: T-20260527-foot-CLOSE-ITEM-COUNT
domain: foot
status: deploy-ready
deploy-ready: true
priority: P2
created: 2026-05-27
deadline: 2026-06-02
implemented_by: dev-foot
build: ok
db_change: false
spec_added: true
---

# T-20260527-foot-CLOSE-ITEM-COUNT — 일마감 개별 건 수 표기 (빨간 박스 구역 전체 적용)

## 배경

김주연 총괄 5/26 19:41 요청. T-20260526-foot-CLOSING-PAYCOUNT에서 패키지 결제 / 단건 결제 /
합계(결제수단별) 3개 SummaryCard에 건 수(N건)를 추가했으나, **수기결제 SummaryCard**는
"호환(backward-compatible)"만 처리하고 count 전달을 누락. 이번 티켓은 "전체 적용".

## 빨간 박스 구역 식별

`src/pages/Closing.tsx` 총 합계 탭의 SummaryCard 그리드 4종:

| 카드 | 이전 상태 | 이번 변경 |
|------|-----------|-----------|
| 패키지 결제 | ✅ 건 수 있음 | 유지 |
| 단건 결제 | ✅ 건 수 있음 | 유지 |
| **수기결제** | ❌ 건 수 없음 | **추가** |
| 합계 (결제수단별) | ✅ 건 수 있음 (단, "수기결제 포함" 행 제외) | **추가** |

## AC 체크

- [x] AC-1: Closing 페이지 "빨간 박스 구역" 식별 — SummaryCard 4종 코드 탐색 완료
- [x] AC-2: 수기결제 SummaryCard — 카드/현금/이체 각 행에 manualCardCount/manualCashCount/manualTransferCount 전달, totalCount 추가
- [x] AC-3: 합계 SummaryCard "수기결제 포함" 행에 count 전달 (manualCardCount+manualCashCount+manualTransferCount)
- [x] AC-4: 기존 패키지/단건/합계 카드 건 수 표기 회귀 없음 — spec 18/18 통과
- [x] AC-5: 빌드 통과 ✓ 3.45s

## 구현 요약

### 변경 파일
- `src/pages/Closing.tsx` (+6 lines)
- `tests/e2e/T-20260527-foot-CLOSE-ITEM-COUNT.spec.ts` (신규, 18 spec)

### 변경 내용

**1. 수기결제 SummaryCard (line 1244~1255)**

```tsx
// 전
rows={[
  ['카드', totals.manualCard],
  ['현금', totals.manualCash],
  ['이체', totals.manualTransfer],
]}
total={totals.manualTotal}

// 후
rows={[
  ['카드', totals.manualCard, totals.manualCardCount],
  ['현금', totals.manualCash, totals.manualCashCount],
  ['이체', totals.manualTransfer, totals.manualTransferCount],
]}
total={totals.manualTotal}
totalCount={totals.manualCardCount + totals.manualCashCount + totals.manualTransferCount}
```

**2. 합계 카드 "수기결제 포함" 행 (line 1265~1267)**

```tsx
// 전
? [['수기결제 포함', totals.manualTotal] as [string, number]]

// 후
? [['수기결제 포함', totals.manualTotal, totals.manualCardCount + totals.manualCashCount + totals.manualTransferCount] as [string, number, number]]
```

### 데이터 흐름
- `totals.manualCardCount/manualCashCount/manualTransferCount`는 T-20260526-CLOSING-PAYCOUNT에서 이미 계산됨
- 신규 DB 쿼리 없음, 신규 상태 없음 — props 연결만

## 빌드

```
✓ built in 3.45s (Closing-YbLNsK-6.js)
```

## E2E 스펙

`tests/e2e/T-20260527-foot-CLOSE-ITEM-COUNT.spec.ts` — 18 spec, 18 passed

## DB 변경

없음 (순수 프론트엔드 props 연결)
