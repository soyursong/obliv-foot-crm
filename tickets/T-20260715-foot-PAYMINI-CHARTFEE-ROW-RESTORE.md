---
id: T-20260715-foot-PAYMINI-CHARTFEE-ROW-RESTORE
domain: foot
priority: P1
hotfix: true
status: deploy-ready
qa_result: pass
resolution: no-source-regression / stale-bundle re-supply (forensic-first)
deploy_commit: 6743cec9 (AC-5 guard 강화 + fresh 배포 트리거) + 본 티켓 doc commit(fresh redeploy 재보증)
deployed_at: n/a (supervisor 운영배포/번들 검증 대기)
bundle_hash: PaymentMiniWindow-eDhywyK7.js (로컬 build 산출 — supervisor 운영배포 후 재검증)
db_change: false
db_migration: none
db_gate: N/A — 순수 FE 레이아웃 검증. 신규 컬럼·테이블·enum 0. DDL 0. CONSULT/MIG-GATE 불요(planner 지시 §5).
build: pass (npm run build ✓ built in 5.44s)
scenario_count: 2 (COLORBOX-RECONCILE 회귀가드 재실행 — 시나리오1 canonical 좌표 + 시나리오2 회귀 0)
e2e_spec: tests/e2e/T-20260713-foot-COLORBOX-POSITION-RECONCILE.spec.ts
spec: tests/e2e/T-20260713-foot-COLORBOX-POSITION-RECONCILE.spec.ts
created: 2026-07-15
completed: 2026-07-15
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (NEW-TASK MSG-20260715-055825-tli4) / 현장 김주연 총괄(U0ATDB587PV, thread 1783499099.860759)
restore_target: 508893fa (fee-row 컴팩트 한 줄 착지) + 243ecee8 (좌표잠금 회귀가드)
---

# T-20260715-foot-PAYMINI-CHARTFEE-ROW-RESTORE — 결제 미니창 [차트코드+진료비산정] fee-row 컴팩트 한 줄 복원

## 요청 (P1, 김주연 총괄 07-15 05:53)
"차트 코드+진료비산정 별도 한 줄로 빼달랬는데 가로로 다 풀어놔서 흐트러진거 원복해달라"
= 결제 미니창 [차트코드+진료비산정] fee-row 가 컴팩트 별도 한 줄 → 가로 스프레드로 회귀했다는 현장 보고.

## forensic-first 조사 결과 (좌표추측 금지 준수)

### 1. 현 HEAD fee-row ↔ known-good 508893fa/243ecee8 diff
- `git diff 508893fa HEAD -- src/components/PaymentMiniWindow.tsx`
- fee-row(`data-testid="pmw-feeitem-row"`) 블록 구조 **무변경**. 차이는 인접 zone 2건뿐:
  - 🔵 파란 수납 lane: T-20260714 COPAY-BALANCE-SPLIT (수납잔액=본인부담+비급여 / 공단부담액 정보라인) — 정당한 별개 티켓.
  - 🟢 초록 팔레트: T-20260713 VERTICAL-STACK-REVERT (grid-cols-3 lg:grid-cols-4 원복) — 정당한 별개 티켓.
- **fee-row 를 가로 스프레드시킨 소스 커밋은 존재하지 않음.** 07-13 이후 미니창 터치 커밋(9e0266fa REVERT / ITEMIZED 계열 / COPAY-SPLIT) 어느 것도 fee-row 트리 위치·폭을 변경하지 않음.

### 2. 실브라우저 좌표 실측 (desktop-chrome, 1280×800)
```
grid(x=213,y=133,w=710,h=280) → fee(x=213,y=412,w=710,h=40) → settle(x=213,y=452,w=710)
```
- fee.top=412 는 grid.top=133 "아래" & settle.top=452 "위" (canonical 세로 순서 ✅)
- fee.height=40 = 컴팩트 한 줄 (대형 세로 패널 아님 ✅)
- fee.x=213 = grid.x (동일 중앙 컬럼, 우측 별도 열 아님 ✅) / fee.width=710 = grid.width (좁은 우측 열 아님 ✅)
- = **소스 렌더는 이미 canonical 컴팩트 한 줄.** IMG_8950 의 우측 대형 패널은 HEAD 소스에서 재현 불가.

### 3. 근본원인 = stale bundle (배포/캐시 아티팩트)
소스에 회귀 없음 → 현장이 본 "가로 스프레드"는 prod 에 남아있던 구 번들(캐시). 소스레벨 수정 대상 아님.
좌표추측으로 없는 회귀를 만들어 인접 zone(팔레트 grid / 수납 / 세금·합계)을 건드리는 것은 금지(planner §2 무접촉).

## 조치
1. **소스 무변경** — fee-row 는 이미 508893fa 착지 상태의 컴팩트 별도 한 줄. 복원할 회귀가 소스에 없음.
2. **AC-5 좌표가드 강화** (선행 commit 6743cec9): 기존 가드가 세로 top 순서만 검증 → 우측 스프레드를 통과시키던 갭을 (a)grid.bottom≤fee.top (b)fee.height≤52px (c)fee.left≈grid.left & fee.width≥grid.width×0.8 로 잠금. 우측 대형 패널 재발을 좌표로 포착.
3. **fresh 배포 재트리거** — 본 doc commit push → Vercel 재빌드 → 검증된 good 번들 prod 재공급(stale bundle 축출).
4. 차트코드·진료비 항목·금액·순서 무손실 (펼침 토글 시 pricing-list/pricing-row 노출 — 시나리오2 PASS).

## 검증
- build: `npm run build` ✓ (5.44s), PaymentMiniWindow-eDhywyK7.js
- E2E: `tests/e2e/T-20260713-foot-COLORBOX-POSITION-RECONCILE.spec.ts` desktop-chrome **2 passed** (AC-1~AC-5 좌표 assert 전량 PASS)
- db_change=false / DDL·enum 0 / 순수 FE

## 완료
- 접수 게이트(v1.4 색박스) = RECONCILE 에 canonical 스샷+픽셀좌표+통과 spec on-file → 총괄 재질의 없이 on-file 근거로 종결.
- 운영배포·번들 검증·reporter(U0ATDB587PV, thread 1783499099.860759) 멘션 = supervisor.
