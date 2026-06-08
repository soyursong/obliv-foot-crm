// drugFolders — 약품 폴더 트리 공용 타입·훅
// Ticket: T-20260606-foot-RX-SET-REDESIGN
//
// 현장 용어 ↔ 코드 식별자 (AC-R6):
//   현장 "처방세트" = 전체 약 카탈로그          → prescription_codes
//   현장 "폴더"      = 약 분류/탐색 도구(어드민)  → prescription_folders (+ prescription_code_folders 매핑)
//   현장 "묶음처방"  = 빠른처방 프리셋            → prescription_sets
//
// 본 모듈은 "폴더" 축만 담당(약 1건 = 폴더 0~1개, move 시맨틱). 카탈로그·묶음처방은 무관.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface DrugFolder {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
}

export interface DrugFolderNode extends DrugFolder {
  children: DrugFolderNode[];
  depth: number;
}

/** 폴더에 분류된 약품 1건 (prescription_code_folders ⋈ prescription_codes) */
export interface FolderDrug {
  prescription_code_id: string;
  folder_id: string;
  sort_order: number;
  name_ko: string;
  claim_code: string;
  classification: string | null;
  code_source: string; // 'official' | 'custom'
  manufacturer: string | null; // DRUGINFO-MANUFACTURER: 제약사(제조사). custom 코드는 NULL 가능 → 표기 생략.
}

// ---------------------------------------------------------------------------
// Tree 빌더 — flat 폴더 목록 → 중첩 트리 (다단계, sort_order→가나다)
// ---------------------------------------------------------------------------
export function buildFolderTree(folders: DrugFolder[]): DrugFolderNode[] {
  const byParent = new Map<string | null, DrugFolder[]>();
  for (const f of folders) {
    const key = f.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(f);
  }
  const sortFn = (a: DrugFolder, b: DrugFolder) =>
    a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko');

  // 순환참조 방어(데이터 사고 시 무한재귀 차단): 방문한 id 추적.
  const build = (parentId: string | null, depth: number, seen: Set<string>): DrugFolderNode[] => {
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

// ---------------------------------------------------------------------------
// Read hooks (진료차트 탐색기 + 어드민 공용)
// ---------------------------------------------------------------------------
export function useDrugFolders() {
  return useQuery({
    queryKey: ['prescription_folders'],
    queryFn: async (): Promise<DrugFolder[]> => {
      const { data, error } = await supabase
        .from('prescription_folders')
        .select('id,parent_id,name,sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DrugFolder[];
    },
    staleTime: 30_000,
  });
}

export function useFolderDrugs() {
  return useQuery({
    queryKey: ['prescription_code_folders'],
    queryFn: async (): Promise<FolderDrug[]> => {
      const { data, error } = await supabase
        .from('prescription_code_folders')
        .select(
          'prescription_code_id, folder_id, sort_order, prescription_codes(name_ko,claim_code,classification,code_source,manufacturer)',
        )
        .order('sort_order', { ascending: true });
      if (error) throw error;
      // 평탄화: 조인된 prescription_codes 를 1단계로 끌어올린다.
      type Row = {
        prescription_code_id: string;
        folder_id: string;
        sort_order: number;
        prescription_codes: {
          name_ko: string;
          claim_code: string;
          classification: string | null;
          code_source: string;
          manufacturer: string | null;
        } | null;
      };
      return ((data ?? []) as unknown as Row[])
        .filter((r) => !!r.prescription_codes)
        .map((r) => ({
          prescription_code_id: r.prescription_code_id,
          folder_id: r.folder_id,
          sort_order: r.sort_order,
          name_ko: r.prescription_codes!.name_ko,
          claim_code: r.prescription_codes!.claim_code,
          classification: r.prescription_codes!.classification,
          code_source: r.prescription_codes!.code_source,
          manufacturer: r.prescription_codes!.manufacturer ?? null,
        }));
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Admin mutations (어드민 폴더 관리 화면 전용) — 호출부에서 role gate 필수
// ---------------------------------------------------------------------------
export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; parent_id: string | null; sort_order?: number }) => {
      const { error } = await supabase.from('prescription_folders').insert({
        name: input.name.trim(),
        parent_id: input.parent_id,
        sort_order: input.sort_order ?? 0,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prescription_folders'] }),
  });
}

export function useUpdateFolder() {
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
      const { error } = await supabase.from('prescription_folders').update(patch).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prescription_folders'] }),
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    // ON DELETE CASCADE: 하위 폴더·매핑(prescription_code_folders) 자동 정리. 약품 자체는 보존(미분류 환원).
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('prescription_folders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription_folders'] });
      qc.invalidateQueries({ queryKey: ['prescription_code_folders'] });
    },
  });
}

/** 약품을 폴더에 배정(이동). PK=code_id 라 upsert 로 단일 폴더 보장. */
export function useAssignDrugToFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { prescription_code_id: string; folder_id: string; sort_order?: number }) => {
      const { error } = await supabase
        .from('prescription_code_folders')
        .upsert(
          {
            prescription_code_id: input.prescription_code_id,
            folder_id: input.folder_id,
            sort_order: input.sort_order ?? 0,
          },
          { onConflict: 'prescription_code_id' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prescription_code_folders'] }),
  });
}

export function useUnassignDrug() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (prescription_code_id: string) => {
      const { error } = await supabase
        .from('prescription_code_folders')
        .delete()
        .eq('prescription_code_id', prescription_code_id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prescription_code_folders'] }),
  });
}
