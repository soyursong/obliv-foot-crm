---
id: T-20260721-foot-PMW-PREPAID-DEDUCT-COPAY-BASE
domain: foot
priority: P0
hotfix: true
status: qa-pending
qa_result: pending — supervisor 실브라우저 실측 대기(급여환자 선수금 차감 → 청구액=8,800 자부담 기준 GO 후에만 responder 릴레이)
freeze_gate: CI-RED MAIN FREEZE 중(T-20260720-foot-CI-RED-MAIN-RESOLVE, blocked). 브랜치 커밋·실측·E2E 완주. main 병합은 CI green 후 supervisor 게이트.
db_change: false
db_migration: none
db_gate: N/A — 순수 FE 산식 재배선(청구 base를 기존 배포 SSOT computeFootBilling으로 교체 소비). 신규 컬럼·테이블·enum 0. DDL 0. data-architect CONSULT 불요.
build: pass (npm run build ✓ tsc+vite, built in 5.70s)
e2e_spec: tests/e2e/T-20260721-foot-PMW-PREPAID-DEDUCT-COPAY-BASE.spec.ts
spec: tests/e2e/T-20260721-foot-PMW-PREPAID-DEDUCT-COPAY-BASE.spec.ts
scenario_count: 8 (현장재현 8,800 / grade=null 8,800 / 급여+비급여 혼합 / 선수금無=payableTotal 정합 / 체험권 무파괴 / 비급여만 무파괴 / FLOOR 회귀가드) — 8/8 PASS
deploy_commit: af9dc767
deployed_at: n/a (freeze — CI green + supervisor 게이트 대기)
bundle_hash: PaymentMiniWindow 청크 (로컬 build ✓ — supervisor 운영배포 후 pages.dev 재검증)
branch: hotfix/T-20260721-foot-PMW-PREPAID-DEDUCT-COPAY-BASE
pmw_overlap: 선행 PMW 티켓(CHARTCODE-SPLIT/LABEL-TOTAL/COPAY-GRADE) 3건 모두 main 병합 완료 → main이 PMW 통합점. 활성 병렬 브랜치 부재. main HEAD(9d2e9bf7)에서 분기 + 단일 discrete commit(af9dc767). 별도 divergent PMW 브랜치 미개설(C-4/PMW-OVERLAP-CROSSCHECK 정신 준수).
reporter: 이은상 팀장 (스샷 F0BJ728S6LX)
created: 2026-07-21
assignee: dev-foot
summary: 결제 미니창 선수금 차감 후 청구액이 급여 진료비 전액(본인부담+공단부담) 기준으로 산정돼 과다청구되던 P0 버그를, 공단 제외 수납 grain SSOT(본인부담 30% + 비급여) 기준으로 재배선. 급여환자 29,380 → 차감 후 청구 8,800. FE-only, DB0.
---

## 배경 (현장 P0)

이은상 팀장 보고(스샷 F0BJ728S6LX): 결제 미니창에서 **선수금 차감 후 청구액**이
`29,380`(= 총 진료비, 공단부담금 포함)으로 표시됨. 급여환자 기대값 = 급여 본인부담(30%)
기준 `8,800`. 실결제 영향(과다 청구).

## RC (getItemAmount 전액 base 오용)

`calcDeductAmount`(구 PaymentMiniWindow.tsx L1538~1542)가 `getItemAmount(item)`을 합산했다.
`getItemAmount = (override ?? service.price) * qty` = **급여 진료비 전액**(본인부담 + 공단부담 + 비급여).
선수금 차감(패키지 회차 소진) 대상만 제외하고 나머지를 전액으로 합산 → 공단(NHIS) 몫까지 환자에게 청구.

## RCA — 지문 스윕 (responder CONFLICT-SNIFF 요청 대응)

- **07-14 과다수납 P0(선수금차감, body/physio)와 동일 지문**: "전액(공단 포함) base를 수납/청구에 사용".
  본 건은 그 지문의 **청구(차감후) grain** 잔존분. 수납잔액(payableTotal) 경로는 T-20260714
  BALANCE-SPLIT에서 이미 `payCopaymentTotal`(공단 제외) SSOT로 교체됐으나, **선수금 차감 후 청구액**
  경로만 `getItemAmount`(전액) 오용이 남아 있었다(미커버 경로).
- **getItemAmount 오용 잔존 스윕 결과**: `git grep getItemAmount` → 정의(L1426) + 유일 소비처(L1541)
  두 곳뿐. 수납잔액·영수증·차감후청구 라인 등 **다른 결제경로는 잔존 없음**(이미 payCopaymentTotal /
  computeFootBilling SSOT 소비 중). → 오용 사이트는 이 한 곳으로 격리 확인.

## 해소 (SSOT 단일소비, DA §제약1 병렬 재계산 금지)

청구 base = BALANCE-SPLIT 배포본 수납 grain SSOT(`computeFootBilling`,
`unknownGradeCopay:'general_default'`, 공단 제외 = 본인부담 30% + 비급여)를 그대로 소비.
차감대상 제외 subset을 `payBilling`(L1493)과 **동일 옵션**의 `computeFootBilling`에 통과 →
`copaymentTotal + nonCoveredTotal`. 새 산식 경로 없음. `getItemAmount` 정의 제거
(유일 소비처 재배선으로 데드코드 + '전액 base' 오용 재발 원천 차단).

- 선수금 항목이 없으면 subset = 전체 pricingItems → `payableTotal`과 정확히 일치(회귀 0).
- general 30% 정률경로 = 100원 미만 절사(FLOOR, copayCalc.ts v1.5 정정 유지, CEIL 복귀 금지).
  → 29,380 × 0.3 = 8,814 → floor→100 = **8,800**(티켓 기대값).

## 검증

- **build**: `npm run build` ✓ (tsc + vite, 5.70s)
- **E2E**: `tests/e2e/T-20260721-foot-PMW-PREPAID-DEDUCT-COPAY-BASE.spec.ts` **8/8 PASS**
- **회귀(관련 PMW/copay 스펙)**: BALANCE-SPLIT·COPAY-CEIL-SWEEP 등 9건 FAIL은 **본 변경과 무관** —
  CEIL 8,900 / pre-v1.6 grade rate를 단언하는 **stale spec fixture**(현 runtime FLOOR 8,800 /
  v1.6 정액·면제). `footBilling.ts`·`copayCalc.ts` 무접촉(diff = PaymentMiniWindow.tsx 1파일 +
  신규 spec). 이 stale-spec 실패군이 곧 CI-RED MAIN FREEZE의 원인으로 추정(planner FOLLOWUP 보고).

## 게이트 (완료통보/릴레이 금지 — §3)

- ⛔ **현장 확인 前 완료통보/릴레이 금지**. dev+supervisor 실브라우저 실측(급여환자 선수금 차감 →
  청구액=8,800 자부담 기준) GO 후에만 responder 릴레이(BALANCE-SPLIT 4회 divergence 교훈).
- main 병합 = CI green(CI-RED-MAIN-RESOLVE) 후 supervisor 게이트.
