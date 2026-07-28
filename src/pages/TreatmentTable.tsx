// TreatmentTable.tsx — 치료 테이블 (2섹션 전면 개편 + 4종 UX 증분)
// Ticket: T-20260620-foot-TREATTABLE-2SECTION-REVAMP (부모, deployed)
// Ticket: T-20260622-foot-TREATTABLE-ADDON-COMPACT-DATEFILTER (본건 — A컴팩트/B날짜필터/C검사결과생성/D이름인터랙션)
//
//   상단 탭(T-20260724-foot-TREATTABLE-TAB-ORDER-RENAME 재정렬 이후):
//     ① 진료(history)          → DoctorHistorySection (진료콜 등재 환자 + 처방전/소견·진단서 발행 O/X)
//     ② 소견서·진단서(diagdoc) → DiagDocSection
//     ③ 균검사(exam)           → ExamTargetsSection   (koh 신청 환자, 1환자 1행 검사박스)
//     ④ 피검사(blood)          → BloodDailyListSection
//     ⑤ 경과분석(progress)     → 하위 서브탭 2개(경과분석/경과분석 플랜)
//
//   본건 증분(ADDON):
//     A. 레이아웃 컴팩트화 — 각 섹션 테이블 여백·행간 축소(정보밀도 ↑).
//     B. 일자별 필터 — 탭 공통 단일 날짜선택기(권장 기본)를 부모가 소유, 양 섹션에 date prop 전달.
//        (pending_decision: 탭 공통 vs 섹션 독립 → 총괄 confirm. 현재=탭 공통 골격 선행.)
//     D. 이름 인터랙션 — 좌클릭=2번차트 open(useChart 단일 게이트), 우클릭=기존 CRM 컨텍스트 메뉴
//        (CustomerQuickMenu 재사용 — Dashboard/Reservations 동일 컴포넌트, 신규 메뉴 신설 0).
//        부모가 ctx-menu/진료차트/문자 상태를 소유하고 양 섹션에 NameInteraction 핸들러 전달.

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, subDays, addDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Stethoscope, ClipboardList, Calendar, ChevronLeft, ChevronRight, TrendingUp, Settings2, FileText, Droplet } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import DoctorHistorySection from '@/components/treatment/DoctorHistorySection';
import ExamTargetsSection from '@/components/treatment/ExamTargetsSection';
// T-20260724-foot-TREATTABLE-LABTAB-SPLIT-BLOODLIST: 기존 [균검사&피검사 대상자] 단일 탭을 [균검사]/[피검사] 2탭으로 분리.
//   균검사 = ExamTargetsSection 그대로 이관(회귀0). 피검사 = '피검사 일일 진행 리스트' 신규(8컬럼, form_submissions 재사용·no-DDL).
import BloodDailyListSection from '@/components/treatment/BloodDailyListSection';
import ProgressTargetsSection from '@/components/treatment/ProgressTargetsSection';
// T-20260629-foot-PROGRESSPLAN-TAB-MOVE-TREATTABLE: 진료관리에서 이식한 '경과분석 플랜'(설정) 탭 = ④번째(맨 뒤).
//   ③경과분석(ProgressTargetsSection=오늘 대상자)과 별개 surface. 자체 useClinic 사용(props 불요). 컴포넌트·DB 동일.
import ProgressPlansTab from '@/components/admin/ProgressPlansTab';
// T-20260719-foot-DIAGDOC-TAB-DASHBOARD-SYNC: 진료대시보드 [서류작성] read-only ADDITIVE 재노출 탭(맨 뒤).
//   치료테이블(치료사 공간)에 소견서·진단서 신청/발행여부를 read-only 표시. opinionRequest.ts 훅 재사용(단일 소스).
import DiagDocSection from '@/components/treatment/DiagDocSection';
import { CustomerQuickMenu } from '@/components/CustomerQuickMenu';
import MedicalChartPanel from '@/components/MedicalChartPanel';
import SendSmsDialog from '@/components/SendSmsDialog';
// T-20260728-foot-ADMININFO-EDIT-TREATTABLE-ENTRY: 고객관리 행정정보 수정 다이얼로그 재사용(중복 구현 금지).
import { EditCustomerDialog } from '@/pages/Customers';
import { useChart } from '@/lib/chartContext';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { canAccess, isStaffUnlockRole } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import type { CheckIn, Customer } from '@/lib/types';

