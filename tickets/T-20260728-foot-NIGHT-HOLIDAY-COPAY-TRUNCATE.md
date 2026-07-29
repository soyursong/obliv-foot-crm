---
id: T-20260728-foot-NIGHT-HOLIDAY-COPAY-TRUNCATE
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: 178dfc5c1e98
deployed_at: 2026-07-28 21:38:00+09:00 (ticket branch pushed — origin/main merge = supervisor QA 게이트 대기)
bundle_hash: 로컬 build PaymentMiniWindow-Cmnf7GTB.js (npm run build ✓)
db_change: false
db_migration: none
db_gate: N/A — FE 계산 레이어 전용. 신규 컬럼·테이블·enum 0. 배포 절사 SSOT(computeBillDetailRounding) read-only 재사용. §S2.4 데이터 정책 자문 게이트 비해당.
build: pass (npm run build ✓)
scenario_count: 10 assertions (시나리오1 가산 절사 4 + 시나리오2 무가산 회귀 4 + 전제 2 + 진료일판정 1 — 실제 10 test)
e2e_spec: tests/e2e/T-20260728-foot-NIGHT-HOLIDAY-COPAY-TRUNCATE.spec.ts
spec: tests/e2e/T-20260728-foot-NIGHT-HOLIDAY-COPAY-TRUNCATE.spec.ts
created: 2026-07-28
completed: 2026-07-28
assignee: dev-foot
owner: agent-fdd-dev-foot
reporter: planner (NEW-TASK MSG-20260728-191053-5far / 현장 김주연 총괄 thread 1785232944.171229)
---

# T-20260728-foot-NIGHT-HOLIDAY-COPAY-TRUNCATE — 야간·공휴일 급여 자부담 가산 경로 10원 절사 미적용 fix

## 요청 (P1, GO_WARN, 김주연 총괄)
야간·공휴일 급여 진료 수납 시 가산금(30%/50%)이 포함되면 급여 자부담(본인부담금)에 10원 미만
절사(원 미만→10단위 내림)가 미적용. 예: 7,283원 → 7,280 으로 안 깎이고 7,283 그대로 청구.
가산금 없는 경로는 정상 절사됨 → 가산금 경로만 절사 우회.

## RC (진단)
- `PaymentMiniWindow.tsx` 수납 grain 정산 파생식:
  `payCopaymentWithSurcharge = payCopaymentTotal + settleSurcharge.copay` (절사 지점 없음).
- `payCopaymentTotal`(copayFromBase)은 100원 FLOOR → 항상 10원 배수 → **가산-무 경로는 구조적으로 절사됨**.
- 가산 본인분 `settleSurcharge.copay = Math.round(amount × ratio)`는 임의 원단위. 본인부담이 100원
  배수가 아닌 등급(정액제 등)에서 합이 10원 배수가 아니게 되는데도 재-절사 지점 부재 → 우수리 청구.

## 해소 (AC 충족)
- **AC-1**: 급여 진료비 + 가산금 합산 후 급여 자부담에 10원 미만 FLOOR 적용.
  `payCopaymentWithSurcharge = computeBillDetailRounding(payCopaymentTotal + sc.copay).roundedTotal`.
- **AC-2**: 가산 없음(sc.copay=0, kind=null) → FLOOR(payCopaymentTotal)=payCopaymentTotal(이미 10원 배수)
  → 값 불변. 회귀 0.
- **AC-3**: 절사 base = 본인부담(30%) 최종액. 공단부담액(insuranceCoveredWithSurcharge)·진료비 총액
  (grandTotalWithSurcharge) = 절사와 직교 → 산식 불변(법정 표기 칸 무접촉).
- **AC-4**: 신규 라운딩 함수 신설 0. 배포된 SSOT `computeBillDetailRounding`(BILLDOC-GONGDAN-ROUND
  deployed) 재사용. 문서 렌더(applyPostSurchargePaidTokens `patient_amount` FLOOR, L1904)와 동일 SSOT
  → 절사값 정합(비급여 10원 배수 전제 하 combined FLOOR == 본인 FLOOR + 비급여).
- 선수금 차감 경로(`calcDeductAmount`)도 동일 패턴 적용 → deduct-mode 우수리 동반 제거.

## 수정 파일
- `src/components/PaymentMiniWindow.tsx`
  - `payCopaymentWithSurcharge` = computeBillDetailRounding(...) FLOOR.
  - `payableTotalWithSurcharge` = 절사 본인부담 + 비급여 파생(기존 `payableTotal` 소멸).
  - `calcDeductAmount` = 절사 본인부담 + 비급여.

## 검증
- `npm run build` ✓
- E2E: `tests/e2e/T-20260728-foot-NIGHT-HOLIDAY-COPAY-TRUNCATE.spec.ts` 10/10 pass.
  - 시나리오1 (가산 절사): base 8,800·본인 2,640(정액 10원 배수) + 30% → raw 3,432 → FLOOR 3,430,
    공단 8,008·총액 11,440 불변, 문서 patient_amount FLOOR 정합.
  - 시나리오2 (무가산 회귀 0): 평일 값 불변 / 정률 100원 배수 가산 no-op / 비급여 only no-op.
  - 티켓 실사례 SSOT 확인: computeBillDetailRounding(7283)=7280.
- 회귀: SATURDAY-SURCHARGE-SUSU / -CONSULTFEE-SETTLE / PMW-PREPAID-DEDUCT-COPAY-BASE spec pass.
  (BALANCE-SPLIT spec 6건은 origin/main **pre-existing** 실패 — 본 변경 revert 후 동일 실패 확인, 무관.)

## 배포
- db_change=false · FE-only · Revenue Insurance Split 무접촉. backfill 불요.
- 브랜치 `ticket/T-20260728-foot-NIGHT-HOLIDAY-COPAY-TRUNCATE` push. supervisor QA → origin/main merge → CF Pages 자동배포.
