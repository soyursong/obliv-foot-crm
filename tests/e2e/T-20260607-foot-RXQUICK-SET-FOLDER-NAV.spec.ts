/**
 * T-20260607-foot-RXQUICK-SET-FOLDER-NAV
 * 빠른처방 admin '연결할 처방세트' 선택: flat <Select> → 진료차트와 동일한 folder→set 2단 트리 picker(+검색)
 *
 * 배경: 처방세트가 많아지면 평면 <Select> 스크롤 탐색이 곤란. 진료차트 우측 처방세트 탭
 *   (RX-SET-EXPLORER-TREE)의 folder→set 트리를 공용 <PrescriptionSetTreePicker>로 추출해 재사용.
 *
 * AC-1: 폴더 펼침/접기 (트리 picker)
 * AC-2: 세트명 부분일치 검색 (검색 입력)
 * AC-3: 기존 연결 데이터 회귀 없음 — 미분류 그룹 + 검색 0건 엣지 포함
 *
 * 회귀 가드(추출 원본): 진료차트 처방세트 탭(testid rx-set-*)은 RX-SET-EXPLORER-TREE.spec 가 그대로 커버.
 *   본 spec 은 (1) 공용 트리 그룹핑·검색 순수 로직 (2) 양쪽 surface 의 정적 추출 가드 를 검증.
 *
 * 그룹핑·필터 로직은 PrescriptionSetTreePicker 의 useMemo 구현을 순수 함수로 재현(RXQUICK-SORT-DND 패턴).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PICKER_SRC = resolve(__dirname, '../../src/components/prescription/PrescriptionSetTreePicker.tsx');
const QUICK_SRC = resolve(__dirname, '../../src/components/admin/QuickRxButtonsTab.tsx');
const CHART_SRC = resolve(__dirname, '../../src/components/MedicalChartPanel.tsx');

const NO_FOLDER = '미분류';
type Set = { id: number; name: string; folder?: string | null };

// ── PrescriptionSetTreePicker groups useMemo 재현: 검색 필터 → 폴더 그룹핑 → 폴더 정렬 ──
function groupSets(sets: Set[], query: string) {
  const trimmed = query.trim().toLowerCase();
  const visible = trimmed
    ? sets.filter((s) => s.name.toLowerCase().includes(trimmed))
    : sets;
  const map = new Map<string, Set[]>();
  for (const s of visible) {
    const key = s.folder?.trim() ? s.folder.trim() : NO_FOLDER;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === NO_FOLDER) return 1;
    if (b === NO_FOLDER) return -1;
    return a.localeCompare(b, 'ko');
  });
  return keys.map((folderName) => ({ folderName, items: map.get(folderName)! }));
}

const sets: Set[] = [
  { id: 1, name: '진통소염 세트', folder: '발톱' },
  { id: 2, name: '항진균 세트', folder: '진균' },
  { id: 3, name: '발톱 무좀 세트', folder: '발톱' },
  { id: 4, name: '기본 세트', folder: null },        // 미분류
  { id: 5, name: '보습 세트', folder: '' },           // 빈 문자열 → 미분류
];

// ── 그룹핑 규칙 (AC-1 트리 위계) ────────────────────────────────────────────
test.describe('folder→set 그룹핑 — AC-1', () => {
  test('폴더 가나다순 + 미분류 맨 끝', () => {
    const g = groupSets(sets, '');
    expect(g.map((x) => x.folderName)).toEqual(['발톱', '진균', '미분류']);
  });

  test('같은 폴더의 세트는 입력 순서(sort_order) 유지', () => {
    const g = groupSets(sets, '');
    const baltop = g.find((x) => x.folderName === '발톱')!;
    expect(baltop.items.map((s) => s.id)).toEqual([1, 3]);
  });

  test('folder=null/빈문자열 모두 미분류로 묶임', () => {
    const g = groupSets(sets, '');
    const none = g.find((x) => x.folderName === NO_FOLDER)!;
    expect(none.items.map((s) => s.id).sort()).toEqual([4, 5]);
  });
});

// ── 검색 부분일치 (AC-2) ────────────────────────────────────────────────────
test.describe('세트명 부분일치 검색 — AC-2', () => {
  test('"세트" 부분일치 → 전체 매칭', () => {
    const g = groupSets(sets, '세트');
    const total = g.reduce((n, x) => n + x.items.length, 0);
    expect(total).toBe(5);
  });

  test('"발톱" 부분일치 → 폴더 가로질러 매칭(발톱 무좀 세트)', () => {
    const g = groupSets(sets, '발톱');
    const ids = g.flatMap((x) => x.items.map((s) => s.id)).sort();
    expect(ids).toEqual([3]);
  });

  test('대소문자 무시 부분일치', () => {
    const g = groupSets([{ id: 9, name: 'Antibiotic SET', folder: 'A' }], 'set');
    expect(g.flatMap((x) => x.items.map((s) => s.id))).toEqual([9]);
  });
});

// ── 0건/엣지 회귀 (AC-3 시나리오2) ──────────────────────────────────────────
test.describe('검색 0건 + 미분류 엣지 — AC-3', () => {
  test('매칭 0건이면 그룹 0개(검색결과 없음 분기)', () => {
    const g = groupSets(sets, '존재하지않는처방');
    expect(g.length).toBe(0);
  });

  test('빈 쿼리는 전체 노출(필터 미적용)', () => {
    const g = groupSets(sets, '   ');
    const total = g.reduce((n, x) => n + x.items.length, 0);
    expect(total).toBe(sets.length);
  });

  test('미분류만 있어도 정상 그룹핑', () => {
    const g = groupSets([{ id: 7, name: '단독', folder: null }], '');
    expect(g.map((x) => x.folderName)).toEqual([NO_FOLDER]);
  });
});

// ── 정적 추출 가드: 공용 컴포넌트 + 양쪽 surface ────────────────────────────
test.describe('공용 트리 picker 추출 가드 — 회귀', () => {
  const picker = readFileSync(PICKER_SRC, 'utf8');
  const quick = readFileSync(QUICK_SRC, 'utf8');
  const chart = readFileSync(CHART_SRC, 'utf8');

  test('공용 컴포넌트가 testIdPrefix 로 surface 별 testid 발급', () => {
    expect(picker).toContain('testIdPrefix');
    expect(picker).toContain('${testIdPrefix}-folder-node');
    expect(picker).toContain('${testIdPrefix}-option');
    expect(picker).toContain('${testIdPrefix}-search');
  });

  test('진료차트(rx-set surface)는 공용 picker 사용 + controlled collapse(폴더 기본 접힘 보존)', () => {
    expect(chart).toContain('PrescriptionSetTreePicker');
    expect(chart).toContain('collapsedFolders={collapsedRxFolders}');
    // rx-set 기본 prefix → 기존 testid(rx-set-option 등) 회귀 호환. inline IIFE 트리 제거됨.
    expect(chart).not.toMatch(/const NO_FOLDER = '미분류';[\s\S]{0,400}rx-set-folder-node/);
  });

  test('빠른처방 admin: flat <Select> 처방세트 선택 제거 + 트리 picker(검색) 도입', () => {
    // 기존 flat Select testid 제거
    expect(quick).not.toContain('quick-rx-set-select');
    // 트리 picker + 검색 도입
    expect(quick).toContain('PrescriptionSetTreePicker');
    expect(quick).toContain('searchable');
    expect(quick).toContain('testIdPrefix="quick-rx-set"');
    // 선택값 하이라이트(AC-3 기존 연결 데이터)
    expect(quick).toContain('selectedId={form.prescription_set_id}');
  });

  test('빠른처방 query 가 folder 컬럼을 조회(그룹핑 데이터 확보)', () => {
    expect(quick).toContain("select('id, name, is_active, folder')");
  });
});
