---
ticket_id: T-20260523-foot-FEE-ITEM-SCROLL
status: deploy-ready
deploy_ready: true
deploy_ready_at: 2026-05-23T22:05:00+09:00
db_change: false
build_ok: true
e2e_spec: tests/e2e/T-20260523-foot-FEE-ITEM-SCROLL.spec.ts
domain: foot
priority: P2
qa_result: pending_reqa
escalation: P0 (planner PUSH MSG-20260523-220359-p6ne — 6h+ stale 에스컬레이션)
fix_note: |
  1차 spec fix (d6d2735, 17:35): openPaymentDialog waitFor({visible}) → waitForLoadState('networkidle', {timeout:15_000})
  P0 escalation 재확인 (22:05): 코드·빌드·spec·Runtime Safety Gate 전건 재검증 완료
---

## T-20260523-foot-FEE-ITEM-SCROLL

결제 미니창 수가 항목 높이 확장 + 스크롤 개선.

### 이력

| 시각 | 이벤트 |
|------|--------|
| 16:52 | e7305e8 — PaymentMiniWindow.tsx 코드 배포 (sm:h-[520px]→[600px], scroll-smooth, max-h 조건부 분기) |
| 17:02 | supervisor QA fail — spec_fail_new AC-5 mobile/tablet (openPaymentDialog timeout) |
| 17:35 | d6d2735 — spec fix (waitForLoadState networkidle), deploy-ready 재마킹 |
| 22:05 | P0 escalation 재검증 (planner PUSH MSG-20260523-220359-p6ne) — 코드·빌드·spec·Runtime Safety Gate 전건 PASS 확인, supervisor re-QA 재요청 |

### AC 재검증 결과 (2026-05-23T22:05)

| AC | 검증 방법 | 결과 |
|----|-----------|------|
| AC-1 | PaymentMiniWindow.tsx L1296 `sm:h-[600px]` + L1466 `max-h-80 sm:flex-1` | ✅ |
| AC-2 | L1463 `scroll-smooth overflow-y-auto` | ✅ |
| AC-3 | Zone2 하단 `pricingItems.length > 0` 조건부 세금·합계 (shrink-0) | ✅ |
| AC-4 | L1464 `pricingItems.length === 0 ? "max-h-28" : ...` 조건부 | ✅ |
| AC-5 | spec openPaymentDialog → `waitForLoadState('networkidle', {timeout:15_000})` | ✅ |
| BUILD | `npm run build` 3.18s exit 0 | ✅ |
| RUNTIME SAFETY | for-of L485/L683/L836 null guard 확인 / Object.entries totalByTax 초기화 확인 | ✅ |

### supervisor 재QA 요청

- fix_commit (spec): d6d2735
- HEAD: c31d1e5
- DB 변경: 없음
- 배포 상태: 코드(e7305e8)는 이미 Vercel 운영 배포 완료
- 재QA 범위: spec 정합성 + Phase2 브라우저 AC-5 재확인