// T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경2]: 경과분석 탭 이식.
// T-20260629-foot-PROGRESSPLAN-TAB-MOVE-TREATTABLE: 경과분석 플랜(설정, 진료관리에서 이식). confirm 해소(문지은 대표원장 2026-06-29) → 랜딩.
// T-20260719-foot-DIAGDOC-TAB-DASHBOARD-SYNC: 소견서·진단서(진료대시보드 [서류작성] read-only 재노출).
// T-20260724-foot-TREATTABLE-TAB-ORDER-RENAME: 탭 진열순서 재정렬 + 명칭변경 + '경과분석 플랜' 중첩(순수 presentational, db 무변경).
//   A. 순서(왼→오): ①진료(history) ②소견서·진단서(diagdoc) ③균검사(exam) ④피검사(blood) ⑤경과분석(progress).
//   B. '진료 환자 이력' 라벨 → '진료' (라벨만; 탭 key=history·라우팅·DoctorHistorySection 컴포넌트 불변).
//   C. 구 top-level '경과분석 플랜'(plan) 탭 → '경과분석'(progress) 하위 서브탭으로 중첩.
//      콘텐츠 미합침 — 부모=경과분석, 하위 2서브탭 각각 유지:
//        서브탭1 '경과분석'(targets = ProgressTargetsSection = 오늘 대상자) / 서브탭2 '경과분석 플랜'(plan = ProgressPlansTab = 설정).
//      value="plan"·testid=tab-progress-plans·testid=tab-progress-targets 전량 보존(하위 서브탭으로 이동).
type SectionTab = 'history' | 'diagdoc' | 'exam' | 'blood' | 'progress';
/** C. 경과분석(progress) 부모 탭의 하위 서브탭 — 'targets'(오늘 대상자) / 'plan'(회차tier 체크포인트 설정). */
type ProgressSubTab = 'targets' | 'plan';

/** D. 이름 우클릭 컨텍스트 메뉴 타깃(섹션이 보유한 최소 고객 정보). */
export interface NameCtxTarget {
  id: string;
  name: string;
  phone?: string | null;
  visit_type?: 'new' | 'returning';
}

/** D. 양 섹션에 전달하는 이름 인터랙션 핸들러. */
export interface NameInteraction {
  onLeftClick: (customerId: string | null) => void;
  onContextMenu: (e: React.MouseEvent, c: NameCtxTarget) => void;
}

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd');
}

