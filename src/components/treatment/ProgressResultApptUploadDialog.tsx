// ProgressResultApptUploadDialog — 경과분석 [결과 업로드] → 파일명 파싱 → 예약(appointment) 1:1 링킹
// Ticket: T-20260822-foot-PROGANALYSIS-RESULT-UPLOAD-LINK (reporter 문지은 대표원장, P1 급건)
//
// 동선(AC/시나리오):
//   ① 이미지 여러 장 or ZIP 드래그앤드롭(AC-1). ZIP 자동해제(unzipImages, 무의존).
//   ② 파일명 6-토큰 계약 파싱(AC-2/AC-6, progressResultFilename SSOT) — 차트+회차+날짜 3조합.
//   ③ progress_analysis_slips 후보 조회 → resolveApptMatch(fail-closed): 정확히 1건·미연결만 matched.
//      실패(파싱오류·불일치·중복) = 빨강 '원장 확인 대기' 보류(AC-3, 임의 연결 절대 금지).
//   ④ '적용' → matched 만 storage 업로드 + progress_result_images insert(slip_id 결속) + 슬립 [업로드대기] 전이.
//   ⑤ 완료 보고(AC-4): "총 N장 중 연결 M / 실패 K" + 실패목록(파일명·사유).
//
// PHI 가드: 버킷 private + RLS admin/manager. 호출부 게이트(canExtractProgress)에서만 노출.
// AC-5(노쇼 소프트삭제)=별도 §6 마이그(DB gate) — 본 다이얼로그 범위 밖.

import { useCallback, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Upload, Loader2, CheckCircle2, XCircle, FileImage, AlertTriangle } from 'lucide-react';
import {
  parseProgressResultFilename, RESULT_IMG_EXT, resultFileExt, type ParsedResultFilename,
} from '@/lib/progressResultFilename';
import {
  resolveApptMatch, fetchCandidateSlips, type ApptMatchStatus,
} from '@/lib/progressResultApptMatch';
import { unzipImages, isZipFile } from '@/lib/progressResultUnzip';
import { sha256Hex, logProgressResultAttach } from '@/lib/progressResultMatch';
import { SLIP_STATE } from '@/lib/progressSlips';

interface RowState {
  key: string;
  fileName: string;
  blob: Blob;
  parsed: ParsedResultFilename;
  status: ApptMatchStatus;
  slipId: string | null;
  reservationId: string | null;
  customerId: string | null;
  detail: string;
  contentHash: string | null;
  applied?: 'done' | 'error';
  applyMsg?: string;
}

