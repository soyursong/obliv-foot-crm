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
    @media print {
      .form-wrap { padding: 6mm 8mm; width: 195mm; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
      <tr>
        <td style="background:#f8f8f8;">환자의 주소</td>
        <td colspan="2">{{patient_address}}</td>
        <td style="white-space:nowrap;">전화번호&nbsp;&nbsp;{{patient_phone}}</td>
      </tr>
      <tr>
        <td rowspan="3" style="background:#f8f8f8; text-align:center; vertical-align:middle; font-weight:bold; font-size:10pt; letter-spacing:2px;">명&nbsp;&nbsp;명</td>
        <td style="background:#f0f0f0; text-align:center; width:100px;">상병코드</td>
        <td style="background:#f0f0f0; text-align:center;">상&nbsp;&nbsp;&nbsp;병&nbsp;&nbsp;&nbsp;명</td>
        <td style="background:#f0f0f0; text-align:center; width:70px;">특 정 기 호</td>
      </tr>
      <tr>
        <td style="min-height:20px;">{{diag_code_1}}</td>
        <td style="min-height:20px;">{{diag_name_1}}</td>
        <td style="min-height:20px;">{{diag_flag_1}}</td>
      </tr>
      <tr>
        <td style="min-height:20px;">{{diag_code_2}}</td>
        <td style="min-height:20px;">{{diag_name_2}}</td>
        <td style="min-height:20px;">{{diag_flag_2}}</td>
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
        <td colspan="7"></td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">면 허 번 호</td>
        <td colspan="3">제&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;호</td>
        <td style="background:#f8f8f8; text-align:right; white-space:nowrap;">의 사 성 명</td>
        <td colspan="2">{{doctor_name}}</td>
        <td style="text-align:center;">(인)</td>
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
  <div style="text-align:center; font-size:8pt; margin-bottom:4px; color:#555;">
    ☐ 상병 및 향후치료의견 미표시
  </div>

  <table>
    <tbody>
      <tr>
        <td style="width:70px; background:#f8f8f8;">병 록 번 호</td>
        <td style="width:140px;">{{record_no}}</td>
        <td style="width:60px; background:#f8f8f8;"></td>
        <td></td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">연 번 호</td>
        <td>{{visit_no}}</td>
        <td style="background:#f8f8f8;">성별</td>
        <td>
          ☐ 여성&nbsp;&nbsp;
          <span style="font-weight:bold;">☑ 남성</span>
        </td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">주&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;소</td>
        <td colspan="2">{{patient_address}}</td>
        <td style="white-space:nowrap;">연령&nbsp;&nbsp;만&nbsp;<strong>{{patient_age}}</strong>&nbsp;세</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">환자 성명</td>
        <td>{{patient_name}}</td>
        <td style="background:#f8f8f8; font-size:8pt; white-space:nowrap;">☐ 상병 표시<br>비활성화</td>
        <td></td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">주 민 번 호</td>
        <td colspan="3">{{patient_rrn}}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td rowspan="3" style="width:60px; background:#f8f8f8; text-align:center; font-weight:bold; font-size:10pt; letter-spacing:2px;">명&nbsp;&nbsp;명</td>
        <td style="background:#f0f0f0; text-align:center; width:90px;">상 병 코 드</td>
        <td style="background:#f0f0f0; text-align:center;">상&nbsp;&nbsp;&nbsp;병&nbsp;&nbsp;&nbsp;명</td>
        <td style="background:#f0f0f0; text-align:center; width:70px;">특 정 기 호</td>
      </tr>
      <tr>
        <td style="min-height:20px;">{{diag_code_1}}</td>
        <td>{{diag_name_1}}</td>
        <td>{{diag_flag_1}}</td>
      </tr>
      <tr>
        <td style="min-height:20px;">{{diag_code_2}}</td>
        <td>{{diag_name_2}}</td>
        <td>{{diag_flag_2}}</td>
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
      <tr>
        <td style="width:50px; background:#f8f8f8; text-align:center; vertical-align:middle; line-height:1.7;">향후<br>치료<br>의견</td>
        <td style="min-height:60px;" class="large-area">{{treatment_opinion}}</td>
      </tr>
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
        <td></td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">면 허 번 호</td>
        <td colspan="1">제&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;호</td>
        <td style="background:#f8f8f8; text-align:right; white-space:nowrap;">의 사 성 명</td>
        <td>{{doctor_name}}&nbsp;&nbsp;(인)</td>
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
        <td style="width:30px;"></td>
        <td></td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">연 번 호</td>
        <td>{{visit_no}}</td>
        <td style="background:#f8f8f8; white-space:nowrap; font-size:8pt;">성별</td>
        <td>☐ 여&nbsp;&nbsp;☑ 남</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">주&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;소</td>
        <td colspan="2">{{patient_address}}</td>
        <td style="white-space:nowrap;">연령&nbsp;만&nbsp;<strong>{{patient_age}}</strong>&nbsp;세</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">환자 성명</td>
        <td>{{patient_name}}</td>
        <td colspan="2" style="font-size:8pt; color:#555;">
          ☐ 상병 표시 비활성화&nbsp;&nbsp;☐ 향후치료의견 미표시
        </td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">주 민 번 호</td>
        <td colspan="3">{{patient_rrn}}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td rowspan="3" style="width:60px; background:#f8f8f8; text-align:center; font-weight:bold; font-size:10pt; letter-spacing:2px;">명&nbsp;&nbsp;명</td>
        <td style="background:#f0f0f0; text-align:center; width:90px;">상 병 코 드</td>
        <td style="background:#f0f0f0; text-align:center;">상&nbsp;&nbsp;&nbsp;병&nbsp;&nbsp;&nbsp;명</td>
        <td style="background:#f0f0f0; text-align:center; width:70px;">특 정 기 호</td>
      </tr>
      <tr>
        <td>{{diag_code_1}}</td>
        <td>{{diag_name_1}}</td>
        <td>{{diag_flag_1}}</td>
      </tr>
      <tr>
        <td>{{diag_code_2}}</td>
        <td>{{diag_name_2}}</td>
        <td>{{diag_flag_2}}</td>
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
      <tr>
        <td style="width:50px; background:#f8f8f8; text-align:center; vertical-align:middle; line-height:1.7;">향후<br>치료<br>의견</td>
        <td style="min-height:60px;" class="large-area">{{treatment_opinion}}</td>
      </tr>
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
        <td></td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">면 허 번 호</td>
        <td>제&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;호</td>
        <td style="background:#f8f8f8; text-align:right; white-space:nowrap;">의 사 성 명</td>
        <td>{{doctor_name}}&nbsp;&nbsp;(인)</td>
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
  <div style="text-align:center; font-size:8pt; margin-bottom:4px; color:#555;">
    ☐ 상병 표시 비활성화
  </div>

  <table>
    <tbody>
      <tr>
        <td style="width:70px; background:#f8f8f8;">병 록 번 호</td>
        <td style="width:140px;">{{record_no}}</td>
        <td style="width:70px; background:#f8f8f8;">주 민 번 호</td>
        <td>{{patient_rrn}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">연 번 호</td>
        <td colspan="3">{{visit_no}}</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">환자 성명</td>
        <td>{{patient_name}}</td>
        <td style="background:#f8f8f8;">성별</td>
        <td>☐ 여&nbsp;&nbsp;☑ 남</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">생년월일</td>
        <td>{{patient_birthdate}}</td>
        <td style="background:#f8f8f8;">연령</td>
        <td>만&nbsp;<strong>{{patient_age}}</strong>&nbsp;세</td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">환자의 주소</td>
        <td colspan="2">{{patient_address}}</td>
        <td style="white-space:nowrap;">환자전화&nbsp;{{patient_phone}}</td>
      </tr>
    </tbody>
  </table>

  <table style="margin-top:4px;">
    <tbody>
      <tr>
        <td rowspan="3" style="width:60px; background:#f8f8f8; text-align:center; font-weight:bold; font-size:10pt; letter-spacing:2px;">상병명</td>
        <td style="background:#f0f0f0; text-align:center; width:90px;">상 병 코 드</td>
        <td style="background:#f0f0f0; text-align:center;">상&nbsp;&nbsp;&nbsp;병&nbsp;&nbsp;&nbsp;명</td>
        <td style="background:#f0f0f0; text-align:center; width:70px;">특 정 기 호</td>
      </tr>
      <tr>
        <td>{{diag_code_1}}</td>
        <td>{{diag_name_1}}</td>
        <td>{{diag_flag_1}}</td>
      </tr>
      <tr>
        <td>{{diag_code_2}}</td>
        <td>{{diag_name_2}}</td>
        <td>{{diag_flag_2}}</td>
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
        <td style="min-height:100px;" class="large-area">{{diagnosis_ko}}</td>
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
        <td colspan="3"></td>
      </tr>
      <tr>
        <td style="background:#f8f8f8;">면 허 번 호</td>
        <td>제&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;호</td>
        <td style="background:#f8f8f8; text-align:right; white-space:nowrap;">의 사 성 명</td>
        <td>{{doctor_name}}&nbsp;&nbsp;(인)</td>
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
    @page { size: A4 landscape; margin: 8mm; }
    .bill-wrap { width: 272mm; padding: 4mm 6mm; }
  }
</style>
<div class="bill-wrap">
  <div class="header-note">■ [별지 제1호 서식] 진료비 세부산정내역 서식 (제2호제1항 관련)</div>
  <div class="title-main">진료비 세부산정내역</div>

  <!-- 환자 기본 정보 -->
  <table style="margin-bottom:4px;">
    <thead>
      <tr>
        <th style="width:80px;">환자등록번호</th>
        <th style="width:80px;">환자성명</th>
        <th>진료기간</th>
        <th style="width:60px;">병실</th>
        <th style="width:70px;">환자구분</th>
        <th>비고</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>{{record_no}}</td>
        <td>{{patient_name}}</td>
        <td>{{visit_date}} ～ {{visit_date}}</td>
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
        <th rowspan="2" style="width:60px;">일자</th>
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
        <td colspan="7" style="text-align:center; background:#f8f8f8;">골처리 조정금액</td>
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
        <td style="width:30px; text-align:center;">[인]</td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ─── 진료비 납입증명서(소득공제용) ───

const PAYMENT_CERT_HTML = `
${COMMON_STYLE}
<div class="form-wrap">
  <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
    <div style="flex:1;">
      <div style="font-size:17pt; font-weight:bold; letter-spacing:4px; margin-top:6px;">진료비&nbsp;&nbsp;납입증명서(소득공제용)</div>
    </div>
    <div style="font-size:9pt; text-align:left; line-height:1.8; white-space:nowrap; padding-top:4px;">
      진&nbsp;&nbsp;료&nbsp;&nbsp;과&nbsp;:&nbsp;&nbsp;&nbsp;<br>
      작&nbsp;&nbsp;성&nbsp;&nbsp;자&nbsp;:&nbsp;&nbsp;&nbsp;<br>
      일&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;자&nbsp;:&nbsp;20&nbsp;&nbsp;&nbsp;&nbsp;년&nbsp;&nbsp;&nbsp;&nbsp;월&nbsp;&nbsp;&nbsp;&nbsp;일
    </div>
  </div>

  <table style="margin-bottom:4px;">
    <tbody>
      <tr>
        <td style="width:70px; background:#f8f8f8;">등&nbsp;록&nbsp;번&nbsp;호</td>
        <td style="width:200px;">{{record_no}}</td>
        <td style="width:30px; background:#f8f8f8; text-align:center;">No</td>
        <td></td>
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
        <td colspan="2" style="text-align:center; font-size:8.5pt;">진료비 소득공제 신청용</td>
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
        <td style="border:none; padding:2px 0; background:none; min-width:120px;"></td>
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
    ※ 본 진료비는 20&nbsp;&nbsp;&nbsp;&nbsp;년&nbsp;&nbsp;&nbsp;&nbsp;월까지의 진료비 내역으로 이후 진료비에 대한 소득공제는 진료일에 발행하는 진료비 영수증으로 제출하시기 바랍니다.<br>
    ※ 본 증명서는 상기목적 이외의 타용도로 사용할 수 없습니다.
  </div>
</div>
`;

// ─── 진료의뢰서 ───

const REFERRAL_LETTER_HTML = `
${COMMON_STYLE}
<div class="form-wrap" style="border:1px solid #000; padding:0;">
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
          <td style="border:none; padding:2px 4px; background:none; font-size:9.5pt;">외래&nbsp;·&nbsp;입원</td>
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
          <td style="border:none; padding:2px 0 2px 24px; background:none; white-space:nowrap; font-size:9.5pt;">(날인)</td>
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
        <td style="background:#f8f8f8; text-align:center;">(인)</td>
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
        <td rowspan="2" style="min-width:120px; font-size:9.5pt;">{{disease_name}}</td>
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
      <div style="font-size:8.5pt;">(면허번호&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;호)</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:9.5pt; letter-spacing:2px;">{{issue_date}}</div>
      <div style="font-size:9.5pt; margin-top:4px;">담당의사&nbsp;:&nbsp;{{doctor_name}}&nbsp;&nbsp;(인)</div>
    </div>
  </div>
</div>
`;

// ─── 템플릿 맵 ───

const HTML_TEMPLATE_MAP: Record<string, string> = {
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
};

/**
 * form_key에 해당하는 HTML 템플릿 문자열 반환.
 * 없으면 null (PNG 폴백 렌더러로 분기).
 */
export function getHtmlTemplate(formKey: string): string | null {
  return HTML_TEMPLATE_MAP[formKey] ?? null;
}

/**
 * HTML 템플릿의 `{{key}}` 플레이스홀더를 fieldValues로 치환.
 * 값이 없는 키는 빈 문자열로 치환.
 * HTML injection 방지: 신뢰된 내부 데이터만 주입.
 */
export function bindHtmlTemplate(
  html: string,
  fieldValues: Record<string, string>,
): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = fieldValues[key] ?? '';
    // 기본 HTML 이스케이프 (XSS 방지 — 필드값은 신뢰 데이터이지만 방어적으로 처리)
    return val
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
      return `<tr>
        <td>${item.category ?? '기타'}</td>
        <td style="font-size:7.5pt;">${item.date ?? ''}</td>
        <td style="font-size:7.5pt;">${item.code ?? ''}</td>
        <td style="text-align:left;">${item.name}</td>
        <td class="num-cell">${amt}</td>
        <td class="num-cell">${count}</td>
        <td class="num-cell">${days}</td>
        <td class="num-cell">${totalStr}</td>
        <td class="num-cell">0</td>
        <td class="num-cell">0</td>
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
