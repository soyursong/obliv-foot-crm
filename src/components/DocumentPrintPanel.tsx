/**
 * DocumentPrintPanel — 풋센터 서류 발행 패널
 *
 * CheckInDetailSheet 내 "서류 발행" 섹션.
 * form_templates DB 테이블에서 양식 목록을 로드하고, 없으면 fallback 사용.
 * 양식 선택 → 자동 바인딩 + 수기 입력 → 미리보기 → 인쇄.
 *
 * Phase 2(좌표 측정) 전에는 field_map이 비어 있어 미리보기에 오버레이 없이 원본만 표시.
 * 좌표가 채워지면 자동으로 오버레이 렌더링 활성화.
 *
 * @see T-20260423-foot-DOC-PRINT-SPEC
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { FileText, Printer, Eye, Clock, AlertCircle } from 'lucide-react';
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
import { formatAmount } from '@/lib/format';
import { formatPhone } from '@/lib/format';
import type { CheckIn } from '@/lib/types';
import {
  FALLBACK_TEMPLATES,
  FORM_META,
  getTemplateImageUrl,
  type FieldMapEntry,
  type FormSubmission,
  type FormTemplate,
} from '@/lib/formTemplates';

// ─── Props ───

interface Props {
  checkIn: CheckIn;
  onUpdated: () => void;
}

// ─── 자동 바인딩 ───

interface AutoBindContext {
  customer?: { name: string; phone: string; rrn?: string; address?: string } | null;
  checkIn: CheckIn;
  payments?: { total: number; insurance_covered: number; non_covered: number };
  clinic?: { name: string; address: string } | null;
  doctor?: string | null;
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
    insurance_covered: ctx.payments ? formatAmount(ctx.payments.insurance_covered) : '',
    non_covered: ctx.payments ? formatAmount(ctx.payments.non_covered) : '',
    clinic_name: ctx.clinic?.name ?? '오블리브 풋센터 종로',
    clinic_address: ctx.clinic?.address ?? '',
    issue_date: today,
  };
}

// ─── 메인 컴포넌트 ───

export function DocumentPrintPanel({ checkIn, onUpdated }: Props) {
  const { profile } = useAuth();
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<FormTemplate | null>(null);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);

  const load = useCallback(async () => {
    // 1) form_templates 로드 (DB 우선, fallback)
    const { data: tplData } = await supabase
      .from('form_templates')
      .select('*')
      .eq('clinic_id', checkIn.clinic_id)
      .eq('category', 'foot-service')
      .eq('active', true)
      .order('sort_order');

    const tpls = (tplData && tplData.length > 0)
      ? (tplData as FormTemplate[])
      : FALLBACK_TEMPLATES;
    setTemplates(tpls);

    // 2) form_submissions 로드
    const { data: subData } = await supabase
      .from('form_submissions')
      .select('*')
      .eq('check_in_id', checkIn.id)
      .order('created_at', { ascending: false });

    setSubmissions((subData ?? []) as FormSubmission[]);
  }, [checkIn.id, checkIn.clinic_id]);

  useEffect(() => { load(); }, [load]);

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

  // 권한 체크: 현재 사용자 role이 template.required_role에 포함되는지
  const userRole = profile?.role ?? '';
  const canAccess = (tpl: FormTemplate) => {
    const allowed = tpl.required_role.split('|');
    return allowed.includes(userRole);
  };

  const usingFallback = templates.length > 0 && templates[0].id.startsWith('fallback-');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
          <FileText className="h-3 w-3" /> 서류 발행
        </span>
        {usingFallback && (
          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 gap-1">
            <AlertCircle className="h-3 w-3" /> 미리보기 모드
          </Badge>
        )}
      </div>

      {/* 양식 카드 그리드 */}
      <div className="grid grid-cols-2 gap-2">
        {templates.map((tpl) => {
          const meta = FORM_META[tpl.form_key];
          const hasCoords = tpl.field_map.length > 0;
          const accessible = canAccess(tpl);
          const submissionCount = submissions.filter(
            (s) => s.template_id === tpl.id && s.status !== 'voided',
          ).length;

          return (
            <button
              key={tpl.id}
              onClick={() => accessible && handleSelectTemplate(tpl)}
              disabled={!accessible}
              className={`
                relative rounded-lg border p-2.5 text-left transition-all text-xs
                ${accessible ? 'hover:shadow-md hover:border-teal-300 cursor-pointer' : 'opacity-50 cursor-not-allowed'}
                ${meta?.color ?? 'bg-gray-50 border-gray-200'}
              `}
            >
              <div className="flex items-start justify-between">
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
            </button>
          );
        })}
      </div>

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
                className="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs"
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

      {/* 발행 다이얼로그 */}
      {selectedTemplate && (
        <IssueDialog
          template={selectedTemplate}
          checkIn={checkIn}
          open={issueDialogOpen}
          onOpenChange={(o) => {
            setIssueDialogOpen(o);
            if (!o) setSelectedTemplate(null);
          }}
          onIssued={handleIssued}
        />
      )}
    </div>
  );
}

