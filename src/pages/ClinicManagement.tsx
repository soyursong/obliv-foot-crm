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
import { canEditClinicMgmt } from '@/lib/permissions';
// T-20260613-foot-PHRASEMGMT-SUBTAB-SPLIT: 상용구(PhrasesTab)·수가세트(FeeSetTemplatesTab) 2개 탭은
//   '서비스관리 > 상용구관리' 서브탭(Services.tsx)으로 이전됨(렌더 위치 이동만). 여기서는 import/탭 제거 + 딥링크 redirect.
import SuperPhrasesTab from '@/components/admin/SuperPhrasesTab';
// T-20260615-foot-PHRASE-MEDCHART-CLINICTAB-SPLIT: 진료차트 상용구(phrase_type=medical_chart) 전용 탭.
//   부모(PHRASEMGMT)가 제거한 'phrases' 탭 복원이 아니라, lockedType='medical_chart' 로 마운트하는 새 surface.
//   value/testid 는 'phrases' 와 다른 신규 키(medchart_phrases) — 부모 redirect(?tab=phrases) 충돌 방지.
import PhrasesTab from '@/components/admin/PhrasesTab';
// T-20260616-foot-OPINION-PHRASE-MGMT-TAB: 소견서 상용구(버튼이름+자동삽입멘트) 관리.
//   진료차트 상용구(PhrasesTab/phrase_templates)와 별개 — form_templates(opinion_doc).field_map.sections 편집(DDL 없음).
import OpinionPhrasesTab from '@/components/admin/OpinionPhrasesTab';
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
// T-20260618-foot-RXFOLDER-INSURANCE-INLINE-MERGE: 급여여부 관리 별도 탭(InsuranceStatusTab) 제거 →
//   처방세트(drug_folders)>전체보기 우측 단 인라인 편집 + HIRA 동기화로 통합. ?tab=insurance_status 는 drug_folders 로 redirect.
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Pill, FileText, Layers, Zap, TrendingUp, ShieldAlert, Sparkles, ClipboardList, FolderTree, Boxes, BookText, MessageSquareText } from 'lucide-react';

