# T-20260714-foot-SAMEDAY-MANUALPAY-REMAP-UNPAID-CLEAN — Phase 3 집행 판정근거 스냅샷 (supervisor QA)

> 집행 시각: 2026-07-14 (일마감, 익일 개장 전 수렴). clinic=foot(74967aea…). execution_owner=this(당일 freeze셋 단독소유).
> 현장 confirm: 김주연 총괄 "반영해주세요" (ts 1784020887.022199, MSG-20260714-182235-y3wl). human_pending 해소·status approved.
> SOP: data_correction_backfill_sop 준수 — 대상셋 freeze · 판정근거 스냅샷 · 롤백SQL · before/after count · 원장 파괴적 삭제 0.

## 0. 핵심 결과 (ALL PASS)
| 지표 | before | after |
|------|--------|-------|
| closing_manual_payments (2026-07-14) | 20건 | 8건 (−12, 정본화 대상만 DELETE) |
| canonical package_payments (마커) | 0건 | 11건 / 4,600,000 |
| canonical payments (마커) | 0건 | 1건 / 8,900 |
| 대상 11개 패키지 balance 0 | 0/11 | **11/11 (미수 전건 해소)** |
| 허유희 24회권 paid / balance | 380,000 / 4,500,000 | **4,880,000 / 0 (이중계상 0)** |
| net-zero (canonical합 == 삭제 closing합) | — | **4,608,900 == 4,608,900 ✅** |

## 1. ★ 실행 직전 freeze-set DRIFT 검출 → 재freeze (v2) [SOP 준수 핵심]
apply 직전 재조회(`_p3_evidence.mjs`)에서 confirm 시점 snapshot(§4, 13건) 대비 drift 발견 → 구 apply.sql(v1) 폐기, v2 재freeze:
- **(1) 허유희 F-4696 현장 재정정**:
  - 원행 `a226fb72`(3,880,000 card) → **현장 삭제**(부재).
  - 원행 `38a37a50` amount **1,000,000 → 4,500,000** 로 현장 수정, memo="최초이체 100만원 / 계좌이체 350만원 추가 / 카드 38만원".
  - → 오늘 실수납 = **4,500,000**. 구 v1(3.88M+1M=4.88M)을 그대로 정본화했다면 380,000 **이중계상**(paid 5,260,000 > 총액 4,880,000) 발생할 뻔함. ← 현장이 우려한 바로 그 지점.
- **(2) 17:51 이후 신규 수기행 8건** 등장(confirm 범위 밖) → 본 apply **미포함**(§4 참조).

## 2. ★ 허유희 F-4696 reconcile-with-evidence (380k 중복 검출·net 계상)
| 근거 | 값 |
|------|-----|
| 24회권(876e1a55) total_amount | 4,880,000 |
| 기결제 package_payment (734bad9c, "영수증 업로드", 07:43) | 380,000 (card) |
| 오늘 수기 실수납 (현장 정정 후 38a37a50) | 4,500,000 (transfer) — memo에 "카드 38만원"을 기결제로 별도 명시 |
| 산식 | 오늘 4,500,000 + 기결제 380,000 = **4,880,000 = 총액** → balance 0 |
| 판정 | 380,000(카드/영수증업로드)은 **기결제로 이미 원장 존재** → 오늘 canonical은 net **4,500,000**만 계상. 총액 초과·이중계상 **0 확증**. 산식 비모호(hold 불요). |

canonical 행 memo: `일마감 수기결제 정본화(F-4696 허유희 24회권 잔금, opt-A/pkg, net 4,500,000=총액4,880,000-기결제380,000영수증업로드; 원장 최초이체100만+계좌이체350만) T-20260714-SAMEDAY-REMAP`

## 3. 이미현 F-4695 8,900 진찰료 — single(단독수납) default
- 12회권(e55c868d) balance=0(완납) = 패키지 잔금 아님. 오늘 payments = 248,900 결제 + 248,900 환불(시스템오류) net-zero(무관).
- confirm: single/checkin 미명시 → **default single** 적용. payments INSERT (check_in_id NULL, 8,900 card).
- residual(비차단): 결과 relay 시 현장 재확인 문구 포함.

