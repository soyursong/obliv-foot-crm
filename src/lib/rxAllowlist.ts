// rxAllowlist — 진료차트 처방 화이트리스트(overlay) 공용 훅·플래그
// Ticket: T-20260615-foot-RX-WHITELIST-FOLDERTREE (DA Model B)
//
// 설계(DA 판정 SSOT da_decision_foot_rx_whitelist_foldertree_20260718.md):
//   화이트리스트를 실제 렌더 arm(prescription_codes)에 앵커한 overlay 테이블
//   prescription_code_allowlist(positive allowlist, default-deny)를 read.
//   DrugFolderTree(약품폴더트리) = prescription_codes arm 이므로 enabled 코드로만 필터.
//
// ★ 착지 순서(임상 안전, 강제):
//   Phase 1(현재) = enforcement feature-flag **OFF** ship. 플래그 OFF 면 이 훅은 조회조차 안 하고
//     enforced=false 를 반환 → 호출부(DrugFolderTree)는 기존과 동일하게 전량 노출(무회귀).
//   Phase 2 = 문지은 대표원장 CONTENT confirm 후 planner 지시로 flag ON flip.
//   🚫 빈 테이블 + enforcement ON = day-1 전 처방 차단(임상 위해). 임의 ON 금지.
//
// ★ 롤백 = flag OFF(fail-OPEN=전량 노출 복귀). fail-CLOSED(전면 차단) 절대 금지.
//
// 플래그 소스 = 빌드타임 env VITE_RX_ALLOWLIST_ENFORCEMENT ('on' 일 때만 ON, 그 외/미설정=OFF).
//   빌드타임 상수라 런타임 오조작으로 켜질 수 없음(임상 안전). ON flip = env 설정 + 재배포.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// 단일지점이나 per-clinic scope 표준(cross_crm_data_contract). prod 실측값 = 'jongno-foot'.
export const FOOT_CLINIC_SLUG = 'jongno-foot';

// Vite(런타임)=import.meta.env / Playwright(Node ESM)=process.env 폴백 — supabase.ts 동형.
const viteEnv = ((import.meta as unknown as { env?: Record<string, string> }).env) ?? {};
const procEnv = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};

/**
 * 처방 화이트리스트 enforcement 활성 여부(빌드타임 플래그).
 * default OFF — VITE_RX_ALLOWLIST_ENFORCEMENT === 'on' 일 때만 true.
 * Phase 1 은 이 값이 항상 false(env 미설정) → 무회귀.
 */
export function isRxAllowlistEnforced(): boolean {
  const raw = (viteEnv.VITE_RX_ALLOWLIST_ENFORCEMENT ?? procEnv.VITE_RX_ALLOWLIST_ENFORCEMENT ?? '')
    .toString()
    .trim()
    .toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true';
}

/**
 * enabled 화이트리스트 코드 집합(Set<prescription_code_id>).
 * enforcement OFF 면 조회하지 않고(enabled:false) 빈 Set 반환 → 호출부는 필터를 건너뛴다.
 * enforcement ON 이어야만 네트워크 조회. RLS = is_approved_user() (승인 staff 전원 read).
 */
export function usePrescriptionCodeAllowlist() {
  const enforced = isRxAllowlistEnforced();
  const query = useQuery({
    queryKey: ['prescription_code_allowlist', FOOT_CLINIC_SLUG],
    enabled: enforced,
    staleTime: 60_000,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('prescription_code_allowlist')
        .select('prescription_code_id')
        .eq('clinic_slug', FOOT_CLINIC_SLUG)
        .eq('enabled', true);
      if (error) throw error;
      return new Set((data ?? []).map((r) => (r as { prescription_code_id: string }).prescription_code_id));
    },
  });
  return {
    enforced,
    allowedIds: query.data ?? new Set<string>(),
    isLoading: enforced && query.isLoading,
    error: query.error,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T-20260718-foot-RX-ALLOWLIST-CURATION-UI (Phase 2a) — 큐레이션(입력) 훅
//   ★ 위 usePrescriptionCodeAllowlist 는 enforcement OFF 면 조회조차 안 함(렌더 필터용).
//     큐레이션 UI 는 enforcement 와 무관하게 항상 현재 승인 상태를 읽어 토글에 반영해야 하므로
//     별도 훅으로 분리. 조회 게이트 = 호출부의 canEdit(admin surface) 로만 제어(enforcement 무접촉).
//   ★ 본 훅/뮤테이션은 오직 prescription_code_allowlist overlay 만 건드림.
//     DrugFolderTree/묶음처방/searchRxCodes 렌더 경로는 무접촉 → 현장 처방 동선 무회귀(AC-3).
// ─────────────────────────────────────────────────────────────────────────────

const CURATION_QUERY_KEY = ['prescription_code_allowlist_curation', FOOT_CLINIC_SLUG] as const;

/**
 * 큐레이션용 승인 상태 맵(prescription_code_id → enabled).
 * enforcement 플래그와 무관하게 조회(큐레이션 도구 전용). enabled=canEdit(admin surface)로만 조회 제어.
 * RLS read = is_approved_user(). 미등록 코드는 맵에 부재(= 아직 큐레이션 안 됨 = default OFF 표시).
 */
export function useRxAllowlistCurationMap(enabled: boolean) {
  const query = useQuery({
    queryKey: CURATION_QUERY_KEY,
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<Map<string, boolean>> => {
      const { data, error } = await supabase
        .from('prescription_code_allowlist')
        .select('prescription_code_id, enabled')
        .eq('clinic_slug', FOOT_CLINIC_SLUG);
      if (error) throw error;
      const m = new Map<string, boolean>();
      for (const r of (data ?? []) as Array<{ prescription_code_id: string; enabled: boolean }>) {
        m.set(r.prescription_code_id, !!r.enabled);
      }
      return m;
    },
  });
  return {
    enabledMap: query.data ?? new Map<string, boolean>(),
    isLoading: enabled && query.isLoading,
    error: query.error,
  };
}

/**
 * 처방 허용 토글 upsert(overlay). onConflict=(clinic_slug, prescription_code_id) 로 단일 행 보장.
 * 감사(AC-2): curated_by=현 auth 사용자 id / curated_at=now(). write RLS = is_admin_or_manager().
 */
export function useToggleRxAllowlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { prescription_code_id: string; enabled: boolean }) => {
      const { data: userData } = await supabase.auth.getUser();
      const curatedBy = userData?.user?.id ?? null;
      const { error } = await supabase
        .from('prescription_code_allowlist')
        .upsert(
          {
            clinic_slug: FOOT_CLINIC_SLUG,
            prescription_code_id: input.prescription_code_id,
            enabled: input.enabled,
            curated_by: curatedBy,
            curated_at: new Date().toISOString(),
          },
          { onConflict: 'clinic_slug,prescription_code_id' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CURATION_QUERY_KEY }),
  });
}
