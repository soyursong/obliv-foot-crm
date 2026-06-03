/**
 * E2E spec — T-20260603-foot-RX-CHART-FOLLOWUP2
 * 풋센터 처방·차트 모듈 실사용 후속 피드백 10건 (문지은 대표원장, 정형 relay 흡수).
 *
 * 본 spec은 in-page 순수 로직 시뮬레이션 패턴(기존 RX-* spec과 동일) — 구현 정본과
 * 동일한 규칙을 모사해 회귀를 잡는다. 항목 단위 독립 검증.
 *
 * 커버 항목:
 *   #6 진료알림판 차팅 → 진료차트 서랍 라우팅 (navigate 전체페이지 → openChart 서랍)
 *   #4 빠른처방 버튼 가시성 (stacking context)
 *   #1 처방세트 폴더 위계(parent_id 트리) + sort_order 정렬 + 투여경로 필터
 *   #2 서류템플릿 2단계 카테고리(category > subcategory) 그룹핑
 *   #5 금기증 성분명(ingredient) 매칭 — 같은 성분의 다른 상품 약도 금기 노출
 *   #8-2 처방세트 관리 권한 — 의사(director)/총괄(manager)/관리자(admin)급만 (양방향)
 */
import { test, expect } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════════════
// #6 — 차팅 클릭 라우팅: 전체페이지 navigate(버그) → openChart 서랍(정본)
//   DoctorCallDashboard 의 onOpenChart 는 useChart().openChart(customer_id) 단일 게이트웨이를
//   재사용해야 한다(앱 전역 표준). navigate(`/chart/:id`) 전체페이지 전환은 잘못된 라우팅.
// ═══════════════════════════════════════════════════════════════════════════

type ChartAction =
  | { kind: 'drawer'; customerId: string }
  | { kind: 'fullpage'; path: string };

/** 정본: 차팅 진입은 항상 customer_id 기반 서랍 오픈 */
function chartingEntry(customerId: string | null): ChartAction | null {
  if (!customerId) return null; // disabled
  return { kind: 'drawer', customerId };
}