export default function TreatmentTable() {
  const [tab, setTab] = useState<SectionTab>('history');
  // C. 경과분석(progress) 부모 탭 하위 서브탭 상태 — 기본 'targets'(오늘 대상자).
  const [progressSub, setProgressSub] = useState<ProgressSubTab>('targets');

  // ── B. 탭 공통 단일 날짜선택기(권장 기본) — 부모 소유, 양 섹션 공유 ──
  const today = todayStr();
  const [date, setDate] = useState(today);
  const isToday = date === today;
  const goPrev = () => setDate(format(subDays(new Date(date + 'T12:00:00'), 1), 'yyyy-MM-dd'));
  const goNext = () => {
    const next = format(addDays(new Date(date + 'T12:00:00'), 1), 'yyyy-MM-dd');
    if (next <= today) setDate(next);
  };

  // ── D. 이름 인터랙션 배관(좌클릭=2번차트 / 우클릭=CRM 컨텍스트 메뉴 재사용) ──
  const clinic = useClinic();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { openChart } = useChart();
  const canSendSms = canAccess(profile, 'manual_sms_send');

  const [ctxMenu, setCtxMenu] = useState<{ checkIn: CheckIn; x: number; y: number } | null>(null);
  const [medChartCustomerId, setMedChartCustomerId] = useState<string | null>(null);
  const [smsTarget, setSmsTarget] = useState<CheckIn | null>(null);
  // T-20260728-foot-ADMININFO-EDIT-TREATTABLE-ENTRY: 행정정보 수정 — EditCustomerDialog 는 customer 객체 prop
  //   의존 → 진입 시 customer_id 로 customers 행 fetch 후 다이얼로그에 전달(부모 fetch→prop 패턴, AC-2).
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const openEditCustomer = useCallback(async (ci: CheckIn) => {
    if (!ci.customer_id) {
      toast('고객 정보가 없어 수정할 수 없습니다');
      return;
    }
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', ci.customer_id)
      .maybeSingle();
    if (error || !data) {
      toast.error('고객 정보를 불러오지 못했습니다');
      return;
    }
    setEditingCustomer(data as Customer);
  }, []);

  // CustomerQuickMenu 는 CheckIn 기반 — 섹션 행(고객 단위)을 CheckIn 형태로 변환(Customers.customerAsCheckIn 패턴).
  const targetAsCheckIn = useCallback(
    (c: NameCtxTarget): CheckIn =>
      ({
        id: `cust-${c.id}`,
        clinic_id: clinic?.id ?? '',
        customer_id: c.id,
        reservation_id: null,
        queue_number: null,
        customer_name: c.name,
        customer_phone: c.phone ?? null,
        visit_type: c.visit_type ?? 'returning',
        status: 'waiting',
        consultant_id: null,
        therapist_id: null,
        technician_id: null,
        consultation_room: null,
        treatment_room: null,
        laser_room: null,
        package_id: null,
        notes: null,
        treatment_memo: null,
        treatment_photos: null,
        doctor_note: null,
        examination_room: null,
        checked_in_at: new Date().toISOString(),
        called_at: null,
        completed_at: null,
        priority_flag: null,
        sort_order: 0,
        skip_reason: null,
        created_at: new Date().toISOString(),
      }) as unknown as CheckIn,
    [clinic?.id],
  );

  const nameInteraction: NameInteraction = {
    onLeftClick: (customerId) => {
      if (customerId) openChart(customerId); // 2번차트 단일 게이트(useChart)
    },
    onContextMenu: (e, c) => {
      e.preventDefault();
      if (!c.id) return;
      setCtxMenu({ checkIn: targetAsCheckIn(c), x: e.clientX, y: e.clientY });
    },
  };

  return (
    <div className="h-full overflow-auto flex flex-col gap-4 p-5">
      {/* 헤더 + 공통 날짜선택기(B) */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Stethoscope className="size-5 text-teal-600" />
          치료 테이블
        </h1>
        <div className="flex items-center gap-2" data-testid="treatment-date-nav">
          <Button variant="outline" size="icon-sm" onClick={goPrev} data-testid="treatment-date-prev">
            <ChevronLeft className="size-4" />
          </Button>
          <span
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium"
            data-testid="treatment-date-label"
          >
            <Calendar className="size-4 text-teal-600" />
            {format(new Date(date + 'T12:00:00'), 'M월 d일 (EEEE)', { locale: ko })}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={goNext}
            disabled={isToday}
            data-testid="treatment-date-next"
          >
            <ChevronRight className="size-4" />
          </Button>
          {!isToday && (
            <Button
              variant="ghost"
              size="sm"
              className="text-teal-600"
              onClick={() => setDate(today)}
              data-testid="treatment-date-today"
            >
              오늘
            </Button>
          )}
        </div>
      </div>

      {/* 2섹션 탭 */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as SectionTab)} className="flex flex-col gap-4">
        <TabsList data-testid="treatment-section-tabs">
          {/* ① 진료 — T-20260724 B: 라벨만 '진료'로 변경(구 라벨 대체). key=history·컴포넌트 불변. */}
          <TabsTrigger value="history" data-testid="tab-doctor-history">
            <Stethoscope className="size-3.5 mr-1.5" />
            진료
          </TabsTrigger>
          {/* ② 소견서·진단서 — T-20260719 DIAGDOC. T-20260724 A: ①진료 다음(2번째)으로 전진 배치. */}
          <TabsTrigger value="diagdoc" data-testid="tab-diagdoc">
            <FileText className="size-3.5 mr-1.5" />
            소견서·진단서
          </TabsTrigger>
          {/* ③ 균검사 — ExamTargetsSection(회귀0), testid 유지(LABTAB-SPLIT). */}
          <TabsTrigger value="exam" data-testid="tab-exam-targets">
            <ClipboardList className="size-3.5 mr-1.5" />
            균검사
          </TabsTrigger>
          {/* ④ 피검사 — 피검사 일일 진행 리스트(LABTAB-SPLIT). */}
          <TabsTrigger value="blood" data-testid="tab-blood-daily">
            <Droplet className="size-3.5 mr-1.5" />
            피검사
          </TabsTrigger>
          {/* ⑤ 경과분석(부모) — T-20260724 C: 하위 2서브탭(경과분석 / 경과분석 플랜) 보유. */}
          <TabsTrigger value="progress" data-testid="tab-progress">
            <TrendingUp className="size-3.5 mr-1.5" />
            경과분석
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="mt-0">
          <DoctorHistorySection date={date} nameInteraction={nameInteraction} />
        </TabsContent>
        {/* ② 소견서·진단서 — 부모 공통 날짜(date) 상속(AC-5) + 이름 인터랙션 위임. */}
        <TabsContent value="diagdoc" className="mt-0">
          <DiagDocSection date={date} nameInteraction={nameInteraction} />
        </TabsContent>
        <TabsContent value="exam" className="mt-0">
          <ExamTargetsSection date={date} nameInteraction={nameInteraction} />
        </TabsContent>
        {/* ④ 피검사 = 피검사 일일 진행 리스트(신규 8컬럼 양식). */}
        <TabsContent value="blood" className="mt-0">
          <BloodDailyListSection date={date} nameInteraction={nameInteraction} />
        </TabsContent>
        {/* ⑤ 경과분석(부모) — T-20260724-foot-TREATTABLE-TAB-ORDER-RENAME C:
            구 top-level 'plan'(경과분석 플랜) 탭을 여기 하위 서브탭으로 중첩. 콘텐츠 미합침 — 두 서브탭 각각 유지.
            서브탭1 '경과분석'(targets=ProgressTargetsSection=오늘 대상자, testid=tab-progress-targets 보존)
            서브탭2 '경과분석 플랜'(plan=ProgressPlansTab=회차tier 체크포인트 설정, value="plan"·testid=tab-progress-plans 보존) */}
        <TabsContent value="progress" className="mt-0">
          <Tabs
            value={progressSub}
            onValueChange={(v) => setProgressSub(v as ProgressSubTab)}
            className="flex flex-col gap-4"
          >
            <TabsList data-testid="progress-subtabs">
              <TabsTrigger value="targets" data-testid="tab-progress-targets">
                <TrendingUp className="size-3.5 mr-1.5" />
                경과분석
              </TabsTrigger>
              <TabsTrigger value="plan" data-testid="tab-progress-plans">
                <Settings2 className="size-3.5 mr-1.5" />
                경과분석 플랜
              </TabsTrigger>
            </TabsList>
            <TabsContent value="targets" className="mt-0">
              <ProgressTargetsSection date={date} nameInteraction={nameInteraction} />
            </TabsContent>
            {/* 경과분석 플랜(설정). ProgressPlansTab 는 useClinic 자체 사용(date/nameInteraction 불요) — 회차tier별 체크포인트 CRUD. */}
            <TabsContent value="plan" className="mt-0">
              <ProgressPlansTab />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>

      {/* D. 우클릭 CRM 컨텍스트 메뉴 — Dashboard/Reservations 와 동일 CustomerQuickMenu 재사용(신규 메뉴 0) */}
      {ctxMenu && (
        <CustomerQuickMenu
          checkIn={ctxMenu.checkIn}
          position={{ x: ctxMenu.x, y: ctxMenu.y }}
          onClose={() => setCtxMenu(null)}
          onOpenChart={(ci) => {
            if (ci.customer_id) openChart(ci.customer_id);
            setCtxMenu(null);
          }}
          onOpenMedicalChart={(ci) => {
            setMedChartCustomerId(ci.customer_id);
            setCtxMenu(null);
          }}
          onNewReservation={(ci) => {
            setCtxMenu(null);
            navigate('/admin/reservations', {
              state: {
                openReservationFor: {
                  customer_id: ci.customer_id,
                  name: ci.customer_name,
                  phone: ci.customer_phone ?? '',
                  visit_type: ci.visit_type,
                },
              },
            });
          }}
          onOpenPayment={() => {
            toast('대시보드에서 해당 환자 체크인 후 수납해주세요');
            setCtxMenu(null);
          }}
          onSendSms={canSendSms ? (ci) => { setSmsTarget(ci); setCtxMenu(null); } : undefined}
          /* T-20260728-foot-ADMININFO-EDIT-TREATTABLE-ENTRY: 행정정보 수정 진입점 — 치료테이블에서만 노출.
             부모가 customer fetch(openEditCustomer) 후 EditCustomerDialog(고객관리 재사용) 오픈. */
          onEditCustomer={(ci) => { setCtxMenu(null); void openEditCustomer(ci); }}
        />
      )}

      {/* T-20260728-foot-ADMININFO-EDIT-TREATTABLE-ENTRY: 행정정보 수정 — 고객관리와 동일 EditCustomerDialog 재사용.
          canEditSensitive = isStaffUnlockRole(고객관리와 동일 게이팅). 저장 시 원장 무접점(therapist surface). */}
      <EditCustomerDialog
        customer={editingCustomer}
        onOpenChange={(o) => { if (!o) setEditingCustomer(null); }}
        onUpdated={() => setEditingCustomer(null)}
        canEditSensitive={isStaffUnlockRole(profile?.role)}
      />

      {/* D. 진료차트 — Customers/Dashboard 와 동일 MedicalChartPanel 재사용 */}
      <MedicalChartPanel
        open={medChartCustomerId !== null}
        onOpenChange={(v) => { if (!v) setMedChartCustomerId(null); }}
        customerId={medChartCustomerId}
        clinicId={clinic?.id ?? ''}
        currentUserRole={profile?.role ?? ''}
        currentUserEmail={profile?.email ?? null}
      />

      {/* D. 문자 — manual_sms_send 권한 시. SendSmsDialog 기존 경로 재사용 */}
      <SendSmsDialog
        open={smsTarget !== null}
        onOpenChange={(v) => { if (!v) setSmsTarget(null); }}
        checkIn={smsTarget}
        clinicId={clinic?.id ?? ''}
      />
    </div>
  );
}
