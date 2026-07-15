---
id: T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC
domain: foot
priority: P0
status: deploy-ready
qa_result: pass
deploy_commit: d21157ee
deployed_at: n/a (supervisor QA→운영배포 대기)
bundle_hash: PaymentMiniWindow-f9V5CHB8.js (로컬 build 산출 — 운영배포 후 재검증)
db_change: false
db_migration: none
db_gate: N/A — 순수 FE 레이아웃(class 변경). 신규 컬럼·테이블·enum 0. DDL 0. CONSULT/MIG-GATE 불요.
build: pass (npm run build ✓ built in 5.47s)
scenario_count: 1 (AC1+AC2+AC3+AC4 통합 — 좌측탭 정사각형·컴팩트 + 사이드메뉴 무변경 + ②③④ zone reflow 0)
e2e_spec: tests/e2e/T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC.spec.ts
spec: tests/e2e/T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC.spec.ts
created: 2026-07-15
completed: 2026-07-15
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (NEW-TASK MSG-20260715-124403-szex) / 현장 김주연 총괄
branch: ticket/T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC
reconfirm_gate: true (4구역 URL 총괄 ✅ 후 closed)
---

# T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC — 결제 미니창 4구역 최종 스펙 ① 좌측 탭 컴팩트/정사각형

## 요청 (P0, planner)
총괄 결제 미니창(PaymentMiniWindow) 4구역 최종 스펙 확정. **본 티켓 실 구현 = ① 좌측 탭 컴팩트/정사각형뿐** (②③은 위임, ④ 무작업).

좌표 정본 = 색박스 주석 스샷 **F0BJ87C400G**
`~/file_inbox/20260715/122218_F0BJ87C400G_20260715_122002.png`
(🔴좌측 항목메뉴 / 🟢차트코드·진료비산정 / 🔵세금구분·수납잔액 / 🟣우측 유지)

## 구현 (①만)
- **AC1**: 좌측 카테고리 탭(기본(진찰료)/시술내역(풋케어)/수액/화장품, `FOOTCARE_CATS`) = 공간 최소(컴팩트) + 정사각형.
  - 구: 가로 pill `px-2 py-1 text-xs rounded ... min-h-[44px]` (텍스트폭 가변) → 신: 소형 정사각형 `aspect-square w-14`(56×56px) + 텍스트 span(`text-[10px] leading-tight line-clamp-3`).
  - 하단 코드 카드(`aspect-square`, L2197)와 시각 정합 → AC4.
  - `data-testid="pmw-footcare-cat-tabs"`/`pmw-footcare-cat-tab` 추가(E2E 훅).
- **AC2**: 좌측 사이드 메뉴(상병코드/처방약/풋케어 세로 나열) = 무변경 (TAB_LABELS 블록 무접촉).
- **AC3(회귀 가드)**: ① 변경은 code-grid 열(`pmw-code-grid`) 내부 class 에 국한 → ②차트코드행(`pmw-feeitem-row`)·③세금/수납잔액(`pmw-settle-lane`)·④우측(`pmw-zone3`) reflow **0**.
  - E2E 실측: fee-row(x=213, y=413, w=710, **h=38** 컴팩트 한 줄) — RECONCILE 착지 baseline과 동일. 중앙 세로 스택(grid→fee→settle @x=213) + zone3 우측 컬럼(@x=923) 유지.
  - `pmw-zone3` testid 추가(우측 컬럼 좌표가드용, 순수 attribute — reflow 무영향).
- **AC4**: 4구역 전체 스샷 시각 일치 — evidence 스크린샷 저장(`test-results/qa_evidence/T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC/`).

## 위임 (재구현 금지)
- ② 차트코드·진료비산정 = T-20260715-foot-PAYMINI-CHARTFEE-ROW-RESTORE (deploy-ready).
- ③ 세금구분+수납잔액 = T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT (deployed·QA, origin/main 반영 — 클린 base).
- ④ 우측 = 무작업.

## clean base 시퀀싱
동일 표면 in-flight(②/③) reflow 무접촉 clean base 확보 위해 **origin/main** 에서 신규 브랜치 분기(diverged ROW1-DUP 브랜치 = ③ 구버전 stale → 회피). 좌측 탭만 수정.

## E2E / 빌드
- build: `npm run build` ✓ (5.47s).
- E2E: `tests/e2e/T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC.spec.ts` — **2 passed** (setup + desktop-chrome).
  - AC1: cat-tab[0..3] 전부 **w=56 h=56**(정사각형 |w−h|≤6, 컴팩트 ≤64, 터치 ≥40).
  - AC2: 상병코드/처방약/풋케어 사이드 메뉴 3버튼 존재.
  - AC3: grid/fee/settle @x=213 세로 스택 + zone3 @x=923 우측 + fee h=38 컴팩트 불변.

## 회귀 노트 (supervisor 참고)
`T-20260713-foot-COLORBOX-POSITION-RECONCILE.spec.ts` 는 FAIL 하나 **본 변경과 무관·pre-existing**:
- RC = 해당 spec AC-4 총합대사 regex `/급여(?!\s*자부담)/` 가 ③ COPAY-BALANCE-SPLIT REOPEN#5 의 `급여 자부담(30%)` relabel 을 배제 → taxSum=0.
- **검증**: 본 커밋 stash 후 clean origin/main 에서 동일 FAIL 재현 확인(내 코드 미포함 상태). 좌표 assert(grid/fee/settle 위치·fee h=38)는 전부 PASS.
- 조치 필요 시 ③/CHARTFEE 담당 라인에서 spec 정정(본 티켓 범위 아님).

## 후속
- supervisor QA(AC3 reflow 회귀 필수) → 운영배포 → 4구역 URL 총괄 ✅ 후 `closed` (reconfirm_gate).
