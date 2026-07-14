/**
 * draftFormTemplates.ts — 서류양식 개편 DRAFT (시안 전용, 라이브 무접촉)
 *
 * T-20260714-foot-FEEDOC-FORM-REDESIGN-BODYSTYLE (김주연 총괄)
 *
 * ⛔️ HARD CONSTRAINT (총괄 재강조 MSG-20260714-102405-q40a):
 *   C1. 진료비 계산서·영수증 양식 개편은 현재 라이브 출력 로직과 **완전 분리**.
 *       → 이 파일은 라이브 템플릿 레지스트리(htmlFormTemplates.ts / FORM_HTML_TEMPLATES)에
 *         **절대 import·등록하지 않는다.** 라이브 번들은 이 모듈을 참조하지 않음(트리 셰이킹).
 *   C2. 시안(preview/sample) 먼저 완성 → 총괄 컨펌 → 그 다음 CRM 적용. 순서 엄수.
 *       → 컨펌 수신 후 별도 후속 티켓에서 htmlFormTemplates.ts로 승격(wiring)한다.
 *   C3. 현재 서류 출력 기능에 side-effect 0. 이 파일 추가만으로는 라이브 경로 무변경.
 *
 * 기준: 도수센터(obliv-body-crm) 등록 진료비 계산서·영수증 = 국민건강보험 요양급여의
 *       기준에 관한 규칙 [별지 제6호서식] <개정 2024. 7. 18.>. 첨부 IMG_8943.jpg 참조.
 *
 * 참고: 그리드 표준 항목 행(진찰료~기타)은 별지 제6호서식 공통 서식이며 클리닉 무관 동일.
 *       {{...}} placeholder 명은 라이브 승격 시 autoBindContext 바인딩과 정합되도록
 *       body CRM 명명을 그대로 채택(record_no, receipt_no, copayment, insurance_covered,
 *       full_copay, non_covered, overcap, total_amount, patient_amount, paid_amount,
 *       unpaid_amount, card_amount, cashreceipt_amount, cash_amount, paid_total,
 *       remaining_amount, clinic_biz_reg_no, clinic_company_name, clinic_phone,
 *       clinic_address, doctor_name, stamp_img_html, issue_date, patient_name, visit_date).
 */

