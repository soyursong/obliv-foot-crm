# T-20260821-foot-CLOSING-BYDATE-TOTAL-SALES-10K-MISMATCH-DIAG — 진단 증적

**작성:** dev-foot / 2026-08-21 · **유형:** DIAG (write0/DDL0, read-only census, service_role)
**DB:** rxlomoozakkjesdqjtvd (obliv-foot-crm) · **clinic:** 74967aea (오블리브의원 서울 오리진점=종로) · **날짜:** 2026-08-20

## 결론 (DoD)

**delta 10,000원을 만드는 정확한 행 = 수기결제(closing_manual_payments) 1건.**
축(axis)은 parent seed-3(created_at↔accounting_date date-axis)가 **아님** → **source-set(surface-scope) 비대칭**.
→ **독립 결함. parent 흡수 아님. fix 승격 권고.**

## 실측 (read-only census)

| surface | 값 | 소스/산식 |
|---|---|---|
| A = [총 매출] 탭 › 일자별 매출(08-20 행) | **59,473,600** | `fetchMonthlyComparison`→`foot_stats_revenue` RPC = payments+package_payments(accounting_date, 진성건) net. **수기결제 미포함** |
| B = 일마감 결제내역 탭(08-20) | **59,483,600** | Closing.tsx grossTotal = payments+package_payments(created_at) net **+ closing_manual_payments** |
| **Δ (B−A)** | **+10,000** | = 정확히 수기결제 1건 |

- `B_noManual − A = 0` → **created_at↔accounting_date 축 기여 = 0** (08-20에서 두 축이 day-total 동일). delta 전부 수기결제.
- 신고 수치 정합: 총괄 "실 매출 59,483,600(=B)" / "총매출 일자별 59,473,600(=A)" 와 실측 완전 일치.

## 원인 행 (evidence)

```
closing_manual_payments
  id            : 627b9d1c-92df-4f28-83fb-16eb51d54a6f
  close_date    : 2026-08-20   pay_time: 20:31
  고객          : 손연주 (F-7001), TM/신규, 등록=데스크
  amount        : 10,000   method: card   memo: (없음)
  voided_at     : null  (정상·유효)
```

## Root cause (surface-scope 비대칭)

`closing_manual_payments`(수기결제)는:
- **결제내역 탭 grossTotal 에 포함** (Closing.tsx §합계 계산, `manualEntries` UNION)
- **총 매출 탭 §01 카드(급여/비급여)에도 포함** (`mtmSales.fetchMtmCardMetrics` L192–205, 비급여 UNION)
- 그러나 **총 매출 탭 §02 일자별 매출 비교표에는 미포함** (`fetchMonthlyComparison`→`foot_stats_revenue` RPC 는 payments/package_payments 만 read, 수기결제 무접촉)

→ 같은 '총 매출' 탭 내부에서도 §01 카드(수기 포함) vs §02 일자별표(수기 미포함) **내부 불일치** 존재. 총괄 판단대로 결제내역(B)=실매출 정답, **일자별표(A)가 수기결제만큼 과소집계**.

## Parent 관계 판정

- parent T-20260820-foot-CLOSING-SALES-BASIS-FIX seed-3 = date-axis(created_at vs accounting_date). 본 건은 축 기여 0 실증 → **seed-3 아님**.
- C/A/B(환불기준·현금표시·귀속축)와도 무관한 별개 surface·별개 mechanism → **독립 결함**.

## Fix 권고 (money-path → supervisor code-gate 별도)

- **방향:** FE-only, `db_change=false` 우선. `mtmSales.fetchMonthlyComparison`/`netByDay` 에 `closing_manual_payments`(close_date grain, voided 제외) per-day 오버레이 추가 → §01 카드 포함기준과 parity.
- **금지:** `foot_stats_revenue` RPC 변경 = 지양(foot/women/body/scalp2 공유 cross-CRM RPC → blast radius). FE 오버레이가 안전.
- money-path → supervisor code-gate 별도 진행.
