---
id: T-20260702-foot-DOCPRINT-BROWSERHEADER-REMOVE
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 98d549b1 (fix(foot): 전 서식 인쇄 브라우저 자동 헤더 2종 제거 — @page margin:0 + 콘텐츠 padding 이관)
deployed_at: n/a (코드 origin/main 반영 — Vercel 자동배포·supervisor QA 대기)
bundle_hash: n/a (NOT yet verified on prod)
db_change: false
e2e_spec: tests/e2e/T-20260702-foot-DOCPRINT-BROWSERHEADER-REMOVE.spec.ts (23 시나리오 — AC-1/2 소스 introspection 5경로 @page margin:0 + 비-0 잔재 0, AC-3/4 렌더 실측 全12양식 중앙배치·단일페이지·본문폭 회귀 없음, 全 PASS)
medical_confirm_gate: n/a (print-only 표현 레이어 = @page margin/콘텐츠 padding 만 변경. 진료대시보드·진료관리 화면 로직/의료콘텐츠 무접촉. printOpinionDoc/printKohResult 는 의사문서 인쇄 래퍼이나 본문·발행로직 불변·헤더여백만 조정 → planner risk=GO(DA/대표게이트 불요)와 정합, §11/§11.1 게이트 무관)
summary: "현장(김주연 총괄) 요청 — 전 서식 인쇄 시 브라우저 window.print() 자동 삽입 헤더 2종(①좌상단 인쇄일시 '26.7.2 오후12:33' ②우상단 document.title='서류 출력 …') 완전 제거. RC: 크롬/사파리는 @page margin>0 여백 박스에 인쇄일시(좌)·title(우)을 네이티브 자동 삽입하며 CSS로 개별 숨김 불가 — 직전 CENTER-ALIGN 모델이 중앙배치를 @page margin(30 10 12)으로 수행해 그 여백이 곧 헤더 캔버스가 됨. 수정(표현 레이어만): 전 인쇄 경로 @page margin:0(여백 박스 소멸→헤더 삽입 물리 불가) + 구 물리여백(상30·좌우10·하12mm)을 .page/body padding 으로 이관, box-sizing:border-box+전폭(210/297mm)로 콘텐츠박스 190×255/277×168mm 물리 위치 불변→중앙배치 회귀 없음(legacy-img 분기가 이미 @page:0+전폭210mm로 프로덕션 검증). 적용: openBatchPrintWindow(DocumentPrintPanel)·buildPrintHtml(PaymentMiniWindow 경로4)·printOpinionDoc·printKohResult·printInvoice·PhotoUpload — 처방전·진료비 세부산정내역 포함. 상단 빈 여백 없이 깔끔 처리(padding=구 여백과 동일). 병렬 신규 print 경로·중복 헤더 컴포넌트 신설 없이 기존 출력 스택 내 수정(conflict_detail 준수). Closing(일마감/결제내역)은 서식 아님→범위 외. build OK, db_change=false, 무스키마·무RLS. spec 23 PASS + DOCOUTPUT-PRINT-CENTER-LAYOUT 소스가드 신규모델 갱신. 3건 스펙 실패(REFERRAL-CENTER-CLIP·DOC-PRINT-UNIFY isHtmlTemplate 2건)는 clean HEAD에서도 실패하는 사전존재 이슈로 본 변경 무관."
created: 2026-07-02
assignee: dev-foot
owner: agent-fdd-dev-foot
---

## 요청 (planner NEW-TASK, MSG-20260702-172130-5wwg)
현장(김주연 총괄, C0ATE5P6JTH, thread 1782979355) — obliv-foot-crm 전 서식 인쇄 시 상단 자동 삽입 헤더 2종 제거:
- ① 좌측 상단 인쇄 날짜·시간 (예: '26. 7. 2. 오후 12:33')
- ② 우측 상단 '서류 출력 — {출력자명}' (문서명+출력자)

수용기준:
- 처방전·진료비 세부산정내역 포함 출력 가능 전 서식에서 위 2요소 제거
- 제거 후 상단 빈 여백 없이 깔끔 처리
- 서식 본문 데이터·레이아웃 회귀 없음

