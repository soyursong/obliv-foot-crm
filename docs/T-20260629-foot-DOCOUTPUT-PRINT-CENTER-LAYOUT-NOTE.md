# 서류 출력물 페이지 중앙·여백 배치 — 인벤토리·진단·수정 구현노트

> **티켓:** T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT (P2)
> **현장(박장군님):** "서류 출력해보니 전체적으로 중앙 배치가 안 되고 위·좌측으로 쏠림. 아래 공간 많으니 전체적으로 좀 내려와도 될 듯. 전체 재검토 후 반영."
> **범위:** 출력(print/PDF) 경로를 타는 서류 전반의 **페이지 배치(중앙·여백)만**. 편집 팝업 UI(DOCFORM-POPUP-OVERHAUL) 침범 금지. risk GO(순수 print CSS — DB·외부·비즈로직·데이터·신규패키지 무변경).

---

## AC-1 — 출력(print/PDF) 경로 문서 인벤토리 + 현황 진단

### 출력 경로를 타는 서류 ("전체"의 정의)

| 양식(form_key) | 명칭 | 방향 | 진입 경로 | 인쇄 함수 |
|---|---|---|---|---|
| diagnosis | 진단서 | 세로 | DocumentPrintPanel 일괄/재발급, 발행본 데스크 | openBatchPrintWindow / printOpinionDoc |
| treat_confirm | 진료확인서 | 세로 | DocumentPrintPanel | openBatchPrintWindow |
| visit_confirm | 통원확인서 | 세로 | DocumentPrintPanel | openBatchPrintWindow |
| diag_opinion | 소견서 | 세로 | DocumentPrintPanel, 발행본 데스크 | openBatchPrintWindow / printOpinionDoc |
| diag_opinion_v2 | 소견서(v2) | 세로 | DocumentPrintPanel | openBatchPrintWindow |
| payment_cert | 진료비 납입증명서 | 세로 | DocumentPrintPanel | openBatchPrintWindow |
| referral_letter | 진료의뢰서 | 세로 | DocumentPrintPanel | openBatchPrintWindow |
| medical_record_request | 의무기록사본발급신청서 | 세로 | DocumentPrintPanel | openBatchPrintWindow |
| rx_standard | 처방전 | 세로 | DocumentPrintPanel | openBatchPrintWindow |
| bill_receipt | 진료비 계산서·영수증 | 세로 | DocumentPrintPanel, 결제 미니창, 재발급 | openBatchPrintWindow |
| ins_claim_form | 보험청구서 | 세로 | DocumentPrintPanel | openBatchPrintWindow |
| bill_detail | 진료비 세부산정내역 | **가로** | DocumentPrintPanel | openBatchPrintWindow(forceLandscape) |

**범위 외(이 티켓 미변경):**
- `koh_result` 균검사 결과지 — 별도 티켓(BACTCHECK) + §11 의료게이트(KOH 발급, 대표원장 자작 양식) 영역. printKohResult 가 @page 미선언 → 동일 쏠림 가능성 있으나 **게이트·소유권상 본 티켓에서 손대지 않음**(필요 시 원장 컨펌 게이트 하 별도 티켓).
- `동의서`(consent/penchart) — canvas/전자서명 계열, L-006 양식맵 비대상. 별도 렌더 경로.

### 현황 진단 — 왜 "위·좌측 쏠림 + 하단 공백"인가

직전 `T-20260629-foot-DOCPRINT-CENTER-ALIGN`이 양식 wrap 에 `margin:12mm auto`를 넣어 **CSS상 중앙정렬**했고, 헤드리스 하니스도 `.page`(전폭 210mm) 안에서 측정해 좌10/우10/상12/하12mm 로 **PASS** 했다. 그런데 현장은 여전히 쏠림.

