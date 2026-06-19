---
ticket_id: T-20260618-foot-MANUALPAY-STATS-REFLECT
id: T-20260618-foot-MANUALPAY-STATS-REFLECT
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-06-18
owner: agent-fdd-dev-foot
requester: CONNECTIVITY-AUDIT-4 #4 (planner)
approved_by: planner NEW-TASK MSG-20260618-154847-nv6k
build_ok: true
spec_added: tests/e2e/T-20260618-foot-MANUALPAY-STATS-REFLECT.spec.ts
db_changed: false
data_architect_consult: 불요 — closing_manual_payments.amount(기존 integer 컬럼) 부호로 수입/지출 해소. 신규 컬럼·테이블·enum·필드매핑 0. 신규 npm 0.
risk_level: GO (2/5 — SalesDailyTab read-only 조회 1건 추가 + 집계 합산만. payments/package_payments 기존 경로·일마감 로직 무변경)
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-18
deploy_commit: ccf421b4
commit_sha: ccf421b4
qa_result: pass
field_soak_gate: 실 Galaxy Tab 매출집계 일일결산 ↔ 일마감 동일기간 합계 일치 + 김주연 총괄 현장 confirm (최종 게이트)
---

# T-20260618-foot-MANUALPAY-STATS-REFLECT — 매출집계 수기결제 반영

## 요청 (NEW-TASK, planner P1 — MSG-20260618-154847-nv6k)

CONNECTIVITY-AUDIT-4 #4 A안 확정. 통계/매출집계 화면에서 수기결제 '지출(현금 출금)'
항목이 0으로 표시("음수 방향 구분 불가→0")되어 누락. 일마감은 정상 합산.
→ 통계 집계가 수입+지출(수동조정 포함)을 빠짐없이 합산하도록 수정.

## AC-0 진단 (read-only, 통계 집계 경로 vs 일마감 경로 차이)

- **일마감(Closing.tsx)**: `payments` + `package_payments` + `closing_manual_payments` 3종 합산.
  수기결제는 `m.amount` 직접 net 합산. 입력 폼(ManualEntryDialog)이 `amt > 0`만 허용 →
  현재 모든 closing_manual_payments.amount는 양수(수입).
- **매출집계(SalesDailyTab.tsx)**: `payments` + `package_payments`만 조회.
  `closing_manual_payments`를 **아예 조회하지 않음** → 수기결제 전액 누락.
  '지출' 카드는 line 226 주석대로 하드코딩 "—"(0).
- **통계(Stats/RevenueSection)**: `foot_stats_revenue` RPC(payments+package_payments)만.
  별도 '지출' 개념 없음 — 본 증상("음수 방향 구분 불가→0" verbatim 주석)과 무관.
- **RC**: 버그 위치는 정확히 SalesDailyTab. closing_manual_payments 미합산 → 일마감 ≠ 매출집계.

## 조치 (A안, DDL 불요)

closing_manual_payments.amount(기존 `integer` 컬럼)는 이미 부호를 보유할 수 있으므로
**기존 부호로 해소** — 신규 컬럼 불요(DA CONSULT 불요, ADDITIVE 아님/스키마 무변경):

- SalesDailyTab에 `closing_manual_payments`(close_date 기준 [from,to]) 조회 추가.
- 좌측 발생기준 매트릭스: tax_type 없음 → 면세(비급여) 보수 분류, amount 부호 그대로 net 합산.
- 우측 수납수단×세금속성 매트릭스: method → 행, 면세 열에 amount 합산.
- 현금 시재: 당일 현금수납 = 결제 현금 net + 수기 현금 수입(양수).
  지출 = 수기 현금 출금(음수 amount 절댓값 합). 잔액 = 이월 + 수납 − 지출.
- '지출' 카드에 `data-testid=sales-daily-cash-expense` 부여 + 부호 기반 표시.

## AC 충족

- [x] 동일기간 일마감 합계 = 매출집계 합계 정합 (3종 동일 소스 합산).
- [x] 통계 기존 정상항목 회귀 0 (payments/package_payments 경로 무변경, 수기 순수 additive).
- [x] 일마감 기존 합산 무변경 (Closing.tsx 미변경).
- [x] build green / tsc clean.
- [x] E2E spec 4종 추가 (지출 testid·회귀 testid·조회경로·빈상태).

## 산출

- commit ccf421b4 — src/components/sales/SalesDailyTab.tsx
- tests/e2e/T-20260618-foot-MANUALPAY-STATS-REFLECT.spec.ts
- DB 변경: 없음

> field-soak: 실 Galaxy Tab에서 매출집계 일일결산과 일마감의 동일기간 합계 일치 +
> 김주연 총괄 현장 confirm 후 done.
