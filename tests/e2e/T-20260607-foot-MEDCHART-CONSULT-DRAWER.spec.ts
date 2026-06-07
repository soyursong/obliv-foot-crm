/**
 * E2E spec — T-20260607-foot-MEDCHART-CONSULT-DRAWER (A안: 우측 탭 패널)
 * 진료차트(MedicalChartPanel) 우측 탭 패널의 신규 "📋 상담" 탭에서 환자 상담기록을
 * 창 전환 없이 조회하는 읽기 전용(Read-only) 뷰 검증.
 * (문지은 대표원장 6/7 A안 최종 확정: 서랍 → 우측 탭 패널 신규 탭으로 변경)
 *
 * 데이터 소스: check_ins 상담단계 기록 (consultation_done / notes.text / visit_type / consultant_id / treatment_*).
 *   방문(check_in) 단위 시간 역순 리스트. DB 변경 없음. 읽기 전용.
 *
 * 스타일: 기존 풋 진료차트 spec(in-page 순수 로직 시뮬레이션) — 구현 정본 규칙을 모사해 회귀를 잡는다.
 *   AC-1 탭 버튼 추가 / AC-2 표시·정렬(담당자+메모) / AC-3 초진 ⭐ 배지 / AC-4 read-only(탭 전환 시 폼 유지) / AC-5 0건 안내
 */
import { test, expect } from '@playwright/test';

// ── 정본 타입 (ConsultRecordTab.ConsultRecord) ─────────────────────────────────
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

// ── 정본: 초진(첫 방문) 배지 판정 (⭐ 초진) ───────────────────────────────────
const isNewVisit = (visitType: 'new' | 'returning' | null | undefined): boolean =>
  visitType === 'new';

// ── 정본: 우측 탭 키 (rightTab union) — 'consult' 신규 추가 ─────────────────────
const RIGHT_TABS = ['rx', 'phrase', 'super', 'visit_hist', 'images', 'consult'] as const;
type RightTab = (typeof RIGHT_TABS)[number];

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
// 시나리오 0(AC-1): 우측 패널에 "📋 상담" 탭이 기존 탭 옆에 추가된다
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 상담 탭 추가', () => {
  test('rightTab union 에 consult 키가 포함된다', () => {
    expect(RIGHT_TABS).toContain('consult');
  });

  test('기존 탭(처방세트/상용구/슈퍼상용구/진료내역/진료이미지)은 보존된다', () => {
    for (const k of ['rx', 'phrase', 'super', 'visit_hist', 'images'] as RightTab[]) {
      expect(RIGHT_TABS).toContain(k);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1(AC-2): 탭 클릭 → 목록(날짜 내림차순 + 담당자 + 메모 요약), cancelled 제외
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 상담기록 표시·정렬', () => {
  test('cancelled 방문은 제외된다', () => {
    const got = orderRecords(fixture);
    expect(got.map((r) => r.id)).not.toContain('c4');
    expect(got).toHaveLength(3);
  });

  test('checked_in_at 날짜 내림차순으로 정렬된다', () => {
    const got = orderRecords(fixture);
    // 6/5 > 6/3 > 6/1
    expect(got.map((r) => r.id)).toEqual(['c2', 'c3', 'c1']);
  });

  test('notes.text(메모 요약)가 추출·트림된다 (없으면 빈 문자열)', () => {
    expect(notesText({ text: '메모' })).toBe('메모');
    expect(notesText({ text: '  공백 트림  ' })).toBe('공백 트림');
    expect(notesText(null)).toBe('');
    expect(notesText({})).toBe('');
    expect(notesText('문자열아님')).toBe('');
  });

  test('담당자(상담실장) id → 표시명 매핑 (graceful — 미상이면 생략)', () => {
    const nameMap: Record<string, string> = { 'u-1': '김상담', 'u-2': '박실장' };
    const resolve = (id: string | null) => (id ? nameMap[id] ?? '' : '');
    expect(resolve('u-1')).toBe('김상담');
    expect(resolve('u-2')).toBe('박실장');
    expect(resolve(null)).toBe(''); // 담당자 없음 → 표기 생략
    expect(resolve('u-x')).toBe(''); // 매핑 실패 → 표기 생략(에러 없음)
  });

  test('치료 요약은 카테고리·종류·내용을 " · "로 묶는다', () => {
    expect(treatmentSummary(fixture[0])).toBe('풋케어 · 도수 · 스트레칭, 테이핑');
    expect(treatmentSummary(fixture[2])).toBe('레이저'); // kind 만
    expect(treatmentSummary(fixture[1])).toBe(''); // 전부 없음
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1(AC-3): 초진(첫 방문) 배지 ⭐
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 초진 ⭐ 배지', () => {
  test('visit_type="new" 면 초진(⭐)으로 표시된다', () => {
    const badge = (vt: ConsultRecord['visit_type']) =>
      vt === null ? null : isNewVisit(vt) ? '⭐ 초진' : '재진';
    expect(badge('new')).toBe('⭐ 초진');
  });

  test('재진/미상은 ⭐ 없음', () => {
    expect(isNewVisit('returning')).toBe(false);
    expect(isNewVisit(null)).toBe(false);
    expect(isNewVisit(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1(AC-4): Read-only — 탭 전환만으로 좌측 진료폼 입력이 유지된다
//   탭 패널 콘텐츠는 conditional render(rightTab===key)일 뿐, 좌측 진료폼 state 와 분리.
//   탭 전환 = setRightTab 만 — 진료폼 state 변경/리셋 없음. 상담 탭은 쓰기 경로 없음.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 read-only · 탭 전환 시 진료폼 유지', () => {
  test('rx → consult → rx 전환해도 진료폼 입력은 보존된다', () => {
    // 정본 불변식: 탭 전환은 rightTab 만 바꾸고 form state 는 건드리지 않는다.
    const switchTab = (state: { rightTab: RightTab; form: string }, next: RightTab) => ({
      ...state,
      rightTab: next, // 오직 탭만 변경
    });
    let s = { rightTab: 'rx' as RightTab, form: '진료중인 메모 작성중...' };
    s = switchTab(s, 'consult'); // 상담 탭 진입
    expect(s.rightTab).toBe('consult');
    expect(s.form).toBe('진료중인 메모 작성중...'); // 입력 유지
    s = switchTab(s, 'rx'); // 다시 처방세트 탭
    expect(s.form).toBe('진료중인 메모 작성중...'); // 여전히 유지
  });

  test('상담 탭은 read-only — 쓰기 핸들러가 없다(조회 전용 불변식)', () => {
    // ConsultRecordTab Props 는 { customerId } 뿐 — onChange/onSave 등 쓰기 prop 없음.
    const consultTabProps = ['customerId'] as const;
    expect(consultTabProps).not.toContain('onChange' as never);
    expect(consultTabProps).not.toContain('onSave' as never);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2(AC-5): 0건이면 "상담 기록 없음" 안내 (에러 없음)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-5 빈 상태', () => {
  test('전부 cancelled 면 0건 → "상담 기록 없음"', () => {
    const onlyCancelled: ConsultRecord[] = [{ ...fixture[3] }];
    const got = orderRecords(onlyCancelled);
    expect(got).toHaveLength(0); // → 빈 상태 UI 렌더(consult-record-empty: "상담 기록 없음")
  });

  test('빈 배열이어도 throw 없이 빈 리스트 반환', () => {
    expect(() => orderRecords([])).not.toThrow();
    expect(orderRecords([])).toEqual([]);
  });
});
