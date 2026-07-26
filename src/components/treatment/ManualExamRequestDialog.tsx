// ManualExamRequestDialog.tsx — 치료테이블 [균검사] 탭 '검사 신청 수기 추가'
// Ticket: T-20260726-foot-EXAM-MANUAL-ADD-SEARCH (P1)
//
// 배경(김주연 총괄): '검사 신청 항목이 자꾸 풀리는 버그' 보완루트 = 수기 진입경로.
//   원인 수정은 별도 티켓. 본 건은 성함/차트번호로 환자를 찾아 검사신청을 수기 등록하는 진입점만 추가.
//
// 플로우: ① 성함 OR 차트번호 부분검색(customers, clinic-scoped) → ② 환자 선택(리스트에서 명시 선택 —
//   동명이인은 차트번호·연락처로 구분, 자동선택 없음) → ③ 검사종류(균검사 KOH / 피검사) → ④ 제출.
//
// persist(AC3 회귀 핵심): 旣 request_koh_for_customer / request_blood_test_for_customer RPC 재사용.
//   → 2번차트 토글(KohRequestToggle/BloodTestRequestToggle)과 '동일 저장경로'(check_in_services.
//   koh_requested / blood_test_requested = true). 신규 영속상태·스키마 0 (db_change=false).
//   같은 경로를 쓰므로 '풀림 버그'를 새로 상속·유발하지 않음(원인은 별도 티켓). exam_targets/토글
//   쿼리 invalidate 로 목록·토글에 즉시 반영(재진입/새로고침 후 유지 = RPC 가 DB 에 즉시 영속).
//
// 검사종류 enum 정합: 균검사=koh_requested(KOH), 피검사=blood_test_requested — 旣 균검사(KOH)/피검사 구분과 1:1.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { toast } from '@/lib/toast';
import { chartNoBadge } from '@/lib/format';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FlaskConical, Droplet, Loader2, Search, UserRound, Check } from 'lucide-react';

interface CustomerHit {
  id: string;
  name: string | null;
  chart_number: string | null;
  phone: string | null;
}

type ExamKind = 'koh' | 'blood';

const KIND_META: Record<ExamKind, { label: string; rpc: string; tone: string; Icon: typeof FlaskConical }> = {
  koh: {
    label: '균검사 (KOH)',
    rpc: 'request_koh_for_customer',
    tone: 'teal',
    Icon: FlaskConical,
  },
  blood: {
    label: '피검사 (혈액검사)',
    rpc: 'request_blood_test_for_customer',
    tone: 'rose',
    Icon: Droplet,
  },
};

function maskPhoneTail(phone: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `····${digits.slice(-4)}`; // 동명이인 구분용 뒤 4자리(PHI 최소노출)
}

