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
  code_type: string; // 'national' 류 정상 / '이관약'(묶음처방 이관 provenance 마커, 검증 대상) / '자체사용코드' 등
  // T-20260618-foot-RXFOLDER-INSURANCE-INLINE-MERGE (AC-1): 전체보기 행 급여여부 배지 + 인라인 편집 패널용.
  //   prescription_codes.insurance_status (covered/non_covered/deleted/criteria_changed/NULL).
  insurance_status: string | null;
  // T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN (Part C/D): 약별 자유텍스트 설명(메모).
  //   prescription_codes.description (NULL=미설정). 전체보기 '설명' 컬럼 인라인 편집 + 진료차트 hover 툴팁 SSOT.
  //   컬럼 미적용 DB(deploy-tolerant) 대비 ?? null.
  description: string | null;
}

/** 검증 대상 마커 — 묶음처방→처방세트 이관 시 부여(20260616120000_bundlerx_drugname_migrate).
 *  read-only: 전체보기 행에서 '이관' 배지 + 검증 버튼 UI surface 노출 게이트로만 사용.
 *  ※ 검증(verify) semantics/DML(code_type 승격 UPDATE)은 본 티켓(MIGCLEAR) 범위 아님 —
 *    T-20260617-foot-RX-VALID-TAG-REMOVE 정본 경로로 단일 구현(중복 빌드 0, code_type 임의 UPDATE 금지). */
export const MIGRATED_CODE_TYPE = '이관약';

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
          'prescription_code_id, folder_id, sort_order, prescription_codes(name_ko,claim_code,classification,code_source,manufacturer,code_type,insurance_status,description)',
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
          code_type: string | null;
          insurance_status: string | null;
          description: string | null;
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
          code_type: r.prescription_codes!.code_type ?? '',
          insurance_status: r.prescription_codes!.insurance_status ?? null,
          // deploy-tolerant: description 컬럼 미적용 DB 에선 undefined → null 정규화(툴팁/셀 빈 표시).
          description: r.prescription_codes!.description ?? null,
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

// ---------------------------------------------------------------------------
// T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN (Part C): 약별 설명 저장(인라인 에디터)
//   prescription_codes.description UPDATE. write = prescription_codes_admin_all RLS
//   (is_admin_or_manager: admin/manager/director — RXCODES-WRITE-RLS-CANONICAL f22d8b1b 라이브).
//   호출부 role 게이트(canEdit) + RLS 이중 가드. 저장 후 전체보기/툴팁 캐시(prescription_code_folders) 무효화.
//   InsuranceStatusPanel.upsert 동형 패턴(supabase as any — generated types 에 description 미반영 대비).
// ---------------------------------------------------------------------------
export function useUpdateDrugDescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { prescription_code_id: string; description: string | null }) => {
      const value = input.description == null || input.description.trim() === '' ? null : input.description.trim();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('prescription_codes')
        .update({ description: value })
        .eq('id', input.prescription_code_id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prescription_code_folders'] }),
  });
}

// ---------------------------------------------------------------------------
// T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN (Part E): 처방내역 약 설명 lookup
//   진료차트 처방내역(formRx) 약은 PrescriptionItem.prescription_code_id 만 보유(설명 미적재).
//   hover 툴팁(Part E)에 prescription_codes.description 을 표시하려면 code_id→description 맵이 필요.
//   읽기 전용·소량(현재 처방 약 수 man 큼) — id 배열을 정렬·dedup 해 queryKey 안정화.
//   deploy-tolerant: description 컬럼 미적용 DB 면 select 에러 → 빈 맵 폴백(툴팁 약정보만).
// ---------------------------------------------------------------------------
export function useDrugDescriptions(codeIds: Array<string | null | undefined>) {
  const ids = Array.from(new Set(codeIds.filter((x): x is string => !!x))).sort();
  return useQuery({
    queryKey: ['rx_drug_descriptions', ids],
    enabled: ids.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<Map<string, string>> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('prescription_codes')
        .select('id,description')
        .in('id', ids);
      if (error) {
        // 컬럼 부재 등 → 툴팁은 약정보만 표시(깨짐 없음). 조용한 폴백.
        return new Map();
      }
      const m = new Map<string, string>();
      for (const row of (data ?? []) as Array<{ id: string; description: string | null }>) {
        if (row.description && row.description.trim() !== '') m.set(row.id, row.description.trim());
      }
      return m;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 이관약 검증(verify) DML 은 본 티켓(MIGCLEAR) 범위 아님.
//   CORRECTION(MSG-…RXSET-VIEWALL-TABLE-MIGCLEAR): "검증 action 의 의미·DML 은 MIGCLEAR 에서 구현하지 말 것.
//   MIGCLEAR 에서 code_type 임의 UPDATE 금지." → 검증 승격 hook·승격 마커 상수를 본 lib 에서 제거.
//   검증 semantics·DML·정합(가설A 자체배지 vs 가설B 별도 검증상태 그라운딩, risk#4 대량 UPDATE 게이트)은
//   T-20260617-foot-RX-VALID-TAG-REMOVE 정본 경로 Step 1(READ-ONLY) 이후 단일 구현.
// ─────────────────────────────────────────────────────────────────────────────
