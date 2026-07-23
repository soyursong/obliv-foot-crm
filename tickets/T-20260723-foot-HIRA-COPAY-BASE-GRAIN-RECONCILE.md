---
id: T-20260723-foot-HIRA-COPAY-BASE-GRAIN-RECONCILE
domain: foot
status: deploy-ready
qa_result: pass
deploy_commit: 98cae194a7d8
deployed_at: n/a (NOT yet deployed — supervisor main merge → CF Pages 자동 배포 선행)
bundle_hash: n/a (미배포 — merge 후 pages.dev/version.json commit == origin/main HEAD 검증 대상)
priority: P3
db_change: false (no-DDL, 신규 오브젝트 0 — clinics.hira_unit_value 기존 컬럼 read-only 소비)
da_consult: GO (MSG-20260723-192356-v1zu / da_decision_foot_hira_copay_base_grain_reconcile_20260723 — C안 확정)
branch: feat/T-20260723-foot-HIRA-COPAY-BASE-GRAIN-RECONCILE
e2e_spec: tests/e2e/T-20260723-foot-HIRA-COPAY-BASE-GRAIN-RECONCILE.spec.ts
---

# T-20260723-foot-HIRA-COPAY-BASE-GRAIN-RECONCILE — 풋 급여 공단부담 base 정합 (C안)

## 요약
pay-mini(`computeFootBilling`)가 급여 base 로 `services.price` 를 쓰던 §2-2-1 위반(잠복 버그)을,
서버 명세(`calc_copayment` §정상분기)와 동일 base = `ROUND(hira_score × hira_unit_value)` 로 정합한다.
진찰료 3건은 `price=수가` 우연일치였고 그 1원 갭이 공단부담에 노출됐다(M0111 공단 5120 → canonical 5119).

## 근거
- DA CONSULT-REPLY: MSG-20260723-192356-v1zu / 결정문 `da_decision_foot_hira_copay_base_grain_reconcile_20260723.md`.
- **C안 GO** (A안 services.price 변경·B안 1원 tolerance 정책화 REJECT).
- 권위 base = `ROUND(hira_score × hira_unit_value)` (명세 grain canonical). `hira_unit_value` = clinics governed(§2-2-0).

## 확정 구현 (C안)
| 스코프 | 구현 | 위치 |
|--------|------|------|
| 1. 급여(is_insurance_covered=TRUE)×hira_score 존재 → base=ROUND(hira_score×hira_unit_value) | `computeFootBilling` 항목 base(amountOf) 분기 — 급여×hira_score & hiraUnitValue 주입 시 `Math.round(hira_score × hiraUnitValue) × qty`, 그 외 기존 `unitPrice × qty` | `src/lib/footBilling.ts` |
| 2. hira_unit_value = clinics 취득(하드코딩·연도상수 금지) | `computeFootBilling` opts.hiraUnitValue 신설. PMW 가 `clinics.hira_unit_value` 로더(state) 로 주입 | `PaymentMiniWindow.tsx` (clinics 로더 + 3계산기·loadAlreadyPaidAmount 주입) |
| 3. 비급여: price 정본 base(ROUND 미적용) | is_insurance_covered≠TRUE 는 base override 대상 아님 → 기존 로직 그대로 | `footBilling.ts` amountOf else-branch |
| 4. hira_score NULL / grade=null: 기존 §2-2-1a/1b·§2-2-4 권위 계승 | 본 티켓이 분기 미변경. hira_score NULL → suga 산출 불가로 price base 유지. grade=null copay 폴백(covered_full/general_default) 분기 불변 | `footBilling.ts` |
| 5. 하드코딩·역산 금지 | hira_unit_value 는 clinics 주입값만 사용. 미주입(null) → price base 폴백(무파괴), 상수 삽입 없음 | 전반 |

> 무파괴: `hiraUnitValue` 미주입 콜러(DocumentPrintPanel 등)는 기존 price base 동작 그대로(회귀 0).
> DPP 문서 primary 경로는 이미 service_charges(서버 calc, canonical) 소비 → 본 변경과 무드리프트.

## AC 충족
| AC | 결과 |
|----|------|
| M0111 general 공단부담 = 5119 (기존 5120 제거) | ✅ spec AC1 (suga base 7219 → copay 2100 → 공단 5119) |
| 비급여 결제창 금액 무변화(회귀 0) | ✅ spec AC2 (주입 유무 무관 동일) |
| hira_score 없는 급여·hira_unit_value 미주입 경로 기존 동작 유지(회귀 0) | ✅ spec AC3 |
| 서버 calc_copayment = pay-mini 결과(parity) | ✅ spec AC4 (coveredTotal/copay/공단 = calcCopayment) |

## 게이트
- `db_change: false` · no-DDL · DA GO → 대표 게이트/DDL-diff 불요. supervisor 일반 QA만.
- 현장 클릭 시나리오 3종 → E2E spec 변환 완료(UI-observable = 결제창 금액 = computeFootBilling 산출값).

## 셀프 QA
- `npm run build` OK (6.2s).
- `tests/e2e/T-20260723-foot-HIRA-COPAY-BASE-GRAIN-RECONCILE.spec.ts` **9/9 PASS**.
- 회귀: 기존 COPAY/PMW billing 스펙 45 PASS. (T-20260714·T-20260715 의 9 FAIL 은 **baseline 사전 실패** — v1.6 등급분기 rate 미반영 stale 스펙 + 29,380 시드 이슈, 본 티켓 무관·무영향 확인.)
