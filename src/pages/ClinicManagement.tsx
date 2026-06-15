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
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
// T-20260613-foot-PHRASEMGMT-SUBTAB-SPLIT: 상용구(PhrasesTab)·수가세트(FeeSetTemplatesTab) 2개 탭은
//   '서비스관리 > 상용구관리' 서브탭(Services.tsx)으로 이전됨(렌더 위치 이동만). 여기서는 import/탭 제거 + 딥링크 redirect.
import SuperPhrasesTab from '@/components/admin/SuperPhrasesTab';
// T-20260615-foot-PHRASE-MEDCHART-CLINICTAB-SPLIT: 진료차트 상용구(phrase_type=medical_chart) 전용 탭.
//   부모(PHRASEMGMT)가 제거한 'phrases' 탭 복원이 아니라, lockedType='medical_chart' 로 마운트하는 새 surface.
//   value/testid 는 'phrases' 와 다른 신규 키(medchart_phrases) — 부모 redirect(?tab=phrases) 충돌 방지.
import PhrasesTab from '@/components/admin/PhrasesTab';
import PrescriptionSetsTab from '@/components/admin/PrescriptionSetsTab';
// T-20260606-foot-RX-SET-REDESIGN AC-R2: 약품 폴더 관리(개별 약품 분류 트리). 묶음처방(prescription_sets)과 별개.
import DrugFoldersTab from '@/components/admin/DrugFoldersTab';
// AC-1: 상병명(진단명) 관리 — services.category_label='상병' 단일 SSOT 참조(서비스관리와 동기화)
import DiagnosisNamesTab from '@/components/admin/DiagnosisNamesTab';
// T-20260608-foot-DX-BUNDLE-SET (AC-1): 묶음상병(여러 상병을 한 세트로 묶어 진료차트 일괄 적용) 관리
import DiagnosisSetsTab from '@/components/admin/DiagnosisSetsTab';
import DocumentTemplatesTab from '@/components/admin/DocumentTemplatesTab';
import TreatmentSetsTab from '@/components/admin/TreatmentSetsTab';
import QuickRxButtonsTab from '@/components/admin/QuickRxButtonsTab';
import ProgressPlansTab from '@/components/admin/ProgressPlansTab';
import ContraindicationsTab from '@/components/admin/ContraindicationsTab';
// T-20260609-foot-DRUG-INSURANCE-GATE Phase1: 약품별 급여여부(보험상태) 관리 — 처방 게이트(checkRxInsuranceGate) 소스
import InsuranceStatusTab from '@/components/admin/InsuranceStatusTab';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Pill, FileText, Layers, Zap, TrendingUp, ShieldAlert, Sparkles, ClipboardList, FolderTree, Boxes, BadgeCheck, BookText } from 'lucide-react';

