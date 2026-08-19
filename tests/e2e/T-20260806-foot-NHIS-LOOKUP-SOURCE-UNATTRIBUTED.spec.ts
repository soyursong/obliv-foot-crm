/**
 * T-20260806-foot-NHIS-LOOKUP-SOURCE-UNATTRIBUTED (+ -REWORK) — 건보조회 딥링크 개시 시 source 초안 'hira_lookup' 프리셋
 *
 * Phase 1(T-20260724) 마지막 고리(N4) 미완: [건보조회] 딥링크를 112번 열었는데 등급 확정 시
 * insurance_grade_source 는 대부분 manual_input 으로만 남았다. RC = InsuranceGradeSelect 가
 * 딥링크 조회 개시 상태(useNhisLookup.captureOpen)를 몰라 항상 'manual_input' 으로 폴백.
 *
 * ── REWORK (T-20260806-...-REWORK, 정본: file_inbox/20260807/071131_direct_*.md) ──────
 * 선행 배포(0b9d240e)는 배선은 맞았으나 초기화 useEffect deps 에 lookupInProgress(=captureOpen,
 * **양방향 토글**)를 넣고 editing 가드가 없어 수정 목적이 무산됐다.
 *   결함 A: 편집 중 [건보조회] → effect 재발화 → draftGrade·draftSource·draftMemo 리셋(입력 소실).
 *   결함 B: hira_lookup 잡힌 뒤 패널 [닫기] → captureOpen false → draftSource 가 manual_input 으로
 *           되돌아감 → 저장 시 manual_input(수정 목적 무산).
 * FIX:
 *   1. 초기화 effect(:88~92) deps 에서 lookupInProgress 제거 + draftSource 초기값 'manual_input' 고정.
 *   2. rising-edge 전용 effect 신설(prevLookupRef, false→true 순간에만 setDraftSource('hira_lookup')).
 *      등급·메모 무접촉 — 편집 중 조회해도 입력 보존.
 *
 * 강제 아님(프리셋): 라디오 4종·기존 source 값·수기 manual_input 우선. 파서 재도입 금지.
 * calc/RPC/감사 무접촉.
 *   (갤탭 실기기 클릭 QA = supervisor 종료게이트·이은상 팀장 field_soak 소관.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __root = dirname(fileURLToPath(import.meta.url));
function readSrc(rel: string): string {
  return readFileSync(resolve(__root, '../../src', rel), 'utf-8');
}
function srcPath(rel: string): string {
  return resolve(__root, '../../src', rel);
}
const gradeSelectSrc = readSrc('components/insurance/InsuranceGradeSelect.tsx');
const chartSrc = readSrc('pages/CustomerChartPage.tsx');
const hookSrc = readSrc('hooks/useNhisLookup.ts');

// ──────────────────────────────────────────────────────────────────────
// FIX-A: InsuranceGradeSelect — lookupInProgress prop 수신
// ──────────────────────────────────────────────────────────────────────
test.describe('FIX-A: lookupInProgress prop wiring', () => {
  test('Props 에 optional lookupInProgress?: boolean 선언', () => {
    expect(gradeSelectSrc).toMatch(/lookupInProgress\?:\s*boolean/);
    // 함수 파라미터 구조분해에 lookupInProgress 수신(default false 안전)
    expect(gradeSelectSrc).toMatch(/lookupInProgress\s*=\s*false/);
  });

  test('출처 enum = hira_lookup — 미존재 값 nhis_lookup 사용 안 함', () => {
    // 정본 enum: manual_input | hira_lookup (nhis_lookup 은 미존재 값)
    expect(gradeSelectSrc).toContain("'hira_lookup'");
    expect(gradeSelectSrc).not.toContain('nhis_lookup');
    expect(chartSrc).not.toContain('nhis_lookup');
  });
});

// ──────────────────────────────────────────────────────────────────────
// FIX-B: CustomerChartPage — 호출부에서 captureOpen 전달
// ──────────────────────────────────────────────────────────────────────
test.describe('FIX-B: 딥링크 조회 개시 상태 전달', () => {
  test('InsuranceGradeSelect 호출부에 lookupInProgress={nhis.captureOpen}', () => {
    expect(chartSrc).toMatch(/lookupInProgress=\{nhis\.captureOpen\}/);
  });

  test('captureOpen 은 useNhisLookup 이 노출하는 boolean 상태', () => {
    expect(hookSrc).toMatch(/captureOpen:\s*boolean/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// REWORK 구조 가드: 초기화 effect deps 에서 양방향 토글 제거 + rising-edge effect 분리
//   (AC-1 / AC-2 — 결함 A·B 재발 정적 방지)
// ──────────────────────────────────────────────────────────────────────
test.describe('REWORK 구조: deps 정리 + rising-edge 분리', () => {
  // 초기화 sync effect 블록만 슬라이스 (deps 배열 검사용)
  function syncEffectBlock(): string {
    // "setDraftGrade" 로 시작해 그 useEffect 의 deps 배열까지 포함하는 블록
    const m = gradeSelectSrc.match(
      /setDraftGrade\(\(grade[\s\S]*?setDraftMemo\(memo[\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\)/,
    );
    return m ? m[0] : '';
  }

  test('AC-1: 초기화 effect deps 에 lookupInProgress 없음 = [grade, source, memo]', () => {
    const block = syncEffectBlock();
    expect(block).not.toBe('');
    // deps 배열이 정확히 grade, source, memo (lookupInProgress 미포함)
    expect(block).toMatch(/\}\s*,\s*\[grade,\s*source,\s*memo\]\s*\)/);
    expect(block).not.toContain('lookupInProgress');
  });

  test('AC-1: 초기화 effect 의 draftSource 는 프리셋 삼항 없이 manual_input 고정', () => {
    const block = syncEffectBlock();
    // 초기화 effect 안의 draftSource 세팅은 `source ?? 'manual_input'` (삼항 프리셋 제거)
    expect(block).toMatch(/setDraftSource\(\(source\s*\?\?\s*'manual_input'\)/);
    expect(block).not.toMatch(/setDraftSource[\s\S]*lookupInProgress\s*\?/);
  });

  test('AC-2: rising-edge 전용 effect 신설 — prevLookupRef + false→true 가드', () => {
    // useRef 로 이전 상태 추적
    expect(gradeSelectSrc).toMatch(/const\s+prevLookupRef\s*=\s*useRef\(false\)/);
    // false→true(rising edge) 순간에만 hira_lookup 프리셋 (STICKY-LATCH: 사이에 래치 세팅 허용)
    expect(gradeSelectSrc).toMatch(
      /if\s*\(\s*lookupInProgress\s*&&\s*!prevLookupRef\.current\s*\)\s*\{[\s\S]*?setDraftSource\('hira_lookup'\)/,
    );
    // 이전 상태 갱신 + deps 는 lookupInProgress 단독
    expect(gradeSelectSrc).toMatch(/prevLookupRef\.current\s*=\s*lookupInProgress/);
    expect(gradeSelectSrc).toMatch(/prevLookupRef\.current\s*=\s*lookupInProgress;\s*\n?\s*\}\s*,\s*\[lookupInProgress\]\s*\)/);
    // rising-edge effect 는 등급·메모 무접촉(setDraftGrade/setDraftMemo 없음)
    const risingBlock =
      gradeSelectSrc.match(/if\s*\(\s*lookupInProgress\s*&&\s*!prevLookupRef\.current[\s\S]*?\[lookupInProgress\]\s*\)/)?.[0] ?? '';
    expect(risingBlock).not.toContain('setDraftGrade');
    expect(risingBlock).not.toContain('setDraftMemo');
  });

  // T-20260819-...-STICKY-LATCH: startEdit 이 세션 조회 래치를 소비하도록 재작업.
  //   구 REWORK 는 startEdit 에 `source ?? (lookupInProgress ? ...)` 를 남겨, 조회 후 패널을
  //   닫고 [입력]하면(그 시점 lookupInProgress=false) manual_input 으로 되돌아갔다(현장 미완 재발).
  test('AC-5: 세션 조회 래치(lookupLatchedRef) 신설 + rising-edge 에서 세팅', () => {
    expect(gradeSelectSrc).toMatch(/const\s+lookupLatchedRef\s*=\s*useRef\(false\)/);
    // rising-edge effect 안에서 래치 on
    const risingBlock =
      gradeSelectSrc.match(/if\s*\(\s*lookupInProgress\s*&&\s*!prevLookupRef\.current[\s\S]*?\[lookupInProgress\]\s*\)/)?.[0] ?? '';
    expect(risingBlock).toMatch(/lookupLatchedRef\.current\s*=\s*true/);
  });

  test('AC-5: startEdit 은 래치를 소비 — lookupInProgress || lookupLatchedRef.current 이면 hira_lookup', () => {
    const startEditBlock = gradeSelectSrc.match(/const\s+startEdit\s*=[\s\S]*?setEditing\(true\)/)?.[0] ?? '';
    expect(startEditBlock).toMatch(/lookupInProgress\s*\|\|\s*lookupLatchedRef\.current/);
    expect(startEditBlock).toMatch(/lookedUp\s*\?\s*'hira_lookup'\s*:\s*\(source\s*\?\?\s*'manual_input'\)/);
    // 구 버그 패턴(startEdit 내 source ?? (lookupInProgress ? ...))은 제거됐다.
    const legacy = startEditBlock.match(/source\s*\?\?\s*\(lookupInProgress\s*\?\s*'hira_lookup'\s*:\s*'manual_input'\)/g) ?? [];
    expect(legacy.length).toBe(0);
  });

  test('AC-5: 래치 해제 — 고객 전환 effect + 저장 성공 시', () => {
    // customerId deps effect 에서 래치 초기화
    expect(gradeSelectSrc).toMatch(/lookupLatchedRef\.current\s*=\s*false;[\s\S]*?\}\s*,\s*\[customerId\]\s*\)/);
    // save() 성공 후 래치 소비
    const saveBlock = gradeSelectSrc.match(/const\s+save\s*=\s*async[\s\S]*?onChanged\?\.\(\)/)?.[0] ?? '';
    expect(saveBlock).toMatch(/lookupLatchedRef\.current\s*=\s*false/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 동작 기준 (AC-4) — 소스 문자열이 아닌 상태전이 결과로 결함 A·B 를 잡는다.
//   두 effect + 라디오의 상태머신을 InsuranceGradeSelect 소스와 동일하게 모델링해
//   관측 가능한 draftSource·draftGrade·draftMemo 전이를 단언한다.
//   (CT 인프라 부재 → 컴포넌트 마운트 대신 동일 로직 reducer 시뮬레이션.
//    구조 일치는 위 'REWORK 구조' describe 가 소스에 결속한다.)
// ──────────────────────────────────────────────────────────────────────
type Src = 'manual_input' | 'hira_lookup' | string;
interface FormState {
  draftGrade: string;
  draftSource: Src;
  draftMemo: string;
  prevLookup: boolean;
  lookupLatched: boolean; // T-20260819 STICKY-LATCH: 세션 조회 발생 래치
  savedSource: Src | null; // DB 에 영속된 source (useInsuranceGrade.source 미러)
}

// InsuranceGradeSelect 초기화 effect(:88~92) — deps [grade, source, memo] 변경 시만.
function syncFromProps(s: FormState, grade: string | null, source: Src | null, memo: string | null): FormState {
  return {
    ...s,
    draftGrade: grade ?? 'unverified',
    draftSource: source ?? 'manual_input',
    draftMemo: memo ?? '',
    savedSource: source,
  };
}
// rising-edge effect(:98~104) — lookupInProgress 변경 시. false→true 순간에만 hira_lookup + 래치 on.
function onLookupChange(s: FormState, lookupInProgress: boolean): FormState {
  const next = { ...s };
  if (lookupInProgress && !s.prevLookup) {
    next.draftSource = 'hira_lookup';
    next.lookupLatched = true;
  }
  next.prevLookup = lookupInProgress;
  return next;
}
// startEdit(:141~) — [입력/수정] 클릭. 세션 조회 래치를 소비.
function startEdit(s: FormState, lookupInProgress: boolean): FormState {
  const lookedUp = lookupInProgress || s.lookupLatched;
  return {
    ...s,
    draftGrade: s.draftGrade,
    draftSource: lookedUp ? 'hira_lookup' : (s.savedSource ?? 'manual_input'),
  };
}
// save() 성공 — source 영속 + 래치 소비.
function saveOk(s: FormState): FormState {
  return { ...s, savedSource: s.draftSource, lookupLatched: false, prevLookup: false };
}
// 라디오(:onClick={() => setDraftSource(s)}) — 데스크 수동 선택.
function radioSelect(s: FormState, sel: Src): FormState {
  return { ...s, draftSource: sel };
}
// 편집 중 등급/메모 입력.
function editInput(s: FormState, grade?: string, memo?: string): FormState {
  return { ...s, ...(grade !== undefined ? { draftGrade: grade } : {}), ...(memo !== undefined ? { draftMemo: memo } : {}) };
}
const initState = (): FormState => ({
  draftGrade: 'unverified', draftSource: 'manual_input', draftMemo: '',
  prevLookup: false, lookupLatched: false, savedSource: null,
});

test.describe('동작 기준(AC-4): 상태전이로 결함 A·B 차단', () => {
  test('DoD 1: [건보조회]→패널 닫기 후 draftSource 가 hira_lookup 유지 (결함 B 차단)', () => {
    // 신규 고객(source=null) 최초 로딩
    let st: FormState = initState();
    st = syncFromProps(st, null, null, null);
    expect(st.draftSource).toBe('manual_input');

    // [건보조회] 클릭 (captureOpen false→true)
    st = onLookupChange(st, true);
    expect(st.draftSource).toBe('hira_lookup');

    // 캡처 패널 [닫기] (captureOpen true→false) — 선행 버그에선 여기서 manual_input 으로 되돌아갔다
    st = onLookupChange(st, false);
    expect(st.draftSource).toBe('hira_lookup'); // ← 유지되어야 함
  });

  test('DoD 2: 편집 중 [건보조회] 토글 시 draftGrade·draftMemo 불변 (결함 A 차단)', () => {
    let st: FormState = initState();
    st = syncFromProps(st, null, null, null);

    // 데스크가 등급·메모 입력
    st = editInput(st, 'medical_aid_1', '차상위 확인 필요');
    expect(st.draftGrade).toBe('medical_aid_1');
    expect(st.draftMemo).toBe('차상위 확인 필요');

    // 확인차 [건보조회] 클릭 — rising-edge effect 만 발화(초기화 effect 는 deps 에 lookupInProgress 없어 미발화)
    st = onLookupChange(st, true);
    // 등급·메모는 그대로, 출처만 프리셋
    expect(st.draftGrade).toBe('medical_aid_1');
    expect(st.draftMemo).toBe('차상위 확인 필요');
    expect(st.draftSource).toBe('hira_lookup');
  });

  test('DoD 3(AC-3): 데스크가 수기 선택 후 패널 토글에도 수기 유지', () => {
    let st: FormState = initState();
    st = syncFromProps(st, null, null, null);

    // [건보조회] → hira_lookup 프리셋
    st = onLookupChange(st, true);
    expect(st.draftSource).toBe('hira_lookup');

    // 데스크가 라디오로 '수기(manual_input)' 로 되돌림
    st = radioSelect(st, 'manual_input');
    expect(st.draftSource).toBe('manual_input');

    // 패널 [닫기] (falling edge) — rising edge 아니므로 덮지 않음
    st = onLookupChange(st, false);
    expect(st.draftSource).toBe('manual_input'); // ← 선택 우선, 유지
  });

  test('DoD 4: 딥링크 없이 등급만 변경 → manual_input (음성 대조)', () => {
    let st: FormState = initState();
    st = syncFromProps(st, null, null, null);
    // 조회 개시 없이 등급만 입력
    st = editInput(st, 'general');
    expect(st.draftSource).toBe('manual_input');
  });

  test('DoD 5: 기존 source 있는 고객 재편집 시 종전 source 유지', () => {
    let st: FormState = initState();
    // 기존 저장값 source='hira_lookup' 인 고객 로딩
    st = syncFromProps(st, 'general', 'hira_lookup', '기확인');
    expect(st.draftSource).toBe('hira_lookup'); // 프리셋이 기존값을 밀어내지 않음
  });

  // ── T-20260819-...-STICKY-LATCH: 현장 primary 동선 회귀 lock (구 REWORK 미완 재현) ──
  test('DoD 6: [건보조회]→닫기→[입력]→저장 = hira_lookup (현장 primary 동선, 구버그 재발 차단)', () => {
    // 신규 고객, InsuranceGradeSelect 는 표시모드(편집 아님)에서 시작
    let st: FormState = initState();
    st = syncFromProps(st, null, null, null);
    expect(st.draftSource).toBe('manual_input');

    // 1구역 [건보조회] 클릭 (편집모드와 무관) → 래치 on + hira_lookup
    st = onLookupChange(st, true);
    expect(st.lookupLatched).toBe(true);

    // 포털 육안확인 후 캡처 패널 [닫기] (captureOpen true→false)
    st = onLookupChange(st, false);

    // 이제서야 InsuranceGradeSelect [입력] 클릭 → startEdit (구버그: 여기서 manual_input 복귀)
    st = startEdit(st, false /* lookupInProgress 이미 false */);
    expect(st.draftSource).toBe('hira_lookup'); // ← 래치 소비로 유지되어야 함(핵심 회귀 lock)

    // 등급 선택 후 저장
    st = editInput(st, 'general');
    st = saveOk(st);
    expect(st.savedSource).toBe('hira_lookup'); // DB 에 hira_lookup 영속
  });

  test('DoD 7: 조회 없이 표시모드→[입력]→저장 = manual_input (음성 대조, 오귀속 방지)', () => {
    let st: FormState = initState();
    st = syncFromProps(st, null, null, null);
    // 조회 개시 없음 → [입력]
    st = startEdit(st, false);
    expect(st.draftSource).toBe('manual_input');
    st = editInput(st, 'general');
    st = saveOk(st);
    expect(st.savedSource).toBe('manual_input');
  });

  test('DoD 8: 고객 전환 시 래치 리셋 — 이전 고객 hira_lookup 이 다음 고객으로 새지 않음', () => {
    let st: FormState = initState();
    st = onLookupChange(st, true); // 고객A 조회 → 래치 on
    st = onLookupChange(st, false);
    expect(st.lookupLatched).toBe(true);

    // 고객 전환 effect(:[customerId]) → 래치/prev 리셋 모델
    st = { ...st, lookupLatched: false, prevLookup: false };
    st = syncFromProps(st, null, null, null); // 고객B(신규) 로딩
    // 고객B 는 조회 없이 [입력] → manual_input
    st = startEdit(st, false);
    expect(st.draftSource).toBe('manual_input');
  });
});

