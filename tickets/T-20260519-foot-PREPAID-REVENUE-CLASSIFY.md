---
ticket_id: T-20260519-foot-PREPAID-REVENUE-CLASSIFY
domain: foot
priority: P2
status: investigation-complete
type: investigation
deploy_ready: false
code_changed: false
db_changed: false
build_ok: true
e2e_spec: false
created: 2026-05-19
completed: 2026-05-19
investigator: dev-foot
---

# T-20260519-foot-PREPAID-REVENUE-CLASSIFY — 선수금 차감 결제 시 일마감 매출 분류 조사

## 현장 질문 (3가지)

1. 선수금 차감 후 결제하면 일마감에 멤버십으로 잡히는 이유
2. 멤버십 매출 기준이 뭔지
3. 패키지 결제 + 영수증 업로드 시 카드 매출 vs 멤버십 분류

---

## 조사 결과

### AC-1: PaymentDialog `payment_method` 확인

**파일**: `src/components/PaymentDialog.tsx`

```ts
type PayMethod = 'card' | 'cash' | 'transfer';
const METHOD_OPTIONS = [
  { value: 'card', label: '카드', icon: '💳' },
  { value: 'cash', label: '현금', icon: '💵' },
  { value: 'transfer', label: '이체', icon: '🏦' },
];
```

- `PaymentDialog`에서 선택 가능한 결제 수단은 카드/현금/이체 3가지
- **UI에 `membership` 옵션 없음** — 이 다이얼로그에서는 선수금 결제 불가

---

### AC-2: AdminClosing (Closing.tsx) 집계 로직

**파일**: `src/pages/Closing.tsx:441`

```ts
const singleMembership = sum(payments, 'membership');
```

- `payments` 테이블에서 `method = 'membership'` 행만 합산
- 일마감 요약 카드 "단건 결제 > 멤버십" 행으로 표시
- `METHOD_KO['membership'] = '멤버십'` (→ `src/lib/status.ts:182`)
- 단, `salesExport.ts:91`에서는 동일한 값을 `'선수금차감'`으로 표시 (불일치 존재)

---

### AC-3: `payments` 스키마

**파일**: `supabase/migrations/20260419000000_initial_schema.sql:249`

```sql
-- payments (단건)
CREATE TABLE payments (
  ...
  method TEXT NOT NULL CHECK (method IN ('card','cash','transfer','membership')),
  ...
);
```

- `membership`은 DB 설계상 합법적인 method 값
- **내부 코드값 `'membership'` = 선수금 차감의 표현**

---

### AC-4: 선수금 차감 결제 경로 (핵심)

**파일**: `src/components/PaymentMiniWindow.tsx:974`

```ts
const method = deductMode ? 'membership' : payMethod;
const taxType = deductMode ? '선수금' : null;
```

**흐름**:
1. 직원이 `[선수금 차감 후 금액 산정]` 버튼 클릭
2. `deductMode = true` 설정
3. `[수납]` 클릭 시 `method = 'membership'` 으로 `payments` INSERT
4. 일마감 Closing.tsx에서 `METHOD_KO['membership'] → '멤버십'`으로 표시

**결론**: 설계상 의도된 동작. 선수금 차감은 DB에서 `membership`으로 저장되고, 일마감에서 "멤버십"으로 라벨링됨.

---

### AC-4b: 패키지 결제 경로

**파일**: `supabase/migrations/20260419000000_initial_schema.sql:234`

```sql
-- package_payments
CREATE TABLE package_payments (
  ...
  method TEXT NOT NULL CHECK (method IN ('card','cash','transfer')),
  ...
);
```

- `package_payments`에는 `membership` method가 DB 레벨에서 차단됨
- 영수증 업로드(OCR) → 자동 추출 method: `'card' | 'cash' | 'transfer'`만
- **패키지 결제는 멤버십으로 잡힐 수 없음 — 항상 카드/현금/이체**

---

### AC-5: 라벨 불일치 문제 (현장 혼란 원인)

| 화면 | 표시값 | 코드 |
|------|--------|------|
| 일마감(Closing.tsx) | **멤버십** | `METHOD_KO['membership']` → `src/lib/status.ts:182` |
| 매출 Excel 내보내기 | **선수금차감** | `payMethodLabel()` → `salesExport.ts:91` |
| 매출/일별 탭 | **선수금차감** | `SalesDailyTab.tsx:41` |

**현장 혼란의 원인**: 일마감 페이지만 "멤버십"으로 표시하고, 나머지는 "선수금차감"으로 표시하는 라벨 불일치.

---

## 버그 판정

**버그 아님** (설계상 의도된 동작). 단, 라벨 불일치로 인한 현장 혼란이 있음.

## 개선 제안

`Closing.tsx` 내 `METHOD_KO['membership']` 표시를 "멤버십"→"선수금차감"으로 통일 (1줄 수정).
→ 별도 P3 레이블 통일 티켓 발행 가능 (planner 판단).

---

## 현장 회신문 → responder 경유 전달 완료

MQ: `~/claude-sync/memory/_handoff/message_queue/ops-responder.md` 발행
