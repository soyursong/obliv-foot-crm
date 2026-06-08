---
id: T-20260608-foot-DOC-REISSUE-SYNC
domain: foot
status: deploy-ready
priority: P1
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260608-foot-DOC-REISSUE-SYNC.spec.ts
qa_result: pass
deploy_commit: e329417
created: 2026-06-08
deadline: 2026-06-11
---

# T-20260608-foot-DOC-REISSUE-SYNC — PATH-4 빌링 로직 차트1/2 재발행 수렴

현장(김주연 총괄) 4차 가속 지시 (MSG-20260608-110203-f1w8 / 핵심 MSG-...105652-7pwi):
> "그냥 결제 미니창에 구현된 기능 그대로 가져가서 1/2번차트에 똑같이 붙여줘."

## 문제 (진단 — 선행 세션 T-20260608-foot-DOC-PATH12-SYNC)
- PATH-4(PaymentMiniWindow)는 화면 라이브 상태(`selectedItems` + `customAmounts` 수기조정가)로
  서류를 빌드 → 수정사항이 출력물에 반영됨.
- PATH-1/2/3(DocumentPrintPanel)은 `service_charges`(보험 copay 산출 감사로그) 직결로 빌드 →
  PMW 수기조정(= `check_in_services`)이 닿지 않아 재발행 서류에 "하나도 연동 안 됨".

## 해결 — 공유 SSOT 수렴 (복붙 분기 금지, AC-4)
- `src/lib/footBilling.ts` 신규: PMW 로컬 빌링 로직 추출
  (`getTaxClass`/`isCodeItem`/`COVERED_GRADES` + `computeFootBilling`/`loadFootBillingItems`/
  `loadCustomerInsuranceGrade`/`buildFootBillDetailItems`).
- PaymentMiniWindow(PATH-4): 로컬 정의 제거 → footBilling 재사용 (동작 1:1 불변).
- DocumentPrintPanel(PATH-1/2/3): `service_charges` 미기록 경로에서 `check_in_services`(PMW
  수기조정 영속본) 기반 폴백. `applyBillingFallback`로 autobind 값 존재 시 보존(무파괴).

## Acceptance Criteria
- [x] AC-2: 4경로 동일 렌더 = L-006 단일 SSOT (DocumentPrintPanel). PATH-3/4 산출 deep-equal.
- [x] AC-3: 기존 PATH-1/2 무파괴 — `service_charges` populated 시 폴백 미발동 게이팅.
- [x] AC-4: DocumentPrintPanel 우회 직접 print() 신규 경로 없음 — 공유 모듈 수렴.
- [x] 시나리오 1/2 렌더 E2E 대조 — PATH-3 vs PATH-4 출력물 bill_detail HTML 100% 일치.

## 검증
- tsc(`tsconfig.app.json --noEmit`) OK · `npm run build`(vite) OK
- E2E 신규 7 통과 (`tests/e2e/T-20260608-foot-DOC-REISSUE-SYNC.spec.ts`)
- L-006 회귀 226 통과 (DOC-PRINT-UNIFY / DOC-FIELD-MISSING-3 / DOC-AUTOBIND-REGRESS / INS-DOC-COPAY-LINK)
- lint: `@eslint/js` 미설치 사전 환경이슈로 미실행 — tsc로 대체 검증
- DB 변경 없음

## 미커밋 무관 파일 (별도 티켓)
- `rollback/rollback_foot_dummy_link_20260608.sql`, `scripts/_diag_foot_dummy_20260608.mjs`,
  `scripts/_fix_foot_dummy_link_20260608.mjs` — foot_dummy_link 건으로 본 커밋 미포함.
