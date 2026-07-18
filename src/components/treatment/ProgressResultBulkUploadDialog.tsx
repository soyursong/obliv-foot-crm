// ProgressResultBulkUploadDialog — 경과분석 결과이미지 일괄업로드 → 환자 자동매칭·첨부
// Ticket: T-20260702-foot-PROGRESS-CSV-BULKRESULT (CEO 결정 B + DA GO/ADDITIVE)
// SSOT = DA-20260718-foot-PROGRESS-BULKRESULT-AUTOMATCH 계약
//   (_silver/2026-07-18/da_decision_foot_progress_bulkresult_automatch_contract_20260718.md).
//
// 동선(티켓 시나리오 2·3):
//   ① 이미지 여러 장(이름_차트번호_날짜.png) 선택 → 파일명 파싱 + content-hash(sha256) 산출
//   ② chart_no 단독조인(G1) customers 조회 + 이름 대조(G2) + 해당일 방문 조회 → 매칭 미리보기(G5 사람게이트 前)
//   ③ 파싱실패/미존재/이름불일치 = 수동 매칭 UI 폴백(G3·G4, fail-closed)
//   ④ '적용' 클릭(G5) → storage(progress-results, private) 업로드 + progress_result_images insert(멱등) + 감사로그(G6)
//
// PHI 가드: 버킷 private + RLS admin/manager(§6). 본 다이얼로그도 admin/manager(운영권한)에서만 노출(호출부 게이트).
// 멱등(§4): (clinic_id,chart_no,visit_date,content_hash) UNIQUE → upsert ignoreDuplicates. 동일파일 재업 no-op.

import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  FileImage,
} from 'lucide-react';
import {
  parseResultFilename,
  resolveMatch,
  sha256Hex,
  normalizeChartNo,
  fileExt,
  RESULT_IMAGE_ACCEPT,
  logProgressResultAttach,
  type ParsedResultName,
  type ResultMatchStatus,
  type CustomerLite,
} from '@/lib/progressResultMatch';

/** 행 상태 = 매칭 해석 결과(§3) + 사람이 수동 지정한 'manual'. DB match_status(auto|manual|flagged)와 별개. */
type RowStatus = ResultMatchStatus | 'manual';
/** DB progress_result_images.match_status 리터럴. */
type DbMatchStatus = 'auto' | 'manual' | 'flagged';

interface RowState {
  key: string;              // 안정 key (idx + fileName)
  file: File;
  fileName: string;
  parsed: ParsedResultName;
  contentHash: string | null;
  status: RowStatus;
  customer: CustomerLite | null;
  matchedBy: 'auto' | 'manual';
  detail: string;
  applied?: 'done' | 'noop' | 'error';
  applyMsg?: string;
}

const STATUS_META: Record<
  RowStatus,
  { label: string; cls: string; icon: typeof CheckCircle2; auto: boolean }
> = {
  manual:        { label: '수동매칭',   cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: CheckCircle2, auto: true },
  auto:          { label: '자동매칭',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2, auto: true },
  flagged:       { label: '방문없음·첨부가능', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: AlertTriangle, auto: true },
  name_mismatch: { label: '이름불일치·수동', cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: AlertTriangle, auto: false },
  no_match:      { label: '차트없음·수동',   cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: XCircle, auto: false },
  parse_fail:    { label: '파싱실패·수동',   cls: 'bg-neutral-100 text-neutral-600 border-neutral-300', icon: XCircle, auto: false },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 첨부 완료 후 부모가 목록 갱신 등에 사용(선택). */
  onApplied?: () => void;
}

