---
id: T-20260525-foot-CLOSING-CALC-BUG
domain: foot
priority: P1
status: deploy-ready
title: 일마감 합계 금액 불일치 — 환불 이중 차감 버그
created: 2026-05-25
assignee: dev-foot
db-change: false
deploy-ready: true
build-ok: true
regression-risk: medium
e2e-spec: tests/e2e/T-20260525-foot-CLOSING-CALC-BUG.spec.ts
commit_sha: b8d71574c6b8b96d8e0c72f4d9de60d0b1c7e9f1
---

# T-20260525-foot-CLOSING-CALC-BUG — 일마감 합계 금액 불일치 (환불 이중 차감)

## 문제 요약
`fab1ad6`(T-20260522-foot-CLOSING-REFUND) 배포 후 `refund_single_payment` RPC로
실제 환불 행(`payment_type='refund'`)이 `payments` 테이블에 생성되기 시작.

기존 코드에서:
1. `sum()` 헬퍼: `payment_type='refund'` 행을 이미 차감 → `totalCard/Cash/Transfer` = **NET**
2. SummaryCard "합계": NET 값 + `['환불', -refundAmount]` 행 추가 → **환불 이중 차감**
3. 결과: 표시 행들의 합(NET + -환불) = 0 ≠ grossTotal(NET) → **금액 불일치** 표시

## 수정 내용 (commit b8d7157)

### 전략: GROSS/NET 이중 계산 + 표시는 GROSS, 정산은 NET

| 용도 | 변수 | 설명 |
|------|------|------|
| SummaryCard 표시 | `totalCardGross` 등 | GROSS(환불 미포함) |
| 실제 정산(ReconRow) | `totalCard` 등 | NET(환불 차감 후) |
| DB 저장(saveDraft) | `pkgCard`, `singleCard` 등 | NET 유지 (스키마 무변경) |

### 변경 파일
- `src/pages/Closing.tsx`
  - `sumGross()` 헬퍼 추가 (`payment_type !== 'refund'`만 집계)
  - `pkgCardGross`, `singleCardGross`, `totalCardGross` 등 GROSS 변수 추가
  - `refundSingleAmount`, `refundPkgAmount` 별도 집계 (단건/패키지 구분 표시)
  - SummaryCard "합계": GROSS 행 + `['환불 차감', -refundAmount]` → 행 합계 = NET ✓
  - SummaryCard "패키지/단건": GROSS 행 + 환불 행(해당 시) → 각 합계 = NET ✓
  - CSV/PDF 내보내기: GROSS 컬럼 + 환불 차감 행 명시

### 수학 검증
예시: 카드 100,000 결제 + 50,000 환불

| | 수정 전 (bug) | 수정 후 (fix) |
|--|--|--|
| 카드 총합 행 | 50,000 (NET) | 100,000 (GROSS) |
| 환불 차감 행 | -50,000 (중복) | -50,000 |
| 합계 | 50,000 | 50,000 ✓ |
| 행 합 | 0 ≠ 50,000 ❌ | 50,000 = 50,000 ✓ |

## AC

- AC-1: ✅ SummaryCard 행 합계 = grossTotal (환불 이중 차감 제거)
- AC-2: ✅ 실제 정산(ReconRow) NET값 유지 — 단말기 금액과 정합
- AC-3: ✅ DB 저장값(singleCard, pkgCard 등) NET 유지 — 스키마 변경 없음
- AC-4: ✅ 빌드 성공 (b8d7157, 3.44s)
- AC-5: ✅ 환불 없을 때 표시 변화 없음 (refundAmount=0 → '환불 차감' 행 숨김)

## 선행 티켓
- T-20260522-foot-CLOSING-REFUND (fab1ad6) — 이 커밋의 변경이 이중 차감 원인
- T-20260525-foot-CLOSING-SUM-ERR — 수기결제 누락 버그 (같은 세션 수정)

## 비고
- DB 변경 없음 — FE-only 수정
- staffTotals: enrichedRows 기반 독립 계산, 영향 없음
- Realtime 구독: payments/package_payments/manual 변경 감지 유지