## 4. FREEZE SET v2 (12건) — 정본화 대상 + net-zero
canonical SUM(4,608,900) == DELETE된 closing_manual_payments SUM(4,608,900). 매출 무증감.

| # | 차트 | 이름 | 금액 | 정본화 | 미수해소 |
|---|------|------|------|--------|---------|
| A1 | F-4590 | 전인호 | 10,000 | 무좀체험권 잔금 | ✅ balance 0 |
| A2 | F-4644 | 최고 | 10,000 | 체험 잔금 | ✅ balance 0 |
| A3 | F-4646 | 박형규 | 10,000 | 무좀체험권 | ✅ balance 0 |
| A4 | F-4652 | 진태주 | 10,000 | 무좀체험권 [repro] | ✅ balance 0 |
| A5 | F-4655 | 마서현 | 10,000 | 무좀체험권 | ✅ balance 0 |
| A6 | F-4600 | 최창수 | 10,000 | 무좀체험권 | ✅ balance 0 |
| A7 | F-4601 | 정종석 | 10,000 | 체험 | ✅ balance 0 |
| A8 | F-4546 | 김종형 | 10,000 | 체험 | ✅ balance 0 |
| A9 | F-4597 | 윤철희 | 10,000 | 체험 | ✅ balance 0 |
| A10 | F-4687 | 신용섭 | 10,000 | 무좀체험권 | ✅ balance 0 |
| B | F-4696 | 허유희 | 4,500,000(오늘)+380,000(기결제)=4,880,000 | 24회권 완납 | ✅ balance 0, 이중계상 0 |
| C | F-4695 | 이미현 | 8,900 | 진찰료 단독수납(single) | ✅ 수납내역 반영(패키지미수 아님) |

> 원 confirm은 "13건" — 허유희 2행(3.88M+1M)이 현장에서 1행(4.5M)으로 통합된 뒤 apply → **적용 12행 = 13 − 1(허유희 병합)**. 금액 정합: 허유희 총 488만원(오늘 450만 + 기결제 38만)으로 현장 인식과 일치.

## 5. confirm 범위 밖 신규 8건 (17:51~19:22, 별도 후속 필요)
apply 미포함. planner FOLLOWUP로 별도 confirm/처리 요청(병존 RETRO-BACKFILL 또는 신규 batch):
| 시간 | 차트 | 이름 | 금액 |
|------|------|------|------|
| 17:51 | F-4564 | 허유진 | 10,000 |
| 18:50 | (미기재) | 김성애 | 10,000 |
| 19:01 | F-4645 | 노수옥 | 10,000 |
| 19:03 | F-4642 | 이멋진 | 10,000 |
| 19:05 | F-4702 | 이재성 | 350,000 |
| 19:12 | F-4643 | 황찬식 | 10,000 |
| 19:21 | 4696 | 허유희 | 8,900 (데스크) |
| 19:22 | 4702 | 이재성 | 8,900 (데스크) |

## 6. 롤백
- `scripts/T-20260714-foot-SAMEDAY-MANUALPAY-REMAP-UNPAID-CLEAN_rollback.sql` (v2, 멱등, before-state 정확복원 — 허유희 4,500,000 원복 포함).
- 마커(`T-20260714-SAMEDAY-REMAP`) 기반 canonical 제거 → closing_manual_payments 12건 재삽입 → paid_amount 재집계(허유희 380,000 복원, 나머지 0).

## 7. 안전 점검
- canonical 마커 사전존재 0건(apply 전) → double-canonicalize/double-UPDATE 없음. 단일 실행 소유(execution_owner=this) 준수.
- 원장(payments/package_payments) **파괴적 삭제 0** — INSERT + closing_manual_payments(수기 rollup 원장) DELETE만. net-zero.
- 병존 RETRO-BACKFILL 티켓과 당일 freeze셋 write 중복 없음(본 티켓 단독).
- 트랜잭션 원자성(BEGIN/COMMIT) + 멱등 가드(WHERE NOT EXISTS) + 7-invariant self-test ALL PASS.