const STATUS_META: Record<ApptMatchStatus, { label: string; cls: string; ok: boolean }> = {
  matched:    { label: '연결가능',        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', ok: true },
  parse_fail: { label: '파일명 오류·원장확인대기', cls: 'bg-rose-50 text-rose-700 border-rose-200', ok: false },
  no_match:   { label: '일치예약 없음·원장확인대기', cls: 'bg-rose-50 text-rose-700 border-rose-200', ok: false },
  ambiguous:  { label: '후보중복·원장확인대기', cls: 'bg-rose-50 text-rose-700 border-rose-200', ok: false },
  duplicate:  { label: '이미연결·원장확인대기', cls: 'bg-rose-50 text-rose-700 border-rose-200', ok: false },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}

export default function ProgressResultApptUploadDialog({ open, onOpenChange, onApplied }: Props) {
  const clinic = useClinic();
  const { profile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [report, setReport] = useState<{ total: number; linked: number; failed: number; fails: Array<{ name: string; reason: string }> } | null>(null);

  const reset = useCallback(() => {
    setRows([]); setReport(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = (v: boolean) => {
    if (!v && !applying) reset();
    onOpenChange(v);
  };

  // ── 파일(이미지+ZIP) → 이미지 파일 평탄화 ────────────────────────────
  const expandToImages = useCallback(async (files: File[]): Promise<Array<{ name: string; blob: Blob }>> => {
    const out: Array<{ name: string; blob: Blob }> = [];
    for (const f of files) {
      if (isZipFile(f)) {
        try {
          const inner = await unzipImages(f);
          out.push(...inner);
        } catch (e) {
          toast.error(`ZIP 해제 실패(${f.name}): ${(e as Error)?.message ?? ''}`);
        }
      } else if (RESULT_IMG_EXT.has(resultFileExt(f.name))) {
        out.push({ name: f.name, blob: f });
      }
      // 그 외 확장자 = 무시(계약 위반 표시는 파싱 단계에서).
    }
    return out;
  }, []);

  // ── 파일 수신 → 파싱 + 매칭 미리보기 ────────────────────────────────
  const handleFiles = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0) return;
      if (!clinic?.id) { toast.error('클리닉 정보를 불러오지 못했습니다.'); return; }
      setScanning(true);
      setReport(null);
      try {
        const imgs = await expandToImages(fileList);
        if (imgs.length === 0) { toast.warning('이미지(png/jpg) 또는 ZIP 안의 이미지가 없습니다.'); setScanning(false); return; }

        const base: RowState[] = [];
        for (let i = 0; i < imgs.length; i++) {
          const { name, blob } = imgs[i];
          const parsed = parseProgressResultFilename(name);
          let contentHash: string | null = null;
          try { contentHash = await sha256Hex(await blob.arrayBuffer()); } catch { contentHash = null; }
          base.push({
            key: `${i}__${name}`, fileName: name, blob, parsed,
            status: 'parse_fail', slipId: null, reservationId: null, customerId: null,
            detail: parsed.reason ?? '', contentHash,
          });
        }

        // 후보 슬립 배치 조회 → 결정적 해석(fail-closed).
        const slipsByKey = await fetchCandidateSlips(supabase, clinic.id, base.map((r) => r.parsed));
        const resolved = base.map((r): RowState => {
          const res = resolveApptMatch(r.parsed, slipsByKey);
          return { ...r, status: res.status, slipId: res.slipId, reservationId: res.reservationId, customerId: res.customerId, detail: res.detail };
        });
        setRows(resolved);
      } catch (e) {
        toast.error(`미리보기 생성 실패: ${(e as Error)?.message ?? '알 수 없는 오류'}`);
      } finally {
        setScanning(false);
      }
    },
    [clinic?.id, expandToImages],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    void handleFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const matchedRows = useMemo(() => rows.filter((r) => r.status === 'matched' && r.contentHash), [rows]);
  const heldCount = rows.length - rows.filter((r) => r.status === 'matched').length;

  // ── 적용: matched 만 업로드+링킹 ───────────────────────────────────
  const handleApply = async () => {
    if (!clinic?.id || matchedRows.length === 0) {
      toast.warning('연결 가능한(matched) 파일이 없습니다. 실패 건은 원장 확인 후 처리됩니다.');
      return;
    }
    setApplying(true);
    const nextRows = [...rows];
    let linked = 0, failed = 0;
    try {
      for (const r of matchedRows) {
        const idx = nextRows.findIndex((x) => x.key === r.key);
        try {
          const hash = r.contentHash as string;
          const visitDate = r.parsed.visitDate as string;
          const ext = resultFileExt(r.fileName) || 'png';
          const path = `${clinic.id}/${r.customerId}/${visitDate}_${hash.slice(0, 16)}.${ext}`;

          const { error: upErr } = await supabase.storage
            .from('progress-results')
            .upload(path, r.blob, { contentType: r.blob.type || 'image/png', upsert: true });
          if (upErr) throw upErr;

          const { error: insErr } = await supabase
            .from('progress_result_images')
            .upsert({
              clinic_id: clinic.id,
              customer_id: r.customerId,
              chart_no: r.parsed.chartNo,
              visit_date: visitDate,
              image_url: path,
              file_name: r.fileName,
              content_hash: hash,
              matched_by: 'auto',
              match_status: 'auto',
              uploaded_by: profile?.id ?? null,
              slip_id: r.slipId,
            }, { onConflict: 'clinic_id,chart_no,visit_date,content_hash', ignoreDuplicates: false })
            .select('id');
          if (insErr) throw insErr;

          // 슬립 [추출대상] → [업로드대기] 전이(낙관적 가드).
          if (r.slipId) {
            await supabase
              .from('progress_analysis_slips')
              .update({ state: SLIP_STATE.AWAITING_UPLOAD })
              .eq('id', r.slipId)
              .eq('state', SLIP_STATE.PENDING_EXTRACT);
          }

          logProgressResultAttach({
            actor: profile?.email ?? profile?.id ?? null,
            actorRole: profile?.role ?? null,
            clinicId: clinic.id,
            fileName: r.fileName,
            chartNo: r.parsed.chartNo,
            visitDate,
            contentHash: hash,
            matchedBy: 'auto',
            matchStatus: 'auto',
            customerId: r.customerId,
          });

          linked++;
          if (idx >= 0) nextRows[idx] = { ...nextRows[idx], applied: 'done', applyMsg: '예약 경과지 연결됨' };
        } catch (e) {
          failed++;
          if (idx >= 0) nextRows[idx] = { ...nextRows[idx], applied: 'error', applyMsg: (e as Error)?.message ?? '실패' };
        }
      }
      setRows(nextRows);

      // AC-4 완료 보고: 총 N장 중 연결 M / 실패 K + 실패목록(파일명·사유).
      const fails = nextRows
        .filter((r) => r.status !== 'matched' || r.applied === 'error')
        .map((r) => ({ name: r.fileName, reason: r.applied === 'error' ? (r.applyMsg ?? '적용 실패') : r.detail }));
      setReport({ total: rows.length, linked, failed: fails.length, fails });
      if (fails.length === 0) toast.confirm(`총 ${rows.length}장 전건 정상 연결`);
      else toast.warning(`총 ${rows.length}장 중 연결 ${linked} / 실패 ${fails.length}`);
      onApplied?.();
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl" data-testid="progress-result-appt-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileImage className="h-5 w-5 text-teal-600" />
            경과분석 결과 업로드 (예약 자동 연결)
          </DialogTitle>
          <DialogDescription>
            파일명 <b>경과분석_이름_차트번호_예정_N회차_YYMMDD</b> (예: 경과분석_홍길동_1234_예정_6회차_260822.png)
            형식의 결과 이미지(여러 장) 또는 ZIP을 올리면 <b>차트번호+회차+날짜</b>로 예약을 찾아 1:1로 연결합니다.
            매칭이 안 되면 <b className="text-rose-600">원장 확인 대기</b>로 보류합니다(임의 연결 안 함).
          </DialogDescription>
        </DialogHeader>

        {/* 드래그앤드롭 (AC-1) */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm transition-colors ${dragOver ? 'border-teal-400 bg-teal-50' : 'border-neutral-300 bg-neutral-50'}`}
          data-testid="progress-result-appt-dropzone"
        >
          <Upload className="h-6 w-6 text-teal-500" />
          <p className="text-muted-foreground">이미지(PNG 여러 장) 또는 ZIP을 이곳에 끌어다 놓으세요.</p>
          <input
            ref={fileInputRef} type="file" multiple className="hidden"
            accept=".png,.jpg,.jpeg,.webp,.zip,image/*,application/zip"
            data-testid="progress-result-appt-input"
            onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))}
          />
          <Button type="button" size="sm" variant="outline" disabled={scanning || applying}
            onClick={() => fileInputRef.current?.click()} data-testid="progress-result-appt-pick-btn">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} 파일 선택
          </Button>
        </div>

        {rows.length > 0 && (
          <div className="mt-1 flex items-center gap-2 text-xs" data-testid="progress-result-appt-summary">
            <span>총 {rows.length}장</span>
            <span className="text-emerald-600">· 연결가능 {matchedRows.length}</span>
            {heldCount > 0 && <span className="text-rose-600">· 원장 확인 대기 {heldCount}</span>}
          </div>
        )}

        {/* 미리보기 테이블 */}
        {rows.length > 0 && (
          <div className="mt-2 max-h-[42vh] overflow-auto rounded-lg border" data-testid="progress-result-appt-preview">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">파일명</th>
                  <th className="px-2 py-1.5 text-left font-medium">상태</th>
                  <th className="px-2 py-1.5 text-left font-medium">결과</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = STATUS_META[r.status];
                  return (
                    <tr key={r.key} className="border-t" data-testid="progress-result-appt-row" data-status={r.status}>
                      <td className="max-w-[240px] truncate px-2 py-1.5" title={r.fileName}>{r.fileName}</td>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className={`gap-1 ${meta.cls}`}>
                          {meta.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {r.applied === 'done' && <span className="text-emerald-600">✓ {r.applyMsg}</span>}
                        {r.applied === 'error' && <span className="text-rose-600">✕ {r.applyMsg}</span>}
                        {!r.applied && (r.detail || '-')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* AC-4 완료 보고 */}
        {report && (
          <div className="mt-2 rounded-lg border border-teal-200 bg-teal-50/60 p-3 text-xs" data-testid="progress-result-appt-report">
            <p className="font-medium text-teal-800">
              총 {report.total}장 중 연결 {report.linked}장 / 실패 {report.failed}장
              {report.failed === 0 && ' — 전건 정상 연결'}
            </p>
            {report.fails.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-rose-700">
                {report.fails.map((f, i) => (
                  <li key={i} className="flex gap-1"><XCircle className="mt-0.5 h-3 w-3 shrink-0" /><span className="truncate">{f.name}</span><span className="text-rose-500">— {f.reason}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="mt-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => handleClose(false)} disabled={applying}>닫기</Button>
          <Button type="button" size="sm" onClick={handleApply}
            disabled={applying || scanning || matchedRows.length === 0}
            data-testid="progress-result-appt-apply-btn">
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            적용 ({matchedRows.length}건 연결)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
