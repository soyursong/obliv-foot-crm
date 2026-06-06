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

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import PhrasesTab from '@/components/admin/PhrasesTab';
// T-20260603-foot-RX-SUPER-PHRASE: 슈퍼상용구(진단명+임상경과+처방 묶음) 등록 탭
import SuperPhrasesTab from '@/components/admin/SuperPhrasesTab';
import PrescriptionSetsTab from '@/components/admin/PrescriptionSetsTab';
// T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-1): 상병명(진단명) 관리 탭
import DiagnosisNamesTab from '@/components/admin/DiagnosisNamesTab';
import DocumentTemplatesTab from '@/components/admin/DocumentTemplatesTab';
import TreatmentSetsTab from '@/components/admin/TreatmentSetsTab';
import FeeSetTemplatesTab from '@/components/admin/FeeSetTemplatesTab';
import QuickRxButtonsTab from '@/components/admin/QuickRxButtonsTab';
// T-20260526-foot-PROGRESS-CHECKPOINT: 경과분석 플랜 탭
import ProgressPlansTab from '@/components/admin/ProgressPlansTab';
// T-20260603-foot-RX-CONTRAINDICATION-ADMIN: 약품별 금기증 등록 탭 (admin 한정)
import ContraindicationsTab from '@/components/admin/ContraindicationsTab';
import DoctorPatientList from '@/components/doctor/DoctorPatientList';
// T-20260601-foot-DOCTOR-CALL-PUSH-DASH: 진료부 통합 대시보드(호출 알람+처방+차팅+진료완료)
import DoctorCallDashboard from '@/components/doctor/DoctorCallDashboard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BookOpen, Pill, FileText, Layers, Zap, Users, DollarSign, TrendingUp, Stethoscope, ShieldAlert, Sparkles, ClipboardList } from 'lucide-react';

export default function DoctorTools() {
  const { profile } = useAuth();
  // 진료도구 탭 노출 권한 — NAV_ITEMS(RBAC-MENU-EXPAND/ROLE-PERM-CUSTOM)와 일치시켜
  // 메뉴 진입 가능 직원이 탭 0개를 보던 불일치 버그 해소. CRUD 가드는 각 탭 컴포넌트 내부 책임.
  const hasDocToolAccess = ['admin', 'manager', 'consultant', 'coordinator', 'therapist'].includes(
    profile?.role ?? '',
  );
  // T-20260603-foot-RX-CONTRAINDICATION-ADMIN: 금기증 관리는 admin 한정 노출 (admin-write RLS와 일치).
  const isAdmin = profile?.role === 'admin';
  // 의사(director)는 진료부 통합 대시보드를 기본 화면으로 — 상시 켜놓는 단일 창 동선.
  const defaultTab =
    profile?.role === 'director' ? 'call_dashboard' : hasDocToolAccess ? 'phrases' : 'patient_list';

  // T-20260606-foot-RX-PANEL-UX-5FIX AC-5: 진료차트 우측 패널 '관리 화면으로' 진입 시
  //   ?tab= 쿼리로 해당 탭 pre-select (예: 슈퍼상용구 → ?tab=super_phrases). 권한 없는 탭은 무시.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  // 현재 사용자가 실제 볼 수 있는 탭만 허용 — 권한 없는 탭 요청 시 빈 화면 방지(defaultTab fallback).
  const accessibleTabs = [
    'call_dashboard',
    'patient_list',
    ...(hasDocToolAccess
      ? ['phrases', 'super_phrases', 'prescriptions', 'diagnosis_names', 'treatment_sets', 'fee_set_templates', 'documents', 'quick_rx', 'progress_plans']
      : []),
    ...(isAdmin ? ['contraindications'] : []),
  ];
  const tabAllowed = !!requestedTab && accessibleTabs.includes(requestedTab);
  const [activeTab, setActiveTab] = useState(tabAllowed ? (requestedTab as string) : defaultTab);

  // URL ?tab= 변경(네비게이션 재진입) 시 활성 탭 동기화.
  useEffect(() => {
    if (tabAllowed) setActiveTab(requestedTab as string);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab]);

  return (
    <div className="h-full overflow-auto p-4 md:p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold">진료 도구</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          처방 입력, 진료세트, 상용구, 서류 템플릿을 관리합니다.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
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
              {/* T-20260603-foot-RX-SUPER-PHRASE */}
              <TabsTrigger value="super_phrases" className="gap-1.5" data-testid="tab-super-phrases">
                <Sparkles className="h-3.5 w-3.5" />
                슈퍼상용구
              </TabsTrigger>
              <TabsTrigger value="prescriptions" className="gap-1.5">
                <Pill className="h-3.5 w-3.5" />
                처방세트
              </TabsTrigger>
              {/* T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-1) */}
              <TabsTrigger value="diagnosis_names" className="gap-1.5" data-testid="tab-diagnosis-names">
                <ClipboardList className="h-3.5 w-3.5" />
                상병명 관리
              </TabsTrigger>
              <TabsTrigger value="treatment_sets" className="gap-1.5" data-testid="tab-treatment-sets">
                <Layers className="h-3.5 w-3.5" />
                진료세트
              </TabsTrigger>
              <TabsTrigger value="fee_set_templates" className="gap-1.5" data-testid="tab-fee-set-templates">
                <DollarSign className="h-3.5 w-3.5" />
                수가세트
              </TabsTrigger>
              <TabsTrigger value="documents" className="gap-1.5" data-testid="tab-documents">
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

          {/* T-20260603-foot-RX-CONTRAINDICATION-ADMIN: 금기증 관리 — admin 한정 노출 */}
          {isAdmin && (
            <TabsTrigger value="contraindications" className="gap-1.5" data-testid="tab-contraindications">
              <ShieldAlert className="h-3.5 w-3.5" />
              금기증 관리
            </TabsTrigger>
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

            {/* T-20260603-foot-RX-SUPER-PHRASE */}
            <TabsContent value="super_phrases">
              <SuperPhrasesTab />
            </TabsContent>

            <TabsContent value="prescriptions">
              <PrescriptionSetsTab />
            </TabsContent>

            {/* T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-1) */}
            <TabsContent value="diagnosis_names">
              <DiagnosisNamesTab />
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

        {/* T-20260603-foot-RX-CONTRAINDICATION-ADMIN: 금기증 관리 (admin 한정) */}
        {isAdmin && (
          <TabsContent value="contraindications">
            <ContraindicationsTab />
          </TabsContent>
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
