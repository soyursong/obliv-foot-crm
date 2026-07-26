// BloodDailyListSection.tsx — 치료테이블 [피검사] 탭 = '피검사 일일 진행 리스트'
// Ticket: T-20260724-foot-TREATTABLE-LABTAB-SPLIT-BLOODLIST
//
// 배경: 기존 [균검사 & 피검사 대상자] 단일 탭을 [균검사]/[피검사] 2탭으로 분리.
//   · 균검사 = 기존 ExamTargetsSection 그대로 이관(회귀0). 본 파일은 무관.
//   · 피검사 = 첨부 mockup(F0BLB4L8MBJ_blood_test_form.jpg) '피검사 일일 진행 리스트' 8컬럼 양식 신규.
//
// 8컬럼(mockup 순서 그대로): 순서 · 검사일자 · 환자명 · 차트번호 · 생년월일 · 접수여부[☑] · 접수자명 · 서류수령여부[☑]
//   색상: 접수여부/접수자명 컬럼 = 핑크(bg-pink-50)·빨강 액센트 / 서류수령여부 컬럼 = 노랑(bg-yellow-50)·연두 액센트.
//   체크박스: 빨간테두리(미완료) / 빨간체크(접수 완료) / 녹색체크(서류수령 완료).
//
// 리스트업: check_in_services.blood_test_requested=true 인 환자 × 검사신청일(check_ins.checked_in_at, KST).
//   ExamTargetsSection 와 동일 데이터 계약(ADDITIVE read-only 소비) — 신규 스키마 0. 42703 폴백 빈 목록.
//   진행 리스트 특성상(검사 → 접수 → 서류수령 흐름이 며칠 걸림) 선택일 끝 직전 WINDOW_DAYS 일을
//   플랫 리스트로 표시(mockup 이 여러 검사일자를 한 화면에 나열 → 일자별 그룹핑 대신 플랫).
//
// 영속(체크박스/접수자명 재진입 유지) = form_submissions 재사용(신규 스키마 0, no-DDL):
//   template_id NULL + field_data.form_key='blood_reception_daily' (PenChart builtin 양식과 동일 패턴).
//   field_data = { form_key, request_date, received, receiver_name, docs_received }.
//   키 = customer_id × request_date. 재사용 우선 원칙(T-20260723 LABTEST 선례) → db_change=false.

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { chartNoBadge, seoulISODate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Loader2, Droplet, Check } from 'lucide-react';
import type { NameInteraction } from '@/pages/TreatmentTable';

const FORM_KEY = 'blood_reception_daily';
// 진행 리스트 윈도 — 선택일(부모 date, 기본 오늘) 끝으로 직전 N일. 검사→접수→서류수령 지연 추적용.
const WINDOW_DAYS = 14;

interface BloodTargetRow {
  customerId: string;
  customerName: string;
  chartNumber: string | null;
  phone: string | null;
  birthDate: string | null; // customers.birth_date (YYYY-MM-DD) 또는 RRN 파생 폴백
  requestDate: string; // 검사신청일(KST YYYY-MM-DD)
  checkInId: string | null;
}

interface ReceptionState {
  id: string | null; // form_submissions.id (없으면 미저장)
  received: boolean;
  receiverName: string;
  docsReceived: boolean;
}

function rowKey(customerId: string, requestDate: string) {
  return `${customerId}__${requestDate}`;
}

// AC: 검사신청일 윈도 [start 00:00, end 23:59] KST.
function windowBounds(endDate: string) {
  const start = format(subDays(new Date(endDate + 'T12:00:00'), WINDOW_DAYS - 1), 'yyyy-MM-dd');
  return { startTs: `${start}T00:00:00+09:00`, endTs: `${endDate}T23:59:59+09:00`, start };
}

// 검사일자 표기 — mockup "2026. 7. 22" 형식.
function testDateLabel(d: string) {
  return format(new Date(d + 'T12:00:00'), 'yyyy. M. d');
}

