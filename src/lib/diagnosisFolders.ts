// diagnosisFolders — 상병 폴더 트리 공용 타입·훅
// Ticket: T-20260607-foot-DXRX-MGMT-2PANEL (갈래① 상병명 2패널, 문지은 대표원장 C0ATE5P6JTH)
//
// 현장 용어 ↔ 코드 식별자:
//   현장 "상병명"     = 진료차트가 선택하는 진단명 정본 → services (category_label='상병') SSOT
//   현장 "폴더(좌측)" = 상병 분류 폴더(어드민 관리)      → diagnosis_folders (자기참조 트리)
//   현장 "집어넣기"   = 상병 1건을 폴더로 이동            → services.diagnosis_folder_id FK (move 시맨틱)
//
// drugFolders.ts(처방 폴더) 미러. 단, 약품은 junction(prescription_code_folders)인 반면
// 상병은 services.diagnosis_folder_id 직접 FK 라 매핑 테이블이 없다(상병 1건 = 폴더 0~1개).
//
// 스키마: 20260607200000_diagnosis_folders_fk.sql (D3 supervisor 게이트 GO, 2026-06-08 dev 적용).
//   diagnosis_folders(id, clinic_id NOT NULL, parent_id, name, sort_order)
//   services.diagnosis_folder_id uuid NULL FK ON DELETE SET NULL
//   레거시 TEXT services.diagnosis_folder 는 안전망으로 공존(별건 deprecate).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface DiagnosisFolder {
  id: string;
  clinic_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
}

export interface DiagnosisFolderNode extends DiagnosisFolder {
  children: DiagnosisFolderNode[];
  depth: number;
}

// ---------------------------------------------------------------------------
// Tree 빌더 — flat 폴더 목록 → 중첩 트리 (다단계, sort_order→가나다)
//   drugFolders.buildFolderTree 와 동일 알고리즘(순환참조 방어 포함).
// ---------------------------------------------------------------------------
export function buildDiagnosisFolderTree(folders: DiagnosisFolder[]): DiagnosisFolderNode[] {
  const byParent = new Map<string | null, DiagnosisFolder[]>();
  for (const f of folders) {
    const key = f.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(f);
  }
  const sortFn = (a: DiagnosisFolder, b: DiagnosisFolder) =>
    a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko');

  // 순환참조 방어(데이터 사고 시 무한재귀 차단): 방문한 id 추적.
  const build = (parentId: string | null, depth: number, seen: Set<string>): DiagnosisFolderNode[] => {
    const kids = (byParent.get(parentId) ?? []).slice().sort(sortFn);
    return kids
      .filter((f) => !seen.has(f.id))
      .map((f) => {
        const nextSeen = new Set(seen).add(f.id);
        return { ...f, depth, children: build(f.id, depth + 1, nextSeen) };
      });
  };
  return build(null, 0, new Set());
}

// 마이그 미적용 환경(테이블 부재) 식별 — 읽기 폴백용.
//   42P01 = relation does not exist / PGRST205 = PostgREST 스키마캐시 미존재.
function isMissingFoldersTable(e: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = e as any;
  return (
    !!err &&
    (err.code === '42P01' ||
      err.code === 'PGRST205' ||
      /diagnosis_folders/i.test(err.message ?? ''))
  );
}

// ---------------------------------------------------------------------------
// Read hook — 지점 격리(clinic_id) 필수
// ---------------------------------------------------------------------------
export function useDiagnosisFolders(clinicId: string | null) {
  return useQuery({
    queryKey: ['diagnosis_folders', clinicId],
    enabled: !!clinicId,
    queryFn: async (): Promise<DiagnosisFolder[]> => {
      const { data, error } = await supabase
        .from('diagnosis_folders')
        .select('id,clinic_id,parent_id,name,sort_order')
        .eq('clinic_id', clinicId)
        .order('sort_order', { ascending: true });
      if (error) {
        // deploy-tolerant: 마이그 미적용 환경에서도 화면이 깨지지 않게 빈 목록 폴백.
        if (isMissingFoldersTable(error)) return [];
        throw error;
      }
      return (data ?? []) as DiagnosisFolder[];
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Admin mutations — 호출부에서 role gate 필수 (director/manager/admin)
// ---------------------------------------------------------------------------
export function useCreateDiagnosisFolder(clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; parent_id?: string | null; sort_order?: number }) => {
      if (!clinicId) throw new Error('지점 정보가 없어 폴더를 만들 수 없어요.');
      const { error } = await supabase.from('diagnosis_folders').insert({
        clinic_id: clinicId,
        name: input.name.trim(),
        parent_id: input.parent_id ?? null,
        sort_order: input.sort_order ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diagnosis_folders'] }),
  });
}

export function useUpdateDiagnosisFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      parent_id?: string | null;
      sort_order?: number;
    }) => {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.parent_id !== undefined) patch.parent_id = input.parent_id;
      if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
      const { error } = await supabase.from('diagnosis_folders').update(patch).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diagnosis_folders'] }),
  });
}

export function useDeleteDiagnosisFolder() {
  const qc = useQueryClient();
  return useMutation({
    // ON DELETE CASCADE: 하위 폴더 연쇄 삭제. 상병(services) 자체는 보존 —
    // services.diagnosis_folder_id FK 는 ON DELETE SET NULL 이라 미분류로 환원.
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('diagnosis_folders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnosis_folders'] });
      qc.invalidateQueries({ queryKey: ['diagnosis_master'] });
    },
  });
}

/**
 * 상병(services 행)을 폴더로 배정(이동) 또는 미분류로 환원.
 *   folder_id=null → 미분류. junction 없이 services.diagnosis_folder_id 직접 UPDATE.
 */
export function useAssignDiagnosisToFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { service_id: string; folder_id: string | null }) => {
      const { error } = await supabase
        .from('services')
        .update({ diagnosis_folder_id: input.folder_id })
        .eq('id', input.service_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnosis_master'] });
      qc.invalidateQueries({ queryKey: ['diagnosis_folders'] });
    },
  });
}
