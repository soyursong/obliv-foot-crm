/**
 * InsuranceDocPanel — 풋센터 서류 업로드 패널
 *
 * T-20260506-foot-CHART-SIMPLE-REVAMP: 5/4 22:04 요청 반영
 *
 * 섹션 구성:
 * 1) 경과분析지   — 원장님 공유 시 데스크 업로드 (receipt_type='receipt')
 * 2) KOH 균검사   — 원장님 공유 시 데스크 업로드 (prescriptions 테이블 재용)
 * 3) 진료비 영수증 — 데스크에서 금액 등록 + 파일 업로드 (receipt_type='detail')
 */

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { FileText, Plus, Upload, Trash2, Printer, FlaskConical, Receipt } from 'lucide-react';
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
import { formatAmount, parseAmount } from '@/lib/format';
import type { CheckIn } from '@/lib/types';

// ─── 타입 ───

interface ProgressDoc {
  id: string;
  receipt_no: string | null;
  issue_date: string;
  pdf_url: string | null;
  memo: string | null;
  created_at: string;
}

interface KohDoc {
  id: string;
  memo: string | null;
  prescribed_at: string;
  pdf_url: string | null;
}

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

interface Props {
  checkIn: CheckIn;
  onUpdated: () => void;
}

// ─── 메인 컴포넌트 ───