export default function ManualExamRequestDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const clinic = useClinic();
  const qc = useQueryClient();

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CustomerHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<CustomerHit | null>(null);
  const [kind, setKind] = useState<ExamKind>('koh');

  // 다이얼로그 열 때마다 상태 초기화(이전 검색 잔상 방지).
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSearched(false);
      setSelected(null);
      setKind('koh');
    }
  }, [open]);

  // ① 부분검색 — 성함 OR 차트번호(ilike %term%). clinic-scoped. 명시 선택 전용(자동선택 없음).
  const runSearch = useCallback(async () => {
    const term = query.trim();
    if (!clinic?.id || term.length < 1) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    setSelected(null);
    try {
      const safe = term.replace(/[%,]/g, '');
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, chart_number, phone')
        .eq('clinic_id', clinic.id)
        .or(`name.ilike.%${safe}%,chart_number.ilike.%${safe}%`)
        .order('name', { ascending: true })
        .limit(20);
      if (error) throw error;
      setResults((data ?? []) as CustomerHit[]);
      setSearched(true);
    } catch (e) {
      toast.error(`고객 검색 실패: ${(e as Error)?.message ?? ''}`);
    } finally {
      setSearching(false);
    }
  }, [clinic?.id, query]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('환자를 먼저 선택해주세요.');
      const { data, error } = await supabase.rpc(KIND_META[kind].rpc, {
        p_customer_id: selected.id,
        p_value: true,
      });
      if (error) throw error;
      // T-20260726-foot-EXAM-REQUEST-SAVE-BUG (cross_crm_write_rowcheck INV-W2/W3): RPC 반환행 검증.
      //   신청은 항상 ON(p_value=true) → 서버가 true 를 반환하지 않으면 성공 간주 금지(silent write-failure 차단).
      //   토글(KohRequestToggle/BloodTestRequestToggle)과 동일 검증 = 단일 저장 로직 수렴.
      if (data !== true) {
        throw new Error('검사 신청이 저장되지 않았습니다. (서버 미확인 — 권한/내원기록 확인)');
      }
    },
    onSuccess: () => {
      // 旣 토글·목록과 동일 쿼리 invalidate(read-after-write) — 재진입 없이 즉시 반영.
      qc.invalidateQueries({ queryKey: ['exam_targets'] });
      qc.invalidateQueries({ queryKey: ['koh_toggle_target', selected?.id] });
      qc.invalidateQueries({ queryKey: ['blood_toggle_target', selected?.id] });
      qc.invalidateQueries({ queryKey: ['koh_report'] });
      const who = [selected?.name, selected?.chart_number].filter(Boolean).join(' ');
      toast.success(`${who} — ${KIND_META[kind].label} 신청 등록 완료`);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(`검사 신청 등록 실패: ${e.message}`),
  });

  const kindTone = useMemo(() => KIND_META[kind].tone, [kind]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="manual-exam-request-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-teal-600" />
            검사 신청 수기 추가
          </DialogTitle>
          <DialogDescription>
            성함 또는 차트번호로 환자를 찾아 검사 신청을 직접 등록합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* ① 검색 */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void runSearch();
                  }
                }}
                placeholder="성함 또는 차트번호"
                className="pl-8"
                data-testid="manual-exam-search-input"
                autoFocus
              />
            </div>
            <Button
              type="button"
              onClick={() => void runSearch()}
              disabled={searching || query.trim().length < 1}
              data-testid="manual-exam-search-btn"
            >
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : '검색'}
            </Button>
          </div>

          {/* ② 검색 결과(명시 선택) — 동명이인은 차트번호·연락처로 구분 */}
          {searched && (
            <div
              className="max-h-56 overflow-y-auto rounded-lg border"
              data-testid="manual-exam-results"
            >
              {results.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground" data-testid="manual-exam-results-empty">
                  일치하는 환자가 없습니다. 성함·차트번호를 확인해주세요.
                </div>
              ) : (
                <ul className="divide-y">
                  {results.map((c) => {
                    const isSel = selected?.id === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(c)}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 ${
                            isSel ? 'bg-teal-50' : ''
                          }`}
                          data-testid="manual-exam-result-row"
                          data-selected={isSel ? 'true' : 'false'}
                          data-customer-id={c.id}
                        >
                          <span className="flex items-center gap-2">
                            <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="font-medium">{c.name ?? '—'}</span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {chartNoBadge(c.chart_number)}
                            </span>
                            {c.phone && (
                              <span className="text-xs tabular-nums text-muted-foreground/70">
                                {maskPhoneTail(c.phone)}
                              </span>
                            )}
                          </span>
                          {isSel && <Check className="h-4 w-4 shrink-0 text-teal-600" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* ③ 검사 종류 선택 — 균검사(KOH) / 피검사. 환자 선택 후에만 활성. */}
          {selected && (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3" data-testid="manual-exam-kind">
              <p className="text-xs font-semibold text-muted-foreground">검사 종류</p>
              <div className="flex gap-2">
                {(Object.keys(KIND_META) as ExamKind[]).map((k) => {
                  const meta = KIND_META[k];
                  const active = kind === k;
                  const on =
                    meta.tone === 'teal'
                      ? 'border-teal-500 bg-teal-600 text-white'
                      : 'border-rose-500 bg-rose-600 text-white';
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold transition ${
                        active ? on : 'border-input bg-background text-foreground hover:bg-accent'
                      }`}
                      data-testid={`manual-exam-kind-${k}`}
                      aria-pressed={active}
                    >
                      <meta.Icon className="h-4 w-4" />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
            취소
          </Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={!selected || submit.isPending}
            className={kindTone === 'rose' ? 'bg-rose-600 text-white hover:bg-rose-700' : ''}
            data-testid="manual-exam-submit-btn"
          >
            {submit.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            검사 신청 등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
