# T-20260715-foot-DAYCLOSE-PAYGATE-RC-REPRO — F-4714 row-level 진단 (READ-ONLY)

**결론: Branch #3 확정** — 실결제 0건(총괄 주장 검증됨) + check_in_services 시술가 행 실재 → 노출 경로는 **결제목록이 아니라 시술별 통계의 "매출" 컬럼**. 16:22 checkInsDetail-RC 가설 REFUTED, 16:30 probe(결제목록 미노출) CONFIRMED.

진단 시각: 2026-07-15 / 소스: supabase-js service_role SELECT-only (write 0건)

---

## TASK-1 — check_ins (F-4714)

customer: `e8ed0df6-262b-4dfd-9cf7-938e285feac7` (chart `F-4714`, 총괄테스트, visit_type=returning, clinic 74967aea)

| check_in_id | visit_type | status | status_flag | checked_in_at | completed_at |
|---|---|---|---|---|---|
| e52b0cd7-2eb8-44d4-a129-9e6725edfc0b | new | **done** | dark_gray | 2026-07-14 00:30 | 2026-07-14 03:01 |
| a213a71b-af74-4071-a77c-4e2cb327ef79 | returning | **done** | dark_gray | 2026-07-15 00:35 | 2026-07-15 06:26 |

status_transitions 9건 — 정상 done 종결 이력. payment_waiting↔done 반복(테스트 조작) 흔적, 최종 done.

## TASK-2 — 실결제 3종 + check_in_services

| 소스 | F-4714 관련 행수 |
|---|---|
| payments | **0** |
| package_payments | **0** |
| closing_manual_payments | **0** |
| **check_in_services** | **13** (그 중 유가행 5건) |

→ **총괄 "결제 한 적 없어" = row-level CONFIRMED. A안(앞 단계 정당 결제) 배제 확정.**

유가 check_in_services (is_package_session=false):
- CI 7/14(e52b0cd7): 비가열성 진균증 레이저 300,000(`b2d40bce`) + 초진진찰료-의원 18,840(`19f85df2`) = **318,840**
- CI 7/15(a213a71b): 비가열성 진균증 레이저 240,000(`15d319b3`) + 초진진찰료-의원 18,840(`0756161f`) + KOH도말 10,540(`75c6c3f2`) = **269,380**
- 나머지 8건 = 진단코드/처방 price 0

## TASK-3 — 노출 경로 특정

| 화면 요소 | 소스 (Closing.tsx) | F-4714 노출? |
|---|---|---|
| **결제목록 탭 (enrichedRows)** | payments + package_payments + manualEntries (L736–870) | **미노출** — 세 소스 모두 0건. checkInsDetail(L436)은 이름 lookup map일 뿐 행 생성 안 함 |
| **시술별 통계 ("매출" 컬럼)** | check_in_services.price 집계 (L404–433 query, L1442–1468 render, "매출" 헤더 L1454) | **노출** — payment-gate 없이 status-agnostic price 합산 |

→ 16:22 "checkInsDetail status무관 load = 결제목록 표시버그" 가설 **REFUTED** (checkInsDetail은 렌더 행 생성 경로가 아님). dev-foot 16:30 probe(done 67 결제행 전무) **정확했음**.

## 분기 판정 = **#3 (check_in_services price만 노출, payments 0 → 시술통계 아티팩트)**

- 성격: 시술별 통계 "매출" 컬럼이 명세가(청구예정가) 합계이지 실수납이 아님 → 미결제 done건이 매출로 표기됨(매출 부풀림 318,840 / 269,380).
- AC-3 방향: 매출표기(매출 컬럼)이므로 게이트 검토 대상. **단, naive status=done 필터 금지** — 두 check_in 모두 done이라 status로 결제여부 구분 불가. 진짜 신호 = 해당 check_in에 연결된 실결제(payments) 유무.
- 매출 grain 이슈: payments=수납 grain vs check_in_services=명세 grain 혼동 (매출 SSOT: Revenue Insurance Split). 라벨 정정("매출"→"명세가/청구예정") 또는 payment-linked 필터가 대안. architect CONSULT 여지.

## 게이트 write 상태
- **미실행.** read-only 진단만. RC 확정(#3) 후 게이트 방향은 planner/architect 판단 대기.
