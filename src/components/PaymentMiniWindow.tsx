// LOGIC-LOCK: L-006 — 서류출력 경로 통일. Zone 3 서류발행(PATH-4) 단일 출력 경로. 변경 시 현장 승인 필수

/**
 * PaymentMiniWindow — 풋센터 결제 미니창 (모달)
 *
 * T-20260515-foot-PAYMENT-MINI-WINDOW  기본 구현 (closed ba5c866)
 * T-20260517-foot-PAYMENT-MENU-REVAMP  좌측 메뉴 3탭 재구성 + 풋케어 4×5 그리드
 * T-20260517-foot-PAY-SLOT-MOVE        슬롯 이동 버그 수정 + iframe 인쇄 (중복 창 제거)
 * T-20260517-foot-PAY-CASH-RECEIPT     현금영수증 체크박스 + 일일마감 연동
 * T-20260517-foot-PREPAID-DEDUCT       선수금차감 듀얼 버튼 + 보라색 선택박스 + 2번차트 자동매칭
 * T-20260517-foot-BILLING-3ZONE        진료비 산정 3구역 레이아웃 + 서류발행 패키지/시술이력 연동
 * T-20260517-foot-DOC-CODE-INSERT      상병코드/처방약 → 서류 양식 자동 삽입 (AC-1~AC-4)
 * T-20260519-foot-PKG-REVENUE-SPLIT    패키지 차감건 매출 이중계상 수정 (AC-1~AC-5)
 *   - 적용 경로 역전 해소: deductMode에서 잔액은 실제 결제수단(card/cash/transfer) 사용
 *   - is_package_session=true 마킹: 선수금차감 항목은 패키지 세션으로 DB 기록
 *   - 전액 패키지 차감(잔액=0)만 method='membership' 사용 (payment 레코드 확인용)
 * T-20260609-foot-TRIAL-REVENUE-ZERO   체험권(trial) 선수금차감 제외 — 항상 단건 매출 (A안)
 *   - 체험권은 단일회차 즉시결제 상품: 선수금차감(prepaid deduct) 대상에서 영구 제외
 *   - is_package_session=false · 실금액 · tax_type≠선수금 으로 기록 → 매출 증발 방지
 *   - 다회차 4종(가열/비가열/포돌로게/수액) 차감제외 동작은 무영향(AC-4 보존)
 *   - 결정: 김주연 총괄(U0ATDB587PV) 2026-06-10T06:47 KST
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { toast } from '@/lib/toast';
import {
  Check,
  ChevronRight,
  ChevronDown,
  Clock,
  CreditCard,
  FileText,
  Layers,
  Printer,
  Plus,
  Square,
  CheckSquare,
  Trash2,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RX_COL, rxDigits } from '@/lib/rxFormat';
import { supabase } from '@/lib/supabase';
// T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1 경로B): 교부번호 14자리 발번(UUID-slice 폐기).
import { buildIssueNo, splitIssueNoForDisplay } from '@/lib/docSerial';
import { useAuth } from '@/lib/auth';
import { applyStatusFlagTransition } from '@/lib/statusFlagTransition';
import { promoteVisitTypeToReturning } from '@/lib/visitType';
import { formatAmount, todaySeoulISODate, chartNoBadge } from '@/lib/format';
// T-20260525-foot-AMOUNT-COMMA-FMT: 수가 인라인 편집 쉼표 포맷팅
import { formatAmountDisplay, parseAmountRaw } from '@/components/ui/AmountInput';
import type { CheckIn, Service } from '@/lib/types';
// T-20260719-foot-DOCHIST-MULTIPATH-EXTEND item②: 결제 미니창 발행이력 조회+재출력 —
//   1번차트(CheckInDetailSheet) 기준점과 동일 컴포넌트/데이터소스 재사용(경로별 별도구현 금지).
//   checkIn(방문) 스코프 = form_submissions.check_in_id 필터 = 그 결제 대상 방문 서류만(전체이력 아님).
import { DocumentPrintPanel } from '@/components/DocumentPrintPanel';
// T-20260526-foot-COPAY-MINI-BUG: 건보 등급 기반 급여 분류
import { type InsuranceGrade, getBaseCopayRate, copayBasisText } from '@/lib/insurance';
import {
  FALLBACK_TEMPLATES,
  INSURANCE_FALLBACK_TEMPLATES,
  FORM_META,
  orderDocList,
  getTemplateImageUrl,
  type FormTemplate,
  type FieldMapEntry,
} from '@/lib/formTemplates';
import {
  bindHtmlTemplate,
  buildBillDetailItemsHtml,
  buildBillReceiptFeeGridHtml,
  buildRxItemsHtml,
  getHtmlTemplate,
  isHtmlTemplate,
} from '@/lib/htmlFormTemplates';
import { loadAutoBindContext, applyBillingFallback } from '@/lib/autoBindContext';
// T-20260710-foot-RRN-REGISTER-ERR-ISSUE-FROMCHART2 AC2: 발급 직전 미저장 2번차트 저장 가드
import { ensureChartSavedBeforePublish } from '@/lib/unsavedGuard';
// T-20260620-foot-MEDDOC-DESK-PRINTONLY-DOCTOR-AUTHORED: 소견서·진단서 = 원장 발행본 출력만(데스크 작성 불가).
import { useClinicHeader } from '@/components/doctor/OpinionDocTab';
import {
  useAuthoredMedDocs,
  printAuthoredMedDoc,
  isGatedMedDoc,
  medDocFormKeyToDocType,
} from '@/lib/medDocPrintGate';
// T-20260608-foot-DOC-PATH12-SYNC: 세금/급여 분류·코드항목 판별을 4경로 공유 SSOT(footBilling)로 일원화.
//   (PMW 로컬 정의 → 공유 모듈 이전. DocumentPrintPanel(PATH-1/2/3)이 동일 로직 재사용 → 드리프트 차단.)
import {
  type TaxClass,
  COVERED_GRADES,
  getTaxClass,
  isCodeItem,
  // T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT: 세금구분/급여·본인부담 산출을 배포된 SSOT로 일원화.
  //   수납잔액(본인부담금+비급여) 산출을 위해 PMW 인라인 계산 대신 computeFootBilling 재사용
  //   (병렬 계산 경로 신설 금지 — grade=null 시 본인=급여전액/공단=0 DOCPRINT-RECUR 규칙까지 동일 수렴).
  computeFootBilling,
  // T-20260620-foot-PMW-OUTSTANDING-PREFILL: 미수금(잔금) 산출은 PKG-OUTSTANDING-BALANCE SSOT 재사용 (신규 쿼리/산출 금지).
  loadCustomerOutstanding,
  hasOutstandingDue,
  type CustomerOutstanding,
  // T-20260706-foot-DOCPRINT-FEEBREAKDOWN-INSURANCE-BLANK: grade null 시 저장 등급 폴백(PATH-4 수렴).
  loadEffectiveInsuranceGrade,
  // T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR: bill_detail 급여구분/본인·공단 split SSOT
  //   (DocumentPrintPanel PATH-1/2/3 와 동일 빌더 재사용 — PMW inline 빌더의 급여구분 공란 RC 해소).
  buildFootBillDetailItems,
  computeBillDetailRounding,
  // T-20260721-foot-BILLDOC-COPAY-PMW-REMAIN 단계 A/B: 신양식(bill_receipt_new) 비급여 category 토큰
  //   주입 SSOT(footBilling 승격) — DPP 와 동일 인자로 소비해 결제미니창 인쇄 시 처치/검사 행 공란 해소.
  applyBillReceiptNewCategoryTokens,
  // T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX: 결함A(급여 category remainder)·결함B(납부박스 payments groupBy).
  applyBillReceiptNewCoveredTokens,
  applyBillReceiptPaidBoxTokens,
  type FootBillingItem,
} from '@/lib/footBilling';
// T-20260612-foot-MEDLAW22-B-GATE → T-20260708-foot-PAYMINI-INSURANCE-CHARTREQ-UNBLOCK:
//   결제 미니창 급여 수납의 진료기록/방문일 연동 하드차단 완전 해제(reporter=김주연 총괄 결정).
//   evaluateMedicalRecordGate 는 급여(isCovered) 판정에만 재사용 — 비차단 soft 리마인더용.
//   차단(blocked)·방문일 매칭은 수납 흐름에서 더 이상 사용하지 않음(계좌이체 등 비내원일 수납 허용).
import { evaluateMedicalRecordGate } from '@/lib/medicalRecordGate';
import { InsuranceResettlePanel } from '@/components/insurance/InsuranceResettlePanel';
// T-20260525-foot-FEE-ITEM-REORDER: 수가 항목 DnD 재배열 (AC-1, AC-5)
// REOPEN: PointerSensor 우선 → overflow-y-auto 스크롤 충돌 해소 (AC-R2, AC-R3)
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── 세금 구분 ────────────────────────────────────────────────────────────────

// T-20260608-foot-DOC-PATH12-SYNC: TaxClass / COVERED_GRADES / getTaxClass 는
//   @/lib/footBilling 로 이전(4경로 공유 SSOT). 동작 1:1 동일.

// ── 탭 + 카테고리 매핑 ──────────────────────────────────────────────────────
// T-20260517-foot-PAYMENT-MENU-REVAMP: 탭 3종 재구성
// 구: [풋케어 / 처방약 / 화장품]  →  신: [상병코드 / 처방약 / 풋케어]

const TAB_LABELS = ['상병코드', '처방약', '풋케어'] as const;
type TabLabel = (typeof TAB_LABELS)[number];

const TAB_CATEGORY_MAP: Record<TabLabel, string[]> = {
  상병코드: ['상병'],
  처방약: ['처방약'],
  풋케어: ['기본', '검사', '풋케어', '수액', '풋화장품'],
};

// 풋케어 4대 서브 카테고리 (AC-4: 4×5 그리드)
const FOOTCARE_CATS = ['기본(진찰료)', '시술내역(풋케어)', '수액', '화장품'] as const;
type FootCatType = (typeof FOOTCARE_CATS)[number];

const FOOTCARE_CAT_LABELS: Record<FootCatType, string[]> = {
  '기본(진찰료)': ['기본', '검사'],
  '시술내역(풋케어)': ['풋케어'],
  '수액': ['수액'],
  '화장품': ['풋화장품'],
};

// AC-4: 스크롤 리스트 — 페이지네이션 제거

// isCodeItem 은 @/lib/footBilling 로 이전 (T-20260608-foot-DOC-PATH12-SYNC, 동작 1:1 동일).

// ── 선수금차감 2-tier 자동 매칭 ──────────────────────────────────────────────
// T-20260517-foot-PREPAID-DEDUCT AC-3 확정 기준
// '비가열'이 '가열'의 상위집합(superstring)이므로 비가열을 먼저 체크해야 잘못 매칭 방지
const PREPAID_KEYWORDS = ['비가열', '가열', '포돌로게', '수액'] as const;
const PREPAID_CODE_MAP: Record<string, string[]> = {
  가열: ['SZ035-35'],
  비가열: ['SZ035-30'],
  포돌로게: ['BC1300MB08'],
};
// 수액은 코드가 없으므로 category 기반 매칭

// ── 체험권(trial) 판별 ───────────────────────────────────────────────────────
// T-20260609-foot-TRIAL-REVENUE-ZERO (A안): 체험권은 단일회차 즉시결제 상품으로
// 선수금차감(prepaid deduct) 대상에서 항상 제외 → 매출 증발/오분류 방지.
// 진단 시그니처(check_in_services.service_name /체험/)와 동일 기준 사용.
export const isTrialService = (svc: { name?: string | null } | null | undefined): boolean =>
  /체험/.test(svc?.name ?? '');

// T-20260703-foot-JONGNO-PACKAGE-TRIPLE-DEFECT (c):
//   선수금차감 대상 서비스 → package_sessions.session_type 역매핑.
//   PREPAID_CODE_MAP / PREPAID_KEYWORDS 와 동일 기준(코드 우선, '비가열'을 '가열'보다 먼저 판정).
//   preconditioning/reborn/trial 은 선수금차감 자동대상(PREPAID_KEYWORDS)이 아니므로 null.
export const prepaidSessionType = (
  svc: { service_code?: string | null; name?: string | null; category?: string | null; category_label?: string | null },
): 'heated_laser' | 'unheated_laser' | 'iv' | 'podologue' | null => {
  const code = svc.service_code ?? '';
  const name = svc.name ?? '';
  const cat = `${svc.category_label ?? ''} ${svc.category ?? ''}`;
  if (code === 'SZ035-30' || name.includes('비가열')) return 'unheated_laser';
  if (code === 'SZ035-35' || (name.includes('가열') && !name.includes('비가열'))) return 'heated_laser';
  if (code === 'BC1300MB08' || name.includes('포돌로게')) return 'podologue';
  if (cat.includes('수액') || name.includes('수액')) return 'iv';
  return null;
};

// ── 결제수단 ────────────────────────────────────────────────────────────────

// T-20260522-foot-PAY-DROPDOWN-LONGRE: 롱레 CRM 정합성 — membership 추가
type PayMethod = 'card' | 'cash' | 'transfer' | 'membership';

// T-20260522-foot-PAY-DROPDOWN-LONGRE Phase2: 라벨 멤버십→패키지 (DB value 'membership' 유지)
const METHOD_OPTIONS: { value: PayMethod; label: string }[] = [
  { value: 'card', label: '카드' },
  { value: 'cash', label: '현금' },
  { value: 'transfer', label: '이체' },
  { value: 'membership', label: '패키지' },
];

// ── 수가세트 타입 (fee_set_templates) ──────────────────────────────────────
// T-20260525-foot-FEE-SET-TEMPLATE AC-1

interface FeeSetTemplateItem {
  service_id: string;
  sort_order: number;
}

interface FeeSetTemplate {
  id: string;
  set_name: string;
  items: FeeSetTemplateItem[];
}

// ── 선택 항목 ───────────────────────────────────────────────────────────────

interface SelectedItem {
  service: Service;
  qty: number;
}

// ── draft persist (localStorage) ─────────────────────────────────────────────
// T-20260515-foot-PAYMENT-CODE-PERSIST

interface DraftItem {
  serviceId: string;
  qty: number;
}

function draftKey(checkInId: string): string {
  return `payment-draft-${checkInId}`;
}

// ── 인쇄 유틸 — iframe 방식 (PAY-SLOT-MOVE AC-4: 중복 창 제거) ───────────────

// T-20260521-foot-DOC-PRINT-UNIFY PUSH: CSS를 DocumentPrintPanel openBatchPrintWindow와 동일하게 통일.
// 경로 4 = 1순위 메인 출력 경로 — 레이아웃이 경로 1(openBatchPrintWindow)과 완전 동일해야 함.
// AC-5: forceLandscape=true 시 @page { size: A4 landscape } 적용 (진료비세부산정내역 전용).
//
// T-20260629-foot-DOCPRINT-CENTER-ALIGN(REOPEN/AC-5): [버그] 직전 DOCOUTPUT-PRINT-CENTER-LAYOUT 가
//   openBatchPrintWindow(경로1)·printOpinionDoc 만 "@page 엔진 여백 중앙배치" 모델로 전환하고 본 buildPrintHtml
//   (경로4=1순위)는 구 @page:0 / 전폭(210·297mm) full-bleed 모델로 방치 → 동일 form-wrap(margin:0 auto)이
//   엔진 shrink-to-fit 으로 좌·상단 앵커 → 현장이 본 상단 쏠림. 두 경로가 "완전 동일" 해야 한다는 본 함수 계약 위반.
//   [수정] openBatchPrintWindow 와 동일한 분기로 통일:
//     - isLegacyImg(page-img 오버레이, field_map px 좌표가 210mm page 기준): @page:0 / 전폭 .page 유지(불변).
//     - HTML 양식: 물리여백(상30·좌우10·하12mm)으로 상단 +68px 하향 + 콘텐츠박스(portrait 190×255 / landscape 277×168mm).
// T-20260702-foot-DOCPRINT-BROWSERHEADER-REMOVE: 브라우저 자동 헤더 제거를 위해 위 물리여백을 @page margin(비-0)에서
//   @page margin:0 + .page padding 으로 이관(경로1과 완전 동일). 물리 위치 불변 → 중앙배치 회귀 없음.
function buildPrintHtml(pages: string[], title: string, forceLandscape = false): string {
  const isLegacyImg = pages.some((p) => p.includes('page-img'));
  if (isLegacyImg) {
    // IMG 오버레이 격리: field_map px 좌표가 210mm page 기준 → 전폭 full-bleed + @page:0 유지(좌표 불변).
    const pageRule = forceLandscape
      ? '@page { size: A4 landscape; margin: 0; }'
      : '@page { size: A4 portrait; margin: 0; }';
    const pageWidth  = forceLandscape ? '297mm' : '210mm';
    const pageHeight = forceLandscape ? '210mm' : '297mm';
    return `<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>${title}</title>
<style>
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
  }
</style>
</head><body>${pages.join('\n')}</body></html>`;
  }
  // HTML 양식(L-006 12종) — 콘텐츠 물리 여백으로 중앙 배치 + 상단 23mm(AC-6, 경로1과 동일).
  // T-20260702-foot-DOCPRINT-BROWSERHEADER-REMOVE: 경로1(openBatchPrintWindow)과 완전 동일하게
  //   @page margin:0(브라우저 자동 헤더 제거) + 물리여백을 .page padding 으로 이관. 두 경로 "완전 동일" 계약 유지.
  const pageRule = forceLandscape
    ? '@page { size: A4 landscape; margin: 0; }'
    : '@page { size: A4 portrait; margin: 0; }';
  const pageW = forceLandscape ? '297mm' : '210mm';
  const pageH = forceLandscape ? '210mm' : '297mm';
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>${title}</title>
<style>
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
    .page:last-child { page-break-after: avoid; }
  }
</style>
</head><body>${pages.join('\n')}</body></html>`;
}

/** T-20260517-foot-RX-DOSAGE-DYNAMIC: 처방 기본 용량/용법/투약일수 (미입력 시 1/1/7) */
interface RxDosage {
  unit_dose: string;
  daily_freq: string;
  total_days: string;
}

/**
 * T-20260517-foot-DOC-CODE-INSERT: 선택된 상병코드/처방약 코드를 fieldValues에 주입.
 * - 상병코드(category_label='상병') → diag_code_N / diag_name_N (N=1~)
 *   적용 양식: diagnosis, diag_opinion, treat_confirm, visit_confirm, rx_standard,
 *             ins_claim_form (T-20260525-foot-INS-FIELD-BIND AC-1) 포함 전 양식
 * - 처방약(category_label='처방약') → rx_items_html (rx_standard 전용)
 * - 상병코드는 rx_standard의 질병분류기호(diag_code_N)에도 동일 주입
 * T-20260517-foot-RX-DOSAGE-DYNAMIC: per-item rxItemDosages 주입으로 하드코딩 1/1/7 해소
 *   - rxItemDosages: service.id → { unit_dose, daily_freq, total_days }
 *   - 미입력 항목은 각각 1/1/7 fallback
 */
/**
 * T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST 경로B / DA 경보 MSG-k7iz / ★L-006 현장승인 2026-07-18):
 *   결제창(PATH-4) 발행 = **persist-before-print**. 인쇄 전에 form_submissions 를 INSERT 하고, 처방전 교부번호(issue_no)를
 *   발행 시점 1회 채번(issue_foot_rx_issue_no RPC = per-(clinic,date) 원자 발번, 멱등 키=form_submission_id)해서
 *   field_data 에 persist 한다 → 재인쇄/익일 인쇄 시 동일 교부번호(불변, print-time 재계산 결함 제거).
 *   ⚠ 순서재편(구 print-first→insert(fire&forget) → persist-first)은 L-006('서류출력 경로 통일, 변경 시 현장승인 필수')
 *      저촉 → 김주연 총괄 현장승인("웅 진행ㄱ", MSG-51e0 ts 1784359275.956699, 2026-07-18) 하에 시행.
 *   반환 = 인쇄본에 주입할 확정 교부번호 문자열(rxIssueNo). rx 미포함 → null(issue_no 미채번).
 *     fallback/미staff(발행이력 persist 불가) → 순번만 채번(persist 없이 공란/UUID 방지, DocumentPrintPanel 경로A 동형).
 *   ⚠ 8+N 파라미터화(buildIssueNo/ISSUE_NO_SEQ_WIDTH) 계승 — N 하드코딩 금지(총괄확정 6/14 vs 심평원 5/13 검증 중).
 */
async function persistSubmissionsAndResolveIssueNo(params: {
  selected: FormTemplate[];
  clinicId: string | null;
  checkInId: string;
  customerId: string | null;
  staffId: string | null;
  autoValues: Record<string, string>;
  codeItems: SelectedItem[];
  rxItemDosages?: Record<string, RxDosage>;
  isFallback: boolean;
}): Promise<string | null> {
  const { selected, clinicId, checkInId, customerId, staffId, autoValues, codeItems, rxItemDosages, isFallback } = params;
  const hasRx = selected.some((t) => t.form_key === 'rx_standard');
  const issueYmd = format(new Date(), 'yyyyMMdd');    // 교부번호 앞 8자리(YYYYMMDD)
  const issueDateIso = format(new Date(), 'yyyy-MM-dd'); // RPC p_issue_date(date) 파티션 키
  const nowIso = new Date().toISOString();

  // fallback/미staff: 발행이력 INSERT 불가 → 순번만 채번(persist 없이 공란/UUID 방지). rx 없으면 발번 불요.
  if (isFallback || !staffId) {
    if (!hasRx || !clinicId) return null;
    const { data: rxSeq } = await supabase.rpc('issue_foot_rx_issue_no', {
      p_clinic_id: clinicId,
      p_issue_date: issueDateIso,
      p_form_submission_id: null,
    });
    return buildIssueNo(issueYmd, typeof rxSeq === 'number' ? rxSeq : 1) || null;
  }

  // 1) form_submissions INSERT 먼저(issue_no 미포함 field_data) — persist-before-print. 선택 서류 전종 이력 기록(종전과 동일).
  const submissionRows = selected.map((t) => ({
    clinic_id: clinicId,
    template_id: t.id,
    check_in_id: checkInId,
    customer_id: customerId,
    issued_by: staffId,
    field_data: buildCodeEnrichedValues(autoValues, codeItems, t.form_key, rxItemDosages, null),
    status: 'printed' as const,
    printed_at: nowIso,
  }));
  const { data: insertedRows, error: insErr } = await supabase
    .from('form_submissions')
    .insert(submissionRows)
    .select('id, template_id');
  if (insErr) {
    console.warn('[DOC-PRINT-UNIFY] form_submissions 기록 실패:', insErr.message);
  }

  if (!hasRx || !clinicId) return null;

  // 2) 처방전 행 교부번호 발행시점 채번·persist. 멱등 키=form_submission_id(RPC 가 rx_issue_seq 기록). INSERT 실패 시 fs_id=null(순번만).
  const rxTpl = selected.find((t) => t.form_key === 'rx_standard');
  const rxRowId = insertedRows?.find((r) => r.template_id === rxTpl?.id)?.id ?? null;
  const { data: rxSeq, error: rxErr } = await supabase.rpc('issue_foot_rx_issue_no', {
    p_clinic_id: clinicId,
    p_issue_date: issueDateIso,
    p_form_submission_id: rxRowId,
  });
  const rxIssueNo = buildIssueNo(issueYmd, !rxErr && typeof rxSeq === 'number' ? rxSeq : 1) || null;

  // 3) field_data.issue_no persist(재인쇄/익일 동일번호 = 불변). rx_issue_seq 권위 순번은 RPC 가 이미 기록 → 표시 갱신만.
  if (rxIssueNo && rxRowId) {
    const rxFieldData = buildCodeEnrichedValues(autoValues, codeItems, 'rx_standard', rxItemDosages, rxIssueNo);
    const { error: updErr } = await supabase
      .from('form_submissions')
      .update({ field_data: rxFieldData })
      .eq('id', rxRowId);
    if (updErr) toast.error(`교부번호 표시 갱신 실패(번호는 발번됨): ${updErr.message}`);
  }
  return rxIssueNo;
}

