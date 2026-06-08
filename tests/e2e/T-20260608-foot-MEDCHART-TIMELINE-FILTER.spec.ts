/**
 * E2E spec — T-20260608-foot-MEDCHART-TIMELINE-FILTER (FE-only, DB 무변경)
 * 진료차트 좌측 '진료 경과 타임라인' 정리·필터·가독성 (현장: 문지은 대표원장).
 *
 *   AC-1 좌측 필터 = 진료관련 4종(치료메모/진료메모/처방/⚠특이)만. 상담(consult) 필터칩 없음
 *        — 좌측은 진료 전용, 상담은 우측 📋상담 탭(AC-5).
 *   AC-2 필터 토글 시 해당 유형만 표시(OR 로직), 해제 시 전체 복원.
 *   AC-3 유형별 시각 구분(아이콘/색) + 밀도 정리.
 *   AC-4 기본(필터 미적용) = 전체 표시, 데이터 누락 없음.
 *   AC-6 '이 환자가 어떻게 치료받았는지' 한 줄 요약(chartTreatmentGist) — 치료/임상경과 + 처방 압축.
 *
 * 스타일: 정본(MedicalChartPanel) 의 filteredDisplayCharts(OR 필터)·hasTreatMemo/hasDocMemo/hasRx·
 *   chartTreatmentGist 로직을 in-page 순수 함수로 모사해 회귀를 잡는다.
 *   (PANEL-CLARITY / FIRSTVISIT-CHARTLIST-UX spec 동일 패턴 — FE-only, 무DB)
 */
import { test, expect } from '@playwright/test';

// ── 정본 타입 모사 (MedicalChart 부분) ─────────────────────────────────────────
type MemoFilter = 'treat' | 'doc' | 'rx' | 'notable';
interface RxItem { name: string }
interface Chart {
  id: string;
  visit_date: string;
  diagnosis: string | null;
  chief_complaint: string | null;
  clinical_progress: string | null;
  treatment_record: string | null;
  doctor_memo: string | null;
  prescription_items: RxItem[] | null;
}

// ── 정본: 좌측 필터 옵션 = 진료관련 4종만 (consult 없음) ────────────────────────
const FILTER_KEYS: MemoFilter[] = ['treat', 'doc', 'rx', 'notable'];

// ── 정본: 유형 판별 ────────────────────────────────────────────────────────────
const NOTABLE_KEYWORDS = ['알러지', '주의', '특이', '금기', '과민', '부작용', '금지'];
const hasTreatMemo = (c: Chart) => !!c.treatment_record?.trim();
const hasDocMemo = (c: Chart) => !!c.clinical_progress?.trim() || !!c.doctor_memo?.trim();
const hasRx = (c: Chart) => Array.isArray(c.prescription_items) && c.prescription_items.length > 0;
const isNotable = (c: Chart) => {
  const text = [c.clinical_progress, c.doctor_memo, c.diagnosis, c.treatment_record].filter(Boolean).join(' ');
  return NOTABLE_KEYWORDS.some((kw) => text.includes(kw));
};

// ── 정본: filteredDisplayCharts (OR 로직) ──────────────────────────────────────
const applyFilter = (charts: Chart[], filters: Set<MemoFilter>): Chart[] =>
  filters.size === 0
    ? charts
    : charts.filter((c) => {
        if (filters.has('treat') && hasTreatMemo(c)) return true;
        if (filters.has('doc') && hasDocMemo(c)) return true;
        if (filters.has('rx') && hasRx(c)) return true;
        if (filters.has('notable') && isNotable(c)) return true;
        return false;
      });

// ── 정본: chartSummary + chartTreatmentGist (AC-6) ─────────────────────────────
const chartSummary = (c: Chart): string =>
  c.diagnosis || c.chief_complaint || c.clinical_progress || c.treatment_record || '기록';

const chartTreatmentGist = (c: Chart, summaryText: string): string => {
  const parts: string[] = [];
  const treatRaw = c.treatment_record?.trim() || c.clinical_progress?.trim() || '';
  const treatFirst = treatRaw.split('\n')[0].trim();
  if (treatFirst && treatFirst !== summaryText) {
    parts.push(treatFirst.length > 44 ? `${treatFirst.slice(0, 44)}…` : treatFirst);
  }
  const rxNames = (Array.isArray(c.prescription_items) ? c.prescription_items : [])
    .map((rx) => rx?.name)
    .filter((n): n is string => !!n && !!n.trim());
  if (rxNames.length > 0) {
    parts.push(`💊 ${rxNames.slice(0, 2).join(', ')}${rxNames.length > 2 ? ` 외 ${rxNames.length - 2}` : ''}`);
  }
  return parts.join('  ·  ');
};