export const BILL_RECEIPT_DRAFT_HTML = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .r6-wrap {
    font-family: 'Malgun Gothic','Apple SD Gothic Neo',NanumGothic,sans-serif;
    font-size: 7.3pt; color:#000; background:#fff;
    padding: 6mm 8mm; width: 194mm; min-height: 285mm;
  }
  .r6-legal { font-size:7pt; margin-bottom:1mm; }
  .r6-title { text-align:center; font-size:14pt; font-weight:bold; letter-spacing:2px; padding:2px 0 4px; }
  .r6-title .chk { font-size:8.5pt; font-weight:normal; letter-spacing:0; }
  .r6-wrap table { width:100%; border-collapse:collapse; table-layout:fixed; }
  .r6-wrap td, .r6-wrap th { border:1px solid #000; padding:1px 3px; vertical-align:middle; font-size:7.3pt; line-height:1.12; }
  .r6-wrap th { background:#f2f2f2; font-weight:bold; text-align:center; }
  .r6-lbl { background:#f7f7f7; text-align:center; white-space:nowrap; }
  .r6-num { text-align:right; font-variant-numeric:tabular-nums; padding-right:4px; }
  .r6-grp { background:#f7f7f7; text-align:center; font-size:6.8pt; width:16px; letter-spacing:1px; }
  .r6-flex { display:flex; gap:0; align-items:stretch; }
  .r6-left { flex:0 0 62%; }
  .r6-right { flex:1; margin-left:-1px; }
  .r6-right table { height:100%; }
  @media print {
    @page { size:A4 portrait; margin:0; }
    .r6-wrap { width:210mm; padding:5mm 7mm; }
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
</style>
<div class="r6-wrap">
  <div class="r6-legal">■ 국민건강보험 요양급여의 기준에 관한 규칙 [별지 제6호서식] &lt;개정 2024. 7. 18.&gt;</div>
  <div class="r6-title"><span class="chk">[■]외래 [ ]입원 ([ ]퇴원 [ ]중간)</span> 진료비 계산서ㆍ영수증</div>

  <table style="margin-bottom:-1px;">
    <colgroup><col style="width:13%"><col style="width:20%"><col style="width:11%"><col style="width:19%"><col style="width:10%"><col style="width:15%"><col style="width:12%"></colgroup>
    <tbody>
      <tr>
        <td class="r6-lbl">환자등록번호</td><td>{{record_no}}</td>
        <td class="r6-lbl">환자 성명</td><td>{{patient_name}}</td>
        <td class="r6-lbl">진료기간</td><td>{{visit_date}}</td>
        <td class="r6-lbl" style="font-size:6.4pt;">야간(공휴일)<br>[ ]야간 [ ]공휴일</td>
      </tr>
      <tr>
        <td class="r6-lbl">진료과목</td><td>{{department}}</td>
        <td class="r6-lbl" style="font-size:6.8pt;">질병군(DRG)번호</td><td></td>
        <td class="r6-lbl">병실</td><td></td>
        <td class="r6-lbl" style="font-size:6.4pt;">환자구분<br>건강보험</td>
      </tr>
      <tr>
        <td class="r6-lbl">영수증번호</td><td colspan="6" style="text-align:left;">{{receipt_no}}</td>
      </tr>
    </tbody>
  </table>

  <div class="r6-flex">
    <div class="r6-left">
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
          <tr><td class="r6-grp" rowspan="18">기<br>본<br>항<br>목</td><td>진찰료</td><td class="r6-num">{{copayment}}</td><td class="r6-num">{{insurance_covered}}</td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>입원료 (1인실)</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>입원료 (2·3인실)</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>입원료 (4인실 이상)</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>식대</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>투약 및 조제료 (행위료)</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>투약 및 조제료 (약품비)</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>주사료 (행위료)</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>주사료 (약품비)</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>마취료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>처치 및 수술료</td><td class="r6-num">{{proc_copay}}</td><td class="r6-num">{{proc_ins}}</td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>검사료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>영상진단료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>방사선치료료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>치료재료대</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>재활 및 물리치료료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>정신요법료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>전혈 및 혈액성분제제료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td class="r6-grp" rowspan="12">선<br>택<br>항<br>목</td><td>CT 진단료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>MRI 진단료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>PET 진단료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>초음파 진단료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>보철ㆍ교정료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>제증명수수료</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num">{{noncovered_fee}}</td></tr>
          <tr><td>선별급여</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>65세 이상 등 정액</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>정액수가(요양병원)</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>정액수가(완화의료)</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>질병군 포괄수가</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td></tr>
          <tr><td>기타</td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num"></td><td class="r6-num">{{non_covered}}</td></tr>
          <tr>
            <td class="r6-lbl" colspan="2" style="font-weight:bold;">합계</td>
            <td class="r6-num" style="font-weight:bold;">① {{copayment}}</td>
            <td class="r6-num" style="font-weight:bold;">② {{insurance_covered}}</td>
            <td class="r6-num" style="font-weight:bold;">③ {{full_copay}}</td>
            <td class="r6-num" style="font-weight:bold;">④ {{non_covered}}</td>
          </tr>
          <tr>
            <td class="r6-lbl" colspan="2">상한액 초과금 ⑤</td>
            <td class="r6-num" colspan="4" style="text-align:left;">{{overcap}}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="r6-right">
      <table>
        <colgroup><col style="width:56%"><col></colgroup>
        <tbody>
          <tr><th colspan="2">금액산정내용</th></tr>
          <tr><td>⑥ 진료비 총액<br>(①+②+③+④)</td><td class="r6-num" style="font-weight:bold;">{{total_amount}}</td></tr>
          <tr><td>⑦ 공단부담 총액<br>(②+⑤)</td><td class="r6-num">{{insurance_covered}}</td></tr>
          <tr><td>⑧ 환자부담 총액<br>(①-⑤)+③+④</td><td class="r6-num" style="font-weight:bold;">{{patient_amount}}</td></tr>
          <tr><td>⑨ 이미 납부한 금액</td><td class="r6-num">{{paid_amount}}</td></tr>
          <tr><td>⑩ 납부할 금액<br>(⑧-⑨)</td><td class="r6-num" style="font-weight:bold;">{{unpaid_amount}}</td></tr>
          <tr><td rowspan="4">⑪ 납부한<br>금액</td><td class="r6-num" style="text-align:left;">카드 <span style="float:right;">{{card_amount}}</span></td></tr>
          <tr><td class="r6-num" style="text-align:left;">현금영수증 <span style="float:right;">{{cashreceipt_amount}}</span></td></tr>
          <tr><td class="r6-num" style="text-align:left;">현금 <span style="float:right;">{{cash_amount}}</span></td></tr>
          <tr><td class="r6-num" style="text-align:left;">합계 <span style="float:right;font-weight:bold;">{{paid_total}}</span></td></tr>
          <tr><td>납부하지 않은 금액<br>(⑩-⑪)</td><td class="r6-num">{{remaining_amount}}</td></tr>
          <tr><td>현금영수증 (&nbsp;&nbsp;&nbsp;)</td><td></td></tr>
          <tr><td>신분확인번호</td><td></td></tr>
          <tr><td>현금영수증 승인번호</td><td></td></tr>
          <tr><td colspan="2" style="font-size:6.6pt; color:#555; text-align:left;">* 요양기관 임의활용공간</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <table style="margin-top:2mm;">
    <colgroup><col style="width:14%"><col><col style="width:9%"><col style="width:12%"><col style="width:9%"><col style="width:16%"></colgroup>
    <tbody>
      <tr>
        <td class="r6-lbl">요양기관 종류</td>
        <td colspan="5" style="text-align:left;">[■]의원급ㆍ보건기관 &nbsp; [ ]병원급 &nbsp; [ ]종합병원 &nbsp; [ ]상급종합병원</td>
      </tr>
      <tr>
        <td class="r6-lbl">사업자등록번호</td><td>{{clinic_biz_reg_no}}</td>
        <td class="r6-lbl">상호</td><td>{{clinic_company_name}}</td>
        <td class="r6-lbl">전화번호</td><td>{{clinic_phone}}</td>
      </tr>
      <tr>
        <td class="r6-lbl">사업장 소재지</td><td colspan="3">{{clinic_address}}</td>
        <td class="r6-lbl">대표자</td>
        <td style="text-align:left;">{{doctor_name}} &nbsp; {{stamp_img_html}}</td>
      </tr>
    </tbody>
  </table>

  <div style="text-align:center; font-size:9pt; margin-top:3mm; letter-spacing:1px;">{{issue_date}}</div>

  <table style="margin-top:1.5mm;">
    <colgroup><col style="width:68%"><col></colgroup>
    <thead>
      <tr><th>항목별 설명</th><th>일반사항 안내</th></tr>
    </thead>
    <tbody>
      <tr>
        <td style="vertical-align:top; text-align:left; font-size:6.2pt; line-height:1.32; padding:2px 4px;">
          <div>1. 일부 본인부담: 일반적으로 다음과 같이 본인부담률을 적용하나, 요양기관 지역, 요양기관의 종별, 환자 자격, 선별급여(「국민건강보험법」 제41조의4에 따른 요양급여) 여부, 병실종류 등에 따라 달라질 수 있습니다.</div>
          <div style="padding-left:6px;">- 외래 본인부담률: 요양기관 종별에 따라 30% ~ 60%(의료급여는 수급권자 종별 및 의료급여기관 유형 등에 따라 0원 ~ 2500원, 0% ~ 15%) 등</div>
          <div style="padding-left:6px;">- 입원 본인부담률: 20%(의료급여는 수급권자 종별 및 의료급여기관 유형 등에 따라 0% ~ 10%) 등</div>
          <div style="padding-left:6px;">※ 식대: 50%(의료급여는 20%) / CTㆍMRIㆍPET: 외래 본인부담률(의료급여는 입원 본인부담률과 동일) / 선별급여(「국민건강보험법」 제41조의4에 따른 요양급여): 보건복지부장관이 고시한 항목별 본인부담률(50%, 80%, 90%)</div>
          <div style="padding-left:6px;">※ 상급종합병원 입원료: 2인실 50%, 3인실 40%, 4인실 30% / 병원급 의료기관(치과병원 제외) 입원료: 2인실 40%, 3인실 30%</div>
          <div style="margin-top:1px;">2. 전액 본인부담: 「국민건강보험법 시행규칙」 별표 6 또는 「의료급여법 시행규칙」 별표 1의2에 따라 적용되는 항목으로 건강보험(의료급여)에서 금액을 정하고 있으나 진료비 전액을 환자 본인이 부담합니다.</div>
          <div style="margin-top:1px;">3. 상한액 초과금:「국민건강보험법 시행령」 별표 3 제1호에 따른 본인부담상한액의 최고 금액을 초과하는 본인부담금이 발생한 경우[단, 「의료법」 제3조제2항제3호라목에 따른 요양병원(「장애인복지법」 제58조제1항제4호에 따른 장애인 의료재활시설로서 「의료법」 제3조의2의 요건을 갖춘 의료기관인 요양병원은 제외)에 입원한 기간이 같은 연도에 120일을 초과하는 경우는 제외], 공단이 부담하는 초과분 중 사전 정산하는 금액을 말합니다.</div>
          <div style="padding-left:6px;">※ 전액 본인부담 및 선별급여(「국민건강보험법」제41조의4에 따른 요양급여)의 본인부담금 등은 본인부담상한액 산정시 제외합니다.</div>
          <div style="margin-top:1px;">4. "질병군 포괄수가"란 「국민건강보험법 시행령」 제21조제3항제2호 및 「국민건강보험 요양급여의 기준에 관한 규칙」 제8조제3항에 따라 보건복지부장관이 고시한 질병군 입원진료에 대하여 해당 입원진료와 관련되는 여러 의료행위를 하나의 행위로 정하여 요양급여비용을 결정한 것을 말합니다. 다만, 해당 질병군의 입원진료와 관련되는 의료행위라도 비급여대상이나 이송처치료 등 포괄수가에서 제외되는 항목은 위 표의 기본항목 및 선택항목란에 합산하여 표기됩니다.</div>
        </td>
        <td style="vertical-align:top; text-align:left; font-size:6.2pt; line-height:1.32; padding:2px 4px;">
          <div>1. 이 계산서ㆍ영수증에 대한 세부내용은 요양기관에 요구하여 제공받을 수 있습니다.</div>
          <div style="margin-top:1px;">2. 「국민건강보험법」 제48조 또는 「의료급여법」 제11조의3에 따라 환자가 전액 부담한 비용과 비급여로 부담한 비용의 타당성 여부를 건강보험심사평가원(☏1644-2000, 홈페이지: www.hira.or.kr)에 확인 요청하실 수 있습니다.</div>
          <div style="margin-top:1px;">3. 계산서ㆍ영수증은 「소득세법」에 따른 의료비 공제신청 또는 「조세특례제한법」에 따른 현금영수증 공제신청(현금영수증 승인번호가 적힌 경우만 해당합니다)에 사용할 수 있습니다. 다만, 지출증빙용으로 발급된 "현금영수증(지출증빙)"은 공제신청에 사용할 수 없습니다.</div>
          <div style="padding-left:6px;">(현금영수증 문의 126 인터넷 홈페이지: http://현금영수증.kr)</div>
        </td>
      </tr>
    </tbody>
  </table>

  <div style="font-size:6.2pt; color:#000; text-align:left; margin-top:1mm; line-height:1.32; padding:0 1px;">
    주(註): 1. 진료항목 중 선택항목은 요양기관의 특성에 따라 추가 또는 생략할 수 있으며, 야간(공휴일)진료 시 진료비가 가산될 수 있습니다.<br>
    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;2. 환자가 「위기 임신 및 보호출산 지원과 아동 보호에 관한 특별법」 제2조제3호에 따른 비식별화된 가명을 부여받은 경우에는 환자의 성명 대신 가명을 기재할 수 있습니다.
  </div>

  <div style="text-align:right; font-size:6.4pt; color:#555; margin-top:1mm;">210㎜×297㎜[백상지 80g/㎡]</div>
</div>
`;
