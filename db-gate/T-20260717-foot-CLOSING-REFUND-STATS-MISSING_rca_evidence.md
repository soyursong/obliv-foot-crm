# T-20260717-foot-CLOSING-REFUND-STATS-MISSING — RCA 증거

- 작성: dev-foot · 2026-07-17
- 유형: RCA (NON-MUTATING, prod read-only) — 코드 변경 없음
- 재현 케이스(현장 김주연 총괄): 차트 **F-4840 / 홍미옥 / 환불 350,000 / 발생 2026-07-17**
- 프로브 스크립트: `scripts/T-20260717-CLOSING-REFUND-STATS_rca.mjs`

## 확인 포인트별 판정

| 포인트 | 판정 | 근거 |
|--------|------|------|
| (a) 결제내역 탭 목록 미표시 | **재현 안 됨 (정상)** | 환불행 c0c67cbe 존재·윈도우내·clinic일치 |
| (b) 매출 합계 미차감 | **재현 안 됨 (정상)** | `refundPkgAmount`가 차감, grossTotal=NET |
| (c) 담당자별 매출 미차감 | **재현됨 — foot_stats_consultant** | 패키지 미연결 check_in → 통째 누락 |

## 사실(prod 실데이터)

홍미옥(cust `e2e1fa00…`, clinic `74967aea` jongno-foot) — package_payments:
- refund 350,000 card `2026-07-17T02:31:25Z` (id `c0c67cbe…`, parent `fca391cd…`)
- payment 350,000 card `2026-07-17T02:29:00Z` ×3 (수기 재업로드, "실결제 환불처리(오류)되어 수기 재업로드" 메모)

## (a)(b) — 일마감 결제내역 탭 (`src/pages/Closing.tsx`)

- FE 쿼리(package_payments, clinic + created_at∈[7/17 00:00~23:59 KST])를 **동일 재현** → 환불행 **YES 포함**(9건 중 1건).
- `dayBoundsISO('2026-07-17')` = `T00:00:00+09:00`~`T23:59:59+09:00`. 환불 02:31Z(11:31 KST) → **윈도우 내**.
- 리스트/합계/담당자별은 전부 **live react-query 결과**로 계산(daily_closings 저장 payload는 actual 입력 필드 초기화용일 뿐 — L532~544). 마감확정(closed)이어도 리스트는 live.
- enrichment(L757~785): pkg refund → `source='package', payment_type='refund'`, staff=`customers.assigned_staff_id`(엄경은). 리스트에 **표시됨**.
- totals(L652~657): `refundPkgAmount`에 합산 → grossTotal(NET) **차감됨**.
- staffTotals(L843): refund는 `-amount`로 **차감됨**.
- ∴ 결제내역 탭 코드경로에는 결함 없음. 현장 관측은 (i) 11:31 KST 환불 기록 이전 조회한 타이밍 아티팩트, 또는 (ii) 아래 (c) 사이드바/매출통계 화면과의 혼동으로 추정.

## (c) — 담당자별 매출 = `foot_stats_consultant` RPC (사이드바/매출통계 탭)

- 최신 def: `supabase/migrations/20260622210000_foot_stats_consultant_total_amount.sql`
- 귀속 모델이 결제내역 탭과 **근본적으로 다름**:
  - Closing.tsx: **결제행 created_at 날짜 + customers.assigned_staff_id**
  - foot_stats_consultant: **check_in.checked_in_at 날짜 + check_ins.consultant_id**, pkg_rev는 패키지의 모든 payment/refund 합산(L64, L77~84)
- 결정적 사실: package `5ac32b4a`의 **check_ins = 0건**. pkg_once/pkg_rev는 ticketed check_in 연결이 전제 → **이 패키지의 결제·환불 전부가 어떤 상담사에도 귀속되지 않음(통째 누락)**.
- 실행 확인: `foot_stats_consultant(jongno-foot, 2026-07-17, 2026-07-17)` → 홍미옥 담당(엄경은 b311593d) 포함 전원 `total_amount=0`. 환불(−350,000)도, 원결제도 반영 안 됨.
- ∴ (c) 미차감 RC = check_in-centric 귀속 모델의 구조적 한계. **DAYCLOSE-VS-SIDEBAR-MGRSTAT-RECONCILE(foot_stats_consultant RPC 재설계)와 동일 코드경로.**

## 결론 / 다음 조치

- (a)(b): 결제내역 탭 코드 정상 — 별도 패치 불요.
- (c): foot_stats_consultant 재설계 티켓과 **동일 코드경로** → 독립 패치 시 충돌. MQ 지시대로 **planner FOLLOWUP으로 조정**(reconcile 티켓에 본 재현 케이스 fold).
- 부수 관측(데이터 위생): 홍미옥 패키지에 350,000 payment 3건 중복 수기 재업로드 + check_in 미연결 → 데이터 정정 필요 여부는 planner/현장 판단 대상(코드 아님).
