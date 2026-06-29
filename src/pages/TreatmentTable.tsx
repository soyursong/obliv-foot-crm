// TreatmentTable.tsx — 치료 테이블 (2섹션 전면 개편 + 4종 UX 증분)
// Ticket: T-20260620-foot-TREATTABLE-2SECTION-REVAMP (부모, deployed)
// Ticket: T-20260622-foot-TREATTABLE-ADDON-COMPACT-DATEFILTER (본건 — A컴팩트/B날짜필터/C검사결과생성/D이름인터랙션)
//
//   상단 2탭:
//     ① 진료 환자 이력        → DoctorHistorySection (진료콜 등재 환자 + 처방전/소견·진단서 발행 O/X)
//     ② 균검사 & 피검사 대상자 → ExamTargetsSection   (koh/blood 신청 환자, 1환자 1행 검사박스)
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
import { Stethoscope, ClipboardList, Calendar, ChevronLeft, ChevronRight, TrendingUp, Settings2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import DoctorHistorySection from '@/components/treatment/DoctorHistorySection';
import ExamTargetsSection from '@/components/treatment/ExamTargetsSection';
import ProgressTargetsSection from '@/components/treatment/ProgressTargetsSection';
// T-20260629-foot-PROGRESSPLAN-TAB-MOVE-TREATTABLE: 진료관리에서 이식한 '경과분석 플랜'(설정) 탭 = ④번째(맨 뒤).
//   ③경과분석(ProgressTargetsSection=오늘 대상자)과 별개 surface. 자체 useClinic 사용(props 불요). 컴포넌트·DB 동일.
import ProgressPlansTab from '@/components/admin/ProgressPlansTab';
import { CustomerQuickMenu } from '@/components/CustomerQuickMenu';
import MedicalChartPanel from '@/components/MedicalChartPanel';
import SendSmsDialog from '@/components/SendSmsDialog';
import { useChart } from '@/lib/chartContext';
import { useClinic } from '@/hooks/useClinic';
import { useAuth } from '@/lib/auth';
import { canAccess } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import type { CheckIn } from '@/lib/types';

// T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경2]: 치료테이블 탭 = ①진료 환자 이력 ②균검사&피검사 대상자 ③경과분석.
// T-20260629-foot-PROGRESSPLAN-TAB-MOVE-TREATTABLE: ④경과분석 플랜(설정, 진료관리에서 이식) = 맨 뒤. confirm 해소(문지은 대표원장 2026-06-29) → 랜딩.
//   명칭 구분: ③='경과분석'(오늘 대상자 확인) / ④='경과분석 플랜'(설정). 혼동 금지.
type SectionTab = 'history' | 'exam' | 'progress' | 'plan';

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
          <TabsTrigger value="history" data-testid="tab-doctor-history">
            <Stethoscope className="size-3.5 mr-1.5" />
            진료 환자 이력
          </TabsTrigger>
          <TabsTrigger value="exam" data-testid="tab-exam-targets">
            <ClipboardList className="size-3.5 mr-1.5" />
            균검사 &amp; 피검사 대상자
          </TabsTrigger>
          {/* T-20260629-foot-PROGRESSANALYSIS-RELOCATE-TREATBL [변경2]: ③경과분석(당일 대상자 리스트). 기존 2탭 뒤. */}
          <TabsTrigger value="progress" data-testid="tab-progress-targets">
            <TrendingUp className="size-3.5 mr-1.5" />
            경과분석
          </TabsTrigger>
          {/* T-20260629-foot-PROGRESSPLAN-TAB-MOVE-TREATTABLE: ④경과분석 플랜(설정, 진료관리에서 이식). 맨 뒤.
              ③경과분석(오늘 대상자)과 명칭 구분 — 본 탭은 회차tier별 체크포인트 설정(ProgressPlansTab). */}
          <TabsTrigger value="plan" data-testid="tab-progress-plans">
            <Settings2 className="size-3.5 mr-1.5" />
            경과분석 플랜
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="mt-0">
          <DoctorHistorySection date={date} nameInteraction={nameInteraction} />
        </TabsContent>
        <TabsContent value="exam" className="mt-0">
          <ExamTargetsSection date={date} nameInteraction={nameInteraction} />
        </TabsContent>
        <TabsContent value="progress" className="mt-0">
          <ProgressTargetsSection date={date} nameInteraction={nameInteraction} />
        </TabsContent>
        {/* T-20260629-foot-PROGRESSPLAN-TAB-MOVE-TREATTABLE: ④경과분석 플랜(설정). 진료관리에서 이식 — 기능 동일.
            ProgressPlansTab 는 useClinic 자체 사용(date/nameInteraction 불요) — 회차tier별 체크포인트 CRUD. */}
        <TabsContent value="plan" className="mt-0">
          <ProgressPlansTab />
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
        />
      )}

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
