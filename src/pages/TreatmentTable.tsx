// TreatmentTable.tsx — 치료 테이블 (2섹션 전면 개편)
// Ticket: T-20260620-foot-TREATTABLE-2SECTION-REVAMP (AC-1)
//   reporter: 김주연 총괄 — 기존 치료테이블 메뉴 구성이 의미 불명확 → 2탭으로 재편.
//
//   상단 2탭:
//     ① 진료 환자 이력        → DoctorHistorySection (진료콜 등재 환자 + 처방전/소견·진단서 발행 O/X)
//     ② 균검사 & 피검사 대상자 → ExamTargetsSection   (koh/blood 신청 환자, 1환자 1행 검사박스)
//
//   기존 4뷰(전체/원장/실장/치료사) 치료현황 테이블은 TreatmentStatusPanel 로 분리·보존(라우트 미연결,
//   데이터/로직 손실 0, 필요 시 재노출 가능).

import { useState } from 'react';
import { Stethoscope, ClipboardList } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import DoctorHistorySection from '@/components/treatment/DoctorHistorySection';
import ExamTargetsSection from '@/components/treatment/ExamTargetsSection';

type SectionTab = 'history' | 'exam';

export default function TreatmentTable() {
  const [tab, setTab] = useState<SectionTab>('history');

  return (
    <div className="h-full overflow-auto flex flex-col gap-5 p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Stethoscope className="size-5 text-teal-600" />
          치료 테이블
        </h1>
      </div>

      {/* 2섹션 탭 */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as SectionTab)} className="flex flex-col gap-5">
        <TabsList data-testid="treatment-section-tabs">
          <TabsTrigger value="history" data-testid="tab-doctor-history">
            <Stethoscope className="size-3.5 mr-1.5" />
            진료 환자 이력
          </TabsTrigger>
          <TabsTrigger value="exam" data-testid="tab-exam-targets">
            <ClipboardList className="size-3.5 mr-1.5" />
            균검사 &amp; 피검사 대상자
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="mt-0">
          <DoctorHistorySection />
        </TabsContent>
        <TabsContent value="exam" className="mt-0">
          <ExamTargetsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
