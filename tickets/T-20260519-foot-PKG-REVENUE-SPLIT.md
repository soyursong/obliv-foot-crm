---
id: T-20260519-foot-PKG-REVENUE-SPLIT
title: "패키지 차감건 매출 이중계상 수정"
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-05-19
deploy_ready_at: 2026-05-19
commit_sha: b7bdee9
db_migration: false
build_passed: true
e2e_spec: tests/e2e/T-20260519-foot-PKG-REVENUE-SPLIT.spec.ts
---

## 현장 보고

미니 결제창 패키지 차감건(보라색) 적용 경로 역전 + 이미 결제된 패키지 금액이 금일 매출로 이중계상.

## 근본 원인 (확정)

### Bug #1: 선수금 차감 경로 역전 (AC-1)

`PaymentMiniWindow.tsx` — `handleSettle` 에서 `deductMode=true` 이더라도 잔액(`deductAmount > 0`)이 있으면 실제 결제수단(card/cash/transfer)을 써야 하는데, 이전 코드는 무조건 `method='membership'`을 사용했다. 결과:

- 잔액이 0이 아닌 경우에도 'membership'으로 저장 → 실결제 수단 추적 불가
- deductMode에서 결제수단 버튼이 미표시 → 현장에서 카드/현금 선택 불가

### Bug #2: 패키지 차감 항목 매출 이중계상 (AC-2/AC-3)

- `Closing.tsx` `grossTotal` 계산 시 `method='membership'`(패키지차감 마커) 금액이 포함
- `check_in_services`에 `is_package_session` 플래그가 있음에도 `procedureStats` 쿼리에서 필터링 미적용

---

## 수정 내용

### PaymentMiniWindow.tsx

**AC-1: 결제 경로 역전 해소**
```ts
// Before
const method = deductMode ? 'membership' : payMethod;

// After
const method = deductMode ? (deductAmount > 0 ? payMethod : 'membership') : payMethod;
```
- `deductAmount > 0` → 실결제수단(card/cash/transfer) 사용
- `deductAmount === 0` → 전액 패키지 차감 마커(method='membership', amount=0)

**AC-1: saveCheckInServices 파라미터 추가**
```ts
// isDeductMode=true 시 prepaid(보라색) 항목에 is_package_session=true 마킹
const isPkgSession = isDeductMode && prepaidIds.has(service.id);
```

**AC-1: 결제수단 버튼 + 현금영수증 UI**
- `deductMode && deductAmount > 0` 조건에서도 결제수단 버튼 표시
- 수납 버튼 레이블: 상황별 3종 (패키지차감완료 / 잔액수납 / 일반수납)

### Closing.tsx

**AC-2/AC-3: grossTotal에서 membership 제외**
```ts
// Before: totalCard + totalCash + totalTransfer + membership이 singleCard에 포함
// After: grossTotal = totalCard + totalCash + totalTransfer (membership 별도 집계)
const grossTotal = totalCard + totalCash + totalTransfer;
```

**AC-3: 시술별 통계에서 패키지 세션 제외**
```ts
// is_package_session=true 항목은 이미 결제된 패키지 차감 건 → 매출에서 제외
if (row.is_package_session === true) continue;
```

**AC-5: SummaryCard 레이블 명시**
- `method='membership'` 행: "패키지차감(매출제외)" 레이블로 표시
- CSV/PDF 헤더: "패키지차감(매출제외)" 컬럼 추가

---

## AC 검증 결과

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | 패키지 차감건(보라색) 선택 시 차감 경로 정상 동작 | ✅ deductMode+잔액>0 → payMethod 사용, 잔액=0 → membership 마커 |
| AC-2 | 패키지 차감 금액은 일일 매출 집계에서 제외 | ✅ grossTotal에서 singleMembership 제거 |
| AC-3 | 당일 실결제(비패키지)만 일일 매출 집계 | ✅ is_package_session 필터 + membership method 제외 |
| AC-4 | 기존 패키지 구매 시점 매출 처리 회귀 없음 | ✅ package_payments 집계 경로 미변경 |
| AC-5 | AdminClosing(일마감) 화면에서 정확성 확인 | ✅ "패키지차감(매출제외)" 레이블, 시술별 통계 정상 |

## DB 변경

없음 — `is_package_session BOOLEAN DEFAULT false` 컬럼은 초기 스키마(`20260419000000_initial_schema.sql` L168)에 이미 존재.

## 빌드

- `npm run build` ✅ 통과 (3.09s)

## 파일 변경

- `src/components/PaymentMiniWindow.tsx`
  - `handleSettle`: 결제수단 로직 수정
  - `handleDocAndSettle`: 동일 로직 적용
  - `saveCheckInServices(isDeductMode)`: is_package_session 마킹
  - 결제수단 버튼 조건 추가
- `src/pages/Closing.tsx`
  - `totals` 계산: singleMembership 별도 분리
  - `procedureStats` 쿼리: is_package_session 필터
  - `SummaryCard`: 패키지차감 레이블
  - CSV/PDF 내보내기 헤더 갱신
- `tests/e2e/T-20260519-foot-PKG-REVENUE-SPLIT.spec.ts` — 신규 (5 cases)

---

*담당: dev-foot · 2026-05-19*