export default function ClinicManagement() {
  const { profile } = useAuth();
  // 페이지 접근은 RoleGuard(admin/manager/director)가 1차 보장. 여기서는 금기증(admin 한정)만 추가 게이팅.
  const isAdmin = profile?.role === 'admin';
  // T-20260616-foot-OPINION-PHRASE-MGMT-TAB (AC-1): 소견서 상용구 관리 탭 노출.
  // T-20260620-foot-OPINIONPHRASE-EDIT-DIRECTOR-ONLY: 편집은 어드민의사(대표원장)만(canEditClinicMgmt, 탭 내부 게이트).
  //   탭 가시성(read)은 편집권자 + manager(기존 read 가시성 유지)로 확장 — ★대표원장(director/has_ops_authority)이
  //   탭 자체를 못 보던 lock-out 차단(역배정 후 admin→director swap 대비, MUNJIEUN-CLINICMGMT-LOCKOUT 재발 방지).
  //   manager 는 가시성 유지하되 편집 컨트롤은 canEdit(canEditClinicMgmt)에서 read-only 처리(의료 surface).
  const canManageOpinionPhrases = canEditClinicMgmt(profile) || profile?.role === 'manager';

  // 진료차트 우측 패널 '관리 화면으로' 진입 시 ?tab= 쿼리로 해당 탭 pre-select.
  //   (T-20260606-foot-RX-PANEL-UX-5FIX AC-5 동선 — 메뉴 분리 후 진입 경로를 clinic-management 로 이전)
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // T-20260618-foot-RXFOLDER-INSURANCE-INLINE-MERGE: 급여여부 관리 탭 제거 → 처방세트(drug_folders)로 흡수.
  //   구 딥링크/북마크(?tab=insurance_status) 호환: drug_folders 로 정규화(같은 페이지 내 탭 이동, redirect 불요).
  const rawRequestedTab = searchParams.get('tab');
  const requestedTab = rawRequestedTab === 'insurance_status' ? 'drug_folders' : rawRequestedTab;

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
    // T-20260616-foot-OPINION-PHRASE-MGMT-TAB: 소견서 상용구 딥링크(?tab=opinion_phrases) — admin/manager only.
    ...(canManageOpinionPhrases ? ['opinion_phrases'] : []),
    'prescriptions',
    'drug_folders',
    'diagnosis_names',
    'diagnosis_sets',
    'treatment_sets',
    'documents',
    'quick_rx',
    'progress_plans',
    ...(isAdmin ? ['contraindications'] : []),
    // 급여여부(insurance_status)는 별도 탭 제거 → drug_folders 로 흡수(위 requestedTab 정규화로 호환).
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
          {/* T-20260618-foot-RXFOLDER-INSURANCE-INLINE-MERGE: '급여여부 관리' 별도 탭 제거 →
              처방세트 > [전체보기]에서 약을 클릭해 우측 단에서 인라인 설정 + HIRA 동기화 패널 이전. */}

          {/* 행 경계 1→2 (flex-wrap 강제 줄바꿈) */}
          <div className="basis-full h-0" aria-hidden="true" />

          {/* ── 행 2: 슈퍼상용구 · 서류 템플릿 ──
              T-20260613-foot-PHRASEMGMT-SUBTAB-SPLIT: '상용구'(phrases) → 서비스관리>상용구관리 로 이전(슈퍼상용구는 잔류). */}
          <TabsTrigger value="super_phrases" className="gap-1.5" data-testid="tab-super-phrases">
            <Sparkles className="h-3.5 w-3.5" />
            슈퍼상용구
          </TabsTrigger>
          {/* T-20260615-foot-PHRASE-MEDCHART-CLINICTAB-SPLIT: 진료차트 상용구(medical_chart) 신규 탭.
              슈퍼상용구(SuperPhrasesTab)와 별개 — 일반 상용구 중 진료차트 임상경과 입력용.
              T-20260618-foot-PHRASE-REORDER-CUSTCHART-MENU CS-AC-1 (cross-party 확정):
                고객차트=신규 customer_chart surface로 확정 → 이 탭은 medical_chart(진료차트, 의사 진료관리) 본래 정체로 라벨 환원.
                진료관리는 의사 전용 공간(문지은 대표원장 동의) → '고객차트' 단어 제거. customer_chart 상용구는 서비스관리>상용구관리로 이전.
              value/testid(medchart_phrases)는 딥링크·E2E 보존상 불변, medical_chart 마운트도 불변. */}
          <TabsTrigger value="medchart_phrases" className="gap-1.5" data-testid="tab-medchart-phrases">
            <BookText className="h-3.5 w-3.5" />
            상용구(진료차트)
          </TabsTrigger>
          {/* T-20260616-foot-OPINION-PHRASE-MGMT-TAB (AC-1): 소견서 상용구 — 진료차트 상용구 옆. admin/manager only. */}
          {canManageOpinionPhrases && (
            <TabsTrigger value="opinion_phrases" className="gap-1.5" data-testid="tab-opinion-phrases">
              <MessageSquareText className="h-3.5 w-3.5" />
              소견서 상용구
            </TabsTrigger>
          )}
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
        {/* T-20260618-foot-RXFOLDER-INSURANCE-INLINE-MERGE: insurance_status TabsContent 제거 — drug_folders 로 통합. */}
        {/* 행 2 — '상용구'(phrases) TabsContent 는 서비스관리>상용구관리로 이전(T-20260613-foot-PHRASEMGMT-SUBTAB-SPLIT). */}
        <TabsContent value="super_phrases">
          <SuperPhrasesTab />
        </TabsContent>
        {/* T-20260615-foot-PHRASE-MEDCHART-CLINICTAB-SPLIT: 진료차트 상용구 — PhrasesTab 을 medical_chart 로 고정 마운트. */}
        <TabsContent value="medchart_phrases">
          <PhrasesTab lockedType="medical_chart" />
        </TabsContent>
        {/* T-20260616-foot-OPINION-PHRASE-MGMT-TAB: 소견서 상용구 — form_templates(opinion_doc).field_map.sections 편집. */}
        {canManageOpinionPhrases && (
          <TabsContent value="opinion_phrases">
            <OpinionPhrasesTab />
          </TabsContent>
        )}
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
