// PatientResultFiles — 환자 검사결과지 파일 업로드 + 목록/보기/다운로드/삭제 (인라인 본문)
// Ticket: T-20260623-foot-CHART2-KOH-BLOODRESULT-STYLE-UPLOAD
//   BloodResultDialog(혈액검사 결과지, T-20260622-...-BLOODTEST-RESULT-PUBLISH-BACKEND) 의 본문을
//   kind/prefix/accent/testid 로 일반화해 추출 → 혈액·KOH 양쪽이 동일 코드경로 재사용(중복 최소화).
//
// 동선(BloodResultDialog §동선 동형):
//   '업로드' → PDF/JPG/PNG 다중 선택 → documents 버킷 업로드(useDocumentUpload, prefix)
//            → patient_file_records insert (메타: 경로·종류(kind)·업로더). AC-1/AC-2.
//   '보기'   → patient_file_records(customer_id + kind) 목록 → 행별 signedUrl(1h) 열람/다운로드. read-after-write.
//
// 버킷·훅 재사용: 신규버킷 X. 기존 documents 버킷 + useDocumentUpload 1h signedURL 그대로.
// 방어성: patient_file_records 미적용 prod(42P01/42703) → 빈 목록 폴백(무파손).
// ext/mime 게이트: pdf/jpg/png 만 허용(FE 검증) — DB mime CHECK 와 정합.

import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Download, Eye, FileText, Image as ImageIcon, Upload, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useDocumentUpload } from '@/hooks/useDocumentUpload';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// FE 게이트 — DB mime CHECK(application/pdf, image/jpeg, image/png) 와 정합. ext 외 거부.
const ALLOWED_EXT = new Set(['pdf', 'jpg', 'jpeg', 'png']);
const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

export interface PfrRow {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  created_at: string;
}

// ext → useDocumentUpload 의 ext 타입 + 정규 mime. jpeg→jpg(훅), mime=image/jpeg.
function resolveExt(fileName: string): { ext: 'pdf' | 'png' | 'jpg'; mime: string } | null {
  const dot = fileName.lastIndexOf('.');
  const raw = (dot >= 0 ? fileName.slice(dot + 1) : '').toLowerCase();
  if (!ALLOWED_EXT.has(raw)) return null;
  if (raw === 'pdf') return { ext: 'pdf', mime: 'application/pdf' };
  if (raw === 'png') return { ext: 'png', mime: 'image/png' };
  return { ext: 'jpg', mime: 'image/jpeg' }; // jpg | jpeg
}

function bytesToKb(b: number | null) {
  if (!b) return '-';
  if (b < 1024) return `${b} B`;
  return `${Math.round(b / 1024)} KB`;
}

// T-20260624-foot-CHART2-SAVEBTN-COMPACT-KOH-TONE (AC2): 'slate' 추가 — 쿨그레이 모노톤.
//   rose/emerald(결과유형 색구분)는 보존. KOH 호출부만 accent='slate'로 교체해 모노톤 정합.
type Accent = 'rose' | 'emerald' | 'slate';

const ACCENT_MAP: Record<Accent, { box: string; btn: string }> = {
  rose: {
    box: 'border-rose-200 bg-rose-50/50',
    btn: 'bg-rose-600 text-white hover:bg-rose-700',
  },
  emerald: {
    box: 'border-emerald-200 bg-emerald-50/50',
    btn: 'bg-emerald-600 text-white hover:bg-emerald-700',
  },
  slate: {
    box: 'border-slate-200 bg-slate-50/60',
    btn: 'bg-slate-600 text-white hover:bg-slate-700',
  },
};

interface Props {
  customerId: string;
  /** patient_file_records.kind 분기 (예: 'blood_result' | 'koh_result') */
  kind: string;
  /** Storage 파일명 prefix (예: 'blood_result' | 'koh_result') */
  prefix: string;
  /** 결과지 명칭 — 토스트·삭제 확인 문구에 사용 (예: '혈액검사 결과지') */
  noun: string;
  /** 업로드 버튼 색상 테마 */
  accent?: Accent;
  /** data-testid 접두 (예: 'blood-result' | 'koh-result') */
  testidPrefix: string;
  /** 업로드 후 부모에 알림(라벨/카운트 갱신용) */
  onChanged?: () => void;
}

