# T-20260714-foot-SAMEDAY-MANUALPAY-DRIFT-R2-REMAP-CLEAN — Phase 3 APPLY 판정근거 스냅샷

> 집행 시각: 2026-07-15 KST. clinic=foot(74967aea…). 대상 DB: obliv-foot-crm(rxlomoozakkjesdqjtvd).
> 게이트: 현장(김주연 총괄) confirm "반영" 수신(slack ts 1784073864.554299) → status approved → Phase3 apply.
> SOP: Cross-CRM Data-Correction Backfill — 대상셋 freeze 재확인(drift 0) · net-zero · 롤백SQL · 원장 파괴 0 · R1 12행 무접촉.

## 0. 실행 요건 충족 (planner NEW-TASK)
| 요건 | 충족 |
|------|------|
| Phase1 DRAFT apply.sql 라이브 실행 + 대상셋 freeze 재확인(변동 시 abort) | ✅ freeze 8건/417,800 정확 일치(drift 0), apply 집행 |
| B군 reconcile-with-evidence(net 계상, 이중계상 0) · A군 net-zero | ✅ C 진찰료 single 계상(패키지 무접촉) → 이중계상 0 |
| 판정근거 스냅샷 · 롤백SQL 경로 · before/after count · 7-invariant self-test PASS | ✅ 본 문서 · 아래 §3 · §1 · §2 (7/7 PASS) |
| R1 canonical 12행(SAMEDAY-REMAP) 재접촉 0 (double-canonicalize 방지) | ✅ 12행/4,608,900 무변경 확증 |

## 1. before / after count
| 지표 | BEFORE | AFTER | 판정 |
|------|--------|-------|------|
| closing_manual_payments (2026-07-14) | 8건 / 417,800 | **0건 / 0** | 8건 DELETE(net-zero rollup) |
| R2 canonical package_payments (마커 DRIFT-R2) | 0건 / 0 | **6건 / 400,000** | A 5×10,000 + B 이재성 350,000 |
| R2 canonical payments single (마커 DRIFT-R2) | 0건 / 0 | **2건 / 17,800** | C 허유희·이재성 각 8,900 진찰료 |
| 대상 6개 package balance=0 | 0/6 | **6/6** | 미수 전건 해소 |
| 허유희 24회권(876e1a55) balance | 0 | **0** | R2 무접촉(single만 계상) |
| R1 canonical 마커 12행 | 12행 / 4,608,900 | **12행 / 4,608,900** | 무변경(재접촉 0) |

## 2. 7-invariant self-test — ALL PASS (7/7)
1. ✅ canonical package_payments(DRIFT-R2) = 6건 / 400,000
2. ✅ canonical payments(DRIFT-R2) = 2건 / 17,800
3. ✅ 대상 6개 package balance = 0 (미수 전건 해소)
4. ✅ 허유희 F-4696 24회권 balance = 0 (R2 무접촉 — single로만 계상)
5. ✅ closing_manual_payments(2026-07-14) = 0건 (8건 DELETE)
6. ✅ net-zero: SUM(canonical)=417,800 == SUM(deleted)=417,800 (매출 무증감)
7. ✅ R1 canonical 마커(SAMEDAY-REMAP) 12행 / 4,608,900 무변경

## 3. 정정 결과 리스트 (차트·이름·금액·미수해소)
| # | 차트 | 이름 | 금액 | 계상 | 미수해소 |
|---|------|------|------|------|----------|
| 1 | F-4564 | 허유진 | 10,000 | package(무좀체험권) | ✅ balance 0 |
| 2 | F-4589 | 김성애 | 10,000 | package(체험) | ✅ balance 0 |
| 3 | F-4645 | 노수옥 | 10,000 | package(체험) | ✅ balance 0 |
| 4 | F-4642 | 이멋진 | 10,000 | package(무좀체험권) | ✅ balance 0 |
| 5 | F-4643 | 황찬식 | 10,000 | package(무좀체험권) | ✅ balance 0 |
| 6 | F-4702 | 이재성 | 350,000 | package(가열 잔금) | ✅ balance 0 |
| 7 | F-4696 | 허유희 | 8,900 | payments single(진찰료) | 해당없음(별개청구) |
| 8 | F-4702 | 이재성 | 8,900 | payments single(진찰료) | 해당없음(별개청구) |

## 4. 롤백 경로
- **롤백 SQL**: `scripts/T-20260714-foot-SAMEDAY-MANUALPAY-DRIFT-R2-REMAP-CLEAN_rollback.sql`
  - (1) R2 canonical package_payments 제거(마커 DRIFT-R2, 6행) → (2) R2 canonical payments 제거(2행) → (3) 영향 6개 패키지 paid_amount 재집계(before 0 복원) → (4) 원 closing_manual_payments 8건 재삽입(id 포함 원값 정확복원, ON CONFLICT DO NOTHING).
  - 마커 기반으로만 제거 → R1(SAMEDAY-REMAP) canonical 12행 무접촉.
- **apply 러너**: `scripts/T-20260714-foot-SAMEDAY-MANUALPAY-DRIFT-R2-REMAP-CLEAN_p3_apply_runner.mjs` (freeze re-check → abort on drift → before/after → 7-invariant self-test 내장)

## 5. 안전 점검
- 원장(payments/package_payments) 파괴적 삭제 0. closing_manual_payments 8건은 canonical 대체 후 net-zero rollup DELETE(rollback으로 정확복원 가능).
- 멱등 가드: apply.sql WHERE NOT EXISTS(memo 마커) → 재실행 시 중복 INSERT 0.
- double-canonicalize 방지: R2 마커 사전존재 0 확인 후 집행, R1 12행 무접촉 사후 확증.
- 매출 무증감(net-zero 417,800) — 일마감 총액 불변.
