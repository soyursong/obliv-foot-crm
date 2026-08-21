# T-20260821-foot-CLOSING-SUSU-STAFFREV-MISMATCH-DIAG — census2 explicit SELECT (INFO augment MSG-...-2712)

**READ-ONLY** (write0/DDL0/main 미접촉) · auth=service_role(RLS bypass, silent-0row 회피) · clinic=jongno-foot(74967aea) · staff=강경민(6ab26d9f) · date=2026-08-21
responder ie1t 명시 4축 SELECT를 explicit 숫자로 실행 → census1 RC(pagination cap) 재확인. **결론: 축①~④ 어디에도 15.7M delta 기여 없음. RC=fetchAttributedPayments 1000행 pagination cap 단독(100%).**

## 축① 두 surface 행 분해 (강경민·오늘·accounting_date)
| 테이블 | live assigned=강경민 (화면① 수납내역 축) | attributed=강경민 (화면② 담당실장별 축) | live만(attr≠강경민) | attr만(live≠강경민) |
|---|---|---|---|---|
| payments (active 92행) | **16,057,900 (23건)** | **16,057,900 (23건)** | 0 (0건) | 0 (0건) |
| package_payments (13행) | 0 (0건) | 0 (0건) | 0 (0건) | 0 (0건) |

→ 두 축(live vs snapshot)이 강경민 오늘 **완전 동일**(23건·16,057,900). 즉 원 데이터 상 두 surface가 **갈라지는 행이 0**. 표시상 303,500으로 갈라지는 건 데이터 축 차이가 아니라 **화면② 조회의 절단**뿐임을 explicit 확인.

## 축② attributed_staff_id IS NULL (live fallback 기여)
- payments: 강경민(live) 오늘 23건 中 attributed NULL = **0건 / 0원** (stamp율 **100.0%**)
- package_payments: 강경민 오늘 0건 (해당 없음)
- 전 clinic 오늘 stamp율(고객有): payments **98.9%(91/92)** · pkg **92.3%(12/13)** — parent census(payments 94.1% / pkg 95.5%) 대비 오늘분 stamp 양호. **강경민 오늘분은 NULL 0 → live fallback 기여 0.**

## 축③ 오늘 강경민 배정 변경 고객 수 (가설② 재배정 직접 정량화)
- 강경민 배정 고객 전체 = **165명**, 그 中 오늘 updated_at 갱신 = **15명**
- ⚠ 오늘 15명 재배정 발생은 사실이나 → **delta 기여 0**. 이유: 강경민 오늘 payments 23건 전부 `attributed_staff_id=강경민`(결제시점 snapshot)으로 각인되어, live≠snapshot 갈라짐(축①의 "attr만/live만")이 **0건**. 재배정이 있었어도 결제행 귀속은 snapshot=live로 일치 → **가설②(재배정 귀속) 정량 기여 0** 확정.

## 축④ package_payments 집계 scope 비대칭
- 강경민 오늘 pkg: live축 0(0건) / attr축 0(0건). 화면①·화면② 둘 다 payments+package_payments 합산(**scope 대칭**). **pkg 비대칭 기여 0.**

## 종합
| 축 | 15.7M delta 기여 |
|---|---|
| ① surface 데이터 축 차이 (live vs snapshot) | **0** |
| ② attributed NULL → live fallback | **0** |
| ③ 오늘 재배정 귀속 (H2) | **0** (재배정 15명 발생했으나 결제행 snapshot=live) |
| ③-a pkg scope 비대칭 | **0** |
| ③-b 기간축 (created_at≠accounting_date, census1) | **0** |
| ①cancelled (H1, census1) | **0** |
| **잔여 = pagination cap 절단** | **15,754,400 (100%)** |

**RC 재확인**: `staffRevenue.fetchAttributedPayments`(L106~126) cursor `.range` 부재 → 08월 payments 1071행 > PostgREST 1000 cap → 월조회 최근일(08-21) tail 절단 → 강경민 303,500(8건). 정답 16,057,900(23건). 원 3가설 + responder 신규 2축(NULL fallback·pkg scope) + 재배정 정량 모두 **0**.

## 증적
- `scripts/T-20260821-foot-CLOSING-SUSU-STAFFREV-MISMATCH-DIAG_census2_explicit_readonly.mjs` (SELECT-only)
- census1: `..._census.mjs` + `..._FINDINGS.md` (RC=pagination cap)
- fix 티켓: `T-20260821-foot-CLOSING-STAFFREV-PAGINATION-CAP-FIX` (approved·독립 승격)
