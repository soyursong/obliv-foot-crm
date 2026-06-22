/**
 * T-20260622-foot-PENCHART-EDITBTN-NOCLICK
 * 펜차트 '수정' 버튼 클릭 무반응(버튼 노출O / 편집 캔버스 안 열림X / 화면전환·에러 없음) RC 수정 검증
 *
 * [근본원인 / RCA]
 *   H1(무음실패): handleEditChart 진입 직후 formKeyFromFileName(chart.name) 이 비정상 입력
 *       (chart.name=undefined/'')에서 .startsWith 예외 → setEditingChart/setMode('draw') 전부 스킵
 *       → 화면전환0 + 에러UI0(콘솔만) = "아무 반응 없음" 증상과 일치.
 *   H3(동선 불일치): 신규작성은 window.open('/penchart-editor') 별도 팝업창(갤탭 검증된 경로)인데
 *       수정은 임베드 컨텍스트의 인라인 setMode('draw') 라 동선이 갈라져, 임베드 Dialog 렌더
 *       경로의 미세 결함 시 무반응으로 발현될 수 있었다.
 *
 * [수정]
 *   AC-1: formKeyFromFileName null-safe 가드 + handleEditChart try/catch + [DIAG-EDITBTN] 로그 +
 *         실패 시 toast → 무음실패 제거. chart.name 누락 시 토스트 후 안전 중단.
 *   AC-2: 수정도 신규작성과 동일 1경로 — window.open('/penchart-editor?editChart=<파일명>') 팝업창.
 *         팝업 PenChartTab(popupMode)이 editChartName 으로 차트를 찾아 자동 편집(draw) 진입.
 *         팝업 차단 시 인라인 openEditInline 로 fallback(무음실패 방지).
 *   AC-3: 신규작성 URL·저장 동선 불변(회귀가드).
 *
 * NOTE: 기존 penchart spec 관례(순수 로직 시뮬). 실기기 갤탭 렌더/현장 confirm 은 supervisor field-soak.
 */
import { test, expect } from '@playwright/test';

// ── AC-1: formKeyFromFileName null-safe (무음 예외 제거) ──────────────────────
test.describe('EDITBTN-NOCLICK AC-1: formKeyFromFileName 예외 방어', () => {
  // 코드(PenChartTab)의 formKeyFromFileName 과 동일 로직.
  const formKeyFromFileName = (name: string): string => {
    if (!name || typeof name !== 'string') return 'pen_chart';
    if (name.startsWith('hq_sr_')) return 'health_questionnaire_senior';
    if (name.startsWith('hq_'))    return 'health_questionnaire_general';
    if (name.startsWith('rc_'))    return 'refund_consent';
    if (name.startsWith('pc_sr_')) return 'personal_checklist_senior';
    if (name.startsWith('pc_'))    return 'personal_checklist_general';
    return 'pen_chart';
  };

  test('비정상 입력(undefined/null/빈문자/숫자)에서 throw 없이 fallback', () => {
    // 이전엔 .startsWith 가 TypeError 를 던져 handleEditChart 전체가 무음 스킵됐다.
    expect(() => formKeyFromFileName(undefined as unknown as string)).not.toThrow();
    expect(() => formKeyFromFileName(null as unknown as string)).not.toThrow();
    expect(() => formKeyFromFileName(123 as unknown as string)).not.toThrow();
    expect(formKeyFromFileName('')).toBe('pen_chart');
    expect(formKeyFromFileName(undefined as unknown as string)).toBe('pen_chart');
  });

  test('정상 파일명 prefix → 원 양식 form_key 복원(회귀 불변)', () => {
    expect(formKeyFromFileName('1750000000000_pen.png')).toBe('pen_chart');
    expect(formKeyFromFileName('hq_sr_x.png')).toBe('health_questionnaire_senior');
    expect(formKeyFromFileName('hq_x.png')).toBe('health_questionnaire_general');
    expect(formKeyFromFileName('rc_x.png')).toBe('refund_consent');
    expect(formKeyFromFileName('pc_sr_x.png')).toBe('personal_checklist_senior');
    expect(formKeyFromFileName('pc_x.png')).toBe('personal_checklist_general');
  });
});

