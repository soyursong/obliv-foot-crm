// OpinionDocTab — 소견서(진단서) 작성 탭
// Ticket: T-20260616-foot-OPINION-DOC-FEATURE (Phase 1 — FE scaffold, 영속 제외)
//   원 요청: 김주연 총괄 (#foot thread 1781491923.605529). UI ref = 첨부 F0BAETELCTF(소견서 팝업).
//
// ⚠ 균검사지(KohReportTab) NOTOUCH — 본 탭은 균검사지 '옆'에 신설된 독립 탭(DoctorTools.tsx).
//   균검사지 내부 로직(KOH-SPECIMENNO-FORMAT, KOHTOGGLE-NOTRENDER 등 in-flight)에 무간섭.
//
// === Phase 1 범위 (이 파일) — 영속 ZERO ===
//   AC-2 금일 내방객(check_ins, KST 당일) 리스트업(read-only).
//   AC-3 고객 클릭 → 팝업(F0BAETELCTF 옵션 그리드). 옵션 클릭 → 템플릿 문구 editor 자동 삽입.
//   AC-4 자동삽입 최종본을 원장이 textarea 에서 수기 수정(editor = SSOT).
//   ※ '최종 발행'(AC-6) / 서류 출력(AC-7) / 템플릿 설정 UI(AC-8) 은 Phase 2(DA CONSULT GO 후).
//     본 파일에서는 발행 버튼을 '준비중'(disabled) 으로만 노출 — DB wiring 금지(MSG-20260616-141830-o298 게이트).
//
// === 템플릿 옵션(OPINION_SECTIONS) — Phase 1 하드코드 기본값 ===
//   F0BAETELCTF 의 2개 섹션(진단서 / 금기증) + 옵션 라벨을 그대로 미러.
//   각 옵션의 phrase(자동삽입 문구) 는 placeholder 기본값 — 실제 문구·옵션 구성은 Phase 2 설정 UI(AC-8)에서
//   총괄/원장 confirm 후 DB(form_templates 재사용 제안, DA 소유)로 이관. 원장이 editor 에서 수기 수정하므로
//   기본 문구는 출발점일 뿐(AC-4). 임의 임상 단정 회피 — 라벨 기반 중립 문장.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { todaySeoulISODate, birthYearAgeDisplay, chartNoDisplay } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Loader2, FileText, Search, ClipboardList } from 'lucide-react';

// ---------------------------------------------------------------------------
// 템플릿 옵션 — F0BAETELCTF 미러 (Phase 1 하드코드 기본값, Phase 2 설정 UI 로 이관 예정 AC-8).
//   key=안정 식별자 / label=버튼 표기(현장) / phrase=클릭 시 editor 자동삽입 문구(기본값).
// ---------------------------------------------------------------------------
export interface OpinionOption {
  key: string;
  label: string;
  phrase: string;
}
export interface OpinionSection {
  title: string;
  options: OpinionOption[];
}

