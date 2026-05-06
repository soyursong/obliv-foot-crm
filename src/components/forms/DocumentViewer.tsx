/**
 * DocumentViewer — 고객별 업로드 양식/서명 조회 패널
 *
 * T-20260506-foot-CHECKLIST-AUTOUPLOAD.
 *
 * Storage 'documents' 버킷의 customer/{customerId}/ 경로 파일 목록 표시.
 * - 양식 JSON: 새 창 미리보기 (signedUrl)
 * - 서명 PNG / PDF: 썸네일 + 다운로드
 * - 파일명 prefix로 종류 구분 (checklist / consent_refund / signature_*)
 *
 * 1번차트(CheckInDetailSheet) + 2번차트(CustomerChartPage) 공통 사용.
 */
import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Download, Eye, FileText, Image as ImageIcon, ClipboardCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface FileEntry {
  name: string;
  path: string;
  signedUrl: string;
  size: number;
  uploadedAt: string;
  prefix: string;
  ext: string;
}

interface Props {
  customerId: string;
  /** true면 컴팩트 모드 (1번차트용) */
  compact?: boolean;
}

const PREFIX_META: Record<string, { label: string; color: string; icon: 'check' | 'file' | 'image' }> = {
  checklist: { label: '체크리스트', color: 'bg-teal-50 text-teal-700 border-teal-200', icon: 'check' },
  consent_refund: { label: '환불·비급여동의서', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'file' },
  signature_checklist: { label: '체크리스트 서명', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: 'image' },
  signature_consent: { label: '동의서 서명', color: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: 'image' },
};

function parseEntry(name: string): { prefix: string; ext: string; ts: number | null } {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1) : '';
  const base = dot >= 0 ? name.slice(0, dot) : name;
  // {prefix}_{timestamp} 패턴 — 마지막 _ 이후 숫자열을 ts로 인식
  const lastUnder = base.lastIndexOf('_');
  if (lastUnder < 0) return { prefix: base, ext, ts: null };
  const tail = base.slice(lastUnder + 1);
  const tsNum = /^\d+$/.test(tail) ? Number(tail) : null;
  const prefix = tsNum ? base.slice(0, lastUnder) : base;
  return { prefix, ext, ts: tsNum };
}

function bytesToKb(b: number) {
  if (!b) return '-';
  if (b < 1024) return `${b} B`;
  return `${Math.round(b / 1024)} KB`;
}

export function DocumentViewer({ customerId, compact = false }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const folder = `customer/${customerId}`;
    const { data: list, error } = await supabase.storage
      .from('documents')
      .list(folder, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });

    if (error) {
      toast.error(`파일 조회 실패: ${error.message}`);
      setFiles([]);
      setLoading(false);
      return;
    }

    const validFiles = (list ?? []).filter((f) => f.name && !f.name.endsWith('/'));
    if (validFiles.length === 0) {
      setFiles([]);
      setLoading(false);
      return;
    }

    const withUrls = await Promise.all(
      validFiles.map(async (f) => {
        const path = `${folder}/${f.name}`;
        const { data: signed } = await supabase.storage
          .from('documents')
          .createSignedUrl(path, 3600);
        const { prefix, ext, ts } = parseEntry(f.name);
        const uploadedAt =
          ts && Number.isFinite(ts)
            ? new Date(ts).toISOString()
            : (f.created_at ?? new Date().toISOString());
        return {
          name: f.name,
          path,
          signedUrl: signed?.signedUrl ?? '',
          size: (f.metadata as { size?: number } | null)?.size ?? 0,
          uploadedAt,
          prefix,
          ext,
        } satisfies FileEntry;
      }),
    );

    setFiles(withUrls.filter((f) => f.signedUrl));
    setLoading(false);
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="rounded border border-dashed py-3 text-center text-xs text-muted-foreground">
        불러오는 중…
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="rounded border border-dashed py-3 text-center text-xs text-muted-foreground">
        업로드된 양식이 없습니다
      </div>
    );
  }

  // prefix별 그룹핑
  const grouped = files.reduce<Record<string, FileEntry[]>>((acc, f) => {
    (acc[f.prefix] ??= []).push(f);
    return acc;
  }, {});

  // 페어링: 양식 json 옆에 같은 시점 서명 png 매칭 (compact 모드)
  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">업로드된 양식 ({files.length})</span>
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={load}>
            <RefreshCw className="h-3 w-3" />
            새로고침
          </Button>
        </div>
        <div className="space-y-1">
          {files.map((f) => (
            <FileRow key={f.path} file={f} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">
          업로드된 양식·서명 ({files.length}건)
        </span>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={load}>
          <RefreshCw className="h-3 w-3" /> 새로고침
        </Button>
      </div>

      {Object.entries(grouped).map(([prefix, items]) => {
        const meta = PREFIX_META[prefix] ?? {
          label: prefix,
          color: 'bg-muted text-muted-foreground border-muted',
          icon: 'file' as const,
        };
        return (
          <div key={prefix} className="space-y-1.5">
            <div className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${meta.color}`}>
              {meta.icon === 'check' && <ClipboardCheck className="h-3 w-3" />}
              {meta.icon === 'file' && <FileText className="h-3 w-3" />}
              {meta.icon === 'image' && <ImageIcon className="h-3 w-3" />}
              {meta.label}
            </div>
            <div className="space-y-1">
              {items.map((f) => (
                <FileRow key={f.path} file={f} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FileRow({ file }: { file: FileEntry }) {
  const isImage = file.ext === 'png' || file.ext === 'jpg' || file.ext === 'jpeg';
  return (
    <div className="flex items-center justify-between rounded border bg-white px-2.5 py-1.5 text-xs hover:bg-muted/30">
      <div className="flex items-center gap-2 min-w-0">
        {isImage ? (
          <img
            src={file.signedUrl}
            alt={file.name}
            className="h-8 w-8 rounded object-cover border shrink-0"
          />
        ) : (
          <div className="h-8 w-8 shrink-0 rounded border bg-muted/40 flex items-center justify-center">
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate font-medium">{file.name}</div>
          <div className="text-muted-foreground tabular-nums">
            {format(new Date(file.uploadedAt), 'yyyy-MM-dd HH:mm')}
            <span className="ml-1.5">· {bytesToKb(file.size)}</span>
            <Badge variant="outline" className="ml-1.5 px-1 py-0 text-[9px] uppercase">
              {file.ext}
            </Badge>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          title="새 창에서 보기"
          onClick={() => window.open(file.signedUrl, '_blank')}
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          title="다운로드"
          onClick={() => {
            const a = document.createElement('a');
            a.href = file.signedUrl;
            a.download = file.name;
            a.click();
          }}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