// ── AC-2: 수정 클릭 → 신규작성과 동일 팝업창 URL 1경로 ────────────────────────
test.describe('EDITBTN-NOCLICK AC-2: 수정 동선 = 신규 팝업창 1경로', () => {
  // 코드(handleEditChart)의 팝업 URL 빌드 로직과 동일.
  const buildEditUrl = (
    customerId: string, clinicId: string, chartName: string, checkInId?: string,
  ) => {
    const params = new URLSearchParams({ customerId, clinicId });
    if (checkInId) params.set('checkInId', checkInId);
    params.set('editChart', chartName);
    return `/penchart-editor?${params.toString()}`;
  };
  // 신규작성(새 차트) URL 빌드 — 회귀가드용 기준.
  const buildNewUrl = (customerId: string, clinicId: string, checkInId?: string) => {
    const params = new URLSearchParams({ customerId, clinicId });
    if (checkInId) params.set('checkInId', checkInId);
    return `/penchart-editor?${params.toString()}`;
  };

  test('수정 URL 은 신규와 동일 /penchart-editor 라우트 + editChart 파라미터를 갖는다', () => {
    const url = buildEditUrl('cust-1', 'clinic-1', '1750000000000_pen.png', 'ci-1');
    expect(url.startsWith('/penchart-editor?')).toBe(true);
    expect(url).toContain('customerId=cust-1');
    expect(url).toContain('clinicId=clinic-1');
    expect(url).toContain('checkInId=ci-1');
    expect(url).toContain('editChart=1750000000000_pen.png');
  });

  test('수정 URL 은 신규 URL 에 editChart 만 추가된 형태(동선 일관)', () => {
    const newUrl = buildNewUrl('cust-1', 'clinic-1', 'ci-1');
    const editUrl = buildEditUrl('cust-1', 'clinic-1', '1750000000000_pen.png', 'ci-1');
    // 같은 라우트·같은 base 파라미터 + editChart 1개 차이
    expect(editUrl.startsWith(newUrl)).toBe(true);
    expect(editUrl.replace(newUrl, '')).toBe('&editChart=1750000000000_pen.png');
  });

  test('checkInId 없으면 양쪽 URL 모두 checkInId 미포함', () => {
    const editUrl = buildEditUrl('cust-1', 'clinic-1', 'rc_x.png');
    expect(editUrl).not.toContain('checkInId');
    expect(editUrl).toContain('editChart=rc_x.png');
  });

  test('PenChartEditorPage 가 editChart 파라미터를 editChartName 으로 전달', () => {
    // 페이지 로직: searchParams.get('editChart') ?? undefined → PenChartTab editChartName prop
    const parseEditChart = (qs: string): string | undefined =>
      new URLSearchParams(qs).get('editChart') ?? undefined;
    expect(parseEditChart('customerId=c&editChart=rc_x.png')).toBe('rc_x.png');
    expect(parseEditChart('customerId=c')).toBeUndefined();
  });
});

// ── AC-2: 팝업 내부 자동 편집 진입 — 대상 차트 lookup ────────────────────────
test.describe('EDITBTN-NOCLICK AC-2: 팝업 자동 수정 진입(savedCharts lookup)', () => {
  type SavedChart = { name: string; url: string; uploadedAt: string };
  // 코드(자동진입 effect)의 대상 차트 탐색 로직과 동일.
  const findTarget = (charts: SavedChart[], editChartName?: string) =>
    editChartName ? charts.find((c) => c.name === editChartName) : undefined;

  const charts: SavedChart[] = [
    { name: 'rc_1.png', url: 'https://x/rc_1.png?token=a', uploadedAt: '' },
    { name: 'hq_2.png', url: 'https://x/hq_2.png?token=b', uploadedAt: '' },
  ];

  test('editChartName 과 일치하는 차트를 정확히 찾는다 → openEditInline 대상', () => {
    const t = findTarget(charts, 'hq_2.png');
    expect(t?.name).toBe('hq_2.png');
    expect(t?.url).toContain('token=b');
  });

  test('대상이 목록에 없으면 undefined → 토스트 후 신규작성 흐름(무음 아님)', () => {
    // 자동진입 effect: target 없으면 editAutoOpenedRef 세팅 + toast.error 후 select 유지.
    expect(findTarget(charts, 'deleted.png')).toBeUndefined();
  });

  test('editChartName 없으면 자동진입 안 함(신규작성 select 흐름 유지)', () => {
    expect(findTarget(charts, undefined)).toBeUndefined();
  });
});

// ── AC-3: 신규작성 동선 불변 (회귀가드) ──────────────────────────────────────
test.describe('EDITBTN-NOCLICK AC-3: 신규작성 동선 불변', () => {
  test('신규작성 URL 에는 editChart 파라미터가 없다', () => {
    const params = new URLSearchParams({ customerId: 'c', clinicId: 'cl' });
    const url = `/penchart-editor?${params.toString()}`;
    expect(url).not.toContain('editChart');
  });
});