export const OPINION_SECTIONS: OpinionSection[] = [
  {
    title: '진단서',
    options: [
      { key: 'oral_o', label: '경구약 O', phrase: '경구약 복용이 가능한 상태로 확인됩니다.' },
      { key: 'oral_x', label: '경구약 X', phrase: '경구약 복용이 어려운 상태로 확인됩니다.' },
      { key: 'after_1m', label: '약복용 1달 후', phrase: '약 복용 1개월 후 경과 관찰이 필요합니다.' },
      { key: 'medical_staff', label: '의료진', phrase: '의료진 판단 하에 진료를 진행하였습니다.' },
    ],
  },
  {
    title: '금기증',
    options: [
      { key: 'hyperlipidemia', label: '고지혈증', phrase: '고지혈증 관련 사항을 확인하였습니다.' },
      { key: 'gi_disorder', label: '위장장애', phrase: '위장장애 관련 사항을 확인하였습니다.' },
      { key: 'oral_ineffective', label: '경구약 효과미비', phrase: '경구약 복용 효과가 미비하여 추가 조치를 고려합니다.' },
      { key: 'gi_after_oral', label: '경구약복용후 위장장애', phrase: '경구약 복용 후 위장장애가 확인됩니다.' },
      { key: 'bp_med', label: '혈압약', phrase: '혈압약 복용 이력을 확인하였습니다.' },
      { key: 'cardio_med', label: '심혈관약', phrase: '심혈관계 약물 복용 이력을 확인하였습니다.' },
      { key: 'liver_disease', label: '간질환', phrase: '간질환 관련 사항을 확인하였습니다.' },
      { key: 'hbv_carrier', label: '간염보균자', phrase: '간염 보균 여부를 확인하였습니다.' },
      { key: 'kidney_disease', label: '신장질환', phrase: '신장질환 관련 사항을 확인하였습니다.' },
      { key: 'gout_med', label: '통풍약', phrase: '통풍약 복용 이력을 확인하였습니다.' },
      { key: 'thyroid_med', label: '갑상선약', phrase: '갑상선약 복용 이력을 확인하였습니다.' },
      { key: 'male_hairloss_med', label: '남성 탈모약', phrase: '남성 탈모약 복용 이력을 확인하였습니다.' },
      { key: 'female_hairloss_med', label: '여성 탈모약', phrase: '여성 탈모약 복용 이력을 확인하였습니다.' },
      { key: 'psychiatric_med', label: '항정신과약', phrase: '항정신과 약물 복용 이력을 확인하였습니다.' },
      { key: 'on_chemo', label: '항암중', phrase: '항암 치료 중인 상태를 확인하였습니다.' },
      { key: 'post_chemo_followup', label: '항암 후 추적', phrase: '항암 치료 후 추적 관찰 중임을 확인하였습니다.' },
      { key: 'preparing_pregnancy', label: '임신준비중', phrase: '임신 준비 중인 상태를 확인하였습니다.' },
      { key: 'pregnant', label: '임신중', phrase: '임신 중인 상태를 확인하였습니다.' },
      { key: 'breastfeeding', label: '수유중', phrase: '수유 중인 상태를 확인하였습니다.' },
      { key: 'pilot', label: '파일럿', phrase: '항공 종사자(파일럿) 직군임을 확인하였습니다.' },
      { key: 'driver', label: '운전기사', phrase: '운전 직군임을 확인하였습니다.' },
      { key: 'immune_disease', label: '면역질환', phrase: '면역질환 관련 사항을 확인하였습니다.' },
      { key: 'diabetes', label: '당뇨', phrase: '당뇨 관련 사항을 확인하였습니다.' },
      { key: 'pediatric', label: '소아', phrase: '소아 환자임을 확인하였습니다.' },
    ],
  },
];

// ---------------------------------------------------------------------------
// editor 텍스트 합성 — 선택된 옵션의 phrase 를 줄 단위로 append/remove(toggle).
//   editor = 최종 SSOT(AC-4 수기수정). selected set 은 시각 강조 + best-effort toggle 용.
//   문구는 줄(\n) 단위로 관리 — 동일 phrase 가 본문에 있으면 제거, 없으면 끝에 추가.
// ---------------------------------------------------------------------------
export function togglePhraseInText(text: string, phrase: string): string {
  const lines = text.split('\n').map((l) => l.trimEnd());
  const idx = lines.findIndex((l) => l.trim() === phrase.trim());
  if (idx >= 0) {
    lines.splice(idx, 1);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  }
  const base = text.replace(/\s+$/, '');
  return base ? `${base}\n${phrase}` : phrase;
}

// ---------------------------------------------------------------------------
// 금일 내방객 조회 — check_ins 당일(KST) + customers 조인(차트/생년). read-only.
//   DoctorCallDashboard.useDoctorCallFeed 의 KST 바운드 컨벤션과 동일. cancelled 제외.
// ---------------------------------------------------------------------------
export interface VisitorRow {
  id: string;
  customer_id: string | null;
  customer_name: string;
  chart_number: string | null;
  birth_date: string | null;
  visit_type: string | null;
  checked_in_at: string;
}

