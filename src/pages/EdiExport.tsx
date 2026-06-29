/**
 * EdiExport.tsx — 심평원 표준 청구명세서(요양급여비용 명세서) export 화면
 *
 * T-20260629-foot-EDI-EXPORT-IMPL
 * SSOT: edi_export_data_contract_20260629.md
 *
 * A안: 명세 생성 → 표준 범용 logical 포맷 변환 → 보관 까지.
 *   ❌ 심평원 전자전송(D2 보류) — 전송(transmitted) 버튼/자동전이 없음.
 *   가드(요양기관기호·환수·본인부담구분코드) 위반 시 export BLOCK + 현장 안내.
 *
 * 태블릿 UX: 한국어 · teal-emerald · 천단위 콤마 · 큰 버튼.
 */

import { useCallback, useMemo, useState } from 'react';
import { FileDown, ShieldCheck, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatAmount } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import {
  useExportableClaims,
  loadClaimForExport,
  markExported,
  payloadFingerprint,
  type ExportableClaimRow,
} from '@/hooks/useEdiExport';
import { HIRA_CATEGORY_LABELS, type HiraCategory } from '@/lib/insurance';
import type { EdiExportResult } from '@/lib/ediExport';

function categoryLabel(cat: string | null): string {
  if (!cat) return '-';
  return HIRA_CATEGORY_LABELS[cat as HiraCategory] ?? cat;
}