function buildCodeEnrichedValues(
  base: Record<string, string>,
  codeItems: SelectedItem[],
  formKey: string,
  rxItemDosages?: Record<string, RxDosage>,
  // T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST 경로B / DA 경보 MSG-k7iz): 발행 시점 채번·persist된 확정 교부번호(issue_no).
  //   ⚠ 구 print-time count(issueSeq) 폐기 — issue_no 는 발행 RPC(issue_foot_rx_issue_no) 결과만 authoritative·불변(재인쇄/익일 동일번호).
  //   null/미전달(미리보기·pre-persist) 시 미주입(fabricate 금지, visit_no 동형). 구 checkInId(UUID-slice) 채번은 약국 판독불가 반려 실사고 근원.
  rxIssueNo?: string | null,
): Record<string, string> {
  const values = { ...base };

  // 상병코드 items → diag_code_N / diag_name_N
  // T-20260526-foot-DOC-DIAG-TRUNC: 3~4건 전건 노출 — 행 가시성 플래그 함께 주입
  const diagItems = codeItems.filter((i) => (i.service.category_label ?? '') === '상병');
  diagItems.forEach((item, idx) => {
    const n = idx + 1;
    values[`diag_code_${n}`] = item.service.service_code ?? '';
    values[`diag_name_${n}`] = item.service.name;
  });
  // 행 가시성: 코드 없는 행은 display:none으로 숨김 (AC-3 regression 방지)
  values['diag_row_3_style'] = diagItems.length >= 3 ? '' : 'display:none';
  values['diag_row_4_style'] = diagItems.length >= 4 ? '' : 'display:none';
  // diag_opinion_v2 전용: 코드 3,4를 <br>로 이어붙인 extras
  const extraCodes = diagItems.slice(2).map((i) => i.service.service_code ?? '').filter(Boolean);
  values['diag_extra_codes_html'] = extraCodes.length > 0 ? extraCodes.map((c) => `<br>${c}`).join('') : '';

  // rx_standard: 처방약 → rx_items_html
  // T-20260517-foot-RX-DOSAGE-DYNAMIC: per-item 독립값, 미입력 시 1/1/7 fallback
  if (formKey === 'rx_standard') {
    const rxItems = codeItems.filter((i) => (i.service.category_label ?? '') === '처방약');
    values.rx_items_html = buildRxItemsHtml(rxItems.map((i) => ({
      name: i.service.name,
      // T-20260718-foot-RXPRINT-DRUGCODE-PREFIX: 서비스관리 등록 약 코드(services.service_code) 앞 표기.
      code: i.service.service_code,
      unit_dose: rxItemDosages?.[i.service.id]?.unit_dose || '1',
      daily_freq: rxItemDosages?.[i.service.id]?.daily_freq || '1',
      // T-20260721-foot-RXPRINT-TOTALDAYS-BLANK (총괄 김주연 최종): 세 칸 전부 기본 '1' + 수기 수정 가능.
      //   결제미니창 경로(buildCodeEnrichedValues)와 DocumentPrintPanel 경로는 평행 — 반드시 동시 유지(한쪽만 '' 두면 재오픈).
      //   구 T-20260718 LOGIC-LOCK(빈칸이 정답) 해제. 자동 산출 바인딩 아님 — 리터럴 '1' + editable. 구 '7' 폴백 부활 금지.
      total_days: rxItemDosages?.[i.service.id]?.total_days || '1',
    })));
    // T-20260601-foot-DOC-PRINT-8FIX AC-3②: 사용기간 기본 3일 통일 (총투약일수 연동 제거)
    if (!values.usage_days) values.usage_days = '3';
    // T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST 경로B): 교부번호 = 발행 시점 채번·persist된 확정 문자열(8+N자리) 주입.
    //   ⚠ 폐기: 기존 checkInId.slice(0,5).toUpperCase() (UUID 앞 5자) — 약국 판독불가로 처방전 반려 실사고(PATH-4도 동일 결함).
    //   그 임시코드(§"정식 채번 확정 시 교체")의 정식 채번 확정 시점 = 발행 RPC(issue_foot_rx_issue_no) 결과 rxIssueNo.
    //   ⚠ DA 경보 MSG-k7iz: 여기서 print-time 로 fabricate 금지 — persist된 rxIssueNo 만 주입(pre-persist/미리보기=미주입).
    if (!values.issue_no && rxIssueNo) {
      values.issue_no = rxIssueNo;
    }
  }

  return values;
}

/**
 * T-20260517-foot-DOC-CODE-INSERT: HTML 양식 page div 생성.
 * T-20260521-foot-DOC-PRINT-UNIFY PUSH: `html-page` → `page` 클래스로 통일.
 *   DocumentPrintPanel buildHtmlPageHtml과 완전 동일한 클래스/레이아웃 사용.
 * T-20260521-foot-CLINIC-INFO-SYNC: HTML 양식 원내 도장 오버레이 추가 (DocumentPrintPanel 동기화).
 */
// LOGIC-LOCK: L-006 — 서류출력 경로 통일. buildHtmlPageDiv는 PATH-4(PaymentMiniWindow) 전용 페이지 생성. 변경 시 현장 승인 필수
function buildHtmlPageDiv(
  template: FormTemplate,
  fieldValues: Record<string, string>,
  copyLabel?: string,
): string {
  const htmlTpl = getHtmlTemplate(template.form_key);
  if (!htmlTpl) return '';
  // T-20260601-foot-RX-QR-LABEL (현장 확정 스코프, MSG-20260601-180722-8kgj / 181005-tdlp):
  //   PATH-4(결제창 영수증 미니창)도 PATH-1과 대칭. 제거 대상은 우측 상단 absolute 오버레이 박스뿐.
  //   중앙 상단 {{rx_copy_label}}(약국보관용/환자보관용) 구분 라벨은 2장 출력 식별 표식으로 보존
  //   (현장 "중앙 상단 라벨 절대 제거하지 말 것"). 2장 출력·QR 자동삽입 무파괴.
  // T-20260718-foot-RXPRINT-FORMAT-ADJUST (항목1, PATH-4 대칭): 교부번호 표시 분리(display-only) —
  //   저장 issue_no 불변, 렌더 직전에만 '20260718 제 000025 호'로 재조립. 비-rx/미채번 시 no-op.
  const boundValues =
    template.form_key === 'rx_standard'
      ? splitIssueNoForDisplay({ ...fieldValues, rx_copy_label: copyLabel ?? '약국보관용' })
      : fieldValues;
  const bound = bindHtmlTemplate(htmlTpl, boundValues);
  const isLandscape = template.form_key === 'bill_detail';
  // T-20260601-foot-DOC-PRINT-8FIX REOPEN AC-1: PATH-4(PaymentMiniWindow) 우하단 고정 도장 오버레이 제거.
  //   8FIX(5c54a27)는 PATH-1(DocumentPrintPanel.buildHtmlPageHtml)의 레거시 오버레이만 제거했고
  //   이 PATH-4 복제본의 동일 오버레이를 누락 → 결제창 영수증/처방전 출력에 도장이 여전히
  //   우하단에 찍히는 "재발 동일함"의 근본 원인(제3의 출력 경로). HTML 양식 직인은
  //   {{doctor_seal_html}}(autoBindContext, 의사/대표자 성명 근방 inline)로 일원화한다.
  //   (이미지 양식 buildPageHtml의 좌표 도장은 8FIX 범위 밖이므로 존치 — DocumentPrintPanel과 동일.)
  // T-20260601-foot-RX-QR-LABEL: 우측 상단 보관용 오버레이 박스 제거 (QR 가림 해소, AC-1·AC-2).
  return `<div class="page${isLandscape ? ' page-landscape' : ''}">${bound}</div>`;
}

/** iframe 인쇄 — 단 하나의 OS 프린트 다이얼로그만 노출 */
function printViaIframe(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();

  // T-20260601-foot-PAY-PRINT-DOUBLE-POPUP: 인쇄 다이얼로그 2회 발생 버그 수정.
  //   원인 = doPrint가 (1)이미지 로드 완료 onLoad와 (2)4초 fallback setTimeout 양쪽에서
  //   호출되어 단일 출력 클릭에 contentWindow.print()가 2회 실행 → OS 인쇄창 2회 노출.
  //   idempotency 가드(printed)로 최초 1회만 실제 print 트리거하도록 교정. 출력 내용·레이아웃 무변경.
  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow?.print();
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try { document.body.removeChild(iframe); } catch { /* ignore */ }
    }, 3000);
  };

  const imgs = Array.from(doc.querySelectorAll('img'));
  if (imgs.length === 0) {
    setTimeout(doPrint, 300);
    return;
  }
  let loaded = 0;
  const onLoad = () => {
    loaded++;
    if (loaded >= imgs.length) doPrint();
  };
  imgs.forEach((img) => {
    img.onload = onLoad;
    img.onerror = onLoad;
    if (img.complete) onLoad();
  });
  setTimeout(doPrint, 4000); // fallback
}

