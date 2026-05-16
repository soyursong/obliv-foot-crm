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
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { formatAmount, parseAmount } from '@/lib/format';
import { formatPhone } from '@/lib/format';
import type { CheckIn } from '@/lib/types';
import { useDutyDoctors, fetchDutyDoctors, type DutyDoctor } from '@/hooks/useDutyRoster';
import {
  DEFAULT_PRESET_KEYS,
  FALLBACK_TEMPLATES,
  FORM_META,
  getStampUrl,
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

// ─── Props ───

interface Props {
  checkIn: CheckIn;
  onUpdated: () => void;
}

// ─── 자동 바인딩 컨텍스트 ───

interface ClinicDoctorInfo {
  name: string;
  license_no: string | null;
  specialist_no: string | null;
  seal_image_url: string | null;
}

interface AutoBindContext {
  customer?: { name: string; phone: string; rrn?: string; address?: string } | null;
  checkIn: CheckIn;
  payments?: { total: number; insurance_covered: number; copayment?: number; non_covered: number };
  clinic?: { name: string; address: string; phone?: string | null; business_no?: string | null; established_date?: string | null } | null;
  doctor?: string | null;
  /** T-20260516-foot-CLINIC-DOC-INFO: clinic_doctors에서 매칭된 원장 상세 정보 */
  clinicDoctor?: ClinicDoctorInfo | null;
}

function buildAutoBindValues(ctx: AutoBindContext): Record<string, string> {
  const today = format(new Date(), 'yyyy-MM-dd');
  const visitDate = ctx.checkIn.checked_in_at
    ? format(new Date(ctx.checkIn.checked_in_at), 'yyyy-MM-dd')
    : today;

  return {
    patient_name: ctx.customer?.name ?? ctx.checkIn.customer_name ?? '',
    patient_phone: formatPhone(ctx.customer?.phone ?? ctx.checkIn.customer_phone),
    patient_rrn: ctx.customer?.rrn ?? '',
    patient_address: ctx.customer?.address ?? '',
    visit_date: visitDate,
    doctor_name: ctx.doctor ?? '',
    total_amount: ctx.payments ? formatAmount(ctx.payments.total) : '',
    // 진료비계산서 field_map (T-20260504-foot-INSURANCE-COPAYMENT)
    insurance_covered: ctx.payments ? formatAmount(ctx.payments.insurance_covered) : '',
    copayment: ctx.payments ? formatAmount(ctx.payments.copayment ?? 0) : '',
    non_covered: ctx.payments ? formatAmount(ctx.payments.non_covered) : '',
    clinic_name: ctx.clinic?.name ?? '오블리브 풋센터 종로',
    clinic_address: ctx.clinic?.address ?? '',
    issue_date: today,
    // T-20260516-foot-CLINIC-DOC-INFO: 원장·병원 상세 정보
    doctor_license_no: ctx.clinicDoctor?.license_no ?? '',
    doctor_specialist_no: ctx.clinicDoctor?.specialist_no ?? '',
    doctor_seal_image: ctx.clinicDoctor?.seal_image_url ?? '',
    clinic_business_no: ctx.clinic?.business_no ?? '',
    clinic_phone: ctx.clinic?.phone ?? '',
    clinic_established_date: ctx.clinic?.established_date ?? '',
    // 하위 호환 alias
    business_reg_no: ctx.clinic?.business_no ?? '',
  };
}

/**
 * DB에서 자동 바인딩 데이터를 일괄 로드
 *
 * @param doctorNameOverride — 듀티 로스터에서 미리 결정된 원장님 이름.
 *   undefined이면 duty_roster 조회 후 fallback(최초 활성 director) 사용.
 *   '' (빈 문자열)이면 복수 근무로 아직 미선택 — doctor_name 빈 채로 반환.
 * @param clinicDoctorId — T-20260516-foot-CLINIC-DOC-INFO: clinic_doctors에서 선택된 의사 ID.
 *   undefined이면 doctor_name으로 이름 매칭, 그래도 없으면 default 또는 첫 번째.
 */
async function loadAutoBindContext(
  checkIn: CheckIn,
  doctorNameOverride?: string,
  clinicDoctorId?: string,
): Promise<Record<string, string>> {
  // 고객 정보
  let customer = null;
  if (checkIn.customer_id) {
    const { data } = await supabase
      .from('customers')
      .select('name, phone, memo')
      .eq('id', checkIn.customer_id)
      .maybeSingle();
    customer = data;
  }

  // 결제 정보
  const { data: payData } = await supabase
    .from('payments')
    .select('amount, payment_type')
    .eq('check_in_id', checkIn.id);

  const payTotal = (payData ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);

  // 보험 영수증
  const { data: insData } = await supabase
    .from('insurance_receipts')
    .select('insurance_covered, non_covered')
    .eq('check_in_id', checkIn.id);

  const insCoveredFromReceipts = (insData ?? []).reduce((s, r) => s + (r.insurance_covered ?? 0), 0);
  const nonCoveredFromReceipts = (insData ?? []).reduce((s, r) => s + (r.non_covered ?? 0), 0);

  // service_charges 합산 (T-20260504-foot-INSURANCE-COPAYMENT)
  const { data: chargesData } = await supabase
    .from('service_charges')
    .select('insurance_covered_amount, copayment_amount, base_amount, is_insurance_covered')
    .eq('check_in_id', checkIn.id);

  const charges = chargesData ?? [];
  const hasCharges = charges.length > 0;
  const chargesCovered = charges.reduce((s, r) => s + (r.insurance_covered_amount ?? 0), 0);
  const chargesCopay = charges.reduce((s, r) => s + (r.copayment_amount ?? 0), 0);
  const chargesNonCovered = charges
    .filter((r) => !r.is_insurance_covered)
    .reduce((s, r) => s + (r.base_amount ?? 0), 0);

  const insCovered = hasCharges ? chargesCovered : insCoveredFromReceipts;
  const copayment = hasCharges ? chargesCopay : 0;
  const nonCovered = hasCharges ? chargesNonCovered : nonCoveredFromReceipts;

  // 클리닉 정보 (T-20260516-foot-CLINIC-DOC-INFO: business_no, phone, established_date 추가)
  const { data: clinicData } = await supabase
    .from('clinics')
    .select('name, address, phone, business_no, established_date')
    .eq('id', checkIn.clinic_id)
    .maybeSingle();

  // T-20260516-foot-CLINIC-DOC-INFO: clinic_doctors 전체 로드
  const { data: clinicDoctorsData } = await supabase
    .from('clinic_doctors')
    .select('id, name, license_no, specialist_no, seal_image_url, is_default')
    .eq('clinic_id', checkIn.clinic_id)
    .eq('active', true)
    .order('sort_order')
    .order('created_at');

  type ClinicDoctorRow = { id: string; name: string; license_no: string | null; specialist_no: string | null; seal_image_url: string | null; is_default: boolean };
  const clinicDoctors = (clinicDoctorsData ?? []) as ClinicDoctorRow[];

  // ── 진료 의사 결정 (T-20260502-foot-DUTY-ROSTER) ──
  // 1순위: 외부에서 전달된 이름 (이미 결정됨)
  // 2순위: 당일 duty_roster 1명이면 자동
  // 3순위: 첫 번째 활성 director (fallback)
  let doctorName: string | null = null;

  if (doctorNameOverride !== undefined) {
    // 빈 문자열('')이면 미선택 상태 유지, 비어있지 않으면 사용
    doctorName = doctorNameOverride || null;
  } else {
    // duty_roster 조회
    const visitDate = checkIn.checked_in_at
      ? format(new Date(checkIn.checked_in_at), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd');

    const dutyDocs = await fetchDutyDoctors(checkIn.clinic_id, visitDate);

    if (dutyDocs.length === 1) {
      doctorName = dutyDocs[0].name;
    } else if (dutyDocs.length === 0) {
      // Fallback: 첫 번째 활성 director
      const { data: fallbackStaff } = await supabase
        .from('staff')
        .select('name')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('role', 'director')
        .eq('active', true)
        .limit(1)
        .maybeSingle();
      doctorName = fallbackStaff?.name ?? null;
    }
    // dutyDocs.length > 1: doctorName = null → UI에서 선택
  }

  // T-20260516-foot-CLINIC-DOC-INFO: clinic_doctors에서 원장 상세 결정
  // 1순위: clinicDoctorId 직접 지정
  // 2순위: doctorName으로 이름 매칭
  // 3순위: is_default=true 의사
  // 4순위: 첫 번째 등록 의사
  let clinicDoctor: ClinicDoctorRow | null = null;
  if (clinicDoctors.length > 0) {
    if (clinicDoctorId) {
      clinicDoctor = clinicDoctors.find((d) => d.id === clinicDoctorId) ?? null;
    }
    if (!clinicDoctor && doctorName) {
      clinicDoctor = clinicDoctors.find((d) => d.name === doctorName) ?? null;
    }
    if (!clinicDoctor) {
      clinicDoctor = clinicDoctors.find((d) => d.is_default) ?? clinicDoctors[0];
    }
  }

  // 직인 이미지: storage path → signed URL (1시간)
  if (clinicDoctor?.seal_image_url) {
    const { data: signed } = await supabase.storage
      .from('documents')
      .createSignedUrl(clinicDoctor.seal_image_url, 3600);
    if (signed?.signedUrl) {
      clinicDoctor = { ...clinicDoctor, seal_image_url: signed.signedUrl };
    }
  }

  return buildAutoBindValues({
    customer,
    checkIn,
    payments: {
      total: payTotal,
      insurance_covered: insCovered,
      copayment,
      non_covered: nonCovered,
    },
    clinic: clinicData,
    doctor: doctorName,
    clinicDoctor,
  });
}

// ─── HTML 양식 인쇄 페이지 생성 ───

/**
 * HTML/CSS 기반 양식의 인쇄용 페이지 div를 생성.
 * T-20260514-foot-FORM-CLARITY-REWORK
 */
function buildHtmlPageHtml(
  template: FormTemplate,
  fieldValues: Record<string, string>,
): string {
  const htmlTpl = getHtmlTemplate(template.form_key);
  if (!htmlTpl) return '';
  const bound = bindHtmlTemplate(htmlTpl, fieldValues);
  const isLandscape = template.form_key === 'bill_detail';
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

  const stampUrl = getStampUrl();

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

  const stampHtml = stampUrl
    ? `<img src="${stampUrl}" alt="원내 도장"
        style="position:absolute;right:52px;bottom:52px;width:88px;height:88px;opacity:0.85;pointer-events:none;"
        onerror="this.style.display='none'" />`
    : '';

  return `<div class="page">
  <img src="${imgUrl}" alt="${template.name_ko}" />
  ${overlayHtml}
  ${stampHtml}
</div>`;
}

/** 여러 page div를 하나의 인쇄 창으로 출력 */
function openBatchPrintWindow(
  pages: string[],
  title: string,
): Window | null {
  const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  @page landscape { size: A4 landscape; margin: 0; }
  body { margin: 0; padding: 0; }
  .page {
    position: relative;
    width: 210mm;
    min-height: 297mm;
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
    .page-landscape { page: landscape; }
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

export function DocumentPrintPanel({ checkIn, onUpdated }: Props) {
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
    const [tplRes, subRes, invRes] = await Promise.all([
      supabase
        .from('form_templates')
        .select('*')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('category', 'foot-service')
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
    ]);

    const tpls =
      tplRes.data && tplRes.data.length > 0 ? (tplRes.data as FormTemplate[]) : FALLBACK_TEMPLATES;
    setTemplates(tpls);
    setSubmissions((subRes.data ?? []) as FormSubmission[]);
    setInvoiceDocs((invRes.data ?? []) as InvoiceDoc[]);
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
  const optionalTemplates = templates.filter(
    (t) => FORM_META[t.form_key]?.print_preset !== 'default',
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

  // ── 진료비 영수증 인쇄 ──
  const printInvoice = (doc: InvoiceDoc) => {
    const fmtAmt = (n: number) => n.toLocaleString('ko-KR') + '원';
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
  <tr><td>급여 (공단+본인)</td><td>${fmtAmt(doc.insurance_covered)}</td></tr>
  <tr><td>비급여</td><td>${fmtAmt(doc.non_covered)}</td></tr>
  <tr class="total"><td>실제 납부액</td><td>${fmtAmt(doc.paid_amount)}</td></tr>
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

      const htmlTemplates = selectedTemplates.filter((t) => t.template_format === 'html' || isHtmlTemplate(t.form_key));
      const jpgTemplates = selectedTemplates.filter((t) => t.template_format !== 'pdf' && t.template_format !== 'html' && !isHtmlTemplate(t.form_key));
      const pdfTemplates = selectedTemplates.filter((t) => t.template_format === 'pdf');

      // HTML/CSS 디지털 양식 — 한 창에 모아 인쇄 (T-20260514-foot-FORM-CLARITY-REWORK)
      if (htmlTemplates.length > 0) {
        const pages = htmlTemplates.map((t) => buildHtmlPageHtml(t, autoValues));
        const w = openBatchPrintWindow(pages, `서류 일괄 출력 — ${checkIn.customer_name}`);
        if (!w) toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
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

            {/* 진료비 영수증 카드 — 기본 서류 그리드 내 배치 (T-20260513-foot-RX-BOX-DESIGN: 진료내역서와 동일 스타일) */}
            <div className="relative rounded-lg border p-2.5 text-xs space-y-1.5 bg-amber-50 border-amber-200">
              {/* 헤더 — 진료내역서 카드와 동일 구조: 아이콘 상단, 타이틀·설명 수직 스택 */}
              <div className="flex items-start justify-between">
                <span className="text-base">🧾</span>
                {invoiceDocs.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    {invoiceDocs.length}건
                  </Badge>
                )}
              </div>
              <div className="font-semibold text-foreground">진료비 영수증</div>
              <div className="text-muted-foreground text-[11px] mt-0.5 line-clamp-1">데스크 금액 등록</div>

              {/* 발급 이력 */}
              {invoiceDocs.length > 0 && (
                <div className="space-y-1 mt-1">
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

              {/* 등록 버튼 — 진료내역서 "상세 발행 →" 패턴과 동일 */}
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
  hira_code: string | null;
  is_insurance_covered: boolean;
}

function IssueDialog({
  template,
  checkIn,
  open,
  onOpenChange,
  onIssued,
  staffId,
  dutyDoctors,
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

  // T-20260513-foot-BILLING-DETAIL-EDIT: service_charges 새로고침 공통 헬퍼
  const refreshServiceItems = useCallback(async () => {
    const { data } = await supabase
      .from('service_charges')
      .select('id, base_amount, is_insurance_covered, service_id, service:services(name, service_code, hira_code)')
      .eq('check_in_id', checkIn.id);
    if (!data) return;
    setServiceItems(data.map((c) => {
      const svc = Array.isArray(c.service) ? c.service[0] : c.service;
      return {
        id: c.id,
        service_code: svc?.service_code ?? null,
        name: svc?.name ?? '(알 수 없음)',
        amount: c.base_amount ?? 0,
        hira_code: svc?.hira_code ?? null,
        is_insurance_covered: c.is_insurance_covered ?? false,
      };
    }));
  }, [checkIn.id]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    // 서비스 항목 조회 (service_charges JOIN services — T-20260507-SERVICE-CATALOG-SEED Phase 3)
    supabase
      .from('service_charges')
      .select('id, base_amount, is_insurance_covered, service_id, service:services(name, service_code, hira_code)')
      .eq('check_in_id', checkIn.id)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const items: ServiceChargeItem[] = data.map((c) => {
          const svc = Array.isArray(c.service) ? c.service[0] : c.service;
          return {
            id: c.id,
            service_code: svc?.service_code ?? null,
            name: svc?.name ?? '(알 수 없음)',
            amount: c.base_amount ?? 0,
            hira_code: svc?.hira_code ?? null,
            is_insurance_covered: c.is_insurance_covered ?? false,
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
    if (computedTotal !== null) {
      base.total_amount = formatAmount(computedTotal);
    }

    // bill_detail HTML 양식: 서비스 항목 rows 주입
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
    if (template.form_key === 'rx_standard') {
      const rxItems = serviceItems.map((item) => ({
        name: item.name,
        unit_dose: '1',
        daily_freq: '1',
        total_days: '7',
        method: '',
      }));
      base.rx_items_html = buildRxItemsHtml(rxItems);
      if (!base.usage_days) base.usage_days = '7';
      if (!base.issue_no) base.issue_no = checkIn.id.slice(0, 5).toUpperCase();
    }

    // 등록번호/연번호 기본값 (없으면 checkIn.id 앞 8자)
    if (!base.record_no) {
      base.record_no = checkIn.customer_id?.slice(0, 8) ?? '';
    }
    if (!base.visit_no) {
      base.visit_no = checkIn.id.slice(0, 8) ?? '';
    }

    return base;
  }, [autoValues, manualValues, dutyDoctors.length, selectedDoctorName, computedTotal, template.form_key, serviceItems, checkIn, clinicDoctors.length, selectedClinicDoctorId, clinicDoctorOverrides]);

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
  const handleAddService = async () => {
    if (!addServiceId) return;
    const svc = allServices.find((s) => s.id === addServiceId);
    if (!svc) return;
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
      const pageHtml = buildHtmlPageHtml(template, allValues);
      const w = openBatchPrintWindow([pageHtml], `${template.name_ko} — ${checkIn.customer_name}`);
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
                          <Input
                            value={editingAmountStr}
                            onChange={(e) => setEditingAmountStr(e.target.value)}
                            inputMode="numeric"
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
                        <div className="flex items-center justify-between py-0.5">
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
                      {allServices.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.service_code ? `[${s.service_code}] ` : ''}{s.name} — {formatAmount(s.price)}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <Input
                        placeholder="금액 (원)"
                        value={addServiceAmountStr}
                        onChange={(e) => setAddServiceAmountStr(e.target.value)}
                        className="h-7 text-xs flex-1"
                      />
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-teal-600 hover:bg-teal-700 whitespace-nowrap"
                        onClick={handleAddService}
                        disabled={!addServiceId || addingService}
                      >
                        {addingService ? '추가 중…' : '추가'}
                      </Button>
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
  const stampUrl = getStampUrl();
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

          {/* 도장 오버레이 미리보기 */}
          {stampUrl && (
            <img
              src={stampUrl}
              alt="원내 도장"
              className="absolute bottom-10 right-10 w-20 h-20 opacity-80 pointer-events-none"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}

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

  useEffect(() => {
    if (open) {
      setReceiptNo('');
      setInsuranceCovered(0);
      setNonCovered(0);
      setPaidAmount(0);
      setFile(null);
    }
  }, [open]);

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

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">급여 (공단+본인)</Label>
              <Input
                value={formatAmount(insuranceCovered)}
                onChange={(e) => setInsuranceCovered(parseAmount(e.target.value))}
                inputMode="numeric"
                placeholder="0"
                className="text-sm mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">비급여</Label>
              <Input
                value={formatAmount(nonCovered)}
                onChange={(e) => setNonCovered(parseAmount(e.target.value))}
                inputMode="numeric"
                placeholder="0"
                className="text-sm mt-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">실제 납부액 <span className="text-red-500">*</span></Label>
            <Input
              value={formatAmount(paidAmount)}
              onChange={(e) => setPaidAmount(parseAmount(e.target.value))}
              inputMode="numeric"
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
