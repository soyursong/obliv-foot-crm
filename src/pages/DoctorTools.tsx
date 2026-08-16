// DoctorTools — 진료 도구 (진료 알림판 + 진료 환자 목록)
// T-20260617-foot-DOCDASH-DOCLIST-5FIX B1(A4): 서브탭 라벨 '처방 환자 목록' → '진료 환자 목록' 역전 착지(reporter-explicit, 문지은 대표원장).
//   RX-DISPLAY-REVAMP item7 결정(MSG-20260615-212624-u6y5)이 5121edbc로 역전·미착지된 것을 재착지. value/data-testid 불변.
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Admin CRUD, 포팅: derm → foot)
//
// T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT (AC-4):
//   어드민성 관리 도구(상용구·슈퍼상용구·처방세트·상병명·진료세트·수가세트·서류템플릿·
//   빠른처방버튼·경과분석플랜·금기증관리)는 '서비스 관리 > 진료관리'(ClinicManagement)로 분리됨.
//   진료 도구에는 전체 공개 운영 화면 2개만 잔존:
//     - 진료 알림판 (DoctorCallDashboard) — 호출 알람+처방+차팅+진료완료 통합 대시보드
//     - 진료 환자 목록 (DoctorPatientList) — 원장 진료콜 명단에 오른 고객의 처방 현황
//       (T-20260615-foot-RXLIST-RENAME-DOCFILTER: 라벨 리네임
//        → T-20260616-foot-RXLIST-RENAME-DOCTORCALL-FILTER: 모집단을 진료콜 명단(doctor_call list) 교집합으로 정정)
//   부원장(consultant)/코디(coordinator)/치료사(therapist)가 진입해도 어드민성 항목은 비노출.

import { useState } from 'react';
import DoctorPatientList from '@/components/doctor/DoctorPatientList';
// T-20260601-foot-DOCTOR-CALL-PUSH-DASH: 진료부 통합 대시보드(호출 알람+처방+차팅+진료완료)
import DoctorCallDashboard from '@/components/doctor/DoctorCallDashboard';
// T-20260611-foot-KOH-REPORT-TAB (Phase 1): 균검사지 — KOH 진균검사 명단 리포트(read-only 4컬럼)
import KohReportTab from '@/components/doctor/KohReportTab';
// T-20260616-foot-OPINION-DOC-FEATURE (Phase 1): 소견서 — 균검사지 '옆' 신규 탭(금일 내방객 + 소견서 작성 팝업)
import OpinionDocTab from '@/components/doctor/OpinionDocTab';
// T-20260620-foot-CHART2-OPINION-SELECT-BOX-LINK (AC-9/11/12): 서류작성 큐 — 데스크 발행요청(실장→원장)
import DocRequestQueue from '@/components/doctor/DocRequestQueue';
// T-20260812-foot-PROGFORM-DOCDASH-DOCWRITE-LISTUP: 경과분석지(원장 최종발행 서류) 발행 대상을 서류작성 탭에도 리스트업.
//   ★SSOT 재사용 — 치료테이블 §③ 경과분석의 ProgressTargetsSection 을 그대로 렌더(모집단/필터/발행 동선 병렬 신설 금지).
import ProgressTargetsSection from '@/components/treatment/ProgressTargetsSection';
import type { NameInteraction } from '@/pages/TreatmentTable';
import { useAuth } from '@/lib/auth';
import { useChart } from '@/lib/chartContext';
import { canSeeProgressDocs } from '@/lib/permissions';
import { seoulISODate } from '@/lib/format';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Users, Stethoscope, FlaskConical, FileText, TrendingUp } from 'lucide-react';

