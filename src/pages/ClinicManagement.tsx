// ClinicManagement — 진료관리 (어드민성 진료 도구 모음)
// Ticket: T-20260606-foot-RXTOOL-INJURY-MENU-SPLIT (문지은 대표원장 C0ATE5P6JTH)
//   AC-2/AC-3: 기존 '진료 도구'에 섞여 있던 어드민성 관리 도구를 '서비스 관리' 아래 '진료관리'로 분리.
//   접근 권한 = admin / manager / director 만 (consultant(부원장)/coordinator/therapist 차단).
//     → 라우트 가드(App.tsx RoleGuard) + 메뉴 비노출(AdminLayout NAV_ITEMS roles) 이중.
//     → director(원장)는 진료차트 '관리 화면으로' 진입점 연속성 보존을 위해 포함.
//   각 탭의 CRUD write-guard 는 탭 컴포넌트 내부 책임(기존 유지). 금기증 관리는 admin 한정 노출 유지.
//
// AC-4: 분리 후 기존 '진료 도구'(DoctorTools)에는 진료 알림판·진료 환자 목록만 잔존.

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import PhrasesTab from '@/components/admin/PhrasesTab';
import SuperPhrasesTab from '@/components/admin/SuperPhrasesTab';
import PrescriptionSetsTab from '@/components/admin/PrescriptionSetsTab';
// AC-1: 상병명(진단명) 관리 — services.category_label='상병' 단일 SSOT 참조(서비스관리와 동기화)
import DiagnosisNamesTab from '@/components/admin/DiagnosisNamesTab';
import DocumentTemplatesTab from '@/components/admin/DocumentTemplatesTab';
import TreatmentSetsTab from '@/components/admin/TreatmentSetsTab';
import FeeSetTemplatesTab from '@/components/admin/FeeSetTemplatesTab';
import QuickRxButtonsTab from '@/components/admin/QuickRxButtonsTab';
import ProgressPlansTab from '@/components/admin/ProgressPlansTab';
import ContraindicationsTab from '@/components/admin/ContraindicationsTab';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BookOpen, Pill, FileText, Layers, Zap, DollarSign, TrendingUp, ShieldAlert, Sparkles, ClipboardList } from 'lucide-react';

export default function ClinicManagement() {
  const { profile } = useAuth();
  // 페이지 접근은 RoleGuard(admin/manager/director)가 1차 보장. 여기서는 금기증(admin 한정)만 추가 게이팅.
  const isAdmin = profile?.role === 'admin';

  // 진료차트 우측 패널 '관리 화면으로' 진입 시 ?tab= 쿼리로 해당 탭 pre-select.
  //   (T-20260606-foot-RX-PANEL-UX-5FIX AC-5 동선 — 메뉴 분리 후 진입 경로를 clinic-management 로 이전)
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const accessibleTabs = [
    'phrases',
    'super_phrases',
    'prescriptions',
    'diagnosis_names',
    'treatment_sets',
    'fee_set_templates',
    'documents',
    'quick_rx',
    'progress_plans',
    ...(isAdmin ? ['contraindications'] : []),
  ];
  const tabAllowed = !!requestedTab && accessibleTabs.includes(requestedTab);
  const [activeTab, setActiveTab] = useState(tabAllowed ? (requestedTab as string) : 'phrases');

  useEffect(() => {
    if (tabAllowed) setActiveTab(requestedTab as string);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab]);

  return (
    <div className="h-full overflow-auto p-4 md:p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold">진료관리</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          상용구·처방세트·진료세트·상병·서류 템플릿 등 진료 관련 항목을 관리합니다.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="phrases" className="gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            상용구
          </TabsTrigger>
          <TabsTrigger value="super_phrases" className="gap-1.5" data-testid="tab-super-phrases">
            <Sparkles className="h-3.5 w-3.5" />
            슈퍼상용구
          </TabsTrigger>
          <TabsTrigger value="prescriptions" className="gap-1.5">
            <Pill className="h-3.5 w-3.5" />
            처방세트
          </TabsTrigger>
          {/* AC-1: 상병명 관리 — services.category_label='상병' 단일 SSOT (서비스관리와 동기화) */}
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
          <TabsTrigger value="progress_plans" className="gap-1.5" data-testid="tab-progress-plans">
            <TrendingUp className="h-3.5 w-3.5" />
            경과분석 플랜
          </TabsTrigger>
          {/* 금기증 관리 — admin 한정 노출 (admin-write RLS와 일치) */}
          {isAdmin && (
            <TabsTrigger value="contraindications" className="gap-1.5" data-testid="tab-contraindications">
              <ShieldAlert className="h-3.5 w-3.5" />
              금기증 관리
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="phrases">
          <PhrasesTab />
        </TabsContent>
        <TabsContent value="super_phrases">
          <SuperPhrasesTab />
        </TabsContent>
        <TabsContent value="prescriptions">
          <PrescriptionSetsTab />
        </TabsContent>
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
        <TabsContent value="progress_plans">
          <ProgressPlansTab />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="contraindications">
            <ContraindicationsTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
