---
id: T-20260719-foot-PAYMINI-SUGA-SCROLL-BLOCK
domain: foot
priority: P0
hotfix: true
status: deploy-ready
qa_result: pending (supervisor 실렌더 GO 대기)
deploy_commit: 938bae6d
ceo_decision: MSG-20260719-163833-jksb (형 직접) — 스크롤 복원 유지 + ★AC-4(4ZONE 정사각 canon 회귀금지) 잠정 해제 + AC-3 RC 명시
ac4_status: 잠정 해제 (canon 보존 의무 OFF — canon 회귀 이유로 스크롤 fix 막지 않음). 현 fix는 canon 무접촉으로도 스크롤 복원 달성(cat-tab 56x56 유지) → 해제 활용 불요.
ac3_rc: 수납금액=footBilling SSOT(computeFootBilling) 소비만(PMW 병렬재계산 無, line 1491 가드). 스크롤 fix는 순수 CSS(settle-lane)로 계산경로 무접촉 → 스크롤 여파 아님. 유일 금액 불일치=COPAY-BALANCE-SPLIT spec의 stale 기대(CEIL 8,900) vs 현 runtime FLOOR 8,800(revenue_insurance_split_spec §2-2 v1.12, T-20260715 이미 land). 즉 계산버그 아님·산식 재수정 불요 → 산식 FOLLOWUP 없음(stale spec fixture는 CEIL→FLOOR 마이그 소유).
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

## CEO 결정 반영 (MSG-20260719-163833-jksb / PUSH MSG-20260719-164531-eon2)
1. **스크롤 복원 유지** — 매출차단 최우선. 현 fix(c3c30d87) 실렌더 SUGA 2/2 PASS로 복원 확정(scroll-owner=pmw-settle-lane, window 212, btn-settle top=681 뷰포트 도달).
2. **★AC-4 잠정 해제** — 4ZONE 정사각 canon(F0BJ87C400G) 보존 의무 OFF. 단, 현 fix는 canon 무접촉으로 스크롤 복원을 이미 달성(cat-tab 56x56 유지 실측) → 좌측 탭 레이아웃 변경 없이 목표 충족. canon 회귀를 이유로 fix를 막지 않았음(막을 일 없었음). 4ZONE 좌측 탭 정합성은 총괄 재확정 스펙 이후 별도 티켓.
3. **AC-3 RC 명시** (frontmatter ac3_rc 참조) — 수납금액 오류는 (a) 스크롤 여파 아님(fix=순수 CSS, 계산경로 무접촉), (b) 계산버그 아님(PMW=footBilling SSOT 소비, 병렬재계산 無). runtime 자부담 8,800(FLOOR, 정합) — 과거 8,900(CEIL)는 T-20260715 CEIL→FLOOR 확정 마이그로 대체됨. **산식 재수정 불요 → planner 산식 FOLLOWUP 없음.** (COPAY-BALANCE-SPLIT spec의 stale 8,900 기대는 CEIL→FLOOR 마이그 소유 fixture-lag, 본건 무관.)

## 추가 harness fix (938bae6d, test-only)
PMW-SCROLL-FIX cleanupSeed 결정론 복구: c3c30d87가 seed에서 is_simulation:true 제거했으나 cleanupSeed 필터는 미갱신 → 재실행마다 중복키 시드실패(4-fail). phone+name 교집합 cleanup으로 교체. **연속 2회 재실행 5 passed 결정론 확인.** 프로덕션 코드 무접촉.

## 검증 (재확정, 갤탭 1280x800 landscape 실렌더 재측정)
- SUGA spec **2/2 PASS**: scroll-owner=pmw-settle-lane, window=212, content=432, btn-settle afterScroll top=681/bottom=721(뷰포트 도달·클릭), cat-tab 56x56 정사각.
- PMW-SCROLL-FIX **5 passed(AC1~5, 연속 2회 결정론)**: AC-3 신 아키텍처(settle-lane 소유자 ≥180px) 정합.
- build ✓ (5.32s).

## 인계
supervisor: hotfix 브랜치 → main 병합(CF Pages 자동배포) + pages.dev 실렌더 GO 후 총괄 릴레이.
anti-zombie: dev+supervisor 실렌더 GO 전 '다시 해보세요/새로고침' 총괄 릴레이 금지.
