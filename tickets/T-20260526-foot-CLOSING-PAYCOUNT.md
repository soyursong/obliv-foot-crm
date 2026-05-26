---
id: T-20260526-foot-CLOSING-PAYCOUNT
domain: foot
status: deploy-ready
deploy-ready: true
priority: P2
created: 2026-05-26
deadline: 2026-05-30
implemented_by: dev-foot
build: ok
db_change: false
spec_added: false
---

# T-20260526-foot-CLOSING-PAYCOUNT — 일마감 결제 요약 박스 건 수(N건) 표기

## 배경

일마감 결제 요약 3박스(패키지 결제 / 단건 결제 / 합계(결제수단별))에
결제수단별 건 수(N건) 표기 추가. 스크린샷 F0B67SWRN5P 빨간 박스 위치.

## AC 체크

- [x] AC-1: 패키지 결제 박스 — 카드/현금/이체/합계 각 행에 건 수 표기
- [x] AC-2: 단건 결제 박스 — 카드/현금/이체/환불/합계 각 행에 건 수 표기
- [x] AC-3: 합계(결제수단별) 박스 — 카드/현금/이체/환불/합계 각 행에 건 수 표기
- [x] AC-4: 0건도 "0건" 표기 (빈값 아님)
- [x] AC-5: 기존 금액 집계 정확성 불변 (sumGross/sum 헬퍼 무변경)

## 구현 요약

### 변경 파일
- `src/pages/Closing.tsx`

### 구현 내용

**1. `totals` useMemo — COUNT 헬퍼 추가**
```
countGross(rows, method) — 결제(payment)행만 건 수
countRefund(rows)        — 환불행 건 수
```
- 패키지: pkgCardCount / pkgCashCount / pkgTransferCount / pkgRefundCount
- 단건: singleCardCount / singleCashCount / singleTransferCount / singleRefundCount
- 수기: manualCardCount / manualCashCount / manualTransferCount
- 합계: totalCardCount / totalCashCount / totalTransferCount / totalRefundCount

**2. `SummaryCard` 컴포넌트 타입 확장**
```ts
rows: [string, number, number?][]   // 3번째 선택 요소 = 건 수
totalCount?: number                  // 합계 행 건 수
```
- count 전달 시 금액 왼쪽에 "N건" (text-xs, text-muted-foreground) 표시
- count 미전달 시 기존 렌더 유지 (수기결제 카드 호환)

**3. SummaryCard 호출부 업데이트**
- 패키지 결제: 카드/현금/이체 count + totalCount
- 단건 결제: 카드/현금/이체 count + 환불 row count + totalCount
- 합계 (결제수단별): 카드/현금/이체 count + 환불 row count + totalCount

### AC-4 보장
count prop 은 항상 숫자(0 포함) 전달 → `count !== undefined` 조건으로 "0건" 렌더

### AC-5 보장
기존 sum/sumGross 헬퍼, totals 금액 필드 전혀 변경 없음.

## 빌드

```
✓ built in 3.25s (Closing-MWUc4J2h.js)
```

## DB 변경

없음 (순수 프론트엔드 집계 로직)
