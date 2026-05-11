// DoctorTools — 진료 도구 관리 (어드민)
// Ticket: T-20260502-foot-DOCTOR-TREATMENT-FLOW (Admin CRUD, 포팅: derm → foot)
// 상용구 / 처방세트 / 서류 템플릿 3탭 관리 페이지

import PhrasesTab from '@/components/admin/PhrasesTab';
import PrescriptionSetsTab from '@/components/admin/PrescriptionSetsTab';
import DocumentTemplatesTab from '@/components/admin/DocumentTemplatesTab';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BookOpen, Pill, FileText } from 'lucide-react';

export default function DoctorTools() {
  return (
    <div className="h-full overflow-auto p-4 md:p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold">진료 도구 관리</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          의사 진료 시 사용하는 상용구, 처방세트, 서류 템플릿을 관리합니다.
        </p>
      </div>

      <Tabs defaultValue="phrases" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="phrases" className="gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            상용구
          </TabsTrigger>
          <TabsTrigger value="prescriptions" className="gap-1.5">
            <Pill className="h-3.5 w-3.5" />
            처방세트
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            서류 템플릿
          </TabsTrigger>
        </TabsList>

        <TabsContent value="phrases">
          <PhrasesTab />
        </TabsContent>

        <TabsContent value="prescriptions">
          <PrescriptionSetsTab />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentTemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
