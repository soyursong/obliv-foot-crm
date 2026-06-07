/**
 * T-20260607-foot-MEDCHART-CONSULT-DRAWER — 진료차트에서 상담기록 빠른 조회 서랍(Drawer)
 *
 * 문지은 대표원장 요청(2026-06-07): 의사가 진료차트(MedicalChartPanel)에서 창 전환 없이
 * 환자의 상담기록을 "주르륵" 한눈에 훑을 수 있는 읽기 전용 서랍. 특히 초진(visit_type='new') 환자에서 중요.
 *
 * ── 데이터 소스 (A안 — plan_review_gate 기준 확정 대상) ──────────────────────────
 *   풋CRM에는 단일 "상담차트" 테이블이 없음. 상담단계 데이터가 check_ins 에 존재:
 *     - consultation_done : 상담완료 여부
 *     - notes.text(JSONB) : 상담/방문 메모
 *     - visit_type        : 초진(new)/재진(returning)
 *     - consultant_id     : 상담실장
 *     - treatment_kind / treatment_category / treatment_contents : 치료 정보
 *   → 방문(check_in) 단위 시간 역순 리스트가 "주르륵" 요구에 가장 자연스러움.
 *   ⚠ 소스가 2번차트(CustomerChartSheet) 또는 외부 상담모니터링(C안)으로 확정되면
 *     loadRecords() 쿼리 1곳만 교체하면 됨 (UI/진입/오버레이 인프라 전부 재사용).
 *
 * ── 표시 방식 ──────────────────────────────────────────────────────────────────
 *   진료차트(z-[80]/z-[90]) 위에 겹쳐 슬라이드하는 중첩 오버레이(z-[100]/z-[110]).
 *   닫으면 진료차트 그대로 복귀(진료차트 언마운트/재조회 없음 — 단지 표시/숨김 토글).
 *   읽기 전용 — 쓰기 경로 없음.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { MessageSquare, X, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Props {
  customerId: string | null;
  open: boolean;
  onClose: () => void;
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

export default function ConsultRecordDrawer({ customerId, open, onClose }: Props) {
  const [records, setRecords] = useState<ConsultRecord[]>([]);
  const [consultNames, setConsultNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // ESC 핸들러가 항상 최신 open 을 읽도록 ref 동기화
  const openRef = useRef(open);
  openRef.current = open;

  const loadRecords = useCallback(async () => {
    if (!customerId) return;
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

  // 열릴 때 1회 로드. customerId 변경 시 리셋.
  useEffect(() => {
    if (open && customerId) {
      if (!loaded) loadRecords();
    }
  }, [open, customerId, loaded, loadRecords]);

  // customerId 변경 시 캐시 리셋(다음 오픈 때 재조회)
  useEffect(() => {
    setLoaded(false);
    setRecords([]);
    setConsultNames({});
  }, [customerId]);

  // ESC 로 서랍만 닫기 — 진료차트(아래)까지 닫히지 않도록 stopPropagation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openRef.current) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open, onClose]);

  if (!open || !customerId) return null;

  return createPortal(
    <>
      {/* 백드롭 — 진료차트 위(z-[100]). 클릭 시 서랍만 닫힘 */}
      <div
        className="fixed inset-0 z-[100] bg-black/40"
        onClick={onClose}
        aria-hidden="true"
        data-testid="consult-record-backdrop"
      />

      {/* 서랍 패널 — 우측 슬라이드, 진료차트 위 겹침(z-[110]) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="상담기록"
        data-testid="consult-record-drawer"
        className="fixed right-0 top-0 z-[110] h-full w-full max-w-md bg-background shadow-2xl flex flex-col outline-none animate-in slide-in-from-right duration-300"
      >
        {/* 헤더 */}
        <div className="flex-none flex items-center justify-between px-5 py-3 border-b bg-background shadow-sm">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-teal-600 shrink-0" />
            <span className="text-base font-bold text-teal-700">상담기록</span>
            <span className="text-[11px] text-muted-foreground">방문 단위 · 최신순</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="닫기"
            data-testid="consult-record-close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 본문 — 시간 역순 리스트("주르륵") */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
            </div>
          ) : records.length === 0 ? (
            <div
              className="flex h-40 flex-col items-center justify-center gap-2 text-center"
              data-testid="consult-record-empty"
            >
              <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">상담기록 없음</p>
            </div>
          ) : (
            records.map((r) => {
              const isNew = r.visit_type === 'new';
              const memo = notesText(r.notes);
              const tx = treatmentSummary(r);
              const consultant = r.consultant_id ? consultNames[r.consultant_id] : '';
              return (
                <div
                  key={r.id}
                  className="rounded-lg border bg-card p-3 shadow-sm"
                  data-testid="consult-record-item"
                >
                  {/* 카드 헤더: 날짜 + 초진/재진 + 상담완료 */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {fmtDate(r.checked_in_at)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {r.visit_type && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            isNew
                              ? 'bg-amber-100 text-amber-700 border border-amber-300'
                              : 'bg-muted text-muted-foreground border border-border'
                          }`}
                        >
                          {isNew ? '초진' : '재진'}
                        </span>
                      )}
                      {r.consultation_done && (
                        <span className="flex items-center gap-0.5 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" />
                          상담완료
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 상담실장 */}
                  {consultant && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      상담 <span className="font-medium text-foreground">{consultant}</span>
                    </p>
                  )}

                  {/* 치료 정보 */}
                  {tx && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">치료</span> {tx}
                    </p>
                  )}

                  {/* 상담/방문 메모 */}
                  {memo ? (
                    <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs leading-relaxed text-foreground">
                      {memo}
                    </p>
                  ) : (
                    !tx &&
                    !consultant && (
                      <p className="mt-2 text-[11px] italic text-muted-foreground">기록 메모 없음</p>
                    )
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