// ──────────────────────────────────────────────────────────────────────
// DoD: 강제 아님(프리셋) — 라디오 선택 우선, 회귀 0
// ──────────────────────────────────────────────────────────────────────
test.describe('DoD: 프리셋일 뿐 강제 아님 (라디오 선택 우선·회귀 0)', () => {
  test('라디오 4종(source 선택) UI 보존 — 수기 선택으로 프리셋 덮어쓰기 가능', () => {
    expect(gradeSelectSrc).toContain('ALL_INSURANCE_GRADE_SOURCES');
    expect(gradeSelectSrc).toMatch(/setDraftSource/);
  });

  test('등급 write 는 오직 사람 [저장] 클릭 — 자동저장 없음(회귀 0)', () => {
    const saveMatches = gradeSelectSrc.match(/updateInsuranceGrade\(/g) ?? [];
    expect(saveMatches.length).toBe(1);
    expect(gradeSelectSrc).toMatch(/onClick=\{save\}/);
    // effect 로 등급을 저장하는 경로 없음(자동확정 금지 불변식)
    expect(gradeSelectSrc).not.toMatch(/useEffect\([\s\S]{0,600}updateInsuranceGrade/);
  });

  test('재산정 연쇄 유지 (insuranceGradeRefreshKey, 회귀 0)', () => {
    expect(chartSrc).toMatch(/setInsuranceGradeRefreshKey\(\(k\) => k \+ 1\)/);
    expect(chartSrc).toMatch(/refreshTrigger=\{insuranceGradeRefreshKey\}/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// 무접촉: 파서 재도입 금지 + calc/RPC/감사 LOGIC-LOCK
// ──────────────────────────────────────────────────────────────────────
test.describe('무접촉: 파서 재도입 금지 + calc/RPC/감사 보존', () => {
  test('파서(nhisParse) 재도입 없음 — 의도적 롤백 유지', () => {
    expect(existsSync(srcPath('lib/nhisParse.ts'))).toBe(false);
    expect(gradeSelectSrc).not.toContain('nhisParse');
    expect(gradeSelectSrc).not.toContain('suggestedGrade');
    expect(hookSrc).not.toContain('nhisParse');
  });

  test('copayCalc.ts (급여 계산 LOGIC-LOCK) 무접촉 — 파일 존재', () => {
    expect(existsSync(srcPath('lib/copayCalc.ts'))).toBe(true);
  });

  test('performLookup 딥링크 + 감사 RPC 무접촉 — 정상 동작 유지', () => {
    expect(hookSrc).toMatch(/window\.open\(NHIS_EXTERNAL_URL/);
    expect(hookSrc).toMatch(/supabase\.rpc\('log_nhis_eligibility_lookup', \{ p_customer_id/);
  });

  test('update_insurance_grade write 경로 시그니처 불변 (source 그대로 전달)', () => {
    expect(gradeSelectSrc).toContain('updateInsuranceGrade(customerId, draftGrade, draftSource');
  });
});
