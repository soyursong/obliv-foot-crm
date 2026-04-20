import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { FileText, Plus, Upload, Trash2, Pill, Printer } from 'lucide-react';
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
import { formatAmount } from '@/lib/format';
import type { CheckIn } from '@/lib/types';

interface InsuranceReceipt {
  id: string;
  receipt_type: 'receipt' | 'detail';
  receipt_no: string | null;
  issue_date: string;
  total_amount: number;
  paid_amount: number;
  insurance_covered: number;
  non_covered: number;
  pdf_url: string | null;
  created_at: string;
}

interface Prescription {
  id: string;
  prescribed_by_name: string | null;
  diagnosis: string | null;
  memo: string | null;
  prescribed_at: string;
  items: PrescriptionItem[];
}

interface PrescriptionItem {
  id: string;
  medication_name: string;
  dosage: string | null;
  duration_days: number | null;
  quantity: number | null;
}

interface Props {
  checkIn: CheckIn;
  onUpdated: () => void;
}

export function InsuranceDocPanel({ checkIn, onUpdated }: Props) {
  const [receipts, setReceipts] = useState<InsuranceReceipt[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);

  const load = useCallback(async () => {
    const [recRes, rxRes] = await Promise.all([
      supabase
        .from('insurance_receipts')
        .select('id, receipt_type, receipt_no, issue_date, total_amount, paid_amount, insurance_covered, non_covered, pdf_url, created_at')
        .eq('check_in_id', checkIn.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('prescriptions')
        .select('id, prescribed_by_name, diagnosis, memo, prescribed_at, prescription_items(id, medication_name, dosage, duration_days, quantity)')
        .eq('check_in_id', checkIn.id)
        .order('created_at', { ascending: false }),
    ]);
    setReceipts((recRes.data ?? []) as InsuranceReceipt[]);
    setPrescriptions(
      ((rxRes.data ?? []) as any[]).map((rx) => ({
        ...rx,
        items: rx.prescription_items ?? [],
      })),
    );
  }, [checkIn.id]);

  useEffect(() => { load(); }, [load]);

  const deleteReceipt = async (id: string) => {
    if (!window.confirm('영수증을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('insurance_receipts').delete().eq('id', id);
    if (error) { toast.error('삭제 실패'); return; }
    toast.success('영수증 삭제');
    load();
  };

  const deleteRx = async (id: string) => {
    if (!window.confirm('처방전을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('prescriptions').delete().eq('id', id);
    if (error) { toast.error('삭제 실패'); return; }
    toast.success('처방전 삭제');
    load();
  };

  const printAll = () => {
    if (receipts.length === 0 && prescriptions.length === 0) {
      toast.error('출력할 서류가 없습니다');
      return;
    }
    const fmtAmt = (n: number) => n.toLocaleString('ko-KR') + '원';
    const receiptHtml = receipts
      .map(
        (r) => `
      <div class="doc-section">
        <h3>${r.receipt_type === 'receipt' ? '진료비 영수증' : '진료비 세부내역서'}${r.receipt_no ? ` #${r.receipt_no}` : ''}</h3>
        <table>
          <tr><td>발행일</td><td>${format(new Date(r.issue_date), 'yyyy-MM-dd')}</td></tr>
          <tr><td>환자명</td><td>${checkIn.customer_name}</td></tr>
          <tr><td>총 진료비</td><td>${fmtAmt(r.total_amount)}</td></tr>
          <tr><td>급여 (공단+본인)</td><td>${fmtAmt(r.insurance_covered)}</td></tr>
          <tr><td>비급여</td><td>${fmtAmt(r.non_covered)}</td></tr>
          <tr class="total"><td>실제 납부액</td><td>${fmtAmt(r.paid_amount)}</td></tr>
        </table>
      </div>`,
      )
      .join('\n<div class="page-break"></div>\n');

    const rxHtml = prescriptions
      .map(
        (rx) => `
      <div class="doc-section">
        <h3>처방전</h3>
        <table>
          <tr><td>환자명</td><td>${checkIn.customer_name}</td></tr>
          ${rx.prescribed_by_name ? `<tr><td>처방 의사</td><td>${rx.prescribed_by_name}</td></tr>` : ''}
          ${rx.diagnosis ? `<tr><td>진단명</td><td>${rx.diagnosis}</td></tr>` : ''}
          <tr><td>처방일</td><td>${format(new Date(rx.prescribed_at), 'yyyy-MM-dd HH:mm')}</td></tr>
        </table>
        ${
          rx.items.length > 0
            ? `<table class="items"><thead><tr><th>약품명</th><th>용법</th><th>일수</th></tr></thead><tbody>${rx.items
                .map(
                  (it) =>
                    `<tr><td>${it.medication_name}</td><td>${it.dosage ?? '-'}</td><td>${it.duration_days ?? '-'}일</td></tr>`,
                )
                .join('')}</tbody></table>`
            : ''
        }
        ${rx.memo ? `<p class="memo">${rx.memo}</p>` : ''}
      </div>`,
      )
      .join('\n<div class="page-break"></div>\n');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>서류 출력 - ${checkIn.customer_name}</title>
<style>
  body{font-family:'Malgun Gothic',sans-serif;padding:20mm;color:#222;font-size:13px}
  h2{text-align:center;margin-bottom:24px;font-size:18px}
  h3{border-bottom:2px solid #333;padding-bottom:6px;margin-bottom:12px;font-size:15px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  td,th{border:1px solid #ccc;padding:6px 10px;text-align:left}
  tr.total td{font-weight:bold;background:#f8f8f8}
  table.items th{background:#f0f0f0;font-weight:600}
  .memo{color:#555;font-size:12px;margin-top:8px}
  .doc-section{margin-bottom:32px}
  .page-break{page-break-after:always}
  @media print{body{padding:10mm}.page-break{page-break-after:always}}
</style></head><body>
<h2>오블리브 풋센터 — 서류 출력</h2>
${receiptHtml}
${receiptHtml && rxHtml ? '<div class="page-break"></div>' : ''}
${rxHtml}
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) {
      toast.error('팝업이 차단되었습니다. 팝업을 허용해주세요.');
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  const hasAnyDoc = receipts.length > 0 || prescriptions.length > 0;

  return (
    <div className="space-y-3">
      {/* 일괄 출력 */}
      {hasAnyDoc && (
        <Button
          variant="default"
          size="sm"
          className="w-full gap-1.5 h-9 bg-indigo-600 hover:bg-indigo-700"
          onClick={printAll}
        >
          <Printer className="h-3.5 w-3.5" /> 서류 일괄 출력 ({receipts.length + prescriptions.length}건)
        </Button>
      )}

      {/* 보험 영수증 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
            <FileText className="h-3 w-3" /> 보험 영수증
          </span>
          <Button variant="outline" className="gap-1 text-xs" onClick={() => setReceiptOpen(true)}>
            <Plus className="h-3 w-3" /> 등록
          </Button>
        </div>
        {receipts.length > 0 ? (
          <div className="space-y-1.5">
            {receipts.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs group">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-xs">
                      {r.receipt_type === 'receipt' ? '영수증' : '세부내역서'}
                    </Badge>
                    {r.receipt_no && <span className="text-muted-foreground">#{r.receipt_no}</span>}
                    <span className="text-muted-foreground">{format(new Date(r.issue_date), 'MM/dd')}</span>
                  </div>
                  <div className="flex gap-3 text-muted-foreground">
                    <span>급여 {formatAmount(r.insurance_covered)}</span>
                    <span>비급여 {formatAmount(r.non_covered)}</span>
                    <span className="font-semibold text-foreground">납부 {formatAmount(r.paid_amount)}</span>
                  </div>
                </div>
                <button
                  onClick={() => deleteReceipt(r.id)}
                  className="hidden group-hover:flex h-8 w-8 items-center justify-center rounded text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed py-3 text-center text-xs text-muted-foreground">
            등록된 영수증이 없습니다
          </div>
        )}
      </div>

      {/* 처방전 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
            <Pill className="h-3 w-3" /> 처방전
          </span>
          <Button variant="outline" className="gap-1 text-xs" onClick={() => setRxOpen(true)}>
            <Plus className="h-3 w-3" /> 등록
          </Button>
        </div>
        {prescriptions.length > 0 ? (
          <div className="space-y-1.5">
            {prescriptions.map((rx) => (
              <div key={rx.id} className="rounded-lg border px-3 py-2 text-xs group">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {rx.prescribed_by_name && <span className="font-medium">{rx.prescribed_by_name}</span>}
                    <span className="text-muted-foreground">{format(new Date(rx.prescribed_at), 'MM/dd HH:mm')}</span>
                  </div>
                  <button
                    onClick={() => deleteRx(rx.id)}
                    className="hidden group-hover:flex h-8 w-8 items-center justify-center rounded text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {rx.diagnosis && <div className="text-muted-foreground mt-0.5">진단: {rx.diagnosis}</div>}
                {rx.items.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {rx.items.map((item) => (
                      <div key={item.id} className="flex gap-2 text-muted-foreground">
                        <span className="font-medium text-foreground">{item.medication_name}</span>
                        {item.dosage && <span>{item.dosage}</span>}
                        {item.duration_days && <span>{item.duration_days}일</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed py-3 text-center text-xs text-muted-foreground">
            등록된 처방전이 없습니다
          </div>
        )}
      </div>

      <ReceiptDialog
        checkIn={checkIn}
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        onSaved={() => { setReceiptOpen(false); load(); onUpdated(); }}
      />

      <PrescriptionDialog
        checkIn={checkIn}
        open={rxOpen}
        onOpenChange={setRxOpen}
        onSaved={() => { setRxOpen(false); load(); onUpdated(); }}
      />
    </div>
  );
}

/* ─── 영수증 등록 다이얼로그 ─── */

function ReceiptDialog({
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
  const [receiptType, setReceiptType] = useState<'receipt' | 'detail'>('receipt');
  const [receiptNo, setReceiptNo] = useState('');
  const [consultAmount, setConsultAmount] = useState(0);
  const [treatmentAmount, setTreatmentAmount] = useState(0);
  const [insuranceCovered, setInsuranceCovered] = useState(0);
  const [nonCovered, setNonCovered] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  useEffect(() => {
    if (open) {
      setReceiptType('receipt');
      setReceiptNo('');
      setConsultAmount(0);
      setTreatmentAmount(0);
      setInsuranceCovered(0);
      setNonCovered(0);
      setPaidAmount(0);
      setPdfFile(null);
    }
  }, [open]);

  const totalAmount = consultAmount + treatmentAmount;

  const handleSave = async () => {
    if (totalAmount <= 0 && paidAmount <= 0) {
      toast.error('금액을 입력해주세요');
      return;
    }
    setSaving(true);

    let pdfUrl: string | null = null;
    if (pdfFile) {
      const path = `receipts/${checkIn.id}/${Date.now()}_${pdfFile.name}`;
      const { error } = await supabase.storage
        .from('documents')
        .upload(path, pdfFile, { contentType: pdfFile.type });
      if (error) {
        toast.error(`PDF 업로드 실패: ${error.message}`);
        setSaving(false);
        return;
      }
      const { data } = supabase.storage.from('documents').getPublicUrl(path);
      pdfUrl = data.publicUrl;
    }

    const { error } = await supabase.from('insurance_receipts').insert({
      clinic_id: checkIn.clinic_id,
      check_in_id: checkIn.id,
      customer_id: checkIn.customer_id,
      receipt_type: receiptType,
      receipt_no: receiptNo || null,
      consult_amount: consultAmount,
      treatment_amount: treatmentAmount,
      insurance_covered: insuranceCovered,
      non_covered: nonCovered,
      total_amount: totalAmount || paidAmount,
      paid_amount: paidAmount,
      pdf_url: pdfUrl,
    });

    setSaving(false);
    if (error) {
      toast.error(`저장 실패: ${error.message}`);
      return;
    }
    toast.success('영수증 등록 완료');
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> 보험 영수증 등록
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            {(['receipt', 'detail'] as const).map((t) => (
              <Button
                key={t}
                variant={receiptType === t ? 'default' : 'outline'}
                size="sm"
                className="text-xs h-9"
                onClick={() => setReceiptType(t)}
              >
                {t === 'receipt' ? '진료비 영수증' : '세부내역서'}
              </Button>
            ))}
          </div>

          <div>
            <Label className="text-xs">영수증 번호</Label>
            <Input
              placeholder="선택사항"
              value={receiptNo}
              onChange={(e) => setReceiptNo(e.target.value)}
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">진찰료</Label>
              <Input
                type="number"
                value={consultAmount || ''}
                onChange={(e) => setConsultAmount(Number(e.target.value))}
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">시술료</Label>
              <Input
                type="number"
                value={treatmentAmount || ''}
                onChange={(e) => setTreatmentAmount(Number(e.target.value))}
                className="text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">급여 (공단+본인)</Label>
              <Input
                type="number"
                value={insuranceCovered || ''}
                onChange={(e) => setInsuranceCovered(Number(e.target.value))}
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">비급여</Label>
              <Input
                type="number"
                value={nonCovered || ''}
                onChange={(e) => setNonCovered(Number(e.target.value))}
                className="text-sm"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">실제 납부액</Label>
            <Input
              type="number"
              value={paidAmount || ''}
              onChange={(e) => setPaidAmount(Number(e.target.value))}
              className="text-sm font-semibold"
            />
          </div>

          {totalAmount > 0 && (
            <div className="text-xs text-muted-foreground text-right">
              총액: {formatAmount(totalAmount)}
            </div>
          )}

          <div>
            <Label className="text-xs">영수증 PDF/이미지 (선택)</Label>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
              />
              <Button variant="outline" size="sm" className="w-full gap-1 text-xs pointer-events-none mt-1">
                <Upload className="h-3 w-3" />
                {pdfFile ? pdfFile.name : '파일 선택'}
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

/* ─── 처방전 등록 다이얼로그 ─── */

function PrescriptionDialog({
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
  const [doctorName, setDoctorName] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [memo, setMemo] = useState('');
  const [items, setItems] = useState<{ name: string; dosage: string; days: number }[]>([
    { name: '', dosage: '', days: 0 },
  ]);

  useEffect(() => {
    if (open) {
      setDoctorName('');
      setDiagnosis('');
      setMemo('');
      setItems([{ name: '', dosage: '', days: 0 }]);
    }
  }, [open]);

  const updateItem = (idx: number, field: string, value: string | number) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  const addItem = () => setItems((prev) => [...prev, { name: '', dosage: '', days: 0 }]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    const validItems = items.filter((it) => it.name.trim());
    if (validItems.length === 0) {
      toast.error('약품을 1개 이상 입력해주세요');
      return;
    }
    setSaving(true);

    const { data: rx, error: rxErr } = await supabase
      .from('prescriptions')
      .insert({
        clinic_id: checkIn.clinic_id,
        check_in_id: checkIn.id,
        customer_id: checkIn.customer_id,
        prescribed_by_name: doctorName || null,
        diagnosis: diagnosis || null,
        memo: memo || null,
      })
      .select('id')
      .single();

    if (rxErr || !rx) {
      toast.error(`처방전 저장 실패: ${rxErr?.message}`);
      setSaving(false);
      return;
    }

    const { error: itemErr } = await supabase.from('prescription_items').insert(
      validItems.map((it, i) => ({
        prescription_id: rx.id,
        medication_name: it.name,
        dosage: it.dosage || null,
        duration_days: it.days || null,
        sort_order: i,
      })),
    );

    setSaving(false);
    if (itemErr) {
      toast.error(`약품 항목 저장 실패: ${itemErr.message}`);
      return;
    }
    toast.success('처방전 등록 완료');
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pill className="h-5 w-5" /> 처방전 등록
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">처방 의사</Label>
              <Input
                placeholder="원장명"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">진단명</Label>
              <Input
                placeholder="무좀, 내성발톱 등"
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                className="text-sm"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">처방 약품</Label>
              <Button variant="ghost" size="sm" className="text-xs gap-1 h-9" onClick={addItem}>
                <Plus className="h-3 w-3" /> 추가
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex gap-1.5 items-start">
                  <div className="flex-1 space-y-1">
                    <Input
                      placeholder="약품명"
                      value={it.name}
                      onChange={(e) => updateItem(i, 'name', e.target.value)}
                      className="text-sm"
                    />
                    <div className="flex gap-1">
                      <Input
                        placeholder="용법 (예: 1일 3회)"
                        value={it.dosage}
                        onChange={(e) => updateItem(i, 'dosage', e.target.value)}
                        className="text-xs flex-1"
                      />
                      <Input
                        type="number"
                        placeholder="일수"
                        value={it.days || ''}
                        onChange={(e) => updateItem(i, 'days', Number(e.target.value))}
                        className="text-xs w-16"
                      />
                    </div>
                  </div>
                  {items.length > 1 && (
                    <button
                      onClick={() => removeItem(i)}
                      className="mt-2 h-9 w-9 flex items-center justify-center rounded text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">메모</Label>
            <Textarea
              placeholder="추가 사항"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={2}
              className="text-sm"
            />
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