// ─── 발행 다이얼로그 ───

function IssueDialog({
  template,
  checkIn,
  open,
  onOpenChange,
  onIssued,
}: {
  template: FormTemplate;
  checkIn: CheckIn;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onIssued: () => void;
}) {
  const { profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [autoValues, setAutoValues] = useState<Record<string, string>>({});
  const [manualValues, setManualValues] = useState<Record<string, string>>({
    diagnosis_ko: '',
    memo: '',
  });
  const [previewOpen, setPreviewOpen] = useState(false);

  // 자동 바인딩 데이터 로드
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
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

      // 보험 영수증 정보
      const { data: insData } = await supabase
        .from('insurance_receipts')
        .select('insurance_covered, non_covered')
        .eq('check_in_id', checkIn.id);

      const insCovered = (insData ?? []).reduce((s, r) => s + (r.insurance_covered ?? 0), 0);
      const nonCovered = (insData ?? []).reduce((s, r) => s + (r.non_covered ?? 0), 0);

      // 클리닉 정보
      const { data: clinicData } = await supabase
        .from('clinics')
        .select('name, address')
        .eq('id', checkIn.clinic_id)
        .maybeSingle();

      // 진료 의사명 (staff)
      let doctorName: string | null = null;
      // examination_by가 있으면 사용, 없으면 profile 이름
      const { data: staffData } = await supabase
        .from('staff')
        .select('name')
        .eq('clinic_id', checkIn.clinic_id)
        .eq('role', 'director')
        .eq('active', true)
        .limit(1)
        .maybeSingle();
      doctorName = staffData?.name ?? null;

      if (cancelled) return;

      setAutoValues(
        buildAutoBindValues({
          customer,
          checkIn,
          payments: { total: payTotal, insurance_covered: insCovered, non_covered: nonCovered },
          clinic: clinicData,
          doctor: doctorName,
        }),
      );
    })();

    return () => { cancelled = true; };
  }, [open, checkIn]);

  // 전체 필드 값 (자동 + 수기)
  const allValues = useMemo(
    () => ({ ...autoValues, ...manualValues }),
    [autoValues, manualValues],
  );

  // field_map이 있으면 해당 필드만, 없으면 공통 기본 필드
  const editableFields = useMemo(() => {
    if (template.field_map.length > 0) {
      return template.field_map;
    }
    // field_map 미설정 — 기본 수기 입력 필드 제공
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
    // auto 필드도 수정 가능하도록 autoValues 업데이트
    if (key in autoValues) {
      setAutoValues((prev) => ({ ...prev, [key]: value }));
    } else {
      setManualValues((prev) => ({ ...prev, [key]: value }));
    }
  };

  // 미리보기 렌더링
  const renderPreview = useCallback(() => {
    const imgUrl = getTemplateImageUrl(template.form_key);
    if (!imgUrl || template.template_format === 'pdf') {
      // PDF는 별도 처리 (pdf-lib)
      toast.info('PDF 양식은 미리보기 없이 바로 출력됩니다');
      return;
    }
    setPreviewOpen(true);
  }, [template]);

  // JPG 인쇄
  const printJpg = useCallback(() => {
    const imgUrl = getTemplateImageUrl(template.form_key);
    if (!imgUrl) {
      toast.error('양식 이미지를 찾을 수 없습니다');
      return;
    }

    const hasCoords = template.field_map.length > 0;

    // 오버레이 HTML 생성
    const overlayHtml = hasCoords
      ? template.field_map
          .map((f) => {
            const val = allValues[f.key] ?? '';
            if (!val) return '';
            const style = [
              `position:absolute`,
              `left:${f.x}px`,
              `top:${f.y}px`,
              f.w ? `width:${f.w}px` : '',
              f.h ? `height:${f.h}px` : '',
              `font-size:${f.font ?? 14}px`,
              `font-family:'Malgun Gothic',sans-serif`,
              `color:#000`,
              `line-height:1.4`,
              `white-space:pre-wrap`,
            ]
              .filter(Boolean)
              .join(';');
            return `<div style="${style}">${val}</div>`;
          })
          .join('\n')
      : `<div style="position:absolute;bottom:20px;left:20px;background:rgba(255,245,157,0.9);padding:8px 12px;border-radius:4px;font-size:13px;color:#333;">
           ⚠ 좌표 미설정 — 원본 양식만 표시됩니다. 원장님 검토 후 필드 위치가 설정됩니다.
         </div>`;

    const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${template.name_ko} — ${checkIn.customer_name}</title>
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; padding: 0; }
  .page {
    position: relative;
    width: 210mm;
    height: 297mm;
    overflow: hidden;
    page-break-after: always;
  }
  .page img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head><body>
<div class="page">
  <img src="${imgUrl}" alt="${template.name_ko}" />
  ${overlayHtml}
</div>
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) {
      toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    // 이미지 로드 후 인쇄
    const img = w.document.querySelector('img');
    if (img) {
      img.onload = () => w.print();
    } else {
      setTimeout(() => w.print(), 500);
    }
  }, [template, allValues, checkIn.customer_name]);

  // PDF 인쇄 (pdf-lib dynamic import)
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

      // 기본 폰트 (한글 미지원 — Phase 2에서 커스텀 폰트 임베드 예정)
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // field_map 좌표가 있으면 텍스트 오버레이
      if (template.field_map.length > 0) {
        for (const f of template.field_map) {
          const val = allValues[f.key] ?? '';
          if (!val) continue;
          // PDF 좌표는 좌하단 원점 — y 반전 필요할 수 있음 (Phase 2에서 보정)
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
      // cleanup after delay
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      toast.error(`PDF 생성 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    }
  }, [template, allValues]);

  // 발행 저장 + 인쇄
  const handlePrint = async () => {
    setSaving(true);

    // form_submissions에 기록 (DB 시드 적용 후에만 실제 저장)
    const isFallback = template.id.startsWith('fallback-');
    if (!isFallback) {
      const { error } = await supabase.from('form_submissions').insert({
        template_id: template.id,
        check_in_id: checkIn.id,
        customer_id: checkIn.customer_id,
        issued_by: profile?.id ?? '',
        field_data: allValues,
        diagnosis_codes: manualValues.diagnosis_ko
          ? [manualValues.diagnosis_ko]
          : null,
        status: 'printed',
        printed_at: new Date().toISOString(),
      });
      if (error) {
        toast.error(`발행 기록 저장 실패: ${error.message}`);
        setSaving(false);
        return;
      }
    }

    // 인쇄
    if (template.template_format === 'pdf') {
      await printPdf();
    } else {
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
            {/* 안내 배너 */}
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

            {/* 자동 바인딩 + 수기 입력 필드 */}
            <div className="space-y-3">
              {editableFields.map((f) => {
                const val = allValues[f.key] ?? '';
                const isAuto = f.key in autoValues && autoValues[f.key] !== '';

                return (
                  <div key={f.key}>
                    <Label className="text-xs flex items-center gap-1">
                      {f.label}
                      {isAuto && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-teal-600 border-teal-300">
                          자동
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
                        onChange={(e) => updateField(f.key, e.target.value)}
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
            {template.template_format !== 'pdf' && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={renderPreview}
              >
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

      {/* 미리보기 다이얼로그 */}
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
  const imgUrl = getTemplateImageUrl(template.form_key);
  const hasCoords = template.field_map.length > 0;

  if (!imgUrl) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="text-sm">미리보기 — {template.name_ko}</DialogTitle>
        </DialogHeader>
        <div ref={containerRef} className="relative mx-4 mb-4 border rounded-lg overflow-hidden bg-white">
          <img src={imgUrl} alt={template.name_ko} className="w-full h-auto" />
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
                    fontFamily: "'Malgun Gothic', sans-serif",
                    color: '#000',
                    lineHeight: 1.4,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {val}
                </div>
              );
            })}
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