/** 단일 양식 page div 생성 */
// LOGIC-LOCK L-006: buildPageHtml — PATH-4 이미지 양식 래핑 함수. 중복 구현 금지
function buildPageHtml(
  template: FormTemplate,
  fieldValues: Record<string, string>,
  imgUrl: string,
): string {
  const overlayHtml =
    template.field_map.length > 0
      ? template.field_map
          .map((f: FieldMapEntry) => {
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
  //   도장 오버레이도 제거 — 직인은 doctor_seal_html로 일원화. 활성 13종은 전부 HTML이라
  //   이 경로에 도달하지 않는 레거시지만, bottom:52px 오버레이 클래스를 전 출력경로에서
  //   전수 소거(planner FIX-REQUEST #2)해 "1곳만 수정" 재발 클래스를 근본 차단.
  return `<div class="page">
  <img src="${imgUrl}" alt="${template.name_ko}" />
  ${overlayHtml}
</div>`;
}

// T-20260521-foot-DOC-PRINT-UNIFY PUSH: loadMiniAutoBindValues 제거됨.
// 경로 4 = 1순위 — 공유 loadAutoBindContext(@/lib/autoBindContext.ts) 사용.

// ── Props ────────────────────────────────────────────────────────────────────

// ── T-20260525-foot-FEE-ITEM-REORDER: 수가 항목 정렬 행 ─────────────────────
// useSortable hook 규칙상 별도 컴포넌트 필요. DnD + ↑↓ 버튼 복합 지원 (AC-1, AC-5).

// PMW-ORDER-REMOVE REOPEN1: pricingIdx, pricingLen, onReorder 제거 (↑↓ UI 전면 제거)
interface SortablePricingRowProps {
  service: Service;
  qty: number;
  isPrepaid: boolean;
  displayPrice: number;
  isEditing: boolean;
  editingPriceValue: string;
  /** T-20260526-foot-COPAY-MINI-BUG: 급여/비급여 분류용 건보 등급 */
  insuranceGrade: InsuranceGrade | null;
  onTogglePrepaid: (id: string) => void;
  onStartEditPrice: (id: string, price: number) => void;
  onCommitEditPrice: (id: string) => void;
  onEditValueChange: (v: string) => void;
  onEscapeEdit: () => void;
  onRemove: (id: string) => void;
}

function SortablePricingRow({
  service,
  qty,
  isPrepaid,
  displayPrice,
  isEditing,
  editingPriceValue,
  insuranceGrade,
  onTogglePrepaid,
  onStartEditPrice,
  onCommitEditPrice,
  onEditValueChange,
  onEscapeEdit,
  onRemove,
}: SortablePricingRowProps) {
  // PMW-ORDER-REMOVE REOPEN1: 드래그핸들·↑↓ UI 제거. DnD 구조는 유지(useSortable hook 규칙).
  // attributes, listeners 미사용 — 핸들 제거로 DnD 진입점 없음.
  const { setNodeRef, transform, transition, isDragging } = useSortable({
    id: service.id,
  });

  // T-20260526-foot-COPAY-MINI-BUG AC-1: 건보 등급 반영
  const taxClass = getTaxClass(service, insuranceGrade);
  const taxShort =
    taxClass === '급여' ? '급여' :
    taxClass === '비급여(과세)' ? '비급여' : '면세';

  return (
    <div
      ref={setNodeRef}
      data-testid={`pricing-row-${service.id}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn(
        'flex items-center gap-1 rounded border px-1.5 py-1 text-[11px] transition-colors',
        isPrepaid
          ? 'bg-purple-50 border-purple-300'
          : 'bg-white border-input',
        isDragging && 'shadow-lg',
      )}
    >
      {/* 드래그 핸들 제거 — PMW-ORDER-REMOVE REOPEN1: 수가 항목 순서 편집 UI 전면 제거 */}
      {/* 선수금 토글 (PREPAID-DEDUCT AC-2) */}
      <button
        onClick={() => onTogglePrepaid(service.id)}
        className={cn(
          'shrink-0 w-3 h-3 rounded-sm border-2 transition-colors',
          isPrepaid
            ? 'bg-purple-600 border-purple-600'
            : 'border-gray-300 hover:border-purple-400',
        )}
        title={isPrepaid ? '선수금차감 해제' : '선수금차감 지정'}
      />
      {/* 코드명 — T-20260526-foot-REDBOX-CODENAME-TRIM: 코드번호 컬럼 제거(Zone1에 표시됨)
          → flex-1 표시 공간 +40px 확보. title로 풀네임 tooltip 제공
          T-20260527-foot-PMW-CODENAME-TRUNC: truncate(white-space:nowrap) 제거 → break-words 줄바꿈 허용
          Zone2가 sm=640px에서 ~118px만 남아 14자 한글 잘림 → word-wrap으로 전체 표시 */}
      <span className="flex-1 font-medium break-words min-w-0 leading-tight" title={service.name}>
        {service.name}
      </span>
      {/* 수가 편집 (PREPAID-DEDUCT AC-4) */}
      {isEditing ? (
        <input
          className="w-16 shrink-0 text-[10px] tabular-nums border rounded px-1 py-0.5 bg-white"
          value={editingPriceValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onBlur={() => onCommitEditPrice(service.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitEditPrice(service.id);
            if (e.key === 'Escape') onEscapeEdit();
          }}
          autoFocus
        />
      ) : (
        <button
          className="w-16 shrink-0 text-[10px] tabular-nums text-right hover:text-purple-700 truncate"
          onClick={() => onStartEditPrice(service.id, displayPrice)}
          title={`클릭하여 금액 수정${qty > 1 ? ` (×${qty})` : ''}`}
        >
          {qty > 1
            ? formatAmount(displayPrice * qty)
            : formatAmount(displayPrice)}
        </button>
      )}
      {/* 급여·비급여 */}
      <span
        className={cn(
          'shrink-0 text-[9px] px-0.5 rounded whitespace-nowrap',
          taxClass === '급여'
            ? 'text-blue-700 bg-blue-50'
            : taxClass === '비급여(과세)'
              ? 'text-orange-700 bg-orange-50'
              : 'text-gray-600 bg-gray-100',
        )}
      >
        {taxShort}
      </span>
      {/* 수량 */}
      {qty > 1 && (
        <span className="shrink-0 text-[9px] text-teal-600 whitespace-nowrap">
          ×{qty}
        </span>
      )}
      {/* ↑↓ 버튼 제거 — PMW-ORDER-REMOVE REOPEN1: 수가 항목 순서 편집 UI 전면 제거 */}
      {/* 제거 */}
      <button
        onClick={() => onRemove(service.id)}
        className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5"
        title="제거"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

interface Props {
  checkIn: CheckIn | null;
  onClose: () => void;
  /** 수납 완료 후 (auto-done 포함) */
  onComplete: () => void;
  /** 시술 저장 완료 후 (AC-7 수납대기 금액 갱신용) */
  onSaved?: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function PaymentMiniWindow({ checkIn, onClose, onComplete, onSaved }: Props) {
  const { profile } = useAuth();
  // ── Tab + Grid
  const [activeTab, setActiveTab] = useState<TabLabel>('풋케어');
  const [footcareCat, setFootcareCat] = useState<FootCatType>('기본(진찰료)');
  // AC-4: footcarePage 제거 (스크롤 전환)

  // ── Services + Selection
  const [services, setServices] = useState<Service[]>([]);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [saved, setSaved] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('card');
  // T-20260616-foot-PMW-SPLIT-PAYMENT: 분할결제 — 하나의 수납 건을 복수 결제수단으로 나눠 받기.
  //   splitMode off(기본) → 기존 단일 결제수단 동선(payMethod) 그대로(AC-4 회귀 없음).
  //   splitMode on → splitRows의 (method, amount) 각각을 payments 행으로 분리 insert(AC-3).
  const [splitMode, setSplitMode] = useState(false);
  const [splitRows, setSplitRows] = useState<{ method: PayMethod; amount: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // T-20260526-foot-COPAY-MINI-BUG: 고객 건보 등급 (급여/비급여 분류용)
  const [customerInsuranceGrade, setCustomerInsuranceGrade] = useState<InsuranceGrade | null>(null);

  // T-20260620-foot-PMW-OUTSTANDING-PREFILL: 고객 미수금(잔금) — PKG-OUTSTANDING-BALANCE SSOT 산출값.
  //   결제 미니창 진입 시 미수금을 표면화(읽기전용)해 담당자가 즉시 인지하도록 한다.
  //   ★ 표시 전용 — payments 쓰기 경로/집계 불변. 패키지/진료비 잔금은 §4-A 따라 각각 별도 표기(합산 금지).
  const [customerOutstanding, setCustomerOutstanding] = useState<CustomerOutstanding | null>(null);

  // T-20260708-foot-PAYMINI-INSURANCE-CHARTREQ-UNBLOCK: 급여 수납 차단 완전 해제.
  //   과거 MEDLAW22-B-GATE 의 (a)진료기록 필수 + (b)방문일 일치 하드차단을 모두 제거.
  //   이 상태는 이제 '차단'이 아니라 급여 방문 시 진료기록 후속 작성을 권하는 비차단 soft 리마인더 표시용.
  //   isCovered(급여 여부)로만 결정 — 방문일/차트 존재와 무관(계좌이체 등 비내원일 수납 오표시 방지).
  const [medRecordReminder, setMedRecordReminder] = useState(false);

  // ── T-20260517-foot-RX-DOSAGE-DYNAMIC: per-item 처방전 용량/용법/투약일수 (service.id → RxDosage)
  const [rxItemDosages, setRxItemDosages] = useState<Record<string, RxDosage>>({});

  // ── PAY-CASH-RECEIPT: 현금영수증
  const [cashReceiptIssued, setCashReceiptIssued] = useState(false);
  const [cashReceiptType, setCashReceiptType] = useState<'income_deduction' | 'expense_proof'>(
    'income_deduction',
  );

  // T-20260526-foot-PAY-INPUT-001-SIMPLIFY: 승인번호·TID 입력 칸 제거 (매처 자동 채움)

  // ── PREPAID-DEDUCT: 선수금차감 UI
  const [prepaidIds, setPrepaidIds] = useState<Set<string>>(new Set());
  // OVERRIDE-RULE: O-002 — 결제 금액 수기 조정 (customAmounts)
  // OVERRIDE: PaymentMiniWindow — customAmounts 결제 창 수기 금액 추가 적용. 기본 로직 전체 연동.
  const [customAmounts, setCustomAmounts] = useState<Map<string, number>>(new Map());
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState('');
  const [deductMode, setDeductMode] = useState(false);
  const [deductAmount, setDeductAmount] = useState(0);
  const [hasActivePackage, setHasActivePackage] = useState(false);

  // ── T-20260525-foot-FEE-SET-TEMPLATE: 수가세트 드롭다운
  const [feeSetTemplates, setFeeSetTemplates] = useState<FeeSetTemplate[]>([]);
  const [feeSetOpen, setFeeSetOpen] = useState(false);
  // ── T-20260720-foot-PAYMINI-CHARTCODE-SPLIT: 중앙 3열→4열 분리.
  //    구 LEFTSPLIT 접이식 토글(feeItemExpanded) 제거 — ② 차트 코드 칸이 독립 컬럼으로
  //    상시 노출되고 항목 과다 시 칸 내부 스크롤(AC-2/AC-10)로 흡수하므로 접힘 개념 소멸.

  // ── Phase 2: 서류발행 (AC-8~10)
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [selectedDocKeys, setSelectedDocKeys] = useState<Set<string>>(new Set());
  const [docPrinting, setDocPrinting] = useState(false);
  const [docSettlePrinting, setDocSettlePrinting] = useState(false);
  // T-20260521-foot-DOC-PRINT-UNIFY AC-2: form_submissions 기록용 staffId
  const [staffId, setStaffId] = useState<string | null>(null);
  // T-20260719-foot-DOCHIST-MULTIPATH-EXTEND item②: 발행이력 조회+재출력 모달 열림 상태.
  //   기준점(1번차트 DocumentPrintPanel)과 동일 컴포넌트 재사용 — 이력/재출력/권한/RRN마스킹/의료서류 게이트 전부 상속.
  const [docHistoryOpen, setDocHistoryOpen] = useState(false);

  // ── T-20260517-foot-BILLING-3ZONE: Zone 3 — 구매패키지 (AC-4) + 금일 시술내역 (AC-5)
  // ── T-20260519-foot-BILLING-ITEM-PRICE: 항목별 수가 표시 (AC-1, AC-2)
  interface ActivePackageInfo {
    id: string;
    package_name: string;
    remaining_sessions: number;
    paid_amount: number;
    // 항목별 세션 수 + 적용 수가 (AC-2)
    heated_sessions: number;
    heated_unit_price: number;
    unheated_sessions: number;
    unheated_unit_price: number;
    iv_sessions: number;
    iv_unit_price: number;
    podologe_sessions: number;
    podologe_unit_price: number;
  }
  interface TodayTreatment {
    service_name: string;
    price: number;
  }
  const [activePackages, setActivePackages] = useState<ActivePackageInfo[]>([]);
  const [todayTreatments, setTodayTreatments] = useState<TodayTreatment[]>([]);

  // ── persist ref
  const skipPersistRef = useRef(true);
  // T-20260525-foot-FEE-ITEM-REORDER AC-2: display_order 데바운스 타이머
  const orderPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // T-20260526-foot-PMW-SIDE-MENU-FEAT AC-2: 서비스 메뉴 카드 순서 persist 타이머
  const menuOrderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // T-20260526-foot-PMW-SIDE-MENU-FEAT AC-1, AC-4: 서비스 메뉴 카드 순서 (foot_cat → serviceId[])
  const [menuOrder, setMenuOrder] = useState<Record<string, string[]>>({});

  // ── 서비스 목록 + 기존 시술 pre-load + 패키지 세션 + 양식 목록 ─────────────
  useEffect(() => {
    if (!checkIn) return;
    skipPersistRef.current = true;

    setSelectedItems([]);
    setSaved(false);
    setPayMethod('card');
    // T-20260616-foot-PMW-SPLIT-PAYMENT: 분할결제 상태 리셋
    setSplitMode(false);
    setSplitRows([]);
    setActiveTab('풋케어');
    setFootcareCat('기본(진찰료)');
    setSelectedDocKeys(new Set());
    setSubmitting(false);
    setDocPrinting(false);
    setDocSettlePrinting(false);
    setCashReceiptIssued(false);
    setCashReceiptType('income_deduction');
    setPrepaidIds(new Set());
    setCustomAmounts(new Map());
    setDeductMode(false);
    setDeductAmount(0);
    setActivePackages([]);
    setTodayTreatments([]);
    setRxItemDosages({});
    // T-20260526-foot-COPAY-MINI-BUG: 리셋
    setCustomerInsuranceGrade(null);
    // T-20260620-foot-PMW-OUTSTANDING-PREFILL: 미수금 리셋
    setCustomerOutstanding(null);
    // T-20260526-foot-PMW-SIDE-MENU-FEAT: 리셋
    setMenuOrder({});

    // T-20260526-foot-COPAY-MINI-BUG AC-1: 고객 건보 등급 비동기 로드
    // T-20260706-foot-DOCPRINT-FEEBREAKDOWN-INSURANCE-BLANK: grade null(신규방문 미입력) 시
    //   이 방문 service_charges 저장 등급(customer_grade_at_charge)으로 폴백 → 급여구분 붕괴 방지.
    //   무파괴: live grade 있으면 그대로, 무보험 방문은 covered charge 없어 null 유지.
    if (checkIn.customer_id) {
      loadEffectiveInsuranceGrade(checkIn.customer_id, checkIn.id)
        .then((grade) => {
          setCustomerInsuranceGrade(grade);
        });
    }

    // T-20260620-foot-PMW-OUTSTANDING-PREFILL: 고객 미수금(잔금) 비동기 로드.
    //   PKG-OUTSTANDING-BALANCE SSOT(loadCustomerOutstanding) 재사용 — 신규 쿼리/산출 없음.
    //   실패해도 결제 동선은 그대로(표시 전용, best-effort).
    if (checkIn.customer_id && checkIn.clinic_id) {
      const custId = checkIn.customer_id;
      loadCustomerOutstanding([custId], checkIn.clinic_id)
        .then((map) => setCustomerOutstanding(map.get(custId) ?? null))
        .catch(() => setCustomerOutstanding(null));
    }

    Promise.all([
      supabase
        .from('services')
        .select('*')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('active', true)
        // T-20260525-foot-FEE-ITEM-REORDER AC-2: display_order 기준 정렬 (persist 순서 복원)
        .order('display_order'),
      supabase
        .from('check_in_services')
        .select('service_id, price')
        .eq('check_in_id', checkIn.id),
      // T-20260522-foot-INS-DOC-PRINT: insurance 카테고리 추가
      supabase
        .from('form_templates')
        .select('*')
        .eq('clinic_id', checkIn.clinic_id)
        .in('category', ['foot-service', 'insurance'])
        .eq('active', true)
        .order('sort_order'),
      // T-20260525-foot-FEE-SET-TEMPLATE AC-1: 수가세트 목록 로드
      supabase
        .from('fee_set_templates')
        .select('id, set_name, items')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      // T-20260526-foot-PMW-SIDE-MENU-FEAT AC-2, AC-4: 서비스 메뉴 카드 순서 로드
      supabase
        .from('service_menu_order')
        .select('foot_cat, service_id, display_order')
        .eq('clinic_id', checkIn.clinic_id)
        .order('display_order'),
    ]).then(([svcsRes, cisRes, tplRes, feeSetRes, menuOrderRes]) => {
      const svcs = (svcsRes.data ?? []) as Service[];
      setServices(svcs);

      const existingCis = (cisRes.data ?? []) as { service_id: string; price: number }[];
      if (existingCis.length > 0) {
        const items: SelectedItem[] = [];
        const overrides = new Map<string, number>();
        for (const ci of existingCis) {
          const svc = svcs.find((s) => s.id === ci.service_id);
          if (svc) {
            const existing = items.find((i) => i.service.id === svc.id);
            if (existing) {
              existing.qty += 1;
            } else {
              items.push({ service: svc, qty: 1 });
              // 가격 override 복원 (DB price ≠ service.price인 경우)
              if (ci.price !== svc.price) {
                overrides.set(svc.id, ci.price);
              }
            }
          }
        }
        if (items.length > 0) {
          // T-20260525-foot-FEE-ITEM-REORDER AC-2: 재진입 시 저장된 display_order 기준 순서 복원
          items.sort((a, b) => (a.service.display_order ?? 0) - (b.service.display_order ?? 0));
          setSelectedItems(items);
          if (overrides.size > 0) setCustomAmounts(overrides);
          setSaved(true);
        }
        localStorage.removeItem(draftKey(checkIn.id));
      } else {
        try {
          const raw = localStorage.getItem(draftKey(checkIn.id));
          if (raw) {
            const draft: DraftItem[] = JSON.parse(raw);
            const items: SelectedItem[] = draft
              .map((d) => {
                const svc = svcs.find((s) => s.id === d.serviceId);
                return svc ? { service: svc, qty: d.qty } : null;
              })
              .filter((x): x is SelectedItem => x !== null);
            if (items.length > 0) setSelectedItems(items);
          }
        } catch {
          localStorage.removeItem(draftKey(checkIn.id));
        }
      }

      // T-20260525-foot-FEE-SET-TEMPLATE AC-1: 수가세트 상태 저장
      setFeeSetTemplates((feeSetRes.data ?? []) as FeeSetTemplate[]);

      // T-20260526-foot-PMW-SIDE-MENU-FEAT AC-2, AC-4: 서비스 메뉴 카드 순서 복원
      {
        const rows = (menuOrderRes.data ?? []) as { foot_cat: string; service_id: string; display_order: number }[];
        if (rows.length > 0) {
          const orderMap: Record<string, string[]> = {};
          for (const row of rows) {
            if (!orderMap[row.foot_cat]) orderMap[row.foot_cat] = [];
            orderMap[row.foot_cat].push(row.service_id);
          }
          setMenuOrder(orderMap);
        }
      }

      // T-20260522-foot-INS-DOC-PRINT: category별 fallback 병합
      {
        const dbTpls = (tplRes.data ?? []) as FormTemplate[];
        const footDbTpls = dbTpls.filter((t) => t.category === 'foot-service');
        const insDbTpls  = dbTpls.filter((t) => t.category === 'insurance');
        setTemplates([
          ...(footDbTpls.length > 0 ? footDbTpls : FALLBACK_TEMPLATES),
          ...(insDbTpls.length  > 0 ? insDbTpls  : INSURANCE_FALLBACK_TEMPLATES),
        ]);
      }

      skipPersistRef.current = false;
    });

    // PREPAID-DEDUCT: 오늘 2번차트 차감 이력 로드 (자동 매칭용)
    if (checkIn.customer_id) {
      loadTodayPackageSessions(checkIn.customer_id);
      // BILLING-3ZONE: Zone 3 데이터 비동기 로드 (AC-4, AC-5)
      loadZone3Data(checkIn);
    }
  }, [checkIn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // T-20260521-foot-DOC-PRINT-UNIFY AC-2: staffId 로드 (form_submissions issued_by용)
  useEffect(() => {
    if (!checkIn?.clinic_id) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from('staff')
        .select('id')
        .eq('user_id', user.id)
        .eq('clinic_id', checkIn.clinic_id)
        .eq('active', true)
        .maybeSingle()
        .then(({ data }) => setStaffId(data?.id ?? null));
    });
  }, [checkIn?.clinic_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 오늘 패키지 세션 로드 → 서비스 목록과 매칭해 자동 prepaid 선택 ──────────
  const loadTodayPackageSessions = useCallback(
    async (customerId: string) => {
      // 1. 활성 패키지 존재 여부 확인
      const { data: pkgData } = await supabase
        .from('packages')
        .select('id')
        .eq('customer_id', customerId)
        .eq('status', 'active');

      const activePkgs = (pkgData ?? []) as { id: string }[];
      setHasActivePackage(activePkgs.length > 0);
      if (activePkgs.length === 0) return;

      // 2. 오늘 차감된 세션 조회
      const today = format(new Date(), 'yyyy-MM-dd');
      const pkgIds = activePkgs.map((p) => p.id);
      const { data: sessData } = await supabase
        .from('package_sessions')
        .select('session_type')
        .in('package_id', pkgIds)
        .eq('session_date', today)
        .eq('status', 'used');

      const sessions = (sessData ?? []) as { session_type: string }[];
      if (sessions.length === 0) return;

      // 3. services가 로드된 이후에 매칭 → services state를 직접 참조하면 stale할 수 있으므로
      //    잠시 후 실행하거나 services 파라미터 받아야 함.
      //    여기서는 closure capture 의도적으로 허용 (services는 이미 setServices 직후)
      //    실제 매칭은 별도 effect에서 (services + sessions 모두 준비된 시점)
      setTodaySessionTypes(sessions.map((s) => s.session_type ?? ''));
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [todaySessionTypes, setTodaySessionTypes] = useState<string[]>([]);

  // ── BILLING-3ZONE: Zone 3 데이터 로드 (AC-4 구매패키지 + AC-5 금일 시술내역) ───
  const loadZone3Data = useCallback(async (ci: CheckIn) => {
    if (!ci.customer_id) return;
    // T-20260531-foot-DASHBOARD-KST-FILTER: checked_in_at은 UTC(timestamptz). KST 기준
    // 날짜 + '+09:00' 바운드로 비교해야 KST 오전 체크인 누락을 방지한다.
    const today = todaySeoulISODate();

    const [pkgRes, ciRes] = await Promise.all([
      // AC-4: 활성 패키지 목록 (T-20260519-foot-BILLING-ITEM-PRICE: 항목별 수가 필드 추가)
      supabase
        .from('packages')
        .select('id, package_name, total_sessions, paid_amount, heated_sessions, heated_unit_price, unheated_sessions, unheated_unit_price, iv_sessions, iv_unit_price, podologe_sessions, podologe_unit_price')
        .eq('customer_id', ci.customer_id)
        .eq('status', 'active'),
      // AC-5: 금일 체크인 ID 목록
      supabase
        .from('check_ins')
        .select('id')
        .eq('customer_id', ci.customer_id)
        .eq('clinic_id', ci.clinic_id)
        .gte('checked_in_at', `${today}T00:00:00+09:00`)
        .lte('checked_in_at', `${today}T23:59:59+09:00`),
    ]);

    // AC-4: 잔여 회차 계산 (사용된 세션 카운트)
    // T-20260519-foot-BILLING-ITEM-PRICE: 항목별 수가 필드 포함
    const pkgs = (pkgRes.data ?? []) as {
      id: string; package_name: string; total_sessions: number; paid_amount: number;
      heated_sessions: number; heated_unit_price: number;
      unheated_sessions: number; unheated_unit_price: number;
      iv_sessions: number; iv_unit_price: number;
      podologe_sessions: number; podologe_unit_price: number;
    }[];
    if (pkgs.length > 0) {
      const pkgIds = pkgs.map((p) => p.id);
      const { data: sessData } = await supabase
        .from('package_sessions')
        .select('package_id')
        .in('package_id', pkgIds)
        .eq('status', 'used');
      const usedMap = new Map<string, number>();
      (sessData ?? []).forEach((s: { package_id: string }) => {
        usedMap.set(s.package_id, (usedMap.get(s.package_id) ?? 0) + 1);
      });
      setActivePackages(
        pkgs.map((pkg) => ({
          id: pkg.id,
          package_name: pkg.package_name,
          remaining_sessions: Math.max(0, pkg.total_sessions - (usedMap.get(pkg.id) ?? 0)),
          paid_amount: pkg.paid_amount,
          heated_sessions: pkg.heated_sessions ?? 0,
          heated_unit_price: pkg.heated_unit_price ?? 0,
          unheated_sessions: pkg.unheated_sessions ?? 0,
          unheated_unit_price: pkg.unheated_unit_price ?? 0,
          iv_sessions: pkg.iv_sessions ?? 0,
          iv_unit_price: pkg.iv_unit_price ?? 0,
          podologe_sessions: pkg.podologe_sessions ?? 0,
          podologe_unit_price: pkg.podologe_unit_price ?? 0,
        })),
      );
    }

    // AC-5: 금일 시술내역 (price > 0 항목만 — 상병코드·처방약 제외)
    // AC-3 fix: 현재 checkIn.id를 명시적으로 포함 (날짜 필터 timezone 불일치로 누락 방지)
    const todayCIIds = [...new Set([ci.id, ...(ciRes.data ?? []).map((c: { id: string }) => c.id)])];
    if (todayCIIds.length > 0) {
      const { data: cisData } = await supabase
        .from('check_in_services')
        .select('service_name, price')
        .in('check_in_id', todayCIIds)
        .gt('price', 0);
      setTodayTreatments(
        (cisData ?? []).map((c: { service_name: string; price: number }) => ({
          service_name: c.service_name ?? '',
          price: c.price ?? 0,
        })),
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2번차트 자동 매칭: services + todaySessionTypes 모두 준비된 시점 ──────────
  useEffect(() => {
    if (todaySessionTypes.length === 0 || services.length === 0) return;

    const autoIds = new Set<string>();
    for (const svcItem of services) {
      if (isCodeItem(svcItem)) continue; // 상병코드·처방약 제외
      // T-20260609-foot-TRIAL-REVENUE-ZERO: 체험권은 선수금차감 자동매칭 제외
      if (isTrialService(svcItem)) continue;
      for (const st of todaySessionTypes) {
        // 1차: keyword 포함 확인
        const matchedKw = PREPAID_KEYWORDS.find((kw) => st.includes(kw));
        if (!matchedKw) continue;

        if (matchedKw === '수액') {
          // 수액: category 기반 매칭
          if (
            (svcItem.category_label ?? '').includes('수액') ||
            (svcItem.category ?? '').includes('수액')
          ) {
            autoIds.add(svcItem.id);
          }
        } else {
          // 2차: 정밀 코드 매핑
          const codes = PREPAID_CODE_MAP[matchedKw] ?? [];
          if (codes.length > 0 && svcItem.service_code && codes.includes(svcItem.service_code)) {
            autoIds.add(svcItem.id);
          } else if (svcItem.name.includes(matchedKw)) {
            // fallback: 이름 포함
            autoIds.add(svcItem.id);
          }
        }
      }
    }

    if (autoIds.size > 0) {
      setPrepaidIds((prev) => {
        const merged = new Set(prev);
        autoIds.forEach((id) => merged.add(id));
        return merged;
      });
    }
  }, [todaySessionTypes, services]);

  // ── persist effect ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!checkIn || skipPersistRef.current) return;
    if (saved) {
      localStorage.removeItem(draftKey(checkIn.id));
      return;
    }
    if (selectedItems.length === 0) {
      localStorage.removeItem(draftKey(checkIn.id));
      return;
    }
    const draft: DraftItem[] = selectedItems.map((i) => ({ serviceId: i.service.id, qty: i.qty }));
    localStorage.setItem(draftKey(checkIn.id), JSON.stringify(draft));
  }, [selectedItems, saved, checkIn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── T-20260708-foot-PAYMINI-INSURANCE-CHARTREQ-UNBLOCK: 급여 방문 soft 리마인더 평가 ──
  //   saved(=check_in_services 영속) 후에만 평가 — 급여/비급여 분류가 DB에 반영된 상태 기준.
  //   ★ 차단이 아니라 표시 전용: isCovered(급여)면 진료기록 후속 작성 리마인더를 회색으로 안내.
  //   res.blocked / 방문일 매칭은 수납 흐름에서 사용하지 않음 — 수납은 항상 진행 가능.
  useEffect(() => {
    if (!checkIn || !saved) {
      setMedRecordReminder(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await evaluateMedicalRecordGate(checkIn);
        // 급여 방문이면 리마인더만 표시(차단 아님). 비급여면 미표시.
        if (!cancelled) setMedRecordReminder(res.isCovered);
      } catch {
        // 평가 오류 시 리마인더 미표시(수납은 어차피 차단되지 않음).
        if (!cancelled) setMedRecordReminder(false);
      }
    })();
    return () => { cancelled = true; };
  }, [checkIn?.id, saved]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── T-20260525-foot-FEE-ITEM-REORDER AC-2: display_order persist (debounce 800ms) ──
  // 순서 변경·항목 추가/제거 시 services.display_order 업데이트 (clinic 단위, fire-and-forget)
  // skipPersistRef: 초기 로드 중 트리거 방지 (checkIn 교체 시 true → load 완료 후 false)
  useEffect(() => {
    if (!checkIn || skipPersistRef.current) return;
    const pricing = selectedItems.filter((i) => !isCodeItem(i.service));
    if (pricing.length === 0) return;
    if (orderPersistTimerRef.current) clearTimeout(orderPersistTimerRef.current);
    orderPersistTimerRef.current = setTimeout(() => {
      pricing.forEach((item, idx) => {
        supabase
          .from('services')
          .update({ display_order: idx })
          .eq('id', item.service.id)
          .then();
      });
    }, 800);
    return () => {
      if (orderPersistTimerRef.current) clearTimeout(orderPersistTimerRef.current);
    };
  }, [selectedItems, checkIn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── T-20260526-foot-PMW-SIDE-MENU-FEAT AC-2: service_menu_order persist (debounce 800ms) ──
  // menuOrder 변경 시 service_menu_order upsert (clinic × foot_cat 단위, fire-and-forget)
  // AC-3: 오리진 풋 clinic_id 기준 — checkIn.clinic_id 자동 사용
  useEffect(() => {
    if (!checkIn || Object.keys(menuOrder).length === 0) return;
    if (menuOrderTimerRef.current) clearTimeout(menuOrderTimerRef.current);
    menuOrderTimerRef.current = setTimeout(() => {
      for (const [foot_cat, ids] of Object.entries(menuOrder)) {
        if (!ids || ids.length === 0) continue;
        const rows = ids.map((service_id, idx) => ({
          clinic_id: checkIn.clinic_id,
          foot_cat,
          service_id,
          display_order: idx,
          updated_at: new Date().toISOString(),
        }));
        supabase
          .from('service_menu_order')
          .upsert(rows, { onConflict: 'clinic_id,foot_cat,service_id' })
          .then();
      }
    }, 800);
    return () => {
      if (menuOrderTimerRef.current) clearTimeout(menuOrderTimerRef.current);
    };
  }, [menuOrder, checkIn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!checkIn) return null;

  // ── 현재 탭의 서비스 목록 ────────────────────────────────────────────────

  const tabCategoryLabels = TAB_CATEGORY_MAP[activeTab];

  // 풋케어 탭 내 서브 카테고리 필터링
  const footcareSubLabels = activeTab === '풋케어' ? FOOTCARE_CAT_LABELS[footcareCat] : [];
  const rawTabServices = services.filter((svc) => {
    const label = svc.category_label ?? '';
    const cat = svc.category ?? '';
    return tabCategoryLabels.includes(label) || tabCategoryLabels.includes(cat);
  });
  const tabServicesBase =
    activeTab === '풋케어'
      ? rawTabServices.filter(
          (svc) =>
            footcareSubLabels.includes(svc.category_label ?? '') ||
            footcareSubLabels.includes(svc.category ?? ''),
        )
      : rawTabServices;

  // T-20260526-foot-PMW-SIDE-MENU-FEAT AC-1, AC-4: 저장된 메뉴 순서 적용 (풋케어 탭 서브카테고리별)
  const tabServices = (() => {
    if (activeTab !== '풋케어') return tabServicesBase;
    const savedOrder = menuOrder[footcareCat];
    if (!savedOrder || savedOrder.length === 0) return tabServicesBase;
    const orderMap = new Map(savedOrder.map((id, i) => [id, i]));
    return [...tabServicesBase].sort((a, b) => {
      const oa = orderMap.has(a.id) ? orderMap.get(a.id)! : tabServicesBase.length;
      const ob = orderMap.has(b.id) ? orderMap.get(b.id)! : tabServicesBase.length;
      return oa - ob;
    });
  })();


  // AC-4: 스크롤 — tabServices 전체 표시

  // ── 코드 클릭 → 선택 목록에 추가 ─────────────────────────────────────────
  const handleSelectService = (svc: Service) => {
    setSelectedItems((prev) => {
      const idx = prev.findIndex((i) => i.service.id === svc.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { service: svc, qty: 1 }];
    });
    setSaved(false);
    setDeductMode(false);
  };

  // ── 항목 제거 ─────────────────────────────────────────────────────────────
  const handleRemoveItem = (serviceId: string) => {
    setSelectedItems((prev) => prev.filter((i) => i.service.id !== serviceId));
    setSaved(false);
    setDeductMode(false);
    setPrepaidIds((prev) => {
      const next = new Set(prev);
      next.delete(serviceId);
      return next;
    });
    setCustomAmounts((prev) => {
      const next = new Map(prev);
      next.delete(serviceId);
      return next;
    });
  };

  // ── 선수금 보라색 토글 ───────────────────────────────────────────────────
  const togglePrepaid = (serviceId: string) => {
    // T-20260609-foot-TRIAL-REVENUE-ZERO: 체험권은 선수금차감 불가 — 토글 차단
    const svc = selectedItems.find((i) => i.service.id === serviceId)?.service;
    if (isTrialService(svc)) {
      toast.info('체험권은 선수금차감 대상이 아닙니다 — 단건 매출로 기록됩니다');
      return;
    }
    setPrepaidIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
    // 토글 시 deductMode 리셋 (재산정 필요)
    setDeductMode(false);
  };

  // ── 인라인 금액 편집 ────────────────────────────────────────────────────
  const startEditPrice = (serviceId: string, currentPrice: number) => {
    setEditingPriceId(serviceId);
    // T-20260525-foot-AMOUNT-COMMA-FMT AC-1: 편집 시작 시 천 단위 쉼표 포맷팅
    setEditingPriceValue(formatAmountDisplay(currentPrice));
  };

  const commitEditPrice = (serviceId: string) => {
    const parsed = parseInt(editingPriceValue.replace(/,/g, ''), 10);
    if (!isNaN(parsed) && parsed >= 0) {
      setCustomAmounts((prev) => new Map(prev).set(serviceId, parsed));
      setSaved(false);
      setDeductMode(false);
    }
    setEditingPriceId(null);
  };

  // ── 금액 계산 ──────────────────────────────────────────────────────────
  // T-20260721-foot-PMW-PREPAID-DEDUCT-COPAY-BASE: getItemAmount(전액 = 본인부담+공단+비급여) 제거.
  //   유일 소비처였던 calcDeductAmount 가 공단 제외 SSOT(computeFootBilling)로 재배선되며 데드코드화 →
  //   noUnusedLocals 위반 방지 겸 '전액 base' 오용 재발 원천 차단(청구는 항상 수납 grain SSOT 소비).

  // ── T-20260525-foot-FEE-ITEM-REORDER: 수가 항목 순서 변경 ────────────────
  // AC-2: DB persist — services.display_order (clinic 단위, useEffect debounce 800ms).
  // AC-3: 기존 CRUD 무영향.
  // REOPEN AC-R2/AC-R3: PointerSensor 우선 — overflow-y-auto 스크롤 컨테이너에서
  // TouchSensor(distance 방식)는 브라우저 scroll gesture와 경합 발생.
  // PointerSensor(distance:3)는 Pointer Events API 경유 → 현대 태블릿 브라우저에서 안정적.
  // TouchSensor(delay:250)를 후순위 fallback으로 유지 (구형 기기 대응).
  const feeItemSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  // PMW-ORDER-REMOVE REOPEN1: handleReorderPricingItem 제거 (↑↓ UI 전면 제거)

  // DnD: pricing items 서브셋 내 arrayMove → selectedItems 재조합
  // REOPEN: String() 캐스팅 — UniqueIdentifier(string|number) vs string 비교 안전성 (AC-R2)
  const handleDragEndPricingItem = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || String(active.id) === String(over.id)) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    setSelectedItems((prev) => {
      const pairs = prev.map((item, idx) => ({ item, idx })).filter(({ item }) => !isCodeItem(item.service));
      const activePos = pairs.findIndex(({ item }) => item.service.id === activeIdStr);
      const overPos = pairs.findIndex(({ item }) => item.service.id === overIdStr);
      if (activePos === -1 || overPos === -1) return prev;
      const reordered = arrayMove(pairs.map(p => p.item), activePos, overPos);
      const next = [...prev];
      pairs.forEach((p, i) => { next[p.idx] = reordered[i]; });
      return next;
    });
    setSaved(false);
  }, []);

  const pricingItems = selectedItems.filter((i) => !isCodeItem(i.service));
  const codeItems = selectedItems.filter((i) => isCodeItem(i.service));

  // ── T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT (Part1, 수납잔액 급여 split) ──────
  //   세금구분/급여합/본인부담금 산출을 배포된 SSOT computeFootBilling(8239350e, DOCPRINT-RECUR)로
  //   일원화한다. PMW 인라인 재계산은 grade=null 시 copaymentTotal=0 으로 SSOT(본인=급여전액/공단=0)와
  //   divergence 하던 병렬 경로 → 제거. 항목 빌드는 buildPmwBillDetailItems(L1394~)와 동일 규칙
  //   (customAmounts 수기조정가 = check_in_services.price, qty 반영)으로 통일.
  const footBillingItems: FootBillingItem[] = pricingItems.map(({ service, qty }) => ({
    service,
    qty,
    unitPrice: customAmounts.get(service.id) ?? service.price ?? 0,
  }));
  const footBilling = computeFootBilling(footBillingItems, customerInsuranceGrade);
  const grandTotal = footBilling.grandTotal;                 // 총 진료비(급여 전액 + 비급여) — 서류 총진료비/합계 표시용
  const totalByTax: Record<TaxClass, number> = footBilling.totalByTax;
  const coveredTotal = footBilling.coveredTotal;             // 급여 진료비 전액(본인 + 공단)
  const nonCoveredTotal = footBilling.nonCoveredTotal;       // 비급여 전액(과세 + 면세)
  // copaymentTotal(문서 grain) — 서류출력(buildPmwBillDetailItems·service_charges autoValues) 전용.
  //   grade=null 서류 폴백은 DOCPRINT-RECUR(본인=급여전액/공단=0, 총괄확정) 그대로 — 회귀 0.
  const copaymentTotal = footBilling.copaymentTotal;
  // ── T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT (REOPEN RC): 수납 grain 본인부담 산정 ──────
  //   [현장 FAIL RC] computeFootBilling 의 DOCPRINT-RECUR 폴백(grade=null → 본인=급여전액)을 수납잔액에
  //   그대로 쓰면 공단(NHIS) 몫까지 환자에게 청구되는 과다수납(현장 P0). 라이브 고객 89%가 grade=null 이라
  //   사실상 전 급여 방문이 '공단 포함' 으로 표시됐다(E2E 는 grade=general 시나리오만 → PASS, 현장은 실
  //   급여환자(grade=null) 경로 → FAIL, divergence 원인). 수납 경로는 등급 미상 시 외래 급여 기본률
  //   general(30%)로 본인부담을 산정('general_default') → grade=general/null 모두 자부담 8,900 로 수렴.
  const payBilling = computeFootBilling(footBillingItems, customerInsuranceGrade, {
    unknownGradeCopay: 'general_default',
  });
  const payCopaymentTotal = payBilling.copaymentTotal;       // 수납 grain 본인부담금(등급 미상 → 30% 기본)
  // ★ 수납잔액(환자 실수납) = 급여 본인부담금 + 비급여 전액. 공단부담금(coveredTotal − 본인부담)은 제외.
  //   예: 급여 29,380(본인8,900+공단20,480)+비급여0 → payableTotal = 8,900 + 0 = 8,900.
  const payableTotal = payCopaymentTotal + nonCoveredTotal;
  // ── T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT (Part2, 공단부담액 정보성 라인) ─────
  //   공단부담액(명세) = 급여 진료비 − 본인부담금. 배포 SSOT computeFootBilling 의 liveBillingValues
  //   (insuranceCovered = max(0, coveredTotal − copaymentTotal))를 그대로 소비한다(병렬 계산 경로 신설 금지,
  //   DA CONSULT-REPLY MSG-20260714-121317-pq2t §구현제약1). 저장처 = 기존 canonical 컬럼
  //   service_charges.insurance_covered_amount(InsuranceCopaymentPanel.persistCharges 기록, 신규 DDL 없음).
  //   수납잔액(payments grain)에는 포함하지 않는 명세 grain 값 — 정보성 표시 전용.
  //   T-20260714 REOPEN: 수납 표시 박스 내 정합을 위해 payBilling(수납 grain, 등급 미상→30%) 소비.
  //   → 자부담 8,900 / 공단부담액 20,480 이 서로 정합(과거 footBilling 소비 시 grade=null 이면 공단=0 으로
  //   표시돼 '자부담 8,900 인데 공단 0' 모순 발생). 값>0 일 때만 노출. DB 무접촉(표시 전용).
  const insuranceCoveredTotal = payBilling.liveBillingValues.insuranceCovered;
  // 본인부담률 — 표시 라벨(급여 자부담 %)용 rate. 등급 미상(급여 방문)도 수납 산정과 동일하게 general(30%)로 표기.
  const copayRate = customerInsuranceGrade && COVERED_GRADES.has(customerInsuranceGrade)
    ? getBaseCopayRate(customerInsuranceGrade)
    : (coveredTotal > 0 ? getBaseCopayRate('general') : null); // 등급 미상 급여 방문 → 30% 라벨(수납 산정과 일치)

  // T-20260707-foot-DOCPRINT-INSURANCE-SPLIT-RECUR: 진료비세부산정내역(bill_detail) 행 빌드 SSOT.
  //   RC(재발): PMW(PATH-4) 단독발행 경로가 기존에 service.is_insurance_covered 만으로 급여/비급여를
  //   분류하고 per-item 본인부담금(copayment_amount)을 미주입 → 급여 항목의 급여구분(본인/공단 split)이
  //   '0'/공란으로 출력됐다(현장 재보고). DocumentPrintPanel(PATH-1/2/3)이 이미 쓰는 공유 빌더
  //   buildFootBillDetailItems 로 통일: getTaxClass(등급반영, hira_code 급여 포함) 분류 +
  //   copaymentTotal 비례배분(잔차보정)으로 본인/공단 컬럼을 채운다. 화면 산출값 그대로 사용(무재산정·무날조),
  //   신규 프린트 경로 신설 없음(기존 SSOT 재사용, AC-4/AC-5). 등급 비어도 svc.is_insurance_covered=true 는
  //   급여 분류 유지 → 최소한 급여/비급여 구분은 항상 삽입됨.
  const buildPmwBillDetailItems = (visitDate: string) => {
    const fbItems: FootBillingItem[] = pricingItems.map(({ service, qty }) => ({
      service,
      qty,
      unitPrice: customAmounts.get(service.id) ?? service.price ?? 0,
    }));
    return buildFootBillDetailItems(fbItems, visitDate, {
      insuranceGrade: customerInsuranceGrade,
      copaymentTotal,
    });
  };

  // ── T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX (결제미니창 PATH-4) ─────────────────
  //   신양식(bill_receipt_new) 발행 시 결함A(급여 category remainder)·결함B(⑪ 납부박스 payments) 주입.
  //   DPP 단건/일괄과 동일 SSOT 헬퍼 사용 — 3경로 대칭. PMW 는 야간가산 미적용이라 순서제약 없음
  //   (aggregate copayment/insurance_covered 는 위 applyBillingFallback 이 이미 세팅) — 호출부에서 그 뒤에 부른다.
  //   결함B 원장: payments(status=active) 실수납만 groupBy(완납 가정 금지). 인쇄 시점 미수납이면 납부박스 공란·미납=전액.
  const applyBillReceiptNewSplitAndPaid = async (
    autoValues: Record<string, string>,
    selected: { form_key: string }[],
  ): Promise<void> => {
    if (!selected.some((t) => t.form_key === 'bill_receipt_new') || pricingItems.length === 0) return;
    // 결함A: 급여 category remainder 토큰(진찰료 흡수 방지). buildPmwBillDetailItems = DPP 동일 SSOT.
    applyBillReceiptNewCoveredTokens(autoValues, buildPmwBillDetailItems(autoValues.visit_date ?? ''));
    // 결함B: payments 원장 결제수단별 실수납 groupBy.
    const { data: payRows } = await supabase
      .from('payments')
      .select('amount, method, cash_receipt_issued')
      .eq('check_in_id', checkIn.id)
      // 취소결제 미표시(CHECKIN-RECEIPT-SOFTVOID-PHANTOM 계승 fail-closed).
      .eq('status', 'active');
    // ⑧/⑩ 환자부담총액(절사 후) = 급여 본인부담 + 비급여(공단 제외, GONGDAN-HIDE-COPAY B안 동일 산식).
    const pmwNonCov = (totalByTax['비급여(과세)'] ?? 0) + (totalByTax['비급여(면세)'] ?? 0);
    const { roundedTotal: patientFloored } = computeBillDetailRounding(copaymentTotal + pmwNonCov);
    applyBillReceiptPaidBoxTokens(
      autoValues,
      (payRows ?? []) as Array<{ method?: string | null; amount?: number | null; cash_receipt_issued?: boolean | null }>,
      patientFloored,
    );
  };

  // 선수금차감 후 청구액 = (선수금차감 대상 제외한 항목의) 급여 본인부담금 + 비급여 전액.
  // ── T-20260721-foot-PMW-PREPAID-DEDUCT-COPAY-BASE [현장 P0, RC] ─────────────────
  //   [버그] 종전엔 getItemAmount(전액 = 급여 본인부담 + 공단부담 + 비급여) 을 합산 → 선수금 차감 후
  //   청구액에 공단(NHIS) 몫까지 포함돼 과다청구(예: 29,380 = 총 진료비, 공단 포함). 급여 환자 기대값은
  //   본인부담(30%) + 비급여(예: 8,800). 실결제 영향(현장 이은상 팀장 보고, 스샷 F0BJ728S6LX).
  //   [해소] 청구 base 는 BALANCE-SPLIT 배포본이 쓰는 수납 grain SSOT(payCopaymentTotal /
  //   computeFootBilling, 공단 제외 = 본인부담 30% + 비급여)여야 한다. 병렬 재계산 경로 신설 금지
  //   (DA §제약1: SSOT 단일소비). 차감대상 제외 subset 을 payBilling(L1493)과 **동일 옵션**
  //   (unknownGradeCopay:'general_default', 등급 미상 급여 → 외래 기본 30%)의 computeFootBilling 에
  //   통과시켜 copaymentTotal + nonCoveredTotal 을 청구 base 로 소비한다. 새 산식 경로 없음.
  //   → 선수금 항목이 없으면 subset = 전체 pricingItems 이므로 payableTotal(L1499)과 정확히 일치.
  // T-20260609-foot-TRIAL-REVENUE-ZERO: 체험권은 prepaid로 분류돼도 항상 청구금액에 산입
  //   (선수금차감 제외 → amount=0 증발 방지). 다회차 4종 차감제외는 그대로 유지.
  const calcDeductAmount = () => {
    const deductItems: FootBillingItem[] = pricingItems
      .filter((item) => !prepaidIds.has(item.service.id) || isTrialService(item.service))
      .map(({ service, qty }) => ({
        service,
        qty,
        unitPrice: customAmounts.get(service.id) ?? service.price ?? 0,
      }));
    const deductBilling = computeFootBilling(deductItems, customerInsuranceGrade, {
      unknownGradeCopay: 'general_default',
    });
    return deductBilling.copaymentTotal + deductBilling.nonCoveredTotal;
  };

  // ── 공통 check_in_services 저장 ──────────────────────────────────────────
  // T-20260519-foot-PKG-REVENUE-SPLIT AC-1:
  //   isDeductMode=true 시 prepaidIds 항목에 is_package_session=true 마킹
  //   → 해당 항목은 Closing 시술별 통계/매출 집계에서 자동 제외됨
  const saveCheckInServices = async (isDeductMode: boolean = false): Promise<boolean> => {
    if (pricingItems.length === 0 && codeItems.length === 0) {
      toast.error('시술 코드를 선택해주세요');
      return false;
    }

    const { error: delError } = await supabase
      .from('check_in_services')
      .delete()
      .eq('check_in_id', checkIn.id);
    if (delError) {
      toast.error('저장 실패: ' + delError.message);
      return false;
    }

    const rows = selectedItems.flatMap(({ service, qty }) => {
      const unitPrice =
        customAmounts.get(service.id) !== undefined
          ? customAmounts.get(service.id)!
          : service.price;
      // T-20260519-foot-PKG-REVENUE-SPLIT AC-1:
      // 선수금차감 모드에서 보라색(prepaid) 항목 = 패키지 세션으로 마킹
      // T-20260609-foot-TRIAL-REVENUE-ZERO: 체험권은 절대 패키지 세션으로 마킹하지 않음
      //   → is_package_session=false 보장 → Closing 매출 제외에 안 걸림 + 영수증 패키지 항목 실금액 노출(AC-5)
      const isPkgSession =
        isDeductMode && prepaidIds.has(service.id) && !isTrialService(service);
      return Array.from({ length: qty }, () => ({
        check_in_id: checkIn.id,
        service_id: service.id,
        service_name: service.name,
        price: unitPrice,
        original_price: service.price,
        is_package_session: isPkgSession,
      }));
    });

    if (rows.length > 0) {
      const { error } = await supabase.from('check_in_services').insert(rows);
      if (error) {
        toast.error('저장 실패: ' + error.message);
        return false;
      }
    }

    localStorage.removeItem(draftKey(checkIn.id));
    return true;
  };

  // ── [시술 저장 및 포함 금액 산정] (기존 handleSave, 전체 금액) ─────────────
  const handleSaveFull = async () => {
    // T-20260519-foot-PKG-REVENUE-SPLIT: 일반 저장은 isDeductMode=false
    const ok = await saveCheckInServices(false);
    if (!ok) return;
    setSaved(true);
    setDeductMode(false);
    toast.success('시술 저장 완료 — 금액 산정됨');
    onSaved?.();
    // AC-3: 저장 후 금일 시술내역(Zone3) 즉시 갱신 — 2번차트 연동
    loadZone3Data(checkIn);
  };

  // ── [선수금 차감 후 금액 산정] (PREPAID-DEDUCT AC-1) ─────────────────────
  const handleSaveDeduct = async () => {
    if (!hasActivePackage) {
      toast.error('활성 패키지가 없습니다');
      return;
    }
    if (pricingItems.length === 0) {
      toast.error('시술 코드를 선택해주세요');
      return;
    }
    // T-20260609-foot-TRIAL-REVENUE-ZERO: 체험권을 제외한 실제 선수금차감 대상이 없으면
    //   (예: 체험권 단독 방문) 선수금차감 모드로 진입하지 않고 전액 단건 매출로 저장.
    //   → tax_type=null·amount=실금액·is_package_session=false 보장 → 매출 증발 방지.
    const hasRealPrepaid = pricingItems.some(
      (i) => prepaidIds.has(i.service.id) && !isTrialService(i.service),
    );
    if (!hasRealPrepaid) {
      await handleSaveFull();
      return;
    }
    // T-20260519-foot-PKG-REVENUE-SPLIT: 선수금차감 모드에서 prepaid 항목 is_package_session=true 마킹
    const ok = await saveCheckInServices(true);
    if (!ok) return;

    const deducted = calcDeductAmount();
    setDeductAmount(deducted);
    setDeductMode(true);
    setSaved(true);
    toast.success(`선수금 차감 후 청구 금액: ${formatAmount(deducted)}`);
    onSaved?.();
    // AC-3: 저장 후 금일 시술내역(Zone3) 즉시 갱신 — 2번차트 연동
    loadZone3Data(checkIn);
  };

  // ── T-20260721-foot-CALCOPAY-PIPELINE-RESTORE §2 ────────────────────────────
  //   [RCA] 라이브 체크아웃은 payments 만 남기고 service_charges(본인/공단 split 명세 =
  //   billing 감사·정산 정답 소스)를 안 남겨, 6/6 이후 신규 명세 0건(총 2행=수기 테스트).
  //   진찰료(hira_category='consultation') 외 급여 시술엔 명세 write-path 가 부재했다
  //   (record_insurance_consult_payment 는 consultation 단일 카테고리 전용).
  //   [복구] 결제 확정 후 이 방문의 covered(급여) 시술을 calc_copayment(서버 단일권위)로
  //   스냅샷 INSERT 해 명세 grain 을 재활성한다. 원칙:
  //     · forward-only : 신규 방문만(기존 행 UPDATE·소급 절대 금지 — 소급은 별건 DESTRUCTIVE 게이트)
  //     · best-effort  : never throw — 결제(payments/check_ins done)는 이미 커밋됨, 실패해도 무롤백
  //     · idempotent   : 이 방문에 이미 있는 service_charge(service_id)는 skip
  //                      (consult write-path 중복·재시도/더블클릭 방지)
  //     · charge-only  : payments 무접촉(공단분 이중수납·중복 payment 방지)
  //     · no-fabricate : calc data_incomplete(자격·수가 미비)=금액 날조 금지 → 해당 시술 skip(재정산 경로)
  //   신규 DDL 불요(service_charges·calc_copayment 기존 오브젝트 재사용). 명세 grain 은 SSOT
  //   revenue_insurance_split(공단부담=service_charges) 계약 준수 = 소스 재활성이지 신규 축 아님.
  const snapshotCoveredServiceCharges = async (visitDate: string) => {
    if (!checkIn.customer_id) return;
    // 급여 시술 고유 집합 (code/상병 항목 제외 = pricingItems 기준)
    const covered = Array.from(
      new Map(
        pricingItems
          .filter(({ service }) => service.is_insurance_covered === true)
          .map(({ service }) => [service.id, service]),
      ).values(),
    );
    if (covered.length === 0) return;
    // 이 방문에 이미 적재된 명세(service_id) — consult write-path/재시도 중복 방지
    const { data: existing } = await supabase
      .from('service_charges')
      .select('service_id')
      .eq('check_in_id', checkIn.id);
    const already = new Set((existing ?? []).map((r) => r.service_id as string));
    const rows: Array<Record<string, unknown>> = [];
    for (const svc of covered) {
      if (already.has(svc.id)) continue;
      const { data: calc, error: calcErr } = await supabase.rpc('calc_copayment', {
        p_service_id: svc.id,
        p_customer_id: checkIn.customer_id,
        p_clinic_id: checkIn.clinic_id,
        p_visit_date: visitDate,
      });
      if (calcErr) {
        console.warn('service_charges 스냅샷 calc_copayment 실패:', svc.id, calcErr.message);
        continue;
      }
      const r = (Array.isArray(calc) ? calc[0] : calc) as {
        base_amount: number;
        insurance_covered_amount: number;
        copayment_amount: number;
        exempt_amount: number;
        applied_rate: number | null;
        applied_grade: string | null;
        data_incomplete: boolean;
      } | null;
      if (!r) continue;
      if (r.data_incomplete) continue; // 자격/수가 미비 = 금액 날조 금지, 재정산 경로 위임
      rows.push({
        clinic_id: checkIn.clinic_id,
        check_in_id: checkIn.id,
        customer_id: checkIn.customer_id,
        service_id: svc.id,
        is_insurance_covered: true,
        hira_score: svc.hira_score ?? null,
        base_amount: r.base_amount,
        insurance_covered_amount: r.insurance_covered_amount,
        copayment_amount: r.copayment_amount,
        exempt_amount: r.exempt_amount,
        customer_grade_at_charge: r.applied_grade,
        copayment_rate_at_charge: r.applied_rate,
        calculation_engine_version: 'pmw_checkout_snapshot_v1',
      });
    }
    if (rows.length > 0) {
      const { error } = await supabase.from('service_charges').insert(rows);
      if (error) console.warn('service_charges 스냅샷 INSERT 실패:', error.message);
    }
  };

  // ── executeAutoDone ────────────────────────────────────────────────────────
  // T-20260616-foot-PMW-SPLIT-PAYMENT AC-3/AC-4:
  //   splits = [{method, amount}] N개 → payments 행 N개를 동일 check_in_id로 분리 insert.
  //   단일 결제수단(분할 미사용)은 splits 길이 1로 종전과 동일하게 1행 insert(회귀 없음).
  //   수납완료 전이(check_ins.status='done')는 행 개수와 무관 — 합산=수납액 검증은 호출부에서 강제(AC-5).
  const executeAutoDone = async (
    splits: { method: PayMethod; amount: number }[],
    taxType?: string | null,
  ) => {
    // PAY-CASH-RECEIPT: 결제 삽입 시 cash_receipt_issued 포함 (현금/이체 행에 한해)
    const buildPayRow = (s: { method: PayMethod; amount: number }) => {
      const isCashLike = s.method === 'cash' || s.method === 'transfer';
      return {
        check_in_id: checkIn.id,
        clinic_id: checkIn.clinic_id,
        customer_id: checkIn.customer_id,
        amount: s.amount,
        method: s.method,
        installment: null,
        memo: null,
        payment_type: 'payment',
        tax_type: taxType ?? null,
        cash_receipt_issued: isCashLike ? cashReceiptIssued : null,
        cash_receipt_type:
          isCashLike && cashReceiptIssued ? cashReceiptType : null,
        // T-20260526-foot-PAY-INPUT-001-SIMPLIFY: 매처 자동 채움 (UI 입력 제거)
        external_approval_no: null,
        external_tid: null,
      };
    };

    // ── T-20260715-foot-CONSULTFEE-WRITEPATH-INSURANCE-SPLIT ─────────────────
    //   급여 진찰료(건강보험) 수납 write-path. 기존엔 진찰료가 plain payment(tax_type=null)로만 남아
    //   §2-1 NULL→면세→비급여 오귀속 + 명세(service_charges) 0건 → 매출 급여 칸 영구 0.
    //   해소: covered 진찰료(is_insurance_covered && hira_category='consultation') 항목의 본인부담분을
    //   서버 원자 RPC record_insurance_consult_payment 로 라우팅 → service_charge(is_insurance_covered=TRUE,
    //   calc_copayment 반환 적재) + copay payment(tax_type NULL=면세, service_charge_id FK) 원자 생성 + 멱등.
    //   나머지(비급여·비진찰료 급여 등)만 기존 plain payment 경로 유지(회귀 0). going-forward only(W7).
    //   ⚠ 단일 결제수단(splits.length===1)·비선수금 경로에서만 RPC 사용 — 분할/선수금 혼합은 parent C4
    //     활성화(1:N 배분) 소관(DA Q3, 본 티켓 blocking 아님) → 기존 동선 그대로.
    const isDeductSettle = taxType === '선수금';
    const coveredConsultServices =
      !isDeductSettle && splits.length === 1
        ? Array.from(
            new Map(
              pricingItems
                .filter(
                  ({ service }) =>
                    service.is_insurance_covered === true &&
                    service.hira_category === 'consultation',
                )
                .map(({ service }) => [service.id, service]),
            ).values(),
          )
        : [];

    let effectiveSplits = splits;
    if (coveredConsultServices.length > 0) {
      const visitDate =
        checkIn.checked_in_at?.slice(0, 10) ??
        new Date().toISOString().slice(0, 10);
      let consultCopaySum = 0;
      for (const svc of coveredConsultServices) {
        // atomic RPC — 부분성공(payment만/명세만) 방지: 에러 시 throw 로 전체 수납 중단.
        const { data: rpcData, error: rpcErr } = await supabase.rpc(
          'record_insurance_consult_payment',
          {
            p_check_in_id: checkIn.id,
            p_customer_id: checkIn.customer_id,
            p_clinic_id: checkIn.clinic_id,
            p_service_id: svc.id,
            p_method: splits[0].method,
            p_visit_date: visitDate,
          },
        );
        if (rpcErr) throw rpcErr;
        const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
          | { copayment_amount?: number }
          | null;
        consultCopaySum += row?.copayment_amount ?? 0;
      }
      // 진찰료 copay 는 RPC 가 이미 payment 를 생성 → plain 에서 제외. 나머지(비급여 등)만 plain insert.
      const remainder = Math.max(0, splits[0].amount - consultCopaySum);
      effectiveSplits =
        remainder > 0 ? [{ method: splits[0].method, amount: remainder }] : [];
    }

    const payRows = effectiveSplits.map(buildPayRow);
    if (payRows.length > 0) {
      const { error: payErr } = await supabase.from('payments').insert(payRows);
      if (payErr) throw payErr;
    }

    const { error: ciErr } = await supabase
      .from('check_ins')
      .update({ status: 'done' })
      .eq('id', checkIn.id);
    if (ciErr) throw ciErr;

    // ── T-20260703-foot-JONGNO-PACKAGE-TRIPLE-DEFECT (c) ────────────────────────
    //   선수금차감(taxType='선수금') 수납 확정 시 package_sessions 를 실제 소진한다.
    //   기존엔 check_in_services.is_package_session 마킹만 하고 회차를 insert 하지 않아
    //   '잔여가 영영 줄지 않는' 현금손실 결함이 있었다. RPC 는 동일 check_in 멱등 + 초과차감 방지.
    if (taxType === '선수금' && checkIn.customer_id) {
      const counts: Record<string, number> = {
        heated_laser: 0, unheated_laser: 0, iv: 0, podologue: 0,
      };
      for (const { service, qty } of selectedItems) {
        if (!prepaidIds.has(service.id) || isTrialService(service)) continue;
        const st = prepaidSessionType(service);
        if (st) counts[st] += qty;
      }
      if (counts.heated_laser + counts.unheated_laser + counts.iv + counts.podologue > 0) {
        const { data: consumeData, error: consumeErr } = await supabase.rpc(
          'consume_package_sessions_for_checkin',
          {
            p_check_in_id: checkIn.id,
            p_customer_id: checkIn.customer_id,
            p_clinic_id: checkIn.clinic_id,
            p_counts: counts,
          },
        );
        if (consumeErr) {
          // 수납은 이미 커밋됨 → 회차 차감 실패는 결제를 롤백하지 않되, 반드시 노출(수동 회차소진 유도).
          console.error('선수금 회차 차감 실패:', consumeErr.message);
          toast.error(`선수금 회차 차감 실패 — 패키지에서 수동 회차소진 필요: ${consumeErr.message}`);
        } else {
          const ins = (consumeData as { inserted?: number } | null)?.inserted ?? 0;
          if (ins > 0) toast.success(`선수금 회차 ${ins}건 차감 완료`);
        }
      }
    }

    const { error: trErr } = await supabase.from('status_transitions').insert({
      check_in_id: checkIn.id,
      clinic_id: checkIn.clinic_id,
      from_status: checkIn.status,
      to_status: 'done',
    });
    if (trErr) {
      console.warn('status_transitions insert failed:', trErr.message);
    }
    // T-20260609-foot-DASH-COMPLETE-PAYFLAG-SYNC: 수납([수납]) 완료 = 완료 슬롯 이동 →
    //   status_flag 'dark_gray'(수납완료/회색) 자동전환. 결제·status='done'은 이미 커밋됨 →
    //   플래그 실패가 결제 흐름을 롤백하지 않음(best-effort). SSOT applyStatusFlagTransition 경유.
    try {
      await applyStatusFlagTransition(checkIn, 'dark_gray', {
        id: profile?.id ?? null,
        name: profile?.name ?? null,
        role: profile?.role ?? null,
      });
    } catch (flagErr) {
      console.error('status_flag dark_gray 전이 실패(결제는 정상 완료):', flagErr);
    }
    // T-20260602-foot-VISITTYPE-RETURNING-AUTOSET: 완료 시 visit_type 자동 승격 (best-effort)
    await promoteVisitTypeToReturning(checkIn.customer_id);

    // T-20260721-foot-CALCOPAY-PIPELINE-RESTORE §2: 급여 명세 스냅샷 재활성 (best-effort).
    //   결제(payments/check_ins done)는 이미 커밋 완료 → 스냅샷 실패해도 결제 흐름 무영향.
    try {
      const visitDate =
        checkIn.checked_in_at?.slice(0, 10) ??
        new Date().toISOString().slice(0, 10);
      await snapshotCoveredServiceCharges(visitDate);
    } catch (scErr) {
      console.error('service_charges 명세 스냅샷 실패(결제는 정상 완료):', scErr);
    }
  };

  // ── T-20260616-foot-PMW-SPLIT-PAYMENT: 수납 splits 빌더 ─────────────────────
  //   splitMode off → 단일 [{payMethod, amount}] (AC-4 회귀 동선).
  //   splitMode on  → splitRows(금액>0만) 사용 + 합산=수납액 검증(AC-2). 불일치 시 null 반환(차단).
  const buildSettleSplits = (
    amount: number,
  ): { method: PayMethod; amount: number }[] | null => {
    if (!splitMode) {
      return [{ method: payMethod, amount }];
    }
    const rows = splitRows
      .map((r) => ({ method: r.method, amount: Math.round(r.amount) }))
      .filter((r) => r.amount > 0);
    if (rows.length === 0) {
      toast.error('분할 결제 금액을 입력해주세요');
      return null;
    }
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    if (sum !== amount) {
      const diff = amount - sum;
      toast.error(
        diff > 0
          ? `분할 금액 합계가 ${formatAmount(diff)} 부족합니다`
          : `분할 금액 합계가 ${formatAmount(-diff)} 초과입니다`,
      );
      return null;
    }
    return rows;
  };

  // ── [수납] — PAY-SLOT-MOVE: [수납] 클릭 시만 done 이동 ─────────────────────
  const handleSettle = async () => {
    if (!saved) {
      toast.error('[시술 저장 및 금액 산정]을 먼저 완료해주세요');
      return;
    }
    // ── T-20260708-foot-PAYMINI-INSURANCE-CHARTREQ-UNBLOCK: 수납 차단 게이트 제거 ──
    //   과거 MEDLAW22-B-GATE 의 진료기록 필수 + 방문일 일치 하드차단을 여기서 완전히 제거.
    //   급여/비급여 무관, 진료기록 미작성·비내원일(계좌이체 등)에도 수납을 그대로 진행한다.
    //   (급여 청구 정합상 진료기록 후속 작성은 여전히 필요 — soft 리마인더로만 안내.)
    // T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT: payments 기록 = 수납잔액(본인부담금+비급여). 공단부담금 제외.
    const amount = deductMode ? deductAmount : payableTotal;
    // T-20260519-foot-DEDUCT-PAY-METHOD AC-1: deductMode에서도 실제 결제수단 사용
    // 선수금차감 여부와 무관하게 항상 사용자가 선택한 payMethod 기록
    // (선수금차감 추적은 package_sessions 회차 소진으로 별도 관리)
    const taxType = deductMode ? '선수금' : null;

    if (amount < 0) {
      toast.error('결제 금액이 올바르지 않습니다');
      return;
    }
    // T-20260616-foot-PMW-SPLIT-PAYMENT AC-2: 분할 합산=수납액 아닐 시 차단
    const splits = buildSettleSplits(amount);
    if (!splits) return;
    setSubmitting(true);
    try {
      await executeAutoDone(splits, taxType);
      localStorage.removeItem(draftKey(checkIn.id));
      toast.success('수납 완료 — 완료 슬롯으로 이동됩니다');
      setSubmitting(false);
      onComplete(); // ← PAY-SLOT-MOVE: onComplete만 완료 이동. onClose는 이동 없음.
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '수납 처리 실패';
      toast.error(msg);
      setSubmitting(false);
    }
  };

  // ── PAY-SLOT-MOVE AC-3: X 닫기 → 자동 저장 + 수납대기 유지 ─────────────────
  // T-20260522-foot-PAY-PRINT-BUGS Bug D fix:
  //   기존: INSERT 에러를 체크하지 않고 항상 localStorage.removeItem() 호출
  //         → INSERT RLS 실패 시 draft도 삭제되어 "목록 사라짐" 발생
  //   수정: INSERT 에러 시 draft 보존(removeItem 스킵) → 재진입 시 선택 내용 복원
  const handleClose = async () => {
    // 미저장 항목이 있으면 DB 자동 저장 (수납대기 유지 — status 변경 없음)
    if (!saved && selectedItems.length > 0) {
      try {
        await supabase
          .from('check_in_services')
          .delete()
          .eq('check_in_id', checkIn.id);
        const rows = selectedItems.flatMap(({ service, qty }) =>
          Array.from({ length: qty }, () => ({
            check_in_id: checkIn.id,
            service_id: service.id,
            service_name: service.name,
            price: customAmounts.get(service.id) ?? service.price,
            original_price: service.price,
            is_package_session: false,
          })),
        );
        if (rows.length > 0) {
          const { error: insertErr } = await supabase.from('check_in_services').insert(rows);
          // INSERT 실패(RLS 등) 시 draft를 보존하고 창만 닫음 — localStorage 삭제 금지
          if (insertErr) {
            onClose();
            return;
          }
        }
        localStorage.removeItem(draftKey(checkIn.id));
      } catch {
        /* 닫기 시 저장 실패는 무시 */
      }
    }
    onClose(); // status 변경 없음 — 수납대기 유지
  };

  // ── 서류 토글 ─────────────────────────────────────────────────────────────
  const toggleDocKey = (formKey: string) => {
    setSelectedDocKeys((prev) => {
      const next = new Set(prev);
      if (next.has(formKey)) next.delete(formKey);
      else next.add(formKey);
      return next;
    });
  };

  // ── T-20260620-foot-MEDDOC-DESK-PRINTONLY-DOCTOR-AUTHORED (B안) ──
  //   소견서(diag_opinion)·진단서(diagnosis) = 원장 발행본(opinion_doc, published)만 출력.
  //   원장 미작성 = 버튼 비활성(disabled). 작성 완료 = 클릭 시 발행본 그대로 인쇄(일괄선택/자유작성 비대상).
  const { data: medDocAuthored } = useAuthoredMedDocs(
    checkIn?.clinic_id ?? null,
    checkIn?.customer_id ?? null,
  );
  const { data: medDocClinicHeader } = useClinicHeader(checkIn?.clinic_id ?? null);
  const medDocGate = (formKey: string): { authored: boolean; onPrint: () => void } | null => {
    if (!isGatedMedDoc(formKey)) return null;
    const doc = medDocAuthored?.byType?.[medDocFormKeyToDocType(formKey)];
    return {
      authored: !!doc,
      onPrint: async () => {
        // T-20260721-foot-OPINIONDOC-DESK-BLANK (평행경로): checkIn 전달 → 공용 함수가
        //   loadAutoBindContext 로 환자정보·상병 토큰을 채운다(종전 이름만 표시 공란 해소).
        const ok = await printAuthoredMedDoc(formKey, doc, {
          patientName: checkIn?.customer_name ?? null,
          clinicHeader: medDocClinicHeader ?? null,
          checkIn: checkIn ?? undefined,
        });
        if (!ok) toast.error('팝업이 차단되었거나 발행본을 불러올 수 없습니다.');
      },
    };
  };

  // ── [출력] — PAY-SLOT-MOVE: 출력만, 슬롯 이동 없음 ─────────────────────────
  // T-20260517-foot-DOC-CODE-INSERT: HTML 템플릿 렌더링 + 상병코드/처방약 자동 주입
  const handleDocPrint = async () => {
    const selected = templates.filter((t) => selectedDocKeys.has(t.form_key));
    if (selected.length === 0) {
      toast.error('서류를 선택해주세요');
      return;
    }
    // T-20260710-foot-RRN-REGISTER-ERR-ISSUE-FROMCHART2 AC2: 미저장 2번차트 → 저장 확인 후 발급(구값 발급 방지).
    if (!(await ensureChartSavedBeforePublish())) return;
    setDocPrinting(true);
    try {
      // T-20260521-foot-DOC-PRINT-UNIFY PUSH: loadAutoBindContext (공유 lib) 로 교체.
      // 경로 4 = 1순위 — DocumentPrintPanel과 동일한 25+ 필드 바인딩 사용.
      const autoValues = await loadAutoBindContext(checkIn);

      // T-20260606-foot-DOC-FIELD-MISSING-3 AC-1/2/3: 보험청구서·진료비계산서 금액 라이브 보강.
      //   결제창(PATH-4) 단독 발행 시 service_charges 미기록 → autobind이 0/빈값 반환 →
      //   공단부담금/본인부담금/비급여 "미표기". 화면 실 산출값으로 폴백(autobind 값 있으면 보존).
      //   공단부담금 = 급여합계 − 본인부담금, 비급여 = 비급여(과세)+비급여(면세).
      applyBillingFallback(autoValues, {
        insuranceCovered: Math.max(0, coveredTotal - copaymentTotal),
        copayment: copaymentTotal,
        nonCovered: (totalByTax['비급여(과세)'] ?? 0) + (totalByTax['비급여(면세)'] ?? 0),
        // T-20260609-foot-PAY-DOCPRINT-FEE-MISSING: 수납 전 출력 시 진료비(total_amount) 누락 방지.
        //   수납 시 payments.amount로 기록될 값과 동일(deductMode?deductAmount:grandTotal) → 수납 전/후 동일.
        total: deductMode ? deductAmount : grandTotal,
      });

      // bill_detail items_html 주입 (결제 전 in-memory 데이터 사용)
      if (selected.some((t) => t.form_key === 'bill_detail') && pricingItems.length > 0) {
        autoValues.items_html = buildBillDetailItemsHtml(buildPmwBillDetailItems(autoValues.visit_date ?? ''));
        if (grandTotal > 0) {
          autoValues.total_amount = formatAmount(grandTotal);
          autoValues.subtotal_amount = formatAmount(grandTotal);
        }
        // T-20260716-foot-DOCPRINT-GONGDAN-SUM-REGRESSION (AC-2/6): 세부산정내역 '계'·'합계' = 급여 본인부담금 + 비급여(공단 제외).
        //   RC = GONGDAN-HIDE-COPAY-ONLY(B안)이 계/합계 셀 placeholder 를 {{detail_subtotal}}/{{detail_total}} 로 바꿨으나
        //   결제창(PATH-4) 바인딩만 미갱신 → 두 영역 공란 회귀. DocumentPrintPanel 과 동일 산식(copaymentTotal 본인부담 +
        //   비급여 합계, 위 applyBillingFallback nonCovered 와 동일 소스)으로 복구 — 건보 산출로직·서식 무변경(AC-7).
        // T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX:
        //   AC-① 계 행 열별 세로합(본인부담금/공단부담금/비급여) 결제창 경로 미세팅 → blank 회귀 복구.
        //   AC-② 끝처리 조정(10원 절사). AC-③ 합계=본인+비급여(절사 후). DocumentPrintPanel 과 동일 산식.
        {
          const pmwNonCov = (totalByTax['비급여(과세)'] ?? 0) + (totalByTax['비급여(면세)'] ?? 0);
          const pmwFund = Math.max(0, coveredTotal - copaymentTotal);
          const pmwPayable = copaymentTotal + pmwNonCov;
          const { adjustment, roundedTotal } = computeBillDetailRounding(pmwPayable);
          // 계 행 열별 세로합 (AC-①, 5개 열 전부)
          autoValues.subtotal_copayment = formatAmount(copaymentTotal);
          autoValues.total_copayment = autoValues.subtotal_copayment;
          autoValues.subtotal_fund = formatAmount(pmwFund);
          autoValues.total_fund = autoValues.subtotal_fund;
          autoValues.subtotal_noncovered = formatAmount(pmwNonCov);
          autoValues.total_noncovered = autoValues.subtotal_noncovered;
          // 계 총액(절사 전) / 끝처리 조정 / 합계(절사 후)
          autoValues.detail_subtotal = formatAmount(pmwPayable);
          autoValues.detail_rounding = formatAmount(adjustment);
          autoValues.detail_total = formatAmount(roundedTotal);
        }
      }
      // T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT: bill_receipt 항목별 그리드(공단/본인/비급여).
      //   PATH-4(결제창 단독발행)도 세부산정내역과 동일 SSOT(buildPmwBillDetailItems)로 항목별 집계.
      if (selected.some((t) => t.form_key === 'bill_receipt') && pricingItems.length > 0) {
        autoValues.fee_grid_html = buildBillReceiptFeeGridHtml(buildPmwBillDetailItems(autoValues.visit_date ?? ''));
        // T-20260716-foot-DOCPRINT-GONGDAN-SUM-REGRESSION (AC-1): 계산서·영수증 소계·총 진료비 합계 = 본인부담금 + 비급여(공단 제외).
        //   {{receipt_total}} 미바인딩 → 합계 공란 회귀 복구. 동일 산식·서식 무변경(AC-7), 공단부담 라인 표시 유지(AC-3).
        autoValues.receipt_total = formatAmount(
          copaymentTotal + (totalByTax['비급여(과세)'] ?? 0) + (totalByTax['비급여(면세)'] ?? 0),
        );
      }

      // ★ T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST 경로B / L-006 현장승인): persist-before-print.
      //   인쇄 전에 form_submissions INSERT + 처방전 교부번호 발행시점 채번·persist → 확정 교부번호(rxIssueNo)로 인쇄본 렌더.
      //   (구: print-first → insert(fire&forget). 순서재편 = 김주연 총괄 현장승인 2026-07-18.)
      // T-20260721-foot-BILLDOC-COPAY-PMW-REMAIN 단계 B: 신양식(bill_receipt_new) 처치/검사 비급여 항목행
      //   category 토큰 주입 — DPP applyBillReceiptNewCategoryTokens 와 동일 인자(buildPmwBillDetailItems).
      //   종전 PMW엔 proc_noncov 주입 전무 → 결제미니창 인쇄 시 처치/검사 행 공란. 3버킷 합=non_covered 정합(표시 전용).
      if (
        selected.some((t) => t.form_key === 'bill_receipt_new' || t.form_key === 'bill_receipt' || t.form_key === 'bill_detail') &&
        pricingItems.length > 0
      ) {
        applyBillReceiptNewCategoryTokens(autoValues, buildPmwBillDetailItems(autoValues.visit_date ?? ''));
      }
      // T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX: 신양식 급여 remainder + ⑪ 납부박스 payments 배선.
      await applyBillReceiptNewSplitAndPaid(autoValues, selected);
      const isFallback = templates[0]?.id.startsWith('fallback-');
      const rxIssueNo = await persistSubmissionsAndResolveIssueNo({
        selected,
        clinicId: checkIn.clinic_id,
        checkInId: checkIn.id,
        customerId: checkIn.customer_id ?? null,
        staffId,
        autoValues,
        codeItems,
        rxItemDosages,
        isFallback,
      });

      // AC-5: bill_detail(진료비세부산정내역)은 landscape 전용 iframe으로 분리
      const landscapeSelected = selected.filter((t) => t.form_key === 'bill_detail');
      const portraitSelected  = selected.filter((t) => t.form_key !== 'bill_detail');

      const buildPages = (tmplList: typeof selected) =>
        tmplList.flatMap((t) => {
          // T-20260517-foot-DOC-CODE-INSERT: 상병코드/처방약 주입
          // T-20260517-foot-RX-DOSAGE-DYNAMIC: per-item rxItemDosages 전달
          // T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST): persist된 확정 교부번호(rxIssueNo) 주입 → 인쇄본 = 저장본 동일번호.
          const enriched = buildCodeEnrichedValues(autoValues, codeItems, t.form_key, rxItemDosages, rxIssueNo);
          // HTML 양식 우선 (template_format='html' 또는 HTML_TEMPLATE_MAP에 등록된 키)
          if (t.template_format === 'html' || isHtmlTemplate(t.form_key)) {
            // T-20260526-foot-RX-PRINT-DUAL: 처방전(rx_standard) 2장 출력 (약국보관용 + 환자보관용)
            if (t.form_key === 'rx_standard') {
              const p1 = buildHtmlPageDiv(t, enriched, '약국보관용');
              const p2 = buildHtmlPageDiv(t, enriched, '환자보관용');
              return [p1, p2].filter(Boolean);
            }
            const page = buildHtmlPageDiv(t, enriched);
            return page ? [page] : [];
          }
          // JPG/PNG 이미지 오버레이 방식
          const imgUrl = getTemplateImageUrl(t.form_key);
          if (!imgUrl) return [];
          return [buildPageHtml(t, enriched, imgUrl)];
        });

      const landscapePages = buildPages(landscapeSelected);
      const portraitPages  = buildPages(portraitSelected);

      if (landscapePages.length === 0 && portraitPages.length === 0) {
        toast.warning('출력 가능한 양식이 없습니다');
        return;
      }
      // PAY-SLOT-MOVE AC-4: iframe 인쇄 — 중복 창 없음
      // AC-5: landscape(진료비세부산정내역)와 portrait 분리 출력
      if (landscapePages.length > 0) {
        printViaIframe(buildPrintHtml(landscapePages, `서류 출력 — ${checkIn.customer_name}`, true));
      }
      if (portraitPages.length > 0) {
        printViaIframe(buildPrintHtml(portraitPages, `서류 출력 — ${checkIn.customer_name}`));
      }
      toast.success(`${selected.length}종 출력 요청됨`);
      // T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST 경로B): form_submissions 이력 기록은
      //   persistSubmissionsAndResolveIssueNo() 에서 **인쇄 전** 이미 완료(persist-before-print). 구 print-후 fire&forget 제거.
      // 슬롯 이동 없음 (onComplete 호출 X)
    } finally {
      setDocPrinting(false);
    }
  };

  // ── [출력 및 수납] — 출력 + auto-done ───────────────────────────────────────
  // T-20260517-foot-DOC-CODE-INSERT: HTML 템플릿 렌더링 + 상병코드/처방약 자동 주입
  const handleDocAndSettle = async () => {
    const selected = templates.filter((t) => selectedDocKeys.has(t.form_key));
    if (selected.length === 0) {
      toast.error('서류를 선택해주세요');
      return;
    }
    if (!saved) {
      toast.error('[시술 저장 및 금액 산정]을 먼저 완료해주세요');
      return;
    }
    // T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT: payments 기록 = 수납잔액(본인부담금+비급여). 공단부담금 제외.
    //   (서류 total_amount/공단·본인 split 표기는 아래 applyBillingFallback 그대로 — 총진료비 기준, Part1 무접촉.)
    const amount = deductMode ? deductAmount : payableTotal;
    if (amount < 0) {
      toast.error('결제 금액이 없습니다');
      return;
    }
    // T-20260710-foot-RRN-REGISTER-ERR-ISSUE-FROMCHART2 AC2: 미저장 2번차트 → 저장 확인 후 발급(구값 발급 방지).
    if (!(await ensureChartSavedBeforePublish())) return;
    setDocSettlePrinting(true);
    try {
      // 1. 서류 출력 (iframe — PAY-SLOT-MOVE AC-4)
      // T-20260517-foot-DOC-CODE-INSERT: 상병코드/처방약 주입
      // T-20260517-foot-RX-DOSAGE-DYNAMIC: per-item rxItemDosages 전달
      // T-20260521-foot-DOC-PRINT-UNIFY PUSH: loadAutoBindContext (경로 4 = 1순위 통일 바인딩)
      const autoValues = await loadAutoBindContext(checkIn);

      // T-20260606-foot-DOC-FIELD-MISSING-3 AC-1/2/3: 보험청구서·진료비계산서 금액 라이브 보강.
      //   결제창(PATH-4) 단독 발행 시 service_charges 미기록 → autobind이 0/빈값 반환 →
      //   공단부담금/본인부담금/비급여 "미표기". 화면 실 산출값으로 폴백(autobind 값 있으면 보존).
      //   공단부담금 = 급여합계 − 본인부담금, 비급여 = 비급여(과세)+비급여(면세).
      applyBillingFallback(autoValues, {
        insuranceCovered: Math.max(0, coveredTotal - copaymentTotal),
        copayment: copaymentTotal,
        nonCovered: (totalByTax['비급여(과세)'] ?? 0) + (totalByTax['비급여(면세)'] ?? 0),
        // T-20260609-foot-PAY-DOCPRINT-FEE-MISSING: 출력+수납 경로도 동일 폴백 적용(수납 전 출력본과 일치).
        total: deductMode ? deductAmount : grandTotal,
      });

      // bill_detail items_html 주입 (결제 전 in-memory 데이터 사용)
      if (selected.some((t) => t.form_key === 'bill_detail') && pricingItems.length > 0) {
        autoValues.items_html = buildBillDetailItemsHtml(buildPmwBillDetailItems(autoValues.visit_date ?? ''));
        if (grandTotal > 0) {
          autoValues.total_amount = formatAmount(grandTotal);
          autoValues.subtotal_amount = formatAmount(grandTotal);
        }
        // T-20260716-foot-DOCPRINT-GONGDAN-SUM-REGRESSION (AC-2/6): 세부산정내역 '계'·'합계' = 급여 본인부담금 + 비급여(공단 제외).
        //   출력+수납 경로도 동일 회귀 — {{detail_subtotal}}/{{detail_total}} 미바인딩 공란 복구. 산식·서식 무변경(AC-7).
        // T-20260719-foot-MEDCALC-DETAIL-LAYOUT-FIX: AC-① 계 행 열별 세로합 + AC-② 끝처리 조정 + AC-③ 합계(절사 후).
        {
          const pmwNonCov = (totalByTax['비급여(과세)'] ?? 0) + (totalByTax['비급여(면세)'] ?? 0);
          const pmwFund = Math.max(0, coveredTotal - copaymentTotal);
          const pmwPayable = copaymentTotal + pmwNonCov;
          const { adjustment, roundedTotal } = computeBillDetailRounding(pmwPayable);
          autoValues.subtotal_copayment = formatAmount(copaymentTotal);
          autoValues.total_copayment = autoValues.subtotal_copayment;
          autoValues.subtotal_fund = formatAmount(pmwFund);
          autoValues.total_fund = autoValues.subtotal_fund;
          autoValues.subtotal_noncovered = formatAmount(pmwNonCov);
          autoValues.total_noncovered = autoValues.subtotal_noncovered;
          autoValues.detail_subtotal = formatAmount(pmwPayable);
          autoValues.detail_rounding = formatAmount(adjustment);
          autoValues.detail_total = formatAmount(roundedTotal);
        }
      }
      // T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT: bill_receipt 항목별 그리드(출력+수납 경로).
      if (selected.some((t) => t.form_key === 'bill_receipt') && pricingItems.length > 0) {
        autoValues.fee_grid_html = buildBillReceiptFeeGridHtml(buildPmwBillDetailItems(autoValues.visit_date ?? ''));
        // T-20260716-foot-DOCPRINT-GONGDAN-SUM-REGRESSION (AC-1): 계산서·영수증 소계·총 진료비 합계 = 본인부담금 + 비급여(공단 제외).
        //   {{receipt_total}} 미바인딩 공란 회귀 복구. 산식·서식 무변경(AC-7), 공단부담 라인 표시 유지(AC-3).
        autoValues.receipt_total = formatAmount(
          copaymentTotal + (totalByTax['비급여(과세)'] ?? 0) + (totalByTax['비급여(면세)'] ?? 0),
        );
      }

      // ★ T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST 경로B / L-006 현장승인): persist-before-print.
      //   출력+수납 경로도 인쇄 전에 form_submissions INSERT + 교부번호 발행시점 채번·persist → 확정 교부번호로 인쇄본 렌더.
      // T-20260721-foot-BILLDOC-COPAY-PMW-REMAIN 단계 B: 출력+수납 경로도 신양식 처치/검사 비급여 category 토큰 주입
      //   (handleDocPrint 와 동일 — 두 발행 경로 대칭 보장).
      if (
        selected.some((t) => t.form_key === 'bill_receipt_new' || t.form_key === 'bill_receipt' || t.form_key === 'bill_detail') &&
        pricingItems.length > 0
      ) {
        applyBillReceiptNewCategoryTokens(autoValues, buildPmwBillDetailItems(autoValues.visit_date ?? ''));
      }
      // T-20260722-foot-BILLRECEIPT-NEWFORM-CATSPLIT-PAIDBOX: 출력+수납 경로도 동일 배선(handleDocPrint 대칭).
      await applyBillReceiptNewSplitAndPaid(autoValues, selected);
      const isFallbackTpl = templates[0]?.id.startsWith('fallback-');
      const rxIssueNo = await persistSubmissionsAndResolveIssueNo({
        selected,
        clinicId: checkIn.clinic_id,
        checkInId: checkIn.id,
        customerId: checkIn.customer_id ?? null,
        staffId,
        autoValues,
        codeItems,
        rxItemDosages,
        isFallback: isFallbackTpl,
      });

      // AC-5: bill_detail(진료비세부산정내역)은 landscape 전용 iframe으로 분리
      {
        const landscapeSel = selected.filter((t) => t.form_key === 'bill_detail');
        const portraitSel  = selected.filter((t) => t.form_key !== 'bill_detail');
        const buildPages2 = (tmplList: typeof selected) =>
          tmplList.flatMap((t) => {
            const enriched = buildCodeEnrichedValues(autoValues, codeItems, t.form_key, rxItemDosages, rxIssueNo);
            if (t.template_format === 'html' || isHtmlTemplate(t.form_key)) {
              // T-20260526-foot-RX-PRINT-DUAL: 처방전(rx_standard) 2장 출력 (약국보관용 + 환자보관용)
              if (t.form_key === 'rx_standard') {
                const p1 = buildHtmlPageDiv(t, enriched, '약국보관용');
                const p2 = buildHtmlPageDiv(t, enriched, '환자보관용');
                return [p1, p2].filter(Boolean);
              }
              const page = buildHtmlPageDiv(t, enriched);
              return page ? [page] : [];
            }
            const imgUrl = getTemplateImageUrl(t.form_key);
            if (!imgUrl) return [];
            return [buildPageHtml(t, enriched, imgUrl)];
          });
        if (landscapeSel.length > 0) {
          const lPages = buildPages2(landscapeSel);
          if (lPages.length > 0) printViaIframe(buildPrintHtml(lPages, `서류 출력 — ${checkIn.customer_name}`, true));
        }
        if (portraitSel.length > 0) {
          const pPages = buildPages2(portraitSel);
          if (pPages.length > 0) printViaIframe(buildPrintHtml(pPages, `서류 출력 — ${checkIn.customer_name}`));
        }
      }
      // T-20260718-foot-RX-PRINT-ISSUENO-TOTALDAYS-FIX (AC1-PERSIST 경로B): form_submissions 이력 기록은
      //   persistSubmissionsAndResolveIssueNo() 에서 **인쇄 전** 이미 완료(persist-before-print). 구 print-후 fire&forget 제거.

      // 2. 수납 + auto-done
      // T-20260519-foot-DEDUCT-PAY-METHOD AC-1: deductMode에서도 실제 결제수단 사용
      // T-20260616-foot-PMW-SPLIT-PAYMENT AC-2: 분할결제도 동일 합산 검증 경유
      const taxType = deductMode ? '선수금' : null;
      const splits = buildSettleSplits(amount);
      if (!splits) {
        setDocSettlePrinting(false);
        return;
      }
      await executeAutoDone(splits, taxType);
      localStorage.removeItem(draftKey(checkIn.id));
      toast.success('출력 및 수납 완료 — 완료 슬롯으로 이동됩니다');
      setDocSettlePrinting(false);
      onComplete();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '출력 및 수납 처리 실패';
      toast.error(msg);
      setDocSettlePrinting(false);
    }
  };

  // ── 표시용 수납 금액 ─────────────────────────────────────────────────────
  // T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT: 수납잔액 표시 = 본인부담금 + 비급여(공단부담금 제외).
  const displayAmount = deductMode ? deductAmount : payableTotal;

  // ── T-20260616-foot-PMW-SPLIT-PAYMENT: 분할 합산/차액 (AC-2) ───────────────
  const splitSum = splitRows.reduce((s, r) => s + (r.amount || 0), 0);
  const splitDiff = displayAmount - splitSum; // 양수=부족, 음수=초과, 0=일치
  const splitValid = splitMode ? splitDiff === 0 && splitSum > 0 : true;
  // 현금영수증/카드 안내 노출 판정 — 분할 시 해당 수단 행이 하나라도 있으면 노출
  const showCashReceipt = splitMode
    ? splitRows.some((r) => r.method === 'cash' || r.method === 'transfer')
    : payMethod === 'cash' || payMethod === 'transfer';
  const showCardInfo = splitMode
    ? splitRows.some((r) => r.method === 'card')
    : payMethod === 'card';

  const addSplitRow = () =>
    setSplitRows((rows) => [...rows, { method: 'card', amount: 0 }]);
  const removeSplitRow = (idx: number) =>
    setSplitRows((rows) => rows.filter((_, i) => i !== idx));
  const updateSplitRow = (
    idx: number,
    patch: Partial<{ method: PayMethod; amount: number }>,
  ) =>
    setSplitRows((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  // 분할결제 토글: 켜면 잔여 차액을 첫 행에 자동 채워 빠른 입력 보조
  const toggleSplitMode = () => {
    setSplitMode((on) => {
      const next = !on;
      if (next && splitRows.length === 0) {
        setSplitRows([{ method: payMethod, amount: displayAmount }]);
      }
      return next;
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog
      open={!!checkIn}
      onOpenChange={(open) => {
        // PAY-SLOT-MOVE AC-3: X 닫기 시 status 변경 없음 (수납대기 유지)
        if (!open) handleClose();
      }}
    >
      {/* BILLING-3ZONE: max-w-[1080px] — 3구역(좌메뉴+코드 / 중산정 / 우서류+패키지) */}
      <DialogContent className="sm:max-w-[1080px] max-w-full w-full max-h-[92vh] p-0 overflow-hidden flex flex-col">
        {/* 헤더 */}
        <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <CreditCard className="h-4 w-4 text-purple-600" />
            결제 미니창 — {checkIn.customer_name}
            {/* T-20260612-foot-CHARTNO-B2-P2: 환자명 단독 노출 0 — 차트번호 인접(미발번 명시) */}
            <span className="text-sm font-mono font-normal text-teal-600">{chartNoBadge(checkIn.customers?.chart_number ?? null)}</span>
            {checkIn.queue_number != null && (
              <span className="text-sm text-teal-600 font-normal">
                #{checkIn.queue_number}
              </span>
            )}
            {hasActivePackage && (
              <span className="text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">
                패키지
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* T-20260620-foot-PMW-OUTSTANDING-PREFILL / MISU-PMW-CHART2 AC-1(B안): 미수금 자동 표시 배너 (읽기 전용)
            미수금 있는 고객 결제 미니창 진입 시 담당자가 즉시 인지하도록 자동 표면화.
            ★ 표시 전용 — payments 쓰기 경로/일마감 집계 불변. PKG-OUTSTANDING-BALANCE SSOT(loadCustomerOutstanding) 산출값 그대로.
            §4-A: 패키지 잔금 / 진료비 미수 각각 따로 한 줄씩(단일 합산 금지). */}
        {hasOutstandingDue(customerOutstanding) && (
          <div
            className="px-5 py-2 border-b shrink-0 bg-red-50 flex flex-wrap items-center gap-x-4 gap-y-1"
            data-testid="pmw-outstanding-banner"
          >
            <span className="text-xs font-semibold text-red-700 flex items-center gap-1">
              미수금
            </span>
            {(customerOutstanding?.packageDue ?? 0) > 0 && (
              <span className="text-xs text-gray-700">
                패키지 잔금{' '}
                <span className="font-bold text-red-600 tabular-nums" data-testid="pmw-outstanding-package">
                  {formatAmount(customerOutstanding!.packageDue)}
                </span>
              </span>
            )}
            {(customerOutstanding?.consultationDue ?? 0) > 0 && (
              <span className="text-xs text-gray-700">
                {/* T-20260620-foot-MISU-PMW-CHART2 §4-A: 라벨 '진료비 미수'로 통일(확정 스펙·CHART2 미수이력 일치). 패키지 잔금과 별도 줄. */}
                진료비 미수 <span className="opacity-60">(별도)</span>{' '}
                <span className="font-bold text-amber-600 tabular-nums" data-testid="pmw-outstanding-consultation">
                  {formatAmount(customerOutstanding!.consultationDue)}
                </span>
              </span>
            )}
          </div>
        )}

        {/* 본문 3구역: Zone1(좌메뉴+코드) / Zone2(중산정) / Zone3(우서류+패키지)
            모바일(<sm): flex-col 세로 스택 + overflow-y-auto
            태블릿/PC(≥sm): 기존 3열 가로 레이아웃 */}
        {/* FEE-ITEM-SCROLL: 520→600px — 수가 항목 5건 노출 보장 */}
        {/* ═══════════════════════════════════════════════════════════════════════
             T-20260713-foot-PAYMINI-ZONE2-CHARTFEE-LEFTSPLIT (P0 HOTFIX · 3연속 미착지 후 착지 / 색박스 좌표 근거)
             현장 확정(스레드 ts=1783652657, 김주연 총괄): "초록 구역(시술 선택) 아래 / 파란 구역(수납 금액) 위 — 그 사이 컴팩트 한 줄".
             ◆ 근본원인(b276877b): [차트코드+진료비 산정]을 컴팩트 토글 한 줄로 만드는 데는 성공했으나, feeitem-row를
               body flex-col의 첫 자식(하단 band보다 위)에 그대로 둬서 DOM 순서상 여전히 최상단 → "맨 위 큰 블록" 그대로.
               블록의 내부 렌더(접힘/펼침)만 바꿨고 트리 위치는 안 옮긴 것이 3연속 미착지의 실체(번들/CSS-order 문제 아님).
             ◆ 수정: feeitem-row를 최상단에서 떼어, band 내부 중앙 세로 스택 [초록 시술그리드] → [컴팩트 한 줄] → [파란 수납]
               사이로 이동. tabnav(좌)·Zone3(우)는 사이드 열 그대로 유지 → 모달 총 가로폭 불변("가로 길어짐" 회귀 없음).
             - 접힘(기본): 한 줄 요약(서류코드 건수·수가 건수·합계)만 노출. 펼침: 서류코드·세트코드·수가항목 편집 UI 전량 보존. */}
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto sm:overflow-hidden sm:flex-none sm:h-[600px]">

          {/* ═══ 하단 가로 행: 카테고리 탭 / 코드 그리드 / 세금·합계·수납(기존 폭) / Zone3(기존 폭) ═══ */}
          <div className="flex flex-col sm:flex-row flex-1 min-h-0 sm:overflow-hidden">

          {/* ── 좌측: 카테고리 탭 (모바일: 가로 상단 탭바 / 데스크탑: 세로 사이드) ── */}
          <div className="shrink-0 border-b sm:border-b-0 sm:border-r bg-muted/30 flex flex-row sm:flex-col py-0 sm:py-2 sm:w-20 md:w-24 lg:w-28">
            {TAB_LABELS.map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                }}
                className={cn(
                  'flex-1 sm:flex-none sm:w-full px-2 sm:px-3 py-2 sm:py-3 text-sm font-medium text-center sm:text-left transition border-b-2 sm:border-b-0 sm:border-l-2 min-h-[44px]',
                  activeTab === tab
                    ? 'bg-teal-50 text-teal-700 border-teal-600'
                    : 'text-muted-foreground border-transparent hover:bg-muted',
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* ═══ 중앙 그룹 (T-20260720-foot-PAYMINI-CHARTCODE-SPLIT · 3열→4열 분리)
              구 LEFTSPLIT: [code-grid]→[feeitem-row 접이식]→[settle-lane] 세로 스택(단일 중앙 컬럼).
              신: 중앙 컬럼을 가로 3분할 → [① code-grid(팔레트, 무접촉·flex-1)] · [② 차트 코드(신규 컬럼)] · [③ 진료비 산정].
              tabnav(좌)·Zone3(④, 우)는 사이드 열 그대로 · 모달 총 가로폭(sm:max-w-[1080px]) 불변(AC-8).
              모바일(<sm): flex-col 세로 스택 유지. ═══ */}
          <div className="flex flex-col sm:flex-row min-w-0 min-h-0 flex-1 sm:overflow-hidden">

          {/* ── 코드 목록 / 그리드 (모바일: 고정 높이 52 / 데스크탑: flex-1)
              T-20260708-foot-PAYMINI-ZONE2-CHARTFEE-LEFTSPLIT: LEFTLANE(dc469694) fee-lane 폭확장 revert.
              고정폭(sm:w-52 md:w-64 lg:w-80 shrink-0) → sm:flex-1 원복.
              수가 항목은 상단 독립 행(row-split)으로 분리됨. ── */}
          <div className="flex flex-col min-w-0 min-h-0 h-52 sm:h-auto sm:flex-1" data-testid="pmw-code-grid">
            {/* 풋케어 탭: 서브 카테고리 버튼 (순서 편집 토글 제거됨 — PMW-ORDER-REMOVE)
                T-20260526-foot-PMW-SIDE-MENU-FEAT AC-1, AC-4 */}
            {activeTab === '풋케어' && (
              <div
                className="flex gap-1 px-2 py-1.5 border-b shrink-0 flex-wrap items-center"
                data-testid="pmw-footcare-cat-tabs"
              >
                {FOOTCARE_CATS.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setFootcareCat(cat);
                    }}
                    data-testid="pmw-footcare-cat-tab"
                    className={cn(
                      // ═══ T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC (FIX MSG-3cwy) ═══
                      // 🔴 좌측 카테고리 탭 = 세로 항목 리스트 위 슬림 네비 스트립.
                      // 4차 좀비 RC = 이전 AC1이 탭을 'aspect-square 정사각형 가로 wrap'으로 구현(총괄 반려 대상 artifact).
                      // → 슬림 텍스트 탭(px-2.5 py-1)으로 환원. 탭은 네비게이터(항목 아님) → 슬림 유지.
                      //   실 세로화 대상은 하단 항목 팔레트(pmw-palette-list, flex flex-col) = ④식 세로 섹션.
                      // AC3 회귀가드: 변경은 code-grid 열(pmw-code-grid) 내부에 국한 → ②③④ reflow 무영향(사이드 열 DOM 트리 불변).
                      'px-2.5 py-1 shrink-0 rounded border text-[11px] leading-tight transition-colors',
                      footcareCat === cat
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'border-input hover:bg-muted',
                    )}
                  >
                    <span className="whitespace-nowrap">
                      {cat}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* 풋케어: ①좌측 항목 팔레트 = ④우측 보라영역식 세로 섹션 리스트
                ═══ T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC (FIX MSG-3cwy · 4차 좀비 종식) ═══
                총괄 김주연 직접확정(ts 1784447309.406059, ch C0ATE5P6JTH): "웅 보라색 영역처럼 항목들 세로로 배치!"
                = pending_question(b) CONFIRMED. 대상=①좌측 항목 팔레트 / 목표비주얼=④ pmw-zone3(패키지·서류발행) 세로 섹션.
                구: 가로 다열 그리드(grid grid-cols-3 lg:grid-cols-4 · aspect-square 정사각형 카드) = 항목이 좌→우 가로 배치
                → 신: 세로 스택(flex flex-col gap-1.5) · 항목=full-width 행(이름 좌 / 코드·수가 우, flex items-center justify-between)
                   = ④ pmw-zone3 패키지 행(rounded border · flex justify-between · space-y)과 동일 DOM 구조 복제.
                ★anti-zombie: DOM 앵커 = zone3(④) 실 구조 복제 → 항목 flex-direction:column(위→아래 stack). 좌표/정사각형 blind 금지. */}
            {activeTab === '풋케어' && (
              <div className="flex-1 overflow-y-auto p-2">
                {tabServices.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    등록된 코드가 없습니다
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5" data-testid="pmw-palette-list">
                    {tabServices.map((svc) => (
                      <button
                        key={svc.id}
                        onClick={() => handleSelectService(svc)}
                        data-testid="pmw-palette-item"
                        className="w-full flex items-center justify-between gap-2 rounded border px-2.5 py-2 min-h-[44px] hover:bg-teal-50 hover:border-teal-300 transition-colors text-left"
                      >
                        <span className="text-[11px] font-medium leading-tight line-clamp-2 min-w-0 flex-1">
                          {svc.name}
                        </span>
                        <span className="flex flex-col items-end shrink-0">
                          {svc.service_code && (
                            <span className="text-[9px] text-blue-500 tabular-nums truncate max-w-[88px]">
                              {svc.service_code}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {formatAmount(svc.price)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 상병코드 / 처방약 탭: 소형 그리드 (AC-1: 풋케어 스타일 소형화 — 한 눈에 전체 카테고리) */}
            {(activeTab === '상병코드' || activeTab === '처방약') && (
              <div className="flex-1 overflow-y-auto p-2">
                {tabServices.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    등록된 코드가 없습니다
                  </p>
                ) : (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
                    {tabServices.map((svc) => (
                      <button
                        key={svc.id}
                        onClick={() => handleSelectService(svc)}
                        className="flex flex-col items-center justify-center rounded border p-1.5 hover:bg-blue-50 hover:border-blue-300 transition-colors text-center min-h-[56px] sm:min-h-[48px]"
                      >
                        <span className="text-[10px] font-medium leading-tight line-clamp-2 w-full text-center">
                          {svc.name}
                        </span>
                        {svc.service_code && (
                          <span className="text-[9px] text-blue-500 mt-0.5 truncate w-full text-center">
                            {svc.service_code}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* ═══ ② 차트 코드 (신규 독립 컬럼) — T-20260720-foot-PAYMINI-CHARTCODE-SPLIT
              상병코드 · 처방약 · 치료내용(구 "수가 항목") 세 그룹을 제목으로 구분해 위→아래 배치(AC-2).
              항목 과다 시 칸 내부 스크롤(AC-10). 세트코드 드롭다운은 스크롤 영역 하단.
              ★ 접이식 토글(feeItemExpanded) 제거 — 독립 컬럼 상시 노출. 금액/계산 무접촉(AC-9). ═══ */}
          <div
            className="flex flex-col min-w-0 min-h-0 border-b sm:border-b-0 sm:border-l bg-white h-64 sm:h-auto sm:w-52 md:w-56 lg:w-60 sm:shrink-0"
            data-testid="pmw-chartcode-col"
          >
            <p className="shrink-0 px-3 py-2 text-xs font-semibold text-muted-foreground border-b">
              차트 코드
            </p>

            {/* 스크롤 영역: 상병코드 · 처방약 · 치료내용 · 세트코드 (AC-2·AC-10 칸 내부 스크롤) */}
            <div className="flex-1 min-h-0 overflow-y-auto" data-testid="pmw-chartcode-scroll">

            {/* ② 상병코드 그룹 — codeItems 중 category_label='상병' (AC-2) */}
            {codeItems.some((i) => (i.service.category_label ?? '') === '상병') && (
              <div className="border-b">
                <p className="text-[10px] font-semibold text-blue-700 px-2 pt-1.5 pb-0.5">상병코드</p>
                <div className="p-2 space-y-1">
                  {codeItems
                    .filter((i) => (i.service.category_label ?? '') === '상병')
                    .map(({ service, qty }) => (
                      <div
                        key={service.id}
                        className="flex items-center gap-1.5 rounded border px-2 py-1 bg-blue-50 border-blue-200"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium leading-tight truncate">{service.name}</p>
                          {service.service_code && (
                            <p className="text-[10px] text-blue-600 mt-0.5">
                              {service.service_code}
                              {qty > 1 && <span className="text-blue-500"> ×{qty}</span>}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemoveItem(service.id)}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5"
                          title="제거"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* ② 처방약 그룹 — codeItems 중 category_label='처방약' (AC-2) */}
            {codeItems.some((i) => (i.service.category_label ?? '') === '처방약') && (
              <div className="border-b">
                <p className="text-[10px] font-semibold text-blue-700 px-2 pt-1.5 pb-0.5">처방약</p>
                <div className="p-2 space-y-1">
                  {codeItems
                    .filter((i) => (i.service.category_label ?? '') === '처방약')
                    .map(({ service, qty }) => (
                      <div
                        key={service.id}
                        className="flex items-center gap-1.5 rounded border px-2 py-1 bg-blue-50 border-blue-200"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium leading-tight truncate">{service.name}</p>
                          {service.service_code && (
                            <p className="text-[10px] text-blue-600 mt-0.5">
                              {service.service_code}
                              {qty > 1 && <span className="text-blue-500"> ×{qty}</span>}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemoveItem(service.id)}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5"
                          title="제거"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            )}

              {/* ② 치료내용 그룹 (구 "수가 항목") — pricingItems, DnD 순서편집 유지.
                  T-20260720 AC-5: 라벨 "수가 항목" → "치료내용"(현장 용어). 계산·CRUD 무접촉(AC-9).
                  구 max-h/flex-1 노출제어 → ② 칸 자체 스크롤(pmw-chartcode-scroll)이 흡수하므로 제거. */}
              <DndContext
                sensors={feeItemSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEndPricingItem}
              >
                <SortableContext
                  items={pricingItems.map((i) => i.service.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div data-testid="pricing-list" className="p-2 min-h-0 space-y-1 scroll-smooth">
                    <p className="text-xs font-semibold text-muted-foreground mb-1.5 px-1">
                      치료내용 ({pricingItems.length}건)
                    </p>
                    {pricingItems.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        코드를 선택하면 항목이 추가됩니다
                      </p>
                    )}
                    {pricingItems.map(({ service, qty }) => (
                      <SortablePricingRow
                        key={service.id}
                        service={service}
                        qty={qty}
                        isPrepaid={prepaidIds.has(service.id)}
                        displayPrice={customAmounts.get(service.id) ?? service.price}
                        isEditing={editingPriceId === service.id}
                        editingPriceValue={editingPriceValue}
                        insuranceGrade={customerInsuranceGrade}
                        onTogglePrepaid={togglePrepaid}
                        onStartEditPrice={startEditPrice}
                        onCommitEditPrice={commitEditPrice}
                        // T-20260525-foot-AMOUNT-COMMA-FMT AC-1,AC-3: 타이핑/붙여넣기 시 쉼표 자동 포맷
                        onEditValueChange={(v) => setEditingPriceValue(formatAmountDisplay(parseAmountRaw(v)))}
                        onEscapeEdit={() => setEditingPriceId(null)}
                        onRemove={handleRemoveItem}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

            </div>
            {/* ═══ 세트코드 드롭다운 — ② 차트 코드 칸 하단 footer(shrink-0). handoff §2 "세트코드 → 칸 하단".
                스크롤 영역 밖 고정 → 항상 접근 가능. 드롭다운은 위로(bottom-full) 열려 클리핑 회피. ═══ */}
            {feeSetTemplates.length > 0 && (
              <div className="shrink-0 px-2 pt-2 pb-2 border-t relative" data-testid="fee-set-dropdown-container">
                <button
                  type="button"
                  onClick={() => setFeeSetOpen((v) => !v)}
                  className={cn(
                    'w-full flex items-center justify-between gap-1.5 px-2 py-1.5 rounded border text-xs transition-colors',
                    feeSetOpen
                      ? 'bg-teal-50 border-teal-400 text-teal-700'
                      : 'border-input hover:bg-muted text-muted-foreground',
                  )}
                  data-testid="fee-set-dropdown-btn"
                >
                  <span className="flex items-center gap-1">
                    <Layers className="h-3 w-3 shrink-0" />
                    세트코드
                  </span>
                  <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', feeSetOpen && 'rotate-180')} />
                </button>

                {feeSetOpen && (
                  <div
                    className="absolute bottom-full left-0 right-0 z-50 mx-2 mb-0.5 border rounded-md bg-white shadow-lg max-h-48 overflow-y-auto"
                    data-testid="fee-set-dropdown-list"
                  >
                    {feeSetTemplates.map((tpl) => {
                      // 세트에 포함된 서비스 목록 미리보기
                      const previewSvcs = tpl.items
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .map((i) => services.find((s) => s.id === i.service_id))
                        .filter((s): s is Service => !!s);
                      const setTotal = previewSvcs.reduce((sum, s) => sum + s.price, 0);

                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          className="w-full flex flex-col gap-0.5 px-3 py-2 text-xs text-left hover:bg-teal-50 border-b border-gray-50 last:border-0 transition-colors"
                          data-testid={`fee-set-item-${tpl.id}`}
                          onClick={() => {
                            // AC-1: 기존 항목 유지 + 세트 항목 append (중복 시 qty+1)
                            setSelectedItems((prev) => {
                              const next = [...prev];
                              previewSvcs.forEach((svc) => {
                                const existing = next.find((i) => i.service.id === svc.id);
                                if (existing) {
                                  existing.qty += 1;
                                } else {
                                  next.push({ service: svc, qty: 1 });
                                }
                              });
                              return next;
                            });
                            setSaved(false);
                            setFeeSetOpen(false);
                            toast.success(`'${tpl.set_name}' 세트 적용됨 (${previewSvcs.length}개)`);
                          }}
                        >
                          <span className="font-semibold text-gray-800">{tpl.set_name}</span>
                          <span className="text-muted-foreground truncate">
                            {previewSvcs.map((s) => s.name).join(' · ')}
                          </span>
                          <span className="text-teal-700 tabular-nums font-medium">
                            합계 {formatAmount(setTotal)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

            {/* ═══ ③ 진료비 산정 (독립 컬럼) — T-20260720-foot-PAYMINI-CHARTCODE-SPLIT
                구 settle-lane(세금구분·수납·액션버튼)을 ② 차트 코드 우측 독립 컬럼으로 승격(3열→4열).
                항목 목록 없음 — 금액만(AC-3). 진료비 총액(구 '합계')·수납잔액·차감후청구 하단 표시(AC-4/6).
                내부 2분할 유지: [세금구분 fixed band shrink-0 = 항상 노출] / [액션버튼 flex-1 스크롤].
                계산 SSOT(COPAY-BALANCE-SPLIT canonical) 무접촉 — 표시·배치만(AC-9).
                구 PMW-LAYOUT-SCROLL durable fix(밴드 고정/버튼 스크롤 소유)는 컬럼화 후에도 계승. */}
            <div
              className="flex flex-col min-w-0 min-h-0 border-t sm:border-t-0 sm:border-l sm:w-56 md:w-60 lg:w-64 sm:shrink-0 h-auto"
              data-testid="pmw-settle-lane"
            >
                <p className="shrink-0 px-3 py-2 text-xs font-semibold text-muted-foreground border-b">
                  진료비 산정
                </p>
                {/* 세금 구분 + 합산 (치료내용 있을 때만) */}
                {pricingItems.length > 0 && (
                  /* T-20260719-foot-PMW-LAYOUT-SCROLL AC-2: ③ 세금구분·수납잔액·차감후청구 = shrink-0 고정 밴드(스크롤 밖).
                     상위 settle-lane 스크롤은 아래 액션버튼 div가 소유 → 이 밴드는 항상 노출. */
                  <div className="border-t px-3 py-2 bg-muted/20 shrink-0 space-y-1" data-testid="pmw-tax-fixed-band">
                    <p className="text-xs font-semibold text-muted-foreground">세금 구분</p>
                    {/* T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT REOPEN#5 (김주연 총괄, 스크린샷 요구):
                        세금구분 '급여' 라인 = 환자 자부담(30%)만 표시. 공단부담(70%)은 이 라인/수납잔액에서 제외하고
                        아래 '공단부담액(명세)' 라인으로 분리. 값·라벨 모두 배포 SSOT(payCopaymentTotal/copayRate,
                        computeFootBilling general_default 30%) 소비 — 인라인 병렬 재계산 금지(DA §제약1).
                        - 급여: amt(=coveredTotal 본인+공단) → payCopaymentTotal(본인 자부담만). 라벨 "급여"→"급여 자부담(30%)".
                        - 비급여(과세)/면세: totalByTax 그대로. */}
                    {(Object.entries(totalByTax) as [TaxClass, number][]).map(([cls, amt]) => {
                      const isCovered = cls === '급여';
                      // T-20260720-foot-COPAY-GRADE-BRANCH-MISSING §3-6: 정액/면제/노인 정률제 등급은
                      //   기준명(면제/정액/정률제/전액), 그 외(general/infant/등급미상)만 "N%". v1.6 에서
                      //   copayRate(=getBaseCopayRate)를 직접 % 로 찍으면 정액/면제 '0%'·elderly '30%' 오표기.
                      const label = isCovered
                        ? `급여 자부담${copayRate !== null ? `(${copayBasisText(customerInsuranceGrade ?? 'unverified') ?? `${Math.round(copayRate * 100)}%`})` : ''}`
                        : cls;
                      const displayAmt = isCovered ? payCopaymentTotal : amt;
                      return (
                        <div key={cls} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="tabular-nums font-medium">{formatAmount(displayAmt)}</span>
                        </div>
                      );
                    })}
                    {/* T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT (Part2): 공단부담액(명세) 정보성 라인.
                        급여 진료비 − 본인부담금 = 공단(NHIS) 몫. 수납잔액에는 미포함(환자가 내지 않음).
                        라벨 "공단부담액(명세)" — 명세(service_charges) 기준 추정액이지 EDI 확정액 아님
                        (❌"공단청구액(EDI)" 금지). 값>0(급여 방문·유효등급)일 때만 표시. muted 스타일로
                        수납 대상과 시각적으로 구분. SalesDoctor 집계와 동일 grain/라벨(cross-ref 정합). */}
                    {insuranceCoveredTotal > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>공단부담액(명세)</span>
                        <span className="tabular-nums">{formatAmount(insuranceCoveredTotal)}</span>
                      </div>
                    )}
                    {/* T-20260720-foot-PAYMINI-CHARTCODE-SPLIT: '진료비 총액' 라인(AC-6).
                        구 feeitem-row 요약 배지의 '합계 {grandTotal}'을 ② 칸 분리로 소멸 → ③ 진료비 산정 칸에
                        명시 라인으로 이설. 값=grandTotal 그대로(무재산정·AC-9). 라벨은 법정 서식(진료비 계산서·
                        영수증 별지 제1호 ⑥ '진료비 총액', htmlFormTemplates.ts:2190-2192)과 일치(handoff §5). */}
                    <div className="flex justify-between text-sm font-semibold pt-1 border-t">
                      <span>진료비 총액</span>
                      <span className="tabular-nums">{formatAmount(grandTotal)}</span>
                    </div>
                    {/* T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT: 하단 볼드 합계 = 수납잔액(본인부담금+비급여).
                        공단부담금은 이 합계에서 제외(수납 대상 아님). 총 진료비는 세금구분(급여+비급여)으로 확인. */}
                    <div className="flex justify-between text-sm font-bold pt-1 border-t">
                      <span>수납잔액</span>
                      <span className="tabular-nums text-purple-700">
                        {formatAmount(payableTotal)}
                      </span>
                    </div>
                    {prepaidIds.size > 0 && (
                      <div className="flex justify-between text-xs text-purple-600 pt-0.5">
                        <span>차감 후 청구</span>
                        <span className="tabular-nums font-semibold">
                          {formatAmount(calcDeductAmount())}
                        </span>
                      </div>
                    )}
                    {/* T-20260714-foot-INSGRADE-VERIFY-RESETTLE: 등급 확정 재정산 미리보기(급여방문·확정등급).
                        grade=null 잠정 30% 수납 → 확정 본인부담 차액(환불/추가징수). 실 처리는 money_gate 후.
                        서버 RPC(calc_copayment authority)가 산출·판단 — 여기선 표시만. 대상 아니면 자체 생략. */}
                    {checkIn?.id && (
                      <InsuranceResettlePanel
                        checkInId={checkIn.id}
                        grade={customerInsuranceGrade}
                        moneyGateOpen={false}
                      />
                    )}
                  </div>
                )}

                {/* 액션 버튼
                    T-20260719-foot-PMW-LAYOUT-SCROLL: 스크롤 소유권을 이 버튼 영역으로 이관(flex-1 min-h-0 sm:overflow-y-auto).
                    위 ③ 세금구분 band(shrink-0)는 스크롤 밖 고정 → 항상 노출(AC-2). ② 접힘 기본이면 버튼도 자연높이로
                    흘러 무스크롤(AC-3); 극단 케이스만 이 영역 내부 스크롤. */}
                <div className="min-h-0 flex-1 sm:overflow-y-auto px-3 pt-2 pb-3 space-y-2 border-t">
                  {/* [시술 저장 및 포함 금액 산정] */}
                  <Button
                    variant="outline"
                    className="w-full text-xs h-11 sm:h-9"
                    onClick={handleSaveFull}
                    disabled={pricingItems.length === 0}
                  >
                    {saved && !deductMode ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1.5 text-teal-600" />
                        저장됨 (포함)
                      </>
                    ) : (
                      <>
                        <ChevronRight className="h-3.5 w-3.5 mr-1.5" />
                        시술 저장 및 포함 금액 산정
                      </>
                    )}
                  </Button>

                  {/* [선수금 차감 후 금액 산정] — PREPAID-DEDUCT */}
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full text-xs h-11 sm:h-9',
                      hasActivePackage
                        ? 'border-purple-300 text-purple-700 hover:bg-purple-50'
                        : 'opacity-50',
                    )}
                    onClick={handleSaveDeduct}
                    disabled={pricingItems.length === 0 || !hasActivePackage}
                  >
                    {saved && deductMode ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1.5 text-purple-600" />
                        저장됨 (차감 후 {formatAmount(deductAmount)})
                      </>
                    ) : (
                      <>
                        <ChevronRight className="h-3.5 w-3.5 mr-1.5" />
                        선수금 차감 후 금액 산정
                        {!hasActivePackage && (
                          <span className="ml-1 text-[10px] text-muted-foreground">(패키지 없음)</span>
                        )}
                      </>
                    )}
                  </Button>

                  {/* 미저장 힌트 */}
                  {!saved && pricingItems.length > 0 && (
                    <p className="text-xs text-amber-600 flex items-center gap-1" data-testid="settle-hint">
                      <ChevronRight className="h-3 w-3 shrink-0" />
                      금액 산정 완료 후 수납 버튼이 나타납니다
                    </p>
                  )}

                  {/* 결제 수단 선택 (저장 후 항상 표시)
                      T-20260519-foot-DEDUCT-PAY-METHOD AC-2:
                      deductMode 여부·잔액 무관 — 저장 후 항상 결제수단 선택 노출
                      선수금차감(잔액=0)이어도 실제 수단을 기록해 일마감 분류 정확성 보장 */}
                  {saved && (
                    <div className="space-y-1.5">
                      {/* T-20260616-foot-PMW-SPLIT-PAYMENT AC-1: 분할결제 토글 */}
                      <button
                        onClick={toggleSplitMode}
                        className={cn(
                          'flex items-center gap-1.5 w-full h-9 sm:h-7 rounded px-2 text-xs font-medium border transition-colors',
                          splitMode
                            ? 'bg-purple-50 border-purple-300 text-purple-700'
                            : 'border-input text-muted-foreground hover:bg-muted',
                        )}
                        data-testid="btn-split-toggle"
                      >
                        {splitMode ? (
                          <CheckSquare className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <Square className="h-3.5 w-3.5 shrink-0" />
                        )}
                        분할결제 (복수 결제수단)
                      </button>

                      {!splitMode ? (
                        /* 단일 결제수단 (회귀 동선 — AC-4) */
                        <div className="flex gap-1">
                          {METHOD_OPTIONS.map((m) => (
                            <button
                              key={m.value}
                              onClick={() => setPayMethod(m.value)}
                              className={cn(
                                'flex-1 h-11 sm:h-8 rounded text-xs font-medium border transition-colors',
                                payMethod === m.value
                                  ? 'bg-purple-600 text-white border-purple-600'
                                  : 'border-input hover:bg-muted',
                              )}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        /* 분할 결제수단 행 (method + 금액 + 삭제) — AC-1 */
                        <div className="space-y-1.5" data-testid="split-rows">
                          {splitRows.map((row, idx) => (
                            <div key={idx} className="flex items-center gap-1" data-testid={`split-row-${idx}`}>
                              <select
                                value={row.method}
                                onChange={(e) =>
                                  updateSplitRow(idx, { method: e.target.value as PayMethod })
                                }
                                className="h-11 sm:h-8 rounded border border-input bg-background text-xs px-1.5 w-16 shrink-0"
                                data-testid={`split-method-${idx}`}
                              >
                                {METHOD_OPTIONS.map((m) => (
                                  <option key={m.value} value={m.value}>
                                    {m.label}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={formatAmountDisplay(row.amount)}
                                onChange={(e) =>
                                  updateSplitRow(idx, {
                                    amount: Number(parseAmountRaw(e.target.value)) || 0,
                                  })
                                }
                                placeholder="0"
                                className="h-11 sm:h-8 flex-1 min-w-0 rounded border border-input bg-background text-xs px-2 text-right tabular-nums"
                                data-testid={`split-amount-${idx}`}
                              />
                              <button
                                onClick={() => removeSplitRow(idx)}
                                disabled={splitRows.length <= 1}
                                className="h-11 sm:h-8 w-8 shrink-0 rounded border border-input text-muted-foreground hover:bg-muted disabled:opacity-30 flex items-center justify-center"
                                data-testid={`split-remove-${idx}`}
                                aria-label="결제수단 삭제"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={addSplitRow}
                            className="flex items-center justify-center gap-1 w-full h-9 sm:h-7 rounded border border-dashed border-purple-300 text-purple-600 text-xs hover:bg-purple-50"
                            data-testid="btn-split-add"
                          >
                            <Plus className="h-3.5 w-3.5" /> 결제수단 추가
                          </button>
                          {/* AC-2: 합산/차액 표시 */}
                          <div
                            className={cn(
                              'flex items-center justify-between rounded px-2 py-1.5 text-xs',
                              splitDiff === 0
                                ? 'bg-teal-50 text-teal-700'
                                : 'bg-amber-50 text-amber-700',
                            )}
                            data-testid="split-summary"
                          >
                            <span>
                              합계 {formatAmount(splitSum)} / 수납 {formatAmount(displayAmount)}
                            </span>
                            <span className="font-semibold" data-testid="split-diff">
                              {splitDiff === 0
                                ? '일치'
                                : splitDiff > 0
                                  ? `${formatAmount(splitDiff)} 부족`
                                  : `${formatAmount(-splitDiff)} 초과`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* PAY-CASH-RECEIPT: 현금영수증 체크박스 — 현금/이체 선택 시 표시
                      T-20260519-foot-DEDUCT-PAY-METHOD: deductMode 무관 항상 표시
                      T-20260616-foot-PMW-SPLIT-PAYMENT: 분할 시 현금/이체 행 있으면 표시 */}
                  {saved && showCashReceipt && (
                    <div className="rounded border px-2.5 py-2 bg-muted/20 space-y-1.5">
                      <button
                        onClick={() => setCashReceiptIssued((v) => !v)}
                        className="flex items-center gap-1.5 w-full text-xs"
                      >
                        {cashReceiptIssued ? (
                          <CheckSquare className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                        ) : (
                          <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className={cashReceiptIssued ? 'text-teal-700 font-medium' : 'text-muted-foreground'}>
                          현금영수증 발급
                        </span>
                      </button>
                      {cashReceiptIssued && (
                        <div className="flex gap-1 ml-5">
                          {(
                            [
                              { value: 'income_deduction', label: '소득공제' },
                              { value: 'expense_proof', label: '지출증빙' },
                            ] as const
                          ).map((t) => (
                            <button
                              key={t.value}
                              onClick={() => setCashReceiptType(t.value)}
                              className={cn(
                                'flex-1 h-6 rounded text-[10px] border transition-colors',
                                cashReceiptType === t.value
                                  ? 'bg-teal-600 text-white border-teal-600'
                                  : 'border-input hover:bg-muted',
                              )}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* T-20260526-foot-PAY-INPUT-001-SIMPLIFY: 카드 자동 매칭 안내 (입력 칸 제거)
                      대표 지시 2026-05-26 — 매처가 시간·금액 기반으로 자동 매칭
                      T-20260616-foot-PMW-SPLIT-PAYMENT AC-6: 분할 시 카드 행이 있으면 안내 유지 */}
                  {saved && showCardInfo && (
                    <p className="text-[10px] text-muted-foreground px-1" data-testid="card-auto-match-info">
                      결제 정보는 단말기 데이터와 시간·금액 기반으로 자동 매칭됩니다.
                    </p>
                  )}

                  {/* T-20260708-foot-PAYMINI-INSURANCE-CHARTREQ-UNBLOCK: 급여 방문 비차단 soft 리마인더.
                      ★ 차단 아님 — 수납 버튼은 항상 활성. 급여 청구 정합상 진료기록 후속 작성이 필요함을 안내만. */}
                  {saved && medRecordReminder && (
                    <div
                      className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 leading-relaxed"
                      data-testid="medrecord-reminder"
                    >
                      ℹ️ 건강보험(급여) 청구를 위해 <strong>진료기록(서명 포함)</strong> 작성이 필요합니다.
                      아직 작성 전이라면 진료 후 작성해주세요. (수납은 지금 진행할 수 있습니다.)
                    </div>
                  )}

                  {/* 수납 버튼 (저장 후 표시) */}
                  {saved && (
                    <Button
                      className="w-full h-11 sm:h-10 text-white text-sm font-semibold bg-purple-600 hover:bg-purple-700"
                      onClick={handleSettle}
                      disabled={submitting || !splitValid}
                      data-testid="btn-settle"
                    >
                      {submitting ? '처리 중...' : (
                        // T-20260519-foot-PKG-REVENUE-SPLIT AC-1: 상황별 버튼 레이블
                        // 전액 패키지차감(잔액=0) / 잔액 있는 차감 / 일반 결제
                        deductMode && deductAmount === 0
                          ? '수납 (패키지차감완료, 잔액없음)'
                          : deductMode && deductAmount > 0
                            ? `수납 잔액 ${formatAmount(displayAmount)}`
                            : `수납 ${formatAmount(displayAmount)}`
                      )}
                    </Button>
                  )}
                </div>
            </div>
          </div>


          {/* ─────────────────────────────────────────────────────────────────────
               BILLING-3ZONE Zone 3: 구매패키지 + 금일 시술내역 + 서류발행
               AC-3: 서류발행 우측 이동 / AC-4: 패키지 읽기 / AC-5: 시술이력 읽기
          ─────────────────────────────────────────────────────────────────── */}
          <div
            className="sm:w-52 md:w-56 lg:w-64 shrink-0 border-t sm:border-t-0 sm:border-l flex flex-col sm:min-h-0 bg-slate-50/50"
            data-testid="pmw-zone3"
          >

            {/* Zone 3 — AC-4: 구매패키지 (읽기 전용) */}
            <div className="border-b shrink-0">
              <p className="text-[10px] font-semibold text-purple-700 px-2 pt-2 pb-1 flex items-center gap-1">
                <span>패키지</span>
                {activePackages.length > 0 && (
                  <span className="ml-auto text-[9px] text-purple-500 font-normal">교차확인용</span>
                )}
              </p>
              {activePackages.length === 0 ? (
                <p className="text-[10px] text-muted-foreground px-2 pb-2">활성 패키지 없음</p>
              ) : (
                /* T-20260519-foot-BILLING-ITEM-PRICE: max-h 확장 (항목 행 추가) */
                <div className="px-2 pb-2 space-y-1.5 max-h-40 overflow-y-auto">
                  {activePackages.map((pkg) => {
                    // AC-1+AC-2: 세션 수 > 0 인 항목만 표시
                    const items: { label: string; unitPrice: number; sessions: number }[] = [];
                    if (pkg.heated_sessions > 0) items.push({ label: '가열성', unitPrice: pkg.heated_unit_price, sessions: pkg.heated_sessions });
                    if (pkg.unheated_sessions > 0) items.push({ label: '비가열성', unitPrice: pkg.unheated_unit_price, sessions: pkg.unheated_sessions });
                    if (pkg.iv_sessions > 0) items.push({ label: '수액', unitPrice: pkg.iv_unit_price, sessions: pkg.iv_sessions });
                    if (pkg.podologe_sessions > 0) items.push({ label: '포돌로게', unitPrice: pkg.podologe_unit_price, sessions: pkg.podologe_sessions });
                    return (
                      <div
                        key={pkg.id}
                        className="rounded border border-purple-200 bg-purple-50 px-2 py-1.5"
                      >
                        {/* AC-1: 패키지명 */}
                        <p className="text-[11px] font-medium text-purple-800 leading-tight truncate mb-1">
                          {pkg.package_name}
                        </p>
                        {/* AC-1+AC-2: 항목명 + 적용 수가 행별 표시 */}
                        {items.length > 0 && (
                          <div className="space-y-0.5 mb-1">
                            {items.map((item) => (
                              <div key={item.label} className="flex items-center justify-between gap-1">
                                <span className="text-[9px] text-purple-600 shrink-0">{item.label}</span>
                                <span className="text-[9px] text-purple-500 tabular-nums">
                                  {item.sessions}회 × {formatAmount(item.unitPrice)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* AC-3: 총합계 유지 + 잔여 */}
                        <div className="flex items-center justify-between border-t border-purple-200 pt-0.5">
                          <span className="text-[9px] text-purple-500">잔여 {pkg.remaining_sessions}회</span>
                          <span className="text-[10px] text-purple-700 font-semibold tabular-nums">
                            {formatAmount(pkg.paid_amount)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Zone 3 — AC-5: 금일 시술내역 (읽기 전용) */}
            <div className="border-b shrink-0">
              <p className="text-[10px] font-semibold text-teal-700 px-2 pt-1.5 pb-1 flex items-center gap-1">
                <span>금일 시술내역</span>
                {todayTreatments.length > 0 && (
                  <span className="ml-auto text-[9px] text-teal-500 font-normal">
                    {todayTreatments.length}건
                  </span>
                )}
              </p>
              {todayTreatments.length === 0 ? (
                <p className="text-[10px] text-muted-foreground px-2 pb-2">금일 시술 없음</p>
              ) : (
                <div className="px-2 pb-2 space-y-0.5 max-h-28 overflow-y-auto">
                  {todayTreatments.map((t, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-1 rounded border border-teal-100 bg-teal-50/60 px-1.5 py-0.5"
                    >
                      <span className="text-[10px] text-teal-800 truncate flex-1">
                        {t.service_name}
                      </span>
                      <span className="text-[10px] text-teal-600 tabular-nums shrink-0">
                        {formatAmount(t.price)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Zone 3 — AC-3: 서류발행 */}
            <div className="overflow-y-auto px-2 pt-1.5 pb-1 min-h-0 max-h-40 sm:max-h-none sm:flex-1">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold text-slate-600 flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  <span>서류발행</span>
                  {selectedDocKeys.size > 0 && (
                    <span className="text-muted-foreground font-normal">({selectedDocKeys.size}종)</span>
                  )}
                </p>
                {/* T-20260719-foot-DOCHIST-MULTIPATH-EXTEND item②: 해당 방문 발행이력 조회+재출력.
                    1번차트와 동일 DocumentPrintPanel(historyAtTop) 모달 재사용 — checkIn 방문 스코프. */}
                {checkIn && (
                  <button
                    type="button"
                    onClick={() => setDocHistoryOpen(true)}
                    className="inline-flex items-center gap-1 rounded border border-teal-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-50 transition shrink-0"
                    data-testid="btn-pmw-doc-history"
                    title="이 방문에 발행된 서류 이력 조회 및 재출력"
                  >
                    <Clock className="h-3 w-3" /> 발행이력·재출력
                  </button>
                )}
              </div>
              {/* T-20260522-foot-INS-DOC-PRINT: foot-service + insurance 카테고리 분리 렌더링 */}
              <div className="flex flex-col gap-1" data-testid="doc-template-list">
                {/* T-20260620-foot-DOCLIST-ORDER-10: 확정 10종만 + 확정 순서 (SSOT) */}
                {orderDocList(templates.filter((t) => t.category !== 'insurance'))
                  .map((tpl) => {
                    const meta = FORM_META[tpl.form_key];
                    const isSelected = selectedDocKeys.has(tpl.form_key);
                    // T-20260620-foot-MEDDOC-DESK-PRINTONLY (B안): 소견서·진단서 게이트.
                    //   gate ≠ null = 일괄선택/자유작성 비대상. 미작성=disabled, 작성완료=클릭 시 발행본 출력.
                    const gate = medDocGate(tpl.form_key);
                    if (gate) {
                      const locked = !gate.authored;
                      return (
                        <button
                          key={tpl.form_key}
                          onClick={() => { if (gate.authored) gate.onPrint(); }}
                          disabled={locked}
                          title={locked ? '원장이 작성한 내용이 있어야 출력할 수 있습니다.' : '원장 발행본 출력'}
                          className={cn(
                            'flex items-center gap-1.5 rounded border px-2 py-2.5 sm:py-1 text-xs font-medium transition-all text-left w-full min-h-[44px] sm:min-h-0',
                            locked
                              ? 'bg-gray-50 text-muted-foreground/60 border-gray-200 cursor-not-allowed'
                              : 'bg-white text-teal-700 border-teal-300 hover:bg-teal-50',
                          )}
                          data-testid={`doc-meddoc-${tpl.form_key}`}
                          data-authored={gate.authored ? 'true' : 'false'}
                        >
                          <span className="shrink-0">{locked ? '🔒' : '🖨️'}</span>
                          <span className="truncate">
                            {meta?.icon ?? '📄'} {tpl.name_ko}
                            <span className="ml-1 text-[10px] opacity-80">
                              {locked ? '(원장 작성 필요)' : '(출력)'}
                            </span>
                          </span>
                        </button>
                      );
                    }
                    return (
                      <button
                        key={tpl.form_key}
                        onClick={() => toggleDocKey(tpl.form_key)}
                        className={cn(
                          'flex items-center gap-1.5 rounded border px-2 py-2.5 sm:py-1 text-xs font-medium transition-all text-left w-full min-h-[44px] sm:min-h-0',
                          isSelected
                            ? 'bg-teal-600 text-white border-teal-600'
                            : 'bg-white text-muted-foreground border-gray-200 hover:border-teal-300 hover:text-teal-700',
                        )}
                        data-testid={`doc-checkbox-${tpl.form_key}`}
                      >
                        {isSelected ? (
                          <CheckSquare className="h-3 w-3 shrink-0" />
                        ) : (
                          <Square className="h-3 w-3 shrink-0" />
                        )}
                        <span className="truncate">{meta?.icon ?? '📄'} {tpl.name_ko}</span>
                      </button>
                    );
                  })}

                {/* 보험서류 구분선 — T-20260620-foot-DOCLIST-ORDER-10: 10종에 보험서류 없음 → orderDocList 필터로 섹션 비표시 */}
                {orderDocList(templates.filter((t) => t.category === 'insurance')).length > 0 && (
                  <>
                    <div className="flex items-center gap-1 pt-1 pb-0.5">
                      <div className="flex-1 border-t border-blue-200" />
                      <span className="text-[9px] text-blue-500 font-semibold px-1">보험서류</span>
                      <div className="flex-1 border-t border-blue-200" />
                    </div>
                    {orderDocList(templates.filter((t) => t.category === 'insurance'))
                      .map((tpl) => {
                        const meta = FORM_META[tpl.form_key];
                        const isSelected = selectedDocKeys.has(tpl.form_key);
                        return (
                          <button
                            key={tpl.form_key}
                            onClick={() => toggleDocKey(tpl.form_key)}
                            className={cn(
                              'flex items-center gap-1.5 rounded border px-2 py-2.5 sm:py-1 text-xs font-medium transition-all text-left w-full min-h-[44px] sm:min-h-0',
                              isSelected
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-blue-50 text-blue-700 border-blue-200 hover:border-blue-400 hover:bg-blue-100',
                            )}
                            data-testid={`doc-checkbox-${tpl.form_key}`}
                          >
                            {isSelected ? (
                              <CheckSquare className="h-3 w-3 shrink-0" />
                            ) : (
                              <Square className="h-3 w-3 shrink-0" />
                            )}
                            <span className="truncate">{meta?.icon ?? '🏥'} {tpl.name_ko}</span>
                          </button>
                        );
                      })}
                  </>
                )}
              </div>
            </div>

            {/* T-20260517-foot-RX-DOSAGE-DYNAMIC: per-item 처방전 용량/용법/투약일수 입력 */}
            {selectedDocKeys.has('rx_standard') &&
              codeItems.some((i) => (i.service.category_label ?? '') === '처방약') && (
              <div className="px-2 py-1.5 border-t bg-amber-50/60 space-y-1.5">
                <p className="text-[10px] font-semibold text-amber-800">처방 용량/용법/투약일수</p>
                {codeItems
                  .filter((i) => (i.service.category_label ?? '') === '처방약')
                  .map(({ service }) => (
                    <div key={service.id} className="space-y-0.5">
                      <p className="text-[9px] text-amber-700 truncate font-medium">{service.name}</p>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground w-6 shrink-0 text-right">{RX_COL.dosage}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={rxItemDosages[service.id]?.unit_dose ?? ''}
                          onChange={(e) => setRxItemDosages((p) => ({
                            ...p,
                            [service.id]: { ...p[service.id], unit_dose: rxDigits(e.target.value) },
                          }))}
                          placeholder="1"
                          className="h-5 w-10 text-[10px] text-center border rounded px-1 bg-white"
                        />
                        <span className="text-[10px] text-muted-foreground w-6 shrink-0 text-right">{RX_COL.count}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={rxItemDosages[service.id]?.daily_freq ?? ''}
                          onChange={(e) => setRxItemDosages((p) => ({
                            ...p,
                            [service.id]: { ...p[service.id], daily_freq: rxDigits(e.target.value) },
                          }))}
                          placeholder="1"
                          className="h-5 w-10 text-[10px] text-center border rounded px-1 bg-white"
                        />
                        <span className="text-[10px] text-muted-foreground w-6 shrink-0 text-right">{RX_COL.days}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={rxItemDosages[service.id]?.total_days ?? ''}
                          onChange={(e) => setRxItemDosages((p) => ({
                            ...p,
                            [service.id]: { ...p[service.id], total_days: rxDigits(e.target.value) },
                          }))}
                          placeholder="7"
                          className="h-5 w-10 text-[10px] text-center border rounded px-1 bg-white"
                        />
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* Zone 3 — 서류 버튼 */}
            <div className="border-t px-2 py-2 space-y-1.5 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 text-xs border-teal-300 text-teal-700 hover:bg-teal-50 h-11 sm:h-9"
                onClick={handleDocPrint}
                disabled={docPrinting || selectedDocKeys.size === 0}
                data-testid="btn-doc-print"
              >
                <Printer className="h-3.5 w-3.5" />
                {docPrinting ? '출력 중...' : '출력'}
              </Button>

              <Button
                size="sm"
                className="w-full gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white h-11 sm:h-9"
                onClick={handleDocAndSettle}
                disabled={docSettlePrinting || selectedDocKeys.size === 0 || !saved || !splitValid}
                data-testid="btn-doc-settle"
              >
                <Printer className="h-3.5 w-3.5" />
                {docSettlePrinting
                  ? '처리 중...'
                  : `출력 및 수납${saved ? ` ${formatAmount(displayAmount)}` : ''}`}
              </Button>

              {!saved && selectedDocKeys.size > 0 && (
                <p className="text-[10px] text-amber-600 text-center">시술 저장 후 활성화</p>
              )}
            </div>
          </div>
          </div>
        </div>

        {/* T-20260719-foot-DOCHIST-MULTIPATH-EXTEND item②: 발행이력 조회+재출력 모달.
            2번차트 docReissue 모달과 동일 패턴(DocumentPrintPanel historyAtTop) — 단일 컴포넌트/데이터소스 재사용.
            checkIn.id 방문 스코프 = 그 결제 대상 방문 서류만(전체 이력 아님). 권한/RRN마스킹/의료서류 게이트 상속. */}
        {docHistoryOpen && checkIn && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
            onClick={() => setDocHistoryOpen(false)}
            data-testid="pmw-doc-history-modal"
          >
            <div
              className="relative w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="font-semibold text-sm">
                  발행이력·재출력 — {format(new Date(checkIn.checked_in_at), 'yyyy.MM.dd HH:mm')}
                </div>
                <button
                  onClick={() => setDocHistoryOpen(false)}
                  className="rounded p-1 hover:bg-gray-100"
                  data-testid="btn-pmw-doc-history-close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4">
                <DocumentPrintPanel
                  checkIn={checkIn}
                  onUpdated={() => onSaved?.()}
                  historyAtTop
                />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
