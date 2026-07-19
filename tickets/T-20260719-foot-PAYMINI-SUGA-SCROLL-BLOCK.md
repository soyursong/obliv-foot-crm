---
id: T-20260719-foot-PAYMINI-SUGA-SCROLL-BLOCK
domain: foot
priority: P0
hotfix: true
status: deploy-ready
qa_result: pending (supervisor 실렌더 GO 대기)
deploy_commit: c3c30d87
deployed_at: n/a (supervisor 운영배포/번들 검증 대기)
bundle_hash: PaymentMiniWindow 청크 (로컬 build ✓ — supervisor 운영배포 후 pages.dev 재검증)
db_change: false
db_migration: none
db_gate: N/A — 순수 FE 레이아웃(스크롤 소유권 이관). 신규 컬럼·테이블·enum 0. DDL 0. CONSULT/MIG-GATE 불요.
build: pass (npm run build ✓ built in 5.58s)
scenario_count: 3 (SUGA 2 PASS + SCROLL-FIX AC-3 재정합)
e2e_spec: tests/e2e/T-20260719-foot-PAYMINI-SUGA-SCROLL-BLOCK.spec.ts
spec: tests/e2e/T-20260719-foot-PAYMINI-SUGA-SCROLL-BLOCK.spec.ts
reporter: 김주연 총괄 (C0ATE5P6JTH)
branch: hotfix/T-20260719-foot-PAYMINI-SUGA-SCROLL-BLOCK
created: 2026-07-19
assignee: dev-foot
summary: 결제 미니창 수가항목 스크롤 불가→수납(btn-settle) 미도달 완전차단 P0 복구. 스크롤 소유권을 pmw-settle-lane 통합 창(sm:overflow-y-auto + min-h 200)으로 이관, 4ZONE reflow가 만든 131px 협소창 제거. FE-only, DB0.
---

## 배경 (현장)
김주연 총괄(C0ATE5P6JTH) 신고: 결제 미니창에서 수가항목(기본(진찰료)/시술내역 등) 클릭 후
하단 스크롤 불가 → '결제비 산정'/수납(btn-settle) 버튼 미도달 → **실제 수납처리 완전 차단(매출 영향)**.
총괄 명시 우선순위: item2(본건) > item1(4ZONE 시각). 기능(수납 복구)이 시각 미세조정보다 선순위.

## RC
4ZONE reflow(58f53c40/9cef7d7b): 좌측 카테고리 탭 aspect-square(w-14=56px) reflow로 code-grid 열 높이 증가
→ 중앙 세로 스택(code-grid flex-1 / feeitem-row / settle-lane flex-1)에서 settle-lane 압축.
실제 스크롤은 하단 action-buttons div(overflow-y-auto shrink min-h-0)가 소유 → 창 ~131px로 꽉 차 터치 스크롤 불가.

## Fix (FE-only, DB0)
- 스크롤 소유권을 pmw-settle-lane 통합 단일 창으로 이관: sm:overflow-y-auto + sm:min-h-[200px].
- code-grid가 min-h-0로 양보 → settle-lane 최소 높이 보장(협소창 131px 회귀 차단).
- 내부 action-buttons div 자체 스크롤(overflow-y-auto/shrink/min-h-0) 제거 → 자연 높이로 settle-lane 스크롤 편입.
- 계산 SSOT·4ZONE 정사각 탭(F0BJ87C400G) 무접촉.

## 검증 (갤탭 1280x800 landscape 실렌더)
- SUGA spec 2/2 PASS: scroll-owner=pmw-settle-lane, window=212, content=432,
  btn-settle afterScroll top=681/bottom=721(뷰포트 내 도달·클릭), cat-tab 56x56 정사각(AC4 무회귀).
- PMW-SCROLL-FIX 4/4 PASS: AC-3 신 아키텍처 정합 + seed is_simulation:true 제거(대시보드 숨김 pre-existing harness 결함 해소).
- PMW-SPLIT-PAYMENT 5/5 PASS(단독), 4ZONE-CANON-HOST-GUARD PASS.
- COPAY-BALANCE-SPLIT 실패 = 기존 CEIL→FLOOR 마이그레이션(footBilling.ts 무접촉) — 본건 무관.

## 인계
supervisor: hotfix 브랜치 → main 병합(CF Pages 자동배포) + pages.dev 실렌더 GO 후 총괄 릴레이.
anti-zombie: dev+supervisor 실렌더 GO 전 '다시 해보세요/새로고침' 총괄 릴레이 금지.
