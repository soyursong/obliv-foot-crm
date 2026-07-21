---
ticket_id: T-20260721-foot-CHARTPAGE-SOFTVOID-PAYMENT-PHANTOM
id: T-20260721-foot-CHARTPAGE-SOFTVOID-PAYMENT-PHANTOM
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-07-21
owner: agent-fdd-dev-foot
requester: planner (cross-CRM 확진 팬아웃 — scalp2 b8c26148 하드포크 계보)
approved_by: planner NEW-TASK MSG-20260721-202009-mhqn
build_ok: true
spec_added: tests/e2e/T-20260721-foot-CHARTPAGE-SOFTVOID-PAYMENT-PHANTOM.spec.ts
db_changed: false
data_architect_consult: N/A — 코드 전용(신규 컬럼·테이블·enum 0). payments.status 컬럼은 기존(migration 20260514000010, prod 적용필) 재사용. §S2.4 데이터정책 게이트 미트리거.
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-07-21
commit_sha: __FILL_AFTER_COMMIT__
precondition_check: prod schema_migrations 20260514000010(payment_edit_cancel_delete) 적용 확인 — payments.status 컬럼 PRESENT(probe OK), 분포 active=155/cancelled=0/deleted=4/null=0. deleted 4행이 현행 유령합산 대상.
axis_note: payments.status(고객차트 축). closing_manual_payments.voided_at(SOFTVOID-INFRA, deployed 63271dfd)와 다른 테이블 — 혼동 금지. 본 티켓은 payments.status 축만 교정.
---

# T-20260721-foot-CHARTPAGE-SOFTVOID-PAYMENT-PHANTOM — payments.status 유령수납 고객차트 합산 교정

## 배경 (cross-CRM 확진 팬아웃)

scalp2(deployed b8c26148) 하드포크 계보 동일버그를 planner가 foot 레포 대조로 실재 확진.
CustomerChartPage 가 payments 를 **무필터**로 조회 → `status IN('cancelled','deleted')` 유령행이
totalPaid / feePayments 합산·표시에 혼입.

## RC

- `src/pages/CustomerChartPage.tsx:3208` (초기로드) — `.from('payments').select('*').eq('customer_id',…)` **status 무필터**
- `src/pages/CustomerChartPage.tsx:3350` (refreshPayments) — 동일 무필터
- `payments` state → `totalPaid`(L5432) + `feePayments`(L6653) 합산/표시에 유령행 포함
- 정상수납값 = `'active'` (migration 20260514000010: `CHECK status IN ('active','cancelled','deleted')` DEFAULT 'active')

## 수정 (fail-closed allow-list `.eq('status','active')`)

**Payment TS 타입**
- `interface Payment` 에 `status?: 'active'|'cancelled'|'deleted'|null` 필드 추가 (CustomerChartPage.tsx:154)

**무필터 조회 전수 grep 교정** (payments.status 고객차트 축)
1. `CustomerChartPage.tsx:3208` (초기로드) → `.eq('status','active')` — **PRIMARY**
2. `CustomerChartPage.tsx:3350` (refresh) → `.eq('status','active')` — **PRIMARY**
3. `Customers.tsx:139` (고객목록 누적수납 합산) → `.eq('status','active')`
4. `Dashboard.tsx:4243` (내원별 당일 수납맵) → `.eq('status','active')`
5. `TreatmentStatusPanel.tsx:182` (치료칸반 내원별 수납) → `.eq('status','active')`
6. `autoBindContext.ts:526` (문서 자동바인딩 수납총액) → `.eq('status','active')`

→ totalPaid/feePayments 는 `payments` state 파생이므로 쿼리 교정으로 자동 정합.

## 스코프 밖 / 의도적 제외

- **매출집계 축(Sales/Closing/DailyHistory/Dashboard 매출 리포트)** — 이미 `.neq('status','deleted')` 또는 status select 후 client 필터로 **status-aware**. 무필터 아님 → 본 sweep 대상 아님. (revenue-report 축, payments.status 고객차트 축과 직교)
- **deny-list 표시 read**(`CheckInDetailSheet.tsx:718`, `DocumentPrintPanel.tsx:696` = `.neq('status','deleted')`) — status 를 select·표시하며 deleted만 배제(cancelled 는 라벨과 함께 표시 의도 가능). 무필터 아님 + 표시-only → 미변경.
- **MedicalChartPanel.tsx:1007** (무필터·payment_type='payment' 합산) — §11 진료관리(의사 전용) 화면 → `medical_confirm_gate` 대상. **본 티켓 미착수**, planner FOLLOWUP(`medical_confirm_pending`)로 별도 게이트 요청.

## 검증

- `npm run build` OK
- spec 4 시나리오 PASS (active-only 정합 / 회귀-무필터 유령재현 / fail-closed(cancelled·deleted 양배제) / sweep 축)
- 회귀: PAYMENT-EDIT-CANCEL-DELETE 전 케이스 PASS. C2-PAYMENT-SYNC 3건 실패는 **본 변경 무관**(spec 자체 seed 의 check_ins.customer_name NOT NULL 픽스처 rot, 선재존재).

## 조율 노트

- payments.status 축 ≠ closing_manual_payments.voided_at 축(SOFTVOID-INFRA-FWD-PRIMITIVE, deployed 63271dfd). 다른 테이블·다른 무효화 메커니즘. 혼동 금지.
