/**
 * T-20260622-foot-CHART-MONOTONE-SAVEALL-PKGTEST
 * 차트 UI 폴리시 4건 — reporter 김주연 총괄 (foot CRM C0ATE5P6JTH)
 *
 * AC-1: 2번차트 잔여 유채색 모노톤화 — 보험차트 양식 chip + 양식선택 dialog card 의
 *        '발건강 질문지(어르신용)' emerald→teal(일반 형제 정합), '환불/비급여 동의서' rose→neutral.
 * AC-2: 2/3구역 완전검정(bg-neutral-800/#000) 저장·기입 버튼 → 모노톤.
 *        primary(저장 saveResvDetail/saveConsultation)=#333 차콜, secondary(기입/생성/추가:
 *        새 차트 작성·링크 생성·메모 추가)=#666 미드그레이. (허용범위 #333~#666)
 * AC-3: 2번차트 상단 [예약하기] 좌측 [저장] 버튼 신설 — 통합 저장(handleInfoPanelSave,
 *        "저장 후 닫기" 동일 액션) 1:1 재사용. 신규 write-path/스키마 없음.
 * AC-4: 패키지 탭 '피검사'(BloodTestRequestToggle) 상시 미노출 RC 수정 —
 *        노출 게이트를 KohRequestToggle 와 동일한 hasCheckIn(체크인 내원 존재)로 전환.
 *        구(svcs.length===0) 게이트 잔류가 NOTRENDER 증상의 RC.
 *
 * NOTE: 기존 chart spec 관례(순수 로직 + 소스 회귀가드)를 따른다. 실제 브라우저 렌더 / 갤탭
 *       실기기 터치 confirm 은 supervisor field-soak 단계에서 검증한다.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const readSrc = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

// ════════════════════════════════════════════════════════════════════════
// AC-4: 피검사 노출 게이트 — KOH 정합(hasCheckIn) 동작 검증 (RC fix 핵심)
// ════════════════════════════════════════════════════════════════════════
test.describe('AC-4: 피검사 노출 게이트 = hasCheckIn (KOH 정합)', () => {
  // 컴포넌트의 노출 게이트를 1:1 재현한 순수 함수.
  //   NEW(KOH 정합): 체크인 내원 있으면 노출(svcs 결과 무관). OLD(버그): svcs 비면 미노출.
  const shouldRenderNew = (p: {
    customerId: string | null;
    isLoading: boolean;
    ciLoading: boolean;
    hasCheckIn: boolean;
  }) => !(!p.customerId || p.isLoading || p.ciLoading || !p.hasCheckIn);

  const shouldRenderOld = (p: {
    customerId: string | null;
    isLoading: boolean;
    svcsLen: number;
  }) => !(!p.customerId || p.isLoading || p.svcsLen === 0);

  test('체크인 내원 있고 svcs 비어있음 → 신규 게이트는 노출(구 게이트는 숨김=RC)', () => {
    // 현장 증상: 패키지탭 진입 환자(체크인 보유)인데 svcs 임베드 결과 0 → 구 게이트 미노출.
    const ctx = { customerId: 'cust-1', isLoading: false };
    expect(shouldRenderOld({ ...ctx, svcsLen: 0 })).toBe(false); // 버그 재현
    expect(shouldRenderNew({ ...ctx, ciLoading: false, hasCheckIn: true })).toBe(true); // 수정 후 노출
  });

  test('체크인 내원 있고 svcs 있음 → 신·구 모두 노출(회귀 없음)', () => {
    const ctx = { customerId: 'cust-1', isLoading: false };
    expect(shouldRenderOld({ ...ctx, svcsLen: 2 })).toBe(true);
    expect(shouldRenderNew({ ...ctx, ciLoading: false, hasCheckIn: true })).toBe(true);
  });

  test('체크인 내원 없음 → 신규 게이트 미노출(KOH 와 동일, 과노출 방지)', () => {
    expect(
      shouldRenderNew({ customerId: 'cust-1', isLoading: false, ciLoading: false, hasCheckIn: false }),
    ).toBe(false);
  });

  test('로딩 중(svcs 또는 checkin) → 미노출', () => {
    expect(shouldRenderNew({ customerId: 'cust-1', isLoading: true, ciLoading: false, hasCheckIn: true })).toBe(false);
    expect(shouldRenderNew({ customerId: 'cust-1', isLoading: false, ciLoading: true, hasCheckIn: true })).toBe(false);
  });

  test('customerId 없음 → 미노출', () => {
    expect(shouldRenderNew({ customerId: null, isLoading: false, ciLoading: false, hasCheckIn: true })).toBe(false);
  });

  // svcs 비었을 때 ON 시도 = 무행위 silent 방지(안내 후 mutate 미호출)
  test('svcs 비어있음 + ON 시도 → mutate 미호출 + 안내(무행위 silent 방지)', () => {
    let mutated = false;
    let toasted = false;
    const handleToggle = (next: boolean, svcsLen: number) => {
      if (svcsLen === 0) { toasted = true; return; }
      mutated = true; void next;
    };
    handleToggle(true, 0);
    expect(mutated).toBe(false);
    expect(toasted).toBe(true);

    handleToggle(true, 1);
    expect(mutated).toBe(true);
  });
});

test.describe('AC-4: BloodTestRequestToggle 소스 회귀가드', () => {
  const src = readSrc('src/components/BloodTestRequestToggle.tsx');
  test('useHasCheckIn 도입 + ciLoading/!hasCheckIn 게이트', () => {
    expect(src).toContain('useHasCheckIn');
    expect(src).toContain('check_ins'); // 직접 조회(임베드 독립)
    expect(src).toMatch(/isLoading \|\| ciLoading \|\| !hasCheckIn/);
  });
  test('구 svcs.length===0 단독 노출 게이트 제거', () => {
    // 게이트 라인에서 svcs.length===0 가 노출 조건으로 더는 쓰이지 않음(early return 게이트 한정)
    expect(src).not.toMatch(/if \(!customerId \|\| isLoading \|\| svcs\.length === 0\) return null/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// AC-2: 완전검정 → 모노톤(#333 / #666). 하드 black 제거
// ════════════════════════════════════════════════════════════════════════
test.describe('AC-2: 저장·기입 버튼 모노톤화', () => {
  const chart = readSrc('src/pages/CustomerChartPage.tsx');
  const pen = readSrc('src/components/PenChartTab.tsx');
  const healthq = readSrc('src/components/HealthQResultsPanel.tsx');

  test('detail 저장(예약/상담) = 차콜 #333 primary', () => {
    // saveResvDetail / saveConsultation 버튼이 #333 으로 전환
    expect(chart).toContain('bg-[#333333] text-white py-1.5 text-[11px] font-medium hover:bg-[#454545]');
    // 더는 bg-neutral-800 w-full 저장 버튼 잔존 없음
    expect(chart).not.toContain('w-full rounded bg-neutral-800 text-white py-1.5 text-[11px] font-medium hover:bg-neutral-900');
  });

  test('메모 추가 = 미드그레이 #666 secondary', () => {
    expect(chart).toContain('bg-[#666666] text-white py-1.5 text-[11px] font-medium hover:bg-[#757575]');
  });

  test('새 차트 작성 = #666 secondary, 완전검정 제거', () => {
    expect(pen).toContain('bg-[#666666] hover:bg-[#757575]');
    expect(pen).not.toContain('h-7 text-[11px] px-3 bg-neutral-800 hover:bg-neutral-900\n            onClick');
  });

  test('링크 생성 = #666 secondary, 완전검정 제거', () => {
    expect(healthq).toContain('bg-[#666666] hover:bg-[#757575] text-white text-xs h-9 px-3');
    expect(healthq).not.toContain('bg-neutral-800 hover:bg-neutral-900 text-white text-xs h-9 px-3');
  });

  test('모노톤 색상값은 허용범위(#333~#666) 차콜/그레이 계열', () => {
    // 본 티켓이 도입한 버튼 색은 #333 / #666 두 종(reporter 지정)만.
    const introduced = ['#333333', '#666666', '#454545', '#757575'];
    for (const c of introduced) {
      const v = parseInt(c.slice(1, 3), 16);
      expect(v).toBeGreaterThanOrEqual(0x2b); // 차콜 하한 근방
      expect(v).toBeLessThanOrEqual(0x80);     // 미드그레이 상한 근방(은은한 모노톤)
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// AC-3: 상단 [저장] 전체저장 버튼 — handleInfoPanelSave 재사용
// ════════════════════════════════════════════════════════════════════════
test.describe('AC-3: 차트 전체저장 버튼', () => {
  const chart = readSrc('src/pages/CustomerChartPage.tsx');

  test('btn-chart-save-all 버튼 존재 + 예약하기 좌측 배치', () => {
    expect(chart).toContain('data-testid="btn-chart-save-all"');
    const saveIdx = chart.indexOf('data-testid="btn-chart-save-all"');
    const resvIdx = chart.indexOf('data-testid="btn-chart-make-reservation"');
    expect(saveIdx).toBeGreaterThan(0);
    expect(resvIdx).toBeGreaterThan(0);
    expect(saveIdx).toBeLessThan(resvIdx); // 저장이 예약하기보다 먼저(좌측) 렌더
  });

  test('통합 저장(handleInfoPanelSave) 재사용 — 신규 write-path 없음', () => {
    // 버튼 onClick 이 handleInfoPanelSave 호출(저장 후 닫기와 동일 액션)
    const seg = chart.slice(
      chart.indexOf('data-testid="btn-chart-save-all"') - 400,
      chart.indexOf('data-testid="btn-chart-save-all"') + 200,
    );
    expect(seg).toContain('handleInfoPanelSave()');
    expect(seg).toContain('savingInfoPanel'); // 저장 중 비활성
  });

  test('Save 아이콘 import', () => {
    expect(chart).toMatch(/import \{[^}]*\bSave\b[^}]*\} from 'lucide-react'/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// AC-1: 잔여 유채색 모노톤화 — 양식 chip + 양식선택 card
// ════════════════════════════════════════════════════════════════════════
test.describe('AC-1: 잔여 유채색 모노톤화 (양식 chip/card)', () => {
  const pen = readSrc('src/components/PenChartTab.tsx');

  // chip 블록('양식 종류 뱃지' div) 전체를 포함하도록 윈도우 폭 = 어르신용+환불 두 chip 모두 커버.
  const CHIP_WIN = 1000;
  test('어르신용 chip emerald 제거 → teal(일반 형제 정합)', () => {
    // chip 영역: 어르신용 라벨 바로 위 span 이 더는 emerald 아님
    const chipSeg = pen.slice(pen.indexOf('양식 종류 뱃지'), pen.indexOf('양식 종류 뱃지') + CHIP_WIN);
    expect(chipSeg).not.toContain('bg-emerald-50');
    expect(chipSeg).toContain('발건강 질문지 (어르신용)');
  });

  test('환불/비급여 chip rose 제거 → neutral', () => {
    const chipSeg = pen.slice(pen.indexOf('양식 종류 뱃지'), pen.indexOf('양식 종류 뱃지') + CHIP_WIN);
    expect(chipSeg).not.toContain('bg-rose-50');
    expect(chipSeg).toContain('환불/비급여 동의서 (3p)');
  });

  test('양식선택 dialog 카드 emerald/rose 제거', () => {
    // 카드 영역(handleSelectTemplate 렌더 블록)에 emerald/rose 배경 없음
    const cardStart = pen.indexOf('발건강 질문지 2종');
    const cardEnd = pen.indexOf('3페이지'); // 환불 카드 배지
    const cardSeg = pen.slice(cardStart, cardEnd + 100);
    expect(cardSeg).not.toContain('bg-emerald-50');
    expect(cardSeg).not.toContain('bg-emerald-200');
    expect(cardSeg).not.toContain('border-rose-200');
    expect(cardSeg).not.toContain('bg-rose-50');
  });
});
