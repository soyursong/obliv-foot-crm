// DoctorTools — 진료 도구 관리 (어드민 + 의사 + 치료사 공통)
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Admin CRUD, 포팅: derm → foot)
// T-20260512-foot-TREATMENT-SET: 진료세트 탭 추가
// T-20260512-foot-QUICK-RX-BUTTON: 빠른처방 버튼 탭 + 진료 환자 목록 탭 추가
// T-20260525-foot-FEE-SET-TEMPLATE: 수가세트 탭 추가 (결제 미니창 수가항목 세트코드)
//
// 탭별 접근 권한 (T-20260603-foot-RX-PERMMENU-PARITY):
//   진료도구 탭 노출: admin / manager / consultant / coordinator / therapist (NAV 권한과 일치)
//     → 직원(consultant/coordinator/therapist)은 탭 열람 가능, 단 각 탭 CRUD는 admin/manager 전용 (탭 컴포넌트 내부 write-guard)
//   진료 환자 목록 (처방 현황) / 진료 알림판: 모든 authenticated 사용자
//   의사(director): 진료 알림판 기본 — 진료도구 관리 탭은 비노출(기존 설계 유지)

import { useAuth } from '@/lib/auth';
import PhrasesTab from '@/components/admin/PhrasesTab';
import PrescriptionSetsTab from '@/components/admin/PrescriptionSetsTab';
import DocumentTemplatesTab from '@/components/admin/DocumentTemplatesTab';
import TreatmentSetsTab from '@/components/admin/TreatmentSetsTab';
import FeeSetTemplatesTab from '@/components/admin/FeeSetTemplatesTab';
import QuickRxButtonsTab from '@/components/admin/QuickRxButtonsTab';
// T-20260526-foot-PROGRESS-CHECKPOINT: 경과분석 플랜 탭
import ProgressPlansTab from '@/components/admin/ProgressPlansTab';
import DoctorPatientList from '@/components/doctor/DoctorPatientList';
// T-20260601-foot-DOCTOR-CALL-PUSH-DASH: 진료부 통합 대시보드(호출 알람+처방+차팅+진료완료)
import DoctorCallDashboard from '@/components/doctor/DoctorCallDashboard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BookOpen, Pill, FileText, Layers, Zap, Users, DollarSign, TrendingUp, Stethoscope } from 'lucide-react';

export default function DoctorTools() {
  const { profile } = useAuth();
  // 진료도구 탭 노출 권한 — NAV_ITEMS(RBAC-MENU-EXPAND/ROLE-PERM-CUSTOM)와 일치시켜
  // 메뉴 진입 가능 직원이 탭 0개를 보던 불일치 버그 해소. CRUD 가드는 각 탭 컴포넌트 내부 책임.
  const hasDocToolAccess = ['admin', 'manager', 'consultant', 'coordinator', 'therapist'].includes(
    profile?.role ?? '',
  );
  // 의사(director)는 진료부 통합 대시보드를 기본 화면으로 — 상시 켜놓는 단일 창 동선.
  const defaultTab =
    profile?.role === 'director' ? 'call_dashboard' : hasDocToolAccess ? 'phrases' : 'patient_list';

  return (
    <div className="h-full overflow-auto p-4 md:p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold">진료 도구</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          처방 입력, 진료세트, 상용구, 서류 템플릿을 관리합니다.
        </p>
      </div>

      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          {/* 진료부 통합 대시보드 — 전체 공개 (T-20260601-foot-DOCTOR-CALL-PUSH-DASH) */}
          <TabsTrigger value="call_dashboard" className="gap-1.5" data-testid="tab-call-dashboard">
            <Stethoscope className="h-3.5 w-3.5" />
            진료 알림판
          </TabsTrigger>
          {/* 진료도구 관리 탭 — admin/manager/consultant/coordinator/therapist 노출 (직원은 읽기 전용) */}
          {hasDocToolAccess && (
            <>
              <TabsTrigger value="phrases" className="gap-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                상용구
              </TabsTrigger>
              <TabsTrigger value="prescriptions" className="gap-1.5">
                <Pill className="h-3.5 w-3.5" />
                처방세트
              </TabsTrigger>
              <TabsTrigger value="treatment_sets" className="gap-1.5" data-testid="tab-treatment-sets">
                <Layers className="h-3.5 w-3.5" />
                진료세트
              </TabsTrigger>
              <TabsTrigger value="fee_set_templates" className="gap-1.5" data-testid="tab-fee-set-templates">
                <DollarSign className="h-3.5 w-3.5" />
                수가세트
              </TabsTrigger>
              <TabsTrigger value="documents" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                서류 템플릿
              </TabsTrigger>
              <TabsTrigger value="quick_rx" className="gap-1.5" data-testid="tab-quick-rx">
                <Zap className="h-3.5 w-3.5" />
                빠른처방 버튼
              </TabsTrigger>
              {/* T-20260526-foot-PROGRESS-CHECKPOINT */}
              <TabsTrigger value="progress_plans" className="gap-1.5" data-testid="tab-progress-plans">
                <TrendingUp className="h-3.5 w-3.5" />
                경과분석 플랜
              </TabsTrigger>
            </>
          )}

          {/* 전체 공개 탭 */}
          <TabsTrigger value="patient_list" className="gap-1.5" data-testid="tab-patient-list">
            <Users className="h-3.5 w-3.5" />
            진료 환자 목록
          </TabsTrigger>
        </TabsList>

        {hasDocToolAccess && (
          <>
            <TabsContent value="phrases">
              <PhrasesTab />
            </TabsContent>

            <TabsContent value="prescriptions">
              <PrescriptionSetsTab />
            </TabsContent>

            <TabsContent value="treatment_sets">
              <TreatmentSetsTab />
            </TabsContent>

            <TabsContent value="fee_set_templates">
              <FeeSetTemplatesTab />
            </TabsContent>

            <TabsContent value="documents">
              <DocumentTemplatesTab />
            </TabsContent>

            <TabsContent value="quick_rx">
              <QuickRxButtonsTab />
            </TabsContent>
            {/* T-20260526-foot-PROGRESS-CHECKPOINT */}
            <TabsContent value="progress_plans">
              <ProgressPlansTab />
            </TabsContent>
          </>
        )}

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