조정 조건(conflict_detail): 동일 thread·동일 축(foot 서류출력) 다수 진행 중 — RX-FEEBREAKDOWN-LAYOUT(P1)·
DOC-PRINT-8FIX·CHART2-RECEIPT-RESTRUCTURE 와 직교(레이아웃정합 vs 자동헤더제거)이나 동일 출력 스택/print CSS
안에서 수정. 병렬 신규 print 경로·중복 헤더 컴포넌트 신설 금지.

risk=GO (print-only, 무스키마·무RLS, DA/대표게이트 불요).

## 근본원인 (RC — 추정 아닌 렌더 경로 확인)
현장이 본 2요소는 앱 커스텀 헤더가 아니라 **브라우저 window.print() 네이티브 헤더**다:
- ① 좌상단 = 인쇄일시 (크롬 top-left margin box)
- ② 우상단 = document.title (여기선 `서류 출력 — {name}` / `진료비 영수증 — {name}` 등)
크롬·사파리는 @page margin 이 0 보다 크면 그 여백 박스에 인쇄일시·제목을 자동 삽입하고, 이를 개별 CSS로
숨길 방법이 없다(사용자 인쇄대화상자 'Headers and footers' 옵션에만 종속). 직전 DOCPRINT-CENTER-ALIGN
모델이 콘텐츠 중앙배치를 `@page margin: 30mm 10mm 12mm` 로 수행 → 그 물리여백 박스가 그대로 헤더 캔버스가
되어 노출된 것이 원인.

## 수정 (표현 레이어만 — 구조/데이터/발행로직 불변)
전 인쇄 경로에서 `@page margin: 0` 으로 여백 박스를 소멸(→ 브라우저 헤더 삽입 물리 불가)시키고, 중앙배치용
물리여백(상30·좌우10·하12mm)을 콘텐츠 padding 으로 이관:
| 경로 | 파일 | 변경 |
|------|------|------|
| 일괄/단일 서류출력(처방전 등) | DocumentPrintPanel.openBatchPrintWindow | @page:0 + `.page` padding 30 10 12 (전폭 210/297mm, border-box) |
| 진료비 영수증 재발급/영수증 | DocumentPrintPanel.printInvoice | @page:0 + body padding 유지 |
| 결제미니창(1순위, 세부산정내역) | PaymentMiniWindow.buildPrintHtml | 경로1과 완전 동일 @page:0+padding |
| 소견서/진단서 | printOpinionDoc | @page:0 + body padding 30 10 12 |
| 검사결과 보고서 | printKohResult | @page:0 신설 + body padding 12mm |
| 비포/애프터 사진 | PhotoUpload | @page 12mm→0 + body padding 12mm |

legacy-img(page-img, field_map px 좌표 210mm 기준) 분기는 기존 @page:0/전폭 유지 → 좌표 불변, 헤더도 원래 없음.
Closing(일마감/결제내역)은 환자 서식이 아닌 운영 리포트 → 범위 외(스택 경계 준수).

## 수용기준 결과
- AC(헤더 2종 제거): @page margin:0 로 여백 박스 자체 소멸 → 인쇄일시·title 삽입 물리 불가. ✅
  (브라우저 네이티브 헤더는 headless PDF에 렌더 안 됨 → 소스 introspection 으로 전 경로 margin:0 소유·비-0 잔재 0 가드)
- AC(상단 빈 여백 없이 깔끔): padding=구 @page 물리여백과 동일 수치 → 상단 30mm 하향 위치 그대로, 여분 띠 없음. ✅
- AC(본문 데이터·레이아웃 회귀 없음): 렌더 실측 全12양식 — 좌우대칭·상~30/하>5mm·wrap폭≤콘텐츠박스·단일페이지. ✅
- AC(처방전·세부산정내역 포함): rx_standard·bill_detail(landscape) 포함 전 양식 커버. ✅
- 회귀: DOCOUTPUT-PRINT-CENTER-LAYOUT 중앙배치 렌더 가드 全 PASS(물리 위치 불변). ✅

빌드 OK. db_change 없음. spec 23 PASS. supervisor QA 대기.