function readCustomerField<T>(raw: unknown, key: string): T | null {
  const c = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
  return (c?.[key] as T) ?? null;
}

function useTodayVisitors(clinicId: string | null) {
  return useQuery<VisitorRow[]>({
    queryKey: ['opinion_today_visitors', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const today = todaySeoulISODate();
      const { data, error } = await supabase
        .from('check_ins')
        .select('id, customer_id, customer_name, visit_type, checked_in_at, customers!customer_id(chart_number, birth_date)')
        .eq('clinic_id', clinicId)
        .gte('checked_in_at', `${today}T00:00:00+09:00`)
        .lte('checked_in_at', `${today}T23:59:59+09:00`)
        .neq('status', 'cancelled')
        .order('checked_in_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row['id']),
        customer_id: (row['customer_id'] as string | null) ?? null,
        customer_name: String(row['customer_name'] ?? '—'),
        chart_number: readCustomerField<string>(row['customers'], 'chart_number'),
        birth_date: readCustomerField<string>(row['customers'], 'birth_date'),
        visit_type: (row['visit_type'] as string | null) ?? null,
        checked_in_at: String(row['checked_in_at'] ?? ''),
      }));
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// ---------------------------------------------------------------------------
// 소견서 작성 팝업 — F0BAETELCTF 옵션 그리드 + editor.
//   옵션 클릭 → phrase 자동삽입(toggle). editor = textarea(수기수정 SSOT).
// ---------------------------------------------------------------------------
function OpinionEditorDialog({
  visitor,
  open,
  onOpenChange,
}: {
  visitor: VisitorRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 팝업이 새 환자로 열릴 때마다 editor 초기화(미저장 — Phase 1 영속 없음).
  const visitorId = visitor?.id ?? null;
  const [boundTo, setBoundTo] = useState<string | null>(null);
  if (open && visitorId !== boundTo) {
    setBoundTo(visitorId);
    setText('');
    setSelected(new Set());
  }

  const handleOptionClick = (opt: OpinionOption) => {
    setText((prev) => togglePhraseInText(prev, opt.phrase));
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(opt.key)) next.delete(opt.key);
      else next.add(opt.key);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="opinion-dialog">
        <DialogTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-teal-600" />
          소견서 작성
          {visitor && (
            <span className="text-sm font-normal text-muted-foreground">
              · {visitor.customer_name}
              {visitor.chart_number && <span className="ml-1 font-mono">{chartNoDisplay(visitor.chart_number)}</span>}
            </span>
          )}
        </DialogTitle>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* 좌: 옵션 그리드 (F0BAETELCTF) */}
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1" data-testid="opinion-options">
            {OPINION_SECTIONS.map((section) => (
              <div key={section.title}>
                <p className="mb-1.5 text-center text-xs font-semibold text-muted-foreground">{section.title}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {section.options.map((opt) => {
                    const active = selected.has(opt.key);
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => handleOptionClick(opt)}
                        aria-pressed={active}
                        title={opt.phrase}
                        data-testid={`opinion-opt-${opt.key}`}
                        className={`rounded-md border px-2 py-2 text-xs font-medium transition ${
                          active
                            ? 'border-teal-600 bg-teal-600 text-white shadow-sm'
                            : 'border-input bg-background text-foreground hover:bg-accent'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 우: editor(수기수정) + 발행(Phase 2 준비중) */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="opinion-editor-text">
              소견 내용 <span className="text-muted-foreground/60">(옵션을 누르면 문구가 자동 삽입됩니다. 자유롭게 수정하세요.)</span>
            </label>
            <Textarea
              id="opinion-editor-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="좌측 옵션을 눌러 문구를 삽입하거나 직접 입력하세요."
              className="min-h-[40vh] flex-1 text-sm leading-relaxed"
              data-testid="opinion-editor"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground/70">
                ※ 최종 발행·서류 출력은 준비 중입니다(다음 업데이트에서 활성화).
              </span>
              <Button
                size="sm"
                className="h-8 gap-1 bg-teal-600 px-3 text-xs text-white hover:bg-teal-700 disabled:opacity-40"
                disabled
                title="최종 발행 기능은 다음 업데이트에서 활성화됩니다(준비 중)."
                data-testid="opinion-publish-btn"
              >
                최종 발행 (준비중)
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// OpinionDocTab — Main (금일 내방객 명단 + 소견서 작성 진입)
// ---------------------------------------------------------------------------
export default function OpinionDocTab() {
  const { profile } = useAuth();
  const clinicId = profile?.clinic_id ?? null;

  const [query, setQuery] = useState('');
  const [activeVisitor, setActiveVisitor] = useState<VisitorRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: rows = [], isLoading, isError, error } = useTodayVisitors(clinicId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(q) ||
        (r.chart_number ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  const openOpinion = (v: VisitorRow) => {
    setActiveVisitor(v);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ClipboardList className="h-4 w-4 text-teal-600" />
            소견서 — 금일 내방객
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            오늘 내원한 고객 명단입니다. 고객을 누르면 소견서 작성 창이 열립니다.
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="환자이름 · 차트번호 검색"
            className="h-9 pl-8 text-sm"
            data-testid="opinion-search"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-8 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {query.trim() ? '검색 결과가 없습니다.' : '오늘 내원한 고객이 없습니다.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" data-testid="opinion-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">이름</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">차트</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">생년(만나이)</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap">구분</th>
                <th className="px-1.5 py-1 font-medium whitespace-nowrap text-center">소견서</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-b last:border-0 transition hover:bg-accent/30"
                  data-testid="opinion-row"
                >
                  <td className="px-1.5 py-1 whitespace-nowrap max-w-[8rem]" data-testid="opinion-cell-name">
                    <button
                      type="button"
                      onClick={() => openOpinion(r)}
                      className="block max-w-full truncate text-left font-semibold text-teal-700 underline-offset-2 hover:underline focus:underline focus:outline-none"
                      title={`${r.customer_name} — 클릭 시 소견서 작성`}
                      data-testid="opinion-open"
                    >
                      {r.customer_name}
                    </button>
                  </td>
                  <td className="px-1.5 py-1 font-mono text-foreground/90 whitespace-nowrap" data-testid="opinion-cell-chart">
                    {r.chart_number ? chartNoDisplay(r.chart_number) : '—'}
                  </td>
                  <td className="px-1.5 py-1 tabular-nums text-foreground/90 whitespace-nowrap" data-testid="opinion-cell-birth">
                    {birthYearAgeDisplay(r.birth_date) || '—'}
                  </td>
                  <td className="px-1.5 py-1 text-muted-foreground whitespace-nowrap" data-testid="opinion-cell-visittype">
                    {r.visit_type || '—'}
                  </td>
                  <td className="px-1.5 py-1 text-center whitespace-nowrap" data-testid="opinion-cell-action">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-[11px]"
                      onClick={() => openOpinion(r)}
                      data-testid="opinion-write-btn"
                    >
                      <FileText className="h-3 w-3" /> 작성
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/70">
        ※ 금일(오늘) 내원 고객 명단입니다. 고객 이름 또는 작성 버튼을 누르면 소견서 작성 창이 열립니다. 옵션 버튼을 누르면 문구가 자동으로 삽입되며(다시 누르면 해제), 원장님이 내용을 자유롭게 수정할 수 있습니다. 최종 발행과 서류 출력은 다음 업데이트에서 활성화됩니다.
      </p>

      <OpinionEditorDialog visitor={activeVisitor} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
