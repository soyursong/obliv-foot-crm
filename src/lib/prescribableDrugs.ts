// prescribableDrugs — 처방 가능 약(=금기증관리에서 선택 가능 약) 단일 출처 캡슐화
// Ticket: T-20260607-foot-CONTRAINDICATION-MGMT
//
// 설계 의도(planner MSG-211523-vwhi §1 — 재바인딩 비용 최소화 의무):
//   "약 출처 조회를 단일 함수/쿼리로 캡슐화. 인라인 쿼리 산재 금지.
//    PROCMENU-RX-UNIFY(z9v8) 통일 확정 시 소스 테이블 스왑 1곳만으로 재바인딩."
//   → 약 출처를 바꿀 때 건드릴 곳은 오직 getPrescribableCodeIds() 한 곳.
//
// baseline(2026-06-07 확정, ticket frontmatter baseline_confirmed: prescription_sets):
//   처방 가능 약 = '처방세트(prescription_sets)'에 등록된 약.
//   처방항목은 prescription_sets.items JSONB 배열 원소이며 각 원소가 prescription_code_id(nullable)를 보유.
//   따라서 "처방세트 등록 약" = 전 세트 items 의 distinct prescription_code_id 집합.
//   (자유텍스트 수기항목은 prescription_code_id=null → 마스터 약이 아니므로 자연 제외)

import { supabase } from '@/lib/supabase';
import { checkRxInsuranceGate, type RxInsuranceGateResult } from '@/lib/prescriptionGate';

// ═══════════════════════════════════════════════════════════════════════════
// services 처방약 소스 캡슐 — T-20260615-foot-RXSET-DRUGSOURCE-SVCRX (AC-1/AC-2)
//   김주연 총괄 A(공유) 회신: 처방세트 빌더 약 출처를 '서비스관리>처방약'(근방 약국 실제
//   처방 가능 약, services category_label='처방약' AND active=true)로 제한.
//
//   ⚠️ 단일 재바인딩 지점(AC-2): 처방 가능 약 '공통 소스'를 services 처방약으로 둘 단일 캡슐.
//      현재는 처방세트 빌더(PrescriptionSetsTab)만 이 소스를 소비.
//      진료차트 처방(QuickRxBar/MedicalChartPanel) 런타임 약 출처는 이번 변경에서 불변
//      (RX-DRUG-WHITELIST 대표원장 확인 후 별도 트랙에서 이 함수로 단일 재바인딩).
//
//   ⚠️ services 처방약 행은 prescription_codes FK가 없는 별도 엔티티(service_code=EDI 청구코드 보유).
//      따라서 이 소스로 선택한 약은 prescription_code_id=null(진료차트 금기/급여 게이트는 자유텍스트와
//      동일하게 skip). 실제 처방전/청구(rx_items_html·rx_standard)는 이미 services.service_code 사용
//      → 청구코드 연결 손실 없음(AC-0 §C 그라운딩 결과).
// ═══════════════════════════════════════════════════════════════════════════

export interface ServiceRxDrug {
  id: string; // services.id (⚠️ prescription_codes.id 아님 — prescription_code_id로 저장 금지)
  name: string; // services.name
  service_code: string | null; // EDI 청구코드(표시용)
}

/**
 * AC-1 처방세트 빌더 약 출처 — services category_label='처방약' AND active=true 리스트.
 *   query 빈 문자열이면 전체 처방약 리스트 반환('리스트 선택' UX, 포커스 시 전체 노출).
 *   query 있으면 name/service_code ilike 필터(처방약 외 임의 EDI 약명은 결과에 안 뜸).
 */
