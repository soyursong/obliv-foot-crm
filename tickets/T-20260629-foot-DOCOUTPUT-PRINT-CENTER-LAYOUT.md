---
id: T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT
domain: foot
priority: P2
status: deploy-ready
qa_result: pending
deploy_commit: 66f6d5c4
deployed_at: 2026-06-30T00:00:00+09:00
bundle_hash: pending
summary: "서류 출력물 페이지 중앙·여백 배치 전면 재검토(순수 print CSS). 현장(박장군님): 출력물 전체적으로 중앙배치 안 됨 — 위·좌측 쏠림 + 하단 공백. 근본원인: 직전 CENTER-ALIGN 의 form-wrap margin:12mm auto(전폭 210mm .page 안 CSS 중앙)는 헤드리스 하니스에선 PASS 했으나 실제 프린트 엔진이 전폭 page + @page margin:0 으로 인쇄가능영역(~190mm) 초과 시 페이지 전체를 좌상단 앵커로 shrink-to-fit 축소 → 쏠림 잔존(하니스가 @page 물리 여백/축소 시뮬 못 해 놓침). 수정: 중앙배치를 프린트 엔진 @page 물리 여백이 직접 수행하도록 모델 전환 — openBatchPrintWindow/printOpinionDoc @page margin:12mm 10mm + .page=콘텐츠박스(190×273/277×186mm) → 엔진이 시트 중앙 배치(축소 제거). 공통 wrap @media print margin:12mm auto→0 auto(form/bill/rx/br+referral 인라인), rx 템플릿-레벨 @page margin:0 제거(rx 단독 쏠림 차단). 레거시 IMG-오버레이는 page-img 마커로 격리(좌표 보존, @page margin:0/전폭 유지). koh_result(BACTCHECK+의료게이트)·동의서(canvas) 범위 외, 편집 팝업 UI 미침범. 엔진-충실 spec 13 passed(측정 12종 좌10/우10/상12/하12mm 대칭 + AC-4 소스 가드), 빌드 OK, DOC 회귀 가드군 무회귀."
created: 2026-06-29
assignee: dev-foot
db_change: false
e2e_spec_exempt_reason: n/a
---

# T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT — 서류 출력물 중앙·여백 배치 전면 재검토

## 배경
현장(박장군님): "서류 출력해보니 전체적으로 중앙 배치가 안 되고 위·좌측으로 쏠림. 아래 공간 많으니 전체적으로 좀 내려와도 될 듯. 전체 재검토 후 반영." 특정 1종이 아니라 출력(print/PDF) 경로를 타는 서류 전반(소견서·진료확인서·처방전·영수증 등) 대상.

## 진단(AC-1)
직전 `DOCPRINT-CENTER-ALIGN`이 양식 wrap `margin:12mm auto`로 CSS상 중앙정렬했고 헤드리스 하니스도 좌10/우10mm 로 PASS 했으나, 인쇄창 `.page`가 A4 **전폭(210mm) full-bleed + @page margin:0** → 실제 프린트 엔진이 인쇄가능영역(~190mm) 초과분을 **좌상단 앵커 shrink-to-fit 축소** → 현장 쏠림 잔존. 하니스는 @page 물리 여백/축소를 시뮬 못 해 갭을 놓침.

## 수정(AC-2~4)
중앙배치를 **프린트 엔진의 @page 물리 여백**이 직접 수행하도록 모델 전환. `@page margin:12mm 10mm` + 콘텐츠박스(190×273/가로 277×186mm) → 엔진이 시트 중앙 배치, 축소 제거. 공통 print 단(@page+@media print) 일괄 처리, 문서별 인라인 땜질 없음. 레거시 IMG-오버레이(field_map px=210mm 기준)는 `page-img` 마커로 격리(좌표 보존).

- `src/components/DocumentPrintPanel.tsx`, `src/lib/printOpinionDoc.ts`, `src/lib/htmlFormTemplates.ts`

## 검증(AC-5)
- spec: `tests/e2e/T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT.spec.ts` (엔진-충실 측정 12종 + AC-4 메커니즘 소스 가드) — 13 passed.
- harness: `scripts/T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT_render.mjs`. 구현노트: `docs/T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT-NOTE.md`.
- 빌드 OK. DOC 회귀 가드군 무회귀(기존 2 실패는 본 변경과 무관).
- ⚠ 실기기 현장 확인: Ctrl+P 미리보기 + 갤탭→프린터 실출력 동일 확인(AC-5)은 현장 confirm 단계에서 최종 종결.

## 범위 경계
편집 팝업 UI(DOCFORM-POPUP-OVERHAUL) 미침범. koh_result(BACTCHECK + §11 의료게이트 KOH 발급)·동의서(canvas) 범위 외. risk GO(순수 print CSS, DB·외부·비즈로직·데이터·신규패키지 무변경).
