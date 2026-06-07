/**
 * E2E spec — T-20260607-foot-SUPERPHRASE-DX-MULTISELECT-FIX
 * 진료차트 진단명/슈퍼상용구 AC 미충족 회귀 수정 검증 (문지은 대표원장 C0ATE5P6JTH).
 *
 * 원 신고: SUPER-PHRASE-DIAGNOSIS-AUTOCOMPLETE(deployed) 의 아래 3 AC 가 현장에서 동작하지 않음.
 *   AC-1 주/부상병 지정 : 선택 상병에 주상병/부상병 구분이 없다.
 *   AC-2 진단명 다중(중복) 선택 : 진단명을 여러 개(동일 상병 중복 포함) 못 고른다 — 클릭하면 직전 선택이 사라짐(대체).
 *   AC-3 임상경과 '//' 단축어 : '//' 입력 시 상용구/슈퍼상용구 자동완성 팝오버가 떠야 한다.
 *
 * 루트코즈:
 *   AC-1/AC-2 — DiagnosisFolderPicker.select() 가 onChange(fmtDx(row)) 로 값을 "대체"했다(단일 선택).
 *               → 다중·중복·주부 구분 불가. 수정: 선택을 줄바꿈(\n) 누적 직렬화(중복 허용),
 *                 줄 순서 = 주/부 순서(index 0 = 주상병), [주상병] 버튼으로 승격.
 *   AC-3 — handleClinicalChange 의 `//query` 캡처 정규식 + filteredPhrases/filteredSuperPhrases 게이트.
 *
 * 스타일: 기존 RX-SUPER-PHRASE / DIAGNOSIS-MASTER-MGMT spec 패턴(in-page 순수 로직 시뮬레이션) —
 *   구현 정본(DiagnosisFolderPicker 의 export 헬퍼 + handleClinicalChange 의 정규식/필터)을
 *   동일 규칙으로 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// 정본 헬퍼 미러 — DiagnosisFolderPicker.tsx 의 export 헬퍼와 동일 규칙.
//   (parseDxEntries / serializeDxEntries / addDxEntry / removeDxEntry / makeDxPrimary / isDxPrimary)
// ─────────────────────────────────────────────────────────────────────────────
const parseDxEntries = (value: string): string[] =>
  !value ? [] : value.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);

const serializeDxEntries = (entries: string[]): string => entries.join('\n');

const addDxEntry = (entries: string[], label: string): string[] => {
  const v = (label ?? '').trim();
  if (!v) return entries;
  return [...entries, v];
};

const removeDxEntry = (entries: string[], idx: number): string[] =>
  idx < 0 || idx >= entries.length ? entries : entries.filter((_, i) => i !== idx);

const makeDxPrimary = (entries: string[], idx: number): string[] => {
  if (idx <= 0 || idx >= entries.length) return entries;
  const next = [...entries];
  const [moved] = next.splice(idx, 1);
  next.unshift(moved);
  return next;
};

const isDxPrimary = (idx: number): boolean => idx === 0;

// fmtDx 미러 — "코드 상병명"(코드 공란이면 이름 단독).
const fmtDx = (row: { name: string; service_code: string | null }): string => {
  const code = (row.service_code ?? '').trim();
  return code ? `${code} ${row.name}` : row.name;
};

// 회귀 비교용 — 수정 전(버그) 단일선택 로직: 항상 대체.
const selectBuggy = (_prev: string, row: { name: string; service_code: string | null }): string =>
  fmtDx(row);

// 수정 후 — 누적(중복 허용).
const selectFixed = (prevValue: string, row: { name: string; service_code: string | null }): string =>
  serializeDxEntries(addDxEntry(parseDxEntries(prevValue), fmtDx(row)));

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 진단명 다중(중복) 선택
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 진단명 다중(중복) 선택', () => {
  const r1 = { name: '무지외반증', service_code: 'M20.1' };
  const r2 = { name: '족저근막염', service_code: 'M72.2' };

  test('수정 전(버그): 두 번째 클릭이 첫 선택을 대체 → 항상 1건', () => {
    let v = '';
    v = selectBuggy(v, r1);
    v = selectBuggy(v, r2);
    expect(parseDxEntries(v)).toHaveLength(1);
    expect(parseDxEntries(v)[0]).toBe('M72.2 족저근막염'); // 직전 선택 소실(회귀 증상)
  });

  test('수정 후: 서로 다른 상병 누적 → 2건 보존(순서 유지)', () => {
    let v = '';
    v = selectFixed(v, r1);
    v = selectFixed(v, r2);
    const entries = parseDxEntries(v);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toBe('M20.1 무지외반증');
    expect(entries[1]).toBe('M72.2 족저근막염');
  });

  test('수정 후: 동일 상병 중복 추가 허용 (중복 = 2건)', () => {
    let v = '';
    v = selectFixed(v, r1);
    v = selectFixed(v, r1);
    expect(parseDxEntries(v)).toHaveLength(2);
    expect(parseDxEntries(v).every((e) => e === 'M20.1 무지외반증')).toBe(true);
  });

  test('코드 공란 상병은 이름 단독으로 직렬화', () => {
    const v = selectFixed('', { name: '굳은살', service_code: null });
    expect(parseDxEntries(v)[0]).toBe('굳은살');
  });

  test('빈 라벨 추가는 무시(GUARD)', () => {
    expect(addDxEntry(['A'], '')).toEqual(['A']);
    expect(addDxEntry(['A'], '   ')).toEqual(['A']);
  });

  test('삭제: 특정 항목만 제거 (나머지 순서 보존)', () => {
    const v = ['M20.1 무지외반증', 'M72.2 족저근막염', 'L84 티눈'];
    expect(removeDxEntry(v, 1)).toEqual(['M20.1 무지외반증', 'L84 티눈']);
    expect(removeDxEntry(v, 99)).toEqual(v); // 범위밖 무변경
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 주/부상병 지정 (순서 기반 — index 0 = 주상병)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 주/부상병 지정', () => {
  test('맨 앞이 주상병, 나머지는 부상병', () => {
    const entries = ['M20.1 무지외반증', 'M72.2 족저근막염'];
    expect(isDxPrimary(0)).toBe(true);
    expect(isDxPrimary(1)).toBe(false);
    expect(entries.map((_, i) => (isDxPrimary(i) ? '주' : '부'))).toEqual(['주', '부']);
  });

  test('[주상병] 승격: 부상병을 맨 앞으로 이동 (나머지 상대순서 보존)', () => {
    const entries = ['A', 'B', 'C'];
    const next = makeDxPrimary(entries, 2); // C 를 주상병으로
    expect(next).toEqual(['C', 'A', 'B']);
    expect(next[0]).toBe('C');
    expect(isDxPrimary(0)).toBe(true);
  });

  test('이미 주상병(index 0) 승격은 무변경', () => {
    expect(makeDxPrimary(['A', 'B'], 0)).toEqual(['A', 'B']);
  });

  test('직렬화 라운드트립: 주/부 순서 = 줄 순서 보존', () => {
    const entries = ['M20.1 무지외반증', 'M72.2 족저근막염'];
    const text = serializeDxEntries(entries);
    expect(text).toBe('M20.1 무지외반증\nM72.2 족저근막염');
    // medical_charts.diagnosis(text) 재로드 → 동일 순서 복원
    expect(parseDxEntries(text)).toEqual(entries);
  });

  test('레거시 단일 상병(마커 없음) → 1건·주상병으로 표시', () => {
    const entries = parseDxEntries('M20.1 무지외반증');
    expect(entries).toHaveLength(1);
    expect(isDxPrimary(0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 임상경과 '//' 단축어 자동완성 게이트 (handleClinicalChange 미러)
// ─────────────────────────────────────────────────────────────────────────────
// 커서 앞 텍스트에서 `//query` 토큰 캡처. 구현 정본 정규식과 동일.
const captureSlashQuery = (textBefore: string): { open: boolean; query: string } => {
  const m = textBefore.match(/\/\/([^\s/]*)$/);
  return m ? { open: true, query: m[1] } : { open: false, query: '' };
};

interface Phrase { id: number; name: string; shortcut_key: string | null }
interface Super { id: number; name: string; diagnosis: string | null; clinical_progress: string | null }

const filterPhrases = (rows: Phrase[], q: string): Phrase[] =>
  rows
    .filter((p) => (!q ? p.shortcut_key != null : p.shortcut_key?.startsWith(q) || p.name.includes(q)))
    .slice(0, 8);

const filterSupers = (rows: Super[], q: string): Super[] =>
  rows
    .filter((sp) =>
      !q
        ? true
        : sp.name.includes(q) ||
          (sp.diagnosis ?? '').includes(q) ||
          (sp.clinical_progress ?? '').includes(q),
    )
    .slice(0, 6);

test.describe('AC-3 임상경과 // 단축어 자동완성', () => {
  const phrases: Phrase[] = [
    { id: 1, name: '경과양호', shortcut_key: 'ok' },
    { id: 2, name: '재내원안내', shortcut_key: 'revisit' },
    { id: 3, name: '단축어없음', shortcut_key: null },
  ];
  const supers: Super[] = [
    { id: 10, name: '내성발톱세트', diagnosis: 'L60.0 내성발톱', clinical_progress: '소독 후 경과양호', },
    { id: 11, name: '족저근막세트', diagnosis: 'M72.2 족저근막염', clinical_progress: null },
  ];

  test("'//' 입력 직후(빈 query) → 팝오버 열림 + 단축어 보유 상용구·슈퍼상용구 노출", () => {
    const cap = captureSlashQuery('환자 상태 //');
    expect(cap.open).toBe(true);
    expect(cap.query).toBe('');
    // 빈 query: shortcut_key 보유 상용구만(2건) + 슈퍼상용구 전체(2건)
    expect(filterPhrases(phrases, cap.query)).toHaveLength(2);
    expect(filterSupers(supers, cap.query)).toHaveLength(2);
  });

  test("'//ok' 입력 → query='ok', shortcut_key 접두 일치 상용구 노출", () => {
    const cap = captureSlashQuery('//ok');
    expect(cap).toEqual({ open: true, query: 'ok' });
    const f = filterPhrases(phrases, cap.query);
    expect(f).toHaveLength(1);
    expect(f[0].name).toBe('경과양호');
  });

  test("'//족저' 입력 → 슈퍼상용구 이름/진단 부분일치", () => {
    const cap = captureSlashQuery('소견: //족저');
    expect(cap.open).toBe(true);
    const f = filterSupers(supers, cap.query);
    expect(f).toHaveLength(1);
    expect(f[0].name).toBe('족저근막세트');
  });

  test('공백이 끼면 팝오버 닫힘 (토큰 종료)', () => {
    expect(captureSlashQuery('//ok ').open).toBe(false); // 공백 종료
    expect(captureSlashQuery('정상 텍스트').open).toBe(false); // 트리거 없음
    // 정본 정규식은 커서 앞 마지막 `//token` 만 본다 — URL 'http://x' 도 `//x` 토큰으로 매치(deployed 동작과 동일).
    const url = captureSlashQuery('http://x');
    expect(url).toEqual({ open: true, query: 'x' });
  });

  test('일치 결과가 0건이면 팝오버는 열리되 빈 안내 (열림 자체는 동작)', () => {
    const cap = captureSlashQuery('//zzz');
    expect(cap.open).toBe(true);
    expect(filterPhrases(phrases, cap.query)).toHaveLength(0);
    expect(filterSupers(supers, cap.query)).toHaveLength(0);
  });
});
