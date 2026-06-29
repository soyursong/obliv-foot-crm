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
    td[style*="background:#f8f8f8"] { white-space: nowrap; font-size: 8.5pt; }
    /* T-20260629-foot-DOCPRINT-CENTER-ALIGN: 전 양식 인쇄 정렬 통일(표현 레이어만, 구조/데이터/발행로직 불변).
       증상: 출력물이 상단·좌측으로 쏠리고 하단 여백 과다.
       원인: form-wrap 이 인쇄 page(@page margin:0 인 .page 210×297mm) 안에서 margin:0 → 상단 0mm 밀착,
             min-height:267mm 라 하단에 ~30mm 빈 띠. (raw 경로 printOpinionDoc 는 @page 부재로 축소맞춤까지.)
       수정: margin:12mm auto(상·하 12mm·좌우 자동 중앙) + min-height:273mm(=297-24)로 page 를 균형 있게 채움.
             width 는 190mm(<page 210mm) 유지 → 좌우 10mm 대칭 여백(좌측 쏠림 방지). @page 는 인쇄창 래퍼
             (openBatchPrintWindow 등)가 margin:0 으로 소유 → 템플릿에서 선언하지 않는다(중복·landscape 충돌 방지). */
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .form-wrap { width: 190mm; min-height: 273mm; padding: 6mm 8mm; margin: 12mm auto; }
      td[style*="background:#f8f8f8"] { white-space: nowrap; font-size: 8.5pt; }
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
        <td colspan="7">{{clinic_name}}</td>
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
        <td style="background:#f8f8f8; text-align:right; white-space:nowrap;">의 사 성 명</td>
        <td colspan="2">{{doctor_name}}</td>
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
  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:2px;">
    <div style="flex:1"></div>
    <div class="title" style="flex:none; padding:0 20px;">진 료 확 인 서</div>
    <div style="flex:1; display:flex; justify-content:flex-end;">
      <div class="stamp-box">원부대조필<br>인</div>
    </div>
  </div>
  <!-- T-20260601-foot-DOC-PRINT-8FIX AC-5③: 상단 진단 비표시 안내 문구 제거됨 -->

  <table>
    <tbody>
      <tr>
        <td style="width:70px; background:#f8f8f8;">병 록 번 호</td>
        <td style="width:140px;">{{record_no}}</td>
        <!-- T-20260629-foot-DOCPRINT-COLWIDTH-WRAP-AUDIT: 연령을 빈 칸이던 1행으로 이동 → 주소 행을 전폭(colspan=3) 단일 줄 확보 -->
        <td style="width:60px; background:#f8f8f8;">연 령</td>
        <td style="white-space:nowrap;">만&nbsp;<strong>{{patient_age}}</strong>&nbsp;세</td>
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
        <td>{{patient_name}}</td>
        <!-- T-20260609-foot-DOCFORM-3FIX 이슈3: 비활성 항목 라벨이 인쇄물에 leak → 조건부 렌더.
             하드코딩 "☐ 상병 표시/비활성화" 라벨을 placeholder 로 치환. 미바인딩(=비활성) 시 공란.
             셀/colspan 구조는 보존(8FIX 레이아웃·도장 위치 회귀 방지) → 항목/토글 시스템 보존, 활성 시 재출력. -->
        <td style="background:#f8f8f8; font-size:8pt; white-space:nowrap;">{{disease_display_note}}</td>
        <td></td>
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

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td rowspan="2" style="width:50px; background:#f8f8f8; text-align:center; vertical-align:middle; font-size:8.5pt;">치료<br>기간</td>
        <td style="width:50px; background:#f8f8f8; text-align:center;">외래</td>
        <td>{{visit_date}}</td>
        <td style="width:30px; text-align:center;">부터</td>
        <td>{{discharge_date}}</td>
        <td style="width:30px; text-align:center;">까지</td>
        <td style="width:50px; text-align:center;">(치료</td>
        <td style="width:40px; text-align:right;">{{visit_days}}</td>
        <td style="text-align:left;">일간)</td>
      </tr>
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
        <td style="width:80px; background:#f8f8f8; vertical-align:top;">실통원일수<br>일괄입력</td>
        <td style="min-height:36px;">{{visit_date}}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-top:4px;">
    <tbody>
      <!-- T-20260622-foot-VISITCERT-DISEASE-FUTURETX-HIDE: 향후치료(향후 치료의견) 비노출.
           현장 요청(김주연 총괄) — 진료확인서 화면·인쇄 모두 미표시. treatment_opinion 바인딩 불변. 용도 행은 유지. -->
      <tr>
        <td style="background:#f8f8f8; text-align:center;">용&nbsp;&nbsp;도</td>
        <td>{{purpose}}</td>
      </tr>
    </tbody>
  </table>

  <div class="confirm-text" style="margin-top:6px;">
    상기인은 위와 같이 진료중임(진료하였음)을 확인함.
  </div>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td style="width:60px; background:#f8f8f8;">발 행 일</td>
        <td style="width:130px;">{{issue_date}}</td>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt;">주소 및 명칭</td>
        <td>{{clinic_address}}</td>
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
        <td style="background:#f8f8f8; text-align:right; white-space:nowrap;">의 사 성 명</td>
        <td>{{doctor_name}}&nbsp;&nbsp;{{doctor_seal_html}}</td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ─── 통원확인서 ───

