// LOGIC-LOCK: L-006 — 서류출력 경로 통일. bindHtmlTemplate + HTML 11종 양식 정의. 변경 시 현장 승인 필수

/**
 * HTML/CSS 기반 디지털 양식 템플릿
 *
 * T-20260514-foot-FORM-CLARITY-REWORK
 * 기존 PNG 배경 + 좌표 오버레이 방식 → 순수 HTML/CSS 재현.
 * 인쇄 품질 수준 렌더링 (`@media print` A4 포함).
 *
 * 변수 바인딩: `{{variable_key}}` 플레이스홀더 → `bindHtmlTemplate()` 치환.
 *
 * 대상 5종:
 *   diagnosis      — 진단서
 *   treat_confirm  — 진료확인서
 *   visit_confirm  — 통원확인서
 *   diag_opinion   — 소견서
 *   bill_detail    — 진료비 세부산정내역
 *
 * @see T-20260514-foot-FORM-CLARITY-REWORK
 */

// ─── 공통 스타일 ───

const COMMON_STYLE = `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .form-wrap {
      font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', NanumGothic, sans-serif;
      font-size: 10pt;
      color: #000;
      background: #fff;
      padding: 8mm 10mm;
      width: 190mm;
      min-height: 267mm;
      /* T-20260611-foot-DOC-FORM-TITLE-CENTER-6: 기본 form-wrap(190mm) margin auto 미적용으로
         page 중앙 대비 제목 ~10mm 좌측 이탈. 좌우 auto 중앙정렬 추가 → 진단서·진료확인서·통원확인서·
         소견서·진료비납입증명서·의무기록사본발급신청서·소견서v2·보험청구서 일괄 중앙정렬.
         의뢰서(REFERRAL_LETTER_HTML)는 인라인 margin:12mm auto가 본 규칙을 override → 회귀 없음. */
      margin: 0 auto;
    }
    table { width: 100%; border-collapse: collapse; }
    td, th {
      border: 1px solid #000;
      padding: 3px 5px;
      vertical-align: middle;
      font-size: 9pt;
    }
    th { background: #f0f0f0; font-weight: bold; text-align: center; }
    .title {
      text-align: center;
      font-size: 19pt;
      font-weight: bold;
      letter-spacing: 10px;
      padding: 6px 0 4px;
    }
    .subtitle { text-align: center; font-size: 9pt; margin-bottom: 4px; }
    .section { margin-top: 4px; }
    .stamp-box {
      border: 1px solid #000;
      width: 72px; min-height: 54px;
      display: inline-flex; flex-direction: column;
      align-items: center; justify-content: center;
      font-size: 8pt; text-align: center;
      padding: 4px;
    }
    .legal-text {
      font-size: 9pt;
      border: 1px solid #000;
      padding: 5px 8px;
      margin-top: 4px;
      background: #fff;
    }
    .confirm-text {
      font-size: 11pt;
      font-weight: bold;
      text-align: center;
      padding: 8px 0;
      border: 1px solid #000;
      margin-top: 4px;
    }
    .row-flex { display: flex; align-items: stretch; }
    .label-cell {
      border: 1px solid #000;
      padding: 3px 6px;
      background: #f8f8f8;
      white-space: nowrap;
      font-size: 9pt;
      display: flex; align-items: center;
    }
    .value-cell {
      border: 1px solid #000;
      padding: 3px 6px;
      flex: 1;
      font-size: 9pt;
      min-height: 22px;
    }
    .diag-type-row {
      display: flex;
      gap: 16px;
      align-items: center;
      border: 1px solid #000;
      padding: 4px 8px;
      margin-top: -1px;
    }
    .diag-type-item { display: flex; align-items: center; gap: 4px; font-size: 9pt; }
    .circle { display: inline-block; width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid #000; }
    .circle-filled { background: #111; }
    .large-area { min-height: 60px; }
    /* T-20260515-foot-FORM-ONELINE-RX: 라벨 셀 한줄 정렬 — background:#f8f8f8 셀 전체 적용 */
    td[style*="background:#f8f8f8"] { white-space: nowrap; font-size: 8.5pt; text-align: center; }
    /* T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT: 출력물 중앙·여백 배치 전면 재검토(표현 레이어만 — 구조/데이터/발행로직 불변).
       증상(현장 박장군님): 출력해보니 전체적으로 중앙배치 안 됨 — 위·좌측 쏠림 + 아래 공간 과다.
       근본원인: 직전 CENTER-ALIGN 은 form-wrap 을 margin:12mm auto 로 .page(210mm) 안에서 CSS상 중앙
                 정렬했으나, 인쇄창 .page 가 A4 전폭(210mm) full-bleed + @page margin:0 이라 실제 프린트
                 엔진이 인쇄가능영역(기본여백 적용 시 ~190mm)을 초과 → shrink-to-fit 으로 페이지 전체를
                 좌상단 앵커로 축소 → 좌·상단 쏠림 + 하단 빈 띠가 잔존(헤드리스 하니스는 @page 여백/축소를
                 물리 시뮬 못 해 이 갭을 놓침).
       수정: 중앙배치를 CSS margin 이 아니라 "프린트 엔진의 @page 물리 여백"이 직접 수행하도록 모델 전환.
             인쇄창(openBatchPrintWindow)·raw 경로(printOpinionDoc)가 @page margin:12mm 10mm 를 소유 →
             콘텐츠박스(A4-여백 = 190×273mm)가 엔진에 의해 물리적으로 중앙 배치(좌우 10mm·상하 12mm 대칭,
             축소 없음). form-wrap 은 콘텐츠박스를 채우므로 자체 page 여백을 갖지 않는다(margin:0 auto — auto 는
             박스가 미세하게 넓을 때의 좌우 중앙 belt). min-height:273mm(=297-24) 유지 → 단일 페이지·넘침/잘림 없음.
             @page 는 인쇄창 래퍼가 소유 → 템플릿에서 선언하지 않음(중복·landscape 충돌 방지). */
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      /* T-20260629-foot-DOCPRINT-CENTER-ALIGN(REOPEN/AC-5): 인쇄창 @page 상단여백 12mm→30mm 하향에 맞춰
         콘텐츠박스 높이 273mm→255mm(=297-30-12)로 축소.
         T-20260629-foot-DOCPRINT-CENTER-ALIGN(REOPEN/AC-6): 상단 30mm→23mm(2줄↑) 재조정에 맞춰
         콘텐츠박스 255mm→262mm(=297-23-12)로 확대 → 하단 12mm 클립가드 유지·단일 페이지·넘침/잘림 없음. */
      .form-wrap { width: 190mm; min-height: 262mm; padding: 6mm 8mm; margin: 0 auto; }
      td[style*="background:#f8f8f8"] { white-space: nowrap; font-size: 8.5pt; text-align: center; }
    }
  </style>
`;

// ─── 진단서 ───

