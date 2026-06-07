/**
 * T-20260607-foot-MEDCHART-CONSULT-DRAWER — 진료차트 우측 탭 "📋 상담" (Read-only)
 *
 * 문지은 대표원장 A안(탭 방식) 최종 확정(2026-06-07): 의사가 진료차트(MedicalChartPanel)에서
 * 창 전환 없이 환자의 상담기록을 우측 탭으로 훑는다. 초진(visit_type='new')에서 특히 중요.
 *
 * ── 데이터 소스 (DB 변경 없음) ────────────────────────────────────────────────
 *   check_ins 상담단계 데이터:
 *     - consultation_done : 상담완료 여부
 *     - notes.text(JSONB) : 상담/방문 메모
 *     - visit_type        : 초진(new)/재진(returning) — 초진은 ⭐ 배지
 *     - consultant_id     : 상담실장(담당자)
 *     - treatment_*       : 치료 정보(요약)
 *   → 방문(check_in) 단위 시간 역순 리스트.
 *
 * ── 이식 메모 ──────────────────────────────────────────────────────────────────
 *   선구현 ConsultRecordDrawer(서랍)의 데이터 로직(loadRecords + check_ins 조회)을 재사용하고,
 *   UI 컨테이너만 서랍(portal/backdrop/slide)→우측 탭 패널 인라인으로 이식. 읽기 전용 — 쓰기 경로 없음.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { MessageSquare, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Props {
  customerId: string | null;
}

interface ConsultRecord {
  id: string;
  checked_in_at: string;
  visit_type: 'new' | 'returning' | null;
  consultation_done: boolean | null;
  consultant_id: string | null;
  // notes JSONB — { text?: string, ... }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notes: any | null;
  treatment_kind: string | null;
  treatment_category: string | null;
  treatment_contents: string[] | null;
  status: string | null;
}

function fmtDate(s: string): string {
  try {
    return format(new Date(s), 'yyyy.MM.dd (EEE)', { locale: ko });
  } catch {
    return s;
  }
}

function notesText(notes: unknown): string {
  if (!notes || typeof notes !== 'object') return '';
  const t = (notes as { text?: unknown }).text;
  return typeof t === 'string' ? t.trim() : '';
}

function treatmentSummary(r: ConsultRecord): string {
  const parts: string[] = [];
  if (r.treatment_category) parts.push(r.treatment_category);
  if (r.treatment_kind) parts.push(r.treatment_kind);
  if (Array.isArray(r.treatment_contents) && r.treatment_contents.length > 0) {
    parts.push(r.treatment_contents.filter(Boolean).join(', '));
  }
  return parts.join(' · ');
}

export default function ConsultRecordTab({ customerId }: Props) {
  const [records, setRecords] = useState<ConsultRecord[]>([]);
  const [consultNames, setConsultNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // customerId 변경 시 중복/경합 로드 방지를 위한 가드
  const loadingIdRef = useRef<string | null>(null);

  const loadRecords = useCallback(async () => {
    if (!customerId) return;
    loadingIdRef.current = customerId;
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('check_ins')
        .select(
          'id, checked_in_at, visit_type, consultation_done, consultant_id, notes, treatment_kind, treatment_category, treatment_contents, status',
        )
        .eq('customer_id', customerId)
        .neq('status', 'cancelled')
        .order('checked_in_at', { ascending: false })
        .limit(50);

      // 로드 도중 customerId 가 바뀌었으면 결과 폐기
      if (loadingIdRef.current !== customerId) return;

      const rows: ConsultRecord[] = (data as ConsultRecord[]) ?? [];
      setRecords(rows);

      // 상담실장 id → 표시명 매핑 (graceful — 실패 시 이름 생략)
      const ids = Array.from(
        new Set(rows.map((r) => r.consultant_id).filter((v): v is string => !!v)),
      );
      if (ids.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: staff } = await (supabase as any)
          .from('user_profiles')
          .select('id, name')
          .in('id', ids);
        const map: Record<string, string> = {};
        for (const s of (staff as { id: string; name: string | null }[]) ?? []) {
          if (s.id && s.name) map[s.id] = s.name;
        }
        setConsultNames(map);
      } else {
        setConsultNames({});
      }
    } catch {
      // graceful — 빈 상태로 폴백
      setRecords([]);
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, [customerId]);

  // customerId 변경 시 캐시 리셋 후 재조회
  useEffect(() => {
    setLoaded(false);
    setRecords([]);
    setConsultNames({});
  }, [customerId]);

  // 탭이 마운트되어 있고(=활성) 아직 로드 전이면 1회 로드
  useEffect(() => {
    if (customerId && !loaded) loadRecords();
  }, [customerId, loaded, loadRecords]);

  if (!customerId) {
    return (
      <div
        className="p-6 text-center text-[11px] text-muted-foreground"
        data-testid="consult-record-empty"
      >
        상담 기록 없음
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2" data-testid="right-panel-consult-content">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground">
          상담 기록 (읽기전용)
        </span>
        <span className="text-[9px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
          방문 단위 · 최신순
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : records.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center"
          data-testid="consult-record-empty"
        >
          <MessageSquare className="h-7 w-7 text-muted-foreground/40" />
          <p className="text-[11px] text-muted-foreground">상담 기록 없음</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((r) => {
            const isNew = r.visit_type === 'new';
            const memo = notesText(r.notes);
            const tx = treatmentSummary(r);
            const consultant = r.consultant_id ? consultNames[r.consultant_id] : '';
            return (
              <div
                key={r.id}
                className="rounded-lg border bg-card p-2.5 shadow-sm"
                data-testid="consult-record-item"
              >
                {/* 카드 헤더: 날짜 + 초진⭐/재진 + 상담완료 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-foreground tabular-nums">
                    {fmtDate(r.checked_in_at)}
                  </span>
                  <div className="flex items-center gap-1">
                    {r.visit_type &&
                      (isNew ? (
                        <span
                          className="rounded-full border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700"
                          data-testid="consult-record-new-badge"
                          title="초진(첫 방문)"
                        >
                          ⭐ 초진
                        </span>
                      ) : (
                        <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                          재진
                        </span>
                      ))}
                    {r.consultation_done && (
                      <span className="flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        상담완료
                      </span>
                    )}
                  </div>
                </div>

                {/* 상담실장(담당자) */}
                {consultant && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    상담 <span className="font-medium text-foreground">{consultant}</span>
                  </p>
                )}

                {/* 치료 정보 */}
                {tx && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    <span className="font-medium text-foreground">치료</span> {tx}
                  </p>
                )}

                {/* 상담/방문 메모 요약 */}
                {memo ? (
                  <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-muted/40 p-1.5 text-[10px] leading-relaxed text-foreground">
                    {memo}
                  </p>
                ) : (
                  !tx &&
                  !consultant && (
                    <p className="mt-1.5 text-[10px] italic text-muted-foreground">
                      기록 메모 없음
                    </p>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