const VISIT_CONFIRM_HTML = `
${COMMON_STYLE}
<div class="form-wrap">
  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:2px;">
    <div style="flex:1"></div>
    <div class="title" style="flex:none; padding:0 20px;">통 원 확 인 서</div>
    <div style="flex:1; display:flex; justify-content:flex-end;">
      <div class="stamp-box">원부대조필<br>인</div>
    </div>
  </div>

  <table>
    <tbody>
      <tr>
        <td style="width:70px; background:#f8f8f8;">병 록 번 호</td>
        <td style="width:140px;">{{record_no}}</td>
        <!-- T-20260629-foot-DOCPRINT-COLWIDTH-WRAP-AUDIT: 연령을 빈 칸이던 1행으로 이동 → 주소 행을 전폭(colspan=3) 단일 줄 확보 -->
        <td style="width:60px; background:#f8f8f8;">연 령</td>
        <td style="white-space:nowrap;">만&nbsp;<strong>{{patient_age}}</strong>&nbsp;세</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">연 번 호</td>
        <td>{{visit_no}}</td>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt;">성별</td>
        <!-- T-20260601-foot-DOC-PRINT-8FIX AC-6①: 성별 하드코딩 → 주민번호 산출 바인딩 -->
        <td>{{patient_gender}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">주&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;소</td>
        <td colspan="3">{{patient_address}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">환자 성명</td>
        <td>{{patient_name}}</td>
        <!-- T-20260609-foot-DOCFORM-3FIX 이슈2: 비활성 항목 라벨이 인쇄물에 leak → 조건부 렌더.
             하드코딩 "☐ 상병 표시 비활성화 / ☐ 향후치료의견 미표시" 라벨을 placeholder 로 치환.
             미바인딩(=비활성) 시 공란. colspan=2 셀 구조는 보존(8FIX 레이아웃·도장 위치 회귀 방지)
             → 항목/토글 시스템 보존, 활성 시 재출력. -->
        <td colspan="2" style="font-size:8pt; color:#555;">{{visit_display_note}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">주 민 번 호</td>
        <td colspan="3">{{patient_rrn}}</td>
      </tr>
    </tbody>
  </table>

  <!-- T-20260622-foot-VISITCERT-DISEASE-FUTURETX-HIDE: 상병(병명)·진단분류 비노출.
       현장 요청(김주연 총괄, 2026-06-22) — 통원확인서에서 상병명 항목을 화면·인쇄 모두 미표시.
       병명(상병코드·상병명·특정기호) 테이블 + 진단확신도 분류 표시줄 제거.
       diag 바인딩 컨텍스트·발행/published 트리거 불변 — 템플릿에서 미렌더할 뿐. -->

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
        <td style="width:80px; background:#f8f8f8; vertical-align:top;">실통원일수<br>일괄입력</td>
        <td style="min-height:36px;">{{visit_date}}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-top:4px;">
    <tbody>
      <!-- T-20260622-foot-VISITCERT-DISEASE-FUTURETX-HIDE: 향후치료(향후 치료의견) 비노출.
           현장 요청(김주연 총괄) — 통원확인서 화면·인쇄 모두 미표시. treatment_opinion 바인딩 불변. 용도 행은 유지. -->
      <tr>
        <td style="background:#f8f8f8; text-align:center;">용&nbsp;&nbsp;도</td>
        <td>{{purpose}}</td>
      </tr>
    </tbody>
  </table>

  <div class="confirm-text" style="margin-top:6px;">
    상기인은 위와 같이 통원중임(통원하였음)을 확인함.
  </div>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td style="width:60px; background:#f8f8f8;">발 행 일</td>
        <td style="width:130px;">{{issue_date}}</td>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt;">주소 및 명칭</td>
        <td>{{clinic_address}}</td>
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
        <td style="background:#f8f8f8; text-align:right; white-space:nowrap;">의 사 성 명</td>
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
    <div style="flex:1; display:flex; justify-content:flex-end;">
      <div class="stamp-box">원부대조필<br>인</div>
    </div>
  </div>

  <table>
    <tbody>
      <tr>
        <td style="width:70px; background:#f8f8f8;">환 자 정 보</td>
        <td style="width:140px;">{{record_no}}</td>
        <td style="width:70px; background:#f8f8f8;">주 민 번 호</td>
        <td>{{patient_rrn}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">환자 성명</td>
        <td>{{patient_name}}</td>
        <td style="background:#f8f8f8;">성별</td>
        <td>{{patient_gender}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">생년월일</td>
        <td>{{patient_birthdate}}</td>
        <td style="background:#f8f8f8;">연령</td>
        <td>만&nbsp;<strong>{{patient_age}}</strong>&nbsp;세</td>
      </tr>
      <!-- T-20260629-foot-DOCPRINT-COLWIDTH-WRAP-AUDIT: 주소·연락처를 각각 전폭(colspan=3) 행으로 분리.
           이전: 주소 칸이 한 컬럼(~140px)에 묶여 긴 주소 3줄 줄바꿈. 라벨/값 분리(8FIX AC-2)는 유지. -->
      <tr>
        <td style="background:#f8f8f8;">환자의 주소</td>
        <td colspan="3">{{patient_address}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; white-space:nowrap;">환자 연락처</td>
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

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td style="width:60px; background:#f8f8f8;">발 행 일</td>
        <td colspan="3">{{issue_date}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">의 료 기 관</td>
        <td colspan="3">{{clinic_name}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt;">주소 및 명칭</td>
        <td colspan="3">{{clinic_address}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt;">전화 및 팩스</td>
        <td colspan="3">{{clinic_phone}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">면 허 번 호</td>
        <td>제&nbsp;{{doctor_license_no}}&nbsp;호</td>
        <td style="background:#f8f8f8; text-align:right; white-space:nowrap;">의 사 성 명</td>
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
    text-align: center;
  }
  .bill-wrap .title-main {
    text-align: center;
    font-size: 15pt;
    font-weight: bold;
    padding: 4px 0;
  }
  .bill-wrap .header-note { font-size: 8pt; margin-bottom: 3px; }
  .num-cell { text-align: right; font-variant-numeric: tabular-nums; }
  @media print {
    /* T-20260629-foot-DOCPRINT-CENTER-ALIGN: 가로(A4 landscape) page(.page-landscape 297×210mm) 내
       상·하 12mm + 좌우 자동 중앙 배치로 쏠림/하단 과다여백 보정. @page 는 래퍼(forceLandscape)가 소유 →
       템플릿 미선언(LOGIC: PRINT-FORM-BIND/DOC-PRINT-UNIFY 가드와 정합). */
    .bill-wrap { width: 272mm; min-height: 186mm; padding: 4mm 6mm; margin: 12mm auto; overflow: hidden; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
<div class="bill-wrap">
  <div class="header-note">■ [별지 제1호 서식] 진료비 세부산정내역 서식 (제2호제1항 관련)</div>
  <div class="title-main">진료비 세부산정내역</div>

  <!-- 환자 기본 정보 -->
  <table style="margin-bottom:4px;">
    <thead>
      <tr>
        <!-- T-20260629-foot-DOCPRINT-COLWIDTH-WRAP-AUDIT: 등록번호·진료기간 칸 폭 확대 + 데이터 nowrap → 줄바꿈 제거(가로 양식, 폭 여유) -->
        <th style="width:104px;">환자등록번호</th>
        <th style="width:80px;">환자성명</th>
        <th style="width:150px;">진료기간</th>
        <th style="width:60px;">병실</th>
        <th style="width:70px;">환자구분</th>
        <th>비고</th>
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

  <!-- 항목 테이블 -->
  <table>
    <thead>
      <tr>
        <th rowspan="2" style="width:55px;">항목</th>
        <th rowspan="2" style="width:72px;">일자</th>
        <th rowspan="2" style="width:60px;">코드</th>
        <th rowspan="2">명칭</th>
        <th rowspan="2" style="width:60px;">금액</th>
        <th rowspan="2" style="width:30px;">횟수</th>
        <th rowspan="2" style="width:30px;">일수</th>
        <th rowspan="2" style="width:65px;">총액</th>
        <th colspan="3" style="width:150px;">급여</th>
        <th rowspan="2" style="width:65px;">비급여</th>
      </tr>
      <tr>
        <th colspan="2" style="width:100px;">일부본인부담</th>
        <th style="width:50px;">전액<br>본인부담</th>
      </tr>
      <tr>
        <th></th>
        <th></th>
        <th></th>
        <th></th>
        <th></th>
        <th></th>
        <th></th>
        <th></th>
        <th style="width:50px;">본인부담금</th>
        <th style="width:50px;">공단부담금</th>
        <th></th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {{items_html}}
      <tr>
        <td colspan="7" style="text-align:center; background:#f8f8f8; font-weight:bold;">계</td>
        <td class="num-cell">{{subtotal_amount}}</td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
        <td class="num-cell">{{subtotal_noncovered}}</td>
      </tr>
      <tr>
        <td colspan="7" style="text-align:center; background:#f8f8f8;">끝처리 조정금액</td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
      </tr>
      <tr>
        <td colspan="7" style="text-align:center; background:#f8f8f8; font-weight:bold;">합계</td>
        <td class="num-cell"><strong>{{total_amount}}</strong></td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
        <td class="num-cell"><strong>{{total_noncovered}}</strong></td>
      </tr>
    </tbody>
  </table>

  <div style="margin-top:8px; font-size:9pt; text-align:center;">
    신청인 &nbsp;&nbsp; {{patient_name}} &nbsp;&nbsp; (환자와의 관계 : 본인 &nbsp;&nbsp; )의 요청에 따라
  </div>
  <div style="font-size:9pt; text-align:center; margin-top:4px;">
    진료비 계산서 영수증 세부산정내역을 발급합니다.
  </div>
  <div style="font-size:9pt; text-align:center; margin-top:4px;">{{issue_date}}</div>

  <table style="margin-top:8px;">
    <tbody>
      <tr>
        <td style="width:100px; background:#f8f8f8; text-align:center;">요양기관 명칭</td>
        <td>{{clinic_name}}</td>
        <td style="width:60px; background:#f8f8f8; text-align:center;">대 표 자</td>
        <td style="width:120px;">{{doctor_name}}</td>
        <!-- T-20260601-foot-DOC-PRINT-8FIX AC-1: 대표자 성명 근방 직인 -->
        <td style="width:52px; text-align:center;">{{doctor_seal_html}}</td>
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
<!-- T-20260611-foot-REFERRAL-PRINT-CLIP-CENTER: width 188mm + margin:0 auto 로 A4(210mm) 중앙 배치 + 좌우 11mm 여백 확보(프린터 unprintable edge clipping 제거) --><div class="form-wrap" style="border:1px solid #000; padding:0; width:188mm; max-width:188mm; min-height:273mm; margin:12mm auto;"><!-- T-20260611-foot-REFERRAL-FORM-CENTER-CLIP: 좌우(margin auto)와 동일 논리로 상하 12mm 여백 추가(0→12mm). form-wrap이 page 최상단(top 0mm)에 붙어 프린터 unprintable 상단영역이 제목을 자르던 상단 짤림 제거 + 하단 18mm 클리어런스 확보. 의뢰서 한정 변경. -->
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
    padding: 6mm 8mm;
    width: 190mm;
    min-height: 267mm;
  }
  .rx-wrap table { width: 100%; border-collapse: collapse; }
  .rx-wrap td, .rx-wrap th {
    border: 1px solid #000;
    padding: 2px 4px;
    vertical-align: middle;
    font-size: 8.5pt;
  }
  .rx-wrap th { background: #f0f0f0; font-weight: bold; text-align: center; white-space: nowrap; }
  .rx-title {
    text-align: center;
    font-size: 22pt;
    font-weight: bold;
    letter-spacing: 14px;
    padding: 6px 0 4px;
  }
  /* 라벨 셀 한줄 정렬 */
  .rx-wrap td[style*="background:#f8f8f8"] { white-space: nowrap; font-size: 8.5pt; }
  .rx-wrap td[style*="background:#f0f0f0"] { white-space: nowrap; }
  @media print {
    /* T-20260629-foot-DOCPRINT-CENTER-ALIGN: page 내 상·하 12mm + 좌우 자동 중앙 배치로 통일.
       @page(A4 portrait, margin:0) 는 래퍼가 소유하나 본 처방전 양식은 'A4 portrait' 식별이 필요해 유지. */
    @page { size: A4 portrait; margin: 0; }
    .rx-wrap { width: 190mm; min-height: 273mm; padding: 5mm 8mm; margin: 12mm auto; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .rx-wrap td[style*="background:#f8f8f8"] { white-space: nowrap; font-size: 8.5pt; }
  }
</style>
<div class="rx-wrap">

  <!-- ① 상단 헤더 -->
  <div style="display:flex; align-items:flex-start; gap:8px; margin-bottom:3px;">
    <!-- T-20260612-foot-RX-TOPBAR-PATIENT-HIRA-MISSING AC-2: 상단 좌측 고객정보 바인딩 추가.
         진료의뢰서(REFERRAL_LETTER_HTML) 고객정보 블록과 동일 autobind 키 이식
         (record_no·patient_name·patient_birthdate·patient_rrn·patient_phone·patient_address).
         기존 빈 레거시 라인(조합기호·증번호·보호종별 — 풋센터 비급여 자가부담이라 데이터 소스 없음)을
         실제 고객차트 기본정보로 치환. 미입력 필드는 빈 문자열 렌더 → 라벨만 남고 레이아웃 무붕괴(시나리오2).
         width 고정 + 줄바꿈 허용으로 긴 주소가 외부 flex(제목/QR)를 밀지 않게 함. -->
    <div style="font-size:7.5pt; line-height:1.7; width:160px; max-width:160px; word-break:break-all;">
      환자정보 :&nbsp;{{record_no}}<br>
      성&nbsp;&nbsp;&nbsp;&nbsp;명 :&nbsp;{{patient_name}}<br>
      생년월일 :&nbsp;{{patient_birthdate}}<br>
      주민번호 :&nbsp;{{patient_rrn}}<br>
      연 락 처 :&nbsp;{{patient_phone}}<br>
      주&nbsp;&nbsp;&nbsp;&nbsp;소 :&nbsp;{{patient_address}}
    </div>
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
  <div style="border:1px solid #000; padding:2px 6px; font-size:8pt; display:flex; justify-content:space-between; margin-bottom:-1px;">
    <span>[&bull;]의료보험&nbsp;&nbsp;[&nbsp;]의료보호&nbsp;&nbsp;[&nbsp;]산재보험&nbsp;&nbsp;[&nbsp;]자동차보험&nbsp;&nbsp;[&nbsp;]기타</span>
    <span>요양기관기호&nbsp;:&nbsp;&nbsp;{{clinic_code}}</span>
  </div>

  <!-- ③ 환자 + 의료기관 -->
  <table>
    <tbody>
      <tr>
        <td style="width:80px; background:#f8f8f8; text-align:center;">교부년월일번호</td>
        <td colspan="2">{{issue_date}}&nbsp;&nbsp;제&nbsp;{{issue_no}}&nbsp;호</td>
        <td rowspan="4" style="width:18px; background:#f8f8f8; text-align:center; font-size:7.5pt; padding:2px;">의<br>료<br>기<br>관</td>
        <td style="width:60px; background:#f8f8f8; text-align:center;">명&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;칭</td>
        <td>{{clinic_name}}</td>
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
        <td style="background:#f8f8f8; text-align:center;">주&nbsp;민&nbsp;번&nbsp;호</td>
        <td>{{patient_rrn}}</td>
        <td style="background:#f8f8f8; text-align:center;">팩&nbsp;스&nbsp;번&nbsp;호</td>
        <td>{{clinic_fax}}</td>
      </tr>
      <tr>
        <td></td>
        <td></td>
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
        <td style="width:90px;">{{diag_code_1}}</td>
        <td rowspan="4" style="width:65px; background:#f8f8f8; text-align:center; font-size:8pt;">처&nbsp;방<br>의료인의<br>성&nbsp;&nbsp;&nbsp;&nbsp;명</td>
        <!-- T-20260601-foot-DOC-PRINT-8FIX AC-1: 도장 우하단 고정 제거 → 처방의료인 성명 근방 직인 -->
        <td rowspan="4" style="width:130px;">{{doctor_name}}&nbsp;&nbsp;{{doctor_seal_html}}</td>
        <td style="width:55px; background:#f8f8f8; text-align:center;">면&nbsp;허&nbsp;종&nbsp;별</td>
        <td>의사</td>
      </tr>
      <tr>
        <td>{{diag_code_2}}</td>
        <td style="background:#f8f8f8; text-align:center;">면&nbsp;허&nbsp;번&nbsp;호</td>
        <td>{{doctor_license_no}}</td>
      </tr>
      <tr style="{{diag_row_3_style}}">
        <td>{{diag_code_3}}</td>
        <td colspan="2"></td>
      </tr>
      <tr style="{{diag_row_4_style}}">
        <td>{{diag_code_4}}</td>
        <td colspan="2"></td>
      </tr>
    </tbody>
  </table>

  <!-- ⑤ 처방 의약품 -->
  <table style="margin-top:4px;">
    <thead>
      <tr>
        <th>처&nbsp;방&nbsp;의&nbsp;약&nbsp;품&nbsp;의&nbsp;명&nbsp;칭</th>
        <th style="width:52px;">1회<br>투약량</th>
        <th style="width:52px;">1일투여<br>횟&nbsp;&nbsp;&nbsp;수</th>
        <th style="width:52px;">총투약<br>일&nbsp;&nbsp;&nbsp;수</th>
        <th style="width:110px;">용&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;법</th>
      </tr>
    </thead>
    <tbody>
      {{rx_items_html}}
    </tbody>
  </table>

  <!-- ⑥ 주사제 처방내역 -->
  <table style="border-top:none;">
    <tbody>
      <tr>
        <td colspan="2" style="font-size:8.5pt; width:310px;">
          주사제&nbsp;처방내역&nbsp;&nbsp;(&nbsp;원내조제&nbsp;[&nbsp;&nbsp;&nbsp;]&nbsp;,&nbsp;원외조제&nbsp;[&nbsp;&nbsp;&nbsp;]&nbsp;)
        </td>
        <td rowspan="2" style="background:#f8f8f8; text-align:center; width:70px; font-size:8pt;">조제시<br>참고사항</td>
        <td rowspan="2"></td>
      </tr>
      <tr>
        <td colspan="2" style="height:36px;"></td>
      </tr>
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
        <td style="background:#f8f8f8; font-size:8pt;">조&nbsp;&nbsp;제&nbsp;&nbsp;약&nbsp;&nbsp;&nbsp;&nbsp;성&nbsp;&nbsp;명</td>
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
    /* T-20260629-foot-DOCPRINT-CENTER-ALIGN: page 내 상·하 12mm + 좌우 자동 중앙 배치로 통일. @page=래퍼 소유. */
    .br-wrap { width: 190mm; min-height: 273mm; padding: 6mm 8mm; margin: 12mm auto; }
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
        <td colspan="3" style="font-weight:bold;">{{clinic_name}}</td>
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
      <tr>
        <td class="br-label">진찰료</td>
        <td class="br-num"></td><td class="br-num"></td><td class="br-num"></td><td class="br-num"></td>
      </tr>
      <tr>
        <td class="br-label">입원료</td>
        <td class="br-num"></td><td class="br-num"></td><td class="br-num"></td><td class="br-num"></td>
      </tr>
      <tr>
        <td class="br-label">식&nbsp;&nbsp;&nbsp;대</td>
        <td class="br-num"></td><td class="br-num"></td><td class="br-num"></td><td class="br-num"></td>
      </tr>
      <tr>
        <td class="br-label">투약 및 조제료</td>
        <td class="br-num"></td><td class="br-num"></td><td class="br-num"></td><td class="br-num"></td>
      </tr>
      <tr>
        <td class="br-label">주사료</td>
        <td class="br-num"></td><td class="br-num"></td><td class="br-num"></td><td class="br-num"></td>
      </tr>
      <tr>
        <td class="br-label">처치 및 수술료</td>
        <td class="br-num"></td><td class="br-num"></td>
        <td class="br-num">{{non_covered}}</td>
        <td class="br-num">{{total_amount}}</td>
      </tr>
      <tr>
        <td class="br-label">검&nbsp;&nbsp;&nbsp;사&nbsp;&nbsp;&nbsp;료</td>
        <td class="br-num"></td><td class="br-num"></td><td class="br-num"></td><td class="br-num"></td>
      </tr>
      <tr>
        <td class="br-label">영상진단 및 방사선치료료</td>
        <td class="br-num"></td><td class="br-num"></td><td class="br-num"></td><td class="br-num"></td>
      </tr>
      <tr>
        <td class="br-label">재활 및 물리치료료</td>
        <td class="br-num"></td><td class="br-num"></td><td class="br-num"></td><td class="br-num"></td>
      </tr>
      <tr>
        <td class="br-label">정신요법료</td>
        <td class="br-num"></td><td class="br-num"></td><td class="br-num"></td><td class="br-num"></td>
      </tr>
      <tr>
        <td class="br-label">치과행위</td>
        <td class="br-num"></td><td class="br-num"></td><td class="br-num"></td><td class="br-num"></td>
      </tr>
      <tr>
        <td class="br-label">한방행위</td>
        <td class="br-num"></td><td class="br-num"></td><td class="br-num"></td><td class="br-num"></td>
      </tr>
      <tr>
        <td class="br-label" style="font-weight:bold;">소&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;계</td>
        <td class="br-num" style="font-weight:bold;">{{insurance_covered}}</td>
        <td class="br-num"></td>
        <td class="br-num" style="font-weight:bold;">{{non_covered}}</td>
        <td class="br-num" style="font-weight:bold;">{{total_amount}}</td>
      </tr>
      <tr style="height:32px;">
        <td class="br-label" style="font-size:9pt; font-weight:bold; text-align:center;">총&nbsp;진료비&nbsp;합계</td>
        <td colspan="4" style="font-size:13pt; font-weight:bold; text-align:center; letter-spacing:2px;">
          ₩ {{total_amount}}
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
        요양기관명 : <span style="font-weight:bold;">{{clinic_name}}</span>
      </div>
      <div class="br-sign-item">
        진료의사 : {{doctor_name}}&nbsp;{{doctor_seal_html}}
      </div>
    </div>
  </div>

  <!-- 주의사항 -->
  <div class="br-notice">
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
        <td style="border:none; padding:2px 0; background:none; min-width:160px;">{{clinic_name}}</td>
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

// ─── 템플릿 맵 ───

const HTML_TEMPLATE_MAP: Record<string, string> = {
  koh_result: KOH_RESULT_HTML,
  diagnosis: DIAGNOSIS_HTML,
  treat_confirm: TREAT_CONFIRM_HTML,
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
  // T-20260522-foot-INS-DOC-PRINT: 보험청구서
  ins_claim_form: INS_CLAIM_FORM_HTML,
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

/** HTML 양식 여부 확인 */
export function isHtmlTemplate(formKey: string): boolean {
  return formKey in HTML_TEMPLATE_MAP;
}

/**
 * rx_standard용 처방 의약품 행 HTML 생성.
 * `rx_items_html` 변수에 주입할 `<tr>...</tr>` 뭉치 반환.
 * 최소 8행 보장 (빈 행 포함).
 *
 * @see T-20260515-foot-FORM-ONELINE-RX
 */
export function buildRxItemsHtml(
  items: Array<{
    name: string;
    unit_dose?: string;
    daily_freq?: string;
    total_days?: string;
    method?: string;
  }>,
): string {
  const TOTAL_ROWS = 8;
  const rows = items.map((item) => ({
    name: item.name,
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