// 생년월일 6자리(YYMMDD) — mockup 표기. 결측 '—'.
function birth6(birth: string | null): string {
  if (!birth) return '—';
  const digits = birth.replace(/\D/g, '');
  if (digits.length >= 8) return digits.slice(2, 8); // YYYYMMDD → YYMMDD
  if (digits.length === 6) return digits;
  return birth;
}

// 피검사 대상자 — blood_test_requested=true, 환자×검사신청일 1행. ExamTargetsSection 데이터 계약 재사용.
function useBloodTargets(clinicId: string | null | undefined, date: string) {
  return useQuery<BloodTargetRow[]>({
    queryKey: ['blood_daily_targets', clinicId, date],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const { startTs, endTs } = windowBounds(date);
      const SEL =
        'id, blood_test_requested, created_at, check_in_id, ' +
        'check_ins!inner(customer_id, customer_name, clinic_id, status, checked_in_at)';
      const { data, error } = await supabase
        .from('check_in_services')
        .select(SEL)
        .eq('check_ins.clinic_id', clinicId)
        .neq('check_ins.status', 'cancelled')
        // T-20260726-foot-EXAM-REQUEST-SAVE-BUG: 신청일 기준을 신청행 created_at(실제 신청시각)으로 교정.
        //   내원일(checked_in_at) 기준이면 과거일자 내원에 붙은 오늘 신청분이 사라짐(RC=B, ExamTargetsSection 동일).
        .gte('created_at', startTs)
        .lte('created_at', endTs)
        .eq('blood_test_requested', true);
      if (error) {
        // ADDITIVE 컬럼 미적용 prod(42703) → 빈 목록 폴백(페이지 무파손).
        if (/blood_test_requested|42703/.test(error.message ?? '')) return [];
        throw error;
      }

      const map = new Map<string, BloodTargetRow>();
      for (const raw of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const ci = (raw['check_ins'] ?? {}) as Record<string, unknown>;
        const cid = String(ci['customer_id'] ?? '');
        // T-20260726-foot-EXAM-REQUEST-SAVE-BUG: 신청일 = 신청행 created_at(실제 신청시각). created_at 결측 시 내원일 폴백.
        const requestedAt = (raw['created_at'] ?? ci['checked_in_at']) as string | undefined;
        if (!cid || !requestedAt || raw['blood_test_requested'] !== true) continue;
        const reqDate = seoulISODate(requestedAt);
        const key = rowKey(cid, reqDate);
        if (map.has(key)) continue;
        map.set(key, {
          customerId: cid,
          customerName: String(ci['customer_name'] ?? '—'),
          chartNumber: null,
          phone: null,
          birthDate: null,
          requestDate: reqDate,
          checkInId: raw['check_in_id'] ? String(raw['check_in_id']) : null,
        });
      }

      const rows = [...map.values()];
      if (rows.length === 0) return [];

      // 차트번호·연락처·생년 보강(read-only). 실패해도 목록 표시.
      try {
        const ids = [...new Set(rows.map((r) => r.customerId))];
        const { data: custs } = await supabase
          .from('customers')
          .select('id, chart_number, phone, birth_date')
          .in('id', ids);
        const metaMap = new Map<string, { chart: string | null; phone: string | null; birth: string | null }>();
        for (const c of (custs ?? []) as Array<{ id: string; chart_number: string | null; phone: string | null; birth_date: string | null }>) {
          if (c.id) metaMap.set(c.id, { chart: c.chart_number ?? null, phone: c.phone ?? null, birth: c.birth_date ?? null });
        }
        for (const r of rows) {
          const meta = metaMap.get(r.customerId);
          r.chartNumber = meta?.chart ?? null;
          r.phone = meta?.phone ?? null;
          r.birthDate = meta?.birth ?? null;
        }
      } catch {
        // 보강 실패 — 무시.
      }

      // 생년월일 결측분 RRN 파생 폴백(ExamTargetsSection.useExamBirthdates 미러, PHI 표시값만).
      try {
        const missing = [...new Set(rows.filter((r) => !r.birthDate).map((r) => r.customerId))];
        if (missing.length > 0) {
          const birthMap = new Map<string, string>();
          for (let i = 0; i < missing.length; i += 200) {
            const chunk = missing.slice(i, i + 200);
            const { data: bd, error: be } = await supabase.rpc('fn_customer_birthdates', { p_clinic_id: clinicId, p_ids: chunk });
            if (be) continue;
            for (const row of (bd ?? []) as { customer_id: string; birth_date_display: string | null }[]) {
              if (row.birth_date_display) birthMap.set(row.customer_id, row.birth_date_display);
            }
          }
          for (const r of rows) {
            if (!r.birthDate && birthMap.has(r.customerId)) r.birthDate = birthMap.get(r.customerId) ?? null;
          }
        }
      } catch {
        // 폴백 실패 — 무시(생년 '—' 표기).
      }

      // 검사일자 오름차순(오래된 것 먼저 — mockup 7.22→7.24), 동일자 이름 가나다순.
      rows.sort((a, b) => a.requestDate.localeCompare(b.requestDate) || a.customerName.localeCompare(b.customerName, 'ko'));
      return rows;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// 접수/서류수령 영속 상태 — form_submissions(form_key=blood_reception_daily) read. 키=customer_id×request_date.
function useBloodReceptions(clinicId: string | null | undefined) {
  return useQuery<Map<string, ReceptionState>>({
    queryKey: ['blood_receptions', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const map = new Map<string, ReceptionState>();
      if (!clinicId) return map;
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, customer_id, field_data')
        .eq('clinic_id', clinicId)
        .contains('field_data', { form_key: FORM_KEY });
      if (error) {
        if (/form_submissions|relation|42P01|42703/.test(error.message ?? '')) return map;
        throw error;
      }
      for (const r of (data ?? []) as Array<{ id: string; customer_id: string; field_data: Record<string, unknown> | null }>) {
        const fd = r.field_data ?? {};
        const cid = String(r.customer_id ?? '');
        const reqDate = String(fd['request_date'] ?? '');
        if (!cid || !reqDate) continue;
        map.set(rowKey(cid, reqDate), {
          id: r.id,
          received: fd['received'] === true,
          receiverName: String(fd['receiver_name'] ?? ''),
          docsReceived: fd['docs_received'] === true,
        });
      }
      return map;
    },
    refetchInterval: 60_000,
    staleTime: 10_000,
  });
}

// 접수/서류수령/접수자명 저장 — 없으면 INSERT, 있으면 UPDATE(field_data 병합). 낙관적 캐시 반영.
function usePersistReception(clinicId: string | null | undefined) {
  const qc = useQueryClient();
  const key = ['blood_receptions', clinicId] as const;
  return useMutation({
    mutationFn: async ({ row, patch }: { row: BloodTargetRow; patch: Partial<Omit<ReceptionState, 'id'>> }) => {
      if (!clinicId) throw new Error('클리닉 정보가 없습니다.');
      const cache = qc.getQueryData<Map<string, ReceptionState>>(key);
      const cur = cache?.get(rowKey(row.customerId, row.requestDate));
      const merged = {
        received: patch.received ?? cur?.received ?? false,
        receiverName: patch.receiverName ?? cur?.receiverName ?? '',
        docsReceived: patch.docsReceived ?? cur?.docsReceived ?? false,
      };
      const fieldData = {
        form_key: FORM_KEY,
        request_date: row.requestDate,
        received: merged.received,
        receiver_name: merged.receiverName,
        docs_received: merged.docsReceived,
      };
      if (cur?.id) {
        const { error } = await supabase.from('form_submissions').update({ field_data: fieldData }).eq('id', cur.id);
        if (error) throw error;
        return { id: cur.id };
      }
      const { data, error } = await supabase
        .from('form_submissions')
        .insert({
          clinic_id: clinicId,
          customer_id: row.customerId,
          check_in_id: row.checkInId,
          template_id: null,
          field_data: fieldData,
          status: 'draft',
        })
        .select('id')
        .single();
      if (error) throw error;
      return { id: (data as { id: string }).id };
    },
    onMutate: async ({ row, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Map<string, ReceptionState>>(key);
      const rk = rowKey(row.customerId, row.requestDate);
      const next = new Map(prev ?? []);
      const cur = next.get(rk) ?? { id: null, received: false, receiverName: '', docsReceived: false };
      next.set(rk, { ...cur, ...patch });
      qc.setQueryData(key, next);
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(`저장 실패: ${e.message}`);
    },
    onSuccess: ({ id }, { row }) => {
      // INSERT 로 새로 생긴 id 를 캐시에 반영(다음 편집이 UPDATE 경로 타도록).
      const rk = rowKey(row.customerId, row.requestDate);
      const cache = qc.getQueryData<Map<string, ReceptionState>>(key);
      if (cache && !cache.get(rk)?.id) {
        const next = new Map(cache);
        next.set(rk, { ...(next.get(rk) ?? { received: false, receiverName: '', docsReceived: false }), id });
        qc.setQueryData(key, next);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

// 체크박스 버튼 — 미완료(빨간테두리 빈칸) / 완료(체크). tone 에 따라 체크색 분기.
function LabCheckbox({
  checked,
  tone,
  onToggle,
  testid,
  ariaLabel,
}: {
  checked: boolean;
  tone: 'red' | 'green';
  onToggle: () => void;
  testid: string;
  ariaLabel: string;
}) {
  const checkColor = tone === 'green' ? 'text-green-600' : 'text-red-600';
  const borderColor = checked
    ? tone === 'green'
      ? 'border-green-500'
      : 'border-red-500'
    : 'border-red-500'; // 미완료 = 빨간테두리(공통)
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={ariaLabel}
      aria-checked={checked}
      role="checkbox"
      data-testid={testid}
      data-checked={checked ? 'true' : 'false'}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-[3px] border-2 bg-white transition hover:bg-black/5 ${borderColor}`}
    >
      {checked && <Check className={`h-4 w-4 ${checkColor}`} strokeWidth={3} />}
    </button>
  );
}

// 접수자명 셀 — 입력(blur 저장). 서버값 변경 시 key 로 리셋.
function ReceiverNameCell({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  return (
    <input
      key={value}
      type="text"
      defaultValue={value}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() !== value.trim()) onCommit(text.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      placeholder="접수자"
      data-testid="blood-receiver-input"
      className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-[13px] text-red-700 placeholder:text-red-300 focus:border-red-300 focus:bg-white focus:outline-none"
    />
  );
}

interface Props {
  date: string;
  nameInteraction: NameInteraction;
}

export default function BloodDailyListSection({ date, nameInteraction }: Props) {
  const clinic = useClinic();
  const { data: rows = [], isLoading, isError, error } = useBloodTargets(clinic?.id, date);
  const { data: receptions } = useBloodReceptions(clinic?.id);
  const persist = usePersistReception(clinic?.id);

  const getState = (r: BloodTargetRow): ReceptionState =>
    receptions?.get(rowKey(r.customerId, r.requestDate)) ?? { id: null, received: false, receiverName: '', docsReceived: false };

  const totalCount = rows.length;
  const doneCount = useMemo(
    () => rows.filter((r) => getState(r).docsReceived).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, receptions],
  );

  return (
    <div className="flex flex-col gap-2" data-testid="blood-daily-section">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Droplet className="h-4 w-4 text-rose-600" />
          피검사 일일 진행 리스트
        </p>
        {totalCount > 0 && (
          <span className="shrink-0 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700" data-testid="blood-daily-count">
            대상 {totalCount}명 · 서류수령 {doneCount}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 p-4 text-center text-sm text-red-600">
          조회 중 오류가 발생했습니다. {(error as Error)?.message ?? ''}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="blood-daily-empty">
          <Droplet className="h-5 w-5 text-muted-foreground/40" />
          해당 기간에 피검사를 신청한 환자가 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background" data-testid="blood-daily-table">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b text-center text-[12px] font-semibold text-foreground">
                <th className="border-r px-2 py-2 whitespace-nowrap bg-muted/30 w-12">순서</th>
                <th className="border-r px-2 py-2 whitespace-nowrap bg-muted/30">검사일자</th>
                <th className="border-r px-2 py-2 whitespace-nowrap bg-muted/30">환자명</th>
                <th className="border-r px-2 py-2 whitespace-nowrap bg-muted/30">차트번호</th>
                <th className="border-r px-2 py-2 whitespace-nowrap bg-muted/30">생년월일</th>
                <th className="border-r px-2 py-2 whitespace-nowrap bg-pink-100 text-red-700">접수여부</th>
                <th className="border-r px-2 py-2 whitespace-nowrap bg-pink-100 text-red-700">접수자명</th>
                <th className="px-2 py-2 whitespace-nowrap bg-yellow-100 text-yellow-800">서류수령여부</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const st = getState(r);
                return (
                  <tr key={rowKey(r.customerId, r.requestDate)} className="border-b last:border-0 text-center" data-testid="blood-daily-row">
                    <td className="border-r px-2 py-1.5 tabular-nums text-muted-foreground">{idx + 1}</td>
                    <td className="border-r px-2 py-1.5 tabular-nums whitespace-nowrap">{testDateLabel(r.requestDate)}</td>
                    <td className="border-r px-2 py-1.5 whitespace-nowrap">
                      {/* 좌클릭=2번차트 / 우클릭=CRM 컨텍스트 메뉴(부모 위임, 신규 정의 0) */}
                      <button
                        type="button"
                        className="rounded px-1 font-medium hover:text-teal-700 hover:underline"
                        data-testid="blood-name-clickable"
                        onClick={() => nameInteraction.onLeftClick(r.customerId)}
                        onContextMenu={(e) => nameInteraction.onContextMenu(e, { id: r.customerId, name: r.customerName, phone: r.phone })}
                      >
                        {r.customerName}
                      </button>
                    </td>
                    <td className="border-r px-2 py-1.5 whitespace-nowrap font-mono text-[12px] text-muted-foreground">{chartNoBadge(r.chartNumber)}</td>
                    <td className="border-r px-2 py-1.5 tabular-nums whitespace-nowrap">{birth6(r.birthDate)}</td>
                    {/* 접수여부 — 핑크 배경 / 빨간 체크 */}
                    <td className="border-r px-2 py-1.5 bg-pink-50">
                      <LabCheckbox
                        checked={st.received}
                        tone="red"
                        testid="blood-received-checkbox"
                        ariaLabel={`${r.customerName} 접수여부`}
                        onToggle={() => persist.mutate({ row: r, patch: { received: !st.received } })}
                      />
                    </td>
                    {/* 접수자명 — 핑크 배경 / 빨강 텍스트 */}
                    <td className="border-r px-1 py-1 bg-pink-50">
                      <ReceiverNameCell value={st.receiverName} onCommit={(v) => persist.mutate({ row: r, patch: { receiverName: v } })} />
                    </td>
                    {/* 서류수령여부 — 노랑 배경 / 녹색 체크 */}
                    <td className="px-2 py-1.5 bg-yellow-50">
                      <LabCheckbox
                        checked={st.docsReceived}
                        tone="green"
                        testid="blood-docs-checkbox"
                        ariaLabel={`${r.customerName} 서류수령여부`}
                        onToggle={() => persist.mutate({ row: r, patch: { docsReceived: !st.docsReceived } })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