const DIAGNOSIS_HTML = `
${COMMON_STYLE}
<div class="form-wrap">
  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:2px;">
    <div style="flex:1"></div>
    <div class="title" style="flex:none; padding:0 32px;">진 단 서</div>
    <div style="flex:1; display:flex; justify-content:flex-end;">
      <div class="stamp-box">원부대조필<br>인</div>
    </div>
  </div>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td style="width:70px; background:#f8f8f8; white-space:nowrap;">등 록 번 호</td>
        <td style="width:140px;">{{record_no}}</td>
        <td style="width:60px; background:#f8f8f8; white-space:nowrap;">연 번 호</td>
        <td>{{visit_no}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">환자의 성명</td>
        <td>{{patient_name}}</td>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt;">환자의<br>주민등록번호</td>
        <td>{{patient_rrn}}</td>
      </tr>
      <!-- T-20260629-foot-DOCPRINT-COLWIDTH-WRAP-AUDIT: 주소·전화를 각각 전폭(colspan=3) 행으로 분리 → 긴 주소 단일 줄 확보 -->
      <tr>
        <td style="background:#f8f8f8;">환자의 주소</td>
        <td colspan="3">{{patient_address}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; white-space:nowrap;">전화번호</td>
        <td colspan="3">{{patient_phone}}</td>
      </tr>
    </tbody>
  </table>

  <!-- T-20260629-foot-DOCPRINT-COLWIDTH-WRAP-AUDIT: 병명 블록을 환자정보 표와 분리.
       이전: 동일 표 공유 → 상병명 칸이 위 행의 '연번호'(width:60) 컬럼에 묶여 좁아짐(긴 상병명 줄바꿈).
       수정: 별도 표로 분리(소견서와 동일 구조) → 상병명 컬럼이 잔여 폭(~428px) 확보, 단일 줄 출력. -->
  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td rowspan="5" style="width:60px; background:#f8f8f8; text-align:center; vertical-align:middle; font-weight:bold; font-size:10pt; letter-spacing:2px;">병&nbsp;&nbsp;명</td>
        <td style="background:#f0f0f0; text-align:center; width:100px;">상병코드</td>
        <td style="background:#f0f0f0; text-align:center;">상&nbsp;&nbsp;&nbsp;병&nbsp;&nbsp;&nbsp;명</td>
        <td style="background:#f0f0f0; text-align:center; width:70px;">특 정 기 호</td>
      </tr>
      <tr>
        <td style="min-height:30px; padding:6px 5px;">{{diag_code_1}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_name_1}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_flag_1}}</td>
      </tr>
      <tr>
        <td style="min-height:30px; padding:6px 5px;">{{diag_code_2}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_name_2}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_flag_2}}</td>
      </tr>
      <tr style="{{diag_row_3_style}}">
        <td style="min-height:30px; padding:6px 5px;">{{diag_code_3}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_name_3}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_flag_3}}</td>
      </tr>
      <tr style="{{diag_row_4_style}}">
        <td style="min-height:30px; padding:6px 5px;">{{diag_code_4}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_name_4}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_flag_4}}</td>
      </tr>
    </tbody>
  </table>

  <div style="display:flex; border:1px solid #000; border-top:none; gap:0;">
    <div style="border-right:1px solid #000; padding:5px 10px; display:flex; align-items:center; gap:6px;">
      <span class="circle circle-filled"></span>
      <span style="font-size:9pt;">임상적추정</span>
    </div>
    <div style="border-right:1px solid #000; padding:5px 10px; display:flex; align-items:center; gap:6px;">
      <span class="circle"></span>
      <span style="font-size:9pt;">최 종 진 단</span>
    </div>
    <div style="padding:5px 10px; display:flex; align-items:center; gap:6px;">
      <span class="circle"></span>
      <span style="font-size:9pt;">임상적진단</span>
    </div>
  </div>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td style="width:60px; background:#f8f8f8;">발 병 일</td>
        <td>{{onset_date}}</td>
        <td style="width:60px; background:#f8f8f8;">진 단 일</td>
        <td>{{issue_date}}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td style="width:80px; background:#f8f8f8; vertical-align:middle; text-align:center; line-height:1.6;">
          치료내용/향후<br>치료에 대한<br>소&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;견
        </td>
        <td style="min-height:80px;" class="large-area">{{treatment_opinion}}</td>
      </tr>
    </tbody>
  </table>

  <!-- T-20260617-foot-DOCFORM-POPUP-OVERHAUL G6/AC-3: 향후 치료기간 전용 행(치료내용/소견과 분리). -->
  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td style="width:80px; background:#f8f8f8; vertical-align:middle; text-align:center; line-height:1.6;">향후<br>치료기간</td>
        <td>{{future_treatment_period}}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td rowspan="2" style="width:60px; background:#f8f8f8; text-align:center; vertical-align:middle; font-size:8pt;">입·퇴원<br>연 월 일</td>
        <td style="width:50px; background:#f8f8f8; text-align:center;">입원일</td>
        <td colspan="4">{{admission_date}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">퇴원일</td>
        <td colspan="4">{{discharge_date}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">용&nbsp;&nbsp;&nbsp;도</td>
        <td colspan="5">{{purpose}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">비&nbsp;&nbsp;&nbsp;고</td>
        <td colspan="5">{{memo}}</td>
      </tr>
    </tbody>
  </table>

  <div class="legal-text" style="margin-top:4px;">
    「의료법」 제17조 및 같은 법 시행규칙 제 9조제1항에 따라 위와 같이 진단합니다.
  </div>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td style="width:60px; background:#f8f8f8;">발 행 일</td>
        <td style="width:130px;">{{issue_date}}</td>
        <td style="background:#f8f8f8; width:50px;">의사</td>
        <td style="width:16px; text-align:center;">☑</td>
        <td style="background:#f8f8f8; width:60px;">치과의사</td>
        <td style="width:16px; text-align:center;">☐</td>
        <td style="background:#f8f8f8; width:50px;">한의사</td>
        <td style="width:16px; text-align:center;">☐</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">의 료 기 관</td>
        <!-- T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT: 요양기관명 축 재배선 (진단서) -->
        <td colspan="7">{{hira_institution_name}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt;">주소 및 명칭</td>
        <td colspan="7">{{clinic_address}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt;">전화 및 팩스</td>
        <td colspan="7">{{clinic_phone}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">면 허 번 호</td>
        <td colspan="3">제&nbsp;{{doctor_license_no}}&nbsp;호</td>
        <td style="background:#f8f8f8; white-space:nowrap;">의 사 성 명</td>
        <!-- T-20260718-foot-DOCPRINT-DIAGNOSIS-DOCTOR-BIND: 진단서 진료의 성명 = 진단서 전용 {{attending_doctor_name}}
             (실 의료인·사람, clinicDoctor 기준). ★{{doctor_name}}(billing 대표자 축)은 미지정 시 기관명으로 폴백
             (T-20260713 UNLINKED, field-confirmed)해 진단서 '의사 성명'이 기관명으로 찍혀 진료의 신원 오표기(법정
             문서 결함) → 처방전(prescriber_name, P1 RX-DOCTOR-BIND)과 동일 축 오염 분리. 면허번호({{doctor_license_no}})는
             이미 clinicDoctor.license_no 바인딩 = 성명과 동일 사람 기준 → 이름↔면허 정합. -->
        <td colspan="2">{{attending_doctor_name}}</td>
        <td style="text-align:center; vertical-align:middle; min-width:52px; padding:2px;">{{doctor_seal_html}}</td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ─── 진료확인서 ───

const TREAT_CONFIRM_HTML = `
${COMMON_STYLE}
<div class="form-wrap">
  <!-- T-20260729-foot-DOC-LAYOUT-FIX ③: 제목 아래 여백 2px→12px (인라인, COMMON_STYLE 무접촉). -->
  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
    <div style="flex:1"></div>
    <div class="title" style="flex:none; padding:0 20px;">진 료 확 인 서</div>
    <!-- T-20260630-foot-DOCPRINT-WONBU-SEAL-REMOVE: 진료확인서 우측상단 '원부대조필인' 삭제(김주연 총괄). 빈 flex:1 유지 → 제목 중앙정렬 불변 -->
    <div style="flex:1;"></div>
  </div>
  <!-- T-20260601-foot-DOC-PRINT-8FIX AC-5③: 상단 진단 비표시 안내 문구 제거됨 -->

  <!-- T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX ①: 상단 섹션(병록번호~연령/성별) 좌우 50:50.
       라벨15%+값35% 좌우 대칭 → 좌·우 반반. table-layout:fixed 로 첫 행 폭 고정(colspan 행 정합). -->
  <table style="table-layout:fixed;">
    <tbody>
      <tr>
        <td style="width:15%; background:#f8f8f8;">병 록 번 호</td>
        <td style="width:35%;">{{record_no}}</td>
        <td style="width:15%; background:#f8f8f8;">연 령</td>
        <td style="width:35%; white-space:nowrap;">만&nbsp;<strong>{{patient_age}}</strong>&nbsp;세</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">연 번 호</td>
        <td>{{visit_no}}</td>
        <td style="background:#f8f8f8;">성별</td>
        <!-- T-20260601-foot-DOC-PRINT-8FIX AC-5①: 성별 하드코딩 → 주민번호 산출 바인딩 -->
        <td>{{patient_gender}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">주&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;소</td>
        <td colspan="3">{{patient_address}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">환자 성명</td>
        <!-- T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX ②: 성명 옆 불필요한 막음칸(빈 셀) 제거 → 성명 값 colspan=3 전폭.
             구 disease_display_note placeholder 셀(3FIX, 상시 공란) + 빈 td 삭제.
             상병 표시는 CODE 변형의 DISEASE_BLOCK 가 전담(불변) → 바인딩 컨텍스트 무영향. -->
        <td colspan="3">{{patient_name}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">주 민 번 호</td>
        <td colspan="3">{{patient_rrn}}</td>
      </tr>
    </tbody>
  </table>

  <!-- T-20260622-foot-VISITCERT-DISEASE-FUTURETX-HIDE: 상병(병명)·진단분류 비노출.
       현장 요청(김주연 총괄, 2026-06-22) — 진료확인서에서 상병명 항목을 화면·인쇄 모두 미표시.
       병명(상병코드·상병명·특정기호) 테이블 + 진단확신도 분류 표시줄 제거.
       diag 바인딩 컨텍스트·발행/published 트리거 불변 — 템플릿에서 미렌더할 뿐. -->

  <!-- T-20260723-foot-DOCCONFIRM-SERIAL-ENDDATE-PURPOSE ①: 치료기간 '까지' 고아토큰({{discharge_date}}=미바인딩)
       → {{visit_date}} 교체(단일방문 부터=까지) 유지(진단서 '퇴원일' {{discharge_date}}은 무접촉).
       T-20260731-foot-DOCFORM-URGENT-6FIX AC-2: 입원 행 복원 + 치료기간 셀 rowspan="2" 복원(법무팀 2026-07-31,
       진료·통원확인서 대칭). "빈칸이라도 입원 칸은 넣는다" — T-20260723 ④의 '외래전용이라 제거' 근거 폐기. 입원 행 값 영구 공란. -->
  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td rowspan="2" style="width:50px; background:#f8f8f8; text-align:center; vertical-align:middle; font-size:8.5pt;">치료<br>기간</td>
        <td style="width:50px; background:#f8f8f8; text-align:center;">외래</td>
        <td>{{visit_date}}</td>
        <td style="width:30px; text-align:center;">부터</td>
        <td>{{visit_date}}</td>
        <td style="width:30px; text-align:center;">까지</td>
        <td style="width:50px; text-align:center;">(치료</td>
        <td style="width:40px; text-align:right;">{{visit_days}}</td>
        <td style="text-align:left;">일간)</td>
      </tr>
      <!-- T-20260731-foot-DOCFORM-URGENT-6FIX AC-2: 입원 행 복원(법무팀 2026-07-31, 통원확인서와 대칭). 값 영구 공란. bd4b0088 제거분 원본 8셀 그대로. -->
      <tr>
        <td style="background:#f8f8f8; text-align:center;">입원</td>
        <td></td>
        <td style="text-align:center;">부터</td>
        <td></td>
        <td style="text-align:center;">까지</td>
        <td style="text-align:center;">(치료</td>
        <td style="text-align:right;"></td>
        <td style="text-align:left;">일간)</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td style="width:80px; background:#f8f8f8; vertical-align:top;">통원일자</td>
        <td style="min-height:36px;">{{visit_date}}</td>
      </tr>
    </tbody>
  </table>

  <!-- T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX ③: 용도 입력칸 너비를 내용에 맞게 조정.
       전폭(full-bleed) → 내용맞춤(width:auto 테이블 + 라벨 60px·값 min-width:320px 좌측 배치). -->
  <!-- T-20260729-foot-DOC-LAYOUT-FIX ③: 용도표 width:auto→100% + table-layout:fixed, 라벨폭 80px(위 통원일자칸과 통일). 인라인 전용. -->
  <table style="margin-top:4px; width:100%; table-layout:fixed;">
    <tbody>
      <!-- T-20260622-foot-VISITCERT-DISEASE-FUTURETX-HIDE: 향후치료(향후 치료의견) 비노출.
           현장 요청(김주연 총괄) — 진료확인서 화면·인쇄 모두 미표시. treatment_opinion 바인딩 불변. 용도 행은 유지. -->
      <tr>
        <td style="width:80px; background:#f8f8f8; text-align:center;">용&nbsp;&nbsp;도</td>
        <td>{{purpose}}</td>
      </tr>
    </tbody>
  </table>

  <!-- T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX ④: "상기인은~확인함" 텍스트칸 세로 높이 3배(≈36px→108px).
       min-height:108px + flex 상하중앙 정렬(기존 text-align:center 유지). -->
  <div class="confirm-text" style="margin-top:6px; min-height:108px; display:flex; align-items:center; justify-content:center;">
    상기인은 위와 같이 진료중임(진료하였음)을 확인함.
  </div>

  <!-- T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX ⑤: 하단 발행일~주소및명칭 섹션 좌우 50:50.
       라벨15%+값35% 좌우 대칭. table-layout:fixed 로 첫 행 폭 고정(의료기관·면허 행 정합). -->
  <table style="margin-top:4px; table-layout:fixed;">
    <tbody>
      <tr>
        <td style="width:15%; background:#f8f8f8;">발 행 일</td>
        <td style="width:35%;">{{issue_date}}</td>
        <td style="width:15%; background:#f8f8f8; white-space:nowrap; font-size:8pt;">주소 및 명칭</td>
        <td style="width:35%;">{{clinic_address}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">의 료 기 관</td>
        <td>{{clinic_name}}</td>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt;">전화 및 팩스</td>
        <td>{{clinic_phone}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">면 허 번 호</td>
        <td colspan="1">제&nbsp;{{doctor_license_no}}&nbsp;호</td>
        <td style="background:#f8f8f8; white-space:nowrap;">의 사 성 명</td>
        <td>{{doctor_name}}&nbsp;&nbsp;{{doctor_seal_html}}</td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ─── 진료확인서 2 발급폼 분리 (T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT) ───
//
// 단일 진료확인서(treat_confirm, 상병 비노출 = 2026-06-22 김주연 총괄 요청)를 발급폼 2개로 분리.
//  · nocode(코드·진단명 불포함, 3,000) = 레거시 템플릿 그대로(상병 미렌더). TREAT_CONFIRM_HTML 재사용.
//  · code(코드·진단명 포함, 10,000)     = 레거시 + 상병(병명) 테이블 + 진단확신도 분류 표시줄 복원.
//    상병값(diag_code/diag_name)은 service_charges 상병항목에서 읽기 자동주입(autoBindContext, write 0).
//
// code 변형은 TREAT_CONFIRM_HTML 의 상병-비노출 주석 지점에 상병 테이블을 주입해 생성 →
// 레이아웃(도장 위치·여백·치료기간·발행블록)은 단일 소스(TREAT_CONFIRM_HTML)로 유지·동기.
// 단일템플릿은 diag 조건부 숨김 불가(상병 무조건 주입 or 무조건 숨김) → 별 템플릿 2개로 분기.

/** code 변형 전용 상병(병명) 테이블 + 진단확신도 분류 표시줄 (구 진료확인서에서 복원) */
const TREAT_CONFIRM_DISEASE_BLOCK = `
  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td rowspan="5" style="width:60px; background:#f8f8f8; text-align:center; font-weight:bold; font-size:10pt; letter-spacing:2px;">병&nbsp;&nbsp;명</td>
        <td style="background:#f0f0f0; text-align:center; width:90px;">상 병 코 드</td>
        <td style="background:#f0f0f0; text-align:center;">상&nbsp;&nbsp;&nbsp;병&nbsp;&nbsp;&nbsp;명</td>
        <!-- T-20260729-foot-DOC-LAYOUT-FIX ③: 특정기호 헤더/값셀 white-space:nowrap — 값 줄바꿈 방지. 폭은 상병명(auto)에서 흡수 → 총폭 불변. (진단서·소견서 무접촉, 진료확인서 code블록만) -->
        <td style="background:#f0f0f0; text-align:center; width:70px; white-space:nowrap;">특 정 기 호</td>
      </tr>
      <tr>
        <td style="min-height:20px;">{{diag_code_1}}</td>
        <td>{{diag_name_1}}</td>
        <td style="white-space:nowrap;">{{diag_flag_1}}</td>
      </tr>
      <tr>
        <td style="min-height:20px;">{{diag_code_2}}</td>
        <td>{{diag_name_2}}</td>
        <td style="white-space:nowrap;">{{diag_flag_2}}</td>
      </tr>
      <tr style="{{diag_row_3_style}}">
        <td style="min-height:20px;">{{diag_code_3}}</td>
        <td>{{diag_name_3}}</td>
        <td style="white-space:nowrap;">{{diag_flag_3}}</td>
      </tr>
      <tr style="{{diag_row_4_style}}">
        <td style="min-height:20px;">{{diag_code_4}}</td>
        <td>{{diag_name_4}}</td>
        <td style="white-space:nowrap;">{{diag_flag_4}}</td>
      </tr>
    </tbody>
  </table>

  <div style="display:flex; border:1px solid #000; border-top:none; gap:0;">
    <div style="border-right:1px solid #000; padding:4px 10px; display:flex; align-items:center; gap:6px;">
      <span class="circle circle-filled"></span>
      <span style="font-size:9pt;">임상적추정</span>
    </div>
    <div style="border-right:1px solid #000; padding:4px 10px; display:flex; align-items:center; gap:6px;">
      <span class="circle"></span>
      <span style="font-size:9pt;">최 종 진 단</span>
    </div>
    <div style="padding:4px 10px; display:flex; align-items:center; gap:6px;">
      <span class="circle"></span>
      <span style="font-size:9pt;">임상적진단</span>
    </div>
  </div>
`;

/** 진료확인서(코드·진단명 불포함) = 레거시 템플릿 그대로(상병 미렌더). */
const TREAT_CONFIRM_NOCODE_HTML = TREAT_CONFIRM_HTML;

/**
 * 진료확인서(코드·진단명 포함) = 레거시 + 상병 테이블 복원.
 * 상병-비노출 주석 직후(치료기간 테이블 앞)에 DISEASE_BLOCK 주입. 단일 anchor 치환으로 레이아웃 동기 유지.
 */
const TREAT_CONFIRM_CODE_HTML = TREAT_CONFIRM_HTML.replace(
  '       diag 바인딩 컨텍스트·발행/published 트리거 불변 — 템플릿에서 미렌더할 뿐. -->',
  '       diag 바인딩 컨텍스트·발행/published 트리거 불변 — 템플릿에서 미렌더할 뿐. -->\n' +
    TREAT_CONFIRM_DISEASE_BLOCK,
);

// ─── 통원확인서 ───

const VISIT_CONFIRM_HTML = `
${COMMON_STYLE}
<div class="form-wrap">
  <!-- T-20260729-foot-DOC-LAYOUT-FIX ②: 제목 아래 여백 2px→12px (인라인, COMMON_STYLE 무접촉). -->
  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
    <div style="flex:1"></div>
    <div class="title" style="flex:none; padding:0 20px;">통 원 확 인 서</div>
    <!-- T-20260630-foot-DOCPRINT-WONBU-SEAL-REMOVE: 통원확인서 우측상단 '원부대조필인' 삭제(김주연 총괄). 빈 flex:1 유지 → 제목 중앙정렬 불변 -->
    <div style="flex:1;"></div>
  </div>

  <!-- T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX ①: 상단 섹션(병록번호~연령/성별) 좌우 50:50.
       라벨15%+값35% 좌우 대칭 → 좌·우 반반. table-layout:fixed 로 첫 행 폭 고정(colspan 행 정합). -->
  <table style="table-layout:fixed;">
    <tbody>
      <!-- T-20260731-foot-DOCFORM-URGENT-6FIX AC-5⑤: 행1우측=성별 / 행2우측=연령 위치 교환(롤모델 정합). 라벨·값 쌍 이동. -->
      <tr>
        <td style="width:15%; background:#f8f8f8;">병 록 번 호</td>
        <td style="width:35%;">{{record_no}}</td>
        <td style="width:15%; background:#f8f8f8;">성별</td>
        <!-- T-20260601-foot-DOC-PRINT-8FIX AC-6①: 성별 하드코딩 → 주민번호 산출 바인딩 -->
        <td style="width:35%; white-space:nowrap;">{{patient_gender}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">연 번 호</td>
        <td>{{visit_no}}</td>
        <td style="background:#f8f8f8;">연 령</td>
        <td style="white-space:nowrap;">만&nbsp;<strong>{{patient_age}}</strong>&nbsp;세</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">주&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;소</td>
        <td colspan="3">{{patient_address}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">환자 성명</td>
        <!-- T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX ②: 성명 옆 불필요한 막음칸(빈 셀) 제거 → 성명 값 colspan=3 전폭.
             구 visit_display_note placeholder 셀(3FIX, 상시 공란) 삭제. 바인딩 컨텍스트 무영향. -->
        <td colspan="3">{{patient_name}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">주 민 번 호</td>
        <td colspan="3">{{patient_rrn}}</td>
      </tr>
    </tbody>
  </table>

  <!-- T-20260731-foot-DOCFORM-URGENT-6FIX AC-3: 병명(상병코드·상병명·특정기호) 블록 + 진단확신도 분류 복원.
       2026-06-22 김주연 총괄 비노출 지시(T-20260622-foot-VISITCERT-DISEASE-FUTURETX-HIDE)를
       팀장 2026-07-31 지시로 SUPERSEDE — 롤모델 이미지 정합. ※총괄 사실통지 대상.
       진료확인서 CODE 변형이 쓰는 TREAT_CONFIRM_DISEASE_BLOCK 상수 그대로 재사용(신규 마크업 0, 발산 방지).
       통원확인서는 단일 발급폼이므로 무조건 렌더(code/nocode 2분기 없음).
       진단확신도(임상적추정/최종진단/임상적진단)는 데이터 연동 아닌 하드코딩(토큰 0) — 기존 3서류와 동일. 데이터소스 신설=후속 별건.
       diag 토큰·autoBind 무접촉(진료확인서 CODE가 이미 같은 토큰 소비 → 배선 신설 0). -->
${TREAT_CONFIRM_DISEASE_BLOCK}

  <!-- T-20260731-foot-DOCFORM-URGENT-6FIX AC-1: 입원 행 복원 + 치료기간 셀 rowspan="2" 복원(법무팀 2026-07-31 결정).
       근거: "빈칸을 넣더라도 통원확인서에 입원 칸은 넣는다" — T-20260723 ④의 '외래전용이라 제거' 근거 폐기.
       입원 행 값은 영구 공란(바인딩 신설 금지). '까지' 칸 {{visit_date}} 유지(discharge_date 고아토큰 부활 금지). -->
  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td rowspan="2" style="width:50px; background:#f8f8f8; text-align:center; vertical-align:middle; font-size:8.5pt;">치료<br>기간</td>
        <td style="width:50px; background:#f8f8f8; text-align:center;">외래</td>
        <td>{{visit_date}}</td>
        <td style="width:30px; text-align:center;">부터</td>
        <td>{{visit_date}}</td>
        <td style="width:30px; text-align:center;">까지</td>
        <td style="width:48px; text-align:center;">(치료</td>
        <td style="width:36px; text-align:right;">{{visit_days}}</td>
        <td style="text-align:left;">일간)</td>
      </tr>
      <!-- T-20260731-foot-DOCFORM-URGENT-6FIX AC-1: 입원 행 복원(법무팀 2026-07-31). 값 영구 공란. bd4b0088 제거분 원본 8셀 그대로. -->
      <tr>
        <td style="background:#f8f8f8; text-align:center;">입원</td>
        <td></td>
        <td style="text-align:center;">부터</td>
        <td></td>
        <td style="text-align:center;">까지</td>
        <td style="text-align:center;">(치료</td>
        <td style="text-align:right;"></td>
        <td style="text-align:left;">일간)</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <!-- T-20260731-foot-DOCFORM-SEALFALLBACK-VISITDAYS-ALIGN-2ND AC-5⑦: 라벨 통원일자→실통원일수,
             값 {{visit_date}}→{{visit_days}}(deriveVisitDays 산출값, 실제 내원 건수). 하드코딩 '1' 아님. -->
        <td style="width:80px; background:#f8f8f8; vertical-align:top;">실통원일수</td>
        <td style="min-height:36px;">{{visit_days}}</td>
      </tr>
    </tbody>
  </table>

  <!-- T-20260731-foot-DOCFORM-URGENT-6FIX AC-5⑧: 용도 행 미렌더(롤모델 정합, 팀장 2026-07-31).
       {{purpose}} 토큰·발급 UI(DocumentPrintPanel 용도 선택, T-20260723 ②)·저장 경로 전부 무접촉 — 인쇄물에만 미표시.
       복원 시 아래 블록: <table style="margin-top:4px; width:100%; table-layout:fixed;"><tbody><tr>
       <td style="width:80px; background:#f8f8f8; text-align:center;">용&nbsp;&nbsp;도</td><td>{{purpose}}</td></tr></tbody></table> -->

  <!-- T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX ④: "상기인은~확인함" 텍스트칸 세로 높이 3배(≈36px→108px).
       min-height:108px + flex 상하중앙 정렬(기존 text-align:center 유지). -->
  <!-- T-20260730-foot-UNIT-PREEXIST-RED-TRIAGE(real-bug 정정): 통원확인서(VISIT_CONFIRM)는 "통원중임(통원하였음)"이 정본.
       3949940f(T-20260731-DOCFORM-URGENT-6FIX A5⑨)가 TREAT 전용 "진료중임" 문구를 양 템플릿에 오적용 → VISIT 회귀.
       f92dd989(T-20260729-DOC-LAYOUT-FIX)에서 명시 정정했던 "통원중임"으로 복원(진료확인서 문구와 직교 유지). -->
  <div class="confirm-text" style="margin-top:6px; min-height:108px; display:flex; align-items:center; justify-content:center;">
    상기인은 위와 같이 통원중임(통원하였음)을 확인함.
  </div>

  <!-- T-20260706-foot-DOCCONFIRM-LAYOUT-5FIX ⑤: 하단 발행일~주소및명칭 섹션 좌우 50:50.
       라벨15%+값35% 좌우 대칭. table-layout:fixed 로 첫 행 폭 고정(의료기관·면허 행 정합). -->
  <table style="margin-top:4px; table-layout:fixed;">
    <tbody>
      <tr>
        <td style="width:15%; background:#f8f8f8;">발 행 일</td>
        <td style="width:35%;">{{issue_date}}</td>
        <td style="width:15%; background:#f8f8f8; white-space:nowrap; font-size:8pt;">주소 및 명칭</td>
        <td style="width:35%;">{{clinic_address}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">의 료 기 관</td>
        <td>{{clinic_name}}</td>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt;">전화 및 팩스</td>
        <td>{{clinic_phone}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">면 허 번 호</td>
        <td>제&nbsp;{{doctor_license_no}}&nbsp;호</td>
        <td style="background:#f8f8f8; white-space:nowrap;">의 사 성 명</td>
        <td>{{doctor_name}}&nbsp;&nbsp;{{doctor_seal_html}}</td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ─── 소견서 ───

const DIAG_OPINION_HTML = `
${COMMON_STYLE}
<div class="form-wrap">
  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:2px;">
    <div style="flex:1"></div>
    <div class="title" style="flex:none; padding:0 32px;">소 견 서</div>
    <!-- T-20260720-foot-OPINIONDOC-PRINT-4FIX (RC-2): 소견서 우측상단 '원부대조필인' 삭제.
         T-20260630-foot-DOCPRINT-WONBU-SEAL-REMOVE 가 진료확인서(332)·통원확인서(539)만 삭제하고 소견서(672)를 누락 → 소견서만 잔존. 동일 패턴으로 삭제.
         빈 flex:1 유지 → 제목 "소 견 서" 중앙정렬 불변(금지4). -->
    <div style="flex:1;"></div>
  </div>

  <!-- T-20260729-foot-DOC-LAYOUT-FIX ⑤: 환자정보표 라벨 좌→중앙정렬 (인라인 text-align:center, COMMON_STYLE 무접촉). -->
  <table>
    <tbody>
      <tr>
        <td style="width:70px; background:#f8f8f8; text-align:center;">환 자 정 보</td>
        <td style="width:140px;">{{record_no}}</td>
        <td style="width:70px; background:#f8f8f8; text-align:center;">주 민 번 호</td>
        <td>{{patient_rrn}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">환자 성명</td>
        <td>{{patient_name}}</td>
        <td style="background:#f8f8f8; text-align:center;">성별</td>
        <td>{{patient_gender}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">생년월일</td>
        <td>{{patient_birthdate}}</td>
        <td style="background:#f8f8f8; text-align:center;">연령</td>
        <td>만&nbsp;<strong>{{patient_age}}</strong>&nbsp;세</td>
      </tr>
      <!-- T-20260629-foot-DOCPRINT-COLWIDTH-WRAP-AUDIT: 주소·연락처를 각각 전폭(colspan=3) 행으로 분리.
           이전: 주소 칸이 한 컬럼(~140px)에 묶여 긴 주소 3줄 줄바꿈. 라벨/값 분리(8FIX AC-2)는 유지. -->
      <tr>
        <td style="background:#f8f8f8; text-align:center;">환자의 주소</td>
        <td colspan="3">{{patient_address}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; white-space:nowrap; text-align:center;">환자 연락처</td>
        <td colspan="3">{{patient_phone}}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td rowspan="5" style="width:60px; background:#f8f8f8; text-align:center; font-weight:bold; font-size:10pt; letter-spacing:2px;">상병명</td>
        <td style="background:#f0f0f0; text-align:center; width:90px;">상 병 코 드</td>
        <td style="background:#f0f0f0; text-align:center;">상&nbsp;&nbsp;&nbsp;병&nbsp;&nbsp;&nbsp;명</td>
        <!-- T-20260730-foot-DOC-LAYOUT-REFIX-3 ②: 헤더 nowrap — 줄바꿈 방지. 표는 auto 레이아웃이라 폭은 상병명(auto)이 흡수 → 총폭 불변. (진단서 184행 DIAGNOSIS_HTML은 무접촉) -->
        <td style="background:#f0f0f0; text-align:center; width:70px; white-space:nowrap;">특 정 기 호</td>
      </tr>
      <tr>
        <td style="min-height:30px; padding:6px 5px;">{{diag_code_1}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_name_1}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_flag_1}}</td>
      </tr>
      <tr>
        <td style="min-height:30px; padding:6px 5px;">{{diag_code_2}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_name_2}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_flag_2}}</td>
      </tr>
      <tr style="{{diag_row_3_style}}">
        <td style="min-height:30px; padding:6px 5px;">{{diag_code_3}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_name_3}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_flag_3}}</td>
      </tr>
      <tr style="{{diag_row_4_style}}">
        <td style="min-height:30px; padding:6px 5px;">{{diag_code_4}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_name_4}}</td>
        <td style="min-height:30px; padding:6px 5px;">{{diag_flag_4}}</td>
      </tr>
    </tbody>
  </table>

  <div style="display:flex; border:1px solid #000; border-top:none;">
    <div style="border-right:1px solid #000; padding:4px 10px; display:flex; align-items:center; gap:6px;">
      <span class="circle circle-filled"></span>
      <span style="font-size:9pt;">임상적추정</span>
    </div>
    <div style="border-right:1px solid #000; padding:4px 10px; display:flex; align-items:center; gap:6px;">
      <span class="circle"></span>
      <span style="font-size:9pt;">최 종 진 단</span>
    </div>
    <div style="padding:4px 10px; display:flex; align-items:center; gap:6px;">
      <span class="circle"></span>
      <span style="font-size:9pt;">임상적진단</span>
    </div>
  </div>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td style="width:60px; background:#f8f8f8;">발 병 일</td>
        <td>{{onset_date}}</td>
        <td style="width:60px; background:#f8f8f8;">진 단 일</td>
        <td>{{issue_date}}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td style="width:60px; background:#f8f8f8; text-align:center; vertical-align:middle;">소&nbsp;&nbsp;&nbsp;견</td>
        <td style="min-height:500px;" class="large-area">{{diagnosis_ko}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">비&nbsp;&nbsp;&nbsp;고</td>
        <td style="min-height:30px;">{{memo}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">용&nbsp;&nbsp;&nbsp;도</td>
        <td>{{purpose}}</td>
      </tr>
    </tbody>
  </table>

  <div class="confirm-text" style="margin-top:6px; font-size:10pt;">
    위의 소견을 제출함.
  </div>

  <!-- T-20260729-foot-DOC-LAYOUT-FIX ⑤: 하단서명표 라벨 중앙정렬 + table-layout:fixed+colgroup(면허군 col1~2=50% / 의사성명군 col3~4=50%). 인라인 전용, COMMON_STYLE 무접촉. 발행 스냅샷(저장 HTML) 무접촉 — 템플릿만. -->
  <table style="margin-top:4px; table-layout:fixed;">
    <colgroup><col style="width:15%" /><col style="width:35%" /><col style="width:15%" /><col style="width:35%" /></colgroup>
    <tbody>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">발 행 일</td>
        <td colspan="3">{{issue_date}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">의 료 기 관</td>
        <td colspan="3">{{clinic_name}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt; text-align:center;">주소 및 명칭</td>
        <td colspan="3">{{clinic_address}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt; text-align:center;">전화 및 팩스</td>
        <td colspan="3">{{clinic_phone}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">면 허 번 호</td>
        <td>제&nbsp;{{doctor_license_no}}&nbsp;호</td>
        <td style="background:#f8f8f8; text-align:center; white-space:nowrap;">의 사 성 명</td>
        <td>{{doctor_name}}&nbsp;&nbsp;{{doctor_seal_html}}</td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ─── 진료비 세부산정내역 ───

const BILL_DETAIL_HTML = `
${COMMON_STYLE}
<style>
  .bill-wrap {
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', NanumGothic, sans-serif;
    font-size: 9pt;
    color: #000;
    background: #fff;
    padding: 6mm 10mm;
    width: 277mm; /* A4 landscape */
    min-height: 185mm;
  }
  .bill-wrap table { width: 100%; border-collapse: collapse; }
  .bill-wrap td, .bill-wrap th {
    border: 1px solid #000;
    padding: 2px 4px;
    vertical-align: middle;
    font-size: 8.5pt;
  }
  /* T-20260731-foot-DOCFORM-SEALFALLBACK-VISITDAYS-ALIGN-2ND AC-G1 [이은상 팀장 2026-07-31]:
     세부산정내역서(.bill-wrap) 값 정렬 — 일반 값 좌측 / th 중앙 / 금액(.num-cell) 우측.
     ⚠ .bill-wrap 하나로 한정(타 양식 .rx-wrap/.br-wrap/COMMON_STYLE 무접촉, f92dd989 회귀 전례).
     ★ .bill-wrap td.num-cell(0,2,1)로 .bill-wrap td(0,1,1) 좌측을 이겨 금액 우측 보장(전역 .num-cell 무접촉).
        '계·합계' 라벨/병합셀의 인라인 text-align:center 는 인라인 우선 → 무변화(의도된 중앙). */
  .bill-wrap th { text-align: center; }
  .bill-wrap td { text-align: left; }
  .bill-wrap td.num-cell { text-align: right; }
  .bill-wrap .title-main {
    text-align: center;
    font-size: 15pt;
    font-weight: bold;
    padding: 4px 0;
  }
  .bill-wrap .header-note { font-size: 8pt; margin-bottom: 3px; }
  .num-cell { text-align: right; font-variant-numeric: tabular-nums; }
  /* T-20260731-foot-DOCFORM-URGENT-6FIX AC-D2: diag-grid 표 삭제에 따라 고아 CSS 규칙 제거(.bill-wrap .diag-grid). */
  @media print {
    /* T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT: 가로(A4 landscape) — 인쇄창 @page margin:12mm 10mm 가
       콘텐츠박스(297-20 × 210-24 = 277×186mm)를 엔진 차원에서 중앙 배치. bill-wrap 은 그 박스를 채움
       (margin:0 auto — auto 좌우 belt). 직전엔 margin:12mm auto + .page-landscape 가 전폭(297mm) full-bleed →
       엔진 shrink-to-fit 좌상단 앵커로 쏠림 잔존. @page 는 래퍼(forceLandscape)가 소유 → 템플릿 미선언. */
    /* T-20260629-foot-DOCPRINT-CENTER-ALIGN(REOPEN/AC-5): landscape @page 상단여백 12mm→30mm 하향 →
       콘텐츠박스 높이 186mm→168mm(=210-30-12) 축소.
       T-20260629-foot-DOCPRINT-CENTER-ALIGN(REOPEN/AC-6): 상단 30mm→23mm(2줄↑) 재조정 →
       콘텐츠박스 168mm→175mm(=210-23-12) 확대로 하단 12mm 클립가드 유지·단일 페이지·넘침/잘림 없음. */
    .bill-wrap { width: 272mm; min-height: 175mm; padding: 4mm 6mm; margin: 0 auto; overflow: hidden; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
<div class="bill-wrap">
  <div class="header-note">■ [별지 제1호 서식] 진료비 세부산정내역 서식 (제2호제1항 관련)</div>
  <div class="title-main">진료비 세부산정내역</div>

  <!-- T-20260702-foot-DOCPRINT-RX-FEEBREAKDOWN-LAYOUT §2-B#3/AC-2: 참조양식(IMG_8778) 좌측 요양기관기호 라인
       (제목과 환자정보표 사이). {{clinic_code}}=loadAutoBindContext clinic.nhis_code(rx_standard와 동일 alias). -->
  <div style="font-size:9pt; margin:2px 0 4px;">요양기관기호 : <span style="text-decoration:underline;">{{clinic_code}}</span></div>

  <!-- 환자 기본 정보 -->
  <!-- T-20260729-foot-DOC-LAYOUT-FIX ④: 비고열 명시폭(100px)+table-layout:fixed. 前 비고=폭 무지정 → 잔여 전량 흡수·우측 과폭. -->
  <table style="margin-bottom:4px; table-layout:fixed;">
    <thead>
      <tr>
        <!-- T-20260629-foot-DOCPRINT-COLWIDTH-WRAP-AUDIT: 등록번호·진료기간 칸 폭 확대 + 데이터 nowrap → 줄바꿈 제거(가로 양식, 폭 여유) -->
        <!-- T-20260629-foot-BILLDETAIL-RRN-ADD: 주민등록번호 컬럼 추가(B안 확정, 총괄). {{patient_rrn}}=loadAutoBindContext rrn_decrypt 경로 재사용(신규 복호 없음). 가로 양식 폭 여유로 무회귀. -->
        <!-- T-20260722-foot-BILLRECEIPT-MASTER-FIXES §5: 세부내역서 PHI 축소 — 주민등록번호 th+td 한 쌍 제거(7→6칸).
             계산서·영수증·진단서·소견서 주민번호는 유지(세부내역서만). -->
        <th style="width:104px;">환자등록번호</th>
        <th style="width:80px;">환자성명</th>
        <th style="width:150px;">진료기간</th>
        <th style="width:60px;">병실</th>
        <th style="width:70px;">환자구분</th>
        <th style="width:100px;">비고</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="white-space:nowrap;">{{record_no}}</td>
        <td>{{patient_name}}</td>
        <td style="white-space:nowrap;">{{visit_date}} ～ {{visit_date}}</td>
        <td>외래</td>
        <td>건강보험</td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <!-- T-20260731-foot-DOCFORM-URGENT-6FIX AC-D: 상병(상병코드·상병명) 표 삭제(팀장 2026-07-31). ※총괄 사실통지 대상
       (T-20260721-PAYDETAIL-DIAGCODE-SHOW 로 추가 → OVERFLOW-2PAGE·DOC-LAYOUT-FIX④ 3회 손댄 자산 폐기).
       {{diag_code_N}}/{{diag_name_N}} 토큰 소스(autoBind)는 무접촉 — 소견서·진단서·진료확인서(CODE)가 공유. 템플릿에서 미렌더만. -->

  <!-- 항목 테이블 -->
  <!-- T-20260702-foot-DOCPRINT-RX-FEEBREAKDOWN-LAYOUT AC-2/AC-8: 참조양식(IMG_8778) 2단 헤더 정합.
       (1) 주(主)컬럼(항목·일자·코드·명칭·금액·횟수·일수·총액·비급여)을 rowspan="3" 단일 풀높이 셀로 —
           직전 rowspan="2"+빈 3행 th 는 헤더에 불필요한 가로 분할선을 만들어 참조양식과 불일치했음.
       (2) 급여 super-header(colspan3) > 일부본인부담(colspan2)/전액본인부담(rowspan2) > 본인부담금·공단부담금.
       (3) table-layout:fixed + colgroup 로 12컬럼 폭을 참조사진 실측 비율(명칭 최광폭≈29%, 부담금열 협폭)로 고정. -->
  <table style="table-layout:fixed;">
    <colgroup>
      <col style="width:64px;" />
      <col style="width:88px;" />
      <col style="width:70px;" />
      <col />
      <col style="width:78px;" />
      <col style="width:38px;" />
      <col style="width:38px;" />
      <col style="width:82px;" />
      <col style="width:52px;" />
      <col style="width:52px;" />
      <col style="width:52px;" />
      <col style="width:82px;" />
    </colgroup>
    <thead>
      <tr>
        <th rowspan="3">항목</th>
        <th rowspan="3">일자</th>
        <th rowspan="3">코드</th>
        <th rowspan="3">명칭</th>
        <th rowspan="3">금액</th>
        <th rowspan="3">횟수</th>
        <th rowspan="3">일수</th>
        <th rowspan="3">총액</th>
        <th colspan="3">급여</th>
        <th rowspan="3">비급여</th>
      </tr>
      <tr>
        <th colspan="2">일부본인부담</th>
        <th rowspan="2">전액<br>본인부담</th>
      </tr>
      <tr>
        <th>본인부담금</th>
        <th>공단부담금</th>
      </tr>
    </thead>
    <tbody>
      {{items_html}}
      <tr>
        <td colspan="7" style="text-align:center; background:#f8f8f8; font-weight:bold;">계</td>
        <!-- T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): '총액(합계)' 열 = 급여 본인부담금 + 비급여
             ({{detail_subtotal}}, 공단부담금 제외). 공단부담금 칸/금액({{subtotal_fund}})은 표시 그대로 유지 — 합계에서만 제외. -->
        <td class="num-cell">{{detail_subtotal}}</td>
        <!-- T-20260708-foot-BILLING-DOCFEE-INSAMOUNT-MISSING AC-3: 본인부담금/공단부담금 총계 바인딩(표시 유지). -->
        <td class="num-cell">{{subtotal_copayment}}</td>
        <td class="num-cell">{{subtotal_fund}}</td>
        <td class="num-cell">0</td>
        <td class="num-cell">{{subtotal_noncovered}}</td>
      </tr>
      <!-- T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX AC-②: '끝처리 조정금액' = 10원 단위 절사 차액
           ({{detail_rounding}}, ≤0). 대상 = 계 총액(본인부담금+비급여, 공단 제외)의 10원 미만 우수리.
           copayment 100원 절사와는 직교(computeBillDetailRounding, 이중적용 없음). 총액 열에 표기. -->
      <tr>
        <td colspan="7" style="text-align:center; background:#f8f8f8;">끝처리 조정금액</td>
        <td class="num-cell">{{detail_rounding}}</td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
      </tr>
      <!-- T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX AC-③: '합계' = 본인부담금 + 비급여(공단 제외, A안) 를
           끝처리 조정 반영({{detail_total}}=절사 후). 값 셀 병합(colspan=5) + 중앙정렬(김주연 총괄 확정).
           공단부담금 별도 표기는 '계' 행({{subtotal_fund}})에서 유지 — GONGDAN-HIDE B안 정합. -->
      <tr>
        <td colspan="7" style="text-align:center; background:#f8f8f8; font-weight:bold;">합계</td>
        <td colspan="5" class="num-cell" style="text-align:center;"><strong>{{detail_total}}</strong></td>
      </tr>
    </tbody>
  </table>

  <!-- T-20260721-foot-COPAY-PROVISIONAL-RELABEL: 급여항목 본인부담 확정 라벨 「본인부담금」 (총괄 김주연 confirm).
       법정 필수 칸 밖 설명 라인 — 별지 서식 칸 구조·값(본인부담=전액/공단부담=0) canon 불변, 텍스트 설명만(숫자 무변경).
       영수증(공단0=전액) vs 결제미니창(30% 잠정) 금액 불일치 오독 해소. -->
  <div style="margin-top:6px; font-size:8pt; text-align:left; color:#333;">
    ※ 상기 급여 항목의 환자 부담분은 「본인부담금」으로 표기됩니다.
  </div>

  <div style="margin-top:8px; font-size:9pt; text-align:center;">
    신청인 &nbsp;&nbsp; {{patient_name}} &nbsp;&nbsp; (환자와의 관계 : 본인 &nbsp;&nbsp; )의 요청에 따라
  </div>
  <div style="font-size:9pt; text-align:center; margin-top:4px;">
    진료비 계산서 영수증 세부산정내역을 발급합니다.
  </div>
  <div style="font-size:9pt; text-align:center; margin-top:4px;">{{issue_date}}</div>

  <!-- T-20260730-foot-DOC-LAYOUT-REFIX-3 ①: 직인칸 5%→8%, 대표자 값칸 33.5%→30.5% (합계 100% 불변, 표 총폭 불변).
       회귀정정: T-20260729-foot-DOC-LAYOUT-FIX ④ 가 직인칸을 5%로 고정했으나, 도장 실필요폭 = img 52px + td 패딩 8px + 보더 1px = 61px ≈ 6.21% 라 5%(49.1px)에서 −12px 넘쳐 표 테두리에 걸쳤다. 직인 8%(78.6px)로 여유 확보. 대표자 값칸(박영진 3자, 30.5%=79.3mm 여전히 과분)에서 회수. -->
  <table style="margin-top:8px; table-layout:fixed;">
    <colgroup>
      <col style="width:16%" /><col style="width:31.5%" /><col style="width:14%" /><col style="width:30.5%" /><col style="width:8%" />
    </colgroup>
    <tbody>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">요양기관 명칭</td>
        <!-- T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT: 요양기관명 축 재배선 (세부산정내역) -->
        <td>{{hira_institution_name}}</td>
        <td style="width:60px; background:#f8f8f8; text-align:center;">대 표 자</td>
        <!-- [batch9 재정합 2026-07-19] INSTNAME-REPPRINT(669888d0) CEO Q2 조건부 vs BODYPORT/DOCFEE refine
             충돌 → ticket-confirmed side 채택. 근거: BODYPORT §same_subject L55 refine + planner A2
             adjudication(07-15 20:28) + 총괄 슬롯키드 형식 confirm(07-16 13:52, AC9_SEAL_SLOTKEYED_FINAL).
             세부산정내역 = 기관 발행 서류이므로 대표자란은 진료의({{doctor_name}}) 아니라 개설자(대표자). -->
        <!-- T-20260715-foot-RECEIPT-REPNAME-SEAL-BODYPORT B1: 세부내역서(기관 발행) 대표자란 = 진료의
             ({{doctor_name}})가 아닌 개설자(대표자) {{receipt_representative}}(=clinics.representative_name
             ||'박영진'). DOCFEE 신양식(bill_receipt_new)과 동일 토큰·단일 소스(신규 토큰 신설 0). 진료의 축
             서류(진단서·처방전 등)의 {{doctor_name}}은 무접촉. -->
        <td style="width:120px;">{{receipt_representative}}</td>
        <!-- T-20260715-foot-RECEIPT-REPNAME-SEAL-BODYPORT B2: 대표자 근방 도장 = 진료의 개인직인이 아닌
             법인(요양기관) 인감({{institution_seal_html}}). 前 {{doctor_seal_html}}은 선택 진료의 개인직인이
             찍혀 '박영진 + 진료의 개인도장' 미스매치가 나던 경로 → 법인 인감으로 정합. -->
        <td style="width:52px; text-align:center;">{{institution_seal_html}}</td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ─── 진료비 납입증명서(소득공제용) ───

const PAYMENT_CERT_HTML = `
${COMMON_STYLE}
<div class="form-wrap">
  <div style="text-align:center; margin-bottom:6px;">
    <div style="font-size:17pt; font-weight:bold; letter-spacing:4px; margin-top:6px; display:inline-block;">진료비&nbsp;&nbsp;납입증명서(소득공제용)</div>
  </div>

  <table style="margin-bottom:4px;">
    <tbody>
      <tr>
        <td style="width:70px; background:#f8f8f8;">등&nbsp;록&nbsp;번&nbsp;호</td>
        <td style="width:200px;">{{record_no}}</td>
        <td style="width:60px; background:#f8f8f8; text-align:center;">진&nbsp;료&nbsp;과</td>
        <td>{{dept_name}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">수신자(수신처)</td>
        <td colspan="3">{{recipient}}</td>
      </tr>
    </tbody>
  </table>

  <div style="font-weight:bold; font-size:9.5pt; margin:6px 0 2px;">■ 인적사항</div>
  <table style="margin-bottom:4px;">
    <tbody>
      <tr>
        <td style="width:55px; background:#f8f8f8; text-align:center;">성&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;명</td>
        <td style="width:180px;">{{patient_name}}</td>
        <td style="width:80px; background:#f8f8f8; text-align:center;">주민등록번호</td>
        <td>{{patient_rrn}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">주&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;소</td>
        <td colspan="3">{{patient_address}}</td>
      </tr>
    </tbody>
  </table>

  <div style="font-weight:bold; font-size:9.5pt; margin:6px 0 2px;">■ {{year}}년도 진료비 납입현황</div>
  <table style="margin-bottom:4px;">
    <thead>
      <tr>
        <th style="width:36px;">기&nbsp;&nbsp;간</th>
        <th>외&nbsp;&nbsp;&nbsp;&nbsp;래</th>
        <th style="width:70px;">일&nbsp;&nbsp;&nbsp;&nbsp;원</th>
        <th style="width:36px;">기&nbsp;&nbsp;간</th>
        <th>외&nbsp;&nbsp;&nbsp;&nbsp;래</th>
        <th style="width:70px;">일&nbsp;&nbsp;&nbsp;&nbsp;원</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">1 월</td><td>{{m01_outpatient}}</td><td>{{m01_inpatient}}</td>
        <td style="background:#f8f8f8; text-align:center;">7 월</td><td>{{m07_outpatient}}</td><td>{{m07_inpatient}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">2 월</td><td>{{m02_outpatient}}</td><td>{{m02_inpatient}}</td>
        <td style="background:#f8f8f8; text-align:center;">8 월</td><td>{{m08_outpatient}}</td><td>{{m08_inpatient}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">3 월</td><td>{{m03_outpatient}}</td><td>{{m03_inpatient}}</td>
        <td style="background:#f8f8f8; text-align:center;">9 월</td><td>{{m09_outpatient}}</td><td>{{m09_inpatient}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">4 월</td><td>{{m04_outpatient}}</td><td>{{m04_inpatient}}</td>
        <td style="background:#f8f8f8; text-align:center;">10 월</td><td>{{m10_outpatient}}</td><td>{{m10_inpatient}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">5 월</td><td>{{m05_outpatient}}</td><td>{{m05_inpatient}}</td>
        <td style="background:#f8f8f8; text-align:center;">11 월</td><td>{{m11_outpatient}}</td><td>{{m11_inpatient}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">6 월</td><td>{{m06_outpatient}}</td><td>{{m06_inpatient}}</td>
        <td style="background:#f8f8f8; text-align:center;">12 월</td><td>{{m12_outpatient}}</td><td>{{m12_inpatient}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;" colspan="2">사용목적</td>
        <!-- T-20260629-foot-DOCPRINT-COLWIDTH-WRAP-AUDIT: 좁은 월별표 colspan2 칸 내 줄바꿈 제거 — 폰트 축소 + nowrap -->
        <td colspan="2" style="text-align:center; font-size:7pt; white-space:nowrap;">진료비 소득공제 신청용</td>
        <td style="background:#f8f8f8; text-align:center;">연간 합계액</td>
        <td style="text-align:right; font-weight:bold;">{{annual_total}}</td>
      </tr>
    </tbody>
  </table>

  <div style="font-size:8.5pt; padding:3px 6px; margin-bottom:4px;">
    ▷ 상기 금액에는 교정 및 종합검진료 {{excluded_items}}가 제외되어 있습니다.
  </div>

  <div style="font-size:9pt; padding:6px 0; line-height:1.7;">
    소득세법 제52조 및 소득세법 시행령 제110조 규정에 의하여 위와 같이 진료비를 납입하였음을 증명합니다.
  </div>

  <div style="text-align:center; font-size:10pt; padding:16px 0 8px;">
    {{issue_date}}
  </div>

  <div style="font-size:9pt; margin:8px 0 4px;">{{clinic_name}}</div>

  <table style="margin-top:4px; width:auto; min-width:300px; margin-left:auto;">
    <tbody>
      <tr>
        <td style="border:none; padding:2px 6px 2px 0; background:none; white-space:nowrap;">병&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;원&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;장&nbsp;:</td>
        <td style="border:none; padding:2px 0; background:none; min-width:120px;">{{doctor_name}}&nbsp;&nbsp;{{doctor_seal_html}}</td>
      </tr>
      <tr>
        <td style="border:none; padding:2px 6px 2px 0; background:none; white-space:nowrap;">사업자등록번호&nbsp;:</td>
        <td style="border:none; padding:2px 0; background:none;">{{business_reg_no}}</td>
      </tr>
      <tr>
        <td style="border:none; padding:2px 6px 2px 0; background:none; white-space:nowrap;">사업자&nbsp;&nbsp;소재지&nbsp;:</td>
        <td style="border:none; padding:2px 0; background:none;">{{clinic_address}}</td>
      </tr>
    </tbody>
  </table>

  <div style="font-size:8.5pt; margin-top:14px; border-top:1px solid #999; padding-top:4px; line-height:1.8; color:#333;">
    ※ 본 진료비는 {{year}}년&nbsp;{{month}}월까지의 진료비 내역으로 이후 진료비에 대한 소득공제는 진료일에 발행하는 진료비 영수증으로 제출하시기 바랍니다.<br>
    ※ 본 증명서는 상기목적 이외의 타용도로 사용할 수 없습니다.
  </div>
</div>
`;

// ─── 진료의뢰서 ───

const REFERRAL_LETTER_HTML = `
${COMMON_STYLE}
<!-- T-20260611-foot-REFERRAL-PRINT-CLIP-CENTER: width 188mm 로 콘텐츠박스(190mm) 내 좌우 1mm 여백 + 프린터 unprintable edge clipping 회피 --><div class="form-wrap" style="border:1px solid #000; padding:0; width:188mm; max-width:188mm; min-height:262mm; margin:0 auto;"><!-- T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT: 상·하 여백은 인쇄창 @page margin 이 엔진 차원에서 소유 → 인라인 margin:0 auto(이중여백/콘텐츠 초과 방지). 좌우 188mm/auto 는 콘텐츠박스 내 중앙 belt 로 유지. T-20260629-foot-DOCPRINT-CENTER-ALIGN(REOPEN/AC-5): @page 상단 30mm 하향에 맞춰 min-height 273→255mm. AC-6: 상단 30→23mm(2줄↑) 재조정에 맞춰 255→262mm(=297-23-12). -->
  <div style="border-bottom:1px solid #000; padding:10px 14px 8px;">
    <div class="title" style="font-size:18pt; letter-spacing:14px; padding:8px 0 6px;">진 료 의 뢰 서</div>
  </div>

  <div style="border-bottom:1px solid #000; padding:8px 14px;">
    <div style="font-size:9.5pt; margin-bottom:4px;">
      진료의뢰일&nbsp;:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="border-bottom:1px solid #000; min-width:40px; display:inline-block;">{{referral_year}}</span>년&nbsp;
      <span style="border-bottom:1px solid #000; min-width:30px; display:inline-block;">{{referral_month}}</span>월&nbsp;
      <span style="border-bottom:1px solid #000; min-width:30px; display:inline-block;">{{referral_day}}</span>일
    </div>
    <div style="font-size:9.5pt;">
      한방&nbsp;/&nbsp;양방&nbsp;:&nbsp;과명&nbsp;<span style="border-bottom:1px solid #000; min-width:80px; display:inline-block;">{{dept_name}}</span>
      &nbsp;&nbsp;&nbsp;의사명&nbsp;<span style="border-bottom:1px solid #000; min-width:80px; display:inline-block;">{{referring_doctor}}</span>
    </div>
  </div>

  <div style="border-bottom:1px solid #000; padding:8px 14px;">
    <table style="border:none; margin:0;">
      <tbody>
        <tr>
          <td style="border:none; padding:2px 4px; width:60px; background:none; white-space:nowrap; font-size:9.5pt;">성&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;명</td>
          <td style="border:none; border-bottom:1px solid #000; padding:2px 4px; min-width:100px; background:none; font-size:9.5pt;">{{patient_name}}</td>
          <td style="border:none; padding:2px 16px 2px 16px; background:none; white-space:nowrap; font-size:9.5pt;">주민등록번호</td>
          <td style="border:none; border-bottom:1px solid #000; padding:2px 4px; min-width:120px; background:none; font-size:9.5pt; letter-spacing:1px;">
            <span>{{rrn_front}}</span>&nbsp;-&nbsp;<span>{{rrn_back}}</span>
          </td>
        </tr>
        <tr>
          <td style="border:none; padding:2px 4px; background:none; white-space:nowrap; font-size:9.5pt;">성별/나이</td>
          <td style="border:none; border-bottom:1px solid #000; padding:2px 4px; background:none; font-size:9.5pt;">{{patient_gender}}&nbsp;/&nbsp;{{patient_age}}</td>
          <td style="border:none; padding:2px 16px 2px 16px; background:none; white-space:nowrap; font-size:9.5pt;">연&nbsp;&nbsp;락&nbsp;&nbsp;처</td>
          <td style="border:none; border-bottom:1px solid #000; padding:2px 4px; background:none; font-size:9.5pt;">{{patient_phone}}</td>
        </tr>
        <tr>
          <td style="border:none; padding:2px 4px; background:none; white-space:nowrap; font-size:9.5pt;">진료&nbsp;구분</td>
          <!-- T-20260612-foot-REFERRAL-VISITTYPE-CHECKBOX: 진료 구분을 정적 체크박스 표기로 변경. 풋센터 외래 전용(입원 개념 없음) → 외래=☑ 고정, 입원=☐ 고정. 데이터 바인딩 없는 정적 출력값(line 1106/1107 기존 ☐ 글리프 패턴 재사용 → 흑백 인쇄 명확·폰트 지원 확인됨). -->
          <td style="border:none; padding:2px 4px; background:none; font-size:9.5pt;">☑&nbsp;외래&nbsp;&nbsp;&nbsp;☐&nbsp;입원</td>
          <td style="border:none; padding:2px 16px 2px 16px; background:none; white-space:nowrap; font-size:9.5pt;">E-mail&nbsp;주소</td>
          <td style="border:none; border-bottom:1px solid #000; padding:2px 4px; background:none; font-size:9.5pt;">{{patient_email}}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div style="border-bottom:1px solid #000; padding:10px 14px; min-height:70px;">
    <div style="font-size:9.5pt; font-weight:bold; margin-bottom:4px;">■&nbsp;진&nbsp;단&nbsp;명&nbsp;:</div>
    <div style="font-size:9.5pt; min-height:40px; padding-left:12px;">{{diagnosis}}</div>
  </div>

  <div style="border-bottom:1px solid #000; padding:10px 14px; min-height:70px;">
    <div style="font-size:9.5pt; font-weight:bold; margin-bottom:4px;">■&nbsp;병력&nbsp;및&nbsp;소견&nbsp;:</div>
    <div style="font-size:9.5pt; min-height:40px; padding-left:12px; white-space:pre-wrap;">{{medical_history}}</div>
  </div>

  <div style="border-bottom:1px solid #000; padding:10px 14px; min-height:70px;">
    <div style="font-size:9.5pt; font-weight:bold; margin-bottom:4px;">■&nbsp;의뢰내용&nbsp;:</div>
    <div style="font-size:9.5pt; min-height:40px; padding-left:12px; white-space:pre-wrap;">{{referral_content}}</div>
  </div>

  <!-- T-20260617-foot-DOCFORM-POPUP-OVERHAUL G4/AC-4: 검사 결과·투약 내용 전용 영역(자유서술 의뢰내용과 분리).
       검사 결과 = 발행 KOH 균검사 이력 자동 로드, 투약 내용 = 처방약 이력 자동 로드(referralAutoLoad.ts). -->
  <div style="border-bottom:1px solid #000; padding:10px 14px; min-height:56px;">
    <div style="font-size:9.5pt; font-weight:bold; margin-bottom:4px;">■&nbsp;검사&nbsp;결과&nbsp;:</div>
    <div style="font-size:9.5pt; min-height:30px; padding-left:12px; white-space:pre-wrap;">{{test_result}}</div>
  </div>

  <div style="border-bottom:1px solid #000; padding:10px 14px; min-height:56px;">
    <div style="font-size:9.5pt; font-weight:bold; margin-bottom:4px;">■&nbsp;투약&nbsp;내용&nbsp;:</div>
    <div style="font-size:9.5pt; min-height:30px; padding-left:12px; white-space:pre-wrap;">{{medication}}</div>
  </div>

  <div style="border-bottom:1px solid #000; padding:8px 14px;">
    <div style="display:flex; gap:24px; font-size:9.5pt;">
      <div>☐&nbsp;검사후&nbsp;결과&nbsp;통보&nbsp;요망</div>
      <div>☐&nbsp;진료후&nbsp;환자&nbsp;회송&nbsp;요망</div>
    </div>
  </div>

  <div style="border-bottom:1px solid #000; padding:8px 14px;">
    <table style="border:none;">
      <tbody>
        <tr>
          <td style="border:none; padding:2px 8px 2px 0; background:none; white-space:nowrap; font-size:9.5pt;">의&nbsp;&nbsp;뢰&nbsp;&nbsp;병&nbsp;&nbsp;원&nbsp;:</td>
          <td style="border:none; border-bottom:1px solid #000; padding:2px 4px; min-width:160px; background:none; font-size:9.5pt;">{{referral_to_hospital}}</td>
          <td style="border:none; padding:2px 0 2px 24px; background:none; white-space:nowrap; font-size:9.5pt;">전화/FAX&nbsp;번호&nbsp;:</td>
          <td style="border:none; border-bottom:1px solid #000; padding:2px 4px; min-width:120px; background:none; font-size:9.5pt;">{{clinic_phone}}</td>
        </tr>
        <tr>
          <td style="border:none; padding:2px 8px 2px 0; background:none; white-space:nowrap; font-size:9.5pt;">의&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;사&nbsp;:</td>
          <td style="border:none; border-bottom:1px solid #000; padding:2px 4px; background:none; font-size:9.5pt;">{{doctor_name}}</td>
          <td style="border:none; padding:2px 0 2px 24px; background:none; white-space:nowrap; font-size:9.5pt;">{{doctor_seal_html}}</td>
          <td style="border:none; padding:2px 4px; background:none;"></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div style="padding:8px 14px; text-align:center;">
    <div style="font-size:14pt; letter-spacing:6px; font-weight:bold;">{{clinic_name}}</div>
  </div>
</div>
`;

// ─── 의무기록사본발급신청서 ───

const MEDICAL_RECORD_REQUEST_HTML = `
${COMMON_STYLE}
<div class="form-wrap">
  <div class="title" style="font-size:16pt; letter-spacing:6px; padding:10px 0 12px;">의무기록사본발급신청서</div>

  <table style="margin-bottom:6px;">
    <tbody>
      <tr>
        <td style="background:#f8f8f8; width:60px; text-align:center;">환&nbsp;자&nbsp;명</td>
        <td style="width:180px;">{{patient_name}}</td>
        <td style="background:#f8f8f8; width:60px; text-align:center;">병록번호</td>
        <td>{{record_no}}</td>
      </tr>
    </tbody>
  </table>

  <div style="font-size:9.5pt; line-height:2.0; padding:6px 4px;">
    나는&nbsp;:&nbsp;<span style="border-bottom:1px solid #000; display:inline-block; min-width:240px;">{{request_purpose}}</span>&nbsp;목적으로
  </div>

  <div style="font-size:9.5pt; line-height:2.0; padding:2px 4px;">
    (본인·상기환자)의 의무기록을(열람·복사)하고자 하오니 승낙하여 주시기 바랍니다.<br>
    (단, 미성년자, 정신·물리적 무능력자, 사망환자의 경우에는<br>
    &nbsp;&nbsp;&nbsp;&nbsp;부모, 보호자, 또는 대리인이 대신할 수 있다.)
  </div>

  <div style="font-size:9.5pt; line-height:2.2; padding:8px 4px;">
    열람 또는 복사를 목적하는 부문&nbsp;
    <span style="border-bottom:1px solid #000; display:inline-block; min-width:200px;">{{record_section}}</span>
  </div>

  <div style="font-size:9.5pt; line-height:2.2; padding:2px 4px;">
    본인이 아닌 경우 환자와의 관계&nbsp;
    <span style="border-bottom:1px solid #000; display:inline-block; min-width:80px;">{{requester_relation}}</span>의&nbsp;
    <span style="border-bottom:1px solid #000; display:inline-block; min-width:120px;">{{requester_name}}</span>
  </div>

  <div style="font-size:9.5pt; line-height:2.2; padding:2px 4px;">
    주소&nbsp;:&nbsp;<span style="border-bottom:1px solid #000; display:inline-block; min-width:280px;">{{patient_address}}</span>
  </div>

  <div style="text-align:center; font-size:10pt; padding:16px 0; letter-spacing:4px;">
    {{issue_date}}
  </div>

  <table style="margin-top:8px;">
    <tbody>
      <tr>
        <td style="background:#f8f8f8; width:120px; white-space:nowrap;">환자(대리인)&nbsp;서명</td>
        <td style="min-width:200px;">{{patient_name}}</td>
        <td style="background:#f8f8f8; width:30px; text-align:center;">(인)</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; white-space:nowrap;">주민등록번호</td>
        <td colspan="2">{{patient_rrn}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; white-space:nowrap;">주치의&nbsp;서명</td>
        <td>{{doctor_name}}</td>
        <td style="background:#f8f8f8; text-align:center;">{{doctor_seal_html}}</td>
      </tr>
    </tbody>
  </table>

  <div style="margin-top:24px; text-align:center; font-size:12pt; letter-spacing:2px; font-weight:bold;">
    {{clinic_name}}
  </div>
</div>
`;

// ─── 소견서 variant (diag_opinion_v2) ───
// AC-6 결정: diag_opinion_v2 별도 등록 (교체 X)
// 사유: ① 보험청구용 소견서로 기존 diag_opinion과 목적·레이아웃 상이
//       ② 기존 diag_opinion은 현장 사용 중 — 교체 시 혼란 발생
//       ③ 3분할 테이블(임상적/최종, 총간병기간, 보조기명) 구조가 완전히 다름

const DIAG_OPINION_V2_HTML = `
${COMMON_STYLE}
<div class="form-wrap">
  <div class="title" style="font-size:18pt; letter-spacing:12px; padding:8px 0 10px;">소 견 서</div>

  <table style="margin-bottom:4px;">
    <tbody>
      <tr>
        <td style="width:55px; background:#f8f8f8; text-align:center;">성&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;명</td>
        <td style="width:180px;">{{patient_name}}</td>
        <td style="width:80px; background:#f8f8f8; text-align:center;">주민등록번호</td>
        <td>{{patient_rrn}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">주&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;소</td>
        <td colspan="3">{{patient_address}}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-bottom:4px;">
    <tbody>
      <tr>
        <td rowspan="4" style="width:60px; background:#f8f8f8; text-align:center; vertical-align:middle; font-size:9pt; line-height:2.0;">
          ☐&nbsp;임상적<br>☐&nbsp;최&nbsp;&nbsp;&nbsp;종
        </td>
        <td rowspan="2" style="background:#f0f0f0; text-align:center; width:60px; font-size:9pt;">병&nbsp;&nbsp;&nbsp;&nbsp;명</td>
        <td rowspan="2" style="min-width:120px; font-size:9.5pt;">{{diag_code_1}}<br>{{diag_code_2}}{{diag_extra_codes_html}}</td>
        <td style="background:#f8f8f8; text-align:center; width:80px; font-size:8.5pt; white-space:nowrap;">총&nbsp;간병기간</td>
        <td style="white-space:nowrap; font-size:8.5pt;">
          입원&nbsp;<span style="border-bottom:1px solid #000; min-width:50px; display:inline-block;">{{inpatient_start}}</span>&nbsp;~&nbsp;<span style="border-bottom:1px solid #000; min-width:50px; display:inline-block;">{{inpatient_end}}</span>
        </td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center; font-size:8.5pt; white-space:nowrap;"></td>
        <td style="white-space:nowrap; font-size:8.5pt;">
          외래&nbsp;<span style="border-bottom:1px solid #000; min-width:50px; display:inline-block;">{{outpatient_start}}</span>&nbsp;~&nbsp;<span style="border-bottom:1px solid #000; min-width:50px; display:inline-block;">{{outpatient_end}}</span>
        </td>
      </tr>
      <tr>
        <td style="background:#f0f0f0; text-align:center; font-size:8.5pt; white-space:nowrap;">발&nbsp;병&nbsp;일</td>
        <td style="font-size:9pt;">{{onset_date}}</td>
        <td style="background:#f8f8f8; text-align:center; font-size:8.5pt; white-space:nowrap;">보&nbsp;조&nbsp;기&nbsp;명</td>
        <td style="font-size:8.5pt;">{{assistive_device}}&nbsp;&nbsp;(분류번호&nbsp;:&nbsp;{{classification_code}}&nbsp;)</td>
      </tr>
      <tr>
        <td style="background:#f0f0f0; text-align:center; font-size:8.5pt; white-space:nowrap;">제&nbsp;&nbsp;출&nbsp;&nbsp;처</td>
        <td style="font-size:9pt;">{{submit_to}}</td>
        <td style="background:#f8f8f8; text-align:center; font-size:8.5pt; white-space:nowrap;">사&nbsp;용&nbsp;기&nbsp;간</td>
        <td style="font-size:8.5pt; white-space:nowrap;">{{device_start}}&nbsp;~&nbsp;{{device_end}}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-bottom:4px;">
    <tbody>
      <tr>
        <td style="width:55px; background:#f8f8f8; text-align:center; vertical-align:middle; line-height:1.8; font-size:9.5pt; height:100px;">소&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;견</td>
        <td style="min-height:100px; vertical-align:top; padding:6px; font-size:9.5pt; white-space:pre-wrap;">{{opinion_text}}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-bottom:4px;">
    <tbody>
      <tr>
        <td style="width:80px; background:#f8f8f8;">※&nbsp;참고사항</td>
        <td style="min-height:40px; vertical-align:top; padding:4px; font-size:9pt; white-space:pre-wrap;">{{remarks}}</td>
      </tr>
    </tbody>
  </table>

  <div style="font-size:9pt; margin-top:8px; line-height:1.8;">
    병(예)원 주소&nbsp;:&nbsp;{{clinic_address}}<br>
    전화번호&nbsp;:&nbsp;{{clinic_phone}}
  </div>

  <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:8px; border:1px solid #000; padding:6px 10px;">
    <div>
      <div style="font-size:9.5pt; font-weight:bold;">병(예)원 명칭&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(직인)</div>
      <div style="font-size:9pt;">{{clinic_name}}</div>
      <div style="font-size:8.5pt;">(면허번호&nbsp;{{doctor_license_no}}&nbsp;호)</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:9.5pt; letter-spacing:2px;">{{issue_date}}</div>
      <div style="font-size:9.5pt; margin-top:4px;">담당의사&nbsp;:&nbsp;{{doctor_name}}&nbsp;&nbsp;{{doctor_seal_html}}</div>
    </div>
  </div>
</div>
`;

// ─── 처방전(표준처방전, 약국보관용) — T-20260515-foot-FORM-ONELINE-RX ───

const RX_STANDARD_HTML = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .rx-wrap {
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', NanumGothic, sans-serif;
    font-size: 9pt;
    color: #000;
    background: #fff;
    /* T-20260730-foot-RX-STANDARD-DERM-FORMAT-UNIFY: 피부 A4 표준서식 실측 정합.
       724×1053px(box-sizing:border-box) + 외곽선 2px → 유효폭 720(=724-2*2).
       무패딩(내부 표가 720 full-width, 피부 처방전 colgroup 337/80/80/80/143=720 정합). */
    padding: 0;
    width: 724px;
    min-height: 1053px;
    border: 2px solid #000;
  }
  .rx-wrap table { width: 100%; border-collapse: collapse; }
  .rx-wrap td, .rx-wrap th {
    border: 1px solid #000;
    padding: 2px 4px;
    vertical-align: middle;
    font-size: 8.5pt;
  }
  /* T-20260730-foot-RX-STANDARD-DERM-FORMAT-UNIFY: 의약품표 헤더색 = 피부 A4 실측 #B3B2B2. */
  .rx-wrap th { background: #B3B2B2; font-weight: bold; text-align: center; white-space: nowrap; }
  .rx-title {
    text-align: center;
    /* T-20260730-foot-RX-STANDARD-DERM-FORMAT-UNIFY: 타이틀 크기/자간 = 피부 A4 실측(fontSize 24 / letterSpacing 20). */
    font-size: 24px;
    font-weight: bold;
    letter-spacing: 20px;
    padding: 6px 0 4px;
  }
  /* 라벨 셀 한줄 정렬 */
  .rx-wrap td[style*="background:#f8f8f8"] { white-space: nowrap; font-size: 8.5pt; }
  .rx-wrap td[style*="background:#f0f0f0"] { white-space: nowrap; }
  @media print {
    /* T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT: 인쇄창 @page margin:12mm 10mm 가 콘텐츠박스를 엔진
       차원에서 중앙 배치 → rx-wrap 은 박스를 채움(margin:0 auto). 직전의 템플릿-레벨 @page margin:0 선언은
       래퍼 @page(margin:12mm 10mm)를 덮어써 처방전만 shrink-to-fit 쏠림 재발 → 제거(@page=인쇄창 래퍼 단일 소유). */
    /* T-20260629-foot-DOCPRINT-CENTER-ALIGN(REOPEN/AC-5): 상단 +68px 하향 → 콘텐츠박스 273mm→255mm.
       AC-6: 상단 30→23mm(2줄↑) 재조정 → 콘텐츠박스 255mm→262mm(=297-23-12), 하단 12mm 클립가드 유지. */
    /* T-20260730-foot-RX-STANDARD-DERM-FORMAT-UNIFY: 인쇄 경로는 A4 물리 인쇄가능영역(190mm 콘텐츠박스)에
       맞춰 배치(724px=191.56mm 는 .page 190mm 박스 초과 → 중앙정렬 파이프라인과 충돌). 서식 요소
       (외곽선 2px·의약품표 colgroup·헤더색·타이틀·보험순서)는 미리보기와 동일 유지 → 3경로 서식 정합.
       무패딩(내부 표 720px full-width, 미리보기와 동일 구조). 외부 인쇄 파이프라인 .page/@page 무접촉. */
    .rx-wrap { width: 190mm; min-height: 262mm; padding: 0; margin: 0 auto; border: 2px solid #000; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .rx-wrap td[style*="background:#f8f8f8"] { white-space: nowrap; font-size: 8.5pt; }
  }
</style>
<div class="rx-wrap">

  <!-- ① 상단 헤더 -->
  <div style="display:flex; align-items:flex-start; gap:8px; margin-bottom:3px;">
    <!-- T-20260719-foot-RXPRINT-LAYOUT-4FIX AC-①: 좌측 상단 고객정보 과다노출 블록 삭제(김주연 총괄 현장 피드백).
         (구) T-20260612-foot-RX-TOPBAR-PATIENT-HIRA-MISSING 이 넣은 환자정보/성명/생년월일/주민번호/연락처/주소
         6줄 블록 = 하단 ③ 요양급여 서식표(성명·주민번호)와 중복 + 연락처·주소·생년월일 과다노출. 삭제.
         ★법정 필수 기재(환자 성명·주민등록번호, 의료법 시행규칙 §12)는 하단 서식표에 존치 → §12 무위반.
         ★RX-DOCTOR-BIND(처방의료인 성명·면허 빨간박스)와는 다른 블록 — 그 실사고 수정분은 무접촉.
         제거로 생긴 좌측 공백은 우측 QR(72px)과 대칭 spacer(72px)로 채워 처방전 제목 페이지 중앙정렬 유지. -->
    <div style="width:72px; flex-shrink:0;"></div>
    <div style="flex:1; text-align:center;">
      <!-- T-20260601-foot-RX-QR-LABEL (현장 확정 재구현): 중앙 상단 [약국보관용/환자보관용] 구분
           라벨은 2장 출력 식별 표식으로 보존(현장 "절대 제거하지 말 것"). 제거 대상은 우측 상단
           QR 옆 absolute 오버레이뿐. -->
      <div style="font-size:8pt; margin-bottom:2px;">({{rx_copy_label}})</div>
      <div class="rx-title">처&nbsp;&nbsp;방&nbsp;&nbsp;전</div>
    </div>
    <!-- T-20260601-foot-DOC-PRINT-8FIX AC-3④: QR 자리 텍스트 삭제 + 처방전마다 QR 자동 삽입 -->
    <div style="width:72px; height:72px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
      {{rx_qr_html}}
    </div>
  </div>

  <!-- ② 보험 구분 -->
  <!-- T-20260730-foot-RX-STANDARD-DERM-FORMAT-UNIFY: 보험체크 순서/명칭 = 피부 A4 실측
       (건강보험·의료급여·산재·자동차·기타). 요양기관기호는 white-space:nowrap + flex-shrink:0 로
       8자리 미절단(잘림·줄바꿈 없이 전체 표시), 좌측 보험 span 은 min-width:0 으로 잔여폭 흡수. -->
  <div style="border:1px solid #000; padding:2px 6px; font-size:8pt; display:flex; justify-content:space-between; align-items:center; margin-bottom:-1px;">
    <span style="min-width:0;">[&bull;]건강보험&nbsp;&nbsp;[&nbsp;]의료급여&nbsp;&nbsp;[&nbsp;]산재보험&nbsp;&nbsp;[&nbsp;]자동차보험&nbsp;&nbsp;[&nbsp;]기타</span>
    <span style="white-space:nowrap; flex-shrink:0; padding-left:13px;">요양기관기호&nbsp;:&nbsp;&nbsp;{{clinic_code}}</span>
  </div>

  <!-- ③ 환자 + 의료기관 -->
  <table>
    <tbody>
      <tr>
        <td style="width:80px; background:#f8f8f8; text-align:center;">교부년월일번호</td>
        <td colspan="2">{{issue_date}}&nbsp;&nbsp;제&nbsp;{{issue_no}}&nbsp;호</td>
        <td rowspan="4" style="width:18px; background:#f8f8f8; text-align:center; font-size:7.5pt; padding:2px;">의<br>료<br>기<br>관</td>
        <td style="width:60px; background:#f8f8f8; text-align:center;">명&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;칭</td>
        <!-- T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT: 요양기관명 축 재배선 (처방전) -->
        <td>{{hira_institution_name}}</td>
      </tr>
      <tr>
        <td rowspan="3" style="width:18px; background:#f8f8f8; text-align:center; font-size:7.5pt; padding:2px;">환<br>자</td>
        <td style="width:55px; background:#f8f8f8; text-align:center;">성&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;명</td>
        <td style="width:160px;">{{patient_name}}</td>
        <td style="background:#f8f8f8; text-align:center;">전&nbsp;화&nbsp;번&nbsp;호</td>
        <!-- T-20260601-foot-DOC-PRINT-8FIX AC-3①: 전화칸에는 순수 전화번호만(팩스 중복 제거). 팩스는 아래 전용칸. -->
        <td>{{clinic_phone_only}}</td>
      </tr>
      <tr>
        <!-- T-20260719-foot-RXPRINT-LAYOUT-4FIX AC-②: 성명·주민번호 기입칸 아래 빈 여백(구 4행 좌측 빈 td 2개) 제거.
             의료기관 측이 4행(명칭·전화·팩스·E-mail)을 요구해 환자 측 4행째가 빈칸으로 떠 있던 문제 →
             주민번호 라벨·값 셀을 rowspan=2 로 확장해 4행째 빈 여백을 흡수(빈 박스 소멸). E-mail 행은 정렬 존치. -->
        <td rowspan="2" style="background:#f8f8f8; text-align:center;">주&nbsp;민&nbsp;번&nbsp;호</td>
        <td rowspan="2" style="vertical-align:middle;">{{patient_rrn}}</td>
        <td style="background:#f8f8f8; text-align:center;">팩&nbsp;스&nbsp;번&nbsp;호</td>
        <td>{{clinic_fax}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">E-mail&nbsp;주소</td>
        <!-- T-20260623-foot-CLINICINFO-HOSPITAL-EMAIL-RXBIND: 의료기관 E-mail = 병원(기관) 이메일 자동 바인딩. 미입력 시 빈칸. -->
        <td>{{clinic_email}}</td>
      </tr>
    </tbody>
  </table>

  <!-- ④ 진단 + 의사 -->
  <table style="border-top:none;">
    <tbody>
      <tr>
        <td rowspan="4" style="width:55px; background:#f8f8f8; text-align:center; font-size:8pt;">질병분류기호</td>
        <!-- T-20260730-foot-RX-STANDARD-DERM-FORMAT-UNIFY: 피부 10칸 글자분해 미적용 → foot 코드+명칭 유지.
             질병분류기호 칸을 코드 셀 + 명칭 셀(diag_name)로 분리(명칭 셀만 신규). diag_name_N 은 이미 바인딩됨. -->
        <td style="width:62px;">{{diag_code_1}}</td>
        <td style="width:150px;">{{diag_name_1}}</td>
        <td rowspan="4" style="width:65px; background:#f8f8f8; text-align:center; font-size:8pt;">처&nbsp;방<br>의료인의<br>성&nbsp;&nbsp;&nbsp;&nbsp;명</td>
        <!-- T-20260601-foot-DOC-PRINT-8FIX AC-1: 도장 우하단 고정 제거 → 처방의료인 성명 근방 직인 -->
        <!-- T-20260718-foot-DOCPRINT-RX-DOCTOR-BIND: 처방의료인 성명 = 처방전 전용 {{prescriber_name}}(실 의료인·사람).
             ★{{doctor_name}}(billing 대표자 축)은 미지정 시 기관명으로 폴백(T-20260713 UNLINKED, field-confirmed)해
             처방전 처방의료인 성명이 기관명으로 찍혀 §12①4 위반·약국 반려(실사고) → 공유 토큰 오염 분리. -->
        <td rowspan="4" style="width:130px;">{{prescriber_name}}&nbsp;&nbsp;{{doctor_seal_html}}</td>
        <td style="width:55px; background:#f8f8f8; text-align:center;">면&nbsp;허&nbsp;종&nbsp;별</td>
        <td>의사</td>
      </tr>
      <tr>
        <td>{{diag_code_2}}</td>
        <td>{{diag_name_2}}</td>
        <td style="background:#f8f8f8; text-align:center;">면&nbsp;허&nbsp;번&nbsp;호</td>
        <!-- T-20260718-foot-DOCPRINT-RX-DOCTOR-BIND: §12①4 처방의료인 면허번호 = 처방전 전용 {{prescriber_license_no}}
             (성명 {{prescriber_name}}과 동일 clinicDoctor 사람 기준 → 이름↔면허 정합, 기관명 폴백 오염 차단). -->
        <td>{{prescriber_license_no}}</td>
      </tr>
      <tr style="{{diag_row_3_style}}">
        <td>{{diag_code_3}}</td>
        <td>{{diag_name_3}}</td>
        <td colspan="2"></td>
      </tr>
      <tr style="{{diag_row_4_style}}">
        <td>{{diag_code_4}}</td>
        <td>{{diag_name_4}}</td>
        <td colspan="2"></td>
      </tr>
    </tbody>
  </table>

  <!-- ⑤ 처방 의약품 -->
  <!-- T-20260702-foot-DOCPRINT-RX-FEEBREAKDOWN-LAYOUT AC-8: 참조양식(IMG_8777) 처방의약품 표 컬럼 폭 정합 —
       명칭(최광폭 잔여)/투약량·횟수·일수(협폭)/용법(광폭≈30%). 직전 용법 110px 는 참조 대비 과협소였음.
       라벨 문구(1회 투약량/1일투여 횟수/총투약 일수)는 표준처방전 표기라 미변경(참조 문구차는 planner 확인 대상). -->
  <!-- T-20260730-foot-RX-STANDARD-DERM-FORMAT-UNIFY: 의약품표 컬럼폭 = 피부 A4 실측 colgroup 337/80/80/80/143 (합 720=유효폭). -->
  <table style="margin-top:4px;">
    <colgroup>
      <col style="width:337px;" /><col style="width:80px;" /><col style="width:80px;" /><col style="width:80px;" /><col style="width:143px;" />
    </colgroup>
    <thead>
      <tr>
        <th>처&nbsp;방&nbsp;의&nbsp;약&nbsp;품&nbsp;의&nbsp;명&nbsp;칭</th>
        <th>1회<br>투약량</th>
        <th>1일투여<br>횟&nbsp;&nbsp;&nbsp;수</th>
        <th>총투약<br>일&nbsp;&nbsp;&nbsp;수</th>
        <th>용&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;법</th>
      </tr>
    </thead>
    <tbody>
      {{rx_items_html}}
    </tbody>
  </table>

  <!-- ⑥ 주사제 처방내역 -->
  <!-- T-20260730-foot-RX-STANDARD-DERM-FORMAT-UNIFY: 피부 A4 실측 정합 — 주사제 섹션 헤더 #b3b2b2 + 최소 5행.
       (약품행 자동분리(주사제 라우팅)는 이번 범위 제외 → 빈 5행 유지.) 상단 ⑤ 의약품표와 동일 colgroup(337/80/80/80/143)
       으로 컬럼 경계 정렬. 조제시 참고사항 헤더는 최우측 143px 컬럼, 그 아래 5행 우측 셀이 기입란. -->
  <table style="border-top:none;">
    <colgroup>
      <col style="width:337px;" /><col style="width:80px;" /><col style="width:80px;" /><col style="width:80px;" /><col style="width:143px;" />
    </colgroup>
    <tbody>
      <tr>
        <td colspan="4" style="background:#b3b2b2; font-weight:bold; text-align:center; font-size:8.5pt;">
          주사제&nbsp;처방내역&nbsp;&nbsp;(&nbsp;원내조제&nbsp;[&nbsp;&nbsp;&nbsp;]&nbsp;,&nbsp;원외조제&nbsp;[&nbsp;&nbsp;&nbsp;]&nbsp;)
        </td>
        <td style="background:#b3b2b2; text-align:center; font-weight:bold; font-size:8pt;">조제시&nbsp;참고사항</td>
      </tr>
      <tr style="height:24px;"><td></td><td></td><td></td><td></td><td></td></tr>
      <tr style="height:24px;"><td></td><td></td><td></td><td></td><td></td></tr>
      <tr style="height:24px;"><td></td><td></td><td></td><td></td><td></td></tr>
      <tr style="height:24px;"><td></td><td></td><td></td><td></td><td></td></tr>
      <tr style="height:24px;"><td></td><td></td><td></td><td></td><td></td></tr>
    </tbody>
  </table>

  <!-- ⑦ 사용기간 -->
  <table style="border-top:none;">
    <tbody>
      <tr>
        <td style="width:55px; background:#f8f8f8; text-align:center;">사&nbsp;용&nbsp;기&nbsp;간</td>
        <td style="width:290px;">교부일로부터&nbsp;&nbsp;(&nbsp;&nbsp;{{usage_days}}&nbsp;&nbsp;)&nbsp;&nbsp;일간</td>
        <td>사용기간내에 약국에 제출하여야 합니다</td>
      </tr>
    </tbody>
  </table>

  <!-- ⑧ 의약품조제내역 -->
  <table style="border-top:none;">
    <tbody>
      <tr>
        <td colspan="4" style="text-align:center; font-weight:bold; font-size:9.5pt; background:#f0f0f0; padding:3px;">
          의&nbsp;&nbsp;약&nbsp;&nbsp;품&nbsp;&nbsp;조&nbsp;&nbsp;제&nbsp;&nbsp;내&nbsp;&nbsp;역
        </td>
      </tr>
      <tr>
        <td rowspan="4" style="width:22px; background:#f8f8f8; text-align:center; font-size:7.5pt; padding:2px;">조<br>제<br>내<br>역</td>
        <td style="width:90px; background:#f8f8f8;">조제기관의명</td>
        <td rowspan="4" style="min-height:80px; vertical-align:top; width:200px;"></td>
        <td rowspan="4" style="font-size:8pt; vertical-align:top; padding:4px;">처방의 변경.수정.확인.대체시 그 내용 등</td>
      </tr>
      <tr>
        <!-- T-20260721-foot-RXPRINT-ISSUENO-DATE-PHARMACIST-LABEL (총괄 요청): 조제내역 항목명에 '사' 1글자 추가 → 조제약사 성명 -->
        <td style="background:#f8f8f8; font-size:8pt;">조&nbsp;&nbsp;제&nbsp;&nbsp;약&nbsp;&nbsp;사&nbsp;&nbsp;성&nbsp;&nbsp;명</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">조제량(조제일수)</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; font-size:8pt;">조&nbsp;&nbsp;제&nbsp;&nbsp;년&nbsp;&nbsp;월</td>
      </tr>
    </tbody>
  </table>

</div>
`;

// ─── 진료비 계산서·영수증 ───
// T-20260517-foot-FORM-SCREENSHOT-FIX: bill_receipt HTML/CSS 신규 구현
// 변수: patient_name, patient_rrn, visit_date, clinic_name, clinic_address,
//       insurance_covered, non_covered, total_amount, doctor_name, issue_date

const BILL_RECEIPT_HTML = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .br-wrap {
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', NanumGothic, sans-serif;
    font-size: 9pt;
    color: #000;
    background: #fff;
    padding: 8mm 10mm;
    width: 190mm;
    min-height: 267mm;
  }
  .br-wrap table { width: 100%; border-collapse: collapse; }
  .br-wrap td, .br-wrap th {
    border: 1px solid #000;
    padding: 2px 5px;
    vertical-align: middle;
    font-size: 8.5pt;
  }
  .br-wrap th {
    background: #f0f0f0;
    font-weight: bold;
    text-align: center;
    white-space: nowrap;
  }
  .br-title {
    text-align: center;
    font-size: 18pt;
    font-weight: bold;
    letter-spacing: 8px;
    padding: 6px 0 5px;
  }
  .br-label { background: #f8f8f8; white-space: nowrap; }
  .br-num { text-align: right; padding-right: 8px; }
  .br-footer { font-size: 8.5pt; margin-top: 6px; border: 1px solid #000; padding: 6px 10px; }
  .br-sign-row { display: flex; justify-content: flex-end; gap: 24px; margin-top: 4px; }
  .br-sign-item { display: flex; align-items: center; gap: 6px; font-size: 8.5pt; }
  .br-sign-box { border: 1px solid #000; width: 60px; height: 26px; display: inline-block; }
  .br-notice { font-size: 7.5pt; color: #333; margin-top: 8px; line-height: 1.5; }
  @media print {
    /* T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT: 인쇄창 @page margin:12mm 10mm 가 콘텐츠박스를 엔진
       차원에서 중앙 배치 → br-wrap 은 박스를 채움(margin:0 auto). @page=인쇄창 래퍼 단일 소유. */
    /* T-20260629-foot-DOCPRINT-CENTER-ALIGN(REOPEN/AC-5): 상단 +68px 하향 → 콘텐츠박스 273mm→255mm.
       AC-6: 상단 30→23mm(2줄↑) 재조정 → 콘텐츠박스 255mm→262mm(=297-23-12), 하단 12mm 클립가드 유지. */
    .br-wrap { width: 190mm; min-height: 262mm; padding: 6mm 8mm; margin: 0 auto; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
<div class="br-wrap">

  <!-- 제목 -->
  <div class="br-title">진료비 계산서·영수증</div>

  <!-- 요양기관 + 환자 정보 -->
  <table style="margin-bottom:-1px;">
    <tbody>
      <tr>
        <td rowspan="3" class="br-label" style="width:20px; text-align:center; font-size:7.5pt; padding:2px; letter-spacing:1px;">요<br>양<br>기<br>관</td>
        <td class="br-label" style="width:70px; text-align:center;">명&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;칭</td>
        <!-- T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT: 요양기관명 축 재배선 (영수증) -->
        <td colspan="3" style="font-weight:bold;">{{hira_institution_name}}</td>
        <td rowspan="3" class="br-label" style="width:20px; text-align:center; font-size:7.5pt; padding:2px; letter-spacing:1px;">환<br>자</td>
        <td class="br-label" style="width:70px; text-align:center;">성&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;명</td>
        <td colspan="3" style="font-weight:bold;">{{patient_name}}</td>
      </tr>
      <tr>
        <td class="br-label" style="text-align:center;">주&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;소</td>
        <td colspan="3">{{clinic_address}}</td>
        <td class="br-label" style="text-align:center;">주민번호</td>
        <td colspan="3">{{patient_rrn}}</td>
      </tr>
      <tr>
        <td class="br-label" style="text-align:center;">진&nbsp;료&nbsp;일</td>
        <td colspan="3">{{visit_date}}</td>
        <td class="br-label" style="text-align:center;">발&nbsp;행&nbsp;일</td>
        <td colspan="3">{{issue_date}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 진료비 내역 -->
  <table>
    <thead>
      <tr>
        <th rowspan="2" style="width:24%;">구&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;분</th>
        <th colspan="2">급&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;여</th>
        <th rowspan="2" style="width:20%;">비&nbsp;&nbsp;급&nbsp;&nbsp;여</th>
        <th rowspan="2" style="width:18%;">합&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;계</th>
      </tr>
      <tr>
        <th style="width:20%;">공단부담</th>
        <th style="width:18%;">본인부담</th>
      </tr>
    </thead>
    <tbody>
      <!-- T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT (diagnose-first forward-fix):
           정적 하드코딩 그리드(전액을 '처치 및 수술료' 한 행 비급여 열에 뭉뚱그림 = 항목 미구분/비급여 한덩어리,
           공단·본인 per-category 미채움) → 항목별 동적 그리드. 세부산정내역과 동일 SSOT(buildFootBillDetailItems)를
           HIRA 항목분류로 집계해 공단부담/본인부담/비급여/합계를 행별 배치. buildBillReceiptFeeGridHtml 산출.
           소계행 공단부담/본인부담/비급여는 동일 항목 소스라 구조적 정합.
           T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 소계·총 합계는 receipt_total(본인+비급여, 공단 제외) 바인딩
           — 공단부담(insurance_covered) 열은 표시 유지. (旧 total_amount=공단포함 grandTotal placeholder 제거: 주석 내 잔존 시 bind 로 렌더 유출) -->
      {{fee_grid_html}}
      <tr>
        <td class="br-label" style="font-weight:bold;">소&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;계</td>
        <td class="br-num" style="font-weight:bold;">{{insurance_covered}}</td>
        <!-- T-20260708-foot-BILLING-DOCFEE-INSAMOUNT-MISSING AC-2: 본인부담 셀 하드코딩 공란 → {{copayment}} 바인딩.
             copayment 값은 3경로(재발급/배치/단건) 모두 산출·bind되나 template placeholder 누락으로 미출력이던 근인. -->
        <td class="br-num" style="font-weight:bold;">{{copayment}}</td>
        <td class="br-num" style="font-weight:bold;">{{non_covered}}</td>
        <!-- T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): '합계' = 급여 본인부담금 + 비급여
             ({{receipt_total}}, 공단부담금 제외). 공단부담 열({{insurance_covered}})은 표시 그대로 유지 — 합계에서만 제외. -->
        <td class="br-num" style="font-weight:bold;">{{receipt_total}}</td>
      </tr>
      <tr style="height:32px;">
        <td class="br-label" style="font-size:9pt; font-weight:bold; text-align:center;">총&nbsp;진료비&nbsp;합계</td>
        <td colspan="4" style="font-size:13pt; font-weight:bold; text-align:center; letter-spacing:2px;">
          <!-- T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 환자 청구 합계 = 본인부담금 + 비급여(공단 제외). -->
          ₩ {{receipt_total}}
        </td>
      </tr>
    </tbody>
  </table>

  <!-- 영수 문구 + 서명란 -->
  <div class="br-footer">
    <div style="text-align:center; font-size:10pt; font-weight:bold; margin-bottom:4px;">
      위와 같이 청구(영수)합니다.
    </div>
    <div class="br-sign-row">
      <div class="br-sign-item">
        <!-- T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT: 요양기관명 축 재배선 (영수증 청구서명란) -->
        요양기관명 : <span style="font-weight:bold;">{{hira_institution_name}}</span>
      </div>
      <div class="br-sign-item">
        진료의사 : {{doctor_name}}&nbsp;{{doctor_seal_html}}
      </div>
    </div>
  </div>

  <!-- 주의사항 -->
  <!-- T-20260721-foot-COPAY-PROVISIONAL-RELABEL: 급여항목 본인부담 확정 라벨 「본인부담금」 (총괄 김주연 confirm).
       법정 필수 칸 밖 주의(설명) 영역 — 급여/비급여 그리드 칸·값(공단부담/본인부담) canon 불변, 텍스트 설명만. -->
  <div class="br-notice">
    ※ 상기 급여 항목의 환자 부담분은 「본인부담금」으로 표기됩니다.<br>
    ※ 이 계산서·영수증은 연말정산 의료비 공제 및 보험 청구에 사용하실 수 있습니다.<br>
    ※ 영수증 분실 시 재발급이 되지 않을 수 있으니 잘 보관하시기 바랍니다.
  </div>

</div>
`;

// ─── 보험청구서 (T-20260522-foot-INS-DOC-PRINT) ───

const INS_CLAIM_FORM_HTML = `
${COMMON_STYLE}
<div class="form-wrap">
  <div class="title" style="font-size:18pt; letter-spacing:8px; margin-bottom:6px;">보 험 청 구 서</div>
  <div class="subtitle" style="font-size:9pt; margin-bottom:10px; color:#555;">
    실손의료비 / 단체보험 / 자동차보험 공통 청구서식
  </div>

  <!-- 1. 환자 정보 -->
  <div style="font-weight:bold; font-size:9.5pt; margin:6px 0 2px; background:#f0f0f0; padding:2px 4px;">■ 1. 환자 인적사항</div>
  <table style="margin-bottom:6px;">
    <tbody>
      <tr>
        <td style="width:80px; background:#f8f8f8; text-align:center;">성&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;명</td>
        <td style="width:160px;">{{patient_name}}</td>
        <td style="width:100px; background:#f8f8f8; text-align:center;">주민등록번호</td>
        <td>{{patient_rrn}}</td>
      </tr>
      <!-- T-20260629-foot-DOCPRINT-COLWIDTH-WRAP-AUDIT: 연락처·주소를 각각 전폭(colspan=3) 행으로 분리 → 긴 주소 단일 줄 확보 -->
      <tr>
        <td style="background:#f8f8f8; text-align:center;">연&nbsp;&nbsp;락&nbsp;&nbsp;처</td>
        <td colspan="3">{{patient_phone}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">주&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;소</td>
        <td colspan="3">{{patient_address}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 2. 건강보험 정보 -->
  <div style="font-weight:bold; font-size:9.5pt; margin:6px 0 2px; background:#f0f0f0; padding:2px 4px;">■ 2. 건강보험 자격정보</div>
  <table style="margin-bottom:6px;">
    <tbody>
      <tr>
        <td style="width:80px; background:#f8f8f8; text-align:center;">건보 등급</td>
        <td style="width:160px;">{{insurance_grade_label}}</td>
        <td style="width:100px; background:#f8f8f8; text-align:center;">본인부담률</td>
        <td style="width:120px;">{{copay_rate}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">산정특례코드</td>
        <td colspan="3">{{special_treatment_code}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 3. 진단 정보 -->
  <div style="font-weight:bold; font-size:9.5pt; margin:6px 0 2px; background:#f0f0f0; padding:2px 4px;">■ 3. 상병명</div>
  <table style="margin-bottom:6px;">
    <thead>
      <tr>
        <th style="width:30px;">구분</th>
        <th style="width:90px;">상병코드</th>
        <th>상병명</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">주</td>
        <td>{{diag_code_1}}</td>
        <td>{{diag_name_1}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">부</td>
        <td>{{diag_code_2}}</td>
        <td>{{diag_name_2}}</td>
      </tr>
      <tr style="{{diag_row_3_style}}">
        <td style="background:#f8f8f8; text-align:center;">부</td>
        <td>{{diag_code_3}}</td>
        <td>{{diag_name_3}}</td>
      </tr>
      <tr style="{{diag_row_4_style}}">
        <td style="background:#f8f8f8; text-align:center;">부</td>
        <td>{{diag_code_4}}</td>
        <td>{{diag_name_4}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 4. 진료비 내역 -->
  <div style="font-weight:bold; font-size:9.5pt; margin:6px 0 2px; background:#f0f0f0; padding:2px 4px;">■ 4. 진료비 내역</div>
  <table style="margin-bottom:6px;">
    <tbody>
      <tr>
        <td style="width:80px; background:#f8f8f8; text-align:center;">진료일</td>
        <td style="width:160px;">{{visit_date}}</td>
        <td style="width:100px; background:#f8f8f8; text-align:center;">발행일</td>
        <td>{{issue_date}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">진료비 합계</td>
        <td style="font-weight:bold; text-align:right;">{{total_amount}}&nbsp;원</td>
        <td style="background:#f8f8f8; text-align:center;">공단부담금</td>
        <td style="text-align:right;">{{insurance_covered}}&nbsp;원</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; text-align:center;">본인부담금</td>
        <td style="text-align:right;">{{copayment}}&nbsp;원</td>
        <td style="background:#f8f8f8; text-align:center;">비&nbsp;&nbsp;&nbsp;급&nbsp;&nbsp;&nbsp;여</td>
        <td style="text-align:right;">{{non_covered}}&nbsp;원</td>
      </tr>
    </tbody>
  </table>

  <!-- 5. 의료기관 확인 -->
  <div style="font-weight:bold; font-size:9.5pt; margin:6px 0 2px; background:#f0f0f0; padding:2px 4px;">■ 5. 의료기관 확인</div>
  <div style="font-size:9pt; padding:6px 0; line-height:1.8;">
    위와 같이 진료하였음을 증명합니다.
  </div>
  <div style="text-align:center; font-size:10pt; padding:10px 0 6px;">
    {{issue_date}}
  </div>
  <table style="margin-top:4px; width:auto; min-width:320px; margin-left:auto;">
    <tbody>
      <tr>
        <td style="border:none; padding:2px 6px 2px 0; background:none; white-space:nowrap;">의&nbsp;료&nbsp;기&nbsp;관&nbsp;명&nbsp;&nbsp;:&nbsp;</td>
        <!-- T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT: 요양기관명 축 재배선 (공단 보험청구서) -->
        <td style="border:none; padding:2px 0; background:none; min-width:160px;">{{hira_institution_name}}</td>
      </tr>
      <tr>
        <td style="border:none; padding:2px 6px 2px 0; background:none; white-space:nowrap;">전&nbsp;&nbsp;화&nbsp;&nbsp;번&nbsp;&nbsp;호&nbsp;&nbsp;:&nbsp;</td>
        <td style="border:none; padding:2px 0; background:none;">{{clinic_phone}}</td>
      </tr>
      <tr>
        <td style="border:none; padding:2px 6px 2px 0; background:none; white-space:nowrap;">담&nbsp;&nbsp;당&nbsp;&nbsp;의&nbsp;&nbsp;사&nbsp;&nbsp;:&nbsp;</td>
        <!-- T-20260601-foot-DOC-PRINT-8FIX AC-1: 담당의사 성명 근방 직인 -->
        <td style="border:none; padding:2px 0; background:none;">{{doctor_name}}&nbsp;&nbsp;{{doctor_seal_html}}</td>
      </tr>
    </tbody>
  </table>

  <div style="font-size:8.5pt; margin-top:14px; border-top:1px solid #999; padding-top:4px; line-height:1.8; color:#555;">
    ※ 본 서류는 보험청구 목적으로 발급되었으며 타 용도로 사용할 수 없습니다.<br>
    ※ 산정특례코드가 있는 경우 해당 코드를 보험사에 함께 제출하시기 바랍니다.
  </div>
</div>
`;

// ─── 균검사 결과지(검사결과 보고서) — T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH (AC-4)
//      + T-20260617-foot-KOHGEN-HTMLPORT (대표원장 자작 HTML 양식 이식, KOH-REPORT-TAB Phase2 unblock) ───
//
//   정본 양식 = 대표원장 자작 웹앱(F0BB4DVM1KP, 균검사지 오리진). 종전 "검사결과 양식.png" 위에
//   대표원장 확정 레이아웃을 1:1 이식. 단일 info-table(좌측 회색 라벨) + 결과 table + footer + 연락처.
//
//   ★ 자체완결·id-scoped(#koh-report-sheet) — global `* {}` reset 제거. 앱 DOM(KohResultDialog)에
//     dangerouslySetInnerHTML 주입 시 전역 스타일 오염 0(모든 selector 가 #koh-report-sheet 하위 한정).
//   ★ hex 색상만 사용(oklch 없음) — html2canvas 1.4.1 의 Tailwind oklch 파싱 충돌 회피(복사/저장 PNG).
//   ★ 한글 시스템 폰트 스택 — 외부 폰트(Noto Sans KR) 로드 타이밍 의존 제거(이미지 캡처 안정).
//
//   고정값(대표원장 양식, 1차 고정 — AC-0 #3 지점/의사 파생경로 부재):
//     의뢰기관=오블리브의원 서울오리진점 / 담당의·검사자=문지은 / 의사면허=145617 / Tel 02)6956-3438.
//     ※ RPC publish_koh_result 가 field_data.request_org 를 '오블리브의원'으로 덮으나, 본 템플릿은
//       의뢰기관을 고정 렌더 → field_data 의존 0(마이그 무변경, NO-DDL).
//   검사결과 라인(D6201002 / ▶임상미생물 KOH mount / Hyphae:+ · Yeast:-)은 양식 고정값
//     (AC-3 "결과값 개별 입력 없음·모든 환자 동일 결과값") → 템플릿 고정(field_data 미주입). Hyphae/Yeast 라벨만 적색.
//   바인딩(환자별): request_no/patient_name/chart_number/birth_date/remark/collected_date/requested_date/specimen_type/specimen_no.
const KOH_RESULT_HTML = `
<style>
  #koh-report-sheet { box-sizing:border-box; width:794px; margin:0 auto; padding:76px 57px;
    background:#ffffff; color:#333333; font-size:14px; line-height:1.5;
    font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',NanumGothic,sans-serif; }
  #koh-report-sheet * { box-sizing:border-box; }
  #koh-report-sheet h1 { text-align:center; font-size:28px; font-weight:700; margin:0 0 40px; color:#000000; }
  #koh-report-sheet table { width:100%; border-collapse:collapse; margin:0 0 20px;
    border-top:2px solid #bbbbbb; border-bottom:2px solid #bbbbbb; }
  #koh-report-sheet th, #koh-report-sheet td { padding:10px 12px; border:1px solid #dddddd;
    vertical-align:middle; font-size:14px; }
  #koh-report-sheet .info-table th { background:#f5f5f5; width:130px; color:#333333; font-weight:500; text-align:left; }
  #koh-report-sheet .info-table td { color:#000000; font-weight:400; }
  #koh-report-sheet .spacer td { height:15px; border:none; background:#ffffff; padding:0; }
  #koh-report-sheet .result-table { margin-top:20px; }
  #koh-report-sheet .result-table th { background:#f5f5f5; text-align:center; font-weight:500;
    border-bottom:2px solid #bbbbbb; padding:10px 8px; }
  #koh-report-sheet .result-table td { text-align:center; padding:14px 8px; }
  #koh-report-sheet .footer-section { margin-top:40px; display:flex; justify-content:center; gap:100px;
    font-size:13px; font-weight:400; color:#333333; }
  #koh-report-sheet .contact-info { margin-top:50px; font-size:13px; color:#333333; line-height:1.5; text-align:left; }
  #koh-report-sheet .label-red { color:#e74c3c; }
  #koh-report-sheet .val-black { color:#000000; }
  @media print {
    #koh-report-sheet { width:210mm; min-height:297mm; padding:20mm 15mm; }
  }
</style>
<div id="koh-report-sheet">
  <h1>검사결과 보고서</h1>

  <table class="info-table">
    <tbody>
      <tr><th>의뢰번호</th><td>{{request_no}}</td></tr>
      <tr><th>의뢰기관</th><td>오블리브의원 서울오리진점</td></tr>
      <tr><th>담당의</th><td>문지은</td></tr>
      <tr class="spacer"><td colspan="2"></td></tr>
      <tr><th>수진자명</th><td>{{patient_name}}</td></tr>
      <tr><th>차트번호</th><td>{{chart_number}}</td></tr>
      <tr><th>생년월일</th><td>{{birth_date}}</td></tr>
      <tr><th>비고</th><td>{{remark}}</td></tr>
      <tr class="spacer"><td colspan="2"></td></tr>
      <tr><th>검체채취일</th><td>{{collected_date}}</td></tr>
      <tr><th>검사의뢰일</th><td>{{requested_date}}</td></tr>
      <tr><th>검체종류</th><td>{{specimen_type}}</td></tr>
      <tr><th>검체번호</th><td>{{specimen_no}}</td></tr>
    </tbody>
  </table>

  <table class="result-table">
    <thead>
      <tr>
        <th style="width:15%">보험코드</th>
        <th style="width:25%">검사명</th>
        <th style="width:10%">L/H</th>
        <th style="width:30%">검사결과</th>
        <th style="width:20%">참고치</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>D6201002</td>
        <td style="text-align:left; padding-left:12px;">&#9654; 임상미생물<br>KOH mount</td>
        <td></td>
        <td style="text-align:left; padding-left:20px;">
          <span class="label-red">Hyphae : </span><span class="val-black">+</span><br>
          <span class="label-red">Yeast : </span><span class="val-black">-</span>
        </td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <div class="footer-section">
    <div>의사면허 : 145617 문지은</div>
    <div>검사자 : 145617 문지은</div>
  </div>

  <div class="contact-info">
    Tel. 02)6956-3438<br>
    Fax. 02)6956-3439
  </div>
</div>
`;

// ─── 진료비 계산서·영수증 신양식 (T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN) ───
//
// 총괄(김주연) 컨펌 시안 F0BHY545XTJ = 국민건강보험 요양급여의 기준에 관한 규칙 [별지 제6호서식]
//   기반 도수센터(obliv-body-crm) 스타일 재디자인. 별지 제6호서식 draft 레이아웃을 이 라이브 상수로
//   승격(복제) + foot SSOT 바인딩으로 배선. ⚠ draft 모듈을 import/참조하지 않고 자립 상수로 복제
//   (라이브-draft 런타임 커플링 0 — FEEDOC 격리 불변식 유지).
//
// ⚠ 격리 제약(AC5): 기존 bill_receipt(BILL_RECEIPT_HTML) 템플릿/렌더 경로 완전 무접촉. 이 상수는
//   신규 form_key='bill_receipt_new' 전용이며 기존 5칼럼 양식과 독립. 기존 출력 회귀 0.
//
// 바인딩(전량 기존 foot SSOT 재사용 — AC6 금액 bind 회귀 0):
//   patient_name/patient_birthdate/record_no  = loadAutoBindContext (실 환자 레코드, AC2 자동)
//   receipt_representative                     = clinics.representative_name(=박영진, 개설자 고정) — AC3 정정
//     ⚠ [2026-07-15T17:33 AC3 정정, reporter U0ATDB587PV 명시 재지시 MSG-mq8y] 진료비 계산서·영수증은
//       의료법상 진료의 축 아닌 **개설자(대표자) 기준**. 前 스펙(대표자={{doctor_name}} 진료의)은 폐기(policy_superseded).
//       값소스 = clinics.representative_name(canonical, body CLINIC-REPNAME 패턴 포트) → {{receipt_representative}} 토큰.
//       진단서·처방전 등 진료의 축 서류는 {{doctor_name}} 무접촉(축 오염 금지). 도장(법인/원장직인)은 sibling
//       T-20260715-foot-RECEIPT-REPNAME-SEAL-BODYPORT(P1)이 co-deploy — 본 DOCFEE는 대표자 VALUE만 정정.
//   copayment(본인부담)/insurance_covered(공단부담)/non_covered(비급여)/total_amount(진료비총액)
//                                             = computeFootBilling + applyBillingFallback (기존 동일)
//   patient_amount                            = 급여 본인부담금 + 비급여 (공단 제외) — applyBillingFallback
//                                               신양식 전용 additive 키. ⑧ 환자부담 총액.
// 고정 표기(AC4): 진료과목='피부과' · 사업자등록번호='457-23-00938' · 전화번호='02-6956-3438' (리터럴).
//   (T-20260717-foot-RECEIPT-NEWFORM-3FIX #3: 사업자등록번호 정본 457-23-00938 로 갱신·확정. 구번호 잔재 제거 T-20260722-foot-BILLRECEIPT-NEWFORM-STALE-BIZNO-COMMENT-FIX)
//
// AC7 B안(T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY, 김주연 총괄 ts 1784020522.027429):
//   총 합계(환자 실부담) = 급여 본인부담금 + 비급여. 공단부담금은 합계에서만 제외, 항목·칸·금액은 표시 유지.
//   → 별지 제6호 구조가 B안을 자연 구현: ⑦ 공단부담 총액(insurance_covered)은 별도 라인 표시 유지,
//     ⑧ 환자부담 총액(patient_amount = 본인+비급여)이 공단을 제외한 실 청구 합계. 공단 열/합계 ②도 표시.
const BILL_RECEIPT_NEW_HTML = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .rn-wrap {
    font-family: 'Malgun Gothic','Apple SD Gothic Neo',NanumGothic,sans-serif;
    font-size: 7.3pt; color:#000; background:#fff;
    padding: 6mm 8mm; width: 194mm; min-height: 285mm;
  }
  .rn-legal { font-size:7pt; margin-bottom:1mm; }
  .rn-title { text-align:center; font-size:14pt; font-weight:bold; letter-spacing:2px; padding:2px 0 4px; }
  .rn-title .chk { font-size:8.5pt; font-weight:normal; letter-spacing:0; }
  .rn-wrap table { width:100%; border-collapse:collapse; table-layout:fixed; }
  .rn-wrap td, .rn-wrap th { border:1px solid #000; padding:1px 3px; vertical-align:middle; font-size:7.3pt; line-height:1.12; }
  .rn-wrap th { background:#f2f2f2; font-weight:bold; text-align:center; }
  .rn-lbl { background:#f7f7f7; text-align:center; white-space:nowrap; }
  .rn-sub { font-size:6.4pt; color:#333; }
  .rn-num { text-align:right; font-variant-numeric:tabular-nums; padding-right:4px; }
  .rn-grp { background:#f7f7f7; text-align:center; font-size:6.8pt; width:16px; letter-spacing:1px; }
  .rn-flex { display:flex; gap:0; align-items:stretch; }
  .rn-left { flex:0 0 62%; }
  .rn-right { flex:1; margin-left:-1px; }
  .rn-right table { height:100%; }
  @media print {
    @page { size:A4 portrait; margin:0; }
    /* T-20260729-foot-DOC-LAYOUT-FIX ①: A4 중앙정렬 — width 210mm→190mm + margin:0 auto
       (T-20260629 누락 버그 수정: 210mm full-bleed 는 @page margin:0 에서 좌측 앵커 쏠림. 190mm+auto = 좌우 10mm belt 중앙). */
    .rn-wrap { width:190mm; padding:5mm 7mm; margin:0 auto; min-height:auto; }
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
</style>
<div class="rn-wrap">
  <div class="rn-legal">■ 국민건강보험 요양급여의 기준에 관한 규칙 [별지 제6호서식] &lt;개정 2024. 7. 18.&gt;</div>
  <!-- T-20260717-foot-RECEIPT-NEWFORM-3FIX #1: 대제목 위치 정렬 — 별지 제6호서식 표준은 제목이 페이지
       정중앙, 체크박스([■]외래…)는 좌측 고정. 前: chk+제목을 한 인라인 그룹으로 center → 제목이 우측으로
       밀림(off-center). chk 를 absolute left 로 흐름 밖에 두어 제목만 full-width 정중앙 정렬. -->
  <div class="rn-title" style="position:relative;"><span class="chk" style="position:absolute; left:0; top:50%; transform:translateY(-50%);">[■]외래 [ ]입원 ([ ]퇴원 [ ]중간)</span>진료비 계산서ㆍ영수증</div>

  <table style="margin-bottom:-1px;">
    <!-- T-20260722-foot-BILLRECEIPT-MASTER-FIXES §3: 야간(공휴일)·환자구분 [라벨][값] 2셀 분리 → 8번째 col 추가
         (종전 7칸=col7 에 라벨+값 한 셀 crammed). 타 필드와 동일한 [rn-lbl][값] 구조로 정합. -->
    <colgroup><col style="width:12%"><col style="width:15%"><col style="width:10%"><col style="width:16%"><col style="width:10%"><col style="width:13%"><col style="width:12%"><col style="width:12%"></colgroup>
    <tbody>
      <tr>
        <td class="rn-lbl">환자등록번호</td><td>{{record_no}}</td>
        <td class="rn-lbl">환자 성명</td>
        <td>{{patient_name}}</td>
        <td class="rn-lbl">진료기간</td><td>{{visit_date}}</td>
<!-- T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC: 출력시점 야간/공휴일 자동 판정 →
             체크박스 자동 체크(마크 소스=night_mark/holiday_mark, DocumentPrintPanel 배선). 미가산 시 공란(회귀0). -->
        <!-- T-20260722-foot-BILLRECEIPT-MASTER-FIXES §3: [라벨][값] 2셀 분리(종전 한 셀 <br> crammed). -->
        <td class="rn-lbl" style="font-size:6.4pt;">야간(공휴일)</td><td style="font-size:6.4pt;">[{{night_mark}}]야간 [{{holiday_mark}}]공휴일</td>
      </tr>
      <tr>
        <td class="rn-lbl">진료과목</td><td>피부과</td>
        <td class="rn-lbl" style="font-size:6.8pt;">질병군(DRG)</td><td></td>
        <td class="rn-lbl">병실</td><td></td>
        <!-- T-20260722-foot-BILLRECEIPT-MASTER-FIXES §3: [라벨][값] 2셀 분리(종전 한 셀 <br> crammed). -->
        <td class="rn-lbl" style="font-size:6.4pt;">환자구분</td><td style="font-size:6.4pt;">건강보험</td>
      </tr>
      <tr>
        <td class="rn-lbl">영수증번호</td><td colspan="7" style="text-align:left;">{{receipt_no}}</td>
      </tr>
    </tbody>
  </table>

  <div class="rn-flex">
    <div class="rn-left">
      <table>
        <colgroup><col style="width:16px"><col><col style="width:16%"><col style="width:16%"><col style="width:15%"><col style="width:16%"></colgroup>
        <thead>
          <tr>
            <th colspan="2" rowspan="3">항목</th>
            <th colspan="3">급여</th>
            <th rowspan="3">비급여</th>
          </tr>
          <tr><th colspan="2">일부 본인부담</th><th rowspan="2">전액<br>본인부담</th></tr>
          <tr><th>본인부담금</th><th>공단부담금</th></tr>
        </thead>
        <tbody>
          <!-- T-20260717-foot-RECEIPT-NEWFORM-3FIX #2: 진찰료 급여 본인부담금/공단부담금 컬럼 보완(표시 전용).
               foot 급여 = 진찰료(초진/재진 진찰료, footBillDetailCategory 기본→진찰료)가 원천이므로 급여 split은
               진찰료 행에 표기가 정합. 前: 급여 aggregate(copayment/insurance_covered)가 아래 '처치 및 수술료'
               행에 배치돼 진찰료 칸 공란·처치행 오표기 → 진찰료 행으로 이동(중복표기 방지: 처치행에서는 제거).
               값 원천=service_charges(Revenue Insurance Split SSOT), 원장 무접촉. 합계 ①/②와 동일값 정합. -->
          <!-- T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX 결함A: 진찰료 행 = aggregate '잔여'(remainder)
               = 최종 {{copayment}}/{{insurance_covered}} − 검사료/처치 급여분. 급여 검사(KOH)가 진찰료로 흡수되지
               않도록 검사료 행에 별도 표기(별지6호). 합계 ①②·⑦의 aggregate 토큰은 무접촉(remainder 는 신 토큰). -->
          <tr><td class="rn-grp" rowspan="18">기<br>본<br>항<br>목</td><td>진찰료</td><td class="rn-num">{{consult_copay}}</td><td class="rn-num">{{consult_ins}}</td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>입원료 (1인실)</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>입원료 (2·3인실)</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>입원료 (4인실 이상)</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>식대</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>투약 및 조제료 (행위료)</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>투약 및 조제료 (약품비)</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>주사료 (행위료)</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>주사료 (약품비)</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>마취료</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <!-- T-20260717-foot-RECEIPT-NEWFORM-3FIX #2: 급여 split 을 진찰료 행으로 이동(위) → 처치 및 수술료 행은
               급여 본인/공단 공란(foot 풋케어=비급여, 급여칸 부적합). 중복표기 제거.
               T-20260719-foot-BILLRECEIPT-NEWFORM-ITEMFIX AC-②: 비급여(전액본인부담) 칸에 category 집계 표시 —
               '처치 및 수술료'=풋케어 비급여({{proc_noncov}}), '검사료'=검사 비급여({{exam_noncov}}).
               (표시 전용, 집계 grain 무변경: {{proc_noncov}}+{{exam_noncov}}+{{etc_noncov}}=④{{non_covered}} 항상 정합.) -->
          <!-- T-20260722 결함A: 급여 검사·처치가 있으면 해당 행 급여(본인/공단) 칸에 별도 표기(진찰료 흡수 금지).
               foot 처치(풋케어)는 통상 비급여라 {{proc_copay}}/{{proc_ins}}=공란, 비급여 {{proc_noncov}} 표기. -->
          <tr><td>처치 및 수술료</td><td class="rn-num">{{proc_copay}}</td><td class="rn-num">{{proc_ins}}</td><td class="rn-num"></td><td class="rn-num">{{proc_noncov}}</td></tr>
          <tr><td>검사료</td><td class="rn-num">{{exam_copay}}</td><td class="rn-num">{{exam_ins}}</td><td class="rn-num"></td><td class="rn-num">{{exam_noncov}}</td></tr>
          <tr><td>영상진단료</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>방사선치료료</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>치료재료대</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>재활 및 물리치료료</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>정신요법료</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>전혈 및 혈액성분제제료</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td class="rn-grp" rowspan="12">선<br>택<br>항<br>목</td><td>CT 진단료</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>MRI 진단료</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>PET 진단료</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>초음파 진단료</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>보철ㆍ교정료</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>제증명수수료</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>선별급여</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>65세 이상 등 정액</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>정액수가(요양병원)</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>정액수가(완화의료)</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <tr><td>질병군 포괄수가</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td></tr>
          <!-- T-20260719-foot-BILLRECEIPT-NEWFORM-ITEMFIX AC-②: 처치/검사 분해분 제외한 잔여 비급여만 '기타' 행에.
               (前: {{non_covered}} 전액 → 처치·검사 항목 누락. 이제 {{etc_noncov}}=non_covered−처치−검사.) -->
          <tr><td>기타</td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num"></td><td class="rn-num">{{etc_noncov}}</td></tr>
          <tr>
            <td class="rn-lbl" colspan="2" style="font-weight:bold;">합계</td>
            <td class="rn-num" style="font-weight:bold;">① {{copayment}}</td>
            <td class="rn-num" style="font-weight:bold;">② {{insurance_covered}}</td>
            <td class="rn-num" style="font-weight:bold;">③ </td>
            <td class="rn-num" style="font-weight:bold;">④ {{non_covered}}</td>
          </tr>
          <tr>
            <td class="rn-lbl" colspan="2">상한액 초과금 ⑤</td>
            <td class="rn-num" colspan="4" style="text-align:left;"></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="rn-right">
      <table>
        <colgroup><col style="width:56%"><col></colgroup>
        <tbody>
          <tr><th colspan="2">금액산정내용</th></tr>
          <tr><td>⑥ 진료비 총액<br>(①+②+③+④)</td><td class="rn-num" style="font-weight:bold;">{{total_amount}}</td></tr>
          <tr><td>⑦ 공단부담 총액<br>(②+⑤)</td><td class="rn-num">{{insurance_covered}}</td></tr>
          <tr><td>⑧ 환자부담 총액<br>(①-⑤)+③+④</td><td class="rn-num" style="font-weight:bold;">{{patient_amount}}</td></tr>
          <!-- T-20260728-foot-BILLRECEIPT-PAYMETHOD-PAIDFIELD-2FIX 요건2 [회귀 복원, reporter 김주연 총괄]:
               T-20260727-PMW-REFUND200-DOCUNPAID-2BUG(b20c88d2)가 ⑨'이미 납부한 금액'/⑩'납부할 금액'/'납부하지 않은
               금액' 행을 양식에서 **삭제**(분리 표기 제거)한 회귀 → 현장 "양식을 왜 건드려". PREPRINT 의도상태(⑨~⑪ 3행
               + 납부하지않은, ⑩=공란이되 칸 존재)로 최소범위 원복. 값 없으면 공란(footBilling 토큰 세팅). ⑨→⑪ 리넘버 원복.
               T-20260722-foot-BILLRECEIPT-MASTER-FIXES §1 원본: ⑨ 이미 납부한 금액({{already_paid}}) · ⑩ = ⑧−⑨ 전용
               토큰({{due_amount}}) 분리(patient_amount 하드코딩 금지 — "⑧-⑨" 라벨 산술모순=허위영수증 방지). -->
          <tr><td>⑨ 이미 납부한 금액</td><td class="rn-num">{{already_paid}}</td></tr>
          <tr><td>⑩ 납부할 금액<br>(⑧-⑨)</td><td class="rn-num" style="font-weight:bold;">{{due_amount}}</td></tr>
          <!-- ⑪ 납부한 금액 = 결제수단별 배선(카드/현금영수증/현금), 합계={{paid_total}}=⑧ 환자부담총액(완납 표기).
               ⑪은 ⑨의 결제수단 breakdown 표시(비-가산). 선차감분(선수금)은 주 결제수단 셀에 fold(요건1). -->
          <tr><td rowspan="4">⑪ 납부한<br>금액</td><td class="rn-num" style="text-align:left;">카드 <span style="float:right;">{{card_amount}}</span></td></tr>
          <tr><td class="rn-num" style="text-align:left;">현금영수증 <span style="float:right;">{{cashreceipt_amount}}</span></td></tr>
          <tr><td class="rn-num" style="text-align:left;">현금 <span style="float:right;">{{cash_amount}}</span></td></tr>
          <tr><td class="rn-num" style="text-align:left;">합계 <span style="float:right;font-weight:bold;">{{paid_total}}</span></td></tr>
          <tr><td>납부하지 않은 금액<br>(⑩-⑪)</td><td class="rn-num">{{unpaid_amount}}</td></tr>
          <!-- T-20260724-foot-BILLRECEIPT-PREPRINT-PAYMETHOD-MANUAL: 선출력 시 현금/현금영수증 수기체크분 반영.
               현금영수증( ) 체크마크 + 신분확인번호 + 승인번호 = 발급폼 수기입력값(form_submissions.field_data persist). -->
          <tr><td>현금영수증 (&nbsp;{{cashreceipt_mark}}&nbsp;)</td><td></td></tr>
          <tr><td>신분확인번호</td><td class="rn-num" style="text-align:left;">{{cashreceipt_id_number}}</td></tr>
          <tr><td>현금영수증 승인번호</td><td class="rn-num" style="text-align:left;">{{cashreceipt_approval_no}}</td></tr>
          <tr><td colspan="2" style="font-size:6.6pt; color:#555; text-align:left;">* 요양기관 임의활용공간</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- T-20260719-foot-BILLRECEIPT-NEWFORM-ITEMFIX AC-④ (빨간박스 스샷 F0BK4NYLPHN 근거):
       ④-b 사업자등록번호 값칸(前 col2=auto≈40%)이 불필요하게 넓어 13% 고정으로 축소.
       ④-a 상호(요양기관명) 값칸을 넉넉히 확장 + nowrap → 상호명 1줄 출력(줄바꿈 방지). (col4=21% 고정으로 정합, 아래 REFIX-3 ③ 참조)
       ⚠ 3FIX 값(457-23-00938)·위치, REPNAME 대표자/도장 회귀 없이 열 너비만 조정. -->
  <table style="margin-top:2mm;">
    <!-- T-20260730-foot-DOC-LAYOUT-REFIX-3 ③: 상호 값칸 15%→21%(36.9mm), 전화번호 라벨칸 17%→11%(19.3mm). 합계 100% 불변.
         회귀정정: T-20260729-foot-DOC-LAYOUT-FIX ① 가 상호 값칸을 15%로 고정하며 ITEMFIX ④-a(상호 값칸 최대폭+nowrap)를 되돌려, 상호명(오블리브의원 서울오리진점, nowrap ~33mm)이 26.4mm 칸을 +8px 넘쳐 전화번호칸을 침범했다. 전화번호(4자, ~12mm)가 과분한 29.9mm를 쓰고 있어 라벨칸에서 회수. 주석-코드 모순 해소(21% 근거 반영). -->
    <colgroup><col style="width:12%"><col style="width:13%"><col style="width:10%"><col style="width:21%"><col style="width:11%"><col style="width:33%"></colgroup>
    <tbody>
      <tr>
        <td class="rn-lbl">요양기관 종류</td>
        <td colspan="5" style="text-align:left;">[■]의원급ㆍ보건기관 &nbsp; [ ]병원급 &nbsp; [ ]종합병원 &nbsp; [ ]상급종합병원</td>
      </tr>
      <tr>
        <!-- T-20260717-foot-RECEIPT-NEWFORM-3FIX #3: 사업자등록번호 정본 457-23-00938 확정(구번호 잔재 제거 T-20260722-foot-BILLRECEIPT-NEWFORM-STALE-BIZNO-COMMENT-FIX) -->
        <td class="rn-lbl">사업자등록번호</td><td>457-23-00938</td>
        <td class="rn-lbl">상호</td><td style="white-space:nowrap;">{{clinic_name}}</td>
        <td class="rn-lbl">전화번호</td><td>02-6956-3438</td>
      </tr>
      <!-- T-20260715-foot-RECEIPT-REPNAME-SEAL-BODYPORT B2: 계산서·영수증 신양식(기관 발행) 대표자
           (=박영진 canonical) 근방 법인(요양기관) 인감 출력. 진료의 개인직인 무사용(fee docs = 개설자·기관 축).
           세부내역서와 동일 법인 도장으로 정합. -->
      <tr>
        <td class="rn-lbl">사업장 소재지</td><td colspan="3">{{clinic_address}}</td>
        <td class="rn-lbl">대표자</td>
        <td style="text-align:left;">{{receipt_representative}}&nbsp;&nbsp;{{institution_seal_html}}</td>
      </tr>
    </tbody>
  </table>

  <div style="text-align:center; font-size:9pt; margin-top:3mm; letter-spacing:1px;">{{issue_date}}</div>

  <table style="margin-top:1.5mm;">
    <colgroup><col style="width:68%"><col></colgroup>
    <thead>
      <tr><th>항목별 설명</th><th>일반사항 안내</th></tr>
    </thead>
    <!-- T-20260722-foot-BILLRECEIPT-MASTER-FIXES §4: 하단 안내문 공식 전문(별지 제6호서식) verbatim 교체 + 주(註) 행 추가.
         종전 축약본 → 법정 전문(기호 ㆍ※「」☏ 그대로). 전문이 길어 한 장 수용 위해 font 6.2pt→5.7pt·line-height 1.25 미세조정만
         (칸구조·금액 무접촉, §4 레이아웃 가드 준수). -->
    <tbody>
      <tr>
        <td style="vertical-align:top; text-align:left; font-size:5.7pt; line-height:1.25; padding:2px 4px;">
          <div>1. 일부 본인부담: 일반적으로 다음과 같이 본인부담률을 적용하나, 요양기관 지역, 요양기관의 종별, 환자 자격, 「국민건강보험법」제41조의4에 따른 요양급여 여부, 병실종류 등에 따라 달라질 수 있습니다.</div>
          <div style="padding-left:6px;">- 외래 본인부담률: 요양기관 종별에 따라 30% ~ 60%(의료급여는 수급권자 종별 및 의료급여기관 유형 등에 따라 0원 ~ 2500원, 0% ~ 15%) 등</div>
          <div style="padding-left:6px;">- 입원 본인부담률: 20%(의료급여는 수급권자 종별 및 의료급여기관 유형 등에 따라 0% ~ 10%) 등</div>
          <div style="padding-left:6px;">※ 식대: 50%(의료급여는 20%)</div>
          <div style="padding-left:14px;">CTㆍMRIㆍPET: 외래 본인부담률(의료급여는 입원 본인부담률과 동일)</div>
          <div style="padding-left:14px;">「국민건강보험법」 제41조의4에 따른 요양급여(선별급여): 보건복지부장관이 고시한 항목별 본인부담률</div>
          <div style="padding-left:6px;">※ 상급종합병원 입원료: 2인실 50% 3인실 40%, 4인실 30% / 종합병원 입원료: 2인실 40%, 3인실 30%,</div>
          <div style="margin-top:1px;">2. 전액 본인부담: 「국민건강보험법 시행규칙」 별표 6 또는 「의료급여법 시행규칙」 별표 1의2에 따라 적용되는 항목으로 건강보험(의료급여)에서 금액을 정하고 있으나 진료비 전액을 환자 본인이 부담합니다.</div>
          <div style="margin-top:1px;">3. 상한액 초과금: 본인부담액 상한제에 따라 같은 의료기관에서 연간 500만원(2015년부터는 「국민건강보험법 시행령」 별표 3 제2호에 따라 산정한 본인부담상한액의 최고 금액, 환자가 내는 보험료 등에 따라 다를 수 있음) 이상 본인부담금이 발생한 경우 공단이 부담하는 초과분 중 사전 정산하는 금액을 말합니다.</div>
          <div style="padding-left:6px;">※ 전액본인부담 및 「국민건강보험법」제41조의4에 따른 요양급여의 본인부담금 등은 본인부담상한액 산정시 제외합니다</div>
        </td>
        <td style="vertical-align:top; text-align:left; font-size:5.7pt; line-height:1.25; padding:2px 4px;">
          <div>1. 이 계산서ㆍ영수증에 대한 세부내용은 요양기관에 요구하여 제공받을 수 있습니다.</div>
          <div style="margin-top:1px;">2. 「국민건강보험법」 제48조 또는 「의료급여법」 제11조의3에 따라 환자가 전액 부담한 비용과 비급여로 부담한 비용의 타당성 여부를 건강보험심사평가원(☏1644-2000, 홈페이지: www.hira.or.kr)에 확인 요청하실 수 있습니다.</div>
          <div style="margin-top:1px;">3. 계산서ㆍ영수증은 「소득세법」에 따른 의료비 공제신청 또는 「조세특례제한법」에 따른 현금영수증 공제신청(현금영수증 승인번호가 적힌 경우만 해당합니다)에 사용할 수 있습니다. 다만, 지출증빙용으로 발급된 "현금영수증(지출증빙)"은 공제신청에 사용할 수 없습니다. (현금영수증 문의 126 인터넷 홈페이지: http://현금영수증.kr)</div>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="text-align:left; font-size:5.7pt; line-height:1.25; padding:2px 4px;">주(註): 진료항목 중 선택항목은 요양기관의 특성에 따라 추가 또는 생략할 수 있으며, 야간(공휴일)진료 시 진료비가 가산될 수 있습니다.</td>
      </tr>
    </tbody>
  </table>

  <!-- T-20260721-foot-COPAY-PROVISIONAL-RELABEL: 급여항목 본인부담 확정 라벨 「본인부담금」 (총괄 김주연 confirm).
       법정 필수 칸 밖 설명 라인 — 별지 제6호서식 칸 구조·값(⑧ 환자부담=본인+비급여/공단부담=별도) canon 불변, 텍스트 설명만. -->
  <div style="font-size:6.4pt; color:#333; margin-top:1mm; text-align:left;">
    ※ 상기 급여 항목의 환자 부담분은 「본인부담금」으로 표기됩니다.
  </div>

  <div style="text-align:right; font-size:6.4pt; color:#555; margin-top:1mm;">210㎜×297㎜[백상지 80g/㎡]</div>
</div>
`;

// ─── 초진 관리기록지 (T-20260728-foot-DOCFORM-FIRSTVISIT-MGMTRECORD) ───

/**
 * 초진 관리기록지 — 초진(첫 방문) 시 고객 상태·관리 계획을 표준 양식으로 기록·인쇄.
 * 김주연 총괄 요청(풋센터). 9개 섹션 + 하단 서명영역.
 *
 * 체크박스 마크 렌더 규약: `.cbx` = CSS border 로 항상 빈 네모를 그리고, 안에 체크(✔) 문자를 바인딩한다.
 *   - 체크 필드값 '✔' → 네모 안 ✔ 표시 / 미체크(빈값 '') → 빈 네모. (DocumentPrintPanel 체크칩 토글)
 *   - bindHtmlTemplate 이 미설정 키를 '' 로 치환 → 미체크 시 빈 네모 유지(회귀 0·플레이스홀더 노출 0).
 * 자동 채움: {{patient_name}}·{{patient_birthdate}}·{{patient_phone}}·{{visit_date}}·{{issue_date}}·
 *   {{clinic_name}}·{{doctor_name}} (AUTO_BIND_KEYS). 직인 {{institution_seal_html}} = 법인 인감(getStampUrl).
 */
// T-20260729-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P2: 현장 실사용 후 7건 개편 (base=DOCFORM-FIRSTVISIT-MGMTRECORD).
//   ② 제거: 관리 부위(좌/우)·발가락·초진 시 촬영 기록. ③ 제거: 기타 확인 사항·발톱 상태·관리계획.
//   ④ '초기 관리 내용'(체크박스) → '시술 및 처방'(결제 미니창 치료코드 드롭다운 삽입, {{procedure_rx_html}}).
//   ⑤ 상병명(진단코드 드롭다운 삽입, {{diagnosis_codes_html}}) 신규. ⑥ 증상경과(자유텍스트+상용구, {{symptom_progress}}) 신규.
//   ⑦ 담당의사 서명란(성함·직인 / 병원명·법인도장 2열). procedure_rx_html/diagnosis_codes_html = _html 접미사 → raw 렌더.
const FIRST_VISIT_MGMT_RECORD_HTML = `
${COMMON_STYLE}
<style>
  .cbx {
    display: inline-block; width: 13px; height: 13px;
    border: 1px solid #000; text-align: center; line-height: 12px;
    font-size: 10pt; vertical-align: middle; margin-right: 3px;
  }
  .cb-item { display: inline-flex; align-items: center; margin-right: 14px; white-space: nowrap; font-size: 9pt; }
  .fvmr-sec-label { background: #f0f0f0; font-weight: bold; text-align: center; width: 26%; vertical-align: middle; }
  .fvmr-area { min-height: 42px; vertical-align: top; }
  .fvmr-sig-head { background: #f0f0f0; font-weight: bold; text-align: center; }
  .fvmr-sig-cell { height: 62px; vertical-align: middle; text-align: center; }
  .fvmr-code-line { display: block; margin: 1px 0; }
</style>
<div class="form-wrap">
  <!-- T-20260730-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P3 item1(AC-1): 상단 제목을 기존 foot 서류(소견서·진단서)
       표준 flex 헤더(중앙정렬 class="title")로 통일 + 제목 아래 영문 부제 제거. -->
  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:2px;">
    <div style="flex:1"></div>
    <div class="title" style="flex:none; padding:0 24px; letter-spacing:8px;">초 진 관 리 기 록 지</div>
    <div style="flex:1;"></div>
  </div>

  <!-- ① 고객 정보 + ② 초진일 -->
  <table style="table-layout:fixed; margin-top:6px;">
    <tbody>
      <tr>
        <td class="fvmr-sec-label" style="width:13%;">성&nbsp;&nbsp;명</td>
        <td style="width:37%;">{{patient_name}}</td>
        <td class="fvmr-sec-label" style="width:13%;">생년월일</td>
        <td style="width:37%;">{{patient_birthdate}}</td>
      </tr>
      <tr>
        <td class="fvmr-sec-label">연 락 처</td>
        <td>{{patient_phone}}</td>
        <td class="fvmr-sec-label">초 진 일</td>
        <td>{{visit_date}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 방문 목적 -->
  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td class="fvmr-sec-label">방문 목적</td>
        <!-- T-20260731-foot-FIRSTVISIT-VISITPURPOSE-SYMPTOMS: 방문목적 = 발건강 설문지
             '발 관련 증상' 목록(FOOT_SYMPTOM_OPTIONS)과 문구·순서 100% 일치. -->
        <td style="text-align:left;">
          <span class="cb-item"><span class="cbx">{{vp_discolor}}</span>발톱 변색 및 변형</span>
          <span class="cb-item"><span class="cbx">{{vp_ingrown}}</span>내성발톱(파고드는 발톱)</span>
          <span class="cb-item"><span class="cbx">{{vp_toepain}}</span>발가락 통증</span>
          <span class="cb-item"><span class="cbx">{{vp_odor}}</span>발냄새</span>
          <span class="cb-item"><span class="cbx">{{vp_dryness}}</span>발건조 및 각질</span>
          <span class="cb-item"><span class="cbx">{{vp_sweat}}</span>발 땀 많음</span>
          <span class="cb-item"><span class="cbx">{{vp_itch}}</span>가려움증</span>
          <span class="cb-item"><span class="cbx">{{vp_brittle}}</span>발톱 끝 부서짐</span>
          <span class="cb-item"><span class="cbx">{{vp_bumpy}}</span>울퉁불퉁한 발톱</span>
          <span class="cb-item"><span class="cbx">{{vp_other}}</span>기타: {{vp_other_text}}</span>
        </td>
      </tr>
    </tbody>
  </table>

  <!-- 증상 발생 경위 -->
  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td class="fvmr-sec-label">증상 발생 경위<br><span style="font-weight:normal; font-size:7.5pt;">(고객 진술)</span></td>
        <td class="fvmr-area">{{symptom_history}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 증상경과 (자유텍스트 + 상용구) -->
  <!-- T-20260730-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P3 item5(AC-5): 증상경과 인쇄 박스도 약 3배 확대(42px→130px). -->
  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td class="fvmr-sec-label">증상경과</td>
        <td class="fvmr-area" style="height:130px; vertical-align:top;">{{symptom_progress}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 초진 시 상태 확인 (축소: 피부 상태 · 통증 여부 · 보행 불편) -->
  <table style="margin-top:4px; table-layout:fixed;">
    <tbody>
      <tr>
        <td class="fvmr-sec-label" style="width:13%;">피부 상태</td>
        <td colspan="3" class="fvmr-area" style="min-height:32px;">{{skin_status}}</td>
      </tr>
      <tr>
        <td class="fvmr-sec-label" style="width:13%;">통증 여부</td>
        <td style="text-align:left; width:37%;">
          <span class="cb-item"><span class="cbx">{{pain_yes}}</span>있음</span>
          <span class="cb-item"><span class="cbx">{{pain_no}}</span>없음</span>
        </td>
        <td class="fvmr-sec-label" style="width:13%;">보행 불편</td>
        <td style="text-align:left; width:37%;">
          <span class="cb-item"><span class="cbx">{{gait_yes}}</span>있음</span>
          <span class="cb-item"><span class="cbx">{{gait_no}}</span>없음</span>
        </td>
      </tr>
    </tbody>
  </table>

  <!-- 시술 및 처방 (item 4 — 결제 미니창 치료코드 드롭다운 삽입) -->
  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td class="fvmr-sec-label" style="width:26%;">시술 및 처방</td>
        <td class="fvmr-area" style="text-align:left;">{{procedure_rx_html}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 상병명 (item 5 — 진단코드 드롭다운 삽입) -->
  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td class="fvmr-sec-label" style="width:26%;">상병명</td>
        <td class="fvmr-area" style="text-align:left;">{{diagnosis_codes_html}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 특이사항 -->
  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td class="fvmr-sec-label" style="width:26%;">특이사항</td>
        <td class="fvmr-area">{{remarks}}</td>
      </tr>
    </tbody>
  </table>

  <!-- 발급일 -->
  <table style="margin-top:10px; table-layout:fixed;">
    <tbody>
      <tr>
        <td class="fvmr-sec-label" style="width:26%;">발 급 일</td>
        <td>{{issue_date}}</td>
      </tr>
    </tbody>
  </table>

  <!-- item 7: 담당의사 서명란 (성함·직인 / 병원명·법인도장 2열) -->
  <table style="margin-top:8px; table-layout:fixed;">
    <tbody>
      <tr>
        <td class="fvmr-sig-head" style="width:50%;">담당의사 (성함 / 직인)</td>
        <td class="fvmr-sig-head" style="width:50%;">병원명 (법인도장)</td>
      </tr>
      <tr>
        <td class="fvmr-sig-cell">
          {{doctor_name}}
          <span style="display:inline-block; margin-left:8px; vertical-align:middle;">{{doctor_seal_html}}</span>
        </td>
        <td class="fvmr-sig-cell">
          {{clinic_name}}
          <span style="display:inline-block; margin-left:8px; vertical-align:middle;">{{institution_seal_html}}</span>
        </td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ─── 외국인 비급여 진료 동의서 (국·영문 병기) ───
// T-20260808-foot-FOREIGNER-NONCOVERED-CONSENT-FORM
//   한국 건강보험 미적용 외국인 환자 대상 전액 비급여 진료 안내 동의서.
//   기존 비급여 동의서(서류 발행 화면)와 동일 방식(HTML 템플릿 + form_templates seed) — 순수 ADDITIVE.
//   자동바인딩: 날짜={{issue_date}}(오늘), 성명={{patient_name}}(대상 환자). 서명=수기(빈칸, 인쇄 후 손서명).
//   현장 확정 5개 조항(bilingual 제목 verbatim + 국문 본문 verbatim + 외국인 대상 영문 병기).
const FOREIGNER_NONCOVERED_CONSENT_HTML = `
${COMMON_STYLE}
<style>
  .fnc-clause { border: 1px solid #000; margin-top: 4px; padding: 6px 9px; }
  .fnc-clause-head { font-size: 10pt; font-weight: bold; margin-bottom: 3px; }
  .fnc-ko { font-size: 9.5pt; line-height: 1.5; }
  .fnc-en { font-size: 8.5pt; line-height: 1.45; color: #333; margin-top: 2px; }
  .fnc-ko li, .fnc-en li { margin-left: 16px; }
  .fnc-sign-tbl { margin-top: 14px; table-layout: fixed; }
  .fnc-sign-tbl td { height: 30px; }
  .fnc-sign-label { background: #f0f0f0; font-weight: bold; text-align: center; width: 22%; }
  .fnc-sig-cell { width: 28%; }
</style>
<div class="form-wrap">
  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1px;">
    <div style="flex:1"></div>
    <div class="title" style="flex:none; padding:0 20px; letter-spacing:4px;">외국인 비급여 진료 동의서</div>
    <div style="flex:1;"></div>
  </div>
  <div class="subtitle" style="font-size:10pt; margin-bottom:6px;">Agreement on Non-Covered Medical Treatment &amp; Fees</div>

  <div class="fnc-clause">
    <div class="fnc-clause-head">1. 비급여 진료 안내 / Non-Covered Medical Care</div>
    <div class="fnc-ko">한국 건강보험이 적용되지 않는 외국인 환자는 전액 비급여 진료가 적용됨을 안내드립니다.</div>
    <div class="fnc-en">As a foreign patient not covered by Korean National Health Insurance, all medical treatment is provided on a fully non-covered (out-of-pocket) basis.</div>
  </div>

  <div class="fnc-clause">
    <div class="fnc-clause-head">2. 진료 및 서비스 비용 / Medical &amp; Service Fees</div>
    <div class="fnc-ko">본치료비 및 장치·재료비 외에 의사 진찰료 및 관리사 서비스 비용이 별도로 부과됨에 동의합니다.</div>
    <div class="fnc-en">I agree that, in addition to the treatment fee and device/material costs, a separate physician consultation fee and practitioner service fee will be charged.</div>
  </div>

  <div class="fnc-clause">
    <div class="fnc-clause-head">3. 포도로게(교정기) 관련 안내 / Podology (Orthotic Device) Terms</div>
    <ul class="fnc-ko">
      <li>장치 장착 후 출국 시, 사후 관리(재조정·추가 시술)가 제한될 수 있습니다.</li>
      <li>귀국 후 추가 처치가 필요한 경우 그 비용은 환자 본인이 부담합니다.</li>
      <li>교정 결과는 개인의 발 상태에 따라 차이가 있을 수 있습니다.</li>
    </ul>
    <ul class="fnc-en">
      <li>If you leave Korea after the device is fitted, follow-up care (readjustment / additional procedures) may be limited.</li>
      <li>Any additional treatment required after returning to your home country shall be borne by the patient.</li>
      <li>Correction results may vary depending on each individual's foot condition.</li>
    </ul>
  </div>

  <div class="fnc-clause">
    <div class="fnc-clause-head">4. 원내 정책 및 책임 범위 / Clinic Policy &amp; Scope of Responsibility</div>
    <div class="fnc-ko">본원은 의료 서비스만을 제공하며, 비의료적 개인 요청(택시 호출, 출입국 관련 서명 등)에는 응할 의무가 없습니다.</div>
    <div class="fnc-en">The clinic provides medical services only and is under no obligation to fulfill non-medical personal requests (e.g., calling a taxi, signing immigration-related documents).</div>
  </div>

  <div class="fnc-clause">
    <div class="fnc-clause-head">5. 수납 및 환불 정책 / Payment &amp; Refund Policy</div>
    <div class="fnc-ko">상담 및 시술 후 발생한 진료비의 납부에 동의하며, 이미 완료된 서비스에 대해서는 환불이 불가함을 확인합니다.</div>
    <div class="fnc-en">I agree to pay the fees incurred after consultation and treatment, and I acknowledge that services already rendered are non-refundable.</div>
  </div>

  <div class="confirm-text" style="margin-top:8px; font-size:10pt;">
    본인은 위 내용을 충분히 이해하였으며 이에 동의합니다.<br>
    <span style="font-weight:normal; font-size:8.5pt;">I have fully read and understood the above and hereby agree to its terms.</span>
  </div>

  <table class="fnc-sign-tbl">
    <tbody>
      <tr>
        <td class="fnc-sign-label">날짜 / Date</td>
        <td>{{issue_date}}</td>
        <td class="fnc-sign-label">성명 / Name</td>
        <td>{{patient_name}}</td>
      </tr>
      <tr>
        <td class="fnc-sign-label">서명 / Signature</td>
        <td class="fnc-sig-cell"></td>
        <td class="fnc-sign-label">기관 / Clinic</td>
        <td>{{clinic_name}}</td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ─── 개인정보 수집·이용 등 동의서 (셀프접수 필수 동의 종이 백업용) ───
// T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM (scope: uem5-fold → 셀프접수 필수 동의 전건 백업)
//   셀프접수(foot-checkin) 오류로 라이브 동의 미수집 시 종이 백업용 동의서.
//   기존 동의서(외국인 비급여)와 동일 방식(HTML 템플릿 + form_templates seed) — 순수 ADDITIVE.
//   ★문안은 dev 창작 아님: 셀프접수 라이브 동의문(foot-checkin SelfCheckIn.tsx)을 authoritative
//     source 로 verbatim 서식화. 안전망 목적상 셀프접수 실패 시 필수 동의 전건을 종이로 확보해야
//     하므로 단건(#2)이 아니라 필수 3종 + 선택 1종 = 4개 블록 전체를 수록(uem5 scope 확장).
//     [1] 개인정보 수집·이용 (필수) — privacyConsentLabel / privacyConsentNote
//     [2] 민감정보(건강·진료정보) 수집·이용 (필수, 개보법 §23) — consentSensitiveLabel / consentSensitiveItems
//     [3] 건강보험 자격조회 (필수) — insuranceConsentLabel / insuranceConsentNote
//     [4] 예약 안내 문자(SMS) 수신 (선택) — smsOptIn / smsOptInNote
//   자동바인딩: 날짜={{issue_date}}(오늘), 성명={{patient_name}}(대상 환자). 서명=수기(빈칸, 인쇄 후 손서명).
//   A4 1페이지 기준 컴팩트 레이아웃(9~10pt) — 4블록이 A4 초과 시 form_templates 렌더가 자동 흐름.
//   최종 문안·레이아웃은 AC-5 A4 preview → 현장(김주연 총괄) confirm 게이트에서 확정.
const PRIVACY_CONSENT_FORM_HTML = `
${COMMON_STYLE}
<style>
  /* T-20260808 AC-7: 블록/줄 간격 확대 — 과밀(다닥다닥) 해소, 가독성 우선 */
  .pcf-block { margin-top: 18px; }
  .pcf-block-head { font-size: 10pt; font-weight: bold; margin-bottom: 6px; }
  .pcf-note { border: 1px solid #000; }
  .pcf-note td { padding: 8px 11px; font-size: 9.3pt; vertical-align: top; line-height: 1.65; }
  .pcf-note .pcf-label { background: #f0f0f0; font-weight: bold; text-align: center; width: 20%; white-space: nowrap; }
  .pcf-consent-line { border: 1px solid #000; border-top: none; padding: 9px 12px; font-size: 9.8pt; font-weight: bold; line-height: 1.5; }
  .pcf-consent-choice { font-weight: normal; margin-left: 14px; }
  .pcf-sms-note { border: 1px solid #000; border-top: none; padding: 9px 12px; font-size: 8.7pt; color: #333; line-height: 1.5; }
  .pcf-sms-choice { font-weight: normal; margin-left: 14px; }
  .pcf-sign-tbl { margin-top: 22px; table-layout: fixed; }
  .pcf-sign-tbl td { height: 40px; }
  .pcf-sign-label { background: #f0f0f0; font-weight: bold; text-align: center; width: 22%; }
  .pcf-sig-cell { width: 28%; }
</style>
<div class="form-wrap">
  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1px;">
    <div style="flex:1"></div>
    <div class="title" style="flex:none; padding:0 20px; letter-spacing:4px;">개인정보 수집·이용 동의서</div>
    <div style="flex:1;"></div>
  </div>
  <div class="subtitle" style="font-size:9.5pt; margin-bottom:2px;">Consent to Collection &amp; Use of Personal Information</div>
  <div class="subtitle" style="font-size:8.7pt; color:#444; margin-bottom:12px;">※ 셀프접수(태블릿) 오류 시 종이 백업용 — 아래 필수 동의(4종) 및 선택 동의(1종)를 확인 후 서명해 주세요.</div>

  <!-- [1] 개인정보 수집·이용 동의 (필수) — SelfCheckIn.tsx privacyConsentLabel / privacyConsentNote -->
  <div class="pcf-block">
    <div class="pcf-block-head">1. 개인정보 수집·이용 동의 (필수)</div>
    <table class="pcf-note">
      <tbody>
        <tr><td class="pcf-label">수집항목</td><td>성함, 주민등록번호, 연락처, 주소 등 기본 정보</td></tr>
        <tr><td class="pcf-label">수집목적</td><td>진료를 위한 정보 수집</td></tr>
        <tr><td class="pcf-label">보유기간</td><td>관련 법령에 따른 보관 기간 동안 보유</td></tr>
      </tbody>
    </table>
    <div class="pcf-consent-line">□ 개인정보 수집·이용에 동의합니다 (필수)</div>
  </div>

  <!-- [2] 고유식별정보 수집·이용 동의 (별도 필수, 개보법 §24) — T-20260809-CONSENT-...-ADD-LAYOUT ConsentFormDialog UNIQUE_ID 문안 verbatim 재사용 (dev 창작 아님) -->
  <div class="pcf-block">
    <div class="pcf-block-head">2. 고유식별정보 수집·이용 동의 (별도 필수, 개인정보보호법 §24)</div>
    <table class="pcf-note">
      <tbody>
        <tr><td class="pcf-label">수집항목</td><td>주민등록번호, 외국인등록번호, 여권번호</td></tr>
        <tr><td class="pcf-label">이용목적</td><td>의료법 및 국민건강보험법에 따른 본인확인, 진료기록 작성, 건강보험 자격확인</td></tr>
        <tr><td class="pcf-label">보유기간</td><td>의료법에 따른 진료기록 보존기간 (10년)</td></tr>
      </tbody>
    </table>
    <div class="pcf-consent-line">고유식별정보 수집·이용에 동의합니다 (별도 필수)<span class="pcf-consent-choice">□ 동의함    □ 동의하지 않음</span></div>
  </div>

  <!-- [3] 민감정보(건강·진료정보) 수집·이용 동의 (필수, 개보법 §23) — consentSensitiveLabel / consentSensitiveItems -->
  <div class="pcf-block">
    <div class="pcf-block-head">3. 민감정보(건강·진료정보) 수집·이용 동의 (필수, 개인정보보호법 §23)</div>
    <table class="pcf-note">
      <tbody>
        <tr><td class="pcf-label">수집항목</td><td>건강정보, 진료기록, 상병명, 처방내역 등 민감 의료정보</td></tr>
        <tr><td class="pcf-label">수집목적</td><td>발건강 케어 및 시술 서비스 제공, 진료 이력 관리</td></tr>
        <tr><td class="pcf-label">보유기간</td><td>관련 법령에 따른 보관 기간 동안 보유</td></tr>
      </tbody>
    </table>
    <div class="pcf-consent-line">□ 민감정보(건강·진료정보) 수집·이용에 동의합니다 (필수)</div>
  </div>

  <!-- [4] 건강보험 자격조회 동의 (필수) — insuranceConsentLabel / insuranceConsentNote -->
  <div class="pcf-block">
    <div class="pcf-block-head">4. 건강보험 자격조회 동의 (필수)</div>
    <table class="pcf-note">
      <tbody>
        <tr><td class="pcf-label">수집항목</td><td>성함, 주민등록번호, 건강보험 자격정보</td></tr>
        <tr><td class="pcf-label">수집목적</td><td>진료비 산정 및 청구, 보험 급여 적정성 확인</td></tr>
        <tr><td class="pcf-label">보유기간</td><td>관련 법령에 따른 보관 기간 동안 보유</td></tr>
      </tbody>
    </table>
    <div class="pcf-consent-line">□ 건강보험 자격조회에 동의합니다 (필수)</div>
  </div>

  <!-- [5] 예약 안내 문자(SMS) 수신 동의 (선택) — smsOptIn / smsOptInNote -->
  <div class="pcf-block">
    <div class="pcf-block-head">5. 예약 안내 문자(SMS) 수신 동의 (선택)</div>
    <div class="pcf-consent-line">예약 안내 문자 수신에 동의합니다 (선택)<span class="pcf-sms-choice">□ 동의    □ 미동의</span></div>
    <div class="pcf-sms-note">미동의 시 예약 안내 문자, 홈케어 방법 등 자동 발송 대상에서 제외될 수 있습니다.</div>
  </div>

  <div class="confirm-text" style="margin-top:10px; font-size:10pt;">
    본인은 위 각 항목의 수집·이용 목적 및 항목·보유기간을 충분히 이해하였으며, 각 동의 항목에 대하여 위와 같이 동의합니다.
  </div>

  <table class="pcf-sign-tbl">
    <tbody>
      <tr>
        <td class="pcf-sign-label">날짜</td>
        <td>{{issue_date}}</td>
        <td class="pcf-sign-label">성명</td>
        <td>{{patient_name}}</td>
      </tr>
      <tr>
        <td class="pcf-sign-label">서명</td>
        <td class="pcf-sig-cell"></td>
        <td class="pcf-sign-label">기관</td>
        <td>{{clinic_name}}</td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ─── 템플릿 맵 ───

const HTML_TEMPLATE_MAP: Record<string, string> = {
  koh_result: KOH_RESULT_HTML,
  diagnosis: DIAGNOSIS_HTML,
  treat_confirm: TREAT_CONFIRM_HTML,  // 레거시 단일(기존 발행문서 재출력 보존)
  // T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT: 진료확인서 2 발급폼 분리
  treat_confirm_code: TREAT_CONFIRM_CODE_HTML,      // 코드·진단명 포함(상병 테이블 렌더)
  treat_confirm_nocode: TREAT_CONFIRM_NOCODE_HTML,  // 코드·진단명 불포함(상병 미렌더)
  visit_confirm: VISIT_CONFIRM_HTML,
  diag_opinion: DIAG_OPINION_HTML,
  bill_detail: BILL_DETAIL_HTML,
  // T-20260514-foot-DOC-4FORM-IMPL: 4종 신규
  payment_cert: PAYMENT_CERT_HTML,
  referral_letter: REFERRAL_LETTER_HTML,
  medical_record_request: MEDICAL_RECORD_REQUEST_HTML,
  diag_opinion_v2: DIAG_OPINION_V2_HTML,
  // T-20260515-foot-FORM-ONELINE-RX: 처방전 HTML/CSS 전환
  rx_standard: RX_STANDARD_HTML,
  // T-20260517-foot-FORM-SCREENSHOT-FIX: 진료비 계산서·영수증 HTML 신규
  bill_receipt: BILL_RECEIPT_HTML,
  // T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN: 진료비 계산서·영수증 신양식(별지 제6호서식, 총괄 시안 F0BHY545XTJ).
  //   기존 bill_receipt 무접촉 격리(AC5) — 신규 form_key 전용.
  bill_receipt_new: BILL_RECEIPT_NEW_HTML,
  // T-20260522-foot-INS-DOC-PRINT: 보험청구서
  ins_claim_form: INS_CLAIM_FORM_HTML,
  // T-20260728-foot-DOCFORM-FIRSTVISIT-MGMTRECORD: 초진 관리기록지 (9섹션 + 서명영역)
  first_visit_mgmt_record: FIRST_VISIT_MGMT_RECORD_HTML,
  // T-20260808-foot-FOREIGNER-NONCOVERED-CONSENT-FORM: 외국인 비급여 진료 동의서 (국·영문 병기, 5조항)
  foreigner_noncovered_consent: FOREIGNER_NONCOVERED_CONSENT_HTML,
  // T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM: 개인정보 수집·이용 동의서 (셀프접수 오류 종이 백업용)
  privacy_consent_form: PRIVACY_CONSENT_FORM_HTML,
};

/**
 * form_key에 해당하는 HTML 템플릿 문자열 반환.
 * 없으면 null (PNG 폴백 렌더러로 분기).
 */
export function getHtmlTemplate(formKey: string): string | null {
  return HTML_TEMPLATE_MAP[formKey] ?? null;
}

/**
 * T-20260625-foot-OPINIONDOC-PHRASE-LITERAL-ESCAPE (AC-2, 필수):
 * 양식 바인딩 직전 phrase/필드 텍스트 정규화 — 이중인코딩·리터럴 개행 재발 방지.
 *
 * 두 가지 유입을 render 시점에 무해화한다(데이터 정정 AC-1과 별개로 모든 surface 방어):
 *  1) 리터럴 `\n`(백슬래시+n 2글자) / `\r\n` / `\t` → 실제 제어문자. 이후 escape 단계의
 *     `/\n/g → <br>`가 매칭되어 줄바꿈이 렌더된다. (regex가 실제 0x0A만 매칭하던 한계 보완)
 *  2) 이미 HTML 엔티티가 박힌 텍스트(`&lt;` 등)를 raw로 디코드한 뒤 escape 단계가 단일
 *     인코딩하도록 함. 디코드 없이 escape하면 `&`→`&amp;`로 `&lt;`가 `&amp;lt;`가 되어
 *     브라우저에 `&lt;`가 그대로 보이는 이중인코딩 발생.
 *
 * 디코드 순서: lt/gt/quot/#39 먼저, `&amp;` 마지막 — escape의 정확한 역순이라 멱등.
 * 예) plain `&lt;`(엔티티) → `<` → escape → `&lt;`(브라우저에 `<` 표시)
 *     plain `R&D` → 변화없음 → escape → `R&amp;D`(브라우저에 `R&D` 표시)
 */
export function normalizePhraseText(raw: string): string {
  return raw
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * HTML 템플릿의 `{{key}}` 플레이스홀더를 fieldValues로 치환.
 * 값이 없는 키는 빈 문자열로 치환.
 * HTML injection 방지: 신뢰된 내부 데이터만 주입.
 */
// LOGIC-LOCK L-006: bindHtmlTemplate — 전 경로 양식 바인딩 단일 함수. 복제·우회 금지
export function bindHtmlTemplate(
  html: string,
  fieldValues: Record<string, string>,
): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = fieldValues[key] ?? '';
    // _html 접미사 키(items_html, rx_items_html 등)는 내부 생성 HTML → 이스케이프 생략
    // T-20260520-foot-PRINT-FORM-BIND: items_html/rx_items_html raw 렌더링 버그 수정
    if (key.endsWith('_html')) return val;
    // T-20260625 AC-2: escape 전 정규화 (리터럴 개행→실제 개행, 엔티티 디코드→단일 인코딩)
    // 그 외 필드: 기본 HTML 이스케이프 (XSS 방지)
    return normalizePhraseText(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  });
}

/**
 * bill_detail용 서비스 항목 HTML 행 생성.
 * `items_html` 변수에 주입할 `<tr>...</tr>` 뭉치 반환.
 */
export function buildBillDetailItemsHtml(
  items: Array<{
    category?: string;
    date?: string;
    code?: string;
    name: string;
    amount: number;
    count?: number;
    days?: number;
    is_insurance_covered?: boolean;
    /** T-20260524-foot-INS-DOC-COPAY-LINK: 일부본인부담 > 본인부담금 열 표시용 */
    copayment_amount?: number;
  }>,
): string {
  if (items.length === 0) {
    return `<tr>
      <td colspan="12" style="text-align:center; color:#888; padding:8px;">진료 항목 없음</td>
    </tr>`;
  }

  return items
    .map((item) => {
      const amt = item.amount.toLocaleString('ko-KR');
      const count = item.count ?? 1;
      const days = item.days ?? 1;
      const total = item.amount * count * days;
      const totalStr = total.toLocaleString('ko-KR');
      const nonCoveredStr = !item.is_insurance_covered ? totalStr : '0';
      // 급여 항목: 일부본인부담(본인부담금/공단부담금) 채움
      const copayStr =
        item.is_insurance_covered && item.copayment_amount != null
          ? item.copayment_amount.toLocaleString('ko-KR')
          : '0';
      const fundStr =
        item.is_insurance_covered && item.copayment_amount != null
          ? Math.max(0, total - item.copayment_amount).toLocaleString('ko-KR')
          : '0';
      return `<tr>
        <td>${item.category ?? '기타'}</td>
        <td style="font-size:7.5pt; white-space:nowrap;">${item.date ?? ''}</td>
        <td style="font-size:7.5pt; white-space:nowrap;">${item.code ?? ''}</td>
        <td style="text-align:left;">${item.name}</td>
        <td class="num-cell">${amt}</td>
        <td class="num-cell">${count}</td>
        <td class="num-cell">${days}</td>
        <td class="num-cell">${totalStr}</td>
        <td class="num-cell">${copayStr}</td>
        <td class="num-cell">${fundStr}</td>
        <td class="num-cell">0</td>
        <td class="num-cell">${nonCoveredStr}</td>
      </tr>`;
    })
    .join('\n');
}

/**
 * T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC: 세부산정내역(bill_detail) 야간·공휴일 가산 행.
 * buildBillDetailItemsHtml 과 **동일 12컬럼 포맷**의 급여 항목 <tr> 1행을 반환(items_html 뒤 append).
 * 가산 = 진찰료 급여 base × 30%. copay/covered 는 진찰료 본인부담률 승계값(computeSurcharge 분할).
 * date=진료기간, code=가산 코드(야간=010/공휴일=050 canon), 명칭="야간/공휴일 진료 가산 (30%)".
 */
export function buildSurchargeDetailRowHtml(args: {
  kind: 'night' | 'holiday';
  amount: number;
  copay: number;
  covered: number;
  date?: string;
}): string {
  const { kind, amount, copay, covered, date } = args;
  if (amount <= 0) return '';
  const label = kind === 'holiday' ? '공휴일' : '야간';
  const code = kind === 'holiday' ? '050' : '010';
  const amtStr = amount.toLocaleString('ko-KR');
  return `<tr>
        <td>진찰료</td>
        <td style="font-size:7.5pt; white-space:nowrap;">${date ?? ''}</td>
        <td style="font-size:7.5pt; white-space:nowrap;">${code}</td>
        <td style="text-align:left;">${label} 진료 가산 (30%)</td>
        <td class="num-cell">${amtStr}</td>
        <td class="num-cell">1</td>
        <td class="num-cell">1</td>
        <td class="num-cell">${amtStr}</td>
        <td class="num-cell">${copay.toLocaleString('ko-KR')}</td>
        <td class="num-cell">${covered.toLocaleString('ko-KR')}</td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
      </tr>`;
}

/**
 * 진료비 계산서·영수증(bill_receipt) 급여/비급여 **항목별** 그리드 rows 생성.
 *
 * T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT (diagnose-first forward-fix):
 *   기존 BILL_RECEIPT_HTML 은 정적 그리드였다 — 전 금액이 '처치 및 수술료' 한 행 비급여 열에
 *   뭉뚱그려지고(a: 항목 미구분 / c: 비급여 한덩어리), 공단/본인 컬럼은 per-category 로 채워지지
 *   않고 소계행 집계만 표기됐다(b: 공단/본인 미분리). RC = 렌더 경로는 이미 SSOT(computeFootBilling
 *   + buildFootBillDetailItems)를 산출하나 템플릿이 per-item 을 소비하지 못하는 구조.
 *
 *   해소: **세부산정내역과 동일 SSOT** 인 buildFootBillDetailItems 출력을 그대로 받아 HIRA
 *   항목분류(footBillDetailCategory 결과 category 열)로 집계 → 계산서 표준 행에 배치한다.
 *   신규 산출로직·병렬 프린트경로 신설 없음(AC-5, SPLIT-RECUR AC-5 계승).
 *
 *   행 값:
 *     - 급여 항목: 공단부담 = 항목총액 − copayment_amount, 본인부담 = copayment_amount.
 *       (insurance_grade=null 방문은 copayment_amount=0 → 공단=전액/본인=0. AC-6 정상 —
 *        세부산정내역과 동일 표기. 실 % split 은 등급 데이터 필요 = 직교 grade-capture 축.)
 *     - 비급여 항목: 비급여 열.
 *   Σ(행 공단) / Σ(행 비급여) / Σ(행 합계) = 소계행 {{insurance_covered}} / {{non_covered}} /
 *   {{total_amount}} 와 구조적으로 정합(동일 항목 소스).
 */
export function buildBillReceiptFeeGridHtml(
  billItems: Array<{
    category?: string;
    amount: number;
    count?: number;
    days?: number;
    is_insurance_covered?: boolean;
    copayment_amount?: number;
  }>,
): string {
  // footBillDetailCategory 출력(진찰료/검사료/처치및수술료/이학요법료/기타) → 계산서 표준 행 매핑.
  const CATEGORY_TO_ROW: Record<string, string> = {
    진찰료: '진찰료',
    검사료: '검사료',
    처치및수술료: '처치 및 수술료',
    '처치 및 수술료': '처치 및 수술료',
    이학요법료: '재활 및 물리치료료',
    '재활 및 물리치료료': '재활 및 물리치료료',
  };
  // 공식 서식 표준 행 순서 — 값 유무와 무관하게 전부 렌더(빈 행은 공란, 기존 서식 외형 보존).
  const ROW_ORDER = [
    '진찰료', '입원료', '식대', '투약 및 조제료', '주사료',
    '처치 및 수술료', '검사료', '영상진단 및 방사선치료료',
    '재활 및 물리치료료', '정신요법료', '치과행위', '한방행위',
  ];
  type Agg = { covered: number; copay: number; nonCovered: number };
  const acc = new Map<string, Agg>();
  const bump = (row: string, fn: (a: Agg) => void) => {
    let a = acc.get(row);
    if (!a) { a = { covered: 0, copay: 0, nonCovered: 0 }; acc.set(row, a); }
    fn(a);
  };
  for (const it of billItems) {
    const total = it.amount * (it.count ?? 1) * (it.days ?? 1);
    if (total <= 0) continue;
    const row = CATEGORY_TO_ROW[it.category ?? ''] ?? '기타';
    if (it.is_insurance_covered) {
      const copay = it.copayment_amount ?? 0;
      bump(row, (a) => { a.covered += total; a.copay += copay; });
    } else {
      bump(row, (a) => { a.nonCovered += total; });
    }
  }
  const won = (n: number) => n.toLocaleString('ko-KR');
  const cells = (a: Agg | undefined) => {
    if (!a || a.covered + a.nonCovered <= 0) {
      return '<td class="br-num"></td><td class="br-num"></td><td class="br-num"></td><td class="br-num"></td>';
    }
    // 급여 행: 공단/본인 항상 표기(copay 0 이어도 '0' 명시). 비급여 열은 값 있을 때만.
    const gongdan = a.covered > 0 ? won(Math.max(0, a.covered - a.copay)) : '';
    const bonin = a.covered > 0 ? won(a.copay) : '';
    const nonCov = a.nonCovered > 0 ? won(a.nonCovered) : '';
    // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 행별 '합계' = 본인부담(copay) + 비급여(공단 제외).
    //   공단부담 열(gongdan)은 표시 그대로 유지 — 합계에서만 제외. (기존: a.covered + a.nonCovered = 공단 포함 버그)
    const sum = won(a.copay + a.nonCovered);
    return `<td class="br-num">${gongdan}</td><td class="br-num">${bonin}</td><td class="br-num">${nonCov}</td><td class="br-num">${sum}</td>`;
  };
  const rows = ROW_ORDER.map(
    (label) => `<tr><td class="br-label">${label}</td>${cells(acc.get(label))}</tr>`,
  );
  // 표준 행에 매핑 안 되는 '기타'(수액·화장품·제증명 등) — 금액 있을 때만 추가(합계 정합 유지, 손실 0).
  const etc = acc.get('기타');
  if (etc && etc.covered + etc.nonCovered > 0) {
    rows.push(`<tr><td class="br-label">기타</td>${cells(etc)}</tr>`);
  }
  return rows.join('\n');
}

/** HTML 양식 여부 확인 */
export function isHtmlTemplate(formKey: string): boolean {
  return formKey in HTML_TEMPLATE_MAP;
}

/**
 * rx_standard용 처방 의약품 행 HTML 생성.
 * `rx_items_html` 변수에 주입할 `<tr>...</tr>` 뭉치 반환.
 * 최소 10행 보장 (빈 행 포함).
 *
 * @see T-20260515-foot-FORM-ONELINE-RX
 * @see T-20260730-foot-RX-STANDARD-DERM-FORMAT-UNIFY — 피부 A4 실측 정합: 일반행 최소 8→10.
 */
export function buildRxItemsHtml(
  items: Array<{
    name: string;
    // T-20260718-foot-RXPRINT-DRUGCODE-PREFIX: 서비스관리 등록 약 코드(services.service_code).
    //   있으면 약품명 앞에 '코드 | ' prefix 표기, 없으면(NULL/공백) 코드 없이 약품명만(AC3 fallback).
    //   T-20260718-foot-RXPRINT-FORMAT-ADJUST (항목2): 구분자 대괄호 '[코드]' → 파이프 '코드 |'.
    code?: string | null;
    // T-20260809-foot-PAYMINI-RX-QTY-STRUCTURED-LEAF-RECONCILE (AC3): 처방약 수량 canonical 키 = total_qty.
    //   구조화 leaf(form_submissions.field_data.rx_items[])와 동일 키로 통일 → display=persist 동일 SSOT(AC2).
    //   total_qty>1 일 때만 약품명 뒤 ' ×N' 표기. 미전달/1 이면 접미 없음.
    total_qty?: number;
    // T-20260807-foot-PAYMINI-RX-QTY-INPUT-FIELD (deprecated · AC4 하위호환 폴백): 구 bare `qty` 키.
    //   신규 경로는 total_qty 사용. total_qty 미전달 시에만 qty 로 폴백(기존 호출부·구 저장본 무회귀).
    //   ⚠ bare count/quantity 키는 금지(AC3) — canonical=total_qty, legacy fallback=qty 만 허용.
    qty?: number;
    unit_dose?: string;
    daily_freq?: string;
    total_days?: string;
    method?: string;
  }>,
): string {
  // T-20260730-foot-RX-STANDARD-DERM-FORMAT-UNIFY: 피부 A4 실측 정합 — 의약품표 일반행 최소 10행.
  const TOTAL_ROWS = 10;
  const rows = items.map((item) => ({
    // T-20260718-foot-RXPRINT-FORMAT-ADJUST (항목2): 약품명 앞 코드 prefix 구분자 '코드 | 약품명'(파이프).
    //   (구 T-20260718-foot-RXPRINT-DRUGCODE-PREFIX 의 '[코드] 약품명' 대괄호에서 파이프로 변경.)
    //   코드 미등록/미매핑(NULL/공백) 시 파이프 없이 약품명만 출력(AC3 graceful fallback).
    name: (() => {
      const base = (item.code ?? '').trim()
        ? `${(item.code ?? '').trim()} | ${item.name}`
        : item.name;
      // T-20260809-foot-PAYMINI-RX-QTY-STRUCTURED-LEAF-RECONCILE (AC2/AC3/AC4):
      //   canonical=total_qty(구조화 leaf 키) 우선, 미전달 시 legacy qty 폴백(구 호출부·구 저장본 무회귀).
      //   qty>1 시 '바르토벤 ×2' 형태 접미. 처방전 인쇄·처방이력 공통 SSOT.
      const effectiveQty = typeof item.total_qty === 'number' ? item.total_qty : item.qty;
      return typeof effectiveQty === 'number' && effectiveQty > 1 ? `${base} ×${effectiveQty}` : base;
    })(),
    unit_dose: item.unit_dose ?? '',
    daily_freq: item.daily_freq ?? '',
    // T-20260606-foot-DOC-FIELD-MISSING-3 AC-5: 처방 입력의 총투약일수를 출력물에 표기.
    //   8FIX AC-3③("값은 항상 공란")의 목적은 "시술데이터 기반 자동연동" 제거였으나,
    //   RX-DOSAGE-DYNAMIC 입력칸으로 명시 입력된 값까지 무조건 폐기해 현장 "입력해도 미표기" 발생.
    //   → 자동연동은 부활시키지 않되(호출부가 빈값 전달 시 공란 유지=수기 기입), 호출부가 전달한
    //     명시 입력값은 그대로 표기한다.
    total_days: item.total_days ?? '',
    method: item.method ?? '',
  }));
  while (rows.length < TOTAL_ROWS) {
    rows.push({ name: '', unit_dose: '', daily_freq: '', total_days: '', method: '' });
  }
  return rows
    .map(
      (row) => `<tr style="height:24px;">
        <td style="text-align:left; font-size:8.5pt;">${row.name}</td>
        <td style="text-align:center;">${row.unit_dose}</td>
        <td style="text-align:center;">${row.daily_freq}</td>
        <td style="text-align:center;">${row.total_days}</td>
        <td style="text-align:center;">${row.method}</td>
      </tr>`,
    )
    .join('\n');
}