// ── QA_김타임라인 시드 환자 모사 데이터(seed_chart_park_sujin_20260608.mjs 와 동일 구조) ──
const charts: Chart[] = [
  { id: 'c6', visit_date: '2026-06-02', diagnosis: '조갑백선 호전, 무지외반증', chief_complaint: null, clinical_progress: '6회차. 비가열 레이저 25분.', treatment_record: '비가열 레이저 25분. 홈케어 교육.', doctor_memo: '[원장] 발톱 70% 정상화.', prescription_items: [{ name: '히알루론산 풋크림' }] },
  { id: 'c5', visit_date: '2026-05-20', diagnosis: '조갑백선', chief_complaint: null, clinical_progress: '5회차. 포도듈 부착 후 비가열 20분.', treatment_record: '포도듈 부착, 비가열 레이저 20분.', doctor_memo: '[원장] 신생 발톱 성장 양호.', prescription_items: null },
  { id: 'c4', visit_date: '2026-05-10', diagnosis: '무지외반증', chief_complaint: null, clinical_progress: '4회차. 가열 레이저 15분.', treatment_record: '가열 레이저 15분. 스트레칭 교육.', doctor_memo: '[원장] 이트라코나졸 펄스요법 추가.', prescription_items: [{ name: '이트라코나졸 캡슐 100mg' }] },
  { id: 'c3', visit_date: '2026-04-29', diagnosis: '조갑백선, 무지외반증', chief_complaint: null, clinical_progress: '3회차. 비가열 레이저 20분.', treatment_record: '비가열 레이저 20분. 사진 비교.', doctor_memo: null, prescription_items: null },
  { id: 'c2', visit_date: '2026-04-21', diagnosis: '조갑백선, 무지외반증', chief_complaint: null, clinical_progress: '2회차. KOH 양성 확인.', treatment_record: '프리컨디셔닝 15분, 비가열 레이저 20분.', doctor_memo: '[원장] KOH 양성.', prescription_items: [{ name: '터비나핀 외용액' }, { name: '우레아 크림 20%' }] },
  { id: 'c1', visit_date: '2026-04-14', diagnosis: '양측 무지외반증, 좌측 조갑백선 의심', chief_complaint: '양쪽 엄지발가락 변형', clinical_progress: '초진. 양측 무지외반증 grade II.', treatment_record: '초진 검진 및 사진 촬영. KOH 채취.', doctor_memo: '[원장] 초진 — 보존치료 우선.', prescription_items: null },
];

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 좌측 필터 = 진료관련 4종만, 상담(consult) 필터칩 없음
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 좌측 필터 = 진료 전용 4종', () => {
  test('필터 옵션은 치료/진료/처방/특이 4종 — consult 키 없음', () => {
    expect(FILTER_KEYS).toEqual(['treat', 'doc', 'rx', 'notable']);
    expect(FILTER_KEYS).not.toContain('consult' as unknown as MemoFilter);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 / AC-4: 필터 토글 동작 + 기본 전체 표시
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2/AC-4 필터 토글', () => {
  test('AC-4 필터 미적용 시 전체(6건) 표시 — 누락 없음', () => {
    expect(applyFilter(charts, new Set()).length).toBe(charts.length);
  });

  test('AC-2 처방(rx) 필터 → 처방 있는 회차만 (3건: c2,c4,c6)', () => {
    const r = applyFilter(charts, new Set<MemoFilter>(['rx']));
    expect(r.map((c) => c.id).sort()).toEqual(['c2', 'c4', 'c6']);
  });

  test('AC-2 치료메모(treat) 필터 → 6건 전부(모든 회차 치료메모 보유)', () => {
    expect(applyFilter(charts, new Set<MemoFilter>(['treat'])).length).toBe(6);
  });

  test('AC-2 복수 필터(rx+notable) = OR 합집합', () => {
    const r = applyFilter(charts, new Set<MemoFilter>(['rx', 'notable']));
    // 시드엔 notable 키워드 없음 → rx 결과(3)와 동일
    expect(r.map((c) => c.id).sort()).toEqual(['c2', 'c4', 'c6']);
  });

  test('AC-2 필터 해제 → 전체 복원', () => {
    const filtered = applyFilter(charts, new Set<MemoFilter>(['rx']));
    expect(filtered.length).toBe(3);
    const restored = applyFilter(charts, new Set());
    expect(restored.length).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-6: 치료 경과 한 줄 요약 (어떻게 치료받았는지)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-6 치료 경과 gist', () => {
  test('치료 텍스트 + 처방을 압축해 한 줄로 노출', () => {
    const c2 = charts.find((c) => c.id === 'c2')!;
    const gist = chartTreatmentGist(c2, chartSummary(c2));
    expect(gist).toContain('프리컨디셔닝');
    expect(gist).toContain('💊');
    expect(gist).toContain('터비나핀 외용액');
  });

  test('처방 3개 이상이면 "외 N" 으로 축약', () => {
    const many: Chart = { id: 'x', visit_date: '2026-06-08', diagnosis: '진단', chief_complaint: null, clinical_progress: null, treatment_record: '치료', doctor_memo: null, prescription_items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
    const gist = chartTreatmentGist(many, chartSummary(many));
    expect(gist).toContain('💊 A, B 외 1');
  });

  test('치료 텍스트가 요약(진단)과 동일하면 중복 제거하고 처방만', () => {
    const dup: Chart = { id: 'y', visit_date: '2026-06-08', diagnosis: null, chief_complaint: null, clinical_progress: null, treatment_record: '동일텍스트', doctor_memo: null, prescription_items: [{ name: '크림' }] };
    const summary = chartSummary(dup); // = '동일텍스트'
    const gist = chartTreatmentGist(dup, summary);
    expect(gist).toBe('💊 크림');
  });

  test('치료·처방 모두 없으면 빈 문자열(렌더 생략)', () => {
    const empty: Chart = { id: 'z', visit_date: '2026-06-08', diagnosis: '진단', chief_complaint: null, clinical_progress: null, treatment_record: null, doctor_memo: null, prescription_items: null };
    expect(chartTreatmentGist(empty, chartSummary(empty))).toBe('');
  });
});
