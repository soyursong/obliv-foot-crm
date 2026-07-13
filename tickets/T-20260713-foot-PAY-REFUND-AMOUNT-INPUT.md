---
id: T-20260713-foot-PAY-REFUND-AMOUNT-INPUT
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-07-13
completed: 2026-07-13
db_changed: false
e2e_spec: tests/e2e/T-20260713-foot-PAY-REFUND-AMOUNT-INPUT.spec.ts
risk_verdict: GO_WARN
risk_reason: "금전경로(환불) FE-only carve-out. 수납 환불(ClosingRefundDialog) 단건(source=payment) 경로의 편집 가능 금액 필드는 기존에도 존재(기본값=원 수납금액, 수정 가능) — 이번 변경은 (a) 실시간 인라인 검증(singleAmtError) 도입으로 빈값/0/음수(입력단계 strip)/원금초과를 즉시 인라인 에러+제출('환불 확인') 비활성으로 차단, (b) E2E 타깃 testid 5종 추가(refund-open-btn/closing-refund-dialog/refund-amount-input/refund-amount-error/refund-submit). 제출 시점 기존 toast 가드(amt<=0, amt>row.amount)는 belt-and-suspenders로 유지. 서버검증(refund_single_payment RPC: 0<amt<=원금)·payments 스키마·집계 로직 전부 무변경. refund_amount 전용 컬럼 부재 = 환불은 payment_type='refund' 별도 행, 검증기준은 payments.amount → 스키마/RPC/migration 0(CRM-PREGATE schema 무접점). 패키지 환불(source=package)은 세션기반 자동견적(read-only, refund_package_atomic RPC 재계산)으로 범위 외 — planner FOLLOWUP로 분리 통지. 빌드 OK, typecheck OK, 신규 spec desktop-chrome 6/6 green(실브라우저 단건 다이얼로그 원금=313370 부분/전액/엣지 전건 + 소스가드 + 순수로직) + 기존 CLOSING-REFUND spec 16/16 무회귀."
author: dev-foot
build_verified: "2026-07-13 — npm run build → ✓ built in 5.75s; tsc -b --noEmit clean"
commit: f6277769
---

# T-20260713-foot-PAY-REFUND-AMOUNT-INPUT

## 화면 / 현상
- 화면: obliv-foot-crm 일마감(/admin/closing) > 결제내역 탭 > 환불 처리 다이얼로그(ClosingRefundDialog)
- 요구(김주연 총괄 확정): "일부 금액만 환불 하는 경우 당연히 있지" → 부분(일부) 금액 환불 필수. 전액 + 부분 모두 지원.
  - 환불 버튼 클릭 시 금액 입력 필드 표시, 기본값=수납 원금액 자동 표시(수정 가능).
  - 검증: 1원 ≤ 환불액 ≤ 수납금액 (최소 1원, 원금 초과 차단, 빈값/0/음수 에러).

## 진단 (spec discovery, read-only)
- 단건 환불(source=payment) 경로는 이미 편집 가능 `AmountInput`(기본값 `String(row.amount)`) 보유 + 제출시 검증(amt<=0, amt>원금 toast) 존재.
- `payments` 테이블에 `refund_amount`(상당) 전용 컬럼 **없음** — 환불은 `payment_type='refund'` 별도 행으로 저장, 검증 기준은 `payments.amount`. → **신규 컬럼/제약 불필요 = db_changed:false** (CRM-PREGATE schema 무접점).
- 서버검증: `refund_single_payment(p_amount)` RPC 가 `0 < p_amount <= 원결제.amount` 강제.
- 갭: 검증이 제출 시점 toast 로만 동작 → 금전경로 안전성 위해 실시간 인라인 차단으로 강화.

## 구현
- `src/pages/Closing.tsx` ClosingRefundDialog:
  - `singleAmtError` 도출(실시간): 빈값/0/음수(strip)/원금초과 → 인라인 에러 문구, 아니면 null.
  - 단건 금액 필드에 인라인 에러 표시 + 입력 border-destructive, '환불 확인' 버튼 `disabled`에 `!!singleAmtError` 반영.
  - testid 추가: `refund-open-btn`, `closing-refund-dialog`, `refund-amount-input`, `refund-amount-error`, `refund-submit`.
- 기존 제출시 toast 가드 유지(belt-and-suspenders). 패키지 환불 경로/자동견적 무변경.

## AC
- AC-1: 환불 버튼 클릭 → 금액 입력 필드 노출 (단건).
- AC-2: 기본값 = 원 수납금액 자동 표시 + 수정 가능.
- AC-3: 부분(일부) 금액 환불 허용 (1원 ≤ 액 < 원금).
- AC-4: 전액 환불 허용 (액 == 원금).
- AC-5: 빈값/0/음수/원금초과 → 인라인 에러 + 제출 비활성.

## 검증
- npm run build ✓ / tsc -b --noEmit ✓
- E2E desktop-chrome: 신규 spec 6/6 PASS(실브라우저 단건 다이얼로그 원금=313,370 부분/전액/엣지 전건 + 소스가드 + 순수로직), 기존 T-20260522-foot-CLOSING-REFUND 16/16 무회귀.

## 범위 외 (planner FOLLOWUP)
- 패키지 환불(source=package) 금액은 세션기반 자동견적(read-only). 이를 편집 가능하게 하려면 `refund_package_atomic` RPC 변경 필요 = schema/RPC 접점 → 총괄 선승인 대상. 본 티켓 FE carve-out 범위 밖.
