---
id: T-20260519-foot-DEDUCT-PAY-METHOD
title: "선수금차감 수납 시 결제수단 'membership' 고정 버그 수정"
status: deploy-ready
priority: P0
domain: foot
created_at: 2026-05-19
deploy_ready_at: 2026-05-19
commit_sha: ab3f279
db_migration: false
build_passed: true
e2e_spec: tests/e2e/T-20260519-foot-DEDUCT-PAY-METHOD.spec.ts
---

## 현장 보고

김주연 총괄 보고(thread 1779199134.844859): 선수금차감(보라색) 후 수납 시 `payments.method`가 `'membership'`으로 고정 → 일마감 매출 분류 오류.

## 근본 원인

PaymentMiniWindow.tsx에서 `deductMode` 시 결제수단을 항상 `'membership'`으로 고정.  
PKG-REVENUE-SPLIT(b7bdee9)에서 `deductAmount > 0` 케이스는 수정됐으나,  
`deductAmount === 0`(완전차감) 케이스는 여전히 `'membership'` 고정 + 결제수단 UI 미표시 잔존.

## 수정 내용

### 1. handleSettle (L989)
- Before: `const method = deductMode ? (deductAmount > 0 ? payMethod : 'membership') : payMethod;`
- After: `const method = payMethod;`

### 2. handleDocAndSettle (L1127)
- Before: `const method = deductMode ? (deductAmount > 0 ? payMethod : 'membership') : payMethod;`
- After: `const method = payMethod;`

### 3. 결제수단 UI (L1523)
- Before: `{saved && (!deductMode || deductAmount > 0) && (`
- After: `{saved && (`

### 4. 현금영수증 UI (L1544)
- Before: `{saved && (!deductMode || deductAmount > 0) && (payMethod === 'cash' || payMethod === 'transfer') && (`
- After: `{saved && (payMethod === 'cash' || payMethod === 'transfer') && (`

## AC 체크리스트

- [x] AC-1: deductMode 수납 → `payments.method` = 실제 결제수단(card/cash/transfer)
- [x] AC-2: deductMode에서도 결제수단 선택 UI 노출
- [x] AC-5 (dry-run): 기존 오류 데이터 COUNT 제시
  - `SELECT COUNT(*) FROM payments WHERE method='membership' AND tax_type='선수금'`
  - **결과: 2건** (amount=18,840원 × 2건, 총 37,680원, created=2026-05-19)
  - UPDATE 스크립트 (사람 확인 후 실행):
    ```sql
    -- dry-run 확인 먼저:
    SELECT id, amount, created_at
    FROM payments
    WHERE method = 'membership' AND tax_type = '선수금';

    -- 승인 후 UPDATE (기본 card; 현장 확인 후 정정 가능):
    UPDATE payments
    SET method = 'card'
    WHERE method = 'membership' AND tax_type = '선수금';
    -- 영향: 2건
    ```

## 빌드

```
✓ built in 3.10s (tsc -b && vite build)
```

## 주의

- PKG-REVENUE-SPLIT(P1)과 **별건** — 이중계상 vs 수단 분류 오류
- Closing.tsx 변경 불필요 (payments.method 정확하면 자동 해결)
- 기존 오류 데이터 2건 UPDATE는 supervisor 또는 대표 확인 후 실행
