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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatAmount } from '@/lib/format';
import type { CheckIn } from '@/lib/types';
import { useDutyDoctors, type DutyDoctor } from '@/hooks/useDutyRoster';
import {
  DEFAULT_PRESET_KEYS,
  FALLBACK_TEMPLATES,
  INSURANCE_FALLBACK_TEMPLATES,
  FORM_META,
  getTemplateImageUrl,
  type FieldMapEntry,
  type FormSubmission,
  type FormTemplate,
} from '@/lib/formTemplates';
import {
  bindHtmlTemplate,
  buildBillDetailItemsHtml,
  buildRxItemsHtml,
  getHtmlTemplate,
  isHtmlTemplate,
} from '@/lib/htmlFormTemplates';
import { loadAutoBindContext } from '@/lib/autoBindContext';

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
}

// ─── Props ───

interface Props {
  checkIn: CheckIn;
  onUpdated: () => void;
  /** T-20260522-foot-ALT-BADGE: ALT 활성 여부 — 레이저코드 삽입 차단 (AC-12) */
  altStatus?: boolean;
}

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
  const boundValues =
    template.form_key === 'rx_standard'
      ? { ...fieldValues, rx_copy_label: copyLabel ?? '약국보관용' }
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
  return `<div class="page">
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
  // AC-5: 진료비세부산정내역 landscape 전용 — @page size 분기
  const pageRule = forceLandscape
    ? '@page { size: A4 landscape; margin: 0; }'
    : '@page { size: A4 portrait; margin: 0; }';
  const pageWidth  = forceLandscape ? '297mm' : '210mm';
  const pageHeight = forceLandscape ? '210mm' : '297mm';
  const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${title}</title>
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
  .page-landscape {
    width: 297mm;
    min-height: 210mm;
  }
  .page img:first-child {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    /* AC-1: 마지막 페이지 빈 페이지 방지 */
    .page:last-child { page-break-after: avoid; }
  }
</style>
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

export function DocumentPrintPanel({ checkIn, onUpdated, altStatus = false }: Props) {
  const { profile } = useAuth();
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<FormTemplate | null>(null);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  // staff.id (issued_by FK — profile.id ≠ staff.id, user_id 경유 조회)
  const [staffId, setStaffId] = useState<string | null>(null);
  // 배치 출력 시 복수 원장님 선택 상태
  const [batchDoctorPickOpen, setBatchDoctorPickOpen] = useState(false);
  const [batchSelectedDoctorName, setBatchSelectedDoctorName] = useState<string>('');

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

  // 방문일 기준 근무원장님 목록 (T-20260502-foot-DUTY-ROSTER)
  const visitDate = checkIn.checked_in_at
    ? format(new Date(checkIn.checked_in_at), 'yyyy-MM-dd')
    : format(new Date(), 'yyyy-MM-dd');
  const { data: dutyDoctors = [] } = useDutyDoctors(checkIn.clinic_id, visitDate);

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
        .select('id, amount, method, payment_type, created_at')
        .eq('check_in_id', checkIn.id)
        .neq('status', 'deleted')
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
  }, [checkIn.id, checkIn.clinic_id]);

  useEffect(() => {
    load();
  }, [load]);

  // ── 권한 체크 ──
  const userRole = profile?.role ?? '';
  const canAccess = (tpl: FormTemplate) => {
    const allowed = tpl.required_role?.split('|') ?? [];
    return allowed.includes(userRole);
  };

  // ── 분류 ──
  const defaultTemplates = templates.filter(
    (t) => FORM_META[t.form_key]?.print_preset === 'default',
  );
  // T-20260522-foot-INS-DOC-PRINT: insurance 카테고리 전용 섹션 분리
  const insuranceTemplates = templates.filter((t) => t.category === 'insurance');
  const optionalTemplates = templates.filter(
    (t) => FORM_META[t.form_key]?.print_preset !== 'default' && t.category !== 'insurance',
  );

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
    setReceiptReissuePrinting(true);
    try {
      const selected = paymentItems.filter((p) => selectedPaymentIds.has(p.id));
      const totalAmt = selected.reduce((sum, p) => sum + (p.amount ?? 0), 0);

      const autoValues = await loadAutoBindContext(checkIn);
      const billReceiptTpl = templates.find((t) => t.form_key === 'bill_receipt');

      const bindValues: Record<string, string> = {
        ...autoValues,
        total_amount: formatAmount(totalAmt),
      };

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
  const handleBatchPrint = async (doctorNameForBatch?: string) => {
    const selectedTemplates = templates.filter((t) => selectedKeys.has(t.form_key));
    if (selectedTemplates.length === 0) return;

    // 복수 근무원장님: 아직 선택 안 했으면 선택 다이얼로그 표시
    if (dutyDoctors.length > 1 && !doctorNameForBatch) {
      setBatchSelectedDoctorName(dutyDoctors[0].name);
      setBatchDoctorPickOpen(true);
      return;
    }

    setBatchPrinting(true);
    try {
      // 원장님 이름 결정 (복수일 땐 선택값, 단수면 자동, 0이면 undefined → 내부 fallback)
      const resolvedDoctorName =
        doctorNameForBatch ??
        (dutyDoctors.length === 1 ? dutyDoctors[0].name : undefined);

      const autoValues = await loadAutoBindContext(checkIn, resolvedDoctorName);
      const isFallback = templates[0]?.id.startsWith('fallback-');

      // T-20260525-foot-INS-FIELD-BIND AC-3: service_charges 전건 로딩 (배치출력용)
      // - bill_detail/rx_standard items_html 주입 (기존)
      // - 상병코드(category_label='상병') → diag_code_N/diag_name_N 주입 (신규)
      // T-20260524-foot-INS-DOC-COPAY-LINK: copayment_amount 포함
      const { data: chargeItems } = await supabase
        .from('service_charges')
        .select('id, base_amount, copayment_amount, is_insurance_covered, service_id, service:services(name, service_code, hira_code, category_label)')
        .eq('check_in_id', checkIn.id);

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

        // T-20260525-foot-INS-FIELD-BIND AC-3: 상병코드 주입 — service_charges 상병 항목 우선
        // T-20260526-foot-DOC-DIAG-TRUNC: 3~4건 전건 노출 — 행 가시성 플래그 함께 주입
        const diagBatchItems = mappedItems.filter((i) => i.category_label === '상병');
        if (diagBatchItems.length > 0) {
          delete autoValues.diag_code_1; delete autoValues.diag_name_1;
          delete autoValues.diag_code_2; delete autoValues.diag_name_2;
          diagBatchItems.forEach((item, idx) => {
            const n = idx + 1;
            autoValues[`diag_code_${n}`] = item.service_code ?? '';
            autoValues[`diag_name_${n}`] = item.name;
          });
        }
        // 행 가시성 플래그 (diagBatchItems 0건이면 auto-bind 기준으로 설정)
        const batchDiagCount = diagBatchItems.length > 0 ? diagBatchItems.length
          : (autoValues.diag_code_2 ? 2 : autoValues.diag_code_1 ? 1 : 0);
        autoValues['diag_row_3_style'] = batchDiagCount >= 3 ? '' : 'display:none';
        autoValues['diag_row_4_style'] = batchDiagCount >= 4 ? '' : 'display:none';
        const batchExtraCodes = diagBatchItems.slice(2).map((i) => i.service_code ?? '').filter(Boolean);
        autoValues['diag_extra_codes_html'] = batchExtraCodes.length > 0
          ? batchExtraCodes.map((c) => `<br>${c}`).join('') : '';

        // T-20260520-foot-PRINT-FORM-BIND: bill_detail/rx_standard 항목 주입 (기존)
        const needsItems = selectedTemplates.some(
          (t) => t.form_key === 'bill_detail' || t.form_key === 'rx_standard',
        );
        if (needsItems) {
          const billItems = mappedItems.map((item) => ({
            category: item.is_insurance_covered ? '이학요법료' : '기타',
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
          const rxItems = mappedItems.map((item) => ({
            name: item.name,
            unit_dose: '1',
            daily_freq: '1',
            total_days: '7',
            method: '',
          }));
          autoValues.rx_items_html = buildRxItemsHtml(rxItems);
          const total = mappedItems.reduce((s, item) => s + item.amount, 0);
          autoValues.total_amount = formatAmount(total);
          const nonCoveredTotal = mappedItems
            .filter((i) => !i.is_insurance_covered)
            .reduce((s, i) => s + i.amount, 0);
          autoValues.subtotal_noncovered = nonCoveredTotal.toLocaleString('ko-KR');
          autoValues.total_noncovered = nonCoveredTotal.toLocaleString('ko-KR');
          autoValues.subtotal_amount = autoValues.total_amount;
        }
      } else {
        // chargeItems 없을 때: bill_detail/rx_standard 빈 rows 처리
        const needsItems = selectedTemplates.some(
          (t) => t.form_key === 'bill_detail' || t.form_key === 'rx_standard',
        );
        if (needsItems) {
          autoValues.items_html = buildBillDetailItemsHtml([]);
          autoValues.rx_items_html = buildRxItemsHtml([]);
        }
      }

      const htmlTemplates = selectedTemplates.filter((t) => t.template_format === 'html' || isHtmlTemplate(t.form_key));
      const jpgTemplates = selectedTemplates.filter((t) => t.template_format !== 'pdf' && t.template_format !== 'html' && !isHtmlTemplate(t.form_key));
      const pdfTemplates = selectedTemplates.filter((t) => t.template_format === 'pdf');

      // HTML/CSS 디지털 양식 — 한 창에 모아 인쇄 (T-20260514-foot-FORM-CLARITY-REWORK)
      // AC-5: bill_detail(진료비세부산정내역)은 landscape 전용 창으로 분리
      {
        const landscapeHtmlTpls = htmlTemplates.filter((t) => t.form_key === 'bill_detail');
        const portraitHtmlTpls  = htmlTemplates.filter((t) => t.form_key !== 'bill_detail');
        if (landscapeHtmlTpls.length > 0) {
          const pages = landscapeHtmlTpls.map((t) => buildHtmlPageHtml(t, autoValues));
          const w = openBatchPrintWindow(pages, `서류 일괄 출력 — ${checkIn.customer_name}`, true);
          if (!w) toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
        }
        if (portraitHtmlTpls.length > 0) {
          // T-20260526-foot-RX-PRINT-DUAL: rx_standard → 약국보관용 + 환자보관용 2장으로 확장
          const pages = portraitHtmlTpls.flatMap((t) =>
            t.form_key === 'rx_standard'
              ? [
                  buildHtmlPageHtml(t, autoValues, '약국보관용'),
                  buildHtmlPageHtml(t, autoValues, '환자보관용'),
                ]
              : [buildHtmlPageHtml(t, autoValues)],
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
          return [buildPageHtml(t, autoValues, imgUrl)];
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
            for (const f of t.field_map) {
              const val = autoValues[f.key] ?? '';
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
      if (!isFallback && staffId) {
        const rows = selectedTemplates.map((t) => ({
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

        const { error } = await supabase.from('form_submissions').insert(rows);
        if (error) {
          toast.warning(`발행 기록 저장 실패: ${error.message}`);
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

      {/* 기본 서류 섹션 — 진료비 영수증 카드 포함 (T-20260509-foot-CHART1-LAYOUT-REAPPLY) */}
      {defaultTemplates.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            기본 서류
          </div>
          <div className="grid grid-cols-2 gap-2">
            {defaultTemplates.map((tpl) => {
              const meta = FORM_META[tpl.form_key];
              const hasCoords = tpl.field_map.length > 0;
              const accessible = canAccess(tpl);
              const isSelected = selectedKeys.has(tpl.form_key);
              const submissionCount = submissions.filter(
                (s) => s.template_id === tpl.id && s.status !== 'voided',
              ).length;
              return (
                <div
                  key={tpl.id}
                  className={`
                    relative rounded-lg border p-2.5 text-xs transition-all select-none
                    ${accessible ? 'cursor-pointer hover:shadow-md hover:border-teal-300' : 'opacity-50 cursor-not-allowed'}
                    ${isSelected ? 'ring-2 ring-teal-400 border-teal-400' : ''}
                    ${meta?.color ?? 'bg-gray-50 border-gray-200'}
                  `}
                  onClick={() => {
                    if (!accessible) return;
                    toggleSelect(tpl.form_key);
                  }}
                >
                  <div className="absolute top-1.5 right-1.5 text-teal-500">
                    {accessible && (isSelected ? (
                      <CheckSquare className="h-3.5 w-3.5" />
                    ) : (
                      <Square className="h-3.5 w-3.5 text-muted-foreground/50" />
                    ))}
                  </div>
                  <div className="flex items-start justify-between pr-5">
                    <span className="text-base">{meta?.icon ?? '📄'}</span>
                    {submissionCount > 0 && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        {submissionCount}건
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 font-semibold text-foreground">{tpl.name_ko}</div>
                  <div className="text-muted-foreground text-[11px] mt-0.5 line-clamp-1">
                    {meta?.description ?? tpl.template_format.toUpperCase()}
                  </div>
                  {!hasCoords && (
                    <div className="text-[10px] text-amber-500 mt-1">좌표 미설정</div>
                  )}
                  <button
                    className="mt-2 w-full text-[10px] text-teal-600 hover:underline text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (accessible) handleSelectTemplate(tpl);
                    }}
                  >
                    상세 발행 →
                  </button>
                </div>
              );
            })}

            {/* 진료비 영수증 카드 — T-20260519-foot-RECEIPT-REISSUE: 결제 데이터 체크박스 + 재발급 추가 */}
            <div className="relative rounded-lg border p-2.5 text-xs space-y-1.5 bg-amber-50 border-amber-200">
              {/* 헤더 */}
              <div className="flex items-start justify-between">
                <span className="text-base">🧾</span>
                {invoiceDocs.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    {invoiceDocs.length}건
                  </Badge>
                )}
              </div>
              <div className="font-semibold text-foreground">진료비 영수증</div>

              {/* ── 결제 데이터 체크박스 목록 (T-20260519-foot-RECEIPT-REISSUE) ── */}
              <div className="mt-1 space-y-1">
                {paymentItems.length === 0 ? (
                  <div className="text-[10px] text-muted-foreground py-1">
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
              </div>

              {/* 재발급 버튼 — 1건 이상 선택 시 활성화 */}
              {selectedPaymentIds.size > 0 && (
                <button
                  className="mt-1 w-full flex items-center justify-center gap-1 rounded border border-teal-400 bg-teal-50 py-1.5 text-[11px] font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50 transition-all"
                  onClick={handleReceiptReissue}
                  disabled={receiptReissuePrinting}
                >
                  <Printer className="h-3 w-3" />
                  {receiptReissuePrinting ? '출력 중…' : `재발급 (${selectedPaymentIds.size}건)`}
                </button>
              )}

              {/* 기존 발급 이력 (insurance_receipts 기반) */}
              {invoiceDocs.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-amber-200 mt-1">
                  <div className="text-[10px] text-muted-foreground">기존 등록 영수증</div>
                  {invoiceDocs.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between rounded border bg-white px-2 py-1.5 group">
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
                          className="h-6 w-6 hidden group-hover:flex items-center justify-center rounded text-teal-600 hover:bg-teal-50"
                          title="영수증 출력"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => deleteInvoice(doc.id)}
                          className="h-6 w-6 hidden group-hover:flex items-center justify-center rounded text-red-500 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* +등록 버튼 — 기존 금액 직접 입력 방식 유지 (AC-4) */}
              <button
                className="mt-2 w-full text-[10px] text-teal-600 hover:underline text-left flex items-center gap-0.5"
                onClick={() => setInvoiceOpen(true)}
              >
                <Plus className="h-2.5 w-2.5" /> 등록 →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 별도 요청 서류 섹션 */}
      {optionalTemplates.length > 0 && (
        <TemplateSection
          title="별도 요청 서류"
          templates={optionalTemplates}
          submissions={submissions}
          selectedKeys={selectedKeys}
          canAccess={canAccess}
          onToggle={toggleSelect}
          onCardClick={handleSelectTemplate}
        />
      )}

      {/* 보험서류 섹션 — T-20260522-foot-INS-DOC-PRINT */}
      {insuranceTemplates.length > 0 && (
        <TemplateSection
          title="보험서류"
          templates={insuranceTemplates}
          submissions={submissions}
          selectedKeys={selectedKeys}
          canAccess={canAccess}
          onToggle={toggleSelect}
          onCardClick={handleSelectTemplate}
        />
      )}

      {/* 발행 이력 */}
      {submissions.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" /> 발행 이력
          </span>
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
                <div className="flex items-center gap-2">
                  <span>{FORM_META[tpl?.form_key ?? '']?.icon ?? '📄'}</span>
                  <span className="font-medium">{tpl?.name_ko ?? '알 수 없는 양식'}</span>
                  <Badge
                    variant={sub.status === 'printed' ? 'default' : 'outline'}
                    className="text-[10px] px-1"
                  >
                    {sub.status === 'printed' ? '출력' : sub.status === 'voided' ? '무효' : '임시'}
                  </Badge>
                </div>
                <span className="text-muted-foreground">
                  {format(new Date(sub.created_at), 'MM/dd HH:mm')}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* 배치 출력: 복수 원장님 선택 다이얼로그 */}
      <Dialog open={batchDoctorPickOpen} onOpenChange={setBatchDoctorPickOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <UserCheck className="h-4 w-4 text-teal-600" />
              서류 발행 원장님 선택
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <p className="text-xs text-muted-foreground">
              오늘 근무 원장님이 {dutyDoctors.length}명입니다. 서류에 기재할 원장님을 선택하세요.
            </p>
            <div className="flex flex-col gap-2">
              {dutyDoctors.map((d) => (
                <button
                  key={d.id}
                  className={`rounded-lg border px-4 py-3 text-sm font-medium text-left transition-all ${
                    batchSelectedDoctorName === d.name
                      ? 'border-teal-400 bg-teal-50 text-teal-800 ring-1 ring-teal-300'
                      : 'border-gray-200 hover:border-teal-300 hover:bg-teal-50/50'
                  }`}
                  onClick={() => setBatchSelectedDoctorName(d.name)}
                >
                  {d.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {d.roster_type === 'regular' ? '근무' : '파트근무'}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setBatchDoctorPickOpen(false)}>
              취소
            </Button>
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-700"
              disabled={!batchSelectedDoctorName}
              onClick={() => {
                setBatchDoctorPickOpen(false);
                handleBatchPrint(batchSelectedDoctorName);
              }}
            >
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              이 원장님으로 출력
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function TemplateSection({
  title,
  templates,
  submissions,
  selectedKeys,
  canAccess,
  onToggle,
  onCardClick,
}: {
  title: string;
  templates: FormTemplate[];
  submissions: FormSubmission[];
  selectedKeys: Set<string>;
  canAccess: (t: FormTemplate) => boolean;
  onToggle: (key: string) => void;
  onCardClick: (t: FormTemplate) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        {title}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {templates.map((tpl) => {
          const meta = FORM_META[tpl.form_key];
          const hasCoords = tpl.field_map.length > 0;
          const accessible = canAccess(tpl);
          const isSelected = selectedKeys.has(tpl.form_key);
          const submissionCount = submissions.filter(
            (s) => s.template_id === tpl.id && s.status !== 'voided',
          ).length;

          return (
            <div
              key={tpl.id}
              className={`
                relative rounded-lg border p-2.5 text-xs transition-all select-none
                ${accessible ? 'cursor-pointer hover:shadow-md hover:border-teal-300' : 'opacity-50 cursor-not-allowed'}
                ${isSelected ? 'ring-2 ring-teal-400 border-teal-400' : ''}
                ${meta?.color ?? 'bg-gray-50 border-gray-200'}
              `}
              onClick={() => {
                if (!accessible) return;
                onToggle(tpl.form_key);
              }}
            >
              {/* 체크박스 표시 */}
              <div className="absolute top-1.5 right-1.5 text-teal-500">
                {accessible &&
                  (isSelected ? (
                    <CheckSquare className="h-3.5 w-3.5" />
                  ) : (
                    <Square className="h-3.5 w-3.5 text-muted-foreground/50" />
                  ))}
              </div>

              <div className="flex items-start justify-between pr-5">
                <span className="text-base">{meta?.icon ?? '📄'}</span>
                {submissionCount > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    {submissionCount}건
                  </Badge>
                )}
              </div>
              <div className="mt-1 font-semibold text-foreground">{tpl.name_ko}</div>
              <div className="text-muted-foreground text-[11px] mt-0.5 line-clamp-1">
                {meta?.description ?? tpl.template_format.toUpperCase()}
              </div>
              {!hasCoords && (
                <div className="text-[10px] text-amber-500 mt-1">좌표 미설정</div>
              )}

              {/* 상세 발행 버튼 (카드 내부) */}
              <button
                className="mt-2 w-full text-[10px] text-teal-600 hover:underline text-left"
                onClick={(e) => {
                  e.stopPropagation();
                  if (accessible) onCardClick(tpl);
                }}
              >
                상세 발행 →
              </button>
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
}) {
  const [saving, setSaving] = useState(false);
  const [autoValues, setAutoValues] = useState<Record<string, string>>({});
  const [manualValues, setManualValues] = useState<Record<string, string>>({
    diagnosis_ko: '',
    memo: '',
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  // 복수 원장님일 때 선택 상태 (단일이면 자동 설정됨)
  const [selectedDoctorName, setSelectedDoctorName] = useState<string>('');
  // T-20260516-foot-CLINIC-DOC-INFO: clinic_doctors 다중 의사 선택
  const [clinicDoctors, setClinicDoctors] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [selectedClinicDoctorId, setSelectedClinicDoctorId] = useState<string>('');
  const [clinicDoctorOverrides, setClinicDoctorOverrides] = useState<Record<string, string>>({});
  // Phase 3: 서비스 항목 (진료 코드 참조)
  const [serviceItems, setServiceItems] = useState<ServiceChargeItem[]>([]);
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

    // 서비스 항목 조회 (service_charges JOIN services — T-20260507-SERVICE-CATALOG-SEED Phase 3)
    // T-20260525-foot-INS-FIELD-BIND: category_label 추가 — 상병코드 식별 후 diag_code_N 주입
    // T-20260525-foot-DOC-AUTOBIND-REGRESS AC-2: copayment_amount 추가 — bill_detail 본인부담금 열 동기화
    //   PRINT-FORM-BIND(3cd5c8d) 당시 초회 useEffect에 미포함되어 refreshServiceItems와 불일치 발생.
    supabase
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

    // 원장님 이름 결정
    // - 1명: 자동 세팅 (이미 loadAutoBindContext에서 처리됨)
    // - 2명 이상: 빈 채로 — 아래 selectedDoctorName으로 별도 처리
    // - 0명: loadAutoBindContext fallback 처리
    const resolvedDoctorName =
      dutyDoctors.length === 1
        ? dutyDoctors[0].name
        : dutyDoctors.length > 1
          ? ''  // 복수: UI에서 선택
          : undefined; // 없음: loadAutoBindContext 내부 fallback

    if (dutyDoctors.length > 1) {
      setSelectedDoctorName(dutyDoctors[0].name); // 첫 번째 기본 선택
    }

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

    loadAutoBindContext(checkIn, resolvedDoctorName).then((vals) => {
      if (!cancelled) setAutoValues(vals);
    });

    return () => {
      cancelled = true;
      setServiceItems([]);
      setAllServices([]);
      setAddServiceOpen(false);
    };
  }, [open, checkIn, dutyDoctors]);

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

    // bill_detail HTML 양식: 서비스 항목 rows 주입
    // T-20260525-foot-DOC-AUTOBIND-REGRESS AC-2: copayment_amount 추가 — 급여 본인부담금 열 표시
    if (template.form_key === 'bill_detail' && serviceItems.length > 0) {
      const billItems = serviceItems.map((item) => ({
        category: item.is_insurance_covered ? '이학요법료' : '기타',
        date: base.visit_date ?? '',
        code: item.service_code ?? item.hira_code ?? '',
        name: item.name,
        amount: item.amount,
        count: 1,
        days: 1,
        is_insurance_covered: item.is_insurance_covered,
        copayment_amount: item.copayment_amount ?? undefined,
      }));
      base.items_html = buildBillDetailItemsHtml(billItems);
      const nonCoveredTotal = billItems
        .filter((i) => !i.is_insurance_covered)
        .reduce((s, i) => s + i.amount, 0);
      base.subtotal_amount = base.total_amount;
      base.subtotal_noncovered = nonCoveredTotal.toLocaleString('ko-KR');
      base.total_noncovered = nonCoveredTotal.toLocaleString('ko-KR');
    } else if (template.form_key === 'bill_detail') {
      base.items_html = buildBillDetailItemsHtml([]);
      base.subtotal_amount = base.total_amount;
      base.subtotal_noncovered = '0';
      base.total_noncovered = '0';
    }

    // rx_standard HTML 양식: 처방 의약품 rows 주입 (T-20260515-foot-FORM-ONELINE-RX)
    // T-20260517-foot-RX-DOSAGE-DYNAMIC: 하드코딩 → per-item 사용자 입력, 미입력 시 1/1/7 fallback
    // T-20260525-foot-DOC-AUTOBIND-REGRESS AC-4: 상병코드(category_label='상병') 항목은 처방전 제외
    //   PaymentMiniWindow buildCodeEnrichedValues와 동일 정책 적용.
    if (template.form_key === 'rx_standard') {
      const rxServiceItems = serviceItems.filter((i) => i.category_label !== '상병');
      const rxItems = rxServiceItems.map((item) => ({
        name: item.name,
        unit_dose: rxItemDosages[item.id]?.unit_dose || '1',
        daily_freq: rxItemDosages[item.id]?.daily_freq || '1',
        total_days: rxItemDosages[item.id]?.total_days || '7',
        method: '',
      }));
      base.rx_items_html = buildRxItemsHtml(rxItems);
      // T-20260601-foot-DOC-PRINT-8FIX AC-3②: 사용기간 기본 3일 통일
      if (!base.usage_days) base.usage_days = '3';
      if (!base.issue_no) base.issue_no = checkIn.id.slice(0, 5).toUpperCase();
    }

    // T-20260525-foot-INS-FIELD-BIND AC-3: 상병코드 주입 — service_charges 상병 항목 우선
    // loadAutoBindContext의 medical_charts 기반 diag_code보다 service_charges가 더 신뢰성 높음
    // PaymentMiniWindow의 buildCodeEnrichedValues와 동일 로직 (단, serviceItems는 이미 로드된 상태)
    // T-20260526-foot-DOC-DIAG-TRUNC: 3~4건 전건 노출 — 행 가시성 플래그 함께 주입
    const diagChargeItems = serviceItems.filter((i) => i.category_label === '상병');
    if (diagChargeItems.length > 0) {
      // 기존 medical_charts 기반 값을 service_charges 상병 항목으로 덮어씀
      // 먼저 기존 diag_code_N 키 초기화 (regression 방지)
      delete base.diag_code_1; delete base.diag_name_1;
      delete base.diag_code_2; delete base.diag_name_2;
      diagChargeItems.forEach((item, idx) => {
        const n = idx + 1;
        base[`diag_code_${n}`] = item.service_code ?? '';
        base[`diag_name_${n}`] = item.name;
      });
    }
    // 행 가시성 플래그 (diagChargeItems 0건이면 auto-bind 기준으로 설정)
    const issueDiagCount = diagChargeItems.length > 0 ? diagChargeItems.length
      : (base.diag_code_2 ? 2 : base.diag_code_1 ? 1 : 0);
    base['diag_row_3_style'] = issueDiagCount >= 3 ? '' : 'display:none';
    base['diag_row_4_style'] = issueDiagCount >= 4 ? '' : 'display:none';
    const issueExtraCodes = diagChargeItems.slice(2).map((i) => i.service_code ?? '').filter(Boolean);
    base['diag_extra_codes_html'] = issueExtraCodes.length > 0
      ? issueExtraCodes.map((c) => `<br>${c}`).join('') : '';

    // 등록번호/연번호 기본값 (없으면 checkIn.id 앞 8자)
    if (!base.record_no) {
      base.record_no = checkIn.customer_id?.slice(0, 8) ?? '';
    }
    if (!base.visit_no) {
      base.visit_no = checkIn.id.slice(0, 8) ?? '';
    }

    return base;
  }, [autoValues, manualValues, dutyDoctors.length, selectedDoctorName, computedTotal, template.form_key, serviceItems, checkIn, clinicDoctors.length, selectedClinicDoctorId, clinicDoctorOverrides, rxItemDosages]);

  const editableFields = useMemo(() => {
    if (template.field_map.length > 0) return template.field_map;
    return [
      { key: 'patient_name', label: '환자명', type: 'text' as const, x: 0, y: 0 },
      { key: 'patient_phone', label: '연락처', type: 'text' as const, x: 0, y: 0 },
      { key: 'visit_date', label: '진료일', type: 'date' as const, x: 0, y: 0 },
      { key: 'diagnosis_ko', label: '진단명', type: 'multiline' as const, x: 0, y: 0, w: 400, h: 80 },
      { key: 'doctor_name', label: '진료 의사', type: 'text' as const, x: 0, y: 0 },
      { key: 'total_amount', label: '총 금액', type: 'amount' as const, x: 0, y: 0 },
      { key: 'issue_date', label: '발행일', type: 'date' as const, x: 0, y: 0 },
      { key: 'memo', label: '비고', type: 'multiline' as const, x: 0, y: 0, w: 400, h: 60 },
    ] satisfies FieldMapEntry[];
  }, [template.field_map]);

  const updateField = (key: string, value: string) => {
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

  const printJpg = useCallback(() => {
    // T-20260514-foot-FORM-CLARITY-REWORK: HTML 양식 분기
    if (template.template_format === 'html' || isHtmlTemplate(template.form_key)) {
      // T-20260526-foot-RX-PRINT-DUAL: 처방전(rx_standard) 2장 출력 (약국보관용 + 환자보관용)
      const isLandscape = template.form_key === 'bill_detail';
      const pages = template.form_key === 'rx_standard'
        ? [
            buildHtmlPageHtml(template, allValues, '약국보관용'),
            buildHtmlPageHtml(template, allValues, '환자보관용'),
          ]
        : [buildHtmlPageHtml(template, allValues)];
      const w = openBatchPrintWindow(pages, `${template.name_ko} — ${checkIn.customer_name}`, isLandscape);
      if (!w) toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
      return;
    }
    const imgUrl = getTemplateImageUrl(template.form_key);
    if (!imgUrl) {
      toast.error('양식 이미지를 찾을 수 없습니다');
      return;
    }
    const pageHtml = buildPageHtml(template, allValues, imgUrl);
    const w = openBatchPrintWindow([pageHtml], `${template.name_ko} — ${checkIn.customer_name}`);
    if (!w) toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
  }, [template, allValues, checkIn.customer_name]);

  const printPdf = useCallback(async () => {
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
          const val = allValues[f.key] ?? '';
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
    setSaving(true);
    const isFallback = template.id.startsWith('fallback-');

    // staffId: issued_by = staff.id (≠ user_profiles.id). 미조회 시 로그 생략하고 출력은 계속.
    if (!isFallback && staffId) {
      const { error } = await supabase.from('form_submissions').insert({
        clinic_id: checkIn.clinic_id,
        template_id: template.id,
        check_in_id: checkIn.id,
        customer_id: checkIn.customer_id,
        issued_by: staffId,
        field_data: allValues,
        diagnosis_codes: manualValues.diagnosis_ko ? [manualValues.diagnosis_ko] : null,
        status: 'printed',
        printed_at: new Date().toISOString(),
      });
      if (error) {
        toast.error(`발행 기록 저장 실패: ${error.message}`);
        setSaving(false);
        return;
      }
    }

    if (template.template_format === 'pdf') {
      await printPdf();
    } else {
      // html 포함 모든 비-PDF는 printJpg (내부에서 html 분기 처리)
      printJpg();
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
                              <span className="text-[10px] text-muted-foreground shrink-0">용량</span>
                              <Input
                                value={rxItemDosages[item.id]?.unit_dose ?? ''}
                                onChange={(e) => setRxItemDosages((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], unit_dose: e.target.value },
                                }))}
                                placeholder="1"
                                className="h-5 text-[10px] w-10 px-1 text-center"
                                inputMode="numeric"
                              />
                              <span className="text-[10px] text-muted-foreground shrink-0">횟수</span>
                              <Input
                                value={rxItemDosages[item.id]?.daily_freq ?? ''}
                                onChange={(e) => setRxItemDosages((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], daily_freq: e.target.value },
                                }))}
                                placeholder="1"
                                className="h-5 text-[10px] w-10 px-1 text-center"
                                inputMode="numeric"
                              />
                              <span className="text-[10px] text-muted-foreground shrink-0">일수</span>
                              <Input
                                value={rxItemDosages[item.id]?.total_days ?? ''}
                                onChange={(e) => setRxItemDosages((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id], total_days: e.target.value },
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
                <p className="text-[10px] text-blue-600">
                  선택한 의사의 면허번호·전문의자격번호·직인이 서류에 반영됩니다
                </p>
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
            {(template.template_format !== 'pdf') && (
              <Button variant="outline" size="sm" className="gap-1" onClick={renderPreview}>
                <Eye className="h-3.5 w-3.5" /> 미리보기
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button
              onClick={handlePrint}
              disabled={saving}
              className="gap-1 bg-teal-600 hover:bg-teal-700"
            >
              <Printer className="h-3.5 w-3.5" />
              {saving ? '발행 중…' : '인쇄'}
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
