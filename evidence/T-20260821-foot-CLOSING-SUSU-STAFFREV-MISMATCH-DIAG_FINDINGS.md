# T-20260821-foot-CLOSING-SUSU-STAFFREV-MISMATCH-DIAG — 진단 결과 (read-only)

**결론: RC 확정 = PostgREST 1000행 페이지네이션 cap 절단. 원 3가설(H1/H2/H3) 전부 무기여(0). db_change 불필요(FE read-path 페이지네이션 누락).**

## 신고
- 김주연 총괄(2026-08-21): 일마감 '수납내역' 강경민 상담실장 **16,057,900원** ↔ 일마감>총매출>담당실장별 **303,500원** = delta **15,754,400원**.
- 대상: 오블리브의원 서울 오리진점(jongno-foot, `74967aea`). 강경민 = consultant `6ab26d9f`.

## 표면 대조 (surface pair)
| 표면 | 코드 | 조회범위 | 귀속축 | status | 페이지네이션 |
|------|------|---------|--------|--------|------|
| 화면① 수납내역 | `Closing.tsx` staffTotals(L1575, enrichedRows) | **단일일**(created_at window) | live `customers.assigned_staff_id` | `!='deleted'` | 불필요(1일=23행) |
| 화면② 총매출>담당실장별 | Closing compare 탭 → `mtmSales.fetchStaffDailyBreakdown` → `staffRevenue.fetchAttributedPayments` | **월단위**(accounting_date 08-01~08-31) | attributed_staff_id snapshot + live belt | `NOT IN(cancelled,deleted)` | **없음 ← 버그** |

## RC (100% 재현)
`fetchAttributedPayments`(staffRevenue.ts L106~126)는 payments/package_payments를 plain `.select().gte().lte()`로 조회하며 **cursor 페이지네이션(.range) 부재**. PostgREST 기본 1000행 cap에 걸린다.
- 08월 payments(비cancelled/deleted) = **1071행 > 1000**.
- 비페이지 단일쿼리 = 1000행 반환(절단). 절단은 최근일 tail을 떨어뜨려 08-21 강경민 = **303,500(8건)** = 신고값 정확 일치.
- 페이지네이션 정답 = 08-21 강경민 = **16,057,900(23건)** = 화면① 수납내역과 일치.
- **delta = 15,754,400 = 100% 페이지네이션 절단 기여.**

## 원 3가설 분해 (전부 0)
| 가설 | 기여 | 건수 |
|------|------|------|
| H1 cancelled 포함비대칭 | 0원 | 0 |
| H2 귀속축(attributed snapshot ≠ live) | 0원 | 0 |
| H3 날짜축(created_at≠accounting_date) | 0원 | 0 |

- 강경민 08-21 23건 전건 status=active, attributed_staff_id=강경민(전건 stamped). snapshot·live 두 축 결과 동일 → **귀속축은 이 delta와 무관**(가드②: ②→① 반전 불요·해당없음).
- cancelled 0건 → 가드①(seed-0 필터) 무접촉.

## Blast radius (동일 SSOT·동일 버그)
`fetchAttributedPayments` 소비처 = 조회창>1000행 시 전부 최근일 과소집계:
- SalesDoctorTab (매출집계>담당실장별)
- SalesPaymentMethodTab (매출집계>결제수단별)
- stats.ts L270 (배정 랭킹 fetchConsultantPerfByAssignedStaff)
- mtmSales.fetchStaffDailyBreakdown → Closing compare 탭[신고표면] · Stats.tsx(통계 MTM 실장별 일별) · MonthlyComparisonSection

참고: `T-20260818-foot-STATS-PERIOD-QUERY-ERROR`가 mtmSales/stats의 자체 쿼리에는 `fetchAllRows` 페이지네이션을 넣었으나, **공유 SSOT `fetchAttributedPayments`에는 미도달**(fix 누락). package_payments 2차 쿼리도 동일 미페이지(latent).

## 제안 fix 방향 (착수는 planner 판정 — 본 티켓 진단 전용)
`fetchAttributedPayments`의 payments·package_payments 조회를 `fetchAllRows`(cursor .range) 패턴으로 전환. read-path only·db_change=false·산식/귀속축/필터 불변. money-path 표시숫자 복원 → supervisor code-gate.

## 증적
- 재현 스크립트: `scripts/T-20260821-foot-CLOSING-SUSU-STAFFREV-MISMATCH-DIAG_census.mjs` (SELECT-only)
- 실행 출력: delta 15,754,400 정확 재현, H1/H2/H3=0.
