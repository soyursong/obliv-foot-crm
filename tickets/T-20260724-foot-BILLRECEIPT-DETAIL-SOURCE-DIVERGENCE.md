---
id: T-20260724-foot-BILLRECEIPT-DETAIL-SOURCE-DIVERGENCE
domain: foot
status: deploy-ready
qa_result: pass
deploy_commit: 6ba660584911
deployed_at: n/a (NOT yet deployed — supervisor QA→main merge→CF Pages 자동배포 선행)
bundle_hash: n/a (미배포 — 배포 후 pages.dev/version.json 기준 재산출)
priority: P0
db_change: 없음 (순수 산식/표시층 — bill_receipt_new form 토큰 소스만 라이브 전환, DB write 0)
da_consult: 불요 (신규 컬럼·테이블·enum 0 — 기존 check_in_services/computeFootBilling SSOT 재소비)
e2e_spec: tests/e2e/T-20260724-foot-BILLRECEIPT-DETAIL-SOURCE-DIVERGENCE.spec.ts (9/9 PASS)
slack_thread_ts: "1784863681.395679"
slack_channel: C0ATE5P6JTH
---

# T-20260724-foot-BILLRECEIPT-DETAIL-SOURCE-DIVERGENCE — 계산서·영수증 ↔ 세부내역 금액 발산 수정

## 요약
진료비 계산서·영수증 신양식(`bill_receipt_new`)의 합계 4토큰(`total_amount`/`insurance_covered`/`copayment`/`non_covered`)
+ 환자부담총액(`patient_amount`)이 세부산정내역(`bill_detail`)과 금액이 어긋나던 결함을 수정.
두 서류가 **동일 라이브 SSOT(`check_in_services` = `computeFootBilling`)** 로 수렴하도록 신양식 전용 헬퍼로 force 세팅.

## RC (D0 read-only reconcile 확정, codex GO 재검증)
- `bill_detail` 은 이미 `check_in_services`(라이브 SSOT) 명시세팅 → 정합(정답, 무접촉).
- `bill_receipt_new` aggregate 4토큰 + `patient_amount` 는 `applyBillingFallback`(blank-only, `isBlankOrZero` 가드)에만 의존.
  autobind 이 stale `service_charges`(감사로그)로 이 값들을 이미 선점 → 라이브가 못 덮어 divergence.
- **D0 실측 (F-4790 박민석, check_in `9fa4be59`)**:
  - `check_in_services`(라이브) = 비급여 **315,000** / 총액 **335,590** / 급여본인 **6,100** / 공단 **14,490** (general 30%: FLOOR(20,590×0.3)=6,100)
  - `service_charges`(stale) = 다른 방문에 부분행(29,375)만 존재, 비급여 0 → 신뢰 불가 확정
  - → 라이브 = 정답. (240,000 은 타 방문 stale 값)

## 수정 (D1~)
| 단계 | 구현 | 위치 |
|------|------|------|
| D1 헬퍼 | `applyBillReceiptNewLiveTotals(values, live)` 신설 — 신양식 한정 force 대입(applyBillingFallback 재호출 아님) | `src/lib/footBilling.ts` |
| D2 전경로 대칭 | DPP 단건·미리보기(allValues) + 배치(valuesFor) + PMW [출력]/[출력및수납](공용 헬퍼) | `DocumentPrintPanel.tsx`, `PaymentMiniWindow.tsx` |
| D3 진료비총액 | `total_amount`/`subtotal_amount` = `grandTotal`(공단 포함) | 헬퍼 |
| 순서강제 | `applyBillReceiptNewCoveredTokens`(remainder) 이전 호출 | 각 호출부 |

## 무접촉 가드
- `applyBillingFallback` 일반정책 **무접촉**(blank-only `isBlankOrZero` 가드 그대로) → **T-20260609 AC-3 GREEN 유지**.
- `bill_detail` **무접촉**(이미 정합).
- `grandTotal ≤ 0`(check_in_services 미기록 구 데이터) → 헬퍼 no-op → `service_charges` 직결 폴백 보존.
- 산식 변경 없음(기존 `computeFootBilling` SSOT 재소비).

## 완료기준
- [x] F-4790 계산서·영수증 = 세부내역 완전 일치 (급여본인 6,100 / 공단 14,490 / 비급여 315,000) — 헬퍼 항등 spec PASS
- [x] 진료비 총액 335,590 (공단 포함) — spec PASS
- [x] T-20260609 AC-3 GREEN (applyBillingFallback 무접촉, source-wiring assert PASS)
- [x] DPP(단건·배치·미리보기) + PMW([출력]/[출력및수납]) 전경로 대칭 — 5 call-site 배선 assert PASS
- [x] tsc clean / 9-spec PASS
- [ ] supervisor QA → main merge → 현장 표본 실발행 확인 (F-4790 실제 계산서·영수증 vs 세부내역 육안 대조)

## 셀프 QA
- `npx tsc --noEmit` → exit 0
- `T-20260724-foot-BILLRECEIPT-DETAIL-SOURCE-DIVERGENCE.spec.ts` → 9/9 PASS
- T-20260609 회귀: 사전존재 5건 실패는 **origin/main baseline 에서도 동일 발생**(라이브 렌더 E2E, DB 픽스처 필요 = 환경성). 본 변경으로 신규 실패 0건 확인(stash 대조).
