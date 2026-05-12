// DoctorTools — 진료 도구 관리 (어드민 + 의사 + 치료사 공통)
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Admin CRUD, 포팅: derm → foot)
// T-20260512-foot-TREATMENT-SET: 진료세트 탭 추가
// T-20260512-foot-QUICK-RX-BUTTON: 빠른처방 버튼 탭 + 진료 환자 목록 탭 추가
//
// 탭별 접근 권한:
//   상용구 / 처방세트 / 진료세트 / 서류템플릿 / 빠른처방: admin / manager
//   진료 환자 목록 (처방 현황): 모든 authenticated 사용자

import { useAuth } from '@/lib/auth';
import PhrasesTab from '@/components/admin/PhrasesTab';
import PrescriptionSetsTab from '@/components/admin/PrescriptionSetsTab';
import DocumentTemplatesTab from '@/components/admin/DocumentTemplatesTab';
import TreatmentSetsTab from '@/components/admin/TreatmentSetsTab';
import QuickRxButtonsTab from '@/components/admin/QuickRxButtonsTab';
import DoctorPatientList from '@/components/doctor/DoctorPatientList';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BookOpen, Pill, FileText, Layers, Zap, Users } from 'lucide-react';

export default function DoctorTools() {
  const { profile } = useAuth();
  const isAdminOrManager = profile?.role === 'admin' || profile?.role === 'manager';

  return (
    <div className="h-full overflow-auto p-4 md:p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold">진료 도구</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          처방 입력, 진료세트, 상용구, 서류 템플릿을 관리합니다.
        </p>
      </div>

      <Tabs defaultValue={isAdminOrManager ? 'phrases' : 'patient_list'} className="w-full">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          {/* 어드민/매니저 전용 탭 */}
          {isAdminOrManager && (
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
              <TabsTrigger value="documents" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                서류 템플릿
              </TabsTrigger>
              <TabsTrigger value="quick_rx" className="gap-1.5" data-testid="tab-quick-rx">
                <Zap className="h-3.5 w-3.5" />
                빠른처방 버튼
              </TabsTrigger>
            </>
          )}

          {/* 전체 공개 탭 */}
          <TabsTrigger value="patient_list" className="gap-1.5" data-testid="tab-patient-list">
            <Users className="h-3.5 w-3.5" />
            진료 환자 목록
          </TabsTrigger>
        </TabsList>

        {isAdminOrManager && (
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

            <TabsContent value="documents">
              <DocumentTemplatesTab />
            </TabsContent>

            <TabsContent value="quick_rx">
              <QuickRxButtonsTab />
            </TabsContent>
          </>
        )}

        <TabsContent value="patient_list">
          <DoctorPatientList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