export default function EdiExport() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;
  const { rows, loading, error, refresh } = useExportableClaims(clinicId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<EdiExportResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const selectedRow = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const openPreview = useCallback(async (row: ExportableClaimRow) => {
    setSelectedId(row.id);
    setResult(null);
    setPreviewLoading(true);
    const res = await loadClaimForExport(row.id);
    setResult(res);
    setPreviewLoading(false);
  }, []);

  const doExport = useCallback(async () => {
    if (!selectedRow || !result || !result.ok) return;
    setExporting(true);
    const fp = payloadFingerprint(result.payload);
    const { error: exErr } = await markExported(selectedRow.id, fp, profile?.id ?? null);
    setExporting(false);
    if (exErr) {
      toast.error(`export 기록 실패: ${exErr}`);
      return;
    }
    toast.success('심평원 표준포맷 export 완료 · 보관되었습니다');
    await refresh();
  }, [selectedRow, result, profile?.id, refresh]);

  return (
    <div className="space-y-4 p-4" data-testid="edi-export-page">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-teal-600" />
          <div>
            <h1 className="text-xl font-bold text-teal-900">보험청구 · EDI</h1>
            <p className="text-sm text-slate-500">
              심평원 표준 청구명세서 포맷으로 명세를 생성·보관합니다. 실제 전송은 인증 청구SW가 담당합니다.
            </p>
          </div>
        </div>
        <Button variant="outline" size="lg" onClick={() => void refresh()} className="gap-2">
          <RefreshCw className="h-4 w-4" /> 새로고침
        </Button>
      </div>

      {/* D2 전송 보류 안내(전송 버튼 없음 명시) */}
      <div
        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        data-testid="edi-no-transmit-notice"
      >
        이 화면은 <b>표준포맷 생성·보관까지만</b> 수행합니다. 심평원 직접 전송 기능은 제공하지 않습니다.
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 청구 목록 */}
        <Card className="p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">청구 명세 목록</h2>
          {error && <p className="text-sm text-red-600">목록 로드 실패: {error}</p>}
          {loading && <p className="text-sm text-slate-400">불러오는 중…</p>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-slate-400">청구 명세가 없습니다.</p>
          )}
          <div className="space-y-2">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                data-testid="edi-claim-row"
                onClick={() => void openPreview(r)}
                className={[
                  'flex w-full items-center justify-between rounded-md border px-3 py-3 text-left transition',
                  selectedId === r.id
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-slate-200 hover:border-teal-300 hover:bg-slate-50',
                ].join(' ')}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">
                      {r.customer_name ?? '(이름없음)'}
                    </span>
                    {r.chart_number && (
                      <span className="text-xs text-slate-400">#{r.chart_number}</span>
                    )}
                    {r.export_status === 'exported' && (
                      <Badge
                        data-testid="edi-exported-badge"
                        className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                      >
                        export 완료
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    진료일 {r.visit_date} · 총진료비 {formatAmount(r.total_base)}원 · 공단부담{' '}
                    {formatAmount(r.total_covered)}원
                  </div>
                </div>
                <FileDown className="h-4 w-4 shrink-0 text-slate-400" />
              </button>
            ))}
          </div>
        </Card>

        {/* 미리보기 / 가드 */}
        <Card className="p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">표준 청구명세서 미리보기</h2>

          {!selectedRow && <p className="text-sm text-slate-400">좌측에서 청구 명세를 선택하세요.</p>}
          {previewLoading && <p className="text-sm text-slate-400">미리보기 생성 중…</p>}

          {/* 가드 BLOCK 안내 */}
          {result && !result.ok && (
            <div
              className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700"
              data-testid="edi-block-msg"
            >
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> export 불가
              </div>
              <p>{result.block_reason}</p>
              {result.detail && (
                <p className="mt-1 text-xs text-red-500">대상: {result.detail}</p>
              )}
            </div>
          )}

          {/* 정상 미리보기 */}
          {result && result.ok && (
            <div className="space-y-3" data-testid="edi-preview">
              {/* ① 일반내역(헤더) */}
              <section className="rounded-md border border-slate-200 p-2">
                <div className="mb-1 text-xs font-semibold text-teal-700">① 명세서 일반내역</div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700">
                  <div>요양기관기호</div>
                  <div className="font-medium" data-testid="edi-institution-code">
                    {result.payload.header.institution_code}
                  </div>
                  <div>요양기관명</div>
                  <div>{result.payload.header.clinic_name}</div>
                  <div>환자</div>
                  <div>{result.payload.header.patient_name}</div>
                  <div>진료개시일</div>
                  <div>{result.payload.header.visit_date}</div>
                  <div>진료비 총액</div>
                  <div>{formatAmount(result.payload.header.total_base)}원</div>
                  <div>본인부담금</div>
                  <div>{formatAmount(result.payload.header.total_copayment)}원</div>
                  <div>청구액(공단부담)</div>
                  <div>{formatAmount(result.payload.header.total_covered)}원</div>
                </dl>
              </section>

              {/* ② 상병내역 */}
              <section className="rounded-md border border-slate-200 p-2">
                <div className="mb-1 text-xs font-semibold text-teal-700">② 상병내역 (KCD)</div>
                {result.payload.diagnoses.length === 0 ? (
                  <p className="text-xs text-slate-400">등록된 상병 없음</p>
                ) : (
                  <ul className="space-y-0.5 text-xs text-slate-700">
                    {result.payload.diagnoses.map((d, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="font-mono">{d.kcd_code}</span>
                        {d.is_primary && (
                          <Badge className="bg-teal-100 text-teal-700 hover:bg-teal-100">주상병</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* ③ 진료내역(줄번호) */}
              <section className="rounded-md border border-slate-200 p-2">
                <div className="mb-1 text-xs font-semibold text-teal-700">③ 진료내역</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-slate-400">
                        <th className="py-1 pr-2">수가코드</th>
                        <th className="py-1 pr-2">항목</th>
                        <th className="py-1 pr-2 text-right">금액</th>
                        <th className="py-1 pr-2 text-right">본인부담</th>
                        <th className="py-1 pr-2 text-right">공단부담</th>
                        <th className="py-1 pr-2">부담구분</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.payload.items.map((it, idx) => (
                        <tr key={idx} className="border-b last:border-0" data-testid="edi-item-row">
                          <td className="py-1 pr-2 font-mono">{it.hira_code ?? '-'}</td>
                          <td className="py-1 pr-2">
                            {it.service_name ?? categoryLabel(it.hira_category)}
                          </td>
                          <td className="py-1 pr-2 text-right">{formatAmount(it.base_amount)}</td>
                          <td className="py-1 pr-2 text-right">{formatAmount(it.copayment_amount)}</td>
                          <td className="py-1 pr-2 text-right">
                            {formatAmount(it.insurance_covered_amount)}
                          </td>
                          <td className="py-1 pr-2 text-slate-500">
                            {it.copay_class_code === '' ? '일반' : it.copay_class_code}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* export 실행 (전송 버튼 없음) */}
              <div className="flex items-center justify-between pt-1">
                {selectedRow?.export_status === 'exported' ? (
                  <span className="flex items-center gap-1 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> 이미 export 완료됨
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">버전 {result.payload.format_version}</span>
                )}
                <Button
                  size="lg"
                  onClick={() => void doExport()}
                  disabled={exporting}
                  data-testid="edi-export-btn"
                  className="gap-2 bg-teal-600 hover:bg-teal-700"
                >
                  <FileDown className="h-4 w-4" />
                  {exporting
                    ? '저장 중…'
                    : selectedRow?.export_status === 'exported'
                      ? '다시 export'
                      : '심평원 표준포맷 export'}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
