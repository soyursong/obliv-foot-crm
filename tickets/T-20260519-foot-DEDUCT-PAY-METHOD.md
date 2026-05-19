---
id: T-20260519-foot-DEDUCT-PAY-METHOD
title: "선수금차감 수납 시 결제수단 'membership' 고정 버그 수정"
status: deployed
priority: P0
domain: foot
created_at: 2026-05-19
deploy_ready_at: 2026-05-19
commit_sha: ab3f279
db_migration: false
build_passed: true
e2e_spec: tests/e2e/T-20260519-foot-DEDUCT-PAY-METHOD.spec.ts
qa_result: pass
qa_grade: Yellow
deployed_at: 2026-05-19T23:52:11+09:00
deploy_commit: eb7a590
bundle_hash: index-Bk4rdJoZ.js
precheck_pass: true
precheck_at: 2026-05-19T23:52:11+09:00
field_soak_until: 2026-05-20T23:52:11+09:00
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

---

## supervisor QA 결과 — 2026-05-19T23:52:11+09:00

**판정: GO ✅ (Yellow)**

### Phase 1: 코드 QA

| 항목 | 결과 | 비고 |
|------|------|------|
| 빌드 | ✅ PASS | `✓ built in 3.13s` |
| handleSettle method | ✅ PASS | `const method = payMethod;` (deductMode 분기 제거) |
| handleDocAndSettle method | ✅ PASS | 동일 패턴 수정 확인 |
| UI 결제수단 조건 | ✅ PASS | `{saved && (!deductMode || ...)}` → `{saved}` |
| 현금영수증 UI 조건 | ✅ PASS | deductMode 조건 제거 |
| AC-6 일반결제 회귀 | ✅ PASS | deductMode=false 경로 `payMethod` 동일 |

### Phase 1.5: env 매트릭스

| 변수 | 상태 |
|------|------|
| VITE_SUPABASE_URL | ✅ prod bundle `supabase.co` grep 매치 |
| VITE_SUPABASE_ANON_KEY | ✅ 동일 번들에 포함 |

### Phase 2: E2E

```
tests/e2e/T-20260519-foot-DEDUCT-PAY-METHOD.spec.ts
4 passed / 1 skipped (수납대기 카드 없음 — 정상 skip) / 0 failed
```

**회귀 (PKG-REVENUE-SPLIT + BILLING-ITEM-PRICE):**
```
5 passed / 6 skipped / 0 failed
```

### 배포 확인

- origin/main 동기화: ✅ (commit `eb7a590`, 이후 `8c210de` HEAD)
- Vercel 배포: ✅ `last-modified: 2026-05-19 14:50:20 UTC`
- prod bundle hash: `index-Bk4rdJoZ.js` (local build 일치)

### Yellow 사유

기존 오류 데이터 2건(`method='membership' AND tax_type='선수금'`, 37,680원)이 아직 UPDATE되지 않음.
코드 수정 이후 신규 건은 모두 정확하게 기록됨. 기존 2건은 현장 확인 후 수동 보정 필요.

```sql
-- 현장 확인 후 실행 (카드/현금/이체 중 실제 수단으로 정정):
UPDATE payments
SET method = 'card'   -- 기본값; 현장 확인 후 정정 가능
WHERE method = 'membership' AND tax_type = '선수금';
-- 영향: 2건, 총 37,680원
```