export default function ClinicManagement() {
  const { profile } = useAuth();
  // 페이지 접근은 RoleGuard(admin/manager/director)가 1차 보장. 여기서는 금기증(admin 한정)만 추가 게이팅.
  const isAdmin = profile?.role === 'admin';
  // 급여여부 관리(InsuranceStatusTab) — admin/manager write(RLS is_admin_or_manager 일치).
  const canManageInsurance = profile?.role === 'admin' || profile?.role === 'manager';

  // 진료차트 우측 패널 '관리 화면으로' 진입 시 ?tab= 쿼리로 해당 탭 pre-select.
  //   (T-20260606-foot-RX-PANEL-UX-5FIX AC-5 동선 — 메뉴 분리 후 진입 경로를 clinic-management 로 이전)
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedTab = searchParams.get('tab');

  // T-20260613-foot-PHRASEMGMT-SUBTAB-SPLIT (AC-4): 상용구·수가세트는 '서비스관리 > 상용구관리'로 이전됨.
  //   구 딥링크(/admin/clinic-management?tab=phrases|fee_set_templates)·북마크 호환을 위해 새 위치로 redirect.
  const MOVED_TO_SERVICES: readonly string[] = ['phrases', 'fee_set_templates'];
  useEffect(() => {
    if (requestedTab && MOVED_TO_SERVICES.includes(requestedTab)) {
      navigate(`/admin/services?tab=${requestedTab}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab]);

  const accessibleTabs = [
    'super_phrases',
    // T-20260615-foot-PHRASE-MEDCHART-CLINICTAB-SPLIT: 진료차트 상용구 딥링크(?tab=medchart_phrases) 허용.
    'medchart_phrases',
    'prescriptions',
    'drug_folders',
    'diagnosis_names',
    'diagnosis_sets',
    'treatment_sets',
    'documents',
    'quick_rx',
    'progress_plans',
    ...(isAdmin ? ['contraindications'] : []),
    ...(canManageInsurance ? ['insurance_status'] : []),
  ];
  const tabAllowed = !!requestedTab && accessibleTabs.includes(requestedTab);
  // 기본 탭: 상용구 이전에 따라 행 1 선두인 '상병명 관리'로 변경.
  const [activeTab, setActiveTab] = useState(tabAllowed ? (requestedTab as string) : 'diagnosis_names');

  useEffect(() => {
    if (tabAllowed) setActiveTab(requestedTab as string);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab]);

  return (
    <div className="h-full overflow-auto p-4 md:p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold">진료관리</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          처방세트·진료세트·상병·서류 템플릿 등 진료 관련 항목을 관리합니다.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        {/* 진료관리 도구 3행 재배치 — T-20260607-foot-DXTOOL-MENU-REORG (문지은 대표원장 C0ATE5P6JTH)
            "다음 줄"=시각 행 분리. flex-wrap 자연 줄바꿈에 의존하지 않고 basis-full 빈 div 로 행 경계를 명시 강제. */}
        <TabsList className="mb-4 flex w-full flex-wrap h-auto gap-1">
          {/* ── 행 1: 상병명 관리 · 묶음상병 · 처방세트 · 묶음처방 · 빠른처방 · 금기증 관리 · 급여여부 관리 ── */}
          {/* AC-1: 상병명 관리 — services.category_label='상병' 단일 SSOT (서비스관리와 동기화) */}
          <TabsTrigger value="diagnosis_names" className="gap-1.5" data-testid="tab-diagnosis-names">
            <ClipboardList className="h-3.5 w-3.5" />
            상병명 관리
          </TabsTrigger>
          {/* T-20260608-foot-DX-BUNDLE-SET (AC-1): 묶음상병 — 여러 상병을 한 세트로 묶어 진료차트 일괄 적용 */}
          <TabsTrigger value="diagnosis_sets" className="gap-1.5" data-testid="tab-diagnosis-sets">
            <Boxes className="h-3.5 w-3.5" />
            묶음상병
          </TabsTrigger>
          {/* Stage B: 기존 '약품 폴더'(drug_folders, 개별 약품 분류 트리) 라벨 → '처방세트'.
              value=drug_folders / data-testid=tab-drug-folders 보존(라우트·E2E 호환). */}
          <TabsTrigger value="drug_folders" className="gap-1.5" data-testid="tab-drug-folders">
            <FolderTree className="h-3.5 w-3.5" />
            처방세트
          </TabsTrigger>
          {/* ── 묶음처방 = prescription_sets 탭(value=prescriptions). 영구 보존(별도 유지) — 2026-06-08 문지은 대표원장 최종결정.
              T-20260607-foot-PROCMENU-RX-UNIFY item2(2026-06-13 문지은 대표원장): "묶음처방은 처방세트 옆에 별도로 만들기"
              → 맨 끝 별도 행에서 '처방세트' 바로 옆으로 이동. dissolve 금지(prescription_sets 보존), 병렬 노출.
              여러 약 조합 단축키·상용구형 처방 묶음(posology 보유). '처방세트'(drug_folders 폴더기능)와 직교한 별개 기능.
              data-testid=tab-prescription-sets-legacy 보존(라우트·E2E 호환). value=prescriptions 유지(?tab 호환). */}
          <TabsTrigger value="prescriptions" className="gap-1.5" data-testid="tab-prescription-sets-legacy">
            <Pill className="h-3.5 w-3.5" />
            묶음처방
          </TabsTrigger>
          <TabsTrigger value="quick_rx" className="gap-1.5" data-testid="tab-quick-rx">
            <Zap className="h-3.5 w-3.5" />
            빠른처방
          </TabsTrigger>
          {/* 금기증 관리 — admin 한정 노출 (admin-write RLS와 일치) */}
          {isAdmin && (
            <TabsTrigger value="contraindications" className="gap-1.5" data-testid="tab-contraindications">
              <ShieldAlert className="h-3.5 w-3.5" />
              금기증 관리
            </TabsTrigger>
          )}
          {/* 급여여부 관리 — admin/manager 노출 (T-20260609-foot-DRUG-INSURANCE-GATE Phase1) */}
          {canManageInsurance && (
            <TabsTrigger value="insurance_status" className="gap-1.5" data-testid="tab-insurance-status">
              <BadgeCheck className="h-3.5 w-3.5" />
              급여여부 관리
            </TabsTrigger>
          )}

          {/* 행 경계 1→2 (flex-wrap 강제 줄바꿈) */}
          <div className="basis-full h-0" aria-hidden="true" />

          {/* ── 행 2: 슈퍼상용구 · 서류 템플릿 ──
              T-20260613-foot-PHRASEMGMT-SUBTAB-SPLIT: '상용구'(phrases) → 서비스관리>상용구관리 로 이전(슈퍼상용구는 잔류). */}
          <TabsTrigger value="super_phrases" className="gap-1.5" data-testid="tab-super-phrases">
            <Sparkles className="h-3.5 w-3.5" />
            슈퍼상용구
          </TabsTrigger>
          {/* T-20260615-foot-PHRASE-MEDCHART-CLINICTAB-SPLIT: 진료차트 상용구(medical_chart) 신규 탭.
              슈퍼상용구(SuperPhrasesTab)와 별개 — 일반 상용구 중 진료차트 임상경과 입력용. */}
          <TabsTrigger value="medchart_phrases" className="gap-1.5" data-testid="tab-medchart-phrases">
            <BookText className="h-3.5 w-3.5" />
            진료차트 상용구
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5" data-testid="tab-documents">
            <FileText className="h-3.5 w-3.5" />
            서류 템플릿
          </TabsTrigger>

          {/* 행 경계 2→3 */}
          <div className="basis-full h-0" aria-hidden="true" />

          {/* ── 행 3: 진료세트 · 경과분석 플랜 ──
              T-20260613-foot-PHRASEMGMT-SUBTAB-SPLIT: '수가세트'(fee_set_templates) → 서비스관리>상용구관리 로 이전. */}
          <TabsTrigger value="treatment_sets" className="gap-1.5" data-testid="tab-treatment-sets">
            <Layers className="h-3.5 w-3.5" />
            진료세트
          </TabsTrigger>
          <TabsTrigger value="progress_plans" className="gap-1.5" data-testid="tab-progress-plans">
            <TrendingUp className="h-3.5 w-3.5" />
            경과분석 플랜
          </TabsTrigger>
        </TabsList>

        {/* 패널 순서는 TabsList 행 순서와 맞춤(value 매칭이라 기능엔 무영향). */}
        {/* 행 1 */}
        <TabsContent value="diagnosis_names">
          <DiagnosisNamesTab />
        </TabsContent>
        <TabsContent value="diagnosis_sets">
          <DiagnosisSetsTab />
        </TabsContent>
        <TabsContent value="drug_folders">
          <DrugFoldersTab />
        </TabsContent>
        <TabsContent value="quick_rx">
          <QuickRxButtonsTab />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="contraindications">
            <ContraindicationsTab />
          </TabsContent>
        )}
        {canManageInsurance && (
          <TabsContent value="insurance_status">
            <InsuranceStatusTab />
          </TabsContent>
        )}
        {/* 행 2 — '상용구'(phrases) TabsContent 는 서비스관리>상용구관리로 이전(T-20260613-foot-PHRASEMGMT-SUBTAB-SPLIT). */}
        <TabsContent value="super_phrases">
          <SuperPhrasesTab />
        </TabsContent>
        {/* T-20260615-foot-PHRASE-MEDCHART-CLINICTAB-SPLIT: 진료차트 상용구 — PhrasesTab 을 medical_chart 로 고정 마운트. */}
        <TabsContent value="medchart_phrases">
          <PhrasesTab lockedType="medical_chart" />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentTemplatesTab />
        </TabsContent>
        {/* 행 3 */}
        <TabsContent value="treatment_sets">
          <TreatmentSetsTab />
        </TabsContent>
        {/* '수가세트'(fee_set_templates) TabsContent 는 서비스관리>상용구관리로 이전(T-20260613-foot-PHRASEMGMT-SUBTAB-SPLIT). */}
        <TabsContent value="progress_plans">
          <ProgressPlansTab />
        </TabsContent>
        {/* 묶음처방 (prescription_sets) — 영구 보존(별도 유지). '처방세트'(drug_folders)와 별개 기능. */}
        <TabsContent value="prescriptions">
          <PrescriptionSetsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