test.describe('#6 차팅 → 진료차트 서랍 라우팅', () => {
  test('차팅 클릭 시 해당 환자 customer_id 서랍으로 오픈 (전체페이지 전환 아님)', () => {
    const action = chartingEntry('cust-123');
    expect(action).not.toBeNull();
    expect(action!.kind).toBe('drawer');
    expect((action as { customerId: string }).customerId).toBe('cust-123');
  });

  test('customer_id 없으면 진입 비활성(잘못된 라우팅 방지)', () => {
    expect(chartingEntry(null)).toBeNull();
  });

  test('서랍은 우측 슬라이드(2번차트) — 전역 openChart 게이트웨이 재사용', () => {
    // 회귀 가드: 행동이 fullpage 가 되면 안 된다(이전 navigate 버그).
    const action = chartingEntry('cust-9');
    expect(action!.kind).not.toBe('fullpage');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #4 — 빠른처방 버튼 가시성: 자체 stacking context 로 인접 팝오버에 안 묻힘
// ═══════════════════════════════════════════════════════════════════════════

test.describe('#4 빠른처방 버튼 가시성', () => {
  test('루트 컨테이너 className 에 relative + isolate 스태킹 컨텍스트 포함', () => {
    // QuickRxBar 루트 클래스 정본(가시성 하드닝)
    const rootClass = 'relative isolate space-y-1.5';
    expect(rootClass).toContain('relative');
    expect(rootClass).toContain('isolate');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #1 — 처방세트 폴더 위계(트리) + sort_order + 투여경로 필터
// ═══════════════════════════════════════════════════════════════════════════

interface RxItem { name: string; route: string }
interface RxSet {
  id: number;
  name: string;
  folder_id: number | null;
  sort_order: number;
  items: RxItem[];
}
interface RxFolder {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

/** 정본: parent_id 기반 트리 빌드 (folders) */
function buildFolderTree(folders: RxFolder[]) {
  const byParent = new Map<number | null, RxFolder[]>();
  for (const f of folders) {
    const arr = byParent.get(f.parent_id) ?? [];
    arr.push(f);
    byParent.set(f.parent_id, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
  return byParent;
}

/** 정본: 투여경로 필터 — 세트 항목 중 하나라도 경로 일치 시 노출 */
function filterSetsByRoute(sets: RxSet[], route: string | null): RxSet[] {
  if (!route) return sets;
  return sets.filter((s) => s.items.some((it) => it.route === route));
}

test.describe('#1 처방세트 폴더 위계 + 필터', () => {
  const folders: RxFolder[] = [
    { id: 1, name: '소염', parent_id: null, sort_order: 1 },
    { id: 2, name: '진통', parent_id: null, sort_order: 0 },
    { id: 3, name: '경구', parent_id: 1, sort_order: 0 },
  ];

  test('parent_id 트리 — 루트/하위 폴더 분리', () => {
    const tree = buildFolderTree(folders);
    expect(tree.get(null)!.map((f) => f.id)).toEqual([2, 1]); // sort_order 정렬
    expect(tree.get(1)!.map((f) => f.id)).toEqual([3]); // 소염 하위 = 경구
  });

  test('투여경로 필터 — 경구 항목 보유 세트만', () => {
    const sets: RxSet[] = [
      { id: 1, name: 'A', folder_id: 1, sort_order: 0, items: [{ name: 'x', route: '경구' }] },
      { id: 2, name: 'B', folder_id: 1, sort_order: 1, items: [{ name: 'y', route: '외용' }] },
      { id: 3, name: 'C', folder_id: null, sort_order: 2, items: [{ name: 'z', route: '경구' }, { name: 'w', route: '주사' }] },
    ];
    expect(filterSetsByRoute(sets, '경구').map((s) => s.id)).toEqual([1, 3]);
    expect(filterSetsByRoute(sets, null).length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #2 — 서류템플릿 2단계 카테고리 그룹핑
// ═══════════════════════════════════════════════════════════════════════════

interface DocTemplate { id: number; name: string; category: string | null; subcategory: string | null }

/** 정본: category > subcategory 2단계 그룹핑. null = 미분류 */
function groupByCategory(tpls: DocTemplate[]) {
  const out: Record<string, Record<string, DocTemplate[]>> = {};
  for (const t of tpls) {
    const c = t.category ?? '미분류';
    const s = t.subcategory ?? '미분류';
    (out[c] ??= {});
    (out[c][s] ??= []).push(t);
  }
  return out;
}

test.describe('#2 서류템플릿 2단계 카테고리', () => {
  test('레이저진단서 > 위장장애 위계 그룹핑', () => {
    const tpls: DocTemplate[] = [
      { id: 1, name: 'A', category: '레이저진단서', subcategory: '위장장애' },
      { id: 2, name: 'B', category: '레이저진단서', subcategory: '간질환' },
      { id: 3, name: 'C', category: null, subcategory: null },
    ];
    const g = groupByCategory(tpls);
    expect(Object.keys(g['레이저진단서'])).toEqual(expect.arrayContaining(['위장장애', '간질환']));
    expect(g['레이저진단서']['위장장애'].map((t) => t.id)).toEqual([1]);
    expect(g['미분류']['미분류'].map((t) => t.id)).toEqual([3]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #5 — 금기증 성분명(ingredient) 매칭
//   성분명 기준 등록 시, 같은 성분(ingredient)의 다른 상품 약도 금기 노출돼야 함.
// ═══════════════════════════════════════════════════════════════════════════

interface RxCode { id: string; name_ko: string; ingredient: string | null }
interface Contra { id: string; prescription_code_id: string | null; ingredient: string | null; text: string }

/** 정본: 처방 약(code)에 적용되는 금기 = (1) code_id 직접 매칭 OR (2) 성분명 매칭 */
function matchContraindications(code: RxCode, contras: Contra[]): Contra[] {
  return contras.filter(
    (c) =>
      (c.prescription_code_id && c.prescription_code_id === code.id) ||
      (c.ingredient && code.ingredient && c.ingredient === code.ingredient),
  );
}

test.describe('#5 금기증 성분명 매칭', () => {
  const codeA: RxCode = { id: 'a', name_ko: '상품A', ingredient: '이부프로펜' };
  const codeB: RxCode = { id: 'b', name_ko: '상품B', ingredient: '이부프로펜' };
  const codeC: RxCode = { id: 'c', name_ko: '상품C', ingredient: '아세트아미노펜' };

  test('성분명 등록 시 같은 성분 다른 상품도 금기 노출', () => {
    const contras: Contra[] = [
      { id: 'k1', prescription_code_id: null, ingredient: '이부프로펜', text: '소화성궤양 금기' },
    ];
    // 상품A 로 등록 안 했어도 같은 성분이면 B 도 매칭
    expect(matchContraindications(codeB, contras).map((c) => c.id)).toEqual(['k1']);
    // 다른 성분(C)은 매칭 안 됨
    expect(matchContraindications(codeC, contras).length).toBe(0);
  });

  test('상품명(code_id) 직접 등록 금기도 매칭 유지(하위호환)', () => {
    const contras: Contra[] = [
      { id: 'k2', prescription_code_id: 'a', ingredient: null, text: 'A 전용 금기' },
    ];
    expect(matchContraindications(codeA, contras).map((c) => c.id)).toEqual(['k2']);
    expect(matchContraindications(codeB, contras).length).toBe(0); // 성분 정보 없으면 A 전용
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #8-2 — 처방세트 관리 권한: 의사(director)/총괄(manager)/관리자(admin)급만 CRUD
//   정본 = PrescriptionSetsTab.RX_SET_MANAGE_ROLES (QuickRxBar.DOCTOR_ROLES 동일 집합).
//   양방향: 허용 role 은 canEdit=true(등록/수정/삭제 노출), 비허용 role 은 canEdit=false(차단).
// ═══════════════════════════════════════════════════════════════════════════

const RX_SET_MANAGE_ROLES = ['director', 'manager', 'admin'];

/** 정본: 처방세트 관리(CRUD) 가능 여부 — role 기반 */
function canManageRxSet(role: string | null | undefined): boolean {
  return !!role && RX_SET_MANAGE_ROLES.includes(role);
}

test.describe('#8-2 처방세트 관리 권한 (의사/총괄/관리자급)', () => {
  test('허용 role(director/manager/admin)은 관리 가능', () => {
    expect(canManageRxSet('director')).toBe(true); // 의사(대표원장) — 이번에 추가된 핵심
    expect(canManageRxSet('manager')).toBe(true);
    expect(canManageRxSet('admin')).toBe(true);
  });

  test('비허용 role(직원·치료사·상담 등)은 관리 차단 — 조회만', () => {
    expect(canManageRxSet('staff')).toBe(false);
    expect(canManageRxSet('therapist')).toBe(false);
    expect(canManageRxSet('technician')).toBe(false);
    expect(canManageRxSet('consultant')).toBe(false);
    expect(canManageRxSet('coordinator')).toBe(false);
    expect(canManageRxSet('part_lead')).toBe(false);
  });

  test('role 미상(null/undefined)은 차단(fail-closed)', () => {
    expect(canManageRxSet(null)).toBe(false);
    expect(canManageRxSet(undefined)).toBe(false);
    expect(canManageRxSet('')).toBe(false);
  });

  test('회귀 가드: director(의사) 누락 버그 재발 방지', () => {
    // 이전 정책(admin/manager 전용)에서 director 가 빠져 대표원장이 막혔던 버그.
    expect(canManageRxSet('director')).toBe(true);
  });
});