export function InsuranceDocPanel({ checkIn, onUpdated }: Props) {
  const [progressDocs, setProgressDocs] = useState<ProgressDoc[]>([]);
  const [kohDocs, setKohDocs] = useState<KohDoc[]>([]);
  const [invoiceDocs, setInvoiceDocs] = useState<InvoiceDoc[]>([]);

  // 다이얼로그 상태
  const [progressOpen, setProgressOpen] = useState(false);
  const [kohOpen, setKohOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  const load = useCallback(async () => {
    const [recRes, rxRes] = await Promise.all([
      supabase
        .from('insurance_receipts')
        .select('id, receipt_type, receipt_no, issue_date, total_amount, paid_amount, insurance_covered, non_covered, pdf_url, created_at')
        .eq('check_in_id', checkIn.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('prescriptions')
        .select('id, memo, prescribed_at, pdf_url:diagnosis')
        .eq('check_in_id', checkIn.id)
        .order('created_at', { ascending: false }),
    ]);

    const allReceipts = (recRes.data ?? []) as Array<{
      id: string; receipt_type: string; receipt_no: string | null;
      issue_date: string; total_amount: number; paid_amount: number;
      insurance_covered: number; non_covered: number; pdf_url: string | null; created_at: string;
    }>;

    setProgressDocs(
      allReceipts
        .filter((r) => r.receipt_type === 'receipt')
        .map((r) => ({
          id: r.id,
          receipt_no: r.receipt_no,
          issue_date: r.issue_date,
          pdf_url: r.pdf_url,
          memo: null,
          created_at: r.created_at,
        })),
    );
    setInvoiceDocs(
      allReceipts
        .filter((r) => r.receipt_type === 'detail')
        .map((r) => ({
          id: r.id, receipt_no: r.receipt_no, issue_date: r.issue_date,
          total_amount: r.total_amount, paid_amount: r.paid_amount,
          insurance_covered: r.insurance_covered, non_covered: r.non_covered,
          pdf_url: r.pdf_url, created_at: r.created_at,
        })),
    );

    // prescriptions 테이블을 KOH 균검사 업로드로 재용
    const kohRaw = (rxRes.data ?? []) as Array<{
      id: string; memo: string | null; prescribed_at: string; pdf_url: string | null;
    }>;
    setKohDocs(kohRaw.map((r) => ({
      id: r.id,
      memo: r.memo,
      prescribed_at: r.prescribed_at,
      pdf_url: r.pdf_url,
    })));
  }, [checkIn.id]);

  useEffect(() => { load(); }, [load]);

  // ── 삭제 ──
  const deleteProgress = async (id: string) => {
    if (!window.confirm('경과분析지를 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('insurance_receipts').delete().eq('id', id);
    if (error) { toast.error('삭제 실패'); return; }
    toast.success('삭제됨'); load();
  };

  const deleteKoh = async (id: string) => {
    if (!window.confirm('KOH 균검사 파일을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('prescriptions').delete().eq('id', id);
    if (error) { toast.error('삭제 실패'); return; }
    toast.success('삭제됨'); load();
  };

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

  return (
    <div className="space-y-4">

      {/* ── 1. 경과분析지 ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
              <FileText className="h-3 w-3" /> 경과분析지
            </span>
            <p className="text-[11px] text-muted-foreground mt-0.5">원장님 공유 시 데스크에서 업로드</p>
          </div>
          <Button variant="outline" className="gap-1 text-xs" onClick={() => setProgressOpen(true)}>
            <Plus className="h-3 w-3" /> 업로드
          </Button>
        </div>
        {progressDocs.length > 0 ? (
          <div className="space-y-1.5">
            {progressDocs.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs group">
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                  <div>
                    <div className="font-medium text-foreground">경과분析지</div>
                    <div className="text-muted-foreground">
                      {format(new Date(doc.issue_date), 'yyyy-MM-dd')}
                      {doc.pdf_url && (
                        <a href={doc.pdf_url} target="_blank" rel="noreferrer"
                          className="ml-2 text-teal-600 underline">파일 보기</a>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => deleteProgress(doc.id)}
                  className="hidden group-hover:flex h-8 w-8 items-center justify-center rounded text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed py-3 text-center text-xs text-muted-foreground">
            등록된 경과분析지 없음
          </div>
        )}
      </div>

      {/* ── 2. KOH 균검사 ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
              <FlaskConical className="h-3 w-3" /> KOH 균검사
            </span>
            <p className="text-[11px] text-muted-foreground mt-0.5">원장님 공유 시 데스크에서 업로드</p>
          </div>
          <Button variant="outline" className="gap-1 text-xs" onClick={() => setKohOpen(true)}>
            <Plus className="h-3 w-3" /> 업로드
          </Button>
        </div>
        {kohDocs.length > 0 ? (
          <div className="space-y-1.5">
            {kohDocs.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs group">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                  <div>
                    <div className="font-medium text-foreground">KOH 균검사</div>
                    <div className="text-muted-foreground">
                      {format(new Date(doc.prescribed_at), 'yyyy-MM-dd')}
                      {doc.memo && <span className="ml-2">{doc.memo}</span>}
                      {doc.pdf_url && (
                        <a href={doc.pdf_url} target="_blank" rel="noreferrer"
                          className="ml-2 text-purple-600 underline">파일 보기</a>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => deleteKoh(doc.id)}
                  className="hidden group-hover:flex h-8 w-8 items-center justify-center rounded text-red-500 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed py-3 text-center text-xs text-muted-foreground">
            등록된 KOH 균검사 없음
          </div>
        )}
      </div>

      {/* ── 3. 진료비 영수증 ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
              <Receipt className="h-3 w-3" /> 진료비 영수증
            </span>
            <p className="text-[11px] text-muted-foreground mt-0.5">데스크에서 진료비 등록</p>
          </div>
          <Button variant="outline" className="gap-1 text-xs" onClick={() => setInvoiceOpen(true)}>
            <Plus className="h-3 w-3" /> 등록
          </Button>
        </div>
        {invoiceDocs.length > 0 ? (
          <div className="space-y-1.5">
            {invoiceDocs.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs group">
                <div className="space-y-0.5 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">진료비 영수증</Badge>
                    {doc.receipt_no && <span className="text-muted-foreground">#{doc.receipt_no}</span>}
                    <span className="text-muted-foreground">{format(new Date(doc.issue_date), 'MM/dd')}</span>
                  </div>
                  <div className="flex gap-3 text-muted-foreground">
                    <span>급여 {formatAmount(doc.insurance_covered)}</span>
                    <span>비급여 {formatAmount(doc.non_covered)}</span>
                    <span className="font-semibold text-foreground">납부 {formatAmount(doc.paid_amount)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => printInvoice(doc)}
                    className="h-8 w-8 hidden group-hover:flex items-center justify-center rounded text-teal-600 hover:bg-teal-50"
                    title="영수증 출력"
                  >
                    <Printer className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => deleteInvoice(doc.id)}
                    className="h-8 w-8 hidden group-hover:flex items-center justify-center rounded text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed py-3 text-center text-xs text-muted-foreground">
            등록된 진료비 영수증 없음
          </div>
        )}
      </div>

      {/* ── 다이얼로그 ── */}
      <ProgressUploadDialog
        checkIn={checkIn}
        open={progressOpen}
        onOpenChange={setProgressOpen}
        onSaved={() => { setProgressOpen(false); load(); onUpdated(); }}
      />
      <KohUploadDialog
        checkIn={checkIn}
        open={kohOpen}
        onOpenChange={setKohOpen}
        onSaved={() => { setKohOpen(false); load(); onUpdated(); }}
      />
      <InvoiceDialog
        checkIn={checkIn}
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        onSaved={() => { setInvoiceOpen(false); load(); onUpdated(); }}
      />
    </div>
  );
}

// ─── 경과분析지 업로드 다이얼로그 ───

function ProgressUploadDialog({
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
  const [file, setFile] = useState<File | null>(null);
  const [memo, setMemo] = useState('');

  useEffect(() => {
    if (open) { setFile(null); setMemo(''); }
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    let pdfUrl: string | null = null;

    if (file) {
      const path = `receipts/${checkIn.id}/progress_${Date.now()}_${file.name}`;
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
      receipt_type: 'receipt',
      receipt_no: memo.trim() || null,
      consult_amount: 0,
      treatment_amount: 0,
      insurance_covered: 0,
      non_covered: 0,
      total_amount: 0,
      paid_amount: 0,
      pdf_url: pdfUrl,
      issue_date: today,
    });

    setSaving(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success('경과분析지 등록 완료');
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-teal-600" /> 경과분析지 업로드
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          원장님이 공유한 파일을 업로드하세요
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">파일 (PDF / 이미지)</Label>
            <label className="cursor-pointer block mt-1">
              <input
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button variant="outline" size="sm" className="w-full gap-1 text-xs pointer-events-none">
                <Upload className="h-3 w-3" />
                {file ? file.name : '파일 선택'}
              </Button>
            </label>
          </div>
          <div>
            <Label className="text-xs">메모 (선택)</Label>
            <Input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="참고사항 입력"
              className="text-sm mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSave} disabled={saving || (!file)}>
            {saving ? '저장 중…' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── KOH 균검사 업로드 다이얼로그 ───

function KohUploadDialog({
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
  const [file, setFile] = useState<File | null>(null);
  const [memo, setMemo] = useState('');

  useEffect(() => {
    if (open) { setFile(null); setMemo(''); }
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    let fileUrl: string | null = null;

    if (file) {
      const path = `receipts/${checkIn.id}/koh_${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(path, file, { contentType: file.type });
      if (upErr) {
        toast.error(`파일 업로드 실패: ${upErr.message}`);
        setSaving(false);
        return;
      }
      const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600 * 24 * 365);
      fileUrl = data?.signedUrl ?? path;
    }

    // prescriptions 테이블을 KOH 균검사 기록 용도로 재용
    // diagnosis 컬럼에 pdf_url 임시 저장 (기존 컬럼 재용)
    const { error } = await supabase.from('prescriptions').insert({
      clinic_id: checkIn.clinic_id,
      check_in_id: checkIn.id,
      customer_id: checkIn.customer_id,
      prescribed_by_name: 'KOH 균검사',
      diagnosis: fileUrl,  // pdf_url 대신 diagnosis 재용
      memo: memo.trim() || null,
    });

    setSaving(false);
    if (error) { toast.error(`저장 실패: ${error.message}`); return; }
    toast.success('KOH 균검사 파일 등록 완료');
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-purple-600" /> KOH 균검사 업로드
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          원장님이 공유한 균검사 결과 파일을 업로드하세요
        </p>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">파일 (PDF / 이미지)</Label>
            <label className="cursor-pointer block mt-1">
              <input
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button variant="outline" size="sm" className="w-full gap-1 text-xs pointer-events-none">
                <Upload className="h-3 w-3" />
                {file ? file.name : '파일 선택'}
              </Button>
            </label>
          </div>
          <div>
            <Label className="text-xs">메모 (선택)</Label>
            <Textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="검사 결과 요약 또는 참고사항"
              rows={2}
              className="text-sm mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
          <Button onClick={handleSave} disabled={saving || (!file)}>
            {saving ? '저장 중…' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 진료비 영수증 등록 다이얼로그 ───

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