export default function ProgressResultBulkUploadDialog({ open, onOpenChange, onApplied }: Props) {
  const clinic = useClinic();
  const { profile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<RowState[]>([]);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [manualForKey, setManualForKey] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<CustomerLite[]>([]);
  const [manualSearching, setManualSearching] = useState(false);

  const reset = useCallback(() => {
    setRows([]);
    setManualForKey(null);
    setManualQuery('');
    setManualResults([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = (v: boolean) => {
    if (!v && !applying) reset();
    onOpenChange(v);
  };

  // ── ① 파일 선택 → 파싱 + 해시 + 매칭 미리보기 ─────────────────────────
  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (!clinic?.id) {
        toast.error('클리닉 정보를 불러오지 못했습니다.');
        return;
      }
      setScanning(true);
      try {
        const fileArr = Array.from(files);
        // 파싱 + content-hash.
        const base: RowState[] = [];
        for (let i = 0; i < fileArr.length; i++) {
          const f = fileArr[i];
          const parsed = parseResultFilename(f.name);
          let contentHash: string | null = null;
          try {
            contentHash = await sha256Hex(await f.arrayBuffer());
          } catch {
            contentHash = null;
          }
          base.push({
            key: `${i}__${f.name}`,
            file: f,
            fileName: f.name,
            parsed,
            contentHash,
            status: parsed.ok ? 'no_match' : 'parse_fail',
            customer: null,
            matchedBy: 'auto',
            detail: parsed.ok ? '' : (parsed.reason ?? '파일명 파싱 실패'),
          });
        }

        // chart_no 단독조인(G1): 파싱 성공분의 raw 차트번호로 customers 배치 조회.
        const rawCharts = Array.from(
          new Set(base.filter((r) => r.parsed.ok).map((r) => r.parsed.chartNoRaw)),
        );
        const customersByChartNo = new Map<string, CustomerLite[]>();
        const matchedCustomerIds = new Set<string>();
        if (rawCharts.length > 0) {
          const { data: custData, error: custErr } = await supabase
            .from('customers')
            .select('id, name, chart_number')
            .eq('clinic_id', clinic.id)
            .in('chart_number', rawCharts);
          if (custErr) throw custErr;
          for (const c of (custData ?? []) as CustomerLite[]) {
            const key = normalizeChartNo(c.chart_number);
            if (!key) continue;
            const arr = customersByChartNo.get(key) ?? [];
            arr.push(c);
            customersByChartNo.set(key, arr);
          }
        }

        // 방문 존재 판정(§3-4): 이름까지 일치할 후보 customer 의 (customer_id, session_date) 조회.
        // 1차: chart_no 로 잡힌 customer id 전체 대상 package_sessions 조회.
        for (const arr of customersByChartNo.values()) {
          for (const c of arr) matchedCustomerIds.add(c.id);
        }
        const visitDates = Array.from(
          new Set(base.filter((r) => r.parsed.ok && r.parsed.visitDate).map((r) => r.parsed.visitDate as string)),
        );
        const visitsByCustomer = new Map<string, Set<string>>();
        if (matchedCustomerIds.size > 0 && visitDates.length > 0) {
          const { data: sessData } = await supabase
            .from('package_sessions')
            .select('customer_id, session_date')
            .in('customer_id', Array.from(matchedCustomerIds))
            .in('session_date', visitDates)
            .is('deleted_at', null);
          for (const s of (sessData ?? []) as Array<{ customer_id: string; session_date: string }>) {
            const set = visitsByCustomer.get(s.customer_id) ?? new Set<string>();
            set.add(String(s.session_date));
            visitsByCustomer.set(s.customer_id, set);
          }
        }

        // 매칭 해석(fail-closed).
        const resolved = base.map((r): RowState => {
          const res = resolveMatch({ parsed: r.parsed, customersByChartNo, visitsByCustomer });
          return {
            ...r,
            status: res.status,
            customer: res.customer,
            detail: res.detail,
            matchedBy: 'auto',
          };
        });
        setRows(resolved);
      } catch (e) {
        toast.error(`미리보기 생성 실패: ${(e as Error)?.message ?? '알 수 없는 오류'}`);
      } finally {
        setScanning(false);
      }
    },
    [clinic?.id],
  );

  // ── ③ 수동 매칭: 고객 검색 ─────────────────────────────────────────
  const runManualSearch = useCallback(
    async (q: string) => {
      const term = q.trim();
      if (!clinic?.id || term.length < 1) {
        setManualResults([]);
        return;
      }
      setManualSearching(true);
      try {
        const safe = term.replace(/[%,]/g, '');
        const { data, error } = await supabase
          .from('customers')
          .select('id, name, chart_number')
          .eq('clinic_id', clinic.id)
          .or(`chart_number.ilike.%${safe}%,name.ilike.%${safe}%`)
          .limit(10);
        if (error) throw error;
        setManualResults((data ?? []) as CustomerLite[]);
      } catch (e) {
        toast.error(`고객 검색 실패: ${(e as Error)?.message ?? ''}`);
      } finally {
        setManualSearching(false);
      }
    },
    [clinic?.id],
  );

  const bindManual = (rowKey: string, cust: CustomerLite) => {
    setRows((prev) =>
      prev.map((r) =>
        r.key === rowKey
          ? {
              ...r,
              customer: cust,
              status: 'manual',
              matchedBy: 'manual',
              detail: `수동 매칭 (${cust.name ?? ''} · 차트 ${cust.chart_number ?? '-'})`,
            }
          : r,
      ),
    );
    setManualForKey(null);
    setManualQuery('');
    setManualResults([]);
  };

  // ── ④ 적용(G5 사람게이트 통과) → 업로드 + insert + 감사 ─────────────
  const applicable = rows.filter((r) => r.customer && r.contentHash && r.parsed.visitDate);
  const handleApply = async () => {
    if (!clinic?.id) return;
    if (applicable.length === 0) {
      toast.warning('첨부할 매칭 건이 없습니다. (파싱실패/미매칭 건은 수동 매칭 후 적용됩니다)');
      return;
    }
    setApplying(true);
    let done = 0;
    let noop = 0;
    let fail = 0;
    const nextRows = [...rows];
    try {
      for (const r of applicable) {
        const idx = nextRows.findIndex((x) => x.key === r.key);
        try {
          const cust = r.customer as CustomerLite;
          const hash = r.contentHash as string;
          const visitDate = r.parsed.visitDate as string;
          const ext = fileExt(r.fileName) || 'png';
          const path = `${clinic.id}/${cust.id}/${visitDate}_${hash.slice(0, 16)}.${ext}`;

          // storage 업로드(멱등: 동일 content → 동일 경로 upsert).
          const { error: upErr } = await supabase.storage
            .from('progress-results')
            .upload(path, r.file, {
              contentType: r.file.type || 'image/png',
              upsert: true,
            });
          if (upErr) throw upErr;

          const matchStatus: DbMatchStatus =
            r.status === 'manual' ? 'manual' : r.status === 'flagged' ? 'flagged' : 'auto';
          const matchedBy: 'auto' | 'manual' = r.matchedBy;

          // 멱등 insert: (clinic_id,chart_no,visit_date,content_hash) 중복 → no-op.
          const { data: insData, error: insErr } = await supabase
            .from('progress_result_images')
            .upsert(
              {
                clinic_id: clinic.id,
                customer_id: cust.id,
                chart_no: normalizeChartNo(cust.chart_number) || r.parsed.chartNo,
                visit_date: visitDate,
                image_url: path,
                file_name: r.fileName,
                content_hash: hash,
                matched_by: matchedBy,
                match_status: matchStatus,
                uploaded_by: profile?.id ?? null,
              },
              { onConflict: 'clinic_id,chart_no,visit_date,content_hash', ignoreDuplicates: true },
            )
            .select('id');
          if (insErr) throw insErr;

          const wasNoop = !insData || insData.length === 0; // 멱등 스킵(이미 존재).
          if (wasNoop) noop++;
          else done++;

          // 감사로그(G6).
          logProgressResultAttach({
            actor: profile?.email ?? profile?.id ?? null,
            actorRole: profile?.role ?? null,
            clinicId: clinic.id,
            fileName: r.fileName,
            chartNo: normalizeChartNo(cust.chart_number) || r.parsed.chartNo,
            visitDate,
            contentHash: hash,
            matchedBy,
            matchStatus,
            customerId: cust.id,
          });

          if (idx >= 0) {
            nextRows[idx] = {
              ...nextRows[idx],
              applied: wasNoop ? 'noop' : 'done',
              applyMsg: wasNoop ? '이미 첨부됨(중복 무시)' : '첨부 완료',
            };
          }
        } catch (e) {
          fail++;
          if (idx >= 0) {
            nextRows[idx] = { ...nextRows[idx], applied: 'error', applyMsg: (e as Error)?.message ?? '실패' };
          }
        }
      }
      setRows(nextRows);
      const parts = [`첨부 ${done}건`];
      if (noop > 0) parts.push(`중복 무시 ${noop}건`);
      if (fail > 0) parts.push(`실패 ${fail}건`);
      if (fail > 0) toast.error(parts.join(' · '));
      else toast.confirm(parts.join(' · '));
      onApplied?.();
    } finally {
      setApplying(false);
    }
  };

  const autoCount = rows.filter((r) => STATUS_META[r.status].auto || r.status === 'manual').length;
  const needManualCount = rows.filter((r) => !STATUS_META[r.status].auto && r.status !== 'manual').length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-3xl"
        data-testid="progress-result-bulk-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileImage className="h-5 w-5 text-teal-600" />
            경과분석 결과 일괄 업로드
          </DialogTitle>
          <DialogDescription>
            파일명 <b>이름_차트번호_날짜</b> (예: 홍길동_12345_20260702.png) 로 저장한 결과 이미지를 여러 장
            선택하면 차트번호로 환자를 자동 매칭합니다. 매칭이 안 되는 건은 아래에서 직접 지정하세요.
          </DialogDescription>
        </DialogHeader>

        {/* 파일 선택 */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={RESULT_IMAGE_ACCEPT}
            multiple
            className="hidden"
            data-testid="progress-result-file-input"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={scanning || applying}
            data-testid="progress-result-pick-btn"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            이미지 선택
          </Button>
          {rows.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="progress-result-summary">
              <span>총 {rows.length}장</span>
              <span className="text-emerald-600">· 매칭 {autoCount}</span>
              {needManualCount > 0 && <span className="text-rose-600">· 수동필요 {needManualCount}</span>}
            </div>
          )}
        </div>

        {/* 미리보기 테이블 (G5 사람게이트) */}
        {rows.length > 0 && (
          <div className="mt-3 max-h-[45vh] overflow-auto rounded-lg border" data-testid="progress-result-preview">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">파일명</th>
                  <th className="px-2 py-1.5 text-left font-medium">상태</th>
                  <th className="px-2 py-1.5 text-left font-medium">매칭 결과</th>
                  <th className="px-2 py-1.5 text-left font-medium">동작</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = STATUS_META[r.status];
                  const Icon = meta.icon;
                  const needManual = !meta.auto && r.status !== 'manual';
                  return (
                    <tr key={r.key} className="border-t" data-testid="progress-result-row" data-status={r.status}>
                      <td className="max-w-[220px] truncate px-2 py-1.5" title={r.fileName}>{r.fileName}</td>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className={`gap-1 ${meta.cls}`}>
                          <Icon className="h-3 w-3" />
                          {r.status === 'manual' ? '수동매칭' : meta.label}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {r.applied === 'done' && <span className="text-emerald-600">✓ {r.applyMsg}</span>}
                        {r.applied === 'noop' && <span className="text-amber-600">↺ {r.applyMsg}</span>}
                        {r.applied === 'error' && <span className="text-rose-600">✕ {r.applyMsg}</span>}
                        {!r.applied && (r.detail || '-')}
                      </td>
                      <td className="px-2 py-1.5">
                        {needManual && !r.applied && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={() => {
                              setManualForKey(manualForKey === r.key ? null : r.key);
                              setManualQuery(r.parsed.ok ? r.parsed.chartNoRaw : '');
                              setManualResults([]);
                            }}
                            data-testid="progress-result-manual-btn"
                          >
                            <Search className="h-3 w-3" />
                            수동 매칭
                          </Button>
                        )}
                        {/* 수동 검색 패널(해당 행) */}
                        {manualForKey === r.key && (
                          <div className="mt-1.5 w-[280px] rounded-md border bg-background p-2 shadow-sm" data-testid="progress-result-manual-panel">
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                value={manualQuery}
                                onChange={(e) => setManualQuery(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') runManualSearch(manualQuery); }}
                                placeholder="차트번호 또는 이름"
                                className="h-7 flex-1 rounded border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400"
                                data-testid="progress-result-manual-input"
                              />
                              <Button
                                type="button" size="sm" variant="outline" className="h-7 px-2"
                                onClick={() => runManualSearch(manualQuery)}
                                disabled={manualSearching}
                                data-testid="progress-result-manual-search-btn"
                              >
                                {manualSearching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                              </Button>
                            </div>
                            <div className="mt-1 max-h-[160px] overflow-auto">
                              {manualResults.length === 0 ? (
                                <p className="px-1 py-1.5 text-[11px] text-muted-foreground">검색 결과 없음</p>
                              ) : (
                                manualResults.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => bindManual(r.key, c)}
                                    className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[11px] hover:bg-muted"
                                    data-testid="progress-result-manual-pick"
                                  >
                                    <span className="truncate">{c.name ?? '(이름없음)'}</span>
                                    <span className="ml-2 shrink-0 text-muted-foreground">{c.chart_number ?? '-'}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button type="button" variant="ghost" size="sm" onClick={() => handleClose(false)} disabled={applying}>
            닫기
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleApply}
            disabled={applying || scanning || applicable.length === 0}
            data-testid="progress-result-apply-btn"
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            적용 ({applicable.length}건 첨부)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
