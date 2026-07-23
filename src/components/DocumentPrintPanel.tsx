// LOGIC-LOCK: L-006 — 서류출력 경로 통일. DocumentPrintPanel이 PATH-1/2/3 단일 렌더링 기준. 변경 시 현장 승인 필수

/**
 * DocumentPrintPanel — 풋센터 서류 발행 패널
 *
 * CheckInDetailSheet 내 "서류 발행" 섹션.
 * form_templates DB 테이블에서 양식 목록을 로드하고, 없으면 fallback 사용.
 *
 * ── 기능 ──
 * 1) 서류 분류: 기본 (프리셋 자동 선택) / 별도 요청 (개별 선택)
 * 2) 일괄 출력: 체크박스 선택 → "일괄 출력" / "기본 서류 출력" 원클릭
 * 3) 단건 발행 다이얼로그: 자동 바인딩 + 수기 입력 + 미리보기
 * 4) 원내 도장 오버레이: 각 양식 인쇄 시 도장 이미지 자동 삽입
 * 5) form_submissions 로그 기록 (printed_at, issued_by)
 *
 * Phase 2(좌표 측정) 전에는 field_map이 비어 있어 미리보기에 오버레이 없이 원본만 표시.
 *
 * @see T-20260423-foot-DOC-PRINT-SPEC
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import {
  FileText,
  Printer,
  Eye,
  Clock,
  AlertCircle,
  CheckSquare,
  Square,
  Layers,
  UserCheck,
  Receipt,
  Plus,
  Trash2,
  Upload,
  Pencil,
  Check,
  X,
  Stethoscope,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AmountInput } from '@/components/ui/AmountInput';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { RX_COL, rxDigits } from '@/lib/rxFormat';
import { useAuth } from '@/lib/auth';
import { formatAmount } from '@/lib/format';
// T-20260622-foot-DOCSERIAL-AUTOGEN: 서류 연번호 자동 생성 (단일 config + 헬퍼)
import { buildDocSerial, docSerialPrefix, buildIssueNo, splitIssueNoForDisplay } from '@/lib/docSerial';
import type { CheckIn } from '@/lib/types';
import { useDutyDoctors, type DutyDoctor } from '@/hooks/useDutyRoster';
// T-20260620-foot-MEDDOC-DESK-PRINTONLY-DOCTOR-AUTHORED: 소견서·진단서 = 원장 발행본 출력만(데스크 작성 불가).
import { useClinicHeader } from '@/components/doctor/OpinionDocTab';
import {
  useAuthoredMedDocs,
  printAuthoredMedDoc,
  isGatedMedDoc,
  medDocFormKeyToDocType,
  type AuthoredMedDoc,
} from '@/lib/medDocPrintGate';
import {
  DEFAULT_PRESET_KEYS,
  FALLBACK_TEMPLATES,
  INSURANCE_FALLBACK_TEMPLATES,
  FORM_META,
  getTemplateImageUrl,
  canAccessFormTemplate,
  DOC_PANEL_HIDDEN_FORM_KEYS,
  groupDocList,
  type FieldMapEntry,
  type FormSubmission,
  type FormTemplate,
} from '@/lib/formTemplates';
import {
  bindHtmlTemplate,
  buildBillDetailItemsHtml,
  buildBillReceiptFeeGridHtml,
  buildRxItemsHtml,
  buildSurchargeDetailRowHtml,
  getHtmlTemplate,
  isHtmlTemplate,
} from '@/lib/htmlFormTemplates';
import { loadAutoBindContext, applyBillingFallback, loadTreatingDoctorName } from '@/lib/autoBindContext';
// T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC: 출력시점 야간·공휴일 가산 자동 판정·계산(FE-only).
//   (reopen 2026-07-19) 미리보기·일괄출력 양 경로가 동일 SSOT 헬퍼(applyNightHolidaySurcharge)를 호출 —
//   가산이 미리보기에만 반영되고 현장 인쇄물(handleBatchPrint)엔 누락되던 divergence를 구조적으로 차단.
import {
  applyNightHolidaySurcharge,
  resolveSurchargeRefDate,
  toLocalDateStr,
} from '@/lib/nightHolidaySurcharge';
// T-20260710-foot-RRN-REGISTER-ERR-ISSUE-FROMCHART2 AC2: 발급 직전 미저장 2번차트 저장 가드
import { ensureChartSavedBeforePublish } from '@/lib/unsavedGuard';
// T-20260617-foot-DOCFORM-POPUP-OVERHAUL G4/AC-4: 진료의뢰서 검사결과(KOH)·투약내용(처방약) 자동 로드.
import { loadReferralAutoFields } from '@/lib/referralAutoLoad';
// T-20260710-foot-KOHRESULT-DOC-PRINT-ENABLE (AC-2/AC-3): 서류출력 명단에서 koh_result 출력 시
//   검사결과 탭(KohPublishedResults)과 동일한 발행 field_data 를 바인딩(발톱부위·의뢰번호 등 공란 방지).
import { loadPublishedKohFieldData } from '@/lib/printKohResult';
// T-20260608-foot-DOC-PATH12-SYNC: PATH-4(PaymentMiniWindow) 빌링 로직 1:1 재사용 (4경로 통일).
//   service_charges 가 비어있는 경로(= PMW 수기조정만 있고 보험 copay 미산출)에서 check_in_services
//   기반으로 PMW 와 동일한 빌링 폴백을 적용한다. (무파괴: service_charges 존재 시 기존 동작 불변.)
import {
  type FootBillingItem,
  computeFootBilling,
  loadFootBillingItems,
  loadEffectiveInsuranceGrade,
  buildFootBillDetailItems,
  fillBillItemCopayment,
  computeBillDetailRounding,
  computeBillReceiptNewCategoryBreakdown,
  // T-20260721-foot-BILLDOC-COPAY-PMW-REMAIN 단계 A: 신양식 비급여 category 토큰 주입 SSOT(승격됨).
  applyBillReceiptNewCategoryTokens,
  // T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX: 결함A(급여 category 분해 remainder)·결함B(납부박스 payments).
  applyBillReceiptNewCoveredTokens,
  applyBillReceiptPaidBoxTokens,
  // T-20260722-foot-BILLRECEIPT-MASTER-FIXES §1: ⑨ 이미 납부한 금액(선수금/패키지 차감분) 소스 로더.
  loadAlreadyPaidAmount,
  // T-20260721-foot-BILLDETAIL-SVCCHARGE-FALLBACK-RENDER: service_charges 직결 폴백 경로도
  //   정식 HIRA category 매핑(footBillDetailCategory) + codeItems(상병/처방약) 제외(isCodeItem)를
  //   primary(check_in_services) 경로와 대칭 적용. 종전 폴백 하드코드 `covered?'이학요법료':'기타'` 대체.
  footBillDetailCategory,
  isCodeItem,
} from '@/lib/footBilling';
import type { InsuranceGrade } from '@/lib/insurance';
// T-20260629-foot-DOCPRINT-EDIT-BTN: 서류 [출력] 옆 [수정] → 공통 설정/편집 팝업(§2#4 canonical).
import { DocFormSettingsDialog, DOC_PURPOSE_OPTIONS } from '@/components/DocFormSettingsDialog';

// ─── 타입 ───

interface InvoiceDoc {
  id: string;
  receipt_no: string | null;
  issue_date: string;
  total_amount: number;
  paid_amount: number;
  insurance_covered: number;
  non_covered: number;
  pdf_url: string | null;
  created_at: string;
}

// T-20260519-foot-RECEIPT-REISSUE: 결제 체크박스용
interface PaymentItem {
  id: string;
  amount: number;
  method: string | null;
  payment_type: string | null;
  created_at: string;
  // T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX 결함B: ⑪ 납부박스 현금영수증 버킷 분류용
  //   (현금/이체 中 현금영수증 발급분). payments.cash_receipt_issued 원장값.
  cash_receipt_issued?: boolean | null;
}

// ─── Props ───

interface Props {
  checkIn: CheckIn;
  onUpdated: () => void;
  /** T-20260522-foot-ALT-BADGE: ALT 활성 여부 — 레이저코드 삽입 차단 (AC-12) */
  altStatus?: boolean;
  /** T-20260623-foot-CHART2-VISITHIST-COMPACT-REISSUE ③: 서류재발급 모달 전용 레이아웃.
   *  true 시 [발행 이력]을 패널 상단으로 이동 + 2단(2열) 진열. 미지정(false) 시 기존 위치/1열 유지(타 surface 무영향). */
  historyAtTop?: boolean;
}