export default function DoctorTools() {
  // 모든 역할이 진료 알림판(진료부 통합 대시보드)을 기본 화면으로 — 상시 켜놓는 단일 창 동선.
  const [activeTab, setActiveTab] = useState('call_dashboard');

  // T-20260812-foot-PROGFORM-DOCDASH-DOCWRITE-LISTUP: 서류작성(opinion_doc) 탭 경과분석지 발행 대상 리스트업.
  //   ★A안(read/write split, 김주연 총괄 확정 2026-08-14):
  //     · 명단 조회(READ)  = canSeeProgressDocs(permissions.ts) — 치료테이블 §③ 경과분석 탭과 '동일 read 범위'로 완화
  //       (coordinator/총괄 포함). 재신고 '증발' 근본원인 = 기존 게이트가 코디 미통과였던 것 → 완화.
  //       net-new PHI 0(코디는 동일 코호트를 치료테이블에서 이미 열람).
  //     · 발행(WRITE)      = canIssueProgressDocs — 개별/일괄 발행 버튼은 원장(+admin/manager)만.
  //       게이트는 ProgressTargetsSection 내부에 상주(두 surface 공유 컴포넌트 → surface drift 0).
  //   ★AC2 모집단 정합: ProgressTargetsSection(치료테이블 §③ 경과분석) 그대로 재사용 → PROGCHK 필터(활성 패키지 &
  //     (used+1)%6==0)와 by-construction 동일. read-only(db_change=false, AC5).
  const { profile } = useAuth();
  const { openChart } = useChart();
  const showProgressDocs = canSeeProgressDocs(profile);
  // 이름 인터랙션(치료테이블과 동일 계약): 좌클릭=2번차트 open(useChart 단일 게이트) / 우클릭=진료대시보드에선 no-op.
  const nameInteraction: NameInteraction = {
    onLeftClick: (customerId) => {
      if (customerId) openChart(customerId);
    },
    onContextMenu: (e) => {
      e.preventDefault();
    },
  };

  // T-20260612-foot-DOCDASH-FULLWIDTH-INLINE-EMOJI AC-1 (문지은 대표원장):
  //   max-w-5xl(너비 제한) 해제 → 컨테이너 가로 100% 풀폭. 페이지 여백 p-4/md:p-6 → p-2/md:p-3 축소(화면 꽉).
  return (
    <div className="h-full overflow-auto p-2 md:p-3 space-y-4 w-full">
      <div>
        {/* T-20260609-foot-DOCDASH-LABEL-RX-REFINE item1: 헤더 라벨 오기 교정('진료 도구'→'진료대시보드') */}
        <h1 className="text-lg font-bold">진료대시보드</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          {/* 진료부 통합 대시보드 — 전체 공개 (T-20260601-foot-DOCTOR-CALL-PUSH-DASH) */}
          <TabsTrigger value="call_dashboard" className="gap-1.5" data-testid="tab-call-dashboard">
            <Stethoscope className="h-3.5 w-3.5" />
            진료 알림판
          </TabsTrigger>
          {/* 진료 환자 목록 — 전체 공개. T-20260617-foot-DOCDASH-DOCLIST-5FIX B1(A4):
              라벨 '처방 환자 목록'→'진료 환자 목록' 역전 착지(reporter-explicit). value/data-testid 보존(E2E·탭 상태키 무변경).
              ← T-20260615-foot-RXLIST-RENAME-DOCFILTER item1('처방 환자 목록') supersede by 대표원장 결정. */}
          <TabsTrigger value="patient_list" className="gap-1.5" data-testid="tab-patient-list">
            <Users className="h-3.5 w-3.5" />
            진료 환자 목록
          </TabsTrigger>
          {/* 균검사지 — KOH 진균검사 명단 (T-20260611-foot-KOH-REPORT-TAB Phase 1) */}
          <TabsTrigger value="koh_report" className="gap-1.5" data-testid="tab-koh-report">
            <FlaskConical className="h-3.5 w-3.5" />
            균검사지
          </TabsTrigger>
          {/* 서류작성 — 균검사지 '옆' 탭. T-20260620-foot-CHART2-OPINION-SELECT-BOX-LINK AC-12:
              '소견서' → '서류작성' 탭명 변경(데스크 발행요청 큐 + 금일 내방객 소견서 작성 통합).
              value/data-testid 보존(E2E·탭 상태키 무변경). */}
          <TabsTrigger value="opinion_doc" className="gap-1.5" data-testid="tab-opinion-doc">
            <FileText className="h-3.5 w-3.5" />
            서류작성
          </TabsTrigger>
        </TabsList>

        <TabsContent value="call_dashboard">
          <DoctorCallDashboard />
        </TabsContent>

        <TabsContent value="patient_list">
          <DoctorPatientList />
        </TabsContent>

        <TabsContent value="koh_report">
          <KohReportTab />
        </TabsContent>

        <TabsContent value="opinion_doc">
          {/* AC-9/11: 데스크(실장) 발행요청 큐(9컬럼+작성하기) — 상단. */}
          <DocRequestQueue />
          {/* T-20260812-foot-PROGFORM-DOCDASH-DOCWRITE-LISTUP: 경과분석지 발행 대상 리스트업(6배수 도래).
              발행 동선 일원화 — 원장 동선(서류작성 탭)에서도 대상 확인·발행. SSOT=ProgressTargetsSection 재사용.
              A안 read/write split: 명단 조회=canSeeProgressDocs(코디/총괄 포함, 치료테이블과 동일 범위) /
              발행 버튼=canIssueProgressDocs(원장+admin/manager, ProgressTargetsSection 내부 게이트). */}
          {showProgressDocs && (
            <div className="mt-6 border-t pt-5" data-testid="docdash-progress-form-section">
              <div className="mb-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <TrendingUp className="h-4 w-4 text-teal-600" />
                  경과분석지 발행 대상
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  6의 배수 회차(6·12·18·24…)에 도래한 경과분석지 발행 대상 환자입니다. 치료테이블 '경과분석' 목록과 동일 기준입니다.
                </p>
              </div>
              <ProgressTargetsSection date={seoulISODate(new Date())} nameInteraction={nameInteraction} />
            </div>
          )}
          {/* 금일 내방객 소견서 작성(원장 자발) — 기존 동선 보존(AC-5 회귀0). */}
          <div className="mt-6 border-t pt-5">
            <OpinionDocTab />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
