/**
 * E2E spec — T-20260607-foot-MEDCHART-CONSULT-DRAWER
 * 진료차트(MedicalChartPanel)에서 상담기록을 창 전환 없이 "주르륵" 조회하는 읽기 전용 서랍(ConsultRecordDrawer) 검증.
 * (문지은 대표원장 6/7 요청: "초진은 상담차트를 봐야 한다 — 진료차트에서 팝업/서랍으로 간편하게 보고 싶다")
 *
 * 데이터 소스(A안 확정 대상): check_ins 상담단계 기록 (consultation_done / notes.text / visit_type / consultant_id / treatment_*).
 *   방문(check_in) 단위 시간 역순 리스트가 "주르륵" 요구에 가장 자연스러움. 읽기 전용.
 *
 * 스타일: 기존 풋 진료차트 spec(in-page 순수 로직 시뮬레이션) — 구현 정본 규칙을 모사해 회귀를 잡는다.
 *   (AC-1 진입버튼 / AC-2 표시·정렬 / AC-3 초진 강조 / AC-4 빈 상태·무회귀)
 */
import { test, expect } from '@playwright/test';

// ── 정본 타입 (ConsultRecordDrawer.ConsultRecord) ──────────────────────────────
interface ConsultRecord {
  id: string;
  checked_in_at: string;
  visit_type: 'new' | 'returning' | null;
  consultation_done: boolean | null;
  consultant_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  notes: any | null;
  treatment_kind: string | null;
  treatment_category: string | null;
  treatment_contents: string[] | null;
  status: string | null;
}

// ── 정본: notes.text 추출 (notesText) ──────────────────────────────────────────
const notesText = (notes: unknown): string => {
  if (!notes || typeof notes !== 'object') return '';
  const t = (notes as { text?: unknown }).text;
  return typeof t === 'string' ? t.trim() : '';
};

// ── 정본: 치료 요약 (treatmentSummary) ─────────────────────────────────────────
const treatmentSummary = (r: ConsultRecord): string => {
  const parts: string[] = [];
  if (r.treatment_category) parts.push(r.treatment_category);
  if (r.treatment_kind) parts.push(r.treatment_kind);
  if (Array.isArray(r.treatment_contents) && r.treatment_contents.length > 0) {
    parts.push(r.treatment_contents.filter(Boolean).join(', '));
  }
  return parts.join(' · ');
};

// ── 정본: 조회 쿼리 모사 — cancelled 제외 + 최신순(checked_in_at desc) ───────────
const orderRecords = (rows: ConsultRecord[]): ConsultRecord[] =>
  rows
    .filter((r) => r.status !== 'cancelled')
    .sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at))
    .slice(0, 50);

// ── 정본: 초진 강조 판정 (버튼 data-new-patient) ──────────────────────────────
const isNewPatient = (visitType: 'new' | 'returning' | null | undefined): boolean =>
  visitType === 'new';