export async function searchServiceRxDrugs(query: string): Promise<ServiceRxDrug[]> {
  const q = query.trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let req = (supabase as any)
    .from('services')
    .select('id,name,service_code')
    .eq('category_label', '처방약')
    .eq('active', true);
  if (q.length >= 1) {
    const esc = q.replace(/[%,]/g, ' ');
    req = req.or(`name.ilike.%${esc}%,service_code.ilike.%${esc}%`);
  }
  const { data, error } = await req.order('sort_order', { ascending: true }).limit(50);
  if (error) throw error;
  return ((data ?? []) as { id: string; name: string; service_code: string | null }[]).map((r) => ({
    id: `${r.id}`,
    name: r.name,
    service_code: r.service_code ?? null,
  }));
}

export interface PrescribableDrug {
  id: string;
  name_ko: string;
  claim_code: string | null;
  classification: string | null;
  code_source: string | null;
  ingredient_code: string | null; // AC-2 성분 중복 비교 키(대체키). prescription_codes 보유.
  manufacturer: string | null; // DRUGINFO-MANUFACTURER: 제약사(제조사) — 패널/검색 노출용. custom 코드는 NULL 가능.
}

/**
 * AC-1 약 출처 정본 — 처방세트에 등록된 약의 prescription_code_id 집합.
 *
 * ⚠️ 재바인딩 단일 지점: PROCMENU-RX-UNIFY 통일 확정 시 이 함수 내부 소스만 교체한다.
 *    (예: 통합 약 마스터 테이블 직접 조회로 스왑) — 호출부(searchPrescribableDrugs 등)는 무변경.
 */
export async function getPrescribableCodeIds(): Promise<Set<string>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('prescription_sets')
    .select('items'); // is_active 무관 — '등록된' 약 전부 포함(폐기세트 약의 과도차단 방지)
  if (error) throw error;
  const ids = new Set<string>();
  for (const row of (data ?? []) as { items?: unknown }[]) {
    const items = Array.isArray(row?.items) ? row.items : [];
    for (const it of items as { prescription_code_id?: string | null }[]) {
      const id = it?.prescription_code_id;
      if (id != null && `${id}`.trim() !== '') ids.add(`${id}`);
    }
  }
  return ids;
}

/**
 * AC-1 약 검색 — 처방세트 등록 약으로 출처 제한된 prescription_codes 검색.
 * name_ko / claim_code ilike + 처방세트 등록 id 교집합. custom(자체) 우선 정렬.
 */
export async function searchPrescribableDrugs(query: string): Promise<PrescribableDrug[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const ids = await getPrescribableCodeIds();
  if (ids.size === 0) return []; // 처방세트에 등록된 약이 0건이면 선택 가능 약 없음
  const esc = q.replace(/[%,]/g, ' ');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('prescription_codes')
    .select('id,name_ko,claim_code,classification,code_source,ingredient_code,manufacturer')
    .in('id', Array.from(ids)) // 출처 제한(AND 결합)
    .or(`name_ko.ilike.%${esc}%,claim_code.ilike.%${esc}%`)
    .order('code_source', { ascending: false }) // custom 우선
    .limit(20);
  if (error) throw error;
  return (data as PrescribableDrug[]) ?? [];
}

/**
 * AC-2 성분 중복 검출 — 선택 약과 동일 성분(ingredient_code)인 '다른' 약 중
 *   이미 금기증이 등록된 약 목록을 반환. 빈 배열이면 중복 경고 불요.
 *
 * 매칭 키 결정(AC-0 결과): prescription_codes 에 성분명(ingredient) 텍스트 컬럼은 없으나
 *   ingredient_code(주성분코드)가 존재·시드 채워짐 → 이를 대체키로 사용.
 *   exact-match(완전 동일 코드)만 경고 → false-positive 0 (보수적·의료안전 우선).
 *   ingredient_code 가 비어있는 약은 비교 불가로 간주(경고 안 함).
 */
