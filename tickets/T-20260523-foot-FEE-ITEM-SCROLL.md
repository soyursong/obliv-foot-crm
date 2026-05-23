---
ticket_id: T-20260523-foot-FEE-ITEM-SCROLL
status: deploy-ready
deploy_ready: true
deploy_ready_at: 2026-05-23T17:35:00+09:00
db_change: false
build_ok: true
e2e_spec: tests/e2e/T-20260523-foot-FEE-ITEM-SCROLL.spec.ts
domain: foot
priority: P2
qa_result: pending
fix_note: spec fix MSG-20260523-170227-62gm — openPaymentDialog networkidle
---

## T-20260523-foot-FEE-ITEM-SCROLL

결제 미니창 수가 항목 높이 확장 + 스크롤 개선.

- 코드 commit: e7305e8 (CSS PaymentMiniWindow.tsx, 이미 배포됨)
- spec fix: openPaymentDialog waitFor(visible) → waitForLoadState(networkidle)
  - 모바일/태블릿 viewport 사이드바 collapsed → hidden span timeout 해소