// ── T-20260719-foot-BILLRECEIPT-NEWFORM-ITEMFIX 헬퍼 ──
/** 콤마·통화기호 제거 후 숫자화(NaN 가드). formatAmount 역함수격. */
function parseAmountStr(v: string | null | undefined): number {
  if (v == null || v === '') return 0;
  const n = Number(v.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// T-20260721-foot-BILLDOC-COPAY-PMW-REMAIN 단계 A: applyBillReceiptNewCategoryTokens 는
//   footBilling.ts SSOT 로 승격(export)됨 — 결제미니창(PATH-4)과 동일 토큰 주입 공유. import 로 소비.

// T-20260522-foot-ALT-BADGE AC-12: 레이저 관련 서비스 판별 — category OR name 기반
function isLaserService(svc: { service_code?: string | null; name?: string; category?: string }): boolean {
  const cat = svc.category ?? '';
  const name = svc.name ?? '';
  const code = svc.service_code ?? '';
  // category가 laser/heated_laser 이거나, 이름에 '레이저' 포함, 또는 코드가 레이저 관련
  return (
    cat === 'laser' ||
    cat === 'heated_laser' ||
    name.includes('레이저') ||
    code.toUpperCase().startsWith('MM') // 이학요법료 레이저 수가코드 접두사
  );
}

// T-20260522-foot-ALT-BADGE AC-6: 패키지 유형과 레이저코드 호환성 검증 (ALT OFF 전체 패키지 공통)
// - 패키지에 해당 레이저 회차가 없으면 삽입 차단 (잘못된 레이저코드 삽입 방지)
export interface ActivePackageInfo {
  heated_sessions: number;
  unheated_sessions: number;
  package_name: string;
}

function isLaserBlockedByPackage(
  svc: { category?: string; name?: string; service_code?: string | null },
  pkg: ActivePackageInfo | null,
): boolean {
  if (!pkg) return false; // 패키지 없음 → 검증 불가, 허용
  if (!isLaserService(svc)) return false; // 레이저 서비스 아님 → 해당 없음
  const cat = svc.category ?? '';
  if (cat === 'heated_laser') {
    // 온열 레이저: 패키지에 온열 회차 없으면 차단
    return (pkg.heated_sessions ?? 0) === 0;
  }
  if (cat === 'laser') {
    // 비온열 레이저: 패키지에 비온열 회차 없으면 차단
    return (pkg.unheated_sessions ?? 0) === 0;
  }
  // 이름/코드 기반 레이저(category 미분류): 전체 레이저 회차가 0이면 차단
  return (pkg.heated_sessions ?? 0) + (pkg.unheated_sessions ?? 0) === 0;
}

// ─── 자동 바인딩 컨텍스트 — @/lib/autoBindContext.ts 로 추출됨 ───
// T-20260521-foot-DOC-PRINT-UNIFY PUSH: 경로 4 (PaymentMiniWindow)와 공유하기 위해 공통 lib으로 이전.
// loadAutoBindContext, buildAutoBindValues, AutoBindContext 등은 import에서 가져옴.

// ─── HTML 양식 인쇄 페이지 생성 ───

/**
 * HTML/CSS 기반 양식의 인쇄용 페이지 div를 생성.
 * T-20260514-foot-FORM-CLARITY-REWORK
 * T-20260521-foot-CLINIC-INFO-SYNC: HTML 양식에도 원내 도장 이미지 오버레이 추가.
 *   PNG/JPG 경로(buildPageHtml)와 동일 방식. .page 컨테이너가 position:relative이므로
 *   absolute 오버레이 정상 동작. onerror 핸들러로 이미지 미존재 시 graceful 처리.
 */
function buildHtmlPageHtml(
  template: FormTemplate,
  fieldValues: Record<string, string>,
  copyLabel?: string,
): string {
  const htmlTpl = getHtmlTemplate(template.form_key);
  if (!htmlTpl) return '';
  // T-20260601-foot-RX-QR-LABEL (현장 확정 스코프, MSG-20260601-180722-8kgj / 181005-tdlp):
  //   QR 가림의 원인은 RX-DUAL이 우측 상단(top:10px;right:10px)에 추가한 absolute 오버레이 박스뿐.
  //   → 그 오버레이 박스만 제거하고, 중앙 상단 {{rx_copy_label}}(약국보관용/환자보관용) 구분 라벨은
  //   2장 출력 식별 표식으로 보존한다(현장 "중앙 상단 라벨 절대 제거하지 말 것").
  //   2장 출력(RX-DUAL)·QR 자동삽입(8FIX) 무파괴.
  // T-20260718-foot-RXPRINT-FORMAT-ADJUST (항목1): 교부번호 표시 분리(display-only) — 저장 issue_no 불변,
  //   렌더 직전에만 '20260718 제 000025 호'로 재조립. splitIssueNoForDisplay 는 비-rx/미채번 시 no-op.
  const boundValues =
    template.form_key === 'rx_standard'
      ? splitIssueNoForDisplay({ ...fieldValues, rx_copy_label: copyLabel ?? '약국보관용' })
      : fieldValues;
  const bound = bindHtmlTemplate(htmlTpl, boundValues);
  const isLandscape = template.form_key === 'bill_detail';
  // T-20260601-foot-DOC-PRINT-8FIX AC-1: 우하단 고정 도장 오버레이 제거.
  //   직전 7FIX는 {{doctor_seal_html}}(의사 성명 근방)만 추가하고 이 레거시 오버레이를
  //   존치 → 현장 출력에 도장이 여전히 우하단에 찍히는 "재발"의 근본 원인.
  //   직인은 각 양식 {{doctor_seal_html}}(의사/대표자 성명 근방)로 일원화한다.
  // T-20260601-foot-RX-QR-LABEL: 우측 상단 보관용 오버레이 박스(top:10px;right:10px)는 복원하지
  //   않는다 — 8FIX QR(72px 셀)을 가리던 주범. 구분 표식은 위 중앙 {{rx_copy_label}}이 담당.
  return `<div class="page${isLandscape ? ' page-landscape' : ''}">
  ${bound}
</div>`;
}

// ─── T-20260721-foot-BILLDETAIL-DIAGCODE-ADD (AC-5): 상병 토큰 주입 공용 헬퍼 ───
//   진료비 세부산정내역(bill_detail)·처방전 등에 상병(상병코드·상병명) 토큰을 3경로 대칭 주입한다.
//   기존 batchDiagItems(일괄출력)·issueDiagItems(단일/재출력=IssueDialog) 이원 로직을 단일 SSOT 로
//   통합 → 경로 간 배선 divergence 재발 차단(현장: 일괄엔 나오고 단일엔 공란 클래스).
//   소스 규칙 불변(DIAGCODE-BLANK 교훈 계승): service_charges(category_label='상병') 우선 →
//   check_in_services(상병) 폴백. 둘 다 없으면 기존 값(autobind) 보존. 빈 medical_charts 미참조.
//   미도달 시 diag_code_N/diag_name_N 미치환 → bindHtmlTemplate 가 공란 렌더(회귀 0·플레이스홀더 노출 0).
function applyDiagTokens(
  values: Record<string, string>,
  chargesDiag: { code: string; name: string }[],
  fallbackDiag: { code: string; name: string }[],
): void {
  const diagItems = chargesDiag.length > 0 ? chargesDiag : fallbackDiag;
  if (diagItems.length > 0) {
    // 기존 diag_code_N 키 초기화 (regression 방지 — 이전 방문/구값 잔존 차단)
    delete values.diag_code_1; delete values.diag_name_1;
    delete values.diag_code_2; delete values.diag_name_2;
    diagItems.forEach((item, idx) => {
      const n = idx + 1;
      values[`diag_code_${n}`] = item.code;
      values[`diag_name_${n}`] = item.name;
    });
  }
  // 행 가시성 (상병 0건이면 auto-bind 기존값 기준)
  const count = diagItems.length > 0
    ? diagItems.length
    : (values.diag_code_2 ? 2 : values.diag_code_1 ? 1 : 0);
  values['diag_row_3_style'] = count >= 3 ? '' : 'display:none';
  values['diag_row_4_style'] = count >= 4 ? '' : 'display:none';
  const extra = diagItems.slice(2).map((i) => i.code).filter(Boolean);
  values['diag_extra_codes_html'] = extra.length > 0
    ? extra.map((c) => `<br>${c}`).join('') : '';
}

// ─── JPG 인쇄 HTML 생성 ───

/**
 * 단일 양식의 인쇄용 HTML page div를 생성한다.
 * HTML 양식이면 이미지 없이 HTML/CSS로, 나머지는 IMG 오버레이 방식.
 */
function buildPageHtml(
  template: FormTemplate,
  fieldValues: Record<string, string>,
  imgUrl: string,
): string {
  // ── HTML/CSS 디지털 양식 분기 (T-20260514-foot-FORM-CLARITY-REWORK) ──
  if (template.template_format === 'html' || isHtmlTemplate(template.form_key)) {
    return buildHtmlPageHtml(template, fieldValues);
  }

  const overlayHtml =
    template.field_map.length > 0
      ? template.field_map
          .map((f) => {
            const val = fieldValues[f.key] ?? '';
            if (!val) return '';
            const style = [
              'position:absolute',
              `left:${f.x}px`,
              `top:${f.y}px`,
              f.w ? `width:${f.w}px` : '',
              f.h ? `height:${f.h}px` : '',
              `font-size:${f.font ?? 14}px`,
              "font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif",
              'color:#000',
              'line-height:1.4',
              'white-space:pre-wrap',
            ]
              .filter(Boolean)
              .join(';');
            return `<div style="${style}">${val}</div>`;
          })
          .join('\n')
      : `<div style="position:absolute;bottom:20px;left:20px;background:rgba(255,245,157,0.9);padding:8px 12px;border-radius:4px;font-size:13px;color:#333;">
           ⚠ 좌표 미설정 — 원본 양식만 표시됩니다.
         </div>`;

  // T-20260601-foot-DOC-PRINT-8FIX REOPEN2 AC-1: 이미지(좌표 오버레이) 양식 경로의 우하단 고정
  //   도장 오버레이 제거 — 직인은 doctor_seal_html로 일원화. (HTML 양식은 위에서 분기되어
  //   여기 도달하지 않음. bottom:52px 오버레이 클래스를 전 출력경로에서 전수 소거 — planner #2.)
  // T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT: 레거시 IMG-오버레이 마커(page-img). 이 양식은
  //   field_map x/y 가 A4 전폭(210mm) page 기준 px 라 콘텐츠박스 축소 시 좌표 어긋남 → openBatchPrintWindow
  //   에서 page-img 감지 시 기존 @page margin:0 / .page 210×297mm 전폭 모델을 그대로 유지(불변).
  return `<div class="page page-img">
  <img src="${imgUrl}" alt="${template.name_ko}" />
  ${overlayHtml}
</div>`;
}

/** 여러 page div를 하나의 인쇄 창으로 출력
 * AC-5: forceLandscape=true 시 @page { size: A4 landscape } 적용 (진료비세부산정내역 전용).
 * landscape 양식은 별도 창으로 분리하여 portrait 페이지에 영향 없이 출력.
 */
function openBatchPrintWindow(
  pages: string[],
  title: string,
  forceLandscape = false,
): Window | null {
  // T-20260629-foot-DOCOUTPUT-PRINT-CENTER-LAYOUT: 출력물 중앙·여백 배치 전면 재검토.
  //   [근본원인] 직전 모델은 .page 를 A4 전폭(210/297mm) full-bleed + @page margin:0 으로 깔고 양식(form-wrap)을
  //   margin:auto 로 CSS 중앙정렬했다. 그러나 실제 프린트 엔진은 전폭 page 가 인쇄가능영역(기본여백 적용 시
  //   ~190mm)을 초과하면 페이지 전체를 좌상단 앵커로 shrink-to-fit 축소 → 현장이 본 "위·좌측 쏠림 + 하단 공백".
  //   [수정] 중앙배치를 프린트 엔진의 @page 물리 여백이 직접 수행하게 한다. @page margin:12mm 10mm →
  //   콘텐츠박스(A4-여백 = 190×273 / 277×186mm)가 엔진에 의해 시트 중앙에 배치되고, 박스가 인쇄가능영역
  //   안에 들어와 축소 자체가 사라진다(좌우 10mm·상하 12mm 대칭). 양식 wrap 은 이 박스를 채운다(자체 page 여백 0).
  //   [IMG-오버레이 격리] field_map px 좌표가 210mm page 기준인 레거시(page-img)는 좌표 어긋남 방지를 위해
  //   기존 @page margin:0 / 전폭 .page 모델을 그대로 유지(불변).
  const isLegacyImg = pages.some((p) => p.includes('page-img'));
  let styleBlock: string;
  if (isLegacyImg) {
    const pageRule = forceLandscape
      ? '@page { size: A4 landscape; margin: 0; }'
      : '@page { size: A4 portrait; margin: 0; }';
    const pageWidth  = forceLandscape ? '297mm' : '210mm';
    const pageHeight = forceLandscape ? '210mm' : '297mm';
    styleBlock = `
  ${pageRule}
  body { margin: 0; padding: 0; }
  .page {
    position: relative;
    width: ${pageWidth};
    min-height: ${pageHeight};
    overflow: hidden;
    page-break-after: always;
  }
  .page-landscape { width: 297mm; min-height: 210mm; }
  .page img:first-child { width: 100%; height: 100%; object-fit: contain; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page:last-child { page-break-after: avoid; }
  }`;
  } else {
    // HTML 양식(L-006 12종) — 프린트 엔진 @page 물리 여백으로 중앙 배치(축소 없음).
    // T-20260629-foot-DOCPRINT-CENTER-ALIGN(REOPEN/AC-5): 현장 2차 — 출력물이 아직 위로 쏠림.
    //   상단 여백 12mm→30mm(약 +68px ≈ 엔터 4~5줄) 로 키워 콘텐츠를 시트에서 더 아래로 배치.
    // T-20260629-foot-DOCPRINT-CENTER-ALIGN(REOPEN/AC-6): 현장 3차 — 2차(30mm)가 살짝 과함.
    //   상단 여백 30mm→23mm(약 -7mm ≈ 2줄↑) 미세 상향 재조정. 하단 12mm·좌우 10mm 불변.
    //   하단은 12mm 유지(클립 방지). 콘텐츠박스 = A4 - (좌우10·상23·하12) → portrait 190×262mm / landscape 277×175mm.
    // T-20260702-foot-DOCPRINT-BROWSERHEADER-REMOVE: 브라우저 window.print() 기본 헤더 2종
    //   (좌상단 인쇄일시 · 우상단 document.title="서류 출력 …") 완전 제거.
    //   [RC] 크롬은 @page margin 이 0 보다 크면 그 여백 박스에 인쇄일시/제목을 자동 삽입한다.
    //        직전 CENTER-ALIGN 모델이 중앙배치를 @page margin(30 10 12) 로 수행 → 그 여백이 헤더 캔버스가 됨.
    //   [수정] @page margin:0 (여백 박스 소멸 → 헤더 삽입 불가) + 동일 물리 여백을 .page padding 으로 이관.
    //        box-sizing:border-box + 전폭(210/297mm) .page → 콘텐츠박스 190×262 / 277×175mm(AC-6) 로 물리 위치 불변
    //        (legacy-img 분기가 이미 @page:0 + 전폭 210mm 로 축소 없이 프로덕션 검증됨 → 중앙배치 회귀 없음).
    const pageRule = forceLandscape
      ? '@page { size: A4 landscape; margin: 0; }'
      : '@page { size: A4 portrait; margin: 0; }';
    const pageW = forceLandscape ? '297mm' : '210mm';
    const pageH = forceLandscape ? '210mm' : '297mm';
    styleBlock = `
  ${pageRule}
  html, body { margin: 0; padding: 0; }
  .page {
    box-sizing: border-box;
    position: relative;
    width: ${pageW};
    min-height: ${pageH};
    padding: 23mm 10mm 12mm; /* 상단여백 AC-6 30→23mm(2줄↑). 구 @page 물리여백을 콘텐츠 패딩으로 이관(브라우저 헤더 제거) */
    overflow: visible;
    page-break-after: always;
  }
  .page-landscape { box-sizing: border-box; width: 297mm; min-height: 210mm; padding: 23mm 10mm 12mm; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    /* AC-1: 마지막 페이지 빈 페이지 방지 */
    .page:last-child { page-break-after: avoid; }
  }`;
  }
  const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${title}</title>
<style>${styleBlock}</style>
</head><body>
${pages.join('\n')}
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return null;
  w.document.write(html);
  w.document.close();
  w.focus();

  // 모든 img(배경 템플릿 + 도장 포함) 로드 완료 후 인쇄
  // 첫 번째 img만 대기하던 기존 로직을 수정 — T-20260515-foot-STAMP-PRINT-BUG
  const images = w.document.querySelectorAll('img');
  if (images.length > 0) {
    Promise.all(
      Array.from(images).map(
        (img) =>
          new Promise<void>((resolve) => {
            if ((img as HTMLImageElement).complete) {
              resolve();
            } else {
              (img as HTMLImageElement).onload = () => resolve();
              (img as HTMLImageElement).onerror = () => resolve(); // 로드 실패해도 블락 안 함
            }
          }),
      ),
    ).then(() => w.print());
  } else {
    setTimeout(() => w.print(), 600);
  }
  return w;
}

// ─── 메인 컴포넌트 ───

export function DocumentPrintPanel({ checkIn, onUpdated, altStatus = false, historyAtTop = false }: Props) {
  const { profile } = useAuth();
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<FormTemplate | null>(null);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  // staff.id (issued_by FK — profile.id ≠ staff.id, user_id 경유 조회)
  const [staffId, setStaffId] = useState<string | null>(null);
  // T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN: 서류 출력 시 '진료 원장님'을 상시 드롭다운으로 선택.
  //   선택값(selectedDoctorName)은 HTML 출력경로 2곳(일괄출력 buildHtmlPageHtml / 영수증 재발급)의
  //   의사 성명(+도장) 바인딩에 공통 반영된다. 원장 4분 진료체계 도입 전 조기 적용.
  const [selectedDoctorName, setSelectedDoctorName] = useState<string>('');
  // T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED: 치료테이블에서 지정한 진료의(기본 서명자).
  //   지정 진료의를 드롭다운 기본 선택으로 → 서류 출력에 자동 반영(사용자는 여전히 변경 가능).
  const [treatingDoctorName, setTreatingDoctorName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadTreatingDoctorName(checkIn).then((n) => { if (!cancelled) setTreatingDoctorName(n); });
    return () => { cancelled = true; };
  }, [checkIn.id, checkIn.treating_doctor_id]);

  // ── T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC (reopen 2026-07-19) ──
  //   달력 '빨간날' 소스(clinic_events event_type='holiday'). 일괄출력(handleBatchPrint)에서 야간·공휴일
  //   가산 자동판정에 사용. IssueDialog(미리보기·단일출력)의 동일 로더를 부모에 미러 — reopen 전에는
  //   이 로더가 IssueDialog에만 있어 일괄출력 경로가 가산을 못 붙였다(preview OK / print FAIL divergence).
  //   ※ 법정공휴일·일요일은 detectSurchargeKind 내부에서 판정하므로 clinic_events 미로드여도 일요일 가산은 동작.
  const [batchHolidayDateSet, setBatchHolidayDateSet] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('clinic_events')
        .select('event_date')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('event_type', 'holiday');
      if (cancelled || error || !data) return;
      setBatchHolidayDateSet(new Set(data.map((r) => String(r.event_date))));
    })();
    return () => { cancelled = true; };
  }, [checkIn.clinic_id]);

  // ── 진료비 영수증 (T-20260509-foot-CHART1-LAYOUT-REAPPLY) ──
  const [invoiceDocs, setInvoiceDocs] = useState<InvoiceDoc[]>([]);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  // ── 진료비 영수증 — 결제 데이터 체크박스 (T-20260519-foot-RECEIPT-REISSUE) ──
  const [paymentItems, setPaymentItems] = useState<PaymentItem[]>([]);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<Set<string>>(new Set());

  // T-20260522-foot-ALT-BADGE AC-6: 활성 패키지 페치 — 레이저코드 호환성 검증용
  const [activePackage, setActivePackage] = useState<ActivePackageInfo | null>(null);
  useEffect(() => {
    if (!checkIn.package_id) { setActivePackage(null); return; }
    supabase
      .from('packages')
      .select('heated_sessions, unheated_sessions, package_name')
      .eq('id', checkIn.package_id)
      .maybeSingle()
      .then(({ data }) => setActivePackage(data ?? null));
  }, [checkIn.package_id]);
  const [receiptReissuePrinting, setReceiptReissuePrinting] = useState(false);

  // T-20260608-foot-DOC-REISSUE-SYNC: 부모 발행 경로(영수증 재발급 PATH-3 / 일괄출력)도 IssueDialog(단건)와
  //   동일하게 PMW(PATH-4) 빌링 폴백을 적용하기 위한 소스. service_charges 미기록 시에만 check_in_services
  //   기반으로 폴백(무파괴 — service_charges 존재 시 기존 동작 불변). 이전 세션이 참조만 추가하고 부모 스코프에
  //   상태를 선언하지 않아 빌드가 깨졌던 것을 복원.
  const [serviceItems, setServiceItems] = useState<ServiceChargeItem[]>([]);
  const [footBillingItems, setFootBillingItems] = useState<FootBillingItem[]>([]);
  const [customerInsuranceGrade, setCustomerInsuranceGrade] = useState<InsuranceGrade | null>(null);

  // 방문일 기준 근무원장님 목록 (T-20260502-foot-DUTY-ROSTER)
  const visitDate = checkIn.checked_in_at
    ? format(new Date(checkIn.checked_in_at), 'yyyy-MM-dd')
    : format(new Date(), 'yyyy-MM-dd');
  const { data: dutyDoctors = [] } = useDutyDoctors(checkIn.clinic_id, visitDate);

  // T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN: '진료 원장님' 드롭다운 후보.
  //   1순위 = 진료일 근무 로스터(dutyDoctors, duty_roster role=director/doctor). 하드코딩 금지·실시간 연동.
  //   폴백 = 근무캘린더 미설정 시 원장 마스터(staff active director) — 드롭다운이 근거 없이 비지 않도록 보강.
  //   마스터 이름은 clinic_doctors.name 매칭으로 도장/면허가 붙는다(loadAutoBindContext).
  //   NB: foot CRM staff.role CHECK 8종에 'doctor'는 없고 원장=‘director’. 4분 진료체계도 director 4명으로
  //   확장되므로 director 만 조회한다(하드코딩 아님 — 실시간 staff 조회, 확장 자동 반영).
  const [masterDoctors, setMasterDoctors] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (dutyDoctors.length > 0) { setMasterDoctors([]); return; }
    let cancelled = false;
    supabase
      .from('staff')
      .select('id, name')
      .eq('clinic_id', checkIn.clinic_id)
      .eq('role', 'director')
      .eq('active', true)
      .order('name')
      .then(({ data }) => {
        if (!cancelled) setMasterDoctors((data ?? []) as { id: string; name: string }[]);
      });
    return () => { cancelled = true; };
  }, [dutyDoctors.length, checkIn.clinic_id]);

  // T-20260709-foot-CUSTCHART-CLOSE-BTN-ERROR RC: staff/duty_roster 의 name 이 NULL 인 원장 행이
  //   섞이면 doctorOptions[0].name=null → selectedDoctorName=null → effectiveDoctorName.trim() 에서
  //   TypeError(null.trim) → DocumentPrintPanel 렌더 crash → 고객차트 닫기 시 하위 Outlet 에러바운더리.
  //   이름 없는 원장은 서류 서명 주체가 될 수 없으므로 옵션에서 제외 + string 강제(null 유입 원천 차단).
  const baseDoctorOptions: { id: string; name: string; roster_type?: string }[] = (
    dutyDoctors.length > 0
      ? dutyDoctors.map((d) => ({ id: d.id, name: (d.name ?? '').trim(), roster_type: d.roster_type }))
      : masterDoctors.map((d) => ({ id: d.id, name: (d.name ?? '').trim() }))
  ).filter((o) => o.name.length > 0);
  // T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED: 치료테이블 지정 진료의가 근무/마스터 목록에 없어도
  //   서명자로 선택 가능하도록 옵션에 보강(additive) — 지정 의사가 그날 근무표에 없어도 서류엔 반영.
  const doctorOptionsBase: { id: string; name: string; roster_type?: string }[] =
    treatingDoctorName && !baseDoctorOptions.some((o) => o.name === treatingDoctorName)
      ? [{ id: `treating:${treatingDoctorName}`, name: treatingDoctorName }, ...baseDoctorOptions]
      : baseDoctorOptions;
  // T-20260719-foot-DOCREPRINT-DOCTOR-CONTENT-PERSIST: 재출력 프리필 소스 — 최초 발급 시점의 담당의.
  //   저장 스코프=예약(check_in) 단위. 최근 유효(무효 제외) 발행분 field_data 스냅샷
  //   (attending_doctor_name→doctor_name)에서 복원. submissions는 created_at DESC(load()) 정렬.
  //   ⚠ 기존 컬럼(form_submissions.field_data) 조회 재사용 — 신규 컬럼 없음(db_change=false).
  const savedDoctorName = submissions
    .filter((s) => s.status !== 'voided')
    .map((s) => (s.field_data?.attending_doctor_name || s.field_data?.doctor_name || '').trim())
    .find((n) => n.length > 0) ?? '';
  // 저장된 담당의가 근무/치료 목록에 없어도(다른 날 재출력 등) 자동 세팅되도록 additive 보강
  //   (T-20260713 UNLINKED 패턴 재사용, 신규 정책 없음). 이미 있으면 무주입.
  const doctorOptions: { id: string; name: string; roster_type?: string }[] =
    savedDoctorName && !doctorOptionsBase.some((o) => o.name === savedDoctorName)
      ? [{ id: `saved:${savedDoctorName}`, name: savedDoctorName }, ...doctorOptionsBase]
      : doctorOptionsBase;
  const doctorOptionsKey = doctorOptions.map((o) => o.name).join('|');

  // 옵션 로드/변경 시 기본 선택: 현재 선택이 옵션에 없으면 → 치료테이블 지정 진료의 우선, 없으면 첫 번째.
  //   옵션 0명이면 미선택(''). (T-20260713: 지정 진료의 기본화. 사용자 명시 선택은 보존.)
  useEffect(() => {
    if (doctorOptions.length === 0) { setSelectedDoctorName(''); return; }
    setSelectedDoctorName((prev) => {
      if (prev && doctorOptions.some((o) => o.name === prev)) return prev;
      if (treatingDoctorName && doctorOptions.some((o) => o.name === treatingDoctorName)) return treatingDoctorName;
      return doctorOptions[0].name;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorOptionsKey, treatingDoctorName]);

  // ── T-20260719-foot-DOCREPRINT-DOCTOR-CONTENT-PERSIST: 재출력 자동 세팅(프리필) ──
  //   AC2/AC3 — 이미 한 번 출력된 서류(이 예약의 발행 이력 존재)를 다시 열면 최초 발급 시점의
  //   (a)담당의 (b)선택 출력내용 항목을 선택 UI에 자동으로 채운다(재선택 불필요).
  //   최초 출력 전(이력 없음)엔 미발동 → 기존 선택 UI 그대로 노출(시나리오3 edge 포함).
  //   저장 스코프=예약(check_in) 단위(form_submissions.check_in_id). going-forward — 기존 발행분부터
  //   저장·조회(신규 컬럼/백필 없음, db_change=false). 자동 채운 값은 기존 팝업 편집동작 상속(별도 잠금 없음).
  //   checkIn.id당 1회만 적용 → 사용자가 자동세팅 후 바꾼 선택을 덮어쓰지 않는다.
  const prefillAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (prefillAppliedRef.current === checkIn.id) return;           // 이미 이 예약에 적용 — 재적용 금지
    if (submissions.length === 0 || templates.length === 0) return; // 이력 없음/템플릿 미로드 — 프리필 없음
    // 발행된(무효 제외) 서류의 form_key 집합 = 최초 선택 출력내용 항목 복원(template_id→form_key)
    const printedKeys = new Set<string>();
    for (const sub of submissions) {
      if (sub.status === 'voided') continue;
      const tpl = templates.find((t) => t.id === sub.template_id);
      if (tpl) printedKeys.add(tpl.form_key);
    }
    if (printedKeys.size === 0 && !savedDoctorName) return;         // 유효 스냅샷 미확보 — 다음 로드까지 대기
    prefillAppliedRef.current = checkIn.id;                          // 1회 적용 마킹
    if (printedKeys.size > 0) {
      setSelectedKeys((prev) => (prev.size > 0 ? prev : printedKeys)); // 사용자 선택 있으면 보존
    }
    if (savedDoctorName && doctorOptions.some((o) => o.name === savedDoctorName)) {
      setSelectedDoctorName(savedDoctorName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkIn.id, submissions, templates]);

  // T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN AC4: 출력 직전 원장 확정 가드.
  //   미선택/목록 0명이면 빈·잘못된 원장명이 의료·법적 서류에 찍히지 않도록 출력을 차단한다.
  // T-20260709-foot-CUSTCHART-CLOSE-BTN-ERROR: belt&suspenders — selectedDoctorName 이 어떤 경로로든
  //   null/undefined 로 세팅돼도 crash 하지 않도록 방어(?? '' 후 trim). 정상 문자열은 무영향.
  const effectiveDoctorName = (selectedDoctorName ?? '').trim();
  const resolveDoctorForPrint = (): string | null => {
    if (!effectiveDoctorName) {
      toast.error('진료 원장님을 선택해주세요. 근무 원장 정보가 없어 서류를 출력할 수 없습니다.');
      return null;
    }
    return effectiveDoctorName;
  };

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from('staff')
      .select('id')
      .eq('user_id', profile.id)
      .eq('clinic_id', checkIn.clinic_id)
      .eq('active', true)
      .maybeSingle()
      .then(({ data }) => setStaffId(data?.id ?? null));
  }, [profile?.id, checkIn.clinic_id]);

  const load = useCallback(async () => {
    const [tplRes, subRes, invRes, payRes] = await Promise.all([
      supabase
        .from('form_templates')
        .select('*')
        .eq('clinic_id', checkIn.clinic_id)
        .in('category', ['foot-service', 'insurance'])
        .eq('active', true)
        .order('sort_order'),
      supabase
        .from('form_submissions')
        .select('*')
        .eq('check_in_id', checkIn.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('insurance_receipts')
        .select('id, receipt_no, issue_date, total_amount, paid_amount, insurance_covered, non_covered, pdf_url, created_at')
        .eq('check_in_id', checkIn.id)
        .eq('receipt_type', 'detail')
        .order('created_at', { ascending: false }),
      // T-20260519-foot-RECEIPT-REISSUE: 결제 체크박스용 payments 조회
      supabase
        .from('payments')
        // T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX 결함B: ⑪ 납부박스 현금영수증 버킷 → cash_receipt_issued 필요.
        .select('id, amount, method, payment_type, created_at, cash_receipt_issued')
        .eq('check_in_id', checkIn.id)
        // T-20260721-foot-CHECKIN-RECEIPT-SOFTVOID-PHANTOM: fail-closed allow-list (부모 CHARTPAGE-SOFTVOID AC1 계승). 영수증=재무-법적 문서라 취소결제 표시가 곧 오표시. .neq 블랙리스트 재도입 금지
        .eq('status', 'active')
        .order('created_at'),
    ]);

    // T-20260522-foot-INS-DOC-PRINT: category별 fallback 병합
    // foot-service 없으면 FALLBACK_TEMPLATES, insurance 없으면 INSURANCE_FALLBACK_TEMPLATES
    const dbTpls = (tplRes.data ?? []) as FormTemplate[];
    const footDbTpls = dbTpls.filter((t) => t.category === 'foot-service');
    const insDbTpls  = dbTpls.filter((t) => t.category === 'insurance');
    setTemplates([
      ...(footDbTpls.length > 0 ? footDbTpls : FALLBACK_TEMPLATES),
      ...(insDbTpls.length  > 0 ? insDbTpls  : INSURANCE_FALLBACK_TEMPLATES),
    ]);
    setSubmissions((subRes.data ?? []) as FormSubmission[]);
    setInvoiceDocs((invRes.data ?? []) as InvoiceDoc[]);
    setPaymentItems((payRes.data ?? []) as PaymentItem[]);

    // T-20260608-foot-DOC-REISSUE-SYNC: 부모 발행 경로(영수증 재발급/일괄출력)의 빌링 폴백 소스 로드.
    //   serviceItems = service_charges 존재 여부 게이트(있으면 폴백 미발동 = 무파괴).
    //   footBillingItems/customerInsuranceGrade = service_charges 비었을 때 PMW(PATH-4)와 동일 산출용.
    const { data: scData } = await supabase
      .from('service_charges')
      .select('id, base_amount, copayment_amount, is_insurance_covered, service_id, service:services(name, service_code, hira_code, category_label)')
      .eq('check_in_id', checkIn.id);
    setServiceItems((scData ?? []).map((c) => {
      const svc = Array.isArray(c.service) ? c.service[0] : c.service;
      return {
        id: c.id as string,
        service_code: (svc as { service_code?: string | null } | null)?.service_code ?? null,
        name: (svc as { name?: string } | null)?.name ?? '(알 수 없음)',
        amount: (c.base_amount as number) ?? 0,
        copayment_amount: (c.copayment_amount as number | null) ?? null,
        hira_code: (svc as { hira_code?: string | null } | null)?.hira_code ?? null,
        is_insurance_covered: (c.is_insurance_covered as boolean) ?? false,
        category_label: (svc as { category_label?: string | null } | null)?.category_label ?? null,
      };
    }));

    const [fbItems, grade] = await Promise.all([
      loadFootBillingItems(checkIn.id, checkIn.clinic_id),
      // T-20260706-foot-DOCPRINT-FEEBREAKDOWN-INSURANCE-BLANK: grade null(신규방문 미입력) 시
      //   이 방문 service_charges 저장 등급으로 폴백 → 급여구분 붕괴 방지(신규출력=재출력 수렴).
      loadEffectiveInsuranceGrade(checkIn.customer_id, checkIn.id),
    ]);
    setFootBillingItems(fbItems);
    setCustomerInsuranceGrade(grade);
  }, [checkIn.id, checkIn.clinic_id, checkIn.customer_id]);

  useEffect(() => {
    load();
  }, [load]);

  // ── 권한 체크 ──
  // T-20260602-foot-PENCHART-REQROLE-PRINT-OMIT: canAccess 단일 소스를 formTemplates.canAccessFormTemplate로 통일.
  //   pen_chart는 therapist/staff도 인쇄 가능(임상차트). DB required_role 변경 없이 표시 조건만 보강.
  const userRole = profile?.role ?? '';
  const canAccess = (tpl: FormTemplate) => canAccessFormTemplate(tpl, userRole);

  // ── 분류 ──
  // T-20260616-foot-DOCPANEL-PENCHART-INSCLAIM-HIDE: 목록 소스 단일 지점 필터.
  //   여기서 한 번 제외하면 default/optional/insurance 3개 섹션에 일괄 반영(섹션별 누락 회귀 차단).
  //   templates 원본은 유지 → 발행 이력 라벨·영수증 재발급 find 등 표시 외 로직 무영향.
  const visibleTemplates = templates.filter(
    (t) => !DOC_PANEL_HIDDEN_FORM_KEYS.includes(t.form_key),
  );
  // T-20260620-foot-DOCLIST-ORDER-10: 결제미니창과 동일한 확정 10종 + 확정 순서로 단일 평면 목록.
  //   기존 기본/별도요청/보험 3섹션 분기 → 단일 리스트로 통합(두 화면 순서·항목수 일치).
  //   진료비 영수증 재발급 카드(insurance_receipts 기반)는 서류 발행 목록과 별개 유틸 → 하단 보존.
  // T-20260706-foot-DOCFORM-CATEGORY-RELABEL-ROLLBACK (A안): 확정 목록을 '제증명' 카테고리 그룹으로 노출
  //   (A안 확정 MSG-cosm: 예상외 3종=진료의뢰서·진료확인서 code/nocode 함께 표시 → 총 13종/11 form_key).
  //   '기타 서류' 그룹은 비어 렌더 생략. 순서·발급 동선·게이트 모두 보존, 표현만 그룹 헤더 추가.
  //   그룹 membership 권위 = formTemplates.groupDocList SSOT.
  const docListGroups = groupDocList(visibleTemplates);

  // ── T-20260620-foot-MEDDOC-DESK-PRINTONLY-DOCTOR-AUTHORED (B안) ──
  //   소견서(diag_opinion)·진단서(diagnosis) = 원장 발행본(opinion_doc, status='published')만 출력.
  //   원장 미작성 = 출력 카드 비활성(disabled). 작성 완료 = 활성 → 발행본 그대로 인쇄(데스크 본문 작성 불가).
  //   나머지 8종은 무게이트. 원장 작성 동선(OpinionDocTab)은 무관 → lock-out 위험 0.
  const { data: authoredMedDocs } = useAuthoredMedDocs(checkIn.clinic_id, checkIn.customer_id);
  const { data: medDocClinicHeader } = useClinicHeader(checkIn.clinic_id);
  const medDocGate = (formKey: string): MedDocGateInfo => {
    if (!isGatedMedDoc(formKey)) return null;
    const docType = medDocFormKeyToDocType(formKey);
    const doc: AuthoredMedDoc | undefined = authoredMedDocs?.byType?.[docType];
    return {
      authored: !!doc,
      onPrint: async () => {
        // T-20260721-foot-OPINIONDOC-DESK-BLANK (평행경로): checkIn 전달 → 공용 함수가
        //   loadAutoBindContext 로 환자정보·상병 토큰을 채운다(종전 이름만 표시 공란 해소).
        const ok = await printAuthoredMedDoc(formKey, doc, {
          patientName: checkIn.customer_name ?? null,
          clinicHeader: medDocClinicHeader ?? null,
          checkIn,
        });
        if (!ok) toast.error('팝업이 차단되었거나 발행본을 불러올 수 없습니다.');
      },
    };
  };

  // ── 선택 토글 ──
  const toggleSelect = (formKey: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(formKey)) next.delete(formKey);
      else next.add(formKey);
      return next;
    });
  };

  // ── 진료비 영수증 삭제 ──
  const deleteInvoice = async (id: string) => {
    if (!window.confirm('진료비 영수증을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('insurance_receipts').delete().eq('id', id);
    if (error) { toast.error('삭제 실패'); return; }
    toast.success('삭제됨'); load();
  };

  // ── 결제 체크박스 토글 (T-20260519-foot-RECEIPT-REISSUE) ──
  const togglePayment = (id: string) => {
    setSelectedPaymentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── 진료비 영수증 재발급 — 체크박스 선택 기반 (T-20260519-foot-RECEIPT-REISSUE) ──
  const handleReceiptReissue = async () => {
    if (selectedPaymentIds.size === 0) return;
    // T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN AC4: 영수증 재발급도 선택 원장 확정 후에만 진행.
    const resolvedDoctorName = resolveDoctorForPrint();
    if (!resolvedDoctorName) return;
    // T-20260710-foot-RRN-REGISTER-ERR-ISSUE-FROMCHART2 AC2: 미저장 2번차트 → 저장 확인 후 발급(구값 발급 방지).
    if (!(await ensureChartSavedBeforePublish())) return;
    setReceiptReissuePrinting(true);
    try {
      const selected = paymentItems.filter((p) => selectedPaymentIds.has(p.id));
      const paymentsTotal = selected.reduce((sum, p) => sum + (p.amount ?? 0), 0);

      // T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN: 선택 원장명(+도장)을 재발급 영수증 렌더에 반영.
      //   이전엔 override 없이 내부 자동해석(단일/폴백) → 드롭다운 선택이 무시되고 복수 근무 시 공란 위험.
      const autoValues = await loadAutoBindContext(checkIn, resolvedDoctorName);
      const billReceiptTpl = templates.find((t) => t.form_key === 'bill_receipt');

      const bindValues: Record<string, string> = { ...autoValues };

      // T-20260609-foot-RECEIPT-LASER-MISSING: 진료비 영수증(PATH-3 재발급) 합산을 결제분류(payments 단건 /
      //   package_payments 패키지)와 무관하게 '전체 진료 항목' 기준으로 수렴.
      //   회귀원: 기존엔 total_amount = 선택 payments 합산(= 실 결제액)만 박았다. RECEIPT-PKG-PAYCLASS(713cf54)
      //   이후 패키지 결제로 처리된 레이저는 payments 가 아닌 package_payments 에 들어가 결제 체크박스/합산에서
      //   빠짐 → 영수증 합계·소계·비급여에서 레이저가 누락되고 "실 결제 금액만" 표기되던 현장 보고와 정확히 일치.
      //   해소: PATH-4(PaymentMiniWindow)와 동일 SSOT(check_in_services→computeFootBilling.grandTotal)로 통일.
      //   레이저는 실제 수행 시술이라 check_in_services 에 항상 row 존재 → 결제 방식과 무관하게 전체 진료비 표기되고
      //   PATH-3/PATH-4 출력본이 일치(L-006 AC-3). bill_receipt 는 항목 리스트가 아닌 집계(소계/총계) 양식이므로
      //   total/insurance_covered/copayment/non_covered 를 전체 항목 기준으로 함께 맞춰 영수증 내부 정합도 유지(AC-1/4).
      //   무파괴: 진료 항목(check_in_services/service_charges) 미기록 구(舊) 데이터는 기존 동작(선택 결제 합산)으로 폴백.
      // T-20260611-foot-DOC-REISSUE-CONTENT-MISSING 근인: 폴백 소스가 비동기 load() state 의존 → 재발급 모달
      //   mount 직후 load() 완료 전 발급 시 빈값으로 영수증 합계 누락. state 비면 print 시점 fresh 조회로 결정적
      //   폴백(무파괴: 로드됐으면 state 재사용).
      const fbStale = footBillingItems.length > 0;
      const fbItems = fbStale
        ? footBillingItems
        : await loadFootBillingItems(checkIn.id, checkIn.clinic_id);
      const fbGrade = fbStale
        ? customerInsuranceGrade
        // T-20260706-foot-DOCPRINT-FEEBREAKDOWN-INSURANCE-BLANK: grade null 시 저장 등급 폴백.
        : await loadEffectiveInsuranceGrade(checkIn.customer_id, checkIn.id);
      const fb = fbItems.length > 0
        ? computeFootBilling(fbItems, fbGrade)
        : null;
      const treatmentTotal = fb
        ? fb.grandTotal
        : serviceItems.length > 0
          ? serviceItems.reduce((s, it) => s + (it.amount ?? 0), 0)
          : 0;

      if (treatmentTotal > 0) {
        bindValues.total_amount = formatAmount(treatmentTotal);
        bindValues.subtotal_amount = formatAmount(treatmentTotal);
        if (fb) {
          // 소계 급여/비급여 분해도 PATH-4와 동일하게 전체 항목 기준(레이저 포함)으로 맞춤.
          bindValues.insurance_covered = formatAmount(fb.liveBillingValues.insuranceCovered);
          bindValues.copayment = formatAmount(fb.liveBillingValues.copayment);
          bindValues.non_covered = formatAmount(fb.liveBillingValues.nonCovered);
          // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 영수증 '합계' = 본인부담금 + 비급여(공단 제외).
          //   공단부담(insurance_covered) 표시는 위에서 그대로 유지 — 합계 산식에서만 공단 제외.
          bindValues.receipt_total = formatAmount(
            fb.liveBillingValues.copayment + fb.liveBillingValues.nonCovered,
          );
          // T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT: 재발급 영수증도 항목별 그리드(공단/본인/비급여).
          //   세부산정내역과 동일 SSOT(buildFootBillDetailItems)로 항목별 집계 → 소계와 구조적 정합.
          const receiptBillItems = buildFootBillDetailItems(fb.pricingItems, autoValues.visit_date ?? '', {
            insuranceGrade: fbGrade,
            copaymentTotal: fb.copaymentTotal,
          });
          bindValues.fee_grid_html = buildBillReceiptFeeGridHtml(receiptBillItems);
        } else if (serviceItems.length > 0) {
          // 폴백: check_in_services 미기록 구 데이터 → service_charges 직결(bill_detail 폴백과 동일 규칙).
          // T-20260721-foot-BILLDETAIL-SVCCHARGE-FALLBACK-RENDER: 하드코드(covered?'이학요법료':'기타') →
          //   footBillDetailCategory 정식 매핑(진찰료/검사료/처치및수술료/기타)으로 이식(A안). primary 경로와 동일.
          //   codeItems(상병/처방약, price=0) 제외(B안) — primary(pricingItems) 대칭. amount=0 이라 합계 불변(무파괴).
          const fbItems2 = serviceItems
            .filter((item) => !isCodeItem(item))
            .map((item) => ({
              category: footBillDetailCategory(item, item.is_insurance_covered),
              amount: item.amount,
              count: 1,
              days: 1,
              is_insurance_covered: item.is_insurance_covered,
              copayment_amount: item.copayment_amount ?? undefined,
            }));
          fillBillItemCopayment(fbItems2, fbGrade);
          bindValues.fee_grid_html = buildBillReceiptFeeGridHtml(fbItems2);
          // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 폴백도 합계 = 본인부담금 + 비급여(공단 제외).
          //   fee_grid 행 합계와 동일 산식(Σcopay covered + Σ비급여)으로 산출 → 그리드 합계와 정합.
          const rtCopay = fbItems2
            .filter((i) => i.is_insurance_covered)
            .reduce((s, i) => s + (i.copayment_amount ?? 0), 0);
          const rtNonCov = fbItems2
            .filter((i) => !i.is_insurance_covered)
            .reduce((s, i) => s + i.amount, 0);
          bindValues.receipt_total = formatAmount(rtCopay + rtNonCov);
        }
      } else {
        // 진료 항목 미기록(구 데이터) — 기존 동작 보존: 선택한 결제 건 합산.
        bindValues.total_amount = formatAmount(paymentsTotal);
        // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 급여 분해 불가한 구 데이터 →
        //   실 결제액(paymentsTotal=환자 실납부액)으로 수렴(이미 공단 미포함).
        bindValues.receipt_total = formatAmount(paymentsTotal);
      }
      // T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT: 정적 그리드 제거로 fee_grid_html 미설정 시
      //   본문 공란 회귀 방지 — 항목 없어도 표준 빈 그리드 rows 를 명시 렌더.
      if (bindValues.fee_grid_html == null) {
        bindValues.fee_grid_html = buildBillReceiptFeeGridHtml([]);
      }
      // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 미설정 경로 방어 — 합계 공란 방지.
      //   실 결제액(환자 실납부, 공단 미포함)으로 수렴(placeholder 미매칭 시 빈칸 렌더 회귀 차단).
      if (bindValues.receipt_total == null) bindValues.receipt_total = formatAmount(paymentsTotal);

      // 출력
      // T-20260601-foot-DOC-PRINT-8FIX AC-1: 영수증 재발급 경로의 레거시 우하단 도장 오버레이 제거.
      //   직전 7FIX는 buildHtmlPageHtml 경로만 보고 이 재발급 경로의 오버레이를 존치 →
      //   현장에서 영수증 재발급 시 도장이 여전히 우하단에 찍히는 "재발"의 또 다른 원인이었음.
      //   직인은 bill_receipt 양식 내 {{doctor_seal_html}}(진료의사 성명 근방)로 일원화.
      const htmlTpl = getHtmlTemplate('bill_receipt');
      if (htmlTpl) {
        const bound = bindHtmlTemplate(htmlTpl, bindValues);
        const pageHtml = `<div class="page">${bound}</div>`;
        const w = openBatchPrintWindow([pageHtml], `진료비 영수증 재발급 — ${checkIn.customer_name}`);
        if (!w) toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
      }

      // form_submissions 이력 INSERT
      if (billReceiptTpl && staffId) {
        const now = new Date().toISOString();
        const { error: subErr } = await supabase.from('form_submissions').insert({
          clinic_id: checkIn.clinic_id,
          template_id: billReceiptTpl.id,
          check_in_id: checkIn.id,
          customer_id: checkIn.customer_id ?? null,
          issued_by: staffId,
          field_data: bindValues,
          diagnosis_codes: null,
          signature_url: null,
          status: 'printed',
          printed_at: now,
        });
        if (subErr) toast.error(`이력 저장 실패: ${subErr.message}`);
        else toast.success('영수증 재발급 완료');
      } else {
        toast.success('영수증 출력 완료');
      }

      load();
      onUpdated();
    } finally {
      setReceiptReissuePrinting(false);
    }
  };

  // ── 진료비 영수증 인쇄 ──
  const printInvoice = (doc: InvoiceDoc) => {
    // [SYNC: G-007] fmtAmt 로컬 중복 제거 → formatAmount(중앙함수) + '원' 교체
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>진료비 영수증 — ${checkIn.customer_name}</title>
<style>
  /* T-20260702-foot-DOCPRINT-BROWSERHEADER-REMOVE: @page margin:0 → 브라우저 자동 헤더(인쇄일시·제목) 제거.
     여백은 body padding 이 담당(콘텐츠 공백 유지). */
  @page{size:A4 portrait;margin:0}
  html,body{margin:0}
  body{font-family:'Malgun Gothic',sans-serif;padding:20mm;color:#222;font-size:13px}
  h2{text-align:center;margin-bottom:24px;font-size:18px}
  h3{border-bottom:2px solid #333;padding-bottom:6px;margin-bottom:12px;font-size:15px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  td,th{border:1px solid #ccc;padding:6px 10px;text-align:left}
  tr.total td{font-weight:bold;background:#f8f8f8}
  @media print{body{padding:10mm}}
</style></head><body>
<h2>오블리브 풋센터 — 진료비 영수증</h2>
<h3>진료비 영수증${doc.receipt_no ? ` #${doc.receipt_no}` : ''}</h3>
<table>
  <tr><td>발행일</td><td>${format(new Date(doc.issue_date), 'yyyy-MM-dd')}</td></tr>
  <tr><td>환자명</td><td>${checkIn.customer_name}</td></tr>
  <tr><td>급여 (공단+본인)</td><td>${formatAmount(doc.insurance_covered)}원</td></tr>
  <tr><td>비급여</td><td>${formatAmount(doc.non_covered)}원</td></tr>
  <tr class="total"><td>실제 납부액</td><td>${formatAmount(doc.paid_amount)}원</td></tr>
</table>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('팝업이 차단되었습니다'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };

  // ── 기본 프리셋 선택 ──
  const selectDefaultPreset = () => {
    const keys = templates
      .filter((t) => DEFAULT_PRESET_KEYS.includes(t.form_key) && canAccess(t))
      .map((t) => t.form_key);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
  };

  // ── 단건 카드 클릭 → 다이얼로그 ──
  const handleSelectTemplate = (tpl: FormTemplate) => {
    setSelectedTemplate(tpl);
    setIssueDialogOpen(true);
  };

  const handleIssued = () => {
    setIssueDialogOpen(false);
    setSelectedTemplate(null);
    load();
    onUpdated();
  };

  // ── 일괄 출력 ──
  const handleBatchPrint = async () => {
    const selectedTemplates = templates.filter((t) => selectedKeys.has(t.form_key));
    if (selectedTemplates.length === 0) return;

    // T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN AC4: 상시 드롭다운 선택 원장으로 확정.
    //   미선택/목록 0명이면 출력 차단(빈·잘못된 원장명 방지). 복수 근무 별도 다이얼로그 불필요.
    const resolvedDoctorName = resolveDoctorForPrint();
    if (!resolvedDoctorName) return;

    // T-20260710-foot-RRN-REGISTER-ERR-ISSUE-FROMCHART2 AC2: 미저장 2번차트 → 저장 확인 후 발급(구값 발급 방지).
    if (!(await ensureChartSavedBeforePublish())) return;

    setBatchPrinting(true);
    try {
      const autoValues = await loadAutoBindContext(checkIn, resolvedDoctorName);
      const isFallback = templates[0]?.id.startsWith('fallback-');

      // T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX 결함A: 신양식 급여 category remainder 토큰은
      //   야간가산 fold 이후(valuesFor)에 최종 aggregate 기준으로 계산해야 하므로(순서강제 §3.3),
      //   billItems 를 valuesFor 스코프에서 참조할 수 있게 hoist. 두 소스(check_in_services/service_charges 폴백)
      //   중 실제 채워진 것으로 아래에서 대입.
      let batchRnItems: Parameters<typeof applyBillReceiptNewCoveredTokens>[1] = [];

      // T-20260525-foot-INS-FIELD-BIND AC-3: service_charges 전건 로딩 (배치출력용)
      // - bill_detail/rx_standard items_html 주입 (기존)
      // - 상병코드(category_label='상병') → diag_code_N/diag_name_N 주입 (신규)
      // T-20260524-foot-INS-DOC-COPAY-LINK: copayment_amount 포함
      const { data: chargeItems } = await supabase
        .from('service_charges')
        .select('id, base_amount, copayment_amount, is_insurance_covered, service_id, service:services(name, service_code, hira_code, category_label)')
        .eq('check_in_id', checkIn.id);

      // T-20260611-foot-BILLDETAIL-CONSULTFEE-COPAY-REWORK: bill_detail 항목·합계 SSOT 를
      //   check_in_services(영수증 bill_receipt 와 동일 grandTotal)로 통일. service_charges 는 진찰료
      //   (AA154/AA254)·레이저 등 가격항목을 누락한 불완전 부분집합인 차트가 존재(박민석 bd814f22) →
      //   bill_detail 직결 시 진찰료 행 누락 + 합계 0/불일치. check_in_services 우선, service_charges 직결은
      //   미기록 구(舊) 데이터 폴백(무파괴). 상병코드 주입은 기존대로 service_charges 우선 유지(items SSOT 와 독립).
      // T-20260611-foot-DOC-REISSUE-CONTENT-MISSING: state 비면 print 시점 fresh 조회로 결정적 폴백.
      const fbStaleBatch = footBillingItems.length > 0;
      const fbItemsBatch = fbStaleBatch
        ? footBillingItems
        : await loadFootBillingItems(checkIn.id, checkIn.clinic_id);
      const fbGradeBatch = fbStaleBatch
        ? customerInsuranceGrade
        // T-20260706-foot-DOCPRINT-FEEBREAKDOWN-INSURANCE-BLANK: grade null 시 저장 등급 폴백.
        : await loadEffectiveInsuranceGrade(checkIn.customer_id, checkIn.id);
      const fbBatch = fbItemsBatch.length > 0 ? computeFootBilling(fbItemsBatch, fbGradeBatch) : null;
      // T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT: bill_receipt 도 SSOT billItems 필요
      //   (fee_grid_html 항목별 그리드). bill_receipt 단독 선택 시에도 billItems 빌드가 발화하도록 포함.
      const needsItems = selectedTemplates.some(
        (t) => t.form_key === 'bill_detail' || t.form_key === 'rx_standard'
          || t.form_key === 'bill_receipt'
          // T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN: 신양식도 총액/급여분해(computeFootBilling) 필요.
          || t.form_key === 'bill_receipt_new',
      );

      // T-20260525-foot-INS-FIELD-BIND AC-3 / T-20260526-DOC-DIAG-TRUNC: 상병코드 주입(service_charges 우선).
      // T-20260719-foot-RXPRINT-LAYOUT-4FIX AC-③: service_charges 에 상병이 없으면(결제미니창 PATH-4 는 선택 상병을
      //   check_in_services 에만 저장) fbItemsBatch(check_in_services) 상병으로 폴백 → 일괄출력 처방전에서도 표시.
      //   ⚠ chargeItems 가 아예 비어도(service_charges 무기록) 폴백이 동작하도록 가드 밖에서 독립 산출.
      //   두 소스 모두 없을 때만 medical_charts 기반 autoValues 유지(기존 동작 보존).
      // T-20260721-foot-BILLDETAIL-DIAGCODE-ADD (AC-5): 공용 헬퍼(applyDiagTokens)로 통일 — 단일/재출력과 대칭.
      const batchChargesDiag = (chargeItems ?? [])
        .map((c) => {
          const svc = Array.isArray(c.service) ? c.service[0] : c.service;
          return {
            code: (svc as { service_code?: string | null } | null)?.service_code ?? '',
            name: (svc as { name?: string } | null)?.name ?? '',
            category_label: (svc as { category_label?: string | null } | null)?.category_label ?? null,
          };
        })
        .filter((i) => i.category_label === '상병')
        .map((i) => ({ code: i.code, name: i.name }));
      const batchFallbackDiag = fbItemsBatch
        .filter((fb) => (fb.service.category_label ?? '') === '상병')
        .map((fb) => ({ code: fb.service.service_code ?? '', name: fb.service.name }));
      applyDiagTokens(autoValues, batchChargesDiag, batchFallbackDiag);

      if (chargeItems && chargeItems.length > 0) {
        const mappedItems = chargeItems.map((c) => {
          const svc = Array.isArray(c.service) ? c.service[0] : c.service;
          return {
            id: c.id as string,
            service_code: (svc as { service_code?: string | null } | null)?.service_code ?? null,
            name: (svc as { name?: string } | null)?.name ?? '(알 수 없음)',
            amount: (c.base_amount as number) ?? 0,
            copayment_amount: (c.copayment_amount as number | null) ?? null,
            hira_code: (svc as { hira_code?: string | null } | null)?.hira_code ?? null,
            is_insurance_covered: (c.is_insurance_covered as boolean) ?? false,
            category_label: (svc as { category_label?: string | null } | null)?.category_label ?? null,
          };
        });

        // T-20260719-foot-RXPRINT-LAYOUT-4FIX AC-③: 상병코드(질병분류기호) 주입은 위 가드 밖 batchDiagItems 로 통합
        //   (service_charges 우선 + check_in_services 폴백). 여기서는 items_html/금액만 처리.

        if (needsItems) {
          // rx_standard 항목 — service_charges 기반(기존 동작 유지).
          const rxItems = mappedItems.map((item) => ({
            name: item.name,
            // T-20260718-foot-RXPRINT-DRUGCODE-PREFIX: 서비스관리 등록 약 코드(services.service_code) 앞 표기.
            code: item.service_code,
            unit_dose: '1',
            daily_freq: '1',
            // T-20260606-foot-DOC-FIELD-MISSING-3 AC-5: 배치 경로는 per-item 입력 없음 → 공란(수기 기입).
            total_days: '',
            method: '',
          }));
          autoValues.rx_items_html = buildRxItemsHtml(rxItems);
          // bill_detail items: SSOT(check_in_services) 우선. fbBatch 없을 때만 service_charges 직결 폴백.
          if (!fbBatch) {
            // T-20260721-foot-BILLDETAIL-SVCCHARGE-FALLBACK-RENDER: 하드코드 → footBillDetailCategory 정식 매핑(A안) +
            //   codeItems(상병/처방약) 제외(B안). primary(pricingItems) 경로 대칭. amount=0 이라 total/비급여 합계 불변.
            const billItems = mappedItems
              .filter((item) => !isCodeItem(item))
              .map((item) => ({
                category: footBillDetailCategory(item, item.is_insurance_covered),
                date: autoValues.visit_date ?? '',
                code: item.service_code ?? item.hira_code ?? '',
                name: item.name,
                amount: item.amount,
                count: 1,
                days: 1,
                is_insurance_covered: item.is_insurance_covered,
                copayment_amount: item.copayment_amount ?? undefined,
              }));
            autoValues.items_html = buildBillDetailItemsHtml(billItems);
            // T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT: 영수증 항목별 그리드도 동일 billItems 로.
            autoValues.fee_grid_html = buildBillReceiptFeeGridHtml(billItems);
            // T-20260719-foot-BILLRECEIPT-NEWFORM-ITEMFIX AC-②: 신양식 비급여 category 분해(폴백=이학요법료/기타 → 전부 기타行).
            applyBillReceiptNewCategoryTokens(autoValues, billItems);
            // T-20260722 결함A: 급여 category remainder 토큰 소스(valuesFor 에서 post-surcharge 소비).
            batchRnItems = billItems;
            const total = mappedItems.reduce((s, item) => s + item.amount, 0);
            autoValues.total_amount = formatAmount(total);
            const nonCoveredTotal = mappedItems
              .filter((i) => !i.is_insurance_covered)
              .reduce((s, i) => s + i.amount, 0);
            autoValues.subtotal_noncovered = nonCoveredTotal.toLocaleString('ko-KR');
            autoValues.total_noncovered = nonCoveredTotal.toLocaleString('ko-KR');
            autoValues.subtotal_amount = autoValues.total_amount;
            // T-20260606-foot-DOC-FIELD-MISSING-3 AC-1/3: 계산서/청구서 비급여·공단부담금 보강.
            const liveCopay = mappedItems
              .filter((i) => i.is_insurance_covered)
              .reduce((s, i) => s + (i.copayment_amount ?? 0), 0);
            const liveInsCovered = mappedItems
              .filter((i) => i.is_insurance_covered)
              .reduce((s, i) => s + (i.amount - (i.copayment_amount ?? 0)), 0);
            applyBillingFallback(autoValues, {
              insuranceCovered: liveInsCovered,
              copayment: liveCopay,
              nonCovered: nonCoveredTotal,
            });
            // T-20260708-foot-BILLING-DOCFEE-INSAMOUNT-MISSING AC-3: 폴백(service_charges 직결) 경로도
            //   요약행 본인/공단 총계 주입. buildBillDetailItemsHtml per-item 산식(copayment_amount 존재 시만
            //   렌더)과 동일 기준(!= null 필터)으로 집계해 컬럼합과 정합.
            const billCopay = billItems
              .filter((i) => i.is_insurance_covered && i.copayment_amount != null)
              .reduce((s, i) => s + (i.copayment_amount ?? 0), 0);
            const billFund = billItems
              .filter((i) => i.is_insurance_covered && i.copayment_amount != null)
              .reduce((s, i) => s + Math.max(0, i.amount - (i.copayment_amount ?? 0)), 0);
            autoValues.subtotal_copayment = formatAmount(billCopay);
            autoValues.total_copayment = autoValues.subtotal_copayment;
            autoValues.subtotal_fund = formatAmount(billFund);
            autoValues.total_fund = autoValues.subtotal_fund;
            // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 계산서·영수증/세부산정내역 '합계' =
            //   급여 본인부담금 + 비급여(공단 제외). 표시된 본인부담금 총계(billCopay)+비급여 총계와 정합.
            // T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX AC-②③: 계 총액(절사 전)/끝처리 조정/합계(절사 후) 분리.
            {
              const payableB = billCopay + nonCoveredTotal;
              const { adjustment, roundedTotal } = computeBillDetailRounding(payableB);
              autoValues.detail_subtotal = formatAmount(payableB);
              autoValues.detail_rounding = formatAmount(adjustment);
              autoValues.detail_total = formatAmount(roundedTotal);
              autoValues.receipt_total = autoValues.detail_total;
            }
          }
        }
      }

      // bill_detail 항목·합계: check_in_services SSOT (영수증과 동일 grandTotal). chargeItems 유무 무관하게 우선.
      //   T-20260608-foot-DOC-PATH12-SYNC + 0cbbdc2 copayInfo 비례배분(진찰료 포함 급여 본인/공단) 재사용.
      if (fbBatch) {
        applyBillingFallback(autoValues, fbBatch.liveBillingValues);
        if (needsItems) {
          const billItems = buildFootBillDetailItems(fbBatch.pricingItems, autoValues.visit_date ?? '', {
            insuranceGrade: fbGradeBatch,
            copaymentTotal: fbBatch.copaymentTotal,
          });
          autoValues.items_html = buildBillDetailItemsHtml(billItems);
          // T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT: 영수증 항목별 그리드도 동일 SSOT billItems 로
          //   (세부산정내역과 구조적 정합 — 동일 항목·급여분류·copay 배분).
          autoValues.fee_grid_html = buildBillReceiptFeeGridHtml(billItems);
          // T-20260719-foot-BILLRECEIPT-NEWFORM-ITEMFIX AC-②: 신양식 처치/검사/기타 비급여 행 category 분해.
          applyBillReceiptNewCategoryTokens(autoValues, billItems);
          // T-20260722 결함A: 급여 category remainder 토큰 소스(valuesFor 에서 post-surcharge 소비). SSOT(check_in_services) 우선.
          batchRnItems = billItems;
          if (autoValues.rx_items_html == null) autoValues.rx_items_html = buildRxItemsHtml([]);
          if (fbBatch.grandTotal > 0) {
            autoValues.total_amount = formatAmount(fbBatch.grandTotal);
            autoValues.subtotal_amount = formatAmount(fbBatch.grandTotal);
          }
          if (fbBatch.nonCoveredTotal > 0) {
            autoValues.subtotal_noncovered = fbBatch.nonCoveredTotal.toLocaleString('ko-KR');
            autoValues.total_noncovered = fbBatch.nonCoveredTotal.toLocaleString('ko-KR');
          }
          // T-20260708-foot-BILLING-DOCFEE-INSAMOUNT-MISSING AC-3: 요약행 본인부담금/공단부담금 총계 주입.
          //   buildFootBillDetailItems(copayInfo)로 per-item copayment_amount 를 채웠으므로
          //   Σcopayment=copaymentTotal, Σfund=insuranceCovered 와 정확히 일치.
          autoValues.subtotal_copayment = formatAmount(fbBatch.copaymentTotal);
          autoValues.total_copayment = autoValues.subtotal_copayment;
          autoValues.subtotal_fund = formatAmount(fbBatch.liveBillingValues.insuranceCovered);
          autoValues.total_fund = autoValues.subtotal_fund;
          // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 계산서·영수증/세부산정내역 '합계' =
          //   급여 본인부담금 + 비급여(공단 제외). copaymentTotal(본인)+nonCoveredTotal(비급여) — 공단(insuranceCovered) 제외.
          // T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX AC-②③: 계 총액(절사 전)/끝처리 조정/합계(절사 후) 분리.
          {
            const payableB = fbBatch.copaymentTotal + fbBatch.nonCoveredTotal;
            const { adjustment, roundedTotal } = computeBillDetailRounding(payableB);
            autoValues.detail_subtotal = formatAmount(payableB);
            autoValues.detail_rounding = formatAmount(adjustment);
            autoValues.detail_total = formatAmount(roundedTotal);
            autoValues.receipt_total = autoValues.detail_total;
          }
        }
      } else if (needsItems && !(chargeItems && chargeItems.length > 0)) {
        // service_charges·check_in_services 모두 없을 때: bill_detail/rx_standard/bill_receipt 빈 rows 처리
        autoValues.items_html = buildBillDetailItemsHtml([]);
        autoValues.fee_grid_html = buildBillReceiptFeeGridHtml([]);
        autoValues.rx_items_html = buildRxItemsHtml([]);
        // T-20260708-foot-BILLING-DOCFEE-INSAMOUNT-MISSING AC-3: 항목 0건 → 요약행 총계 0 명시(공란 방지).
        autoValues.subtotal_copayment = '0';
        autoValues.total_copayment = '0';
        autoValues.subtotal_fund = '0';
        autoValues.total_fund = '0';
        // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 항목 0건 → 공단제외 합계도 0 명시(공란 방지).
        // T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX AC-②: 끝처리 조정도 0 명시.
        autoValues.detail_total = '0';
        autoValues.detail_subtotal = '0';
        autoValues.detail_rounding = '0';
        autoValues.receipt_total = '0';
      }

      // ── T-20260706-foot-SERIAL-RPC-AVVC-NOFIRE: 일괄 출력 연번호 발번 (단건 handlePrint 와 동형) ──
      //   [근인] 배치 경로(handleBatchPrint)는 issue_foot_doc_serial RPC 를 호출하지 않고 visit_no 도 조립하지
      //   않아 연번호 대상 양식(진료확인서=treat_confirm_code/nocode, 통원확인서=visit_confirm, 진단서=diagnosis)이
      //   {{visit_no}} 공란으로 인쇄됨. 현장은 이 두 양식을 배치로 출력 → "연번호 공란" 재확인.
      //   [수정] 단건 IssueDialog.handlePrint 와 동일: 연번호 대상(docSerialPrefix 매핑 + 차트번호 보유) 양식은
      //     ① form_submissions 선 INSERT → ② issue_foot_doc_serial(멱등) 발번 → ③ buildDocSerial 로 visit_no 조립
      //     → ④ per-template 바인딩값에 주입 + 발행이력 field_data 갱신. 인쇄본은 아래에서 valuesFor(t) 로 바인딩.
      //   ⚠ 발번대장 무결성 우선: INSERT/RPC/조립 실패 시 가짜 번호 미생성(공란 유지). 비-대상 양식은 종전대로
      //     뒤 일괄 INSERT 로 처리(serialIssuedTemplateIds 로 이중 INSERT 차단). RPC 는 기존 배포본 사용(DB 변경 0).
      const perTemplateValues = new Map<string, Record<string, string>>();
      const serialIssuedTemplateIds = new Set<string>();
      if (!isFallback && staffId) {
        // 연번호 {prefix}-{YYYYMMDD}-{차트번호 F-XXXX}-{NN} 구성요소인 차트번호 1회 로드(IssueDialog 와 동일 소스).
        let batchChartNo: string | null = null;
        if (checkIn.customer_id) {
          const { data: cust } = await supabase
            .from('customers')
            .select('chart_number')
            .eq('id', checkIn.customer_id)
            .maybeSingle();
          const cn = (cust?.chart_number as string | null | undefined) ?? null;
          batchChartNo = cn && String(cn).trim() ? String(cn).trim() : null;
        }
        const issueDateYmd = format(new Date(), 'yyyyMMdd');
        for (const t of selectedTemplates) {
          const eligible = !!docSerialPrefix(t.form_key) && !!batchChartNo;
          if (!eligible) continue;
          const { data: inserted, error: insErr } = await supabase
            .from('form_submissions')
            .insert({
              clinic_id: checkIn.clinic_id,
              template_id: t.id,
              check_in_id: checkIn.id,
              customer_id: checkIn.customer_id,
              issued_by: staffId,
              field_data: autoValues, // 발번 전 스냅샷 — RPC 성공 시 아래 visit_no 주입값으로 갱신
              diagnosis_codes: null,
              status: 'printed' as const,
              printed_at: new Date().toISOString(),
            })
            .select('id')
            .single();
          if (insErr || !inserted?.id) continue; // 선 INSERT 실패 → 뒤 일괄 INSERT 폴백(연번호 미발번)
          serialIssuedTemplateIds.add(t.id); // 이중 INSERT 차단(성공/발번실패 무관 — 행은 이미 존재)
          const { data: seq, error: rpcErr } = await supabase.rpc('issue_foot_doc_serial', {
            p_clinic_id: checkIn.clinic_id,
            p_form_submission_id: inserted.id,
          });
          if (rpcErr || typeof seq !== 'number') continue; // 발번 실패 → 공란 유지(가짜 번호 금지)
          const docSerial = buildDocSerial({
            formKey: t.form_key,
            chartNo: batchChartNo,
            dateYYYYMMDD: issueDateYmd,
            seq,
          });
          if (!docSerial) continue;
          const vals = { ...autoValues, visit_no: docSerial };
          perTemplateValues.set(t.id, vals);
          await supabase.from('form_submissions').update({ field_data: vals }).eq('id', inserted.id);
        }
      }
      // 연번호 발번 양식은 per-template 값(visit_no 주입)으로, 그 외는 공용 autoValues 로 바인딩.
      // ── T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC (reopen 2026-07-19, field-soak FAIL RC) ──
      //   가산 자동반영은 미리보기(allValues)에만 있고 이 일괄출력 경로엔 미배선이라 현장 인쇄물에 누락됐다.
      //   → form_key별 **복사본**에 SSOT 헬퍼를 적용(공유 autoValues 원본 무변경, bill_receipt_new↔bill_detail
      //   공유키 교차오염 차단). clinic_events 합집합·override 존중.
      //   (2026-07-19 exfb 포트 갭 close) 판정 기준 refDate = **진료일(checked_in_at)** — body canon
      //   visitDate=checked_in_at 미러. 출력 시점(now)이 아니라 진료 당시 요일·공휴일·야간을 판정해
      //   과거일 진료분을 나중에 출력해도 가산 정확(일요일 진료→월요일 출력 시에도 공휴일 가산 유지).
      const surchargeRefDate = resolveSurchargeRefDate(checkIn.checked_in_at, new Date());
      const surchargeIsCalHoliday = batchHolidayDateSet.has(toLocalDateStr(surchargeRefDate));
      // 일괄출력은 편집 UI가 없어 수동 override 없음 → 빈 집합(모든 대상 키 자동 folding).
      const noOverride = new Set<string>();
      // T-20260722-foot-BILLRECEIPT-MASTER-FIXES §1: ⑨ 이미 납부한 금액(선수금/패키지 차감분). 방문 단위 1회 로드 후 재사용.
      const batchAlreadyPaid = await loadAlreadyPaidAmount(checkIn.id, customerInsuranceGrade);
      const valuesFor = (t: FormTemplate): Record<string, string> => {
        const v = { ...(perTemplateValues.get(t.id) ?? autoValues) };
        applyNightHolidaySurcharge(
          v,
          t.form_key,
          surchargeIsCalHoliday,
          noOverride,
          surchargeRefDate,
          buildSurchargeDetailRowHtml,
        );
        // ── T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX (일괄출력 경로) ──
        //   ★야간가산 fold 이후(여기)에 신양식 급여 remainder·납부박스를 계산해 단건(IssueDialog allValues)과 대칭.
        if (t.form_key === 'bill_receipt_new') {
          // ⑧/⑩ 환자부담총액 10원 절사(FLOOR) — 단건 경로와 동일 SSOT(computeBillDetailRounding).
          const rawPatient = parseAmountStr(v.patient_amount);
          const { roundedTotal: patientFloored } = computeBillDetailRounding(rawPatient);
          if (rawPatient > 0) v.patient_amount = formatAmount(patientFloored);
          // 결함A: 급여 category remainder 토큰(최종 aggregate 기준 — 진찰료 흡수 방지).
          applyBillReceiptNewCoveredTokens(v, batchRnItems);
          // 결함B: ⑪ 납부박스 = payments 원장(status=active) 결제수단별 실수납(부모 로드분). 완납 가정 금지.
          //   MASTER-FIXES §1 ⑨ 선수금 차감분 + §2 refund 순액(paymentItems.payment_type).
          applyBillReceiptPaidBoxTokens(v, paymentItems, patientFloored, batchAlreadyPaid);
        }
        return v;
      };

      const htmlTemplates = selectedTemplates.filter((t) => t.template_format === 'html' || isHtmlTemplate(t.form_key));
      const jpgTemplates = selectedTemplates.filter((t) => t.template_format !== 'pdf' && t.template_format !== 'html' && !isHtmlTemplate(t.form_key));
      const pdfTemplates = selectedTemplates.filter((t) => t.template_format === 'pdf');

      // HTML/CSS 디지털 양식 — 한 창에 모아 인쇄 (T-20260514-foot-FORM-CLARITY-REWORK)
      // AC-5: bill_detail(진료비세부산정내역)은 landscape 전용 창으로 분리
      {
        const landscapeHtmlTpls = htmlTemplates.filter((t) => t.form_key === 'bill_detail');
        const portraitHtmlTpls  = htmlTemplates.filter((t) => t.form_key !== 'bill_detail');
        if (landscapeHtmlTpls.length > 0) {
          const pages = landscapeHtmlTpls.map((t) => buildHtmlPageHtml(t, valuesFor(t)));
          const w = openBatchPrintWindow(pages, `서류 일괄 출력 — ${checkIn.customer_name}`, true);
          if (!w) toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
        }
        if (portraitHtmlTpls.length > 0) {
          // T-20260526-foot-RX-PRINT-DUAL: rx_standard → 약국보관용 + 환자보관용 2장으로 확장
          const pages = portraitHtmlTpls.flatMap((t) =>
            t.form_key === 'rx_standard'
              ? [
                  buildHtmlPageHtml(t, valuesFor(t), '약국보관용'),
                  buildHtmlPageHtml(t, valuesFor(t), '환자보관용'),
                ]
              : [buildHtmlPageHtml(t, valuesFor(t))],
          );
          const w = openBatchPrintWindow(pages, `서류 일괄 출력 — ${checkIn.customer_name}`);
          if (!w) toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
        }
      }

      // JPG — 한 창에 모아 인쇄
      if (jpgTemplates.length > 0) {
        const pages = jpgTemplates.flatMap((t) => {
          const imgUrl = getTemplateImageUrl(t.form_key);
          if (!imgUrl) return [];
          return [buildPageHtml(t, valuesFor(t), imgUrl)];
        });

        if (pages.length > 0) {
          const w = openBatchPrintWindow(
            pages,
            `서류 일괄 출력 — ${checkIn.customer_name}`,
          );
          if (!w) {
            toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
          }
        }
      }

      // PDF — 탭별 순차 처리
      for (const t of pdfTemplates) {
        const pdfUrl = getTemplateImageUrl(t.form_key);
        if (!pdfUrl) continue;
        try {
          const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
          const bytes = await fetch(pdfUrl).then((r) => r.arrayBuffer());
          const pdfDoc = await PDFDocument.load(bytes);
          const pages = pdfDoc.getPages();
          const page = pages[0];
          const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

          if (t.field_map.length > 0) {
            const pdfVals = valuesFor(t);
            for (const f of t.field_map) {
              const val = pdfVals[f.key] ?? '';
              if (!val) continue;
              page.drawText(val, { x: f.x, y: f.y, size: f.font ?? 12, font, color: rgb(0, 0, 0) });
            }
          }

          const pdfBytes = await pdfDoc.save();
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (err) {
          toast.error(`PDF 처리 실패 (${t.name_ko}): ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
        }
      }

      // form_submissions 기록 (DB 시드 적용된 경우만)
      // staffId: issued_by = staff.id (≠ profile.id). 미조회 시 로그 생략하고 출력은 계속.
      // T-20260706-foot-SERIAL-RPC-AVVC-NOFIRE: 연번호 발번 양식(serialIssuedTemplateIds)은 위에서 이미
      //   INSERT 됨 → 여기서 제외해 이중 기록 방지. 나머지 비-연번호 양식만 종전대로 일괄 INSERT.
      if (!isFallback && staffId) {
        const rows = selectedTemplates
          .filter((t) => !serialIssuedTemplateIds.has(t.id))
          .map((t) => ({
            clinic_id: checkIn.clinic_id,
            template_id: t.id,
            check_in_id: checkIn.id,
            customer_id: checkIn.customer_id,
            issued_by: staffId,
            field_data: autoValues,
            diagnosis_codes: null,
            status: 'printed' as const,
            printed_at: new Date().toISOString(),
          }));

        if (rows.length > 0) {
          const { error } = await supabase.from('form_submissions').insert(rows);
          if (error) {
            toast.warning(`발행 기록 저장 실패: ${error.message}`);
          }
        }
      }

      toast.success(`${selectedTemplates.length}종 일괄 출력 요청`);
      setSelectedKeys(new Set());
      load();
      onUpdated();
    } finally {
      setBatchPrinting(false);
    }
  };

  const usingFallback = templates.length > 0 && templates[0].id.startsWith('fallback-');
  const selectedCount = selectedKeys.size;

  // T-20260623-foot-CHART2-VISITHIST-COMPACT-REISSUE ③: 발행 이력 블록 — 위치(상단/원위치)·열수(2열/1열)를
  //   historyAtTop prop으로 분기. 항목 렌더/onClick(템플릿 재선택) 로직은 동일(DOCOUTPUT 행리스트 무영향).
  const historyBlock = submissions.length > 0 ? (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" /> 발행 이력
      </span>
      <div className={historyAtTop ? 'grid grid-cols-2 gap-1.5' : 'space-y-1.5'}>
        {submissions.map((sub) => {
          const tpl = templates.find((t) => t.id === sub.template_id);
          return (
            <div
              key={sub.id}
              className="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer hover:bg-muted/40"
              onClick={() => {
                const t = templates.find((tt) => tt.id === sub.template_id);
                if (t) handleSelectTemplate(t);
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span>{FORM_META[tpl?.form_key ?? '']?.icon ?? '📄'}</span>
                <span className="font-medium truncate">{tpl?.name_ko ?? '알 수 없는 양식'}</span>
                <Badge
                  variant={sub.status === 'printed' ? 'default' : 'outline'}
                  className="text-[10px] px-1 shrink-0"
                >
                  {sub.status === 'printed' ? '출력' : sub.status === 'voided' ? '무효' : '임시'}
                </Badge>
              </div>
              <span className="text-muted-foreground shrink-0">
                {format(new Date(sub.created_at), 'MM/dd HH:mm')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  // T-20260623-foot-DOCOUTPUT-DUP-ITEM-REMOVE: 제거된 컬러카드의 3기능을
  //   '진료비 계산서·영수증'(bill_receipt) 행의 "영수증 관리" 펼침 패널로 이관.
  //   insurance_receipts·RPC·핸들러(handleReceiptReissue/printInvoice/deleteInvoice/setInvoiceOpen) 그대로 재사용 — 기능손실 0.
  const receiptManagePanel = (
    <div className="rounded-md border border-gray-200 bg-gray-50/70 p-2.5 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground">진료비 영수증 관리</span>
        {invoiceDocs.length > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0">
            {invoiceDocs.length}건
          </Badge>
        )}
      </div>

      {/* ① 결제기록 기반 재발급 (handleReceiptReissue) */}
      <div className="space-y-1">
        <div className="text-[10px] text-muted-foreground">결제기록 재발급</div>
        {paymentItems.length === 0 ? (
          <div className="text-[10px] text-muted-foreground py-0.5">
            이 방문의 결제 내역이 없습니다.
          </div>
        ) : (
          paymentItems.map((pay) => {
            const isSel = selectedPaymentIds.has(pay.id);
            const methodLabel =
              pay.method === 'card' ? '카드' :
              pay.method === 'cash' ? '현금' :
              pay.method === 'transfer' ? '이체' : (pay.method ?? '');
            return (
              <div
                key={pay.id}
                className={`flex items-center gap-1.5 rounded border px-2 py-1.5 cursor-pointer select-none transition-all
                  ${isSel ? 'border-teal-400 bg-teal-50 ring-1 ring-teal-300' : 'border-gray-200 bg-white hover:border-teal-200'}`}
                onClick={() => togglePayment(pay.id)}
              >
                <span className="text-teal-500 shrink-0">
                  {isSel ? (
                    <CheckSquare className="h-3.5 w-3.5" />
                  ) : (
                    <Square className="h-3.5 w-3.5 text-muted-foreground/50" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-foreground">{formatAmount(pay.amount)}</span>
                    {methodLabel && (
                      <Badge variant="outline" className="text-[9px] px-1 h-3.5 border-amber-300 text-amber-700">
                        {methodLabel}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {format(new Date(pay.created_at), 'MM/dd HH:mm')}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {selectedPaymentIds.size > 0 && (
          <button
            className="mt-1 w-full flex items-center justify-center gap-1 rounded border border-teal-400 bg-teal-50 py-1.5 text-[11px] font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50 transition-all"
            onClick={handleReceiptReissue}
            disabled={receiptReissuePrinting}
            data-testid="docprint-receipt-reissue-btn"
          >
            <Printer className="h-3 w-3" />
            {receiptReissuePrinting ? '출력 중…' : `재발급 (${selectedPaymentIds.size}건)`}
          </button>
        )}
      </div>

      {/* ② 기존 등록 영수증 보기·출력·삭제 (insurance_receipts) — 태블릿 도달성 위해 액션 상시 노출 */}
      {invoiceDocs.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-gray-200">
          <div className="text-[10px] text-muted-foreground">등록 영수증</div>
          {invoiceDocs.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between rounded border bg-white px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 flex-wrap">
                  <Badge variant="outline" className="text-[10px] px-1 h-4 border-amber-300 text-amber-700">영수증</Badge>
                  {doc.receipt_no && <span className="text-muted-foreground text-[10px]">#{doc.receipt_no}</span>}
                  <span className="text-muted-foreground text-[10px]">{format(new Date(doc.issue_date), 'MM/dd')}</span>
                </div>
                <div className="text-[10px] mt-0.5 text-muted-foreground">
                  납부 <span className="font-semibold text-foreground">{formatAmount(doc.paid_amount)}</span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => printInvoice(doc)}
                  className="h-7 w-7 flex items-center justify-center rounded text-teal-600 hover:bg-teal-50"
                  title="영수증 출력"
                  data-testid="docprint-receipt-print-btn"
                >
                  <Printer className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => deleteInvoice(doc.id)}
                  className="h-7 w-7 flex items-center justify-center rounded text-red-500 hover:bg-red-50"
                  title="영수증 삭제"
                  data-testid="docprint-receipt-delete-btn"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ③ 금액 직접 입력 + PDF 업로드 수기 등록 (InvoiceDialog) */}
      <button
        className="mt-1 w-full text-[11px] text-teal-600 hover:underline text-left flex items-center gap-0.5"
        onClick={() => setInvoiceOpen(true)}
        data-testid="docprint-receipt-manual-register-btn"
      >
        <Plus className="h-2.5 w-2.5" /> 금액 직접 입력·PDF 등록 →
      </button>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
          <FileText className="h-3 w-3" /> 서류 발행
        </span>
        <div className="flex items-center gap-1.5">
          {usingFallback && (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 gap-1">
              <AlertCircle className="h-3 w-3" /> 미리보기 모드
            </Badge>
          )}
        </div>
      </div>

      {/* T-20260623-foot-CHART2-VISITHIST-COMPACT-REISSUE ③: 서류재발급 모달 — 발행 이력을 상단(2열)으로 노출 */}
      {historyAtTop && historyBlock}

      {/* 근무원장님 배너 (T-20260502-foot-DUTY-ROSTER) */}
      {dutyDoctors.length > 0 ? (
        <div className="flex items-center gap-2 rounded-md bg-teal-50 border border-teal-200 px-2.5 py-1.5">
          <UserCheck className="h-3.5 w-3.5 shrink-0 text-teal-600" />
          <span className="text-xs text-teal-700">
            {visitDate} 근무:{' '}
            <span className="font-semibold">
              {dutyDoctors.map((d) => d.name).join(' · ')}
            </span>
            {dutyDoctors.length === 1 && (
              <span className="ml-1 text-teal-500">자동 세팅</span>
            )}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span className="text-xs text-amber-700">
            근무캘린더 미설정 — 원장님 이름을 직접 입력하거나{' '}
            <span className="font-medium">직원·공간 → 근무캘린더</span>에서 설정하세요.
          </span>
        </div>
      )}

      {/* T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN: '진료 원장님' 상시 드롭다운.
          선택 원장이 서류의 의사 성명(+도장)으로 출력됨 — 일괄출력·영수증 재발급 공통 반영.
          항목 = 진료일 근무 로스터(없으면 원장 마스터). 태블릿 큰 버튼 UX(h-11). */}
      <div className="flex items-center gap-2 rounded-md bg-white border border-teal-200 px-2.5 py-2">
        <UserCheck className="h-4 w-4 shrink-0 text-teal-600" />
        <Label className="text-xs font-semibold text-teal-700 shrink-0">진료 원장님</Label>
        {doctorOptions.length > 0 ? (
          <Select value={selectedDoctorName} onValueChange={setSelectedDoctorName}>
            <SelectTrigger
              className="h-11 flex-1 text-sm border-teal-300 focus:ring-teal-400"
              data-testid="docprint-doctor-select"
            >
              <SelectValue placeholder="원장님을 선택하세요" />
            </SelectTrigger>
            <SelectContent>
              {doctorOptions.map((d) => (
                <SelectItem key={d.id} value={d.name} className="text-sm py-2.5">
                  {d.name}
                  {d.roster_type && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {d.roster_type === 'regular' ? '근무' : '파트근무'}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="flex-1 text-xs text-amber-700">
            선택 가능한 원장님이 없습니다 — 근무캘린더/직원관리에서 원장님을 등록하세요. (미선택 시 서류 출력 차단)
          </span>
        )}
      </div>

      {/* T-20260522-foot-ALT-BADGE AC-13: ALT 레이저코드 차단/허용 상태 시각적 표시 */}
      {altStatus ? (
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
          <span className="text-xs text-red-700">
            <span className="font-semibold">ALT 활성 — 레이저코드 삽입 차단 중.</span>
            <span className="ml-1">보험 반려 대상 고객. 레이저 수가코드는 서류에 추가할 수 없습니다.</span>
          </span>
        </div>
      ) : null}

      {/* 일괄 출력 액션 바 */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="text-xs gap-1 border-teal-300 text-teal-700 hover:bg-teal-50"
          onClick={selectDefaultPreset}
        >
          <Layers className="h-3.5 w-3.5" />
          기본 서류 선택
        </Button>
        {selectedCount > 0 && (
          <Button
            size="sm"
            className="text-xs gap-1 bg-teal-600 hover:bg-teal-700"
            onClick={() => handleBatchPrint()}
            disabled={batchPrinting}
          >
            <Printer className="h-3.5 w-3.5" />
            {batchPrinting ? '출력 중…' : `일괄 출력 (${selectedCount}종)`}
          </Button>
        )}
      </div>

      {/* T-20260620-foot-DOCLIST-ORDER-10 + T-20260706-DOCFORM-CATEGORY-RELABEL-ROLLBACK(A안):
          서류 출력 — 확정 목록/순서를 '제증명' 카테고리 그룹으로 노출(A안: 예상외 3종 포함, 총 13종/11 form_key).
          '기타 서류' 그룹은 A안 하 비어 렌더 생략. 각 그룹은 TemplateSection 헤더로 구분(제증명 그룹 먼저).
          발급 동선·게이트·영수증 관리 펼침 보존. 그룹 membership 권위 = formTemplates.groupDocList SSOT. */}
      {docListGroups.length > 0 && (
        <div className="space-y-3" data-testid="docprint-doc-groups">
          {docListGroups.map((group) => (
            <TemplateSection
              key={group.label}
              title={group.label}
              templates={group.templates}
              submissions={submissions}
              selectedKeys={selectedKeys}
              canAccess={canAccess}
              onToggle={toggleSelect}
              onCardClick={handleSelectTemplate}
              medDocGate={medDocGate}
              /* T-20260719-foot-DOCLIST-RECEIPT-CONSOLIDATE-REORDER: 구 'bill_receipt' 목록 제거에 따라
                 "영수증 관리" 펼침 패널을 정본 행(신양식 bill_receipt_new='진료비 계산서·영수증')으로 이관.
                 재발급/등록/삭제 핸들러(handleReceiptReissue/printInvoice/deleteInvoice) 그대로 재사용 — 기능손실 0. */
              renderRowExtra={(formKey) => (formKey === 'bill_receipt_new' ? receiptManagePanel : null)}
            />
          ))}
        </div>
      )}

      {/* T-20260623-foot-DOCOUTPUT-DUP-ITEM-REMOVE: 하단 "진료비 영수증 재발급" 컬러카드 블록 제거.
          3개 고유기능(①결제기록 재발급 ②등록영수증 보기·출력·삭제 ③금액수기+PDF 수기등록)은
          상단 "서류 출력" 목록의 '진료비 계산서·영수증'(bill_receipt) 행 → "영수증 관리" 펼침으로 이관(receiptManagePanel). */}

      {/* 발행 이력 — T-20260623-foot-CHART2-VISITHIST-COMPACT-REISSUE ③: 서류재발급 모달(historyAtTop)에서는 상단으로 이동했으므로 여기선 미렌더 */}
      {!historyAtTop && historyBlock}

      {/* T-20260708-foot-DOCPRINT-DOCTOR-SELECT-DROPDOWN: 복수 원장 선택 다이얼로그 제거 —
          상단 '진료 원장님' 상시 드롭다운으로 대체(선택 다이얼로그 왕복 없이 즉시 출력). */}

      {/* 단건 발행 다이얼로그 */}
      {selectedTemplate && (
        <IssueDialog
          template={selectedTemplate}
          checkIn={checkIn}
          open={issueDialogOpen}
          staffId={staffId}
          dutyDoctors={dutyDoctors}
          altStatus={altStatus}
          activePackage={activePackage}
          paymentItems={paymentItems}
          onOpenChange={(o) => {
            setIssueDialogOpen(o);
            if (!o) setSelectedTemplate(null);
          }}
          onIssued={handleIssued}
        />
      )}

      {/* 진료비 영수증 등록 다이얼로그 (T-20260509-foot-CHART1-LAYOUT-REAPPLY) */}
      <InvoiceDialog
        checkIn={checkIn}
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        onSaved={() => { setInvoiceOpen(false); load(); onUpdated(); }}
      />
    </div>
  );
}

// ─── 섹션 컴포넌트 ───

// T-20260620-foot-MEDDOC-DESK-PRINTONLY: 소견서·진단서 게이트 디스크립터.
//   null = 무게이트(기존 동작). { authored, onPrint } = 게이트 대상(원장 발행본 출력만).
export type MedDocGateInfo = { authored: boolean; onPrint: () => void } | null;

function TemplateSection({
  title,
  templates,
  submissions,
  selectedKeys,
  canAccess,
  onToggle,
  onCardClick,
  medDocGate,
  renderRowExtra,
}: {
  title: string;
  templates: FormTemplate[];
  submissions: FormSubmission[];
  selectedKeys: Set<string>;
  canAccess: (t: FormTemplate) => boolean;
  onToggle: (key: string) => void;
  onCardClick: (t: FormTemplate) => void;
  /** T-20260620-foot-MEDDOC-DESK-PRINTONLY: form_key별 의료서류 출력 게이트. 미지정 시 무게이트. */
  medDocGate?: (formKey: string) => MedDocGateInfo;
  /** T-20260623-foot-DOCOUTPUT-DUP-ITEM-REMOVE: 특정 행(예: bill_receipt) 하단에 펼쳐지는 부가 패널(영수증 관리). null이면 토글 미표시. */
  renderRowExtra?: (formKey: string) => ReactNode;
}) {
  // 행별 부가 패널(영수증 관리) 펼침 상태 — 한 번에 하나만 펼침.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        {title}
      </div>
      {/* T-20260623-foot-DOCOUTPUT-COLORBOX-SIMPLIFY: 서류별 대형 컬러박스 카드 그리드 →
          결제미니창(PaymentMiniWindow Zone3)과 동일한 체크박스 1줄 행 리스트로 통일.
          서류 종류·순서·발행 로직·"상세 발행" 진입·게이트(소견서·진단서) 동작은 모두 보존(표현만 변경). */}
      <div className="flex flex-col gap-1" data-testid="docprint-doc-list">
        {templates.map((tpl) => {
          const meta = FORM_META[tpl.form_key];
          const hasCoords = tpl.field_map.length > 0;
          const accessible = canAccess(tpl);
          const isSelected = selectedKeys.has(tpl.form_key);
          const submissionCount = submissions.filter(
            (s) => s.template_id === tpl.id && s.status !== 'voided',
          ).length;

          // T-20260620-foot-MEDDOC-DESK-PRINTONLY (B안): 소견서·진단서 게이트.
          //   gate ≠ null 인 행은 체크박스/일괄선택/자유작성(IssueDialog) 동선을 쓰지 않는다.
          //   - 원장 미작성(!authored) = disabled(출력 불가, '원장 작성 필요' 안내).
          //   - 작성 완료(authored) = 행 클릭 → 발행본 그대로 인쇄(데스크 본문 작성 경로 없음).
          const gate = medDocGate?.(tpl.form_key) ?? null;
          const isGated = gate !== null;
          const clickable = accessible && (!isGated || gate.authored);

          // T-20260623-foot-DOCOUTPUT-DUP-ITEM-REMOVE: 행 하단 펼침 패널(영수증 관리).
          //   게이트 행은 부가 패널을 붙이지 않는다(소견서·진단서 등).
          const rowExtra = !isGated ? (renderRowExtra?.(tpl.form_key) ?? null) : null;
          const isExpanded = expandedKey === tpl.form_key;

          return (
            <div key={tpl.id} className="space-y-1">
            <div
              data-testid={`docprint-card-${tpl.form_key}`}
              data-gated={isGated ? 'true' : undefined}
              data-authored={isGated ? (gate.authored ? 'true' : 'false') : undefined}
              className={`
                flex items-center gap-1.5 rounded border px-2 py-2.5 sm:py-1.5 text-xs font-medium transition-all select-none w-full min-h-[44px] sm:min-h-0
                ${clickable ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}
                ${
                  isGated
                    ? gate.authored
                      ? 'bg-white text-teal-700 border-teal-300 hover:bg-teal-50'
                      : 'bg-gray-50 text-muted-foreground/60 border-gray-200'
                    : isSelected
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white text-muted-foreground border-gray-200 hover:border-teal-300 hover:text-teal-700'
                }
              `}
              onClick={() => {
                if (isGated) {
                  if (gate.authored) gate.onPrint();
                  return;
                }
                if (!accessible) return;
                onToggle(tpl.form_key);
              }}
            >
              {/* 좌측 상태 아이콘 — 무게이트: 체크박스 / 게이트: 🔒(미작성)·🖨️(작성완료) */}
              <span className="shrink-0">
                {isGated ? (
                  <span>{gate.authored ? '🖨️' : '🔒'}</span>
                ) : accessible ? (
                  isSelected ? (
                    <CheckSquare className="h-3.5 w-3.5" />
                  ) : (
                    <Square className="h-3.5 w-3.5 text-muted-foreground/50" />
                  )
                ) : null}
              </span>

              {/* 서류 아이콘 + 이름 (1줄) */}
              <span className="shrink-0">{meta?.icon ?? '📄'}</span>
              <span className="truncate flex-1">{tpl.name_ko}</span>

              {/* 발행 이력 건수 배지 (인라인) */}
              {submissionCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                  {submissionCount}건
                </Badge>
              )}

              {/* 좌표 미설정 경고 (무게이트만) */}
              {!hasCoords && !isGated && (
                <span className="text-[10px] text-amber-500 shrink-0">좌표 미설정</span>
              )}

              {/* T-20260623-foot-DOCOUTPUT-DUP-ITEM-REMOVE: 영수증 관리 펼침 토글 (rowExtra 보유 행만, 예: 진료비 계산서·영수증) */}
              {rowExtra && (
                <button
                  className={`shrink-0 text-[10px] font-semibold hover:underline px-1 ${isSelected ? 'text-white' : 'text-teal-600'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedKey(isExpanded ? null : tpl.form_key);
                  }}
                  data-testid={`docprint-receipt-manage-toggle-${tpl.form_key}`}
                  aria-expanded={isExpanded}
                >
                  영수증 관리 {isExpanded ? '▲' : '▾'}
                </button>
              )}

              {/* 우측 액션 — 게이트: 출력/작성필요 안내 / 무게이트: 상세 발행 진입 */}
              {isGated ? (
                gate.authored ? (
                  <button
                    className="shrink-0 text-[10px] font-semibold text-teal-600 hover:underline px-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      gate.onPrint();
                    }}
                    data-testid={`docprint-meddoc-print-${tpl.form_key}`}
                  >
                    원장 작성 완료 · 출력 →
                  </button>
                ) : (
                  <span
                    className="shrink-0 text-[10px] text-muted-foreground/80 px-1"
                    data-testid={`docprint-meddoc-locked-${tpl.form_key}`}
                  >
                    원장 작성 필요
                  </span>
                )
              ) : (
                /* 상세 발행 버튼 (행 우측) — 무게이트 서류 */
                <button
                  className={`shrink-0 text-[10px] font-semibold hover:underline px-1 ${isSelected ? 'text-white' : 'text-teal-600'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (accessible) onCardClick(tpl);
                  }}
                >
                  상세 발행 →
                </button>
              )}
            </div>

            {/* 펼침 부가 패널 — 영수증 관리(결제기록 재발급 / 등록영수증 보기·출력·삭제 / 수기 등록) */}
            {isExpanded && rowExtra && (
              <div data-testid={`docprint-row-extra-${tpl.form_key}`}>{rowExtra}</div>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 단건 발행 다이얼로그 ───

/** 서비스 항목 (T-20260507-foot-SERVICE-CATALOG-SEED Phase 3) */
interface ServiceChargeItem {
  id: string;
  service_code: string | null;
  name: string;
  amount: number;
  // T-20260524-foot-INS-DOC-COPAY-LINK: 급여 본인부담 — IssueDialog 세부내역서 본인부담 열용
  copayment_amount?: number | null;
  hira_code: string | null;
  is_insurance_covered: boolean;
  // T-20260525-foot-INS-FIELD-BIND: 상병코드 식별용 (category_label='상병')
  category_label: string | null;
}

function IssueDialog({
  template,
  checkIn,
  open,
  onOpenChange,
  onIssued,
  staffId,
  dutyDoctors,
  altStatus = false,
  activePackage = null,
  paymentItems = [],
}: {
  template: FormTemplate;
  checkIn: CheckIn;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onIssued: () => void;
  /** issued_by FK — staff.id (DocumentPrintPanel에서 주입) */
  staffId: string | null;
  /** 당일 근무원장님 목록 (T-20260502-foot-DUTY-ROSTER) */
  dutyDoctors: DutyDoctor[];
  /** T-20260522-foot-ALT-BADGE AC-12: ALT 활성 여부 — 레이저코드 삽입 차단 */
  altStatus?: boolean;
  /** T-20260522-foot-ALT-BADGE AC-6: 활성 패키지 정보 — ALT OFF 레이저코드 호환성 검증 */
  activePackage?: ActivePackageInfo | null;
  /** T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX 결함B: ⑪ 납부박스 payments 원장(status=active)
   *  결제수단별 실수납. 부모(DocumentPrintPanel)가 로드한 활성 결제만 주입(취소결제 미표시). */
  paymentItems?: PaymentItem[];
}) {
  const [saving, setSaving] = useState(false);
  const [autoValues, setAutoValues] = useState<Record<string, string>>({});
  // T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC: 달력 '빨간날' 소스(clinic_events event_type='holiday').
  //   법정공휴일 목록(KOREAN_HOLIDAYS_2026) 밖 제헌절·임시·대체공휴일도 공휴일로 인식(body A안 clinic_events 동일).
  const [holidayDateSet, setHolidayDateSet] = useState<Set<string>>(() => new Set());
  // T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC (AC-4): 스태프 수동 편집 키 집합(가산 override).
  const [surchargeOverriddenKeys, setSurchargeOverriddenKeys] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('clinic_events')
        .select('event_date')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('event_type', 'holiday');
      if (cancelled || error || !data) return;
      setHolidayDateSet(new Set(data.map((r) => String(r.event_date))));
    })();
    return () => { cancelled = true; };
  }, [checkIn.clinic_id]);
  const [manualValues, setManualValues] = useState<Record<string, string>>({
    diagnosis_ko: '',
    memo: '',
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  // T-20260629-foot-DOCPRINT-EDIT-BTN: [수정] 팝업 오픈 상태 + 편집 3종(용도/발행일/비고) 오버라이드.
  //   editOverrides 는 allValues 최종단에 병합 → 출력 바인딩 최우선 적용(기존 출력 플로우 무파괴, AC5).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editOverrides, setEditOverrides] = useState<Record<string, string>>({});
  // T-20260719-foot-BILLRECEIPT-NEWFORM-ITEMFIX AC-③: 신양식 사전 납부금액(FE-only 표시, 비영속).
  const [prepaidAmount, setPrepaidAmount] = useState('');
  // 복수 원장님일 때 선택 상태 (단일이면 자동 설정됨)
  const [selectedDoctorName, setSelectedDoctorName] = useState<string>('');
  // T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED: 치료테이블 지정 진료의 — 복수 근무의 UI 기본값에 사용.
  const [treatingDoctorName, setTreatingDoctorName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadTreatingDoctorName(checkIn).then((n) => { if (!cancelled) setTreatingDoctorName(n); });
    return () => { cancelled = true; };
  }, [checkIn.id, checkIn.treating_doctor_id]);
  // T-20260713-foot-DOCPRINT-DOCTOR-UNLINKED: treatingDoctorName 비동기 로드가 open 이후 완료된 경우,
  //   복수 근무의 기본 선택을 지정 진료의로 승격. 사용자가 이미 다른 근무의를 고른 경우(≠자동기본)는 보존.
  useEffect(() => {
    if (!open || dutyDoctors.length <= 1 || !treatingDoctorName) return;
    if (!dutyDoctors.some((d) => (d.name ?? '') === treatingDoctorName)) return;
    setSelectedDoctorName((prev) =>
      (!prev || prev === (dutyDoctors[0].name ?? '')) ? treatingDoctorName : prev,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, treatingDoctorName, dutyDoctors]);
  // T-20260516-foot-CLINIC-DOC-INFO: clinic_doctors 다중 의사 선택
  const [clinicDoctors, setClinicDoctors] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [selectedClinicDoctorId, setSelectedClinicDoctorId] = useState<string>('');
  const [clinicDoctorOverrides, setClinicDoctorOverrides] = useState<Record<string, string>>({});
  // Phase 3: 서비스 항목 (진료 코드 참조)
  const [serviceItems, setServiceItems] = useState<ServiceChargeItem[]>([]);
  // T-20260608-foot-DOC-PATH12-SYNC: PMW(PATH-4) 빌링 폴백 소스 — check_in_services 기반.
  //   service_charges 가 비어있는 경로에서만 사용(무파괴). 건보 등급은 copay 산출용.
  const [footBillingItems, setFootBillingItems] = useState<FootBillingItem[]>([]);
  const [customerInsuranceGrade, setCustomerInsuranceGrade] = useState<InsuranceGrade | null>(null);
  // T-20260722-foot-BILLRECEIPT-MASTER-FIXES §1: ⑨ 이미 납부한 금액(선수금/패키지 차감분, 환자부담분).
  //   useMemo(단건 미리보기/출력)는 동기라 async 로 미리 로드해 상태로 보관. 미차감건 0(회귀0).
  const [alreadyPaidAmount, setAlreadyPaidAmount] = useState(0);
  // T-20260611-foot-DOC-REISSUE-CONTENT-MISSING: 콘텐츠 핵심 소스(autoValues·serviceItems·
  //   footBillingItems·grade) 로드 완료 게이트. 로드 전 출력/발행 차단 → async state race 로
  //   '내용 누락'(빈 items_html·total 0) 스냅샷 저장/출력 방지.
  const [billingReady, setBillingReady] = useState(false);
  // E2E 통합 — 비급여 서비스 직접 추가 (T-20260507-foot-PATIENT-FLOW-E2E)
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  const [allServices, setAllServices] = useState<{ id: string; name: string; service_code: string | null; price: number; category: string }[]>([]);
  const [addServiceId, setAddServiceId] = useState('');
  const [addServiceAmountStr, setAddServiceAmountStr] = useState('');
  const [addingService, setAddingService] = useState(false);
  // T-20260513-foot-BILLING-DETAIL-EDIT: 수정/삭제
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingAmountStr, setEditingAmountStr] = useState('');
  // T-20260517-foot-RX-DOSAGE-DYNAMIC: per-item 용량/용법/투약일수 (rx_standard 전용)
  const [rxItemDosages, setRxItemDosages] = useState<Record<string, { unit_dose: string; daily_freq: string; total_days: string }>>({});
  // T-20260622-foot-DOC-SERIAL-AUTOGEN: 연번호 자동 생성용 — 실제 차트번호(F-XXXX)와 발급순번.
  //   seq = C(무리셋 통산): 클리닉 전역 form_submissions count + 1 (날짜·서류종류·환자 무관, read-only).
  //   미리보기는 INSERT 안 함 → 반복 호출에도 seq 불변(idempotent). null = 아직 산출 전 → 발번 보류.
  const [serialChartNo, setSerialChartNo] = useState<string | null>(null);
  // T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST / DA 설계경보 MSG-k7iz):
  //   교부번호(issue_no)는 **발행 시점 1회 채번→persist 불변 필드** — print-time 재계산 금지(익일/재인쇄 시 다른번호=결함).
  //   채번은 handlePrint 의 발행 RPC(issue_foot_rx_issue_no) 내부에서만 수행하고 field_data 에 persist.
  //   → 미리보기(memo)에는 fabricate 하지 않는다(visit_no 와 동형: 발행본에만 authoritative 번호 표기).
  //   ⚠ 폐기: 구 interim 의 print-time read-only count(todayIssueSeq) — persist·재인쇄불변 미충족(DA 경보).
  // T-20260630-foot-SERIAL-RPC-FE-REWIRE: 발급순번(serialSeq) FE 상태 제거.
  //   발번 권위 = DB RPC issue_foot_doc_serial (출력 확정 시 선점, handlePrint). 미리보기는 미발번.
  //   출력 확정 시 RPC 가 반환한 seq 를 인쇄본 visit_no 에 주입(아래 issuedVisitNo).

  // T-20260513-foot-BILLING-DETAIL-EDIT: service_charges 새로고침 공통 헬퍼
  // T-20260525-foot-INS-FIELD-BIND: category_label 추가 — 상병코드 식별용
  const refreshServiceItems = useCallback(async () => {
    const { data } = await supabase
      .from('service_charges')
      // T-20260524-foot-INS-DOC-COPAY-LINK: copayment_amount 추가 → IssueDialog 세부내역서 본인부담 열
      .select('id, base_amount, copayment_amount, is_insurance_covered, service_id, service:services(name, service_code, hira_code, category_label)')
      .eq('check_in_id', checkIn.id);
    if (!data) return;
    setServiceItems(data.map((c) => {
      const svc = Array.isArray(c.service) ? c.service[0] : c.service;
      return {
        id: c.id,
        service_code: (svc as { service_code?: string | null } | null)?.service_code ?? null,
        name: (svc as { name?: string } | null)?.name ?? '(알 수 없음)',
        amount: c.base_amount ?? 0,
        copayment_amount: (c.copayment_amount as number | null) ?? null,
        hira_code: (svc as { hira_code?: string | null } | null)?.hira_code ?? null,
        is_insurance_covered: c.is_insurance_covered ?? false,
        category_label: (svc as { category_label?: string | null } | null)?.category_label ?? null,
      };
    }));
  }, [checkIn.id]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // T-20260611-foot-DOC-REISSUE-CONTENT-MISSING: 콘텐츠 핵심 4소스 로드 완료 전 출력/발행 차단.
    //   (서류출력 3차 근인) 단건 발행(IssueDialog.allValues)이 async state(footBillingItems·
    //   serviceItems·autoValues·grade)에 의존 → 로드 미완 시 빈 items_html·total 0 스냅샷이
    //   저장/출력되어 '내용 전부 누락'. 게이트로 race 자체를 제거(바인딩 로직 무변경).
    setBillingReady(false);

    // 원장님 이름 결정
    // - 0/1명: override 미전달(undefined) → loadAutoBindContext에 위임
    //   → 치료테이블 지정 진료의 > duty_roster > fallback director 순으로 결선(T-20260713).
    //   (지정 진료의 없으면 기존과 동일하게 duty[1명]/fallback으로 귀결 — 회귀 없음.)
    // - 2명 이상: 빈 채로 — 아래 selectedDoctorName(UI 선택, 기본=지정 진료의)으로 별도 주입
    const resolvedDoctorName =
      dutyDoctors.length > 1
        ? ''  // 복수: UI에서 선택
        : undefined; // 0/1명: loadAutoBindContext 위임(치료테이블 지정 진료의 우선)

    if (dutyDoctors.length > 1) {
      // T-20260709-foot-CUSTCHART-CLOSE-BTN-ERROR: name NULL 방어(?? '') — null 상태 유입 차단.
      // T-20260713: 치료테이블 지정 진료의가 근무 목록에 있으면 그것을 기본 선택으로(없으면 첫 번째).
      const preferred =
        treatingDoctorName && dutyDoctors.some((d) => (d.name ?? '') === treatingDoctorName)
          ? treatingDoctorName
          : (dutyDoctors[0].name ?? '');
      setSelectedDoctorName(preferred);
    }

    // === 콘텐츠 핵심 4소스 (Promise.all 게이트) ===
    // 서비스 항목 조회 (service_charges JOIN services — T-20260507-SERVICE-CATALOG-SEED Phase 3)
    // T-20260525-foot-INS-FIELD-BIND: category_label 추가 — 상병코드 식별 후 diag_code_N 주입
    // T-20260525-foot-DOC-AUTOBIND-REGRESS AC-2: copayment_amount 추가 — bill_detail 본인부담금 열 동기화
    //   PRINT-FORM-BIND(3cd5c8d) 당시 초회 useEffect에 미포함되어 refreshServiceItems와 불일치 발생.
    const pServiceItems = supabase
      .from('service_charges')
      .select('id, base_amount, copayment_amount, is_insurance_covered, service_id, service:services(name, service_code, hira_code, category_label)')
      .eq('check_in_id', checkIn.id)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const items: ServiceChargeItem[] = data.map((c) => {
          const svc = Array.isArray(c.service) ? c.service[0] : c.service;
          return {
            id: c.id,
            service_code: (svc as { service_code?: string | null } | null)?.service_code ?? null,
            name: (svc as { name?: string } | null)?.name ?? '(알 수 없음)',
            amount: c.base_amount ?? 0,
            copayment_amount: (c.copayment_amount as number | null) ?? null,
            hira_code: (svc as { hira_code?: string | null } | null)?.hira_code ?? null,
            is_insurance_covered: c.is_insurance_covered ?? false,
            category_label: (svc as { category_label?: string | null } | null)?.category_label ?? null,
          };
        });
        setServiceItems(items);
      });

    const pAutoValues = loadAutoBindContext(checkIn, resolvedDoctorName).then(async (vals) => {
      if (cancelled) return;
      // T-20260617-foot-DOCFORM-POPUP-OVERHAUL G4/AC-4: 진료의뢰서 검사결과·투약내용 자동 로드 병합.
      //   loadAutoBindContext resolve 직후 병합(setAutoValues replace 와의 race 제거). 결측 시 빈값(공란+수기).
      if (template.form_key === 'referral_letter' && checkIn.customer_id) {
        const ref = await loadReferralAutoFields(checkIn.clinic_id, checkIn.customer_id);
        if (cancelled) return;
        setAutoValues({ ...vals, test_result: ref.test_result, medication: ref.medication });
      } else if (template.form_key === 'koh_result' && checkIn.customer_id) {
        // T-20260710-foot-KOHRESULT-DOC-PRINT-ENABLE (AC-2/AC-3): 발행된 KOH 결과지 field_data 병합.
        //   검사결과 탭 KohResultDialog 와 동일 소스 → 발톱부위(specimen_type)·의뢰번호·채취일 등 정확 렌더.
        //   발행분 부재 시 kohFd=null → 기존 autobind(공란) 유지(무파손). 이 방문(check_in) 발행분 우선.
        const kohFd = await loadPublishedKohFieldData(
          checkIn.clinic_id,
          checkIn.customer_id,
          checkIn.id,
        );
        if (cancelled) return;
        if (kohFd) {
          const kohStr: Record<string, string> = {};
          for (const [k, v] of Object.entries(kohFd)) kohStr[k] = v == null ? '' : String(v);
          setAutoValues({ ...vals, ...kohStr });
        } else {
          setAutoValues(vals);
        }
      } else {
        setAutoValues(vals);
      }
    });

    // T-20260608-foot-DOC-PATH12-SYNC: PMW 수기조정 소스(check_in_services) + 건보 등급 로드 →
    //   service_charges 가 비었을 때 PATH-4 와 동일한 빌링 폴백에 사용.
    const pFootBilling = loadFootBillingItems(checkIn.id, checkIn.clinic_id).then((items) => {
      if (!cancelled) setFootBillingItems(items);
    });
    // T-20260706-foot-DOCPRINT-FEEBREAKDOWN-INSURANCE-BLANK: grade null(신규방문 미입력) 시
    //   이 방문 service_charges 저장 등급으로 폴백 → bill_detail 급여구분 붕괴 방지.
    const pGrade = loadEffectiveInsuranceGrade(checkIn.customer_id, checkIn.id).then((grade) => {
      if (!cancelled) setCustomerInsuranceGrade(grade);
      return grade;
    });
    // T-20260722-foot-BILLRECEIPT-MASTER-FIXES §1: ⑨ 이미 납부한 금액 = 선수금/패키지 차감분(환자부담분).
    //   grade 확정 후 로드(급여패키지 그레인 가드 — 급여패키지면 본인부담분으로 한정). 미차감건 0(회귀0).
    const pAlreadyPaid = pGrade.then((grade) =>
      loadAlreadyPaidAmount(checkIn.id, grade).then((amt) => {
        if (!cancelled) setAlreadyPaidAmount(amt);
      }),
    );

    // 5소스 모두 resolve 후에만 출력/발행 허용. 일부 실패해도 영구 차단 방지(allSettled).
    Promise.allSettled([pServiceItems, pAutoValues, pFootBilling, pGrade, pAlreadyPaid]).then(() => {
      if (!cancelled) setBillingReady(true);
    });

    // === 보조 소스 (게이트 미포함 — UX 보조용) ===
    // 서비스 목록 로드 (비급여 직접 추가용 — T-20260507-foot-PATIENT-FLOW-E2E)
    supabase
      .from('services')
      .select('id, name, service_code, price, category')
      .eq('clinic_id', checkIn.clinic_id)
      .eq('active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (!cancelled && data) {
          setAllServices(data as { id: string; name: string; service_code: string | null; price: number; category: string }[]);
        }
      });

    // T-20260516-foot-CLINIC-DOC-INFO: clinic_doctors 로드
    supabase
      .from('clinic_doctors')
      .select('id, name, is_default')
      .eq('clinic_id', checkIn.clinic_id)
      .eq('active', true)
      .order('sort_order')
      .order('created_at')
      .then(({ data }) => {
        if (cancelled || !data) return;
        const docs = data as { id: string; name: string; is_default: boolean }[];
        setClinicDoctors(docs);
        // 기본 의사 또는 첫 번째 사전 선택
        if (docs.length > 1) {
          const def = docs.find((d) => d.is_default) ?? docs[0];
          setSelectedClinicDoctorId(def.id);
        } else if (docs.length === 1) {
          setSelectedClinicDoctorId(docs[0].id);
        }
      });

    return () => {
      cancelled = true;
      setBillingReady(false);
      setServiceItems([]);
      setFootBillingItems([]);
      setCustomerInsuranceGrade(null);
      setAlreadyPaidAmount(0);
      setAllServices([]);
      setAddServiceOpen(false);
    };
  }, [open, checkIn, dutyDoctors]);

  // T-20260622-foot-DOC-SERIAL-AUTOGEN / T-20260630-foot-SERIAL-RPC-FE-REWIRE:
  //   연번호 자동 생성 소스 (read-only). 다이얼로그 오픈 시 1회. 차트번호(F-XXXX)만 미리 로드한다.
  //   ⚠ FE count+1 발번 폐기(REWIRE): 발급순번은 더 이상 미리보기에서 count 로 추정하지 않는다.
  //     발번 권위 = DB RPC issue_foot_doc_serial(clinic_id, form_submission_id) — 출력 확정 시 선점(handlePrint).
  //     (count+1 은 유니크 제약이 없어 동시발번 시 동일 seq 가능 + 비-연번호 행까지 분모에 셈 → 폐기.
  //      HARDEN: doc_serial_seq INT 컬럼 + UNIQUE(clinic_id, doc_serial_seq) + RPC MAX+1 gapless 로 대체.)
  //   미리보기 visit_no 는 미발번(빈 값) — 출력 확정 시 RPC 가 인쇄본에 실 연번호 주입.
  useEffect(() => {
    if (!open || !checkIn.customer_id) {
      setSerialChartNo(null);
      return;
    }
    let cancelled = false;
    supabase
      .from('customers')
      .select('chart_number')
      .eq('id', checkIn.customer_id)
      .maybeSingle()
      .then((custRes) => {
        if (cancelled) return;
        const chartNo = (custRes.data?.chart_number as string | null | undefined) ?? null;
        setSerialChartNo(chartNo && String(chartNo).trim() ? String(chartNo).trim() : null);
      });
    return () => { cancelled = true; };
  }, [open, checkIn.customer_id, checkIn.clinic_id]);

  // T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST): 교부번호 당일순번 print-time 로드 제거.
  //   ⚠ DA 설계경보(MSG-k7iz): 발행 시점 1회 채번(handlePrint 의 issue_foot_rx_issue_no RPC)만 authoritative.
  //     미리보기용 count 로더(구 todayIssueSeq)는 print-time 재계산 = persist·재인쇄불변 위배 → 삭제.

  // T-20260513-foot-BILLING-DETAIL-EDIT: 항목 삭제
  const handleDeleteItem = async (id: string) => {
    const { error } = await supabase.from('service_charges').delete().eq('id', id);
    if (error) { toast.error(`삭제 실패: ${error.message}`); return; }
    await refreshServiceItems();
    toast.success('항목이 삭제되었습니다');
  };

  // T-20260513-foot-BILLING-DETAIL-EDIT: 항목 금액 수정 저장
  const handleSaveEditItem = async (id: string) => {
    const newAmount = parseInt(editingAmountStr.replace(/,/g, ''), 10);
    if (isNaN(newAmount) || newAmount < 0) { toast.error('유효한 금액을 입력해주세요'); return; }
    const { error } = await supabase
      .from('service_charges')
      .update({ base_amount: newAmount, copayment_amount: newAmount })
      .eq('id', id);
    if (error) { toast.error(`수정 실패: ${error.message}`); return; }
    await refreshServiceItems();
    setEditingItemId(null);
    setEditingAmountStr('');
    toast.success('항목이 수정되었습니다');
  };

  // T-20260513-foot-BILLING-DETAIL-EDIT: serviceItems 합계 자동 계산
  const computedTotal = useMemo(() => {
    if (serviceItems.length === 0) return null;
    return serviceItems.reduce((s, item) => s + item.amount, 0);
  }, [serviceItems]);

  // T-20260516-foot-CLINIC-DOC-INFO: selectedClinicDoctorId 변경 시 의사 상세 오버라이드
  useEffect(() => {
    if (!selectedClinicDoctorId || clinicDoctors.length <= 1) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('clinic_doctors')
        .select('name, license_no, specialist_no, seal_image_url')
        .eq('id', selectedClinicDoctorId)
        .maybeSingle();
      if (cancelled || !data) return;
      let sealUrl = data.seal_image_url ?? '';
      if (sealUrl) {
        const { data: signed } = await supabase.storage
          .from('documents')
          .createSignedUrl(sealUrl, 3600);
        sealUrl = signed?.signedUrl ?? sealUrl;
      }
      if (!cancelled) {
        setClinicDoctorOverrides({
          doctor_name: data.name ?? '',
          doctor_license_no: data.license_no ?? '',
          doctor_specialist_no: data.specialist_no ?? '',
          doctor_seal_image: sealUrl,
        });
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClinicDoctorId]);

  // 복수 원장님일 때 selectedDoctorName을 doctor_name 필드에 주입
  // T-20260513-foot-BILLING-DETAIL-EDIT: computedTotal로 total_amount 자동 갱신
  // T-20260514-foot-FORM-CLARITY-REWORK: HTML 양식용 items_html / record_no 주입
  const allValues = useMemo(() => {
    const base = { ...autoValues, ...manualValues };
    if (dutyDoctors.length > 1 && selectedDoctorName) {
      base.doctor_name = selectedDoctorName;
    }
    // T-20260516-foot-CLINIC-DOC-INFO: clinic_doctors 다중 선택 시 오버라이드
    if (clinicDoctors.length > 1 && selectedClinicDoctorId && Object.keys(clinicDoctorOverrides).length > 0) {
      Object.assign(base, clinicDoctorOverrides);
    }
    // T-20260526-foot-DOC-FORM-REVISE AC-C2: 의사 변경(override) 후 doctor_seal_html 재동기화
    // clinicDoctorOverrides가 doctor_seal_image를 바꿀 수 있으므로 마지막에 재계산.
    // T-20260601-foot-DOC-SEAL2-RXQR AC-1·AC-2: 단일/미리보기 출력 경로(allValues)의 도장 누락 회귀 수정.
    //   기존 버그: override 유무와 무관하게 항상 doctor_seal_html 을 doctor_seal_image(DB seal_image_url)
    //   기준으로 덮어써, DB null(현재 상태)이면 텍스트 직인으로 만들어 버림 → autoBindContext가 넣어둔
    //   SEAL-NULL-FALLBACK(DB seal_image_url → 로컬자산 → 텍스트 직인 3단, autoBindContext.ts L308-313)을 파괴.
    //   배치 경로(autoValues)는 autoValues.doctor_seal_html 을 그대로 써 도장이미지가 나오는데, 단일/미리보기
    //   경로만 이 덮어쓰기로 텍스트가 되어 진료의뢰서·의무기록사본발급신청서(ad1dd0d placeholder 추가분)에서 누락.
    //   → 실제 override 도장이미지가 있을 때만 그 이미지로 갱신하고, 없으면 autoValues.doctor_seal_html
    //   (이미 3단 fallback 적용됨)을 보존한다. 로컬자산 도장 함수를 이 파일에서 직접 호출하지 않음(8FIX
    //   REOPEN2 가드: DocumentPrintPanel은 우하단 오버레이 부활 방지를 위해 해당 함수 비참조 유지).
    if (base.doctor_seal_image) {
      base.doctor_seal_html = `<img src="${base.doctor_seal_image}" style="width:52px;height:52px;opacity:0.85;vertical-align:middle;display:inline-block;" onerror="this.style.display='none'" />`;
    }
    if (computedTotal !== null) {
      base.total_amount = formatAmount(computedTotal);
    }

    // T-20260611-foot-BILLDETAIL-CONSULTFEE-COPAY-REWORK: bill_detail 라인아이템 SSOT 를
    //   check_in_services(=영수증 bill_receipt 와 동일 SSOT, computeFootBilling.grandTotal)로 통일.
    //   RC(박민석 bd814f22): service_charges(보험 copay 산출 감사로그)가 진찰료(AA154/AA254)·레이저 등
    //   '가격 항목'을 누락한 불완전 부분집합인 차트가 존재 → Path A(serviceItems=service_charges 직결)로
    //   bill_detail 을 그리면 진찰료 행이 통째로 빠지고, computedTotal(service_charges 부분합=0)이
    //   total_amount 를 0 으로 덮어 영수증 합계와 불일치(증상: 진찰료 누락 + 공단/본인 공란 + 합계 부족).
    //   영수증(bill_receipt)은 이미 RECEIPT-LASER-MISSING(T-20260609)에서 check_in_services grandTotal 로
    //   통일됨 → bill_detail 도 동일 SSOT 를 쓰면 진찰료 포함 전 가격항목이 표기되고 합계가 자동 정합(AC-1/4).
    //   copayInfo 비례배분으로 급여 본인/공단 컬럼을 채운다(AC-2/3, 0cbbdc2 로직 그대로 재사용=AC-5).
    //   무파괴: check_in_services 미기록 구(舊) 데이터에서만 service_charges 직결로 폴백.
    const footFb = footBillingItems.length > 0
      ? computeFootBilling(footBillingItems, customerInsuranceGrade)
      : null;

    // bill_detail HTML 양식: 서비스 항목 rows 주입
    if (template.form_key === 'bill_detail' && footFb) {
      // SSOT = check_in_services: 진찰료 포함 전체 가격항목 + 급여 분류 + copay 비례배분(per-item 본인/공단).
      const billItems = buildFootBillDetailItems(footFb.pricingItems, base.visit_date ?? '', {
        insuranceGrade: customerInsuranceGrade,
        copaymentTotal: footFb.copaymentTotal,
      });
      base.items_html = buildBillDetailItemsHtml(billItems);
      // 합계 = 영수증과 동일 SSOT(grandTotal). computedTotal(service_charges 부분합)이 0/부족으로 덮지 않도록 명시.
      if (footFb.grandTotal > 0) base.total_amount = formatAmount(footFb.grandTotal);
      base.subtotal_amount = base.total_amount;
      base.subtotal_noncovered = footFb.nonCoveredTotal.toLocaleString('ko-KR');
      base.total_noncovered = footFb.nonCoveredTotal.toLocaleString('ko-KR');
      // T-20260708-foot-BILLING-DOCFEE-INSAMOUNT-MISSING AC-3: 요약행 본인부담금/공단부담금 총계 주입.
      //   per-item 컬럼 합계와 정확히 일치(Σcopayment=copaymentTotal, Σfund=insuranceCovered).
      base.subtotal_copayment = formatAmount(footFb.copaymentTotal);
      base.total_copayment = base.subtotal_copayment;
      base.subtotal_fund = formatAmount(footFb.liveBillingValues.insuranceCovered);
      base.total_fund = base.subtotal_fund;
      // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 세부산정내역 '합계' = 본인부담금 + 비급여(공단 제외).
      //   공단부담금(subtotal_fund/total_fund) 칸은 위에서 그대로 유지 — 합계에서만 공단 제외.
      // T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX AC-②③: 계 총액(절사 전)/끝처리 조정/합계(절사 후) 분리.
      {
        const payableB = footFb.copaymentTotal + footFb.nonCoveredTotal;
        const { adjustment, roundedTotal } = computeBillDetailRounding(payableB);
        base.detail_subtotal = formatAmount(payableB);
        base.detail_rounding = formatAmount(adjustment);
        base.detail_total = formatAmount(roundedTotal);
      }
    } else if (template.form_key === 'bill_detail' && serviceItems.length > 0) {
      // 폴백: check_in_services 미기록 구 데이터 → service_charges 직결(기존 동작 보존).
      // T-20260525-foot-DOC-AUTOBIND-REGRESS AC-2: copayment_amount 로 급여 본인부담금 열 표시.
      // T-20260721-foot-BILLDETAIL-SVCCHARGE-FALLBACK-RENDER: 하드코드(covered?'이학요법료':'기타') →
      //   footBillDetailCategory 정식 매핑(A안). category_label 로 진찰료/검사료/처치및수술료 구분 표시.
      //   codeItems(상병/처방약, price=0) 제외(B안) — primary(pricingItems) 대칭, 진단명/약품 무누출. 합계 불변.
      const billItems = serviceItems
        .filter((item) => !isCodeItem(item))
        .map((item) => ({
          category: footBillDetailCategory(item, item.is_insurance_covered),
          date: base.visit_date ?? '',
          code: item.service_code ?? item.hira_code ?? '',
          name: item.name,
          amount: item.amount,
          count: 1,
          days: 1,
          is_insurance_covered: item.is_insurance_covered,
          copayment_amount: item.copayment_amount ?? undefined,
        }));
      // T-20260616-foot-DOCFORM-3FIX-REGRESSION: service_charges 직결 경로의 급여 본인/공단 공란 보강
      //   (DB 값 있으면 미개입, 무보험 등급은 분리 불가로 미개입).
      fillBillItemCopayment(billItems, customerInsuranceGrade);
      base.items_html = buildBillDetailItemsHtml(billItems);
      const nonCoveredTotal = billItems
        .filter((i) => !i.is_insurance_covered)
        .reduce((s, i) => s + i.amount, 0);
      base.subtotal_amount = base.total_amount;
      base.subtotal_noncovered = nonCoveredTotal.toLocaleString('ko-KR');
      base.total_noncovered = nonCoveredTotal.toLocaleString('ko-KR');
      // T-20260708-foot-BILLING-DOCFEE-INSAMOUNT-MISSING AC-3: 폴백 경로도 요약행 본인/공단 총계 주입.
      //   buildBillDetailItemsHtml 의 per-item 산식(급여+copayment_amount 존재 시)과 동일 기준으로 집계.
      const coveredCopay = billItems
        .filter((i) => i.is_insurance_covered && i.copayment_amount != null)
        .reduce((s, i) => s + (i.copayment_amount ?? 0), 0);
      const coveredFund = billItems
        .filter((i) => i.is_insurance_covered && i.copayment_amount != null)
        .reduce((s, i) => s + Math.max(0, i.amount - (i.copayment_amount ?? 0)), 0);
      base.subtotal_copayment = formatAmount(coveredCopay);
      base.total_copayment = base.subtotal_copayment;
      base.subtotal_fund = formatAmount(coveredFund);
      base.total_fund = base.subtotal_fund;
      // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 폴백 경로도 '합계' = 본인부담금 + 비급여(공단 제외).
      //   표시된 본인부담금 총계(coveredCopay)+비급여 총계와 정합. 공단(coveredFund) 칸은 표시 유지.
      // T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX AC-②③: 계 총액(절사 전)/끝처리 조정/합계(절사 후) 분리.
      {
        const payableB = coveredCopay + nonCoveredTotal;
        const { adjustment, roundedTotal } = computeBillDetailRounding(payableB);
        base.detail_subtotal = formatAmount(payableB);
        base.detail_rounding = formatAmount(adjustment);
        base.detail_total = formatAmount(roundedTotal);
      }
    } else if (template.form_key === 'bill_detail') {
      base.items_html = buildBillDetailItemsHtml([]);
      base.subtotal_amount = base.total_amount;
      base.subtotal_noncovered = '0';
      base.total_noncovered = '0';
      base.subtotal_copayment = '0';
      base.total_copayment = '0';
      base.subtotal_fund = '0';
      base.total_fund = '0';
      // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 항목 0건 → 공단제외 합계 0 명시(공란 방지).
      // T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX AC-②: 끝처리 조정도 0 명시.
      base.detail_total = '0';
      base.detail_subtotal = '0';
      base.detail_rounding = '0';
    }

    // T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT: bill_receipt 항목별 그리드(fee_grid_html).
    //   세부산정내역(bill_detail)과 **동일 SSOT·동일 billItems 구성**으로 HIRA 항목분류 집계 →
    //   공단부담/본인부담/비급여/합계를 행별 배치. (a)항목 미구분·(c)비급여 한덩어리·(b)공단/본인 미분리 해소.
    //   소계행({{insurance_covered}}/{{copayment}}/{{non_covered}}/{{total_amount}})은 applyBillingFallback
    //   (footFb.liveBillingValues 또는 serviceItems 라이브)로 이미 설정됨 → 항목합과 구조적 정합.
    if (template.form_key === 'bill_receipt') {
      let receiptItems: Parameters<typeof buildBillReceiptFeeGridHtml>[0] = [];
      if (footFb) {
        receiptItems = buildFootBillDetailItems(footFb.pricingItems, base.visit_date ?? '', {
          insuranceGrade: customerInsuranceGrade,
          copaymentTotal: footFb.copaymentTotal,
        });
      } else if (serviceItems.length > 0) {
        const fbItems = serviceItems.map((item) => ({
          category: item.is_insurance_covered ? '이학요법료' : '기타',
          amount: item.amount,
          count: 1,
          days: 1,
          is_insurance_covered: item.is_insurance_covered,
          copayment_amount: item.copayment_amount ?? undefined,
        }));
        fillBillItemCopayment(fbItems, customerInsuranceGrade);
        receiptItems = fbItems;
      }
      base.fee_grid_html = buildBillReceiptFeeGridHtml(receiptItems);
      // T-20260714-foot-DOCPRINT-GONGDAN-HIDE-COPAY-ONLY (B안): 총 진료비 합계 = 급여 본인부담금 + 비급여(공단 제외).
      //   fee_grid 행별 합계와 동일 항목·동일 산식(Σcopay covered + Σ비급여)으로 산출 → 그리드 합계와 정확히 정합.
      //   공단부담 열은 buildBillReceiptFeeGridHtml 에서 표시 그대로 유지 — 합계에서만 제외.
      const rcCopay = receiptItems
        .filter((i) => i.is_insurance_covered)
        .reduce((s, i) => s + (i.copayment_amount ?? 0), 0);
      const rcNonCovered = receiptItems
        .filter((i) => !i.is_insurance_covered)
        .reduce((s, i) => s + i.amount * (i.count ?? 1) * (i.days ?? 1), 0);
      base.receipt_total = formatAmount(rcCopay + rcNonCovered);
    }

    // T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN: 신양식(bill_receipt_new) ⑥ 진료비 총액 = grandTotal
    //   (급여 전액 + 비급여 = 법정 ①+②+③+④, 공단 포함). ⑦ 공단부담(insurance_covered)·⑧ 환자부담
    //   (patient_amount = 본인부담금 + 비급여, 공단 제외 — AC7 B안)은 아래 applyBillingFallback 로 설정.
    //   ⚠ 기존 bill_receipt 총액 바인딩 경로 무접촉 — 신 form_key 전용 additive(AC5).
    // T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX: 급여 category remainder 토큰은 야간가산 fold
    //   이후(최종 aggregate)에 계산해야 하므로 billItems 를 블록 밖으로 hoist(순서강제 §3.3).
    let rnItems: Parameters<typeof computeBillReceiptNewCategoryBreakdown>[0] = [];
    if (template.form_key === 'bill_receipt_new') {
      if (footFb && footFb.grandTotal > 0) {
        base.total_amount = formatAmount(footFb.grandTotal);
        base.subtotal_amount = base.total_amount;
      }
      // T-20260719-foot-BILLRECEIPT-NEWFORM-ITEMFIX AC-②: 처치및수술료·검사료·기타 행 비급여 category 분해.
      //   SSOT billItems(bill_detail·bill_receipt 와 동일 buildFootBillDetailItems) 재사용 → footBillDetailCategory
      //   기준 처치/검사 매핑. footFb 없으면 service_charges 직결 폴백(전부 기타 행, 무파괴).
      if (footFb) {
        rnItems = buildFootBillDetailItems(footFb.pricingItems, base.visit_date ?? '', {
          insuranceGrade: customerInsuranceGrade,
          copaymentTotal: footFb.copaymentTotal,
        });
      } else if (serviceItems.length > 0) {
        rnItems = serviceItems.map((item) => ({
          category: item.is_insurance_covered ? '이학요법료' : '기타',
          amount: item.amount,
          count: 1,
          days: 1,
          is_insurance_covered: item.is_insurance_covered,
          // T-20260722 결함A: 폴백 경로도 급여분 copay 를 채워 remainder 정합(fillBillItemCopayment 없이 DB값 재사용).
          copayment_amount: item.copayment_amount ?? undefined,
        }));
      }
      applyBillReceiptNewCategoryTokens(base, rnItems);
    }

    // rx_standard HTML 양식: 처방 의약품 rows 주입 (T-20260515-foot-FORM-ONELINE-RX)
    // 총투약일수(total_days) = A안(빈칸+수기): 자동 계산값을 삽입하지 않고 현장 수기 기입.
    //   (T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX / 총괄 확정 MSG-h6y2. 약국 기준 불일치 반려 방지.)
    //   ⚠ 부활 금지: 구 T-20260517 의 "1/1/7 fallback"(자동 total_days 주입) 및 items[].days 자동 산출.
    //     total_days 소스 = rxItemDosages(수기 입력) 단일. prescription_sets.items[].days 오염 유입 경로 없음(AC2).
    // T-20260525-foot-DOC-AUTOBIND-REGRESS AC-4: 상병코드(category_label='상병') 항목은 처방전 제외
    //   PaymentMiniWindow buildCodeEnrichedValues와 동일 정책 적용.
    if (template.form_key === 'rx_standard') {
      const rxServiceItems = serviceItems.filter((i) => i.category_label !== '상병');
      const rxItems = rxServiceItems.map((item) => ({
        name: item.name,
        // T-20260718-foot-RXPRINT-DRUGCODE-PREFIX: 서비스관리 등록 약 코드(services.service_code) 앞 표기.
        code: item.service_code,
        unit_dose: rxItemDosages[item.id]?.unit_dose || '1',
        daily_freq: rxItemDosages[item.id]?.daily_freq || '1',
        // T-20260721-foot-RXPRINT-TOTALDAYS-BLANK (총괄 김주연 최종): 세 칸 전부 기본 '1' + 수기 수정 가능.
        //   구 T-20260718 LOGIC-LOCK("total_days 빈칸이 정답")은 총괄 결정으로 해제 → 형제 두 칸과 동일한 리터럴 기본값 '1'.
        //   ⚠ 이건 자동 산출 바인딩(옵션B) 아님 — items[].days 등 자동값 강제 주입 금지. 리터럴 '1' + editable.
        total_days: rxItemDosages[item.id]?.total_days || '1',
        method: '',
      }));
      base.rx_items_html = buildRxItemsHtml(rxItems);
      // T-20260601-foot-DOC-PRINT-8FIX AC-3②: 사용기간 기본 3일 통일
      if (!base.usage_days) base.usage_days = '3';
      // T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST): 교부번호(issue_no)는 미리보기에서 미채번.
      //   ⚠ DA 설계경보(MSG-k7iz): 발행 시점 1회 채번(handlePrint 의 issue_foot_rx_issue_no RPC)만 authoritative·persist.
      //     여기(memo)서 print-time count 로 fabricate 하면 재인쇄/익일 다른번호 = correctness 결함 → 발행본에서만 주입.
      //   ⚠ 절대 부활 금지: 구 checkIn.id.slice(0,5).toUpperCase() (UUID 앞 5자) — 약국 판독불가 반려 실사고.
    }

    // T-20260525-foot-INS-FIELD-BIND AC-3: 상병코드 주입 — service_charges 상병 항목 우선
    // loadAutoBindContext의 medical_charts 기반 diag_code보다 service_charges가 더 신뢰성 높음
    // PaymentMiniWindow의 buildCodeEnrichedValues와 동일 로직 (단, serviceItems는 이미 로드된 상태)
    // T-20260526-foot-DOC-DIAG-TRUNC: 3~4건 전건 노출 — 행 가시성 플래그 함께 주입
    // T-20260719-foot-RXPRINT-LAYOUT-4FIX AC-③: service_charges 에 상병이 없으면(결제미니창 PATH-4 는 선택 상병을
    //   check_in_services 에만 저장 → service_charges 공란) footBillingItems(check_in_services) 상병으로 폴백.
    //   → 서류발행(PATH-1) 처방전 '질병분류기호'에도 결제미니창 선택 상병코드가 표시(현장 공란 해소).
    //   read-path 재사용(신규 write/DDL 0). 두 소스 모두 없을 때만 medical_charts 폴백(기존 동작 보존).
    // T-20260721-foot-BILLDETAIL-DIAGCODE-ADD (AC-5): 공용 헬퍼(applyDiagTokens)로 통일 — 일괄출력과 대칭.
    //   단일 출력·재출력(이 IssueDialog 경로 공용) 모두 동일 소스·동일 산식으로 상병 3토큰 렌더 보장.
    const issueChargesDiag = serviceItems
      .filter((i) => i.category_label === '상병')
      .map((i) => ({ code: i.service_code ?? '', name: i.name }));
    const issueFallbackDiag = footBillingItems
      .filter((fb) => (fb.service.category_label ?? '') === '상병')
      .map((fb) => ({ code: fb.service.service_code ?? '', name: fb.service.name }));
    applyDiagTokens(base, issueChargesDiag, issueFallbackDiag);

    // T-20260606-foot-DOC-FIELD-MISSING-3 AC-1/2/3: 보험청구서·진료비계산서 금액 보강.
    //   bill_receipt {{non_covered}} / ins_claim_form {{insurance_covered}}·{{copayment}}·{{non_covered}}
    //   은 autobind(service_charges) 직결인데, 단건 발행 화면의 serviceItems(편집 후 포함)와 어긋나
    //   비어 보이는 경우를 폴백 보강한다. autobind 값이 이미 있으면 보존(덮어쓰지 않음).
    if (serviceItems.length > 0) {
      const liveNon = serviceItems
        .filter((i) => !i.is_insurance_covered)
        .reduce((s, i) => s + i.amount, 0);
      const liveCopay = serviceItems
        .filter((i) => i.is_insurance_covered)
        .reduce((s, i) => s + (i.copayment_amount ?? 0), 0);
      const liveIns = serviceItems
        .filter((i) => i.is_insurance_covered)
        .reduce((s, i) => s + (i.amount - (i.copayment_amount ?? 0)), 0);
      applyBillingFallback(base, {
        insuranceCovered: liveIns,
        copayment: liveCopay,
        nonCovered: liveNon,
      });
    } else if (footFb) {
      // T-20260608-foot-DOC-PATH12-SYNC: service_charges 미기록 → check_in_services 폴백.
      //   PMW(PATH-4) applyBillingFallback 호출(L1472~1475)과 동일 정의. autobind 값이 있으면 보존.
      applyBillingFallback(base, footFb.liveBillingValues);
    }

    // T-20260622-foot-DOCSERIAL-AUTOGEN: 등록번호(차트번호)/연번호 자동 생성.
    //   등록번호(record_no) = 실제 차트번호(F-XXXX). 임시값(customer_id.slice) 대신 customers.chart_number 우선.
    //   연번호(visit_no) = {prefix}-{발급일YYYYMMDD}-{차트번호}-{발급순번2자리} (예: VC-20260622-F-4302-01).
    //   prefix/차트번호/순번 중 하나라도 없으면(미등록 form_key·미발번·count 진행 중) 발번 보류 →
    //   기존 fallback 유지(임시값 fabrication 금지, 회귀0).
    if (serialChartNo && !base.record_no) {
      base.record_no = serialChartNo;
    }
    // T-20260630-foot-SERIAL-RPC-FE-REWIRE: 연번호 발급순번 미리보기 발번 제거.
    //   연번호 발번은 출력 확정 시 DB RPC(issue_foot_doc_serial) — 미리보기엔 숫자 미표기.
    //   연번호 대상(prefix 매핑 + 차트번호 보유) 양식은 미발번(빈 값) 상태로 두고, handlePrint 가
    //   RPC 반환 seq 로 인쇄본 visit_no 를 주입한다(buildDocSerial — 포맷 {prefix}-{YYYYMMDD}-{chart}-{NN} 불변).
    //   ⚠ 비-연번호 양식(미등록 form_key·차트번호 미발번)은 기존 fallback(checkIn.id slice) 그대로 — 회귀0.
    const serialEligible = !!docSerialPrefix(template.form_key) && !!serialChartNo;
    if (serialEligible) {
      base.visit_no = ''; // 미리보기 미발번 — 출력 확정 시 RPC 주입(아래 record_no fallback 에 안 걸리도록 명시 공란)
    }

    // 등록번호 기본값 (없으면 checkIn.id 앞 8자)
    if (!base.record_no) {
      base.record_no = checkIn.customer_id?.slice(0, 8) ?? '';
    }
    // 연번호 fallback: 비-연번호 양식만(serialEligible 은 출력 시 RPC 발번 → 빈 값 유지).
    if (!serialEligible && !base.visit_no) {
      base.visit_no = checkIn.id.slice(0, 8) ?? '';
    }

    // ── T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC (B안): 출력시점 야간·공휴일 가산 자동 반영 ──
    //   대상 2종 서류(진료비 계산서·영수증 신양식 bill_receipt_new / 세부산정내역 bill_detail)만 form-scoped 적용.
    //   판정 기준 = **진료일(checked_in_at)** 날짜·시간 + 달력 빨간날(clinic_events) 합집합.
    //   (2026-07-19 exfb 포트 갭 close) body canon visitDate=checked_in_at 미러 — 출력 시점(new Date())이
    //   아니라 진료 당시로 판정(과거일 출력 정확). checked_in_at 부재 시 now 폴백(resolveSurchargeRefDate).
    //   가산 범위(Q4) = 진찰료(급여) base × 30%. 겹침 = 공휴일 우선 단일(AC-3). 미가산 시 공란·기본금액(AC-5).
    //   ★가드(AC-6): FE-only 표시 전용 — service_charges 영속 없음 → 급여 본인부담 분자 이중계상 없음.
    //   (reopen 2026-07-19) 인라인 로직을 applyNightHolidaySurcharge(SSOT)로 일원화 — 미리보기(여기)와
    //   일괄출력(handleBatchPrint valuesFor)이 동일 헬퍼를 호출해 preview/print divergence를 구조적으로 차단.
    const surchargeRefDate = resolveSurchargeRefDate(checkIn.checked_in_at, new Date());
    applyNightHolidaySurcharge(
      base,
      template.form_key,
      holidayDateSet.has(toLocalDateStr(surchargeRefDate)),
      surchargeOverriddenKeys,
      surchargeRefDate,
      buildSurchargeDetailRowHtml,
    );

    // ── T-20260721-foot-BILLDOC-GONGDAN-ROUND-2DOC AC-1(2c): 신양식 환자부담총액·납부할금액 10원 절사(FLOOR) ──
    //   RC(diagnose): 세부산정내역(bill_detail) 합계는 computeBillDetailRounding 로 10원 절사(FLOOR) 되나,
    //   계산서·영수증 신양식(bill_receipt_new)의 ⑧ 환자부담총액·⑩ 납부할금액({{patient_amount}})은 절사 없이
    //   raw(copayment+non_covered) 로 바인딩돼 두 법정서류의 환자 실부담 총액이 불일치했다(현장: '총액 안맞음').
    //   → 세부내역서와 **동일 SSOT**(computeBillDetailRounding = COPAY-CEIL-TO-FLOOR, round-DOWN)로 절사해
    //     ⑧/⑩ = 세부내역서 detail_total 과 정확히 정합. base.patient_amount 는 야간가산 fold 반영 최종값.
    //   ⚠ CANON-GATE: ⑦ 공단부담총액({{insurance_covered}}, 1a/2b)은 §2-2-6 v1.14 canon 소관 → **미접촉**.
    if (template.form_key === 'bill_receipt_new') {
      const rawPatient = parseAmountStr(base.patient_amount);
      const { roundedTotal: patientFloored } = computeBillDetailRounding(rawPatient);
      if (rawPatient > 0) base.patient_amount = formatAmount(patientFloored);

      // ── T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX ──
      // 결함A: 급여 category 분해 토큰 주입. ★야간가산 fold 이후(여기)에 호출해야 진찰료 remainder 가
      //   최종 aggregate({{copayment}}/{{insurance_covered}}) 기준으로 산출돼 Σ(행)=합계 정합(§3.3 순서강제).
      applyBillReceiptNewCoveredTokens(base, rnItems);
      // 결함B: ⑪ 납부한 금액 = payments 원장(status=active) 결제수단별 실수납 groupBy.
      //   ⚠ prepaid_amount(납부할금액 가정값) 3경로 전파 폐기(REVERIFY-2: 완납 가정=허위영수증 FAIL).
      //   MASTER-FIXES §1 ⑨ 선수금 차감분(alreadyPaidAmount) + §2 refund 순액(paymentItems.payment_type).
      //   미납 = ⑩(=⑧−⑨) − 실수납 합계.
      applyBillReceiptPaidBoxTokens(base, paymentItems, patientFloored, alreadyPaidAmount);
    }

    // T-20260629-foot-DOCPRINT-EDIT-BTN: [수정] 팝업 편집값(용도/발행일/비고)을 최종 오버라이드.
    //   빈 키는 덮지 않음(미편집 필드 무파괴) — 사용자가 명시 편집한 값만 출력 바인딩에 반영(AC3/AC5).
    for (const [k, v] of Object.entries(editOverrides)) {
      if (v != null && v !== '') base[k] = v;
    }

    return base;
  }, [autoValues, manualValues, dutyDoctors.length, selectedDoctorName, computedTotal, template.form_key, serviceItems, footBillingItems, customerInsuranceGrade, alreadyPaidAmount, checkIn, clinicDoctors.length, selectedClinicDoctorId, clinicDoctorOverrides, rxItemDosages, serialChartNo, editOverrides, holidayDateSet, surchargeOverriddenKeys, prepaidAmount]);

  const editableFields = useMemo(() => {
    const base: FieldMapEntry[] =
      template.field_map.length > 0
        ? [...template.field_map]
        : [
            { key: 'patient_name', label: '환자명', type: 'text' as const, x: 0, y: 0 },
            { key: 'patient_phone', label: '연락처', type: 'text' as const, x: 0, y: 0 },
            { key: 'visit_date', label: '진료일', type: 'date' as const, x: 0, y: 0 },
            { key: 'diagnosis_ko', label: '진단명', type: 'multiline' as const, x: 0, y: 0, w: 400, h: 80 },
            { key: 'doctor_name', label: '진료 의사', type: 'text' as const, x: 0, y: 0 },
            { key: 'total_amount', label: '총 금액', type: 'amount' as const, x: 0, y: 0 },
            { key: 'issue_date', label: '발행일', type: 'date' as const, x: 0, y: 0 },
            { key: 'memo', label: '비고', type: 'multiline' as const, x: 0, y: 0, w: 400, h: 60 },
          ];

    // T-20260617-foot-DOCFORM-POPUP-OVERHAUL: 양식별 전용 입력필드 코드 주입(DB field_map 유무 무관 보장).
    //   회귀 0 — 신규 placeholder 는 미바인딩 시 ''(bindHtmlTemplate). 값은 form_submissions.field_data(JSON)
    //   에 담겨 schema-free → DB 컬럼 신설 0(data-architect CONSULT 비해당).
    const has = (k: string) => base.some((f) => f.key === k);
    const supplemental: FieldMapEntry[] = [];
    if (template.form_key === 'referral_letter') {
      // G4/AC-4: 검사 결과·투약 내용(자동 로드 후 수기 수정 가능).
      if (!has('test_result'))
        supplemental.push({ key: 'test_result', label: '검사 결과 (KOH 자동)', type: 'multiline' as const, x: 0, y: 0, w: 400, h: 60 });
      if (!has('medication'))
        supplemental.push({ key: 'medication', label: '투약 내용 (처방약 자동)', type: 'multiline' as const, x: 0, y: 0, w: 400, h: 60 });
    }
    if (template.form_key === 'diagnosis') {
      // G6/AC-3: 향후 치료기간(치료내용/소견과 분리된 전용 필드).
      if (!has('future_treatment_period'))
        supplemental.push({ key: 'future_treatment_period', label: '향후 치료기간', type: 'text' as const, x: 0, y: 0 });
    }
    return [...base, ...supplemental] satisfies FieldMapEntry[];
  }, [template.field_map, template.form_key]);

  const updateField = (key: string, value: string) => {
    // T-20260717-foot-DOCPRINT-NIGHTHOLIDAY-SURCHARGE-AUTOCALC (AC-4): 스태프가 수동 편집한 키는
    //   가산 자동계산이 덮지 않도록 override 기록 → 수동값 우선(가산 금액도 수동 변경 가능).
    setSurchargeOverriddenKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    if (key in autoValues) {
      setAutoValues((prev) => ({ ...prev, [key]: value }));
    } else {
      setManualValues((prev) => ({ ...prev, [key]: value }));
    }
  };

  // 비급여 서비스 직접 추가 핸들러 (T-20260507-foot-PATIENT-FLOW-E2E)
  // T-20260522-foot-ALT-BADGE AC-12: ALT ON 시 레이저코드 삽입 차단
  // T-20260522-foot-ALT-BADGE AC-6:  ALT OFF 시 패키지 미포함 레이저코드 삽입 차단
  const handleAddService = async () => {
    if (!addServiceId) return;
    const svc = allServices.find((s) => s.id === addServiceId);
    if (!svc) return;
    // AC-12: ALT 활성 상태에서 레이저 관련 서비스 삽입 시도 → 자동 차단
    if (altStatus && isLaserService(svc)) {
      toast.error('ALT 활성 고객 — 레이저코드 삽입이 차단되었습니다. (보험 반려 대상)', {
        description: 'ALT 해제 후 레이저코드를 추가할 수 있습니다.',
        duration: 5000,
      });
      return;
    }
    // AC-6: ALT OFF + 패키지 등록 상태 → 패키지 미포함 레이저코드 삽입 차단 (전체 패키지 공통)
    if (!altStatus && isLaserBlockedByPackage(svc, activePackage)) {
      const pkgName = activePackage?.package_name ?? '현재 패키지';
      const isHeated = svc.category === 'heated_laser';
      const sessionType = isHeated ? '온열 레이저' : '레이저';
      toast.error(`패키지 미포함 항목 — ${sessionType}코드 삽입이 차단되었습니다.`, {
        description: `${pkgName}에 ${sessionType} 회차가 없습니다. 잘못된 코드 삽입을 방지합니다.`,
        duration: 5000,
      });
      return;
    }
    const amount = parseInt(addServiceAmountStr.replace(/,/g, ''), 10) || svc.price;
    setAddingService(true);
    const { error } = await supabase.from('service_charges').insert({
      clinic_id: checkIn.clinic_id,
      check_in_id: checkIn.id,
      customer_id: checkIn.customer_id,
      service_id: addServiceId,
      is_insurance_covered: false,
      base_amount: amount,
      insurance_covered_amount: 0,
      copayment_amount: amount,
      exempt_amount: 0,
      customer_grade_at_charge: 'manual',
      copayment_rate_at_charge: 1.0,
    });
    if (error) {
      toast.error(`서비스 추가 실패: ${error.message}`);
      setAddingService(false);
      return;
    }
    // T-20260513-foot-BILLING-DETAIL-EDIT: 공통 새로고침
    await refreshServiceItems();
    setAddServiceId('');
    setAddServiceAmountStr('');
    setAddServiceOpen(false);
    setAddingService(false);
    toast.success('진료 항목이 추가되었습니다');
  };

  const renderPreview = useCallback(() => {
    // T-20260514-foot-FORM-CLARITY-REWORK: HTML 양식은 항상 미리보기 가능
    if (template.template_format === 'html' || isHtmlTemplate(template.form_key)) {
      setPreviewOpen(true);
      return;
    }
    const imgUrl = getTemplateImageUrl(template.form_key);
    if (!imgUrl || template.template_format === 'pdf') {
      toast.info('PDF 양식은 미리보기 없이 바로 출력됩니다');
      return;
    }
    setPreviewOpen(true);
  }, [template]);

  // T-20260630-foot-SERIAL-RPC-FE-REWIRE: valuesOverride 파라미터 — 출력 확정 시 RPC 발번된 visit_no 가
  //   주입된 finalValues 로 인쇄(미주입 시 allValues = 미리보기값). 인쇄본에만 실 연번호가 찍힘.
  const printJpg = useCallback((valuesOverride?: Record<string, string>) => {
    const values = valuesOverride ?? allValues;
    // T-20260514-foot-FORM-CLARITY-REWORK: HTML 양식 분기
    if (template.template_format === 'html' || isHtmlTemplate(template.form_key)) {
      // T-20260526-foot-RX-PRINT-DUAL: 처방전(rx_standard) 2장 출력 (약국보관용 + 환자보관용)
      const isLandscape = template.form_key === 'bill_detail';
      const pages = template.form_key === 'rx_standard'
        ? [
            buildHtmlPageHtml(template, values, '약국보관용'),
            buildHtmlPageHtml(template, values, '환자보관용'),
          ]
        : [buildHtmlPageHtml(template, values)];
      const w = openBatchPrintWindow(pages, `${template.name_ko} — ${checkIn.customer_name}`, isLandscape);
      if (!w) toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
      return;
    }
    const imgUrl = getTemplateImageUrl(template.form_key);
    if (!imgUrl) {
      toast.error('양식 이미지를 찾을 수 없습니다');
      return;
    }
    const pageHtml = buildPageHtml(template, values, imgUrl);
    const w = openBatchPrintWindow([pageHtml], `${template.name_ko} — ${checkIn.customer_name}`);
    if (!w) toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
  }, [template, allValues, checkIn.customer_name]);

  const printPdf = useCallback(async (valuesOverride?: Record<string, string>) => {
    const values = valuesOverride ?? allValues;
    const pdfUrl = getTemplateImageUrl(template.form_key);
    if (!pdfUrl) {
      toast.error('PDF 양식을 찾을 수 없습니다');
      return;
    }
    try {
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
      const existingPdfBytes = await fetch(pdfUrl).then((r) => r.arrayBuffer());
      const pdfDoc = await PDFDocument.load(existingPdfBytes);
      const pages = pdfDoc.getPages();
      const page = pages[0];
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      if (template.field_map.length > 0) {
        for (const f of template.field_map) {
          const val = values[f.key] ?? '';
          if (!val) continue;
          page.drawText(val, {
            x: f.x,
            y: f.y,
            size: f.font ?? 12,
            font,
            color: rgb(0, 0, 0),
          });
        }
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      toast.error(`PDF 생성 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }
  }, [template, allValues]);

  const handlePrint = async () => {
    // T-20260611-foot-DOC-REISSUE-CONTENT-MISSING: 콘텐츠 4소스 로드 미완 시 출력/저장 차단(방어).
    //   버튼 disabled 게이트의 이중 안전장치 — race 로 빈 스냅샷이 저장되는 것을 원천 차단.
    if (!billingReady) {
      toast.error('서류 내용을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    // T-20260710-foot-RRN-REGISTER-ERR-ISSUE-FROMCHART2 AC2: 미저장 2번차트 → 저장 확인 후 발급(구값 발급 방지).
    if (!(await ensureChartSavedBeforePublish())) return;
    setSaving(true);
    const isFallback = template.id.startsWith('fallback-');

    // T-20260630-foot-SERIAL-RPC-FE-REWIRE: 출력 확정 시 발번 경로 = DB RPC(issue_foot_doc_serial).
    //   인쇄에 사용할 최종 필드값. 연번호 대상 양식은 INSERT 후 RPC seq 로 visit_no 를 덮어 인쇄/기록한다.
    let printValues: Record<string, string> = allValues;
    const serialEligible = !!docSerialPrefix(template.form_key) && !!serialChartNo;

    // T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST): 처방전 교부번호 발행시점 채번 준비.
    //   isRx=처방전 → 발행 RPC(issue_foot_rx_issue_no) 로 당일순번 채번(발행본에만 주입, 미리보기 미채번).
    const isRx = template.form_key === 'rx_standard';
    const issueYmd = format(new Date(), 'yyyyMMdd');   // 교부번호 앞 8자리(YYYYMMDD, buildIssueNo)
    const issueDateIso = format(new Date(), 'yyyy-MM-dd'); // RPC p_issue_date(date) 파티션 키

    // staffId: issued_by = staff.id (≠ user_profiles.id). 미조회 시 로그 생략하고 출력은 계속.
    if (!isFallback && staffId) {
      // INSERT 후 행 id 확보 → RPC 발번의 멱등 키(form_submission_id).
      const { data: inserted, error } = await supabase
        .from('form_submissions')
        .insert({
          clinic_id: checkIn.clinic_id,
          template_id: template.id,
          check_in_id: checkIn.id,
          customer_id: checkIn.customer_id,
          issued_by: staffId,
          field_data: allValues, // 미리보기값(연번호 대상이면 visit_no 빈 값) — 아래 RPC 후 갱신
          diagnosis_codes: manualValues.diagnosis_ko ? [manualValues.diagnosis_ko] : null,
          status: 'printed',
          printed_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (error || !inserted?.id) {
        toast.error(`발행 기록 저장 실패: ${error?.message ?? '행 생성 실패'}`);
        setSaving(false);
        return;
      }

      // 연번호 대상 양식: RPC 로 발급순번 선점(멱등) → visit_no 문자열 조립 → field_data 갱신.
      //   ⚠ 발번대장 무결성 우선: RPC 실패 시 가짜 번호를 만들지 않는다(visit_no 공란 유지 + 경고).
      if (serialEligible) {
        const { data: seq, error: rpcErr } = await supabase.rpc('issue_foot_doc_serial', {
          p_clinic_id: checkIn.clinic_id,
          p_form_submission_id: inserted.id,
        });
        if (!rpcErr && typeof seq === 'number') {
          const docSerial = buildDocSerial({
            formKey: template.form_key,
            chartNo: serialChartNo, // 실제 차트번호(F-XXXX)
            dateYYYYMMDD: format(new Date(), 'yyyyMMdd'),
            seq, // RPC 발번 권위값(통산 gapless)
          });
          if (docSerial) {
            printValues = { ...allValues, visit_no: docSerial };
            // 인쇄본·발행이력 일치: field_data.visit_no 를 RPC 값으로 갱신(doc_serial_seq 는 RPC 가 이미 기록).
            const { error: updErr } = await supabase
              .from('form_submissions')
              .update({ field_data: printValues })
              .eq('id', inserted.id);
            if (updErr) {
              // 컬럼(doc_serial_seq)은 이미 발번됨 → 번호 자체는 확정. 표시 문자열 갱신만 실패.
              toast.error(`연번호 표시 갱신 실패(번호는 발번됨): ${updErr.message}`);
            }
          }
        } else {
          // 발번 실패: 발번대장 무결성 우선 — 가짜 번호 미기록(visit_no 공란). 재출력으로 재발번 가능.
          toast.error('연번호 발번 실패 — 잠시 후 재출력해 주세요.');
        }
      }

      // ★ T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST / DA 경보 MSG-k7iz):
      //   처방전 교부번호(issue_no) = 발행 시점 1회 채번→persist 불변 필드. INSERT 후 RPC(멱등, form_submission_id 키)로
      //   당일순번 채번 → buildIssueNo(8+N자리) → field_data.issue_no 갱신(재인쇄·익일 인쇄 시 동일번호 = 불변 보장).
      //   ⚠ print-time count 금지. RPC 실패 시 seq=1 폴백으로 (8+N)자리 유효값은 항상 보장(약국 반려 방지·공란/UUID 금지).
      if (isRx) {
        const { data: rxSeq, error: rxErr } = await supabase.rpc('issue_foot_rx_issue_no', {
          p_clinic_id: checkIn.clinic_id,
          p_issue_date: issueDateIso,
          p_form_submission_id: inserted.id,
        });
        const iss = buildIssueNo(issueYmd, !rxErr && typeof rxSeq === 'number' ? rxSeq : 1);
        if (iss) {
          printValues = { ...printValues, issue_no: iss };
          const { error: updErr } = await supabase
            .from('form_submissions')
            .update({ field_data: printValues })
            .eq('id', inserted.id);
          if (updErr) {
            // rx_issue_seq(권위 순번)는 이미 RPC 가 기록 → 번호 확정. field_data 표시 갱신만 실패.
            toast.error(`교부번호 표시 갱신 실패(번호는 발번됨): ${updErr.message}`);
          }
        }
      }
    } else if (isRx) {
      // 발행 기록 INSERT 없는 경로(fallback 템플릿·staff 미조회)도 교부번호 공란 금지 → 카운터 순번만 채번(persist 없음).
      //   form_submission_id=null → 순번만 반환. 발행이력 행이 없어 field_data persist 불가하나 인쇄 공란·UUID 는 방지.
      const { data: rxSeq } = await supabase.rpc('issue_foot_rx_issue_no', {
        p_clinic_id: checkIn.clinic_id,
        p_issue_date: issueDateIso,
        p_form_submission_id: null,
      });
      const iss = buildIssueNo(issueYmd, typeof rxSeq === 'number' ? rxSeq : 1);
      if (iss) printValues = { ...printValues, issue_no: iss };
    }

    if (template.template_format === 'pdf') {
      await printPdf(printValues);
    } else {
      // html 포함 모든 비-PDF는 printJpg (내부에서 html 분기 처리)
      printJpg(printValues);
    }

    setSaving(false);
    toast.success(`${template.name_ko} 발행 완료`);
    onIssued();
  };

  const meta = FORM_META[template.form_key];
  const hasCoords = template.field_map.length > 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-lg">{meta?.icon ?? '📄'}</span>
              {template.name_ko} 발행
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {!hasCoords && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold">좌표 미설정 상태</div>
                  <div className="mt-0.5">
                    양식 오버레이 좌표가 아직 설정되지 않았습니다. 원장님 검토 후 설정됩니다.
                    지금은 원본 양식 위에 데이터가 표시되지 않지만, 데이터는 정상 기록됩니다.
                  </div>
                </div>
              </div>
            )}

            {/* 진료 항목 참조 — T-20260507-SERVICE-CATALOG-SEED Phase 3
                T-20260513-foot-BILLING-DETAIL-EDIT: 수정/삭제 + 합계 자동계산 */}
            {serviceItems.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <FileText className="h-3 w-3" /> 진료 항목 (진료비 코드 참조)
                </div>
                <div className="space-y-1">
                  {serviceItems.map((item) => (
                    <div key={item.id} className="text-xs group">
                      {editingItemId === item.id ? (
                        /* ── 인라인 편집 행 ── */
                        <div className="flex items-center gap-1.5 py-1">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            {item.service_code && (
                              <span className="font-mono text-[10px] bg-teal-50 border border-teal-200 text-teal-700 px-1.5 py-0.5 rounded shrink-0">
                                {item.service_code}
                              </span>
                            )}
                            <span className="truncate text-foreground shrink-0">{item.name}</span>
                          </div>
                          <AmountInput
                            value={editingAmountStr}
                            onChange={(raw) => setEditingAmountStr(raw)}
                            placeholder="금액"
                            className="h-6 text-xs w-28 shrink-0"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEditItem(item.id);
                              if (e.key === 'Escape') { setEditingItemId(null); setEditingAmountStr(''); }
                            }}
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveEditItem(item.id)}
                            className="h-6 w-6 flex items-center justify-center rounded text-teal-600 hover:bg-teal-50 shrink-0"
                            title="저장"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => { setEditingItemId(null); setEditingAmountStr(''); }}
                            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted shrink-0"
                            title="취소"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        /* ── 일반 표시 행 ── */
                        <div className="py-0.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {item.service_code && (
                                <span className="font-mono text-[10px] bg-teal-50 border border-teal-200 text-teal-700 px-1.5 py-0.5 rounded shrink-0">
                                  {item.service_code}
                                </span>
                              )}
                              {item.hira_code && (
                                <span className="font-mono text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded shrink-0">
                                  {item.hira_code}
                                </span>
                              )}
                              <span className="truncate text-foreground">{item.name}</span>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0 ml-2">
                              <span className="tabular-nums text-muted-foreground">
                                {formatAmount(item.amount)}
                              </span>
                              <button
                                onClick={() => { setEditingItemId(item.id); setEditingAmountStr(String(item.amount)); }}
                                className="h-6 w-6 hidden group-hover:flex items-center justify-center rounded text-teal-600 hover:bg-teal-50 ml-1"
                                title="수정"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => handleDeleteItem(item.id)}
                                className="h-6 w-6 hidden group-hover:flex items-center justify-center rounded text-red-500 hover:bg-red-50"
                                title="삭제"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          {/* T-20260517-foot-RX-DOSAGE-DYNAMIC: rx_standard 전용 용량/용법/투약일수 입력 */}
                          {template.form_key === 'rx_standard' && (
                            <div className="flex items-center gap-1 mt-1 ml-0.5">
                              <span className="text-[10px] text-muted-foreground shrink-0">{RX_COL.dosage}</span>
                              <Input
                                value={rxItemDosages[item.id]?.unit_dose ?? ''}
                                onChange={(e) => setRxItemDosages((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], unit_dose: rxDigits(e.target.value) },
                                }))}
                                placeholder="1"
                                className="h-5 text-[10px] w-10 px-1 text-center"
                                inputMode="numeric"
                              />
                              <span className="text-[10px] text-muted-foreground shrink-0">{RX_COL.count}</span>
                              <Input
                                value={rxItemDosages[item.id]?.daily_freq ?? ''}
                                onChange={(e) => setRxItemDosages((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], daily_freq: rxDigits(e.target.value) },
                                }))}
                                placeholder="1"
                                className="h-5 text-[10px] w-10 px-1 text-center"
                                inputMode="numeric"
                              />
                              <span className="text-[10px] text-muted-foreground shrink-0">{RX_COL.days}</span>
                              <Input
                                value={rxItemDosages[item.id]?.total_days ?? ''}
                                onChange={(e) => setRxItemDosages((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], total_days: rxDigits(e.target.value) },
                                }))}
                                placeholder="7"
                                className="h-5 text-[10px] w-10 px-1 text-center"
                                inputMode="numeric"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* T-20260513-foot-BILLING-DETAIL-EDIT: 합계금액 자동 표시 */}
                {serviceItems.length > 0 && (
                  <div className="flex items-center justify-between pt-1.5 border-t text-xs font-semibold">
                    <span className="text-muted-foreground">합계</span>
                    <span className="tabular-nums text-teal-700" data-testid="billing-items-total">
                      {formatAmount(serviceItems.reduce((s, item) => s + item.amount, 0))}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* T-20260522-foot-ALT-BADGE AC-13: ALT 활성 시 레이저코드 차단 상태 배너 */}
            {altStatus && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                <div className="text-xs">
                  <span className="font-semibold text-red-700">ALT 활성 — 레이저코드 삽입 차단 중</span>
                  <span className="ml-1.5 text-red-600">보험 반려 대상 고객. 레이저 관련 수가코드 삽입 불가.</span>
                </div>
              </div>
            )}

            {/* T-20260522-foot-ALT-BADGE AC-6: ALT OFF + 패키지 검증 활성 배너 */}
            {!altStatus && activePackage && (activePackage.heated_sessions + activePackage.unheated_sessions) === 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                <div className="text-xs">
                  <span className="font-semibold text-amber-800">패키지 검증 — 레이저코드 삽입 차단 중</span>
                  <span className="ml-1.5 text-amber-700">{activePackage.package_name}에 레이저 회차 없음. 레이저 항목 잘못 삽입 방지.</span>
                </div>
              </div>
            )}
            {!altStatus && activePackage && (activePackage.heated_sessions + activePackage.unheated_sessions) > 0 && (
              (activePackage.heated_sessions === 0 || activePackage.unheated_sessions === 0) && (
                <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                  <div className="text-xs">
                    <span className="font-semibold text-blue-800">패키지 검증 활성</span>
                    <span className="ml-1.5 text-blue-700">
                      {activePackage.package_name} —{' '}
                      {activePackage.heated_sessions === 0
                        ? '온열 레이저 미포함 (온열 코드 삽입 차단)'
                        : '비온열 레이저 미포함 (비온열 코드 삽입 차단)'}
                    </span>
                  </div>
                </div>
              )
            )}

            {/* 비급여 서비스 직접 추가 — E2E 통합 (T-20260507-foot-PATIENT-FLOW-E2E) */}
            {allServices.length > 0 && (
              <div className="rounded-lg border border-dashed border-teal-200 p-3 space-y-2">
                {!addServiceOpen ? (
                  <button
                    type="button"
                    onClick={() => setAddServiceOpen(true)}
                    className="text-[11px] text-teal-700 hover:text-teal-800 flex items-center gap-1 transition"
                  >
                    <span className="text-base font-bold leading-none">+</span>
                    진료 항목 직접 추가 (비급여·레이저·풋케어 등)
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-muted-foreground">진료 항목 추가</div>
                    <select
                      value={addServiceId}
                      onChange={(e) => {
                        setAddServiceId(e.target.value);
                        const s = allServices.find((x) => x.id === e.target.value);
                        if (s) setAddServiceAmountStr(String(s.price));
                      }}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
                    >
                      <option value="">서비스 선택…</option>
                      {allServices.map((s) => {
                        // T-20260522-foot-ALT-BADGE AC-12: ALT ON 시 레이저 서비스 시각적 차단 표시
                        const isBlockedByAlt = altStatus && isLaserService(s);
                        // T-20260522-foot-ALT-BADGE AC-6: ALT OFF + 패키지 미포함 레이저코드 시각적 차단
                        const isBlockedByPkg = !altStatus && isLaserBlockedByPackage(s, activePackage);
                        const isBlocked = isBlockedByAlt || isBlockedByPkg;
                        const blockedLabel = isBlockedByAlt ? ' (ALT 차단)' : isBlockedByPkg ? ' (패키지 미포함)' : '';
                        return (
                          <option
                            key={s.id}
                            value={s.id}
                            disabled={isBlocked}
                            style={isBlocked ? { color: '#9ca3af', fontStyle: 'italic' } : undefined}
                          >
                            {isBlocked ? '🚫 ' : ''}{s.service_code ? `[${s.service_code}] ` : ''}{s.name} — {formatAmount(s.price)}{blockedLabel}
                          </option>
                        );
                      })}
                    </select>
                    <div className="flex gap-2">
                      <Input
                        placeholder="금액 (원)"
                        value={addServiceAmountStr}
                        onChange={(e) => setAddServiceAmountStr(e.target.value)}
                        className="h-7 text-xs flex-1"
                      />
                      {(() => {
                        const selectedSvc = allServices.find((s) => s.id === addServiceId) ?? {};
                        const blockedByAlt = altStatus && isLaserService(selectedSvc);
                        const blockedByPkg = !altStatus && isLaserBlockedByPackage(selectedSvc, activePackage);
                        const isCurrentBlocked = blockedByAlt || blockedByPkg;
                        const blockTitle = blockedByAlt
                          ? 'ALT 활성 — 레이저코드 삽입 불가'
                          : blockedByPkg
                          ? `패키지 미포함 — ${activePackage?.package_name ?? '현재 패키지'}에 해당 레이저 회차 없음`
                          : undefined;
                        return (
                          <Button
                            size="sm"
                            className={`h-7 text-xs whitespace-nowrap ${
                              isCurrentBlocked ? 'bg-red-300 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-700'
                            }`}
                            onClick={handleAddService}
                            disabled={!addServiceId || addingService || isCurrentBlocked}
                            title={blockTitle}
                          >
                            {addingService ? '추가 중…' : isCurrentBlocked ? '차단됨' : '추가'}
                          </Button>
                        );
                      })()}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => { setAddServiceOpen(false); setAddServiceId(''); setAddServiceAmountStr(''); }}
                      >
                        취소
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 복수 근무원장님 선택 배너 */}
            {dutyDoctors.length > 1 && (
              <div className="rounded-lg bg-teal-50 border border-teal-200 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-800">
                  <UserCheck className="h-3.5 w-3.5" />
                  서류 발행 원장님 선택
                </div>
                <div className="flex flex-wrap gap-2">
                  {dutyDoctors.map((d) => (
                    <button
                      key={d.id}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                        selectedDoctorName === d.name
                          ? 'border-teal-500 bg-teal-600 text-white'
                          : 'border-teal-300 text-teal-700 hover:bg-teal-100'
                      }`}
                      onClick={() => setSelectedDoctorName(d.name)}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* T-20260516-foot-CLINIC-DOC-INFO: 다중 의사 등록 시 면허번호 기준 의사 선택 */}
            {clinicDoctors.length > 1 && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-800">
                  <Stethoscope className="h-3.5 w-3.5" />
                  면허번호·직인 기준 의사 선택
                </div>
                <div className="flex flex-wrap gap-2">
                  {clinicDoctors.map((d) => (
                    <button
                      key={d.id}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                        selectedClinicDoctorId === d.id
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-blue-300 text-blue-700 hover:bg-blue-100'
                      }`}
                      onClick={() => setSelectedClinicDoctorId(d.id)}
                    >
                      {d.name}
                      {d.is_default && <span className="ml-1 opacity-70">★</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* T-20260719-foot-BILLRECEIPT-NEWFORM-ITEMFIX AC-③: 진료비 계산서·영수증 신양식 전용 —
                이미 납부한 금액을 미리 입력해 서류에 반영(사전 출력). 비영속(payments 수납 아님) 표시 전용. */}
            {template.form_key === 'bill_receipt_new' && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-1.5">
                <Label className="text-xs font-semibold text-emerald-800">
                  납부금액(사전입력)
                </Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={prepaidAmount}
                  onChange={(e) => setPrepaidAmount(e.target.value)}
                  placeholder="예: 30,000 (미입력 시 공란)"
                  className="text-sm bg-white"
                />
                <p className="text-[10px] text-emerald-700 leading-tight">
                  입력한 금액이 ⑪ 납부한 금액·납부하지 않은 금액(⑩-⑪)란에 반영되어 출력됩니다. 실제 수납 기록과는 무관한 표기용 값입니다.
                </p>
              </div>
            )}

            {/* T-20260723-foot-DOCCONFIRM-SERIAL-ENDDATE-PURPOSE ②: 용도 선택을 주 발급 동선에 승격.
                기존 [수정] 팝업(DocFormSettingsDialog)에만 있던 용도 칩(3종)+자유입력을 발급 폼에 바로 노출 →
                그냥 출력해도 {{purpose}} 공란 방지. 확인서는 비게이트 서류라 사용 가능(소견서·진단서 제외).
                ★향후치료의견(treatment_opinion) 재노출 아님 — 용도(purpose)만(총괄 VISITCERT-DISEASE-FUTURETX-HIDE 존중). */}
            {['treat_confirm_code', 'treat_confirm_nocode', 'treat_confirm', 'visit_confirm'].includes(template.form_key) && (
              <div className="rounded-lg bg-teal-50 border border-teal-200 p-3 space-y-2">
                <Label className="text-xs font-semibold text-teal-800">서류 용도</Label>
                <div className="flex flex-wrap gap-1.5">
                  {DOC_PURPOSE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      data-testid={`docprint-purpose-${opt}`}
                      className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all min-h-[40px] ${
                        (allValues.purpose ?? '') === opt
                          ? 'border-teal-400 bg-teal-100 text-teal-800 ring-1 ring-teal-300'
                          : 'border-gray-200 bg-white text-muted-foreground hover:border-teal-300 hover:text-teal-700'
                      }`}
                      onClick={() => updateField('purpose', opt)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <Input
                  value={allValues.purpose ?? ''}
                  onChange={(e) => updateField('purpose', e.target.value)}
                  placeholder="직접 입력 (예: 학교 제출용)"
                  className="text-sm bg-white"
                  data-testid="docprint-purpose-input"
                />
              </div>
            )}

            <div className="space-y-3">
              {editableFields.map((f) => {
                const val = allValues[f.key] ?? '';
                // doctor_name: 단일 자동 세팅이면 자동 뱃지, 복수면 위 배너에서 처리
                const isAuto =
                  f.key === 'doctor_name'
                    ? dutyDoctors.length === 1
                    : f.key in autoValues && autoValues[f.key] !== '';
                return (
                  <div key={f.key}>
                    <Label className="text-xs flex items-center gap-1">
                      {f.label}
                      {isAuto && (
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 py-0 text-teal-600 border-teal-300"
                        >
                          {f.key === 'doctor_name' ? '근무캘린더' : '자동'}
                        </Badge>
                      )}
                    </Label>
                    {f.type === 'multiline' ? (
                      <Textarea
                        value={val}
                        onChange={(e) => updateField(f.key, e.target.value)}
                        placeholder={f.label}
                        rows={3}
                        className="text-sm mt-1"
                      />
                    ) : (
                      <Input
                        type={f.type === 'date' ? 'date' : 'text'}
                        value={val}
                        onChange={(e) => {
                          if (f.key === 'doctor_name' && dutyDoctors.length > 1) {
                            setSelectedDoctorName(e.target.value);
                          } else {
                            updateField(f.key, e.target.value);
                          }
                        }}
                        placeholder={f.label}
                        className="text-sm mt-1"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {/* T-20260611-foot-DOC-REISSUE-CONTENT-MISSING: 콘텐츠 4소스 로드 완료(billingReady)
                전까지 미리보기/인쇄 차단 → 빈 내용 스냅샷 저장/출력 방지. */}
            {(template.template_format !== 'pdf') && (
              <Button variant="outline" size="sm" className="gap-1" onClick={renderPreview} disabled={!billingReady}>
                <Eye className="h-3.5 w-3.5" /> 미리보기
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button
              onClick={handlePrint}
              disabled={saving || !billingReady}
              className="gap-1 bg-teal-600 hover:bg-teal-700"
            >
              <Printer className="h-3.5 w-3.5" />
              {!billingReady ? '불러오는 중…' : saving ? '발행 중…' : '인쇄'}
            </Button>
            {/* T-20260629-foot-DOCPRINT-EDIT-BTN: [출력=인쇄] 옆 [수정] — 공통 설정/편집 팝업 진입(§2#4). */}
            <Button
              variant="outline"
              className="gap-1"
              onClick={() => setSettingsOpen(true)}
              data-testid="docprint-edit-btn"
            >
              <Pencil className="h-3.5 w-3.5" /> 수정
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PreviewDialog
        template={template}
        fieldValues={allValues}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />

      {/* T-20260629-foot-DOCPRINT-EDIT-BTN: 서류 설정/편집 팝업 (DOCFORM §2#4 canonical 공통 컴포넌트 재사용) */}
      <DocFormSettingsDialog
        template={template}
        checkIn={checkIn}
        staffId={staffId}
        baseFieldData={allValues}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialValues={{
          purpose: allValues.purpose ?? '',
          issue_date: allValues.issue_date ?? '',
          remarks: allValues.remarks ?? allValues.remark ?? '',
        }}
        onApplied={(edited) =>
          setEditOverrides((prev) => ({
            ...prev,
            purpose: edited.purpose,
            issue_date: edited.issue_date,
            remarks: edited.remarks,
            remark: edited.remarks, // {{remark}}(단수) 양식 동시 반영
          }))
        }
      />
    </>
  );
}

// ─── 미리보기 다이얼로그 ───

function PreviewDialog({
  template,
  fieldValues,
  open,
  onOpenChange,
}: {
  template: FormTemplate;
  fieldValues: Record<string, string>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // T-20260514-foot-FORM-CLARITY-REWORK: HTML/CSS 디지털 양식 미리보기
  if (template.template_format === 'html' || isHtmlTemplate(template.form_key)) {
    const htmlTpl = getHtmlTemplate(template.form_key);
    if (!htmlTpl) return null;
    const boundHtml = bindHtmlTemplate(htmlTpl, fieldValues);
    const isLandscape = template.form_key === 'bill_detail';

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={`${isLandscape ? 'max-w-5xl' : 'max-w-2xl'} max-h-[90vh] overflow-y-auto p-0`}
        >
          <DialogHeader className="px-4 pt-4">
            <DialogTitle className="text-sm flex items-center gap-2">
              미리보기 — {template.name_ko}
              <span className="text-xs text-teal-600 bg-teal-50 border border-teal-200 rounded px-1.5 py-0.5">
                HTML/CSS 디지털 양식
              </span>
            </DialogTitle>
          </DialogHeader>
          <div
            ref={containerRef}
            className="mx-4 mb-4 border rounded-lg overflow-auto bg-white shadow-sm"
            data-testid="html-form-preview"
            // dangerouslySetInnerHTML: 신뢰된 내부 HTML 템플릿 (외부 입력 아님)
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: boundHtml }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  // 기존 PNG/JPG 이미지 오버레이 방식
  const imgUrl = getTemplateImageUrl(template.form_key);
  const hasCoords = template.field_map.length > 0;

  if (!imgUrl) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="text-sm">미리보기 — {template.name_ko}</DialogTitle>
        </DialogHeader>
        <div
          ref={containerRef}
          className="relative mx-4 mb-4 border rounded-lg overflow-hidden bg-white"
        >
          <img src={imgUrl} alt={template.name_ko} className="w-full h-auto" />

          {/* 필드 오버레이 */}
          {hasCoords &&
            template.field_map.map((f) => {
              const val = fieldValues[f.key] ?? '';
              if (!val) return null;
              return (
                <div
                  key={f.key}
                  style={{
                    position: 'absolute',
                    left: `${f.x}px`,
                    top: `${f.y}px`,
                    width: f.w ? `${f.w}px` : undefined,
                    height: f.h ? `${f.h}px` : undefined,
                    fontSize: `${f.font ?? 14}px`,
                    fontFamily: "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
                    color: '#000',
                    lineHeight: 1.4,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {val}
                </div>
              );
            })}

          {/* T-20260601-foot-DOC-PRINT-8FIX REOPEN2 AC-1: 우하단 고정 도장 미리보기 제거
              (직인은 doctor_seal_html로 일원화 — 레거시 이미지 양식 미리보기 경로) */}

          {!hasCoords && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/5">
              <div className="bg-white/90 rounded-lg px-4 py-3 text-sm text-muted-foreground shadow-sm">
                좌표 미설정 — 원본 양식만 표시됩니다
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── 진료비 영수증 등록 다이얼로그 (T-20260509-foot-CHART1-LAYOUT-REAPPLY) ───

function InvoiceDialog({
  checkIn,
  open,
  onOpenChange,
  onSaved,
}: {
  checkIn: CheckIn;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [receiptNo, setReceiptNo] = useState('');
  const [insuranceCovered, setInsuranceCovered] = useState(0);
  const [nonCovered, setNonCovered] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  // T-20260524-foot-INS-DOC-COPAY-LINK: insurance_claims draft 자동채움 여부
  const [autoFilledFromClaim, setAutoFilledFromClaim] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 다이얼로그 열릴 때 항상 초기화
    setReceiptNo('');
    setInsuranceCovered(0);
    setNonCovered(0);
    setPaidAmount(0);
    setFile(null);
    setAutoFilledFromClaim(false);

    // insurance_claims draft 조회 → 급여(공단+본인) 자동채움
    (async () => {
      const { data: claim } = await supabase
        .from('insurance_claims')
        .select('total_covered, total_copayment, total_base')
        .eq('check_in_id', checkIn.id)
        .eq('claim_status', 'draft')
        .maybeSingle();

      if (claim) {
        // T-20260524-foot-INS-DOC-COPAY-LINK FIX: 급여(공단+본인) = total_covered + total_copayment
        setInsuranceCovered((claim.total_covered ?? 0) + (claim.total_copayment ?? 0));
        // 비급여: service_charges 비급여 합산
        const { data: charges } = await supabase
          .from('service_charges')
          .select('base_amount, is_insurance_covered')
          .eq('check_in_id', checkIn.id);
        if (charges) {
          const nonCoveredSum = charges
            .filter((c) => !c.is_insurance_covered)
            .reduce((s, c) => s + ((c.base_amount as number) ?? 0), 0);
          if (nonCoveredSum > 0) setNonCovered(nonCoveredSum);
        }
        setAutoFilledFromClaim(true);
      }
    })();
  }, [open, checkIn.id]);

  const handleSave = async () => {
    if (paidAmount <= 0) {
      toast.error('납부액을 입력해주세요');
      return;
    }
    setSaving(true);

    let pdfUrl: string | null = null;
    if (file) {
      const path = `receipts/${checkIn.id}/invoice_${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(path, file, { contentType: file.type });
      if (upErr) {
        toast.error(`파일 업로드 실패: ${upErr.message}`);
        setSaving(false);
        return;
      }
      const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600 * 24 * 365);
      pdfUrl = data?.signedUrl ?? path;
    }

    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from('insurance_receipts').insert({
      clinic_id: checkIn.clinic_id,
      check_in_id: checkIn.id,
      customer_id: checkIn.customer_id,
      receipt_type: 'detail',
      receipt_no: receiptNo || null,
      consult_amount: 0,
      treatment_amount: paidAmount,
      insurance_covered: insuranceCovered,
      non_covered: nonCovered,
      total_amount: insuranceCovered + nonCovered,
      paid_amount: paidAmount,
      pdf_url: pdfUrl,
      issue_date: today,
    });

    setSaving(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success('진료비 영수증 등록 완료');
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-amber-600" /> 진료비 영수증 등록
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">영수증 번호 (선택)</Label>
            <Input
              value={receiptNo}
              onChange={(e) => setReceiptNo(e.target.value)}
              placeholder="선택사항"
              className="text-sm mt-1"
            />
          </div>

          {/* T-20260524-foot-INS-DOC-COPAY-LINK: 자동채움 안내 뱃지 */}
          {autoFilledFromClaim && (
            <div className="flex items-center gap-1.5 rounded-md bg-teal-50 border border-teal-200 px-2.5 py-1.5 text-xs text-teal-700">
              <Check className="h-3 w-3 shrink-0" />
              산출 결과에서 불러왔습니다 (수정 가능)
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">급여 (공단+본인)</Label>
              <AmountInput
                value={insuranceCovered}
                onChange={(raw) => setInsuranceCovered(Number(raw) || 0)}
                placeholder="0"
                className="text-sm mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">비급여</Label>
              <AmountInput
                value={nonCovered}
                onChange={(raw) => setNonCovered(Number(raw) || 0)}
                placeholder="0"
                className="text-sm mt-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">실제 납부액 <span className="text-red-500">*</span></Label>
            <AmountInput
              value={paidAmount}
              onChange={(raw) => setPaidAmount(Number(raw) || 0)}
              placeholder="0"
              className="text-sm mt-1 font-semibold"
            />
          </div>

          {(insuranceCovered + nonCovered) > 0 && (
            <div className="text-xs text-muted-foreground text-right">
              총액: {formatAmount(insuranceCovered + nonCovered)}
            </div>
          )}

          <div>
            <Label className="text-xs">영수증 파일 (선택)</Label>
            <label className="cursor-pointer block mt-1">
              <input
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button variant="outline" size="sm" className="w-full gap-1 text-xs pointer-events-none">
                <Upload className="h-3 w-3" />
                {file ? file.name : '파일 선택 (선택)'}
              </Button>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '저장 중…' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
