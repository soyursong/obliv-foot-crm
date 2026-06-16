// DoctorTools — 진료 도구 (진료 알림판 + 처방 환자 목록)
// (NOTE) DoctorTools 서브탭 라벨 '진료 환자 목록' 역전은 본 파일 밖 — T-20260615-foot-DOCDASH-RX-DISPLAY-REVAMP item7로 이관됨.
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Admin CRUD, 포팅: derm → foot)
//
// T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT (AC-4):
//   어드민성 관리 도구(상용구·슈퍼상용구·처방세트·상병명·진료세트·수가세트·서류템플릿·
//   빠른처방버튼·경과분석플랜·금기증관리)는 '서비스 관리 > 진료관리'(ClinicManagement)로 분리됨.
//   진료 도구에는 전체 공개 운영 화면 2개만 잔존:
//     - 진료 알림판 (DoctorCallDashboard) — 호출 알람+처방+차팅+진료완료 통합 대시보드
//     - 처방 환자 목록 (DoctorPatientList) — 원장 진료콜 명단에 오른 고객의 처방 현황
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Users, Stethoscope, FlaskConical, FileText } from 'lucide-react';

export default function DoctorTools() {
  // 모든 역할이 진료 알림판(진료부 통합 대시보드)을 기본 화면으로 — 상시 켜놓는 단일 창 동선.
  const [activeTab, setActiveTab] = useState('call_dashboard');

  // T-20260612-foot-DOCDASH-FULLWIDTH-INLINE-EMOJI AC-1 (문지은 대표원장):
  //   max-w-5xl(너비 제한) 해제 → 컨테이너 가로 100% 풀폭. 페이지 여백 p-4/md:p-6 → p-2/md:p-3 축소(화면 꽉).
  return (
    <div className="h-full overflow-auto p-2 md:p-3 space-y-4 w-full">
      <div>
        {/* T-20260609-foot-DOCDASH-LABEL-RX-REFINE item1: 헤더 라벨 오기 교정('진료 도구'→'진료대시보드') */}
        <h1 className="text-lg font-bold">진료대시보드</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          진료 알림판 · 처방 환자 목록 · 균검사지(KOH) · 소견서를 확인합니다.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          {/* 진료부 통합 대시보드 — 전체 공개 (T-20260601-foot-DOCTOR-CALL-PUSH-DASH) */}
          <TabsTrigger value="call_dashboard" className="gap-1.5" data-testid="tab-call-dashboard">
            <Stethoscope className="h-3.5 w-3.5" />
            진료 알림판
          </TabsTrigger>
          {/* 처방 환자 목록 — 전체 공개. T-20260615-foot-RXLIST-RENAME-DOCFILTER item1:
              라벨 '진료 환자 목록'→'처방 환자 목록'(텍스트만). value/data-testid 보존(E2E·탭 상태키 무변경). */}
          <TabsTrigger value="patient_list" className="gap-1.5" data-testid="tab-patient-list">
            <Users className="h-3.5 w-3.5" />
            처방 환자 목록
          </TabsTrigger>
          {/* 균검사지 — KOH 진균검사 명단 (T-20260611-foot-KOH-REPORT-TAB Phase 1) */}
          <TabsTrigger value="koh_report" className="gap-1.5" data-testid="tab-koh-report">
            <FlaskConical className="h-3.5 w-3.5" />
            균검사지
          </TabsTrigger>
          {/* 소견서 — 균검사지 '옆' 신규 탭 (T-20260616-foot-OPINION-DOC-FEATURE Phase 1) */}
          <TabsTrigger value="opinion_doc" className="gap-1.5" data-testid="tab-opinion-doc">
            <FileText className="h-3.5 w-3.5" />
            소견서
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
          <OpinionDocTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