export async function findSameIngredientRegistered(
  drug: { id: string; ingredient_code: string | null },
): Promise<{ id: string; name_ko: string }[]> {
  const code = (drug.ingredient_code ?? '').trim();
  if (!code) return [];
  // 1) 동일 성분코드의 형제 약(자기 제외)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: siblings, error: sErr } = await (supabase as any)
    .from('prescription_codes')
    .select('id,name_ko')
    .eq('ingredient_code', code)
    .neq('id', drug.id);
  if (sErr) throw sErr;
  const sibList = (siblings ?? []) as { id: string; name_ko: string }[];
  if (sibList.length === 0) return [];
  // 2) 형제 약 중 이미 금기증이 등록된 약만 추림
  const sibIds = sibList.map((s) => s.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contras, error: cErr } = await (supabase as any)
    .from('prescription_contraindications')
    .select('prescription_code_id')
    .in('prescription_code_id', sibIds);
  if (cErr) throw cErr;
  const registered = new Set(
    ((contras ?? []) as { prescription_code_id: string }[]).map((c) => `${c.prescription_code_id}`),
  );
  return sibList.filter((s) => registered.has(s.id));
}

// ═══════════════════════════════════════════════════════════════════════════
// 급여여부(보험상태) 게이트 — async 조회+평가 (T-20260609-foot-DRUG-INSURANCE-GATE Phase1)
//   순수 판정은 prescriptionGate.checkRxInsuranceGate. 여기선 prescription_code_id 로 상태 조회 후 위임.
//   ※ 약 출처(처방세트)와 무관하게 prescription_codes.id 직접 조회 — 게이트는 코드 보유 약 전부 대상.
// ═══════════════════════════════════════════════════════════════════════════

/** prescription_code_id → insurance_status 매핑 조회 (Phase1 source 무관, 상태값만). */
export async function fetchInsuranceStatuses(
  codeIds: string[],
): Promise<Map<string, string | null>> {
  const ids = Array.from(new Set((codeIds ?? []).filter((x) => !!x && `${x}`.trim() !== '')));
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('prescription_codes')
    .select('id,insurance_status')
    .in('id', ids);
  if (error) throw error;
  for (const row of (data ?? []) as { id: string; insurance_status: string | null }[]) {
    map.set(`${row.id}`, row.insurance_status ?? null);
  }
  return map;
}

/**
 * 급여여부 게이트 평가 — 코드 보유 약의 insurance_status 를 조회해 차단상태를 판정(순수 게이트에 위임).
 *
 * fail-open(degrade): 조회 실패 시 통과(allowed=true, blocked=[]) — Phase1 점진 적용 정책(planner LOCK).
 *   급여여부는 billing 편의 게이트(안전성 게이트 아님)이므로 조회 장애가 처방을 막지 않는다.
 *   (대비: 금기증 게이트(AC-2)는 의료안전 직결이라 fail-closed.)
 *
 * @param role  현재 사용자 role (관리자 해제 override 가능 여부 판정용)
 * @param items 처방 항목(prescription_code_id 보유분만 게이트 대상)
 */
export async function evaluateRxInsuranceGate(
  role: string | null | undefined,
  items: { name?: string; prescription_code_id?: string | null }[],
): Promise<RxInsuranceGateResult> {
  const list = items ?? [];
  const codeIds = list
    .map((i) => i.prescription_code_id)
    .filter((x): x is string => !!x && `${x}`.trim() !== '');
  // 코드 없는(자유텍스트) 처방만이면 게이트 대상 없음 → 통과.
  if (codeIds.length === 0) return { allowed: true, overridable: false, blocked: [] };
  try {
    const statusMap = await fetchInsuranceStatuses(codeIds);
    const withStatus = list.map((it) => ({
      ...it,
      insurance_status: it.prescription_code_id
        ? statusMap.get(`${it.prescription_code_id}`) ?? null
        : null,
    }));
    return checkRxInsuranceGate(role, withStatus);
  } catch {
    // fail-open(degrade) — Phase1: 조회 장애가 처방을 막지 않음.
    //   TODO(Phase1.5 하드닝): 서버측 강제(medical_charts UPDATE trigger/RPC)로 FE-only 우회 차단.
    console.warn('[RX-INSURANCE-GATE] insurance_status 조회 실패 — fail-open 통과', { codeIds });
    return { allowed: true, overridable: false, blocked: [] };
  }
}