**근본원인(괴리의 정체):** 인쇄창의 `.page`가 A4 **전폭(210/297mm) full-bleed** + `@page margin:0`. 실제 프린트 엔진은 이 전폭 page 가 인쇄가능영역(기본 여백 적용 시 ~190mm)을 초과하면 **페이지 전체를 좌상단 앵커로 shrink-to-fit 축소** → 좌·상단 쏠림 + 하단 빈 띠. 헤드리스 하니스는 순수 레이아웃만 재고 `@page` 물리 여백/축소를 **시뮬하지 못해** 이 갭을 놓쳤다(그래서 "하니스 PASS인데 현장 FAIL").

---

## AC-2~4 — 수정: 중앙배치를 "프린트 엔진 @page 물리 여백"이 직접 수행

CSS `margin:auto`(전폭 page 안 중앙정렬)는 엔진 축소에 무력하다. 모델을 전환한다:

- **인쇄창/래퍼가 `@page margin: 12mm 10mm` 소유** → 프린트 엔진이 콘텐츠박스(A4-여백 = 190×273 / 가로 277×186mm)를 **시트 중앙에 물리 배치**. 박스가 인쇄가능영역 안에 들어와 **shrink-to-fit 자체가 사라짐**(좌우 10mm·상하 12mm 대칭, AC-2/3).
- **양식 wrap 은 콘텐츠박스를 채움** — 자체 page 여백 제거(`margin:12mm auto → 0 auto`). 이중여백/콘텐츠 초과(잘림·넘침) 없음(AC-3).
- **공통 단 일괄 처리(AC-4):** 변경은 ① `openBatchPrintWindow`(@page+콘텐츠박스 .page), ② `printOpinionDoc`(raw @page), ③ `htmlFormTemplates` 공통 wrap @media print(form/bill/rx/br + referral 인라인)에 집중. 문서별 인라인 땜질 없음. 처방전 양식이 래퍼 @page 를 덮어쓰던 **템플릿-레벨 `@page margin:0` 제거**(rx 단독 쏠림 재발 차단).
- **레거시 IMG-오버레이 격리:** field_map px 좌표가 210mm page 기준인 양식(`page-img` 마커)은 좌표 보존 위해 기존 `@page margin:0`/전폭 모델 유지(불변).

### 변경 파일
- `src/components/DocumentPrintPanel.tsx` — openBatchPrintWindow HTML/레거시 분기 + page-img 마커
- `src/lib/printOpinionDoc.ts` — raw @page 물리 여백
- `src/lib/htmlFormTemplates.ts` — 공통 wrap @media print(form/bill/rx/br) margin 통일 + rx 템플릿 @page 제거 + referral 인라인

---

## AC-5 — 검증

- **엔진-충실 측정**(인쇄 시트 전체 안쪽 padding = @page 여백 물리 재현 → 콘텐츠박스 안 양식): 전 12종 좌10/우10/상12/하12mm(referral 11/11, bill 12.5/12.5) 대칭 + 콘텐츠박스 미초과(축소 없음) + 단일 페이지. **PASS.**
- spec: `tests/e2e/T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT.spec.ts`(측정 12종 + AC-4 메커니즘 소스 가드). harness: `scripts/T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT_render.mjs`. 직전 CENTER-ALIGN spec/harness 도 엔진-충실 모델로 정밀화.
- 빌드 OK. DOC 회귀 가드군(DOC-PRINT-UNIFY/PRINT-FORM-BIND/DOC-FEATURE-AUDIT-HARDENING/REFERRAL-PRINT-CLIP-CENTER 등) 무회귀(기존 2건 실패는 본 변경과 무관 — payment_cert 타이틀 grep / buildRxItemsHtml, clean HEAD 동일 실패).
- ⚠ **실기기 현장 확인 필요:** Ctrl+P 미리보기 + 실제 갤탭→프린터 출력에서 중앙·여백 동일 확인(AC-5)은 현장 confirm 단계에서 최종 종결.

*owner: dev-foot · 2026-06-30*
