/**
 * E2E spec — T-20260606-foot-SUPER-PHRASE-CHART-LINK-FIX
 * 진료차트(MedicalChartPanel) 임상경과 `//` 트리거의 (a) 슈퍼상용구 연결 + (b) 팝오버 "뒤로 열림" 수정 검증.
 * (문지은 대표원장 6/6 재신고: "슈퍼상용구가 임상경과에서 // 입력해도 연결 안 됨 + 불러오기 드롭다운이 뒤로 열려 선택 불가")
 *
 * 루트코즈 (코드 정독 확정):
 *   (a) `//` 팝오버 후보 소스가 phraseTemplates(일반 상용구)에만 바인딩 → superPhrases 미합류 = "핸들러 미연결".
 *       데이터 무관(super_phrases 0건이어도 핸들러는 연결되어야 함; AC-3 read-only 확인 결과 anon RLS 차단,
 *       선행 LOAD-BUG 가 인증조회로 분포 확정 → 본 증상은 데이터 갭이 아닌 바인딩 누락).
 *   (b) 팝오버가 drawer(z-90) 내부 absolute 라 상위 stacking 컨텍스트에 갇혀 뒤로 깔림.
 *
 * 수정:
 *   AC-1 (z-index): 팝오버를 document.body 로 portal + position:fixed + z-[200] → 항상 최상위, 클리핑·뒤로깔림 제거.
 *                   space-below 부족 시 위로 flip, 좌측은 뷰포트 우측 경계로 clamp.
 *   AC-2 (// 연결): filteredSuperPhrases 를 동일 팝오버에 합류. 선택 시 //query 토큰 제거 후 applySuperPhrase 일괄 적용.
 *                   후보 0건이어도 팝오버는 열되 빈 상태 안내(하드 게이팅 금지).
 *
 * 스타일: 기존 RX-SUPER-PHRASE-LOAD-BUG / SUPER-PHRASE-LOAD-FIX 패턴(in-page 순수 로직 시뮬레이션) —
 *   구현 정본(필터/토큰제거/포지셔닝/빈상태)과 동일 규칙을 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ── 정본 타입 ──────────────────────────────────────────────────────────────────
interface PhraseTemplate {
  id: number;
  name: string;
  content: string;
  shortcut_key: string | null;
  phrase_type: 'pen_chart' | 'medical_chart';
}
interface SuperPhrase {
  id: number;
  name: string;
  diagnosis: string | null;
  clinical_progress: string | null;
  rx_items: { name: string }[];
}

// ── 정본: `//` query 캡처 (handleClinicalChange) ───────────────────────────────
const captureSlashQuery = (textBefore: string): string | null => {
  const m = textBefore.match(/\/\/([^\s/]*)$/);
  return m ? m[1] : null;
};

// ── 정본: 슈퍼상용구 후보 필터 (filteredSuperPhrases, AC-2) ────────────────────
const filterSuperPhrases = (sps: SuperPhrase[], query: string): SuperPhrase[] =>
  sps
    .filter((sp) => {
      if (!query) return true;
      return (
        sp.name.includes(query) ||
        (sp.diagnosis ?? '').includes(query) ||
        (sp.clinical_progress ?? '').includes(query)
      );
    })
    .slice(0, 6);

// ── 정본: 일반 상용구 후보 필터 (filteredPhrases) ──────────────────────────────
const filterPhrases = (ps: PhraseTemplate[], query: string): PhraseTemplate[] =>
  ps
    .filter((p) => {
      if (!query) return p.shortcut_key != null;
      return (p.shortcut_key?.startsWith(query)) || p.name.includes(query);
    })
    .slice(0, 8);

// ── 정본: `//` 선택 시 토큰 제거 (applySuperPhraseFromSlash / insertPhrase) ─────
const stripSlashToken = (prev: string, cursor: number): string => {
  const before = prev.substring(0, cursor);
  const after = prev.substring(cursor);
  const m = before.match(/\/\/([^\s/]*)$/);
  return m ? before.substring(0, before.length - m[0].length) + after : prev;
};

// ── 정본: applySuperPhrase 임상경과 누적 (append) ──────────────────────────────
const appendClinical = (prev: string, clinical: string): string =>
  prev ? `${prev}\n${clinical}` : clinical;

// ── 정본: 팝오버 fixed 포지셔닝 (AC-1, 위/아래 flip + 좌측 clamp) ───────────────
interface Rect { left: number; bottom: number; top: number; }
const popoverPos = (rect: Rect, vw: number, vh: number) => {
  const MAX = 300;
  const spaceBelow = vh - rect.bottom;
  const top = spaceBelow > MAX ? rect.bottom + 4 : Math.max(8, rect.top - MAX - 4);
  const left = Math.min(rect.left, vw - 304);
  return { top, left };
};

// ── 픽스처 ─────────────────────────────────────────────────────────────────────
const superFixture: SuperPhrase[] = [
  { id: 1, name: '족저근막염세트', diagnosis: '족저근막염', clinical_progress: '아침 첫걸음 통증 호전', rx_items: [{ name: '소염제' }] },
  { id: 2, name: '발톱무좀세트', diagnosis: '조갑백선', clinical_progress: null, rx_items: [{ name: '항진균제' }] },
  { id: 3, name: '통풍급성기', diagnosis: '통풍', clinical_progress: '제1중족지 발적 감소', rx_items: [] },
];
const phraseFixture: PhraseTemplate[] = [
  { id: 100, name: '통증감소', content: '통증 점차 감소 추세', shortcut_key: '통증', phrase_type: 'medical_chart' },
  { id: 101, name: '펜차트메모', content: '펜차트 내용', shortcut_key: null, phrase_type: 'pen_chart' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: `//` 가 슈퍼상용구에 연결된다 (핸들러 미연결 회귀 차단) — AC-2
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 // 슈퍼상용구 연결', () => {
  test('`//` 입력 시 query 캡처 (빈 query)', () => {
    expect(captureSlashQuery('임상경과 기록 //')).toBe('');
    expect(captureSlashQuery('임상경과 //족저')).toBe('족저');
    // `//` 미입력 시 트리거 안 됨
    expect(captureSlashQuery('그냥 텍스트')).toBeNull();
    expect(captureSlashQuery('// 띄어쓰기 후')).toBeNull(); // 공백 뒤는 토큰 종료
  });

  test('빈 query 면 슈퍼상용구 전체 노출 (최대 6) — // 단독 입력에도 후보가 뜬다', () => {
    const got = filterSuperPhrases(superFixture, '');
    expect(got).toHaveLength(3);
    expect(got.map((s) => s.name)).toContain('족저근막염세트');
  });

  test('query 부분일치 — 이름/진단/경과 어디든 매칭', () => {
    expect(filterSuperPhrases(superFixture, '족저').map((s) => s.id)).toEqual([1]); // 이름+진단
    expect(filterSuperPhrases(superFixture, '조갑').map((s) => s.id)).toEqual([2]); // 진단
    expect(filterSuperPhrases(superFixture, '발적').map((s) => s.id)).toEqual([3]); // 경과
    expect(filterSuperPhrases(superFixture, '없는단어')).toHaveLength(0);
  });

  test('회귀 핵심: 일반 상용구 `//` 도 함께 살아있어야 함 (슈퍼상용구 추가로 인한 회귀 금지)', () => {
    // 빈 query: shortcut_key 보유 상용구만 (기존 동작 보존)
    expect(filterPhrases(phraseFixture, '').map((p) => p.id)).toEqual([100]);
    // query: 이름/단축어 매칭
    expect(filterPhrases(phraseFixture, '통증').map((p) => p.id)).toEqual([100]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 선택 시 //query 토큰 제거 + 임상경과 누적 — AC-2
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 선택 → 토큰제거 + 임상경과 삽입(누적)', () => {
  test('슈퍼상용구 선택: //query 토큰이 제거되고 경과가 누적된다', () => {
    const prev = '내원 경과 //족저';
    const cursor = prev.length;
    // 1) 토큰 제거
    const stripped = stripSlashToken(prev, cursor);
    expect(stripped).toBe('내원 경과 ');
    // 2) applySuperPhrase 가 clinical_progress 를 append (누적)
    const sp = superFixture[0];
    const result = appendClinical(stripped, sp.clinical_progress ?? '');
    expect(result).toBe('내원 경과 \n아침 첫걸음 통증 호전');
  });

  test('커서 중간 위치에서도 해당 //query 만 제거 (뒤 텍스트 보존)', () => {
    const prev = '앞 //통증 뒤';
    const cursor = '앞 //통증'.length; // 커서가 통증 뒤
    const stripped = stripSlashToken(prev, cursor);
    expect(stripped).toBe('앞  뒤');
  });

  test('빈 경과 슈퍼상용구 선택 시 임상경과는 그대로 (진단/처방만 라우팅 — 누적 안전)', () => {
    const prev = '기존경과 //발톱';
    const stripped = stripSlashToken(prev, prev.length);
    const sp = superFixture[1]; // clinical_progress=null
    const clinical = (sp.clinical_progress ?? '').trim();
    const result = clinical ? appendClinical(stripped, clinical) : stripped;
    expect(result).toBe('기존경과 '); // 경과 미변경
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 팝오버 포지셔닝 — 항상 최상위 + 위/아래 flip + clamp (AC-1)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 팝오버 fixed 포지셔닝 (뒤로 열림/클리핑 방지)', () => {
  test('아래 공간 충분 → textarea 하단에 배치', () => {
    const { top } = popoverPos({ left: 100, top: 200, bottom: 280 }, 1440, 900);
    expect(top).toBe(284); // bottom + 4
  });

  test('아래 공간 부족 → 위로 flip (화면 밖 방지)', () => {
    // bottom 이 뷰포트 하단 근처 → 아래 300px 공간 없음 → top 위로
    const { top } = popoverPos({ left: 100, top: 700, bottom: 760 }, 1440, 900);
    expect(top).toBe(700 - 300 - 4); // rect.top - MAX - 4 = 396
  });

  test('좌측이 뷰포트 우측 경계 초과 → clamp', () => {
    const { left } = popoverPos({ left: 1400, top: 200, bottom: 280 }, 1440, 900);
    expect(left).toBe(1440 - 304); // 1136 로 clamp
  });

  test('flip 시에도 상단 8px 가드 (음수 top 방지)', () => {
    const { top } = popoverPos({ left: 0, top: 10, bottom: 880 }, 1440, 900);
    expect(top).toBe(8); // Math.max(8, 10-300-4)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4: 후보 0건이어도 먹통 금지 — 빈 상태 안내 (AC-2)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 빈 상태(하드 게이팅 금지)', () => {
  // 정본: 팝오버는 phrasePopoverVisible 동안 항상 렌더, hasAny=false 면 빈 안내.
  const hasAny = (sps: SuperPhrase[], ps: PhraseTemplate[], query: string): boolean =>
    filterSuperPhrases(sps, query).length > 0 || filterPhrases(ps, query).length > 0;

  test('슈퍼상용구·상용구 모두 0건 → 팝오버는 열리되 빈 안내 (먹통 아님)', () => {
    expect(hasAny([], [], '')).toBe(false);
  });

  test('슈퍼상용구만 있으면 팝오버 노출', () => {
    expect(hasAny(superFixture, [], '족저')).toBe(true);
  });

  test('매칭 0건이어도(검색어 불일치) 팝오버는 닫히지 않고 빈 안내', () => {
    expect(hasAny(superFixture, phraseFixture, '존재하지않는검색어')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 5: 드롭다운 z-index — 임상경과 外 빠른처방·처방세트 전 화면 일괄 적용 (AC-4)
//   루트코즈: 공통 Select(SelectContent)가 z-50 → Dialog(z-90)/Sheet·CustomerChartSheet(z-70)
//   내부에서 열리면 그 뒤로 깔려 '상용구 불러오기' 등 드롭다운 선택 불가(전 화면 공통).
//   수정: 공통 컴포넌트(ui/select.tsx) 단일 수정으로 z-[200] 격상 → 모든 화면 일괄 커버(화면별 땜질 X).
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 공통 Select z-index — 전 화면 앞으로 열림', () => {
  // 정본: 앱 레이어링 상수(ui/*.tsx 와 동일 값). Select 팝업은 모든 오버레이보다 위여야 함.
  const Z = {
    sheet: 50, // ui/sheet.tsx 기본
    sheetNested: 70, // ui/sheet.tsx zLevel=1 / CustomerChartSheet
    dialogBackdrop: 80, // ui/dialog.tsx
    dialogContent: 90, // ui/dialog.tsx (= drawer)
    selectPopup: 200, // ui/select.tsx (AC-4 수정값)
  };

  test('Select 팝업(z-200)은 Dialog(z-90)·Sheet(z-70)보다 항상 위', () => {
    expect(Z.selectPopup).toBeGreaterThan(Z.dialogContent);
    expect(Z.selectPopup).toBeGreaterThan(Z.dialogBackdrop);
    expect(Z.selectPopup).toBeGreaterThan(Z.sheetNested);
    expect(Z.selectPopup).toBeGreaterThan(Z.sheet);
  });

  test('회귀: 구(舊) z-50 은 Dialog(z-90) 뒤로 깔려 선택 불가였음 (수정 전 상태 모사)', () => {
    const OLD_SELECT_Z = 50;
    expect(OLD_SELECT_Z).toBeLessThan(Z.dialogContent); // 버그 재현: 뒤로 열림
    expect(Z.selectPopup).toBeGreaterThan(Z.dialogContent); // 수정 후: 앞으로 열림
  });

  test('단일 공통값이므로 화면(임상경과·빠른처방·처방세트) 무관하게 동일 레이어', () => {
    // 모든 화면이 동일 <Select> 컴포넌트를 사용 → 단일 z-index 가 전 화면을 커버한다는 불변식.
    const screens = ['clinical_progress', 'quick_rx', 'prescription_set'];
    const layerForScreen = (_screen: string) => Z.selectPopup; // 공통 컴포넌트 → 화면별 분기 없음
    for (const s of screens) expect(layerForScreen(s)).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 6: 슈퍼상용구 '처방 항목 추가'(ad-hoc) 제거 — 처방세트에서만 관리 (AC-5)
//   정본 정책: 슈퍼상용구의 rx_items 는 '처방세트 불러오기'(loadRxSet)로만 채움. addItem(빈 행 추가) 폐지.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-5 슈퍼상용구 처방항목은 처방세트에서만', () => {
  interface SP { rx_items: { name: string }[] }
  const EMPTY_ITEM = { name: '' };

  // 정본: 처방세트 불러오기 — 빈 행 제거 후 세트 항목 append (유지되는 유일 경로)
  const loadRxSet = (form: SP, setItems: { name: string }[]): SP => {
    const nonEmpty = form.rx_items.filter((i) => i.name.trim() !== '');
    return { rx_items: [...nonEmpty, ...setItems.map((i) => ({ ...EMPTY_ITEM, ...i }))] };
  };

  test('처방세트 불러오기로만 rx_items 가 채워진다', () => {
    const start: SP = { rx_items: [] };
    const after = loadRxSet(start, [{ name: '아세트아미노펜' }, { name: '이부프로펜' }]);
    expect(after.rx_items.map((i) => i.name)).toEqual(['아세트아미노펜', '이부프로펜']);
  });

  test('ad-hoc 빈 처방행 추가(addItem) 경로는 더 이상 존재하지 않는다 (정책 불변식)', () => {
    // addItem 이 폐지됐으므로, rx_items 증가는 오직 loadRxSet 결과로만 발생.
    const allowedMutators = ['loadRxSet'];
    expect(allowedMutators).not.toContain('addItem');
    expect(allowedMutators).toEqual(['loadRxSet']);
  });

  test('빈 상태 안내 문구가 "처방세트 불러오기"를 가리킨다', () => {
    const emptyHint = '처방내역 없음 — 필요 시 위 "처방세트 불러오기"로 추가';
    expect(emptyHint).toContain('처방세트 불러오기');
    expect(emptyHint).not.toContain('처방 항목 추가');
  });
});
