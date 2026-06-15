/**
 * E2E spec — T-20260610-foot-DOCDASH-DIAGMGMT-6FIX
 * 진료대시보드 + 진료환자목록 + 상병명관리 presentation 6정정 (reporter 문지은 대표원장).
 *
 * 본 spec 은 foot presentation 컨벤션(DOCDASH-STATUS-SPLIT 등)을 따라
 * **정본 소스 배선(class·testid·정렬 로직)** 을 직접 검증한다.
 * 처방확정/방배정/상병등록 같은 특정 DB 상태를 요구하는 풀-브라우저 상호작용 대신,
 * 6FIX 가 도입한 정확한 presentation 앵커가 정본에 박혀 있는지를 회귀로 잡는다(데이터 픽스처 불요·안정).
 *
 * AC-1: 처방 진입점(QuickRxBar) — '버튼 사라지고 이름만 우측정렬'(QUICKRX-DROPDOWN-LIST-REDESIGN 3299ff5)
 *       → 명시적 처방 버튼 affordance 복원(teal 전폭 버튼). 확정후 RxConfirmedSummary 도 sky 버튼. 동선/로직 불변.
 * AC-2: 처방전 O 배지 = 하늘색(sky), X = 회색. green/emerald/teal/mint/cyan/blue 금지(reporter 거부 톤).
 * AC-3: 진료환자목록 행에 치료실(방이름) 표시 — 기존 *_room 컬럼 read(getAssignedSlotName SSOT 파생).
 * AC-4: 상병명관리 전체목록 정렬 — 가나다순/추가순 × 오름/내림.
 * AC-5: 미폴더(미분류) 항목 미니멀 표시(강조 없음).
 * AC-6: 폴더 괄호 건수 우측 끝 정렬.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');

const QUICKRX = () => SRC('components/doctor/QuickRxBar.tsx');
const PLIST = () => SRC('components/doctor/DoctorPatientList.tsx');
const DXTAB = () => SRC('components/admin/DiagnosisNamesTab.tsx');

/** 전체-라인 주석(//...)을 제거 — 주석에 박힌 금지 톤 단어·라벨 멘션이 검사를 오염시키지 않게. */
const stripComments = (s: string): string =>
  s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