export default function PatientResultFiles({
  customerId,
  kind,
  prefix,
  noun,
  accent = 'rose',
  testidPrefix,
  onChanged,
}: Props) {
  const clinic = useClinic();
  const { uploadMany, uploading } = useDocumentUpload();
  const [rows, setRows] = useState<PfrRow[]>([]);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const ac = ACCENT_MAP[accent];

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('patient_file_records')
      .select('id, file_name, file_path, file_size, mime_type, uploaded_by, created_at')
      .eq('customer_id', customerId)
      .eq('kind', kind)
      .order('created_at', { ascending: false });
    if (error) {
      // ADDITIVE 테이블 미적용 prod(42P01/42703) → 빈 목록 폴백(무파손).
      if (/patient_file_records|relation|42P01|42703/.test(error.message ?? '')) {
        setRows([]);
      } else {
        toast.error(`결과지 조회 실패: ${error.message}`);
        setRows([]);
      }
      setLoading(false);
      return;
    }
    setRows((data ?? []) as PfrRow[]);
    setLoading(false);
  }, [customerId, kind]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePick = () => fileRef.current?.click();

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    if (!clinic?.id) {
      toast.error('클리닉 정보를 불러오지 못했습니다.');
      return;
    }
    const files = Array.from(fileList);

    // FE ext 게이트 — 허용 외 1개라도 있으면 전체 중단(부분 업로드 방지).
    const resolved = files.map((f) => ({ file: f, meta: resolveExt(f.name) }));
    const bad = resolved.filter((r) => !r.meta);
    if (bad.length > 0) {
      toast.error(`허용되지 않는 형식: ${bad.map((b) => b.file.name).join(', ')} (PDF·JPG·PNG만 가능)`);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    // 1) documents 버킷 업로드(다중) — 실패 즉시 중단(uploadMany 계약).
    const uploaded = await uploadMany(
      resolved.map((r) => ({
        customerId,
        prefix,
        body: r.file,
        ext: r.meta!.ext,
        contentType: r.meta!.mime,
      })),
    );

    if (uploaded.length === 0) {
      toast.error('업로드에 실패했습니다.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    // 2) patient_file_records 메타 적재 — 업로드 성공분만큼.
    const { data: { user } } = await supabase.auth.getUser();
    const metaRows = uploaded.map((u, i) => ({
      clinic_id: clinic.id,
      customer_id: customerId,
      file_name: resolved[i].file.name,
      file_path: u.path,
      file_size: resolved[i].file.size,
      mime_type: resolved[i].meta!.mime,
      kind,
      uploaded_by: user?.id ?? null,
    }));
    const { error: insErr } = await supabase.from('patient_file_records').insert(metaRows);
    if (insErr) {
      toast.error(`결과지 정보 저장 실패: ${insErr.message}`);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    toast.success(`${noun} ${uploaded.length}건 업로드 완료`);
    if (fileRef.current) fileRef.current.value = '';
    await load(); // read-after-write
    onChanged?.();
  };

  // 열람/다운로드 — 저장 경로로 on-demand signedUrl(1h) 발급.
  const openSigned = async (path: string, download = false, fileName?: string) => {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) {
      toast.error(`파일을 열 수 없습니다: ${error?.message ?? '경로 없음'}`);
      return;
    }
    if (download) {
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = fileName ?? prefix;
      a.click();
    } else {
      window.open(data.signedUrl, '_blank');
    }
  };

  const handleDelete = async (row: PfrRow) => {
    if (!window.confirm(`'${row.file_name}' 결과지를 삭제할까요? (본인이 올린 파일만 삭제됩니다)`)) return;
    const { error } = await supabase.from('patient_file_records').delete().eq('id', row.id);
    if (error) {
      toast.error(`삭제 실패: ${error.message}`);
      return;
    }
    toast.success('결과지를 삭제했습니다.');
    await load();
    onChanged?.();
  };

  const isImage = (r: PfrRow) =>
    r.mime_type === 'image/jpeg' || r.mime_type === 'image/png' || /\.(jpe?g|png)$/i.test(r.file_name);

  return (
    <div className="space-y-2" data-testid={`${testidPrefix}-files`}>
      {/* 업로드 */}
      <div className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${ac.box}`}>
        <span className="text-xs text-muted-foreground">결과지 파일 (다중 선택 가능 · PDF·JPG·PNG)</span>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          data-testid={`${testidPrefix}-file-input`}
          onChange={handleFiles}
        />
        <Button
          size="sm"
          className={`h-8 gap-1 ${ac.btn}`}
          data-testid={`${testidPrefix}-upload-btn`}
          disabled={uploading}
          onClick={handlePick}
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? '업로드 중…' : '결과지 업로드'}
        </Button>
      </div>

      {/* 목록 */}
      <div className="max-h-[50vh] space-y-1.5 overflow-y-auto" data-testid={`${testidPrefix}-list`}>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div
            className="rounded border border-dashed py-6 text-center text-xs text-muted-foreground"
            data-testid={`${testidPrefix}-empty`}
          >
            등록된 결과지가 없습니다.
          </div>
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded border bg-white px-2.5 py-1.5 text-xs hover:bg-muted/30"
              data-testid={`${testidPrefix}-row`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border bg-muted/40">
                  {isImage(r) ? (
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.file_name}</div>
                  <div className="tabular-nums text-muted-foreground">
                    {format(new Date(r.created_at), 'yyyy-MM-dd HH:mm')}
                    <span className="ml-1.5">· {bytesToKb(r.file_size)}</span>
                    <Badge variant="outline" className="ml-1.5 px-1 py-0 text-[9px] uppercase">
                      {(r.file_name.split('.').pop() ?? '').toUpperCase()}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  title="새 창에서 보기"
                  data-testid={`${testidPrefix}-view`}
                  onClick={() => openSigned(r.file_path, false)}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  title="다운로드"
                  data-testid={`${testidPrefix}-download`}
                  onClick={() => openSigned(r.file_path, true, r.file_name)}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                  title="삭제 (본인 업로드분)"
                  data-testid={`${testidPrefix}-delete`}
                  onClick={() => handleDelete(r)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
