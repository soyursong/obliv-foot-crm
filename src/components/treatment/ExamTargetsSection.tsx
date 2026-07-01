// ExamTargetsSection.tsx — 치료테이블 §B '균검사 & 피검사 대상자'
// Ticket: T-20260620-foot-TREATTABLE-2SECTION-REVAMP (AC-4)
// Ticket: T-20260622-foot-TREATTABLE-ADDON-COMPACT-DATEFILTER (A컴팩트/B날짜필터/C검사결과/D이름)
// Ticket: T-20260622-foot-EXAMTARGET-COMPACT-DATELIST-RESULT-NAV (정밀화 후속)
//   AC-1 컴팩트화 — 밀도만 압축(내용 보존). 행 height/padding/leading 축소, 폰트는 가독 최소 유지.
//     (RESVCAL-COMPACT-CONTENT-KEEP 동일 원칙: 폰트 과압축 금지 ≥11px, 정보 항목 삭제 0.)
//   AC-2 일자별 리스트 — 단일 명단 → 검사신청일(check_ins.checked_in_at, KST) 기준 일자별 그룹핑.
//     기준일자 DISCOVERY 결론: '검사신청일' = checked_in_at. (진료콜 등재일은 자매 섹션 개념이라 검사신청엔 미적용.)
//     부모 공통 날짜선택기의 date 를 '윈도 끝'으로 보고 직전 WINDOW_DAYS 일을 일자별로 묶어 표시.
//   AC-3 검사신청→검사결과(신규생성) — ⚠ DISCOVERY 게이트(총괄 confirm 전까지 신규 백엔드 0).
//     · KOH    : 결과 저장모델 존재(form_submissions form_key='koh_result') → 발행본 '결과 보기'(KohResultDialog),
//                미발행 '결과 생성'(균검사 보고서 surface 재사용). 신청 boolean 과 분리된 별도 저장. ✓
//     · 혈액검사: 결과 저장모델 부재 → 신청 boolean 재사용 금지(요구사항). 별도 저장모델 신설 →
//                T-20260622-foot-BLOODTEST-RESULT-PUBLISH-BACKEND(B안 파일보관): patient_file_records 메타 +
//                documents 버킷 결과지 파일. '결과지 업로드'(0건) / '결과지 보기 (N)'(≥1건). DA GO 후 활성화.
//   AC-4 우클릭 = 기존 CRM 컨텍스트 메뉴 그대로(부모 nameInteraction.onContextMenu 위임, 신규 정의 0).
//   AC-5 좌클릭 = 2번차트 오픈(부모 nameInteraction.onLeftClick → useChart, 재사용).
//
// 리스트업: check_in_services 의 koh_requested / blood_test_requested=true 인 환자. (BLOODTEST-TOGGLE-ADD /
//   KOHTEST-LIFECYCLE SSOT read-only 재사용 — 신규 스키마 0, ADDITIVE 소비.) 환자×검사신청일 = 1행.
// 방어성: koh_requested/blood_test_requested 는 ADDITIVE(마이그 미적용 prod 42703) → 폴백 빈 목록.

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import { useClinic } from '@/hooks/useClinic';
import { chartNoBadge, seoulISODate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import KohResultDialog from '@/components/KohResultDialog';
import BloodResultDialog from '@/components/BloodResultDialog';
// T-20260630-foot-KOHEXAM-ISSUE-RELOCATE-TXTABLE [1]: 균검사 '채취조갑 선택 + 발급하기' 를
//   진료대시보드(KohReportTab)에서 치료테이블(본 섹션)로 이전. 발급 '동작' 로직은 기존 SSOT 재사용 —
//   순수 헬퍼(buildKohFieldData/포맷/파서)는 KohReportTab 에서 import(정본 유지, 재구현 0),
//   조갑부위 저장(set_koh_nail_sites)·발급(publish_koh_result) RPC 도 동일 호출(중복발급 방지 idempotent 유지).
import {
  buildKohFieldData,
  formatNailSites,
  formatNailSitesShort,
  parseNailSites,
  sortNailSites,
  type KohRow,
  type NailSite,
  type NailSide,
} from '@/components/doctor/KohReportTab';
import { Loader2, FlaskConical, Droplet, ClipboardList, FileText, CalendarDays, Upload, ChevronRight, ChevronDown, FileCheck2 } from 'lucide-react';
import type { NameInteraction } from '@/pages/TreatmentTable';

// AC-2: 일자별 리스트 윈도(검사신청일 기준 직전 N일). 검사결과는 수일 뒤 회신되므로 단일일 → 2주 윈도.
const WINDOW_DAYS = 14;

interface ExamTargetRow {
  customerId: string;
  customerName: string;
  chartNumber: string | null;
  phone: string | null;
  birthDate: string | null; // RELOCATE[1]: 발급 field_data 생년월일(정규 birth_date). 결측 시 RRN 파생 폴백.
  kohRequested: boolean;
  bloodRequested: boolean;
  kohServiceId: string | null; // C: 발행본(koh_service_id) lookup 키 + RELOCATE[1] 조갑저장/발급 대상 서비스 id
  kohNailSites: NailSite[]; // RELOCATE[1]: 채취조갑(koh_nail_sites) — 치료테이블에서 선택·발급.
  kohCreatedAt: string | null; // RELOCATE[1]: KOH 검사일(created_at) — 발급 field_data 검체채취일/의뢰일.
  requestDate: string; // AC-2: 검사신청일(KST YYYY-MM-DD)
}

interface ExamDateGroup {
  date: string; // YYYY-MM-DD (KST)
  rows: ExamTargetRow[];
}

// AC-2: date(윈도 끝) 기준 직전 WINDOW_DAYS 일 범위. [start 00:00 KST, end 23:59 KST].
function windowBounds(endDate: string) {
  const start = format(subDays(new Date(endDate + 'T12:00:00'), WINDOW_DAYS - 1), 'yyyy-MM-dd');
  return { startTs: `${start}T00:00:00+09:00`, endTs: `${endDate}T23:59:59+09:00`, start };
}

// check_in_services(koh_requested|blood_test_requested=true) → 환자×검사신청일별 1행, 일자별 그룹.
function useExamTargets(clinicId: string | null | undefined, date: string) {
  return useQuery<ExamDateGroup[]>({
    queryKey: ['exam_targets', clinicId, date],
    enabled: !!clinicId,
    queryFn: async () => {
      if (!clinicId) return [];
      const { startTs, endTs } = windowBounds(date);
      // RELOCATE[1]: koh_nail_sites(조갑부위) + created_at(검사일) 추가 — 치료테이블 발급에 필요.
      //   koh_nail_sites 는 ADDITIVE(마이그 20260612160000) — 미적용 prod 42703 → 아래 폴백 regex 로 흡수.
      const SEL =
        'id, koh_requested, blood_test_requested, koh_nail_sites, created_at, check_in_id, ' +
        'check_ins!inner(customer_id, customer_name, clinic_id, status, checked_in_at)';
      const { data, error } = await supabase
        .from('check_in_services')
        .select(SEL)
        .eq('check_ins.clinic_id', clinicId)
        .neq('check_ins.status', 'cancelled')
        .gte('check_ins.checked_in_at', startTs)
        .lte('check_ins.checked_in_at', endTs)
        .or('koh_requested.eq.true,blood_test_requested.eq.true');
      if (error) {
        // ADDITIVE 컬럼 미적용 prod(42703) → 빈 목록 폴백(페이지 무파손).
        if (/koh_requested|blood_test_requested|koh_nail_sites|42703/.test(error.message ?? '')) return [];
        throw error;
      }

      // 환자×검사신청일별 집계 — 같은 환자라도 신청일이 다르면 별도 행(일자별 추적). koh service id 보존.
      const map = new Map<string, ExamTargetRow>();
      for (const raw of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const ci = (raw['check_ins'] ?? {}) as Record<string, unknown>;
        const cid = String(ci['customer_id'] ?? '');
        const checkedAt = ci['checked_in_at'];
        if (!cid || !checkedAt) continue;
        const koh = raw['koh_requested'] === true;
        const blood = raw['blood_test_requested'] === true;
        if (!koh && !blood) continue;
        const reqDate = seoulISODate(checkedAt as string); // AC-2: KST 검사신청일
        const svcId = String(raw['id'] ?? '');
        const key = `${cid}__${reqDate}`;
        const prev = map.get(key);
        if (prev) {
          prev.kohRequested = prev.kohRequested || koh;
          prev.bloodRequested = prev.bloodRequested || blood;
          // RELOCATE[1]: KOH 서비스(신청)의 id·조갑부위·검사일을 함께 귀속(첫 KOH 서비스 기준).
          if (koh && !prev.kohServiceId) {
            prev.kohServiceId = svcId || null;
            prev.kohNailSites = parseNailSites(raw['koh_nail_sites']);
            prev.kohCreatedAt = raw['created_at'] ? String(raw['created_at']) : null;
          }
        } else {
          map.set(key, {
            customerId: cid,
            customerName: String(ci['customer_name'] ?? '—'),
            chartNumber: null,
            phone: null,
            birthDate: null,
            kohRequested: koh,
            bloodRequested: blood,
            kohServiceId: koh ? svcId || null : null,
            kohNailSites: koh ? parseNailSites(raw['koh_nail_sites']) : [],
            kohCreatedAt: koh && raw['created_at'] ? String(raw['created_at']) : null,
            requestDate: reqDate,
          });
        }
      }

      const rows = [...map.values()];
      if (rows.length === 0) return [];

      // 차트번호·연락처 보강(read-only). 실패해도 목록은 표시.
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
        // 보강 실패 — 무시(이름·검사상태는 정상 표시).
      }

      // AC-2: 일자별 그룹핑(최근 신청일 먼저), 그룹 내 이름 가나다순.
      const groupMap = new Map<string, ExamTargetRow[]>();
      for (const r of rows) {
        const g = groupMap.get(r.requestDate);
        if (g) g.push(r);
        else groupMap.set(r.requestDate, [r]);
      }
      const groups: ExamDateGroup[] = [...groupMap.entries()]
        .map(([d, gr]) => ({
          date: d,
          rows: gr.sort((a, b) => a.customerName.localeCompare(b.customerName, 'ko')),
        }))
        .sort((a, b) => b.date.localeCompare(a.date)); // 최근 신청일 먼저
      return groups;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// C: 발행된 KOH 결과지 인덱스(koh_service_id → field_data). KohReportTab usePublishedKoh 와 동일 SSOT read-only.
function usePublishedKohMap(clinicId: string | null | undefined) {
  return useQuery<Map<string, Record<string, unknown>>>({
    queryKey: ['koh_published', clinicId], // KohReportTab 와 동일 키 — 발행 시 invalidate 공유(read-after-write).
    enabled: !!clinicId,
    queryFn: async () => {
      const map = new Map<string, Record<string, unknown>>();
      if (!clinicId) return map;
      const { data: tpl } = await supabase
        .from('form_templates')
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('form_key', 'koh_result')
        .limit(1)
        .maybeSingle();
      if (!tpl?.id) return map;
      const { data, error } = await supabase
        .from('form_submissions')
        .select('id, field_data')
        .eq('clinic_id', clinicId)
        .eq('template_id', tpl.id)
        .eq('status', 'published');
      if (error) throw error;
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const fd = (r['field_data'] ?? {}) as Record<string, unknown>;
        const sid = String(fd['koh_service_id'] ?? '');
        if (sid) map.set(sid, fd);
      }
      return map;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// 혈액검사 결과지 인덱스(customer_id → 등록 건수). patient_file_records(kind='blood_result') read-only.
//   '결과지 업로드'(0건) vs '결과지 보기'(≥1건) 라벨 분기 + 발행본 read-after-write(invalidate 공유 키).
//   방어성: 테이블 미적용 prod(42P01/42703) → 빈 Map 폴백(섹션 무파손).
function useBloodResultCounts(clinicId: string | null | undefined) {
  return useQuery<Map<string, number>>({
    queryKey: ['blood_result_counts', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const map = new Map<string, number>();
      if (!clinicId) return map;
      const { data, error } = await supabase
        .from('patient_file_records')
        .select('customer_id')
        .eq('clinic_id', clinicId)
        .eq('kind', 'blood_result');
      if (error) {
        if (/patient_file_records|relation|42P01|42703/.test(error.message ?? '')) return map;
        throw error;
      }
      for (const r of (data ?? []) as Array<{ customer_id: string }>) {
        const cid = String(r.customer_id ?? '');
        if (cid) map.set(cid, (map.get(cid) ?? 0) + 1);
      }
      return map;
    },
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RELOCATE[1]: 균검사 조갑부위 저장 + 발급 — 진료대시보드에서 치료테이블로 이전한 '동작' 로직.
//   기존 SSOT RPC(set_koh_nail_sites / publish_koh_result) 동일 호출. 발급 후 진료대시보드
//   읽기전용 리스트(KohReportTab: koh_published/koh_report 키)에 즉시 반영되도록 교차 invalidate.
//   중복발급 방지 = 서버 RPC(publish_koh_result) idempotent + FE 발행완료 분기(버튼 자체 미노출) 이중.
// ─────────────────────────────────────────────────────────────────────────────
function useSaveKohNailSites() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serviceId, sites }: { serviceId: string; sites: NailSite[] }) => {
      const { error } = await supabase.rpc('set_koh_nail_sites', { p_service_id: serviceId, p_sites: sites });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam_targets'] });
      qc.invalidateQueries({ queryKey: ['koh_report'] }); // 진료대시보드 균검사지 채취부위 read-only 동기화
    },
    onError: (e: Error) => toast.error(`조갑부위 저장 실패: ${e.message}`),
  });
}

function usePublishKohFromTx(clinicId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serviceId, fieldData }: { serviceId: string; fieldData: Record<string, string> }) => {
      const { data, error } = await supabase.rpc('publish_koh_result', {
        p_check_in_service_id: serviceId,
        p_field_data: fieldData,
      });
      if (error) throw error;
      return data as { id: string; request_no: string; specimen_no: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['koh_published', clinicId] }); // 양쪽 발급여부 read-after-write
      qc.invalidateQueries({ queryKey: ['exam_targets'] });
    },
  });
}

