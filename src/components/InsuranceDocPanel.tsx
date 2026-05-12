/**
 * InsuranceDocPanel — 풋센터 서류 업로드 패널
 *
 * T-20260506-foot-CHART-SIMPLE-REVAMP: 5/4 22:04 요청 반영
 * T-20260510-foot-C21-IMG-PROGRESS: 경과내역 사진 (2번차트 연동) 섹션 추가
 * T-20260509-foot-CHART1-LAYOUT-REAPPLY: 경과분석지 전폭, 진료비 영수증 → DocumentPrintPanel 이동
 *
 * 섹션 구성:
 * 1) 경과분석지   — 원장님 공유 시 데스크 업로드 (receipt_type='receipt') [전폭]
 * 2) KOH 균검사   — 원장님 공유 시 데스크 업로드 (prescriptions 테이블 재용)
 * 3) 경과내역 사진 — 2번차트 경과내역 탭에서 업로드된 사진 조회 (Storage 연동)
 */

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { FileText, Plus, Upload, Trash2, FlaskConical, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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

interface Props {
  checkIn: CheckIn;
  onUpdated: () => void;
}

// ─── 메인 컴포넌트 ───

// T-20260510-foot-C21-IMG-PROGRESS: 경과내역 사진 스토리지 아이템
interface ProgressPhotoItem {
  path: string;
  signedUrl: string;
  name: string;
}

export function InsuranceDocPanel({ checkIn, onUpdated }: Props) {
  const [progressDocs, setProgressDocs] = useState<ProgressDoc[]>([]);
  const [kohDocs, setKohDocs] = useState<KohDoc[]>([]);
  // T-20260510-foot-C21-IMG-PROGRESS: 2번차트 경과내역 사진 (customer Storage 연동)
  const [progressPhotos, setProgressPhotos] = useState<ProgressPhotoItem[]>([]);

  // 다이얼로그 상태
  const [progressOpen, setProgressOpen] = useState(false);
  const [kohOpen, setKohOpen] = useState(false);

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

  // T-20260510-foot-C21-IMG-PROGRESS: 경과내역 사진 로드 (2번차트 Storage 연동)
  const loadProgressPhotos = useCallback(async () => {
    if (!checkIn.customer_id) return;
    const storagePath = `customer/${checkIn.customer_id}/progress`;
    const { data: files } = await supabase.storage.from('photos').list(storagePath, {
      limit: 50,
      sortBy: { column: 'name', order: 'desc' },
    });
    if (!files || files.length === 0) { setProgressPhotos([]); return; }
    const withUrls = await Promise.all(
      files
        .filter((f) => f.name && !f.id?.endsWith('/'))
        .map(async (file) => {
          const path = `${storagePath}/${file.name}`;
          const { data } = await supabase.storage.from('photos').createSignedUrl(path, 3600);
          return { path, signedUrl: data?.signedUrl ?? '', name: file.name };
        }),
    );
    setProgressPhotos(withUrls.filter((i) => i.signedUrl));
  }, [checkIn.customer_id]);

  useEffect(() => { loadProgressPhotos(); }, [loadProgressPhotos]);

  // ── 삭제 ──
  const deleteProgress = async (id: string) => {
    if (!window.confirm('경과분석지를 삭제하시겠습니까?')) return;
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

  return (
    <div className="space-y-4">

      {/* ── 1. 경과분석지 (전폭) — T-20260509-foot-CHART1-LAYOUT-REAPPLY ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-muted-foreground flex items-center gap-1">
              <FileText className="h-3 w-3" /> 경과분석지
            </span>
            <p className="text-[11px] text-muted-foreground mt-0.5">원장님 공유 시 업로드</p>
          </div>
          <Button variant="outline" className="gap-1 text-xs" onClick={() => setProgressOpen(true)}>
            <Plus className="h-3 w-3" /> 업로드
          </Button>
        </div>
        {progressDocs.length > 0 ? (
          <div className="space-y-1.5">
            {progressDocs.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs group">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium">경과분석지</div>
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
                  className="hidden group-hover:flex h-8 w-8 items-center justify-center rounded text-red-500 hover:bg-red-50 shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed py-3 text-center text-xs text-muted-foreground">
            등록된 경과분석지 없음
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

      {/* ── T-20260510-foot-C21-IMG-PROGRESS: 경과내역 사진 (2번차트 연동) ── */}
      {checkIn.customer_id && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <ImageIcon className="h-3.5 w-3.5 text-teal-600" />
            <span className="text-sm font-semibold text-muted-foreground">경과내역 사진</span>
            <span className="text-[10px] text-muted-foreground bg-teal-50 border border-teal-200 rounded px-1">2번차트 연동</span>
          </div>
          {progressPhotos.length > 0 ? (
            <div className="grid grid-cols-3 gap-1.5">
              {progressPhotos.map((img) => (
                <div key={img.path} className="relative aspect-square">
                  <img
                    src={img.signedUrl}
                    alt={img.name}
                    className="w-full h-full object-cover rounded-lg border cursor-pointer"
                    onClick={() => window.open(img.signedUrl, '_blank')}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed py-2.5 text-center text-[11px] text-muted-foreground">
              경과 사진 없음 (2번차트 경과내역 탭에서 업로드)
            </div>
          )}
        </div>
      )}

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
    </div>
  );
}

// ─── 경과분석지 업로드 다이얼로그 ───

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
    toast.success('경과분석지 등록 완료');
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-teal-600" /> 경과분석지 업로드
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

