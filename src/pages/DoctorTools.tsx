// DoctorTools — 진료 도구 (진료 알림판 + 진료 환자 목록)
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Admin CRUD, 포팅: derm → foot)
//
// T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT (AC-4):
//   어드민성 관리 도구(상용구·슈퍼상용구·처방세트·상병명·진료세트·수가세트·서류템플릿·
//   빠른처방버튼·경과분석플랜·금기증관리)는 '서비스 관리 > 진료관리'(ClinicManagement)로 분리됨.
//   진료 도구에는 전체 공개 운영 화면 2개만 잔존:
//     - 진료 알림판 (DoctorCallDashboard) — 호출 알람+처방+차팅+진료완료 통합 대시보드
//     - 진료 환자 목록 (DoctorPatientList) — 처방 현황
//   부원장(consultant)/코디(coordinator)/치료사(therapist)가 진입해도 어드민성 항목은 비노출.

import { useState } from 'react';
import DoctorPatientList from '@/components/doctor/DoctorPatientList';
// T-20260601-foot-DOCTOR-CALL-PUSH-DASH: 진료부 통합 대시보드(호출 알람+처방+차팅+진료완료)
import DoctorCallDashboard from '@/components/doctor/DoctorCallDashboard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Users, Stethoscope } from 'lucide-react';

export default function DoctorTools() {
  // 모든 역할이 진료 알림판(진료부 통합 대시보드)을 기본 화면으로 — 상시 켜놓는 단일 창 동선.
  const [activeTab, setActiveTab] = useState('call_dashboard');

  return (
    <div className="h-full overflow-auto p-4 md:p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold">진료 도구</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          진료 알림판과 진료 환자 목록을 확인합니다.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          {/* 진료부 통합 대시보드 — 전체 공개 (T-20260601-foot-DOCTOR-CALL-PUSH-DASH) */}
          <TabsTrigger value="call_dashboard" className="gap-1.5" data-testid="tab-call-dashboard">
            <Stethoscope className="h-3.5 w-3.5" />
            진료 알림판
          </TabsTrigger>
          {/* 진료 환자 목록 — 전체 공개 */}
          <TabsTrigger value="patient_list" className="gap-1.5" data-testid="tab-patient-list">
            <Users className="h-3.5 w-3.5" />
            진료 환자 목록
          </TabsTrigger>
        </TabsList>

        <TabsContent value="call_dashboard">
          <DoctorCallDashboard />
        </TabsContent>

        <TabsContent value="patient_list">
          <DoctorPatientList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
