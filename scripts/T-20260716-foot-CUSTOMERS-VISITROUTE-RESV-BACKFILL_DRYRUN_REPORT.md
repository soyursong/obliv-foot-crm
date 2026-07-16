# DRY-RUN REPORT — T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL

- **DB**: rxlomoozakkjesdqjtvd (obliv-foot PROD, jongno-foot)
- **Mode**: SELECT-only, write 0 (APPLY는 supervisor 백필 승인 게이트#3 후 별도)
- **SOP**: Cross-CRM Data-Correction Backfill SOP 게이트#2
- **DA CONSULT**: DA-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL (CONDITIONAL-GO)
- **evidence json**: `T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL_dryrun.out.json`
- **runner**: `T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL_dryrun.mjs`

## 대상 정의 (AC1)
- 물리 대상 = `customers.visit_route` 단독 fill-on-NULL/'' (reservations **절대 미변경** — 소스).
- 소스 = `reservations.visit_route` (한글 enum, ≠source_system).
- 매핑 = identity + `인콜→인바운드` 정규화 (A안). NULL/''/미지정 → skip.
- fill 규칙 = **first-touch (created_at ASC)**.

## BEFORE 카운트
| 항목 | 값 |
|---|---|
| customers.visit_route NULL 총계 | 272 |
| ↳ 대상 universe (NULL/'' ∩ EXISTS routed reservation) | **155** |
| ↳ out-of-scope (NULL & 소스 예약 route 전무) | 117 |
| customers.visit_route 기존 non-null 분포 | TM 113 / 지인소개 15 / 워크인 6 / 인바운드 5 / 네이버 4 |

## 대상셋 (매핑 적용)
| Set | 규칙 | count | breakdown |
|---|---|---|---|
| **A (PRIMARY)** | DA-strict first-touch (최초예약 route; NULL→out-of-scope, forward-fill 금지) | **154** | TM→TM 154 |
| B | AC2 line107 "최초 NON-NULL route 예약" | 155 | TM→TM 155 |
| C (참고, 폐기규칙) | most-recent DESC | 155 | TM→TM 155 |

- **naver/인콜/워크인/지인소개 매핑 발화 = 0건.** 해당 경로 고객은 이미 `visit_route` 값 보유(대상셋 밖). ⇒ 이번 백필 실질은 **전량 TM→TM**. (naver hard-gate 확정은 정합성상 필요했으나 현 데이터 영향행 0.)
- mapped 값 CHECK 도메인(TM/워크인/인바운드/지인소개/네이버/인콜) 위반 = **0** ✓

## 안전 검증
| 항목 | 결과 |
|---|---|
| no-clobber (기존 non-null이 대상셋에 포함) | **0** ✓ (NULL/'' 술어로 구조적 배제) |
| DOPAMINE 잔차 sliver (DA Q2: firsttouch=dopamine ∩ cust NULL ∩ resv route 전무) | **0** ✓ (clean fold, DA 실측과 일치) |
| Q3 fan-out (reservations-grain COUNT GROUP BY customers.visit_route 뷰) | **없음** ✓ (Closing.tsx는 customer-grain 표시축 — 의도된 용도) |
| value mismatch A↔B (양쪽 존재 고객) | 0 |
| first-vs-recent divergence (AC2 line132) | 0 |

## ⚠ SPEC TENSION — planner 판정 요망 (1행)
- **DA CONSULT 조건#1 = "first-touch, forward-fill 금지"** → Set A = **154**.
- **AC2 line107 = "최초 NON-NULL route 예약"** → Set B = **155** (1행 forward-fill).
- 차이 = customer `2997fc1c…` 1건: 최초예약(07-08 01:11) route=NULL → 후행예약(07-08 06:17) route=TM.
  - DA-strict: 최초 접점 route 불명 → **out-of-scope(NULL 유지)**. AC2: 후행 TM forward-fill.
- **결과적 충돌**: AC4 "APPLY 후 잔존건 0" ↔ DA-strict는 이 1행을 **정당하게 잔존(NULL)** 시킴.
- **dev-foot 권고**: DA(SOP 권위·qa-fail 게이트)를 따라 **freeze=154(Set A)** 채택.
  AC4 잔존건 판정에 각주 필요 = "최초접점 route 불명 1건은 forward-fill 금지에 따른 **예상된 out-of-scope**(결함 아님)". → planner AC4 문구 보정 or Set B 채택 결정 요청.

## freeze (PRIMARY = Set A, DA-strict, 154행)
- `*_dryrun.out.json > freeze_primary_DA_strict.rows` = `[{customer_id, src_route, new_visit_route}]` 154건.
- apply-time 재검증 앵커: freeze-by-id VALUES + `WHERE visit_route IS NULL` 멱등 + drift/잔차 abort(§0-2-a).

## 잔여 게이트
1. ✅ 게이트#0/#1/#1.5 CLOSED.
2. ✅ **게이트#2 dry-run evidence — 본 리포트 (완료)**.
3. ⬜ 게이트#3 supervisor 백필 승인 (archive-first + dry-run 검수 + 원장 무접점) ← **ball**.
4. ⬜ 게이트#4 APPLY (멱등+drift abort+APPLY/ROLLBACK 페어) → post-verify → 현장 confirm.
   - ⚠ 게이트#3 진입 전 **154 vs 155 planner 판정** 선결 권고.
