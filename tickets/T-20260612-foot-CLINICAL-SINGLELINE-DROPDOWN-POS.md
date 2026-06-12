---
id: T-20260612-foot-CLINICAL-SINGLELINE-DROPDOWN-POS
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-06-12
completed: 2026-06-12
deadline: 2026-06-15
db_changed: false
db_migration: none
db_gate: N/A
audit_only: false
code_mutation: true
verdict: FIXED
data_arch_consult: "비해당 — FE-only(드롭다운 좌표/z-index), 신규 컬럼·테이블·enum 0건 (§S2.4 CONSULT gate 미적용)"
author: dev-foot
reporter: 문지은 대표원장
---

# T-20260612-foot-CLINICAL-SINGLELINE-DROPDOWN-POS — 진료대시보드 한 줄 임상경과 단축어 드롭다운 가려짐 (FE-only)

## 증상 (문지은 대표원장)
진료대시보드(DoctorCallDashboard) 테이블뷰의 임상경과 '한 줄 입력'(clinical-singleline-input)에서
단축어(//상용구) 키워드 입력 시 드롭다운이 텍스트칸·다음 행 **뒤로 가려져 안 보임**.

## 루트코즈
`MedicalChartPanel.tsx` `clinicalSingleLineBody` 의 팝오버가 `absolute left-0 right-0 top-full z-[200]` 로,
부모(진료대시보드 테이블 행)의 stacking context / overflow 에 갇혀 다음 행 뒤로 깔리고 클리핑됨.
부모 T-20260611-foot-DOCDASH-TABLEVIEW-CONVERGE(d097fbb)가 신규 single-line surface 를 만들 때
textarea 변형의 portal/fixed 좌표 로직을 이식하지 않은 것이 원인.

## 수정 (선례 재사용)
PHRASE-SLASH-DROPDOWN-POS(4e8df2b) 패턴 — `document.body` portal + `position:fixed` + `z-[200]` +
viewport flip/clamp — 을 **single-line 분기에 한정** 적용.
- ⚠ 공유 유틸 `getTextareaCaretRect` 는 **호출만(정의부 무변경)** → PHRASE-BROKEN-REGRESS·PENCHART-PHRASE-INSERT-PINGPONG5 회귀 가드.

## AC 충족
- AC-1 ✓ 드롭다운 portal+fixed+z-[200] 최상위 렌더 — 텍스트칸/다음 행 뒤로 안 가려짐.
- AC-2 ✓ 테이블 하단 행에선 위로 열기(flip, `spaceBelow > 300 ? 아래 : 위`) + viewport(top 8px / left) clamp.
- AC-3 ✓ 자동완성 무회귀 — super/일반 상용구 후보·`applySuperPhraseFromSlash`/`insertPhrase` 핸들러·testid 보존.
- AC-4 ✓ 실브라우저(Chromium) 육안검증 스크린샷 3종 첨부 (BEFORE 가려짐 / AFTER 최상위 / AFTER 하단행 flip).

## 검증
- 빌드: PASS (`tsc -b && vite build`)
- E2E: `tests/e2e/T-20260612-foot-CLINICAL-SINGLELINE-DROPDOWN-POS.spec.ts` 10/10 PASS (unit project)
  - 좌표 불변식(상단/하단 flip/clamp/폭) + 실DOM portal stacking(elementFromPoint) + 소스 정적 회귀 락
- 스크린샷: `evidence/T-20260612-foot-CLINICAL-SINGLELINE-DROPDOWN-POS_{BEFORE_clipped,AFTER_ontop,AFTER_bottomrow_flip}.png`

## 범위
- 변경 파일: `src/components/MedicalChartPanel.tsx`(single-line 분기 한정), `playwright.config.ts`(unit testMatch), 신규 spec.
- DB 변경: 없음.