// 생년월일 서버 파생 폴백(customers.birth_date NULL → RRN 세기코드 파생). KohReportTab.useKohBirthdates 미러.
//   PHI: birth_date_display(표시값)만 수신 — 평문 RRN 미노출. RPC 실패 청크는 건너뜀(정규 경로 유지).
function useExamBirthdates(clinicId: string | null | undefined, ids: string[]) {
  return useQuery<Map<string, string>>({
    queryKey: ['exam_koh_birthdates', clinicId, ids],
    enabled: !!clinicId && ids.length > 0,
    queryFn: async () => {
      const birthMap = new Map<string, string>();
      if (!clinicId || ids.length === 0) return birthMap;
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { data, error } = await supabase.rpc('fn_customer_birthdates', { p_clinic_id: clinicId, p_ids: chunk });
        if (error) continue;
        for (const row of (data ?? []) as { customer_id: string; birth_date_display: string | null }[]) {
          if (row.birth_date_display) birthMap.set(row.customer_id, row.birth_date_display);
        }
      }
      return birthMap;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// 당일 진료의명 인덱스(customer_id|visit_date → 진료의 Set). medical_charts.signing_doctor_name read-only.
//   KohReportTab.useKohSigningDoctorsByMonth 미러 — 단, 치료테이블 윈도(직전 WINDOW_DAYS)에 맞춰 범위 조회.
function useExamSigningDoctors(clinicId: string | null | undefined, date: string) {
  return useQuery<Map<string, Set<string>>>({
    queryKey: ['exam_koh_doctors', clinicId, date],
    enabled: !!clinicId,
    queryFn: async () => {
      const map = new Map<string, Set<string>>();
      if (!clinicId) return map;
      const { start } = windowBounds(date);
      // visit_date(DATE) 사전식 범위 [start, date]. 검사결과 회신 지연 대비 윈도 그대로.
      const { data, error } = await supabase
        .from('medical_charts')
        .select('customer_id, visit_date, signing_doctor_name')
        .eq('clinic_id', clinicId)
        .gte('visit_date', start)
        .lte('visit_date', date);
      if (error) throw error;
      for (const raw of (data ?? []) as Array<{ customer_id: string | null; visit_date: string | null; signing_doctor_name: string | null }>) {
        const cid = raw.customer_id;
        const vd = raw.visit_date;
        const nm = (raw.signing_doctor_name ?? '').trim();
        if (!cid || !vd || !nm) continue;
        const dkey = `${cid}|${vd.slice(0, 10)}`;
        let set = map.get(dkey);
        if (!set) { set = new Set(); map.set(dkey, set); }
        set.add(nm);
      }
      return map;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** 행 → 당일 진료의명(customer_id + KOH 검사일 KST). 없으면 '미정'. 합집합 가나다순. */
function examDoctorName(r: ExamTargetRow, doctorMap: Map<string, Set<string>> | undefined): string {
  if (!r.customerId || !r.kohCreatedAt) return '미정';
  const set = doctorMap?.get(`${r.customerId}|${seoulISODate(r.kohCreatedAt)}`);
  if (!set || set.size === 0) return '미정';
  return [...set].sort((a, b) => a.localeCompare(b, 'ko')).join(', ');
}

// 조갑부위 입력 위젯(단일선택) — KohReportTab NailSiteEditor 이식(SINGLESEL-2FIX 규칙 동일).
//   좌발 L1~L5 | 우발 R1~R5 라디오형 토글. 같은 부위 재탭=해제, 다른 부위=교체. 즉시 저장(태블릿 동선).
const TOES = [1, 2, 3, 4, 5] as const;
const FEET: { side: NailSide; label: string; prefix: 'L' | 'R' }[] = [
  { side: 'Lt', label: '좌발', prefix: 'L' },
  { side: 'Rt', label: '우발', prefix: 'R' },
];
function NailSiteEditor({
  current,
  saving,
  onCommit,
}: {
  current: NailSite[];
  saving: boolean;
  onCommit: (sites: NailSite[]) => void;
}) {
  const [sites, setSites] = useState<NailSite[]>(() => sortNailSites(current));
  useEffect(() => {
    setSites(sortNailSites(current));
  }, [current]);
  const has = (side: NailSide, toe: number) => sites.some((s) => s.side === side && s.toe === toe);
  const isOnly = (side: NailSide, toe: number) =>
    sites.length === 1 && sites[0].side === side && sites[0].toe === toe;
  const toggle = (side: NailSide, toe: number) => {
    const next: NailSite[] = isOnly(side, toe) ? [] : [{ side, toe }];
    setSites(next);
    onCommit(next);
  };
  const btn = (active: boolean) =>
    `inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold transition disabled:opacity-50 ${
      active ? 'border-teal-600 bg-teal-600 text-white shadow-sm' : 'border-input bg-background text-foreground hover:bg-accent'
    }`;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="exam-nail-site-editor">
      {FEET.map((foot, idx) => (
        <div key={foot.side} className="flex items-center gap-1">
          {idx > 0 && <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true" />}
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{foot.label}</span>
          <div className="flex gap-0.5" data-testid={`exam-nail-foot-${foot.prefix}`}>
            {TOES.map((t) => (
              <button
                key={`${foot.prefix}${t}`}
                type="button"
                disabled={saving}
                onClick={() => toggle(foot.side, t)}
                className={btn(has(foot.side, t))}
                aria-pressed={has(foot.side, t)}
                data-testid={`exam-nail-${foot.prefix}${t}`}
              >
                {foot.prefix}{t}
              </button>
            ))}
          </div>
        </div>
      ))}
      <span className="text-xs font-medium text-muted-foreground">조갑</span>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  );
}

// 검사 박스 — 신청(●, 활성색) / 미신청(○, 회색). AC-1: py 축소(밀도↑), 폰트 11px 유지(가독).
function ExamBadge({
  label,
  active,
  tone,
  testid,
}: {
  label: string;
  active: boolean;
  tone: 'teal' | 'rose';
  testid: string;
}) {
  const Icon = tone === 'teal' ? FlaskConical : Droplet;
  const onCls =
    tone === 'teal'
      ? 'border-teal-300 bg-teal-50 text-teal-700'
      : 'border-rose-300 bg-rose-50 text-rose-700';
  const offCls = 'border-muted bg-muted/30 text-muted-foreground/60';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0 text-[11px] font-semibold leading-5 ${
        active ? onCls : offCls
      }`}
      data-testid={testid}
      data-active={active ? 'true' : 'false'}
    >
      <Icon className="h-3 w-3" />
      {label}
      <span className="text-[12px] leading-none">{active ? '●' : '○'}</span>
    </span>
  );
}

// AC-2: 일자 헤더 라벨 — "6월 23일 (월)" + 오늘 배지.
function dateLabel(d: string) {
  return format(new Date(d + 'T12:00:00'), 'M월 d일 (EEE)', { locale: ko });
}

interface Props {
  date: string;
  nameInteraction: NameInteraction;
}

export default function ExamTargetsSection({ date, nameInteraction }: Props) {
  const clinic = useClinic();
  const qc = useQueryClient();
  const { data: groups = [], isLoading, isError, error } = useExamTargets(clinic?.id, date);
  const { data: publishedKoh } = usePublishedKohMap(clinic?.id);
  const { data: bloodResultCounts } = useBloodResultCounts(clinic?.id);
  // RELOCATE[1]: 균검사 조갑저장·발급 + 발급 field_data 조인(진료의/생년 폴백).
  const saveNailSites = useSaveKohNailSites();
  const publishKoh = usePublishKohFromTx(clinic?.id);
  const { data: doctorMap } = useExamSigningDoctors(clinic?.id, date);
  const kohCustomerIds = useMemo(
    () => [...new Set(groups.flatMap((g) => g.rows).filter((r) => r.kohRequested).map((r) => r.customerId))].sort(),
    [groups],
  );
  const { data: birthMap } = useExamBirthdates(clinic?.id, kohCustomerIds);
  /** 유효 생년 — 정규 birth_date 우선, 결측 시 RRN 파생값. */
  const effectiveBirth = (r: ExamTargetRow): string | null => r.birthDate || (r.customerId ? birthMap?.get(r.customerId) ?? null : null);
  const [viewFieldData, setViewFieldData] = useState<Record<string, unknown> | null>(null);
  // 혈액검사 결과지 업로드/보기 다이얼로그 타겟(환자). null=닫힘.
  const [bloodTarget, setBloodTarget] = useState<{ id: string; name: string } | null>(null);
  // T-20260629-foot-TREATBL-COLLAPSE-TOGGLE: 날짜 그룹 아코디언. 펼쳐진 그룹 키(날짜) 집합.
  //   초기값 = 빈 Set → 전 그룹 접힘(▶). 화면 재진입 시 컴포넌트 remount → 자동 접힘 복귀(AC-2/시나리오2-3).
  //   그룹 독립 토글(AC-5) — 한 그룹 변경이 다른 그룹에 영향 없음.
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const toggleGroup = (d: string) =>
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  const totalCount = groups.reduce((sum, g) => sum + g.rows.length, 0);
  const today = seoulISODate(new Date());
  const { start } = windowBounds(date);

  // RELOCATE[1]: 균검사지 발급 — 진료대시보드(KohReportTab.handlePublish)에서 이전한 발급 동선.
  //   기존 로직 재사용: 조갑부위(nail_sites) + 생년월일 게이트 → buildKohFieldData → publish_koh_result RPC.
  //   중복발급 방지: 발행완료(kohPublished) 행은 버튼 미노출(도달 불가 방어) + 서버 RPC idempotent.
  //   태블릿 hover 부재 대응(SINGLESEL-2FIX): 발급 불가 시 silent return 금지 — 사유 toast 로 다음 행동 안내.
  const handleKohPublish = async (r: ExamTargetRow) => {
    if (!r.kohServiceId) return;
    if (r.kohServiceId && publishedKoh?.has(r.kohServiceId)) return; // 이미 발급 — 방어.
    if (r.kohNailSites.length === 0) {
      toast.error('채취 조갑부위를 먼저 선택(좌발/우발 버튼 클릭)해야 발급할 수 있습니다.');
      return;
    }
    if (!effectiveBirth(r)) {
      toast.error('환자 생년월일 정보가 없어 발급할 수 없습니다. 고객 정보에서 생년월일을 먼저 입력해주세요.');
      return;
    }
    if (!window.confirm(`${r.customerName} 님의 검사결과 보고서를 발급하시겠습니까?\n\n발급 후에는 수정·취소할 수 없습니다(비가역).`)) return;
    const doctorName = examDoctorName(r, doctorMap);
    // buildKohFieldData(정본) 재사용을 위해 KohRow 형태로 구성(발급에 필요한 필드만 유효).
    const kohRow: KohRow = {
      id: r.kohServiceId,
      service_name: '',
      created_at: r.kohCreatedAt ?? '',
      customer_id: r.customerId,
      customer_name: r.customerName,
      birth_date: r.birthDate,
      chart_number: r.chartNumber,
      nail_sites: r.kohNailSites,
      treatment_sites: [],
      koh_requested: r.kohRequested,
      therapist_id: null,
    };
    const fieldData = buildKohFieldData(kohRow, doctorName, effectiveBirth(r));
    try {
      await publishKoh.mutateAsync({ serviceId: r.kohServiceId, fieldData });
      toast.success([r.customerName, r.chartNumber].filter(Boolean).join(' ') + ' 발급완료');
    } catch (e) {
      toast.error(`발급 실패: ${(e as Error).message}`);
    }
  };

  // 한 환자 행 렌더(그룹 공통).
  const renderRow = (r: ExamTargetRow, idx: number) => {
    const kohFd = r.kohServiceId ? publishedKoh?.get(r.kohServiceId) : undefined;
    const kohPublished = !!kohFd;
    const bloodResultCount = bloodResultCounts?.get(r.customerId) ?? 0;
    const hasBloodResult = bloodResultCount > 0;
    const kohNailText = formatNailSitesShort(r.kohNailSites); // 컴팩트 표기(R1), 결측 '—'
    const kohSaving = saveNailSites.isPending && saveNailSites.variables?.serviceId === r.kohServiceId;
    return (
      <tr
        key={`${r.customerId}-${r.requestDate}`}
        className="border-b last:border-0 transition-colors hover:bg-muted/30"
        data-testid="exam-targets-row"
      >
        <td className="px-2 py-1 text-[11px] tabular-nums text-muted-foreground">{idx + 1}</td>
        <td className="px-2 py-1 font-medium whitespace-nowrap">
          {/* AC-5 좌클릭=2번차트 / AC-4 우클릭=CRM 컨텍스트 메뉴 */}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 text-left hover:text-teal-700 hover:underline"
            data-testid="exam-name-clickable"
            onClick={() => nameInteraction.onLeftClick(r.customerId)}
            onContextMenu={(e) =>
              nameInteraction.onContextMenu(e, {
                id: r.customerId,
                name: r.customerName,
                phone: r.phone,
              })
            }
          >
            <span>{r.customerName}</span>
            <span className="font-mono text-[11px] font-normal text-muted-foreground/70">
              {chartNoBadge(r.chartNumber)}
            </span>
          </button>
        </td>
        {/* 검사별 [상태 박스 | 결과 동작]. T-20260630-KOHEXAM-RELOCATE-TXTABLE [3](재스펙 4q0l):
            균검사·피검사를 한 줄에 섞지 말고 두 줄로 시각 분리(점선 구분). 가독성 우선(dev 재량). */}
        <td className="px-2 py-1">
          <div className="flex flex-col gap-1" data-testid="exam-result-stack">
            {/* 균검사 줄 — RELOCATE[1]: 채취조갑 선택 + 발급하기(진료대시보드→치료테이블 이전).
                발행완료=결과 보기(read) / 미발행+신청=조갑부위 선택 위젯 + 발급하기 버튼. */}
            <div className="flex flex-col gap-1" data-testid="exam-koh-group">
              <div className="flex items-center gap-1.5">
                <ExamBadge label="균검사" active={r.kohRequested} tone="teal" testid="exam-koh-badge" />
                {r.kohRequested &&
                  (kohPublished ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 gap-1 px-1.5 text-[11px]"
                      data-testid="exam-koh-result-view"
                      onClick={() => setViewFieldData(kohFd!)}
                      title="발행된 균검사 결과 보기"
                    >
                      <FileText className="h-3 w-3" /> 결과 보기
                    </Button>
                  ) : (
                    <>
                      {/* 채취부위 요약(R1) — 저장값 read. 발급 전 확인용. */}
                      <span
                        className={`text-[11px] font-semibold tabular-nums ${
                          r.kohNailSites.length > 0 ? 'text-foreground' : 'text-muted-foreground/60'
                        }`}
                        data-testid="exam-koh-nail-text"
                        title={r.kohNailSites.length > 0 ? formatNailSites(r.kohNailSites) : undefined}
                      >
                        {kohNailText}
                      </span>
                      <Button
                        size="sm"
                        className="h-6 gap-1 px-1.5 text-[11px] bg-neutral-800 text-white hover:bg-neutral-900 disabled:opacity-40"
                        data-testid="exam-koh-issue-btn"
                        onClick={() => handleKohPublish(r)}
                        disabled={publishKoh.isPending}
                        data-publishable={r.kohNailSites.length > 0 && !!effectiveBirth(r) ? 'true' : 'false'}
                        title={
                          r.kohNailSites.length === 0
                            ? '채취 조갑부위를 먼저 선택해야 발급할 수 있습니다 (눌러서 안내 보기)'
                            : !effectiveBirth(r)
                              ? '환자 생년월일 미입력 — 발급 불가 (눌러서 안내 보기)'
                              : '검사결과 보고서 발급(비가역)'
                        }
                      >
                        <FileCheck2 className="h-3 w-3" /> 발급하기
                      </Button>
                    </>
                  ))}
              </div>
              {/* 채취조갑 선택 위젯 — 신청 + 미발행 상태에서만(발행 후 비가역). */}
              {r.kohRequested && !kohPublished && (
                <NailSiteEditor
                  current={r.kohNailSites}
                  saving={kohSaving}
                  onCommit={(sites) => {
                    if (r.kohServiceId) saveNailSites.mutate({ serviceId: r.kohServiceId, sites });
                  }}
                />
              )}
            </div>
            {/* 피검사 — 결과지 업로드(B안 파일보관). 등록 0건=업로드 / ≥1건=보기. T-...-BLOODTEST-RESULT-PUBLISH-BACKEND
                [3] 균검사 줄과 점선으로 분리(두 줄 표기) — 한 줄에 섞여 보이지 않게. */}
            <div
              className="flex items-center gap-1.5 border-t border-dashed border-muted/70 pt-1"
              data-testid="exam-blood-group"
            >
              <ExamBadge label="피검사" active={r.bloodRequested} tone="rose" testid="exam-blood-badge" />
              {r.bloodRequested &&
                (hasBloodResult ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 px-1.5 text-[11px]"
                    data-testid="exam-blood-result-view"
                    onClick={() => setBloodTarget({ id: r.customerId, name: r.customerName })}
                    title="등록된 혈액검사 결과지 보기"
                  >
                    <FileText className="h-3 w-3" /> 결과지 보기 ({bloodResultCount})
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px] bg-rose-600 text-white hover:bg-rose-700"
                    data-testid="exam-blood-result-upload"
                    onClick={() => setBloodTarget({ id: r.customerId, name: r.customerName })}
                    title="혈액검사 결과지 업로드(PDF·JPG·PNG)"
                  >
                    <Upload className="h-3 w-3" /> 결과지 업로드
                  </Button>
                ))}
            </div>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-2" data-testid="exam-targets-section">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ClipboardList className="h-4 w-4 text-teal-600" />
            균검사 &amp; 피검사 대상자
          </p>
          {/* AC-2: 일자별 윈도 안내(검사신청일 기준 최근 N일) */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            검사신청일 기준 {dateLabel(start)} ~ {dateLabel(date)} 동안 균검사·피검사를 신청한 환자를
            일자별로 묶어 보여줍니다. 신청한 검사만 활성(●)으로 표시됩니다.
          </p>
        </div>
        {totalCount > 0 && (
          <span
            className="shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700"
            data-testid="exam-targets-count"
          >
            대상 {totalCount}명
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
      ) : groups.length === 0 ? (
        <div
          className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
          data-testid="exam-targets-empty"
        >
          <ClipboardList className="h-5 w-5 text-muted-foreground/40" />
          해당 기간에 균검사·피검사를 신청한 환자가 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {/* AC-2: 일자별 그룹 — 각 그룹 = 날짜 헤더 바(아코디언 토글) + 펼침 시 해당 일자 명단 테이블 */}
          {groups.map((g) => {
            const isOpen = expandedDates.has(g.date);
            return (
              <div
                key={g.date}
                className="overflow-hidden rounded-lg border bg-background"
                data-testid="exam-date-group"
                data-date={g.date}
                data-state={isOpen ? 'expanded' : 'collapsed'}
              >
                {/* AC-3: 헤더 클릭 = 펼침/접힘 토글. 좌측 chevron(▶ 접힘 / ▼ 펼침). */}
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 border-b bg-muted/40 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60"
                  data-testid="exam-date-group-header"
                  aria-expanded={isOpen}
                  onClick={() => toggleGroup(g.date)}
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    {isOpen ? (
                      <ChevronDown
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        data-testid="exam-date-group-chevron"
                        data-open="true"
                      />
                    ) : (
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        data-testid="exam-date-group-chevron"
                        data-open="false"
                      />
                    )}
                    <CalendarDays className="h-3.5 w-3.5 text-teal-600" />
                    {dateLabel(g.date)}
                    {g.date === today && (
                      <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        오늘
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-medium text-muted-foreground" data-testid="exam-date-group-count">
                    {g.rows.length}명
                  </span>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto" data-testid="exam-targets-table">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b bg-muted/20 text-left text-[11px] font-semibold text-muted-foreground">
                          <th className="px-2 py-1 whitespace-nowrap">#</th>
                          <th className="px-2 py-1 whitespace-nowrap">환자</th>
                          <th className="px-2 py-1 whitespace-nowrap">신청 검사 &amp; 검사결과</th>
                        </tr>
                      </thead>
                      <tbody>{g.rows.map((r, idx) => renderRow(r, idx))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* C: 발행된 KOH 결과지 보기 — 기존 KohResultDialog 재사용(read). */}
      <KohResultDialog
        open={viewFieldData !== null}
        onOpenChange={(v) => { if (!v) setViewFieldData(null); }}
        fieldData={viewFieldData}
      />

      {/* 혈액검사 결과지 업로드/보기 — B안 파일보관(patient_file_records). */}
      {bloodTarget && (
        <BloodResultDialog
          open={bloodTarget !== null}
          onOpenChange={(v) => {
            if (!v) {
              setBloodTarget(null);
              // 업로드/삭제 반영 — 라벨(업로드↔보기) 갱신을 위해 카운트 재조회.
              qc.invalidateQueries({ queryKey: ['blood_result_counts', clinic?.id] });
            }
          }}
          customerId={bloodTarget.id}
          customerName={bloodTarget.name}
        />
      )}
    </div>
  );
}