/** PrescriptionStatusBadge 의 'confirmed'(처방전 O) JSX 블록만 추출(주석 제거 후) — 금지 톤 검사 범위 한정. */
function confirmedBadgeBlock(src: string): string {
  const code = stripComments(src);
  const start = code.indexOf("if (status === 'confirmed')");
  expect(start, "PrescriptionStatusBadge confirmed 분기 존재").toBeGreaterThan(-1);
  const rest = code.slice(start);
  const end = rest.indexOf('처방전 O');
  expect(end, "'처방전 O' 라벨이 confirmed 블록 안에 존재").toBeGreaterThan(-1);
  return rest.slice(0, end + 200);
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — 처방 진입점(QuickRxBar) 버튼 affordance 복원
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-1 처방 버튼 affordance 복원', () => {
  test('빠른처방 항목(listItemBase)이 명시 버튼 스타일(teal 테두리+배경+shadow)로 복원', () => {
    const src = QUICKRX();
    // 처방 버튼 affordance: teal 테두리 + bg-teal-50 + text-teal-700 + shadow
    expect(src).toMatch(/listItemBase[\s\S]{0,400}border border-teal-300/);
    expect(src).toMatch(/listItemBase[\s\S]{0,400}bg-teal-50/);
    expect(src).toMatch(/listItemBase[\s\S]{0,400}text-teal-700/);
    expect(src).toMatch(/listItemBase[\s\S]{0,400}shadow-sm/);
  });

  test('REDESIGN(3299ff5)의 무테두리·blue-text 목록형 스타일이 listItemBase 에서 제거됨', () => {
    const src = QUICKRX();
    // listItemBase 정의 구간에 더 이상 'border-0 ... text-blue-600' (드롭다운 목록형) 잔재가 없어야 함
    const m = src.match(/const listItemBase =[\s\S]{0,500}?;\n/);
    expect(m, 'listItemBase 정의 구간 추출').not.toBeNull();
    const block = m![0];
    expect(block).not.toContain('border-0');
    expect(block).not.toContain('text-blue-600');
  });

  test("처방 버튼 목록 컨테이너가 전폭(우측정렬 max-w 폐지)", () => {
    const src = QUICKRX();
    // data-testid="quick-rx-bar" 컨테이너가 ml-auto/max-w-[15rem](우측정렬 드롭다운)이 아니라 w-full flex-col
    const idx = src.indexOf('data-testid="quick-rx-bar"');
    expect(idx).toBeGreaterThan(-1);
    const around = src.slice(Math.max(0, idx - 200), idx);
    expect(around).toContain('flex w-full flex-col');
    expect(around).not.toContain('max-w-[15rem]');
  });

  test('확정 상태(RxConfirmedSummary) 버튼도 sky 톤(처방완료 라벨·재클릭 취소 동선 유지)', () => {
    const src = QUICKRX();
    expect(src).toContain('data-testid="rx-confirmed-summary"');
    expect(src).toMatch(/border-sky-300 bg-sky-50 text-sky-700/); // cancellable 기본 sky
    expect(src).toContain("label = '처방완료'");
    expect(src).toContain('handleDoneClick'); // 재클릭 취소 동선 유지(로직 불변)
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 — 처방전 O = 하늘색(sky) / X = 회색, 금지 톤 배제
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-2 처방전 O=sky / X=gray', () => {
  test('처방전 O 배지가 sky-100/700 + sky-200 테두리', () => {
    const block = confirmedBadgeBlock(PLIST());
    expect(block).toContain('bg-sky-100');
    expect(block).toContain('text-sky-700');
    expect(block).toContain('border-sky-200');
    expect(block).toContain('처방전 O');
  });

  test('처방전 O 배지에 reporter 거부 톤(green/emerald/teal/mint/cyan/blue) 미사용', () => {
    const block = confirmedBadgeBlock(PLIST());
    for (const tone of ['green', 'emerald', 'teal', 'mint', 'cyan', 'bg-blue', 'text-blue']) {
      expect(block, `confirmed(O) 배지에 '${tone}' 톤 금지`).not.toContain(tone);
    }
  });

  test('처방전 X 배지는 회색(gray) 유지', () => {
    const src = stripComments(PLIST());
    const idx = src.indexOf('처방전 X');
    expect(idx).toBeGreaterThan(-1);
    const around = src.slice(Math.max(0, idx - 200), idx);
    expect(around).toContain('bg-gray-100');
    expect(around).toMatch(/text-gray-(400|500)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — 진료환자목록 행에 치료실(방이름) 표시
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-3 치료실명 표시', () => {
  test('getAssignedSlotName SSOT 파생 + patient-room testid', () => {
    const src = PLIST();
    expect(src).toContain("import { getAssignedSlotName } from '@/lib/checkin-slot'");
    expect(src).toContain('getAssignedSlotName(');
    expect(src).toContain('data-testid="patient-room"');
  });

  test('*_room 컬럼이 SELECT 확장(스키마 무변경 — 기존 컬럼 read만)', () => {
    const src = PLIST();
    expect(src).toContain('consultation_room');
    expect(src).toContain('treatment_room');
    expect(src).toContain('laser_room');
    expect(src).toContain('examination_room');
  });

  test('행 grid-template 에 치료실 열(4.75rem) 추가', () => {
    const src = PLIST();
    expect(src).toContain('4.75rem');
    // 치료실(방) 컬럼 포함된 8트랙 grid.
    //   T-20260613 MIRROR-MONOTONE(대기순번 1.75rem 제거) + CHARTNO-COL-SPLIT(차트번호 4.5rem 독립) +
    //   T-20260615 DASHCOL-REALIGN(문지은 대표원장 confirm) 정합:
    //   방(4.75rem)→상태(3.75rem)→방문유형(3rem)→이름(5rem)→차트번호(4.5rem)→처방(5.5rem)→예약메모(1fr)→액션.
    expect(src).toMatch(/grid-cols-\[4\.75rem_3\.75rem_3rem_5rem_4\.5rem_5\.5rem_minmax\(0,1fr\)_auto\]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 — 상병명관리 전체목록 정렬(가나다/추가순 × 오름/내림)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-4 상병명관리 정렬 컨트롤', () => {
  test('정렬 컨트롤 + 기준/방향 토글 testid 노출', () => {
    const src = DXTAB();
    expect(src).toContain('data-testid="dx-sort-controls"');
    expect(src).toContain('data-testid="dx-sort-by"');
    expect(src).toContain('data-testid="dx-sort-dir"');
  });

  test('정렬 상태(dxSortBy/dxSortDir) + 기본=추가순 오름차순(종전 동작 보존)', () => {
    const src = DXTAB();
    expect(src).toMatch(/const \[dxSortBy, setDxSortBy\] = useState<'name' \| 'added'>\('added'\)/);
    expect(src).toMatch(/const \[dxSortDir, setDxSortDir\] = useState<'asc' \| 'desc'>\('asc'\)/);
  });

  test('정렬 로직 — 가나다(localeCompare ko) / 추가순(sort_order 프록시) × asc·desc', () => {
    const src = DXTAB();
    // visibleItems 가 정렬 상태에 의존 + 원본 불변(복사본 정렬)
    expect(src).toMatch(/\[\.\.\.base\]\.sort\(/);
    expect(src).toContain("a.name.localeCompare(b.name, 'ko')"); // 가나다
    expect(src).toMatch(/a\.sort_order \?\? 0\) - \(b\.sort_order \?\? 0\)/); // 추가순 프록시
    expect(src).toMatch(/dxSortDir === 'asc' \? 1 : -1/); // 오름/내림
    expect(src).toMatch(/\[items, selectedKey, dxSortBy, dxSortDir\]/); // deps
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-5 — 미폴더(미분류) 항목 미니멀 표시
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-5 미폴더 미니멀 표시', () => {
  test('미분류 힌트는 강조 없이 아주 약하게(text-muted-foreground/40)', () => {
    const src = DXTAB();
    expect(src).toContain('data-testid="dx-unfoldered-hint"');
    expect(src).toContain('미분류');
    // 미분류 힌트 주변이 약한 톤(muted/40) — 강조(bold/색강조) 아님
    const idx = src.indexOf('data-testid="dx-unfoldered-hint"');
    const around = src.slice(Math.max(0, idx - 160), idx);
    expect(around).toContain('text-muted-foreground/40');
    // 미폴더일 때만 렌더(조건부)
    expect(src).toContain('!d.diagnosis_folder_id &&');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-6 — 폴더 괄호 건수 우측 끝 정렬
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-6 폴더 건수 우측정렬', () => {
  test('FolderNode 의 dx-folder-count 가 ml-auto + text-right(+tabular-nums) 로 맨 우측 정렬', () => {
    // dx-folder-count 는 2곳(ALL 헤더 + FolderNode). 6FIX AC-6 은 FolderNode 의 건수를
    // 관리버튼 뒤(맨 우측)로 이동(ml-auto·text-right) — 해당 span 이 정본에 존재함을 직접 매칭.
    const src = stripComments(DXTAB());
    expect(src).toMatch(/ml-auto[^"]*tabular-nums[^"]*text-right"\s+data-testid="dx-folder-count"/);
  });
});