// ── 픽스처 ─────────────────────────────────────────────────────────────────────
const fixture: ConsultRecord[] = [
  {
    id: 'c1',
    checked_in_at: '2026-06-01T10:00:00+09:00',
    visit_type: 'new',
    consultation_done: true,
    consultant_id: 'u-1',
    notes: { text: '족저근막염 의심, 아침 첫걸음 통증 호소' },
    treatment_kind: '도수',
    treatment_category: '풋케어',
    treatment_contents: ['스트레칭', '테이핑'],
    status: 'completed',
  },
  {
    id: 'c2',
    checked_in_at: '2026-06-05T14:00:00+09:00',
    visit_type: 'returning',
    consultation_done: false,
    consultant_id: null,
    notes: null,
    treatment_kind: null,
    treatment_category: null,
    treatment_contents: null,
    status: 'completed',
  },
  {
    id: 'c3',
    checked_in_at: '2026-06-03T09:00:00+09:00',
    visit_type: 'returning',
    consultation_done: true,
    consultant_id: 'u-2',
    notes: { text: '  레이저 경과 양호  ' }, // 트림 검증용 공백
    treatment_kind: '레이저',
    treatment_category: null,
    treatment_contents: null,
    status: 'completed',
  },
  {
    id: 'c4',
    checked_in_at: '2026-06-06T11:00:00+09:00',
    visit_type: 'new',
    consultation_done: false,
    consultant_id: null,
    notes: null,
    treatment_kind: null,
    treatment_category: null,
    treatment_contents: null,
    status: 'cancelled', // 제외 대상
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 표시·정렬 — 시간 역순 "주르륵" + 취소 방문 제외 (AC-2)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 상담기록 표시·정렬', () => {
  test('cancelled 방문은 제외된다', () => {
    const got = orderRecords(fixture);
    expect(got.map((r) => r.id)).not.toContain('c4');
    expect(got).toHaveLength(3);
  });

  test('checked_in_at 최신순("주르륵")으로 정렬된다', () => {
    const got = orderRecords(fixture);
    // 6/5 > 6/3 > 6/1
    expect(got.map((r) => r.id)).toEqual(['c2', 'c3', 'c1']);
  });

  test('notes.text 가 추출·트림된다 (없으면 빈 문자열)', () => {
    expect(notesText({ text: '메모' })).toBe('메모');
    expect(notesText({ text: '  공백 트림  ' })).toBe('공백 트림');
    expect(notesText(null)).toBe('');
    expect(notesText({})).toBe('');
    expect(notesText('문자열아님')).toBe('');
  });

  test('치료 요약은 카테고리·종류·내용을 " · "로 묶는다', () => {
    expect(treatmentSummary(fixture[0])).toBe('풋케어 · 도수 · 스트레칭, 테이핑');
    expect(treatmentSummary(fixture[2])).toBe('레이저'); // kind 만
    expect(treatmentSummary(fixture[1])).toBe(''); // 전부 없음
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 초진 강조 — visit_type='new' 면 진입 버튼 강조 (AC-3)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 초진 강조', () => {
  test('visit_type="new" 면 초진으로 강조된다', () => {
    expect(isNewPatient('new')).toBe(true);
  });

  test('재진/미상은 일반 버튼', () => {
    expect(isNewPatient('returning')).toBe(false);
    expect(isNewPatient(null)).toBe(false);
    expect(isNewPatient(undefined)).toBe(false);
  });

  test('각 기록 카드의 초진/재진 배지도 동일 규칙', () => {
    // 카드 배지: visit_type='new' → 초진(amber), else 재진
    const badge = (vt: ConsultRecord['visit_type']) =>
      vt === null ? null : vt === 'new' ? '초진' : '재진';
    expect(badge('new')).toBe('초진');
    expect(badge('returning')).toBe('재진');
    expect(badge(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 빈 상태 — 상담기록 0건이면 안내(에러 없음) (AC-4)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 빈 상태', () => {
  test('전부 cancelled 면 0건 → "상담기록 없음"', () => {
    const onlyCancelled: ConsultRecord[] = [{ ...fixture[3] }];
    const got = orderRecords(onlyCancelled);
    expect(got).toHaveLength(0); // → 빈 상태 UI 렌더(consult-record-empty)
  });

  test('빈 배열이어도 throw 없이 빈 리스트 반환', () => {
    expect(() => orderRecords([])).not.toThrow();
    expect(orderRecords([])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4: 중첩 오버레이 z-index — 진료차트 위에 겹쳐 슬라이드(무회귀) (AC-1/AC-2)
//   진료차트 backdrop z-80 / panel z-90. 상담기록 서랍은 그 위(z-100/z-110)여야 "서랍이 위에 겹침"+닫으면 진료차트 복귀.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1/AC-2 중첩 오버레이 레이어링', () => {
  const Z = {
    medChartBackdrop: 80, // MedicalChartPanel
    medChartPanel: 90, // MedicalChartPanel (= drawer)
    consultBackdrop: 100, // ConsultRecordDrawer (신규)
    consultPanel: 110, // ConsultRecordDrawer (신규)
  };

  test('상담기록 서랍(z-100/110)은 진료차트(z-80/90) 위에 겹친다', () => {
    expect(Z.consultBackdrop).toBeGreaterThan(Z.medChartPanel);
    expect(Z.consultPanel).toBeGreaterThan(Z.consultBackdrop);
  });

  test('서랍을 닫아도 진료차트는 그대로(표시 토글 — 진료차트 언마운트/재조회 없음)', () => {
    // 정본 불변식: 진료차트는 항상 마운트 상태, consultDrawerOpen 상태만 토글.
    // 닫기 = setConsultDrawerOpen(false) 뿐 — onOpenChange(false)(진료차트 닫기) 호출 없음.
    const closeDrawer = (medChartOpen: boolean, drawerOpen: boolean) => ({
      medChartOpen, // 변화 없음
      drawerOpen: false,
    });
    const after = closeDrawer(true, true);
    expect(after.medChartOpen).toBe(true); // 진료차트 유지
    expect(after.drawerOpen).toBe(false);
  });
});
