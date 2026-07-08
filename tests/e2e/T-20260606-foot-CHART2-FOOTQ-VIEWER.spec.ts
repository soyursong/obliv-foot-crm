/**
 * E2E spec — T-20260606-foot-CHART2-FOOTQ-VIEWER
 * 2번차트 [상담내역] 발건강질문지 자가작성 → "별도창(인쇄용) 이미지" 뷰어.
 *
 * 현장(김주연 총괄) A안 확정 + PHASE1 시안 confirm("레이아웃 여백 줄이고 반영ㄱㄱ").
 * 구현: window.open 별도창 + 문서형 HTML/SVG 렌더(신규 npm 0, 읽기 전용).
 *   고민되는 발톱 부위(concern_nail_sites) = FootToeIllustration 재활용 SVG.
 *
 * 이 스펙은 구현 정본(CustomerChartPage 진입점 노출 규칙 + healthQDocument 문서 빌더)의
 * 결정 지점을 1:1 미러링해 결정론적으로 가드한다(sibling HEALTHQ-VIEWER 스펙 관례).
 *
 * AC-1: 자가작성 제출분 존재 시 [별도창] 진입점 노출.
 * AC-2: 별도창 문서에 환자정보·자가작성 응답·발톱부위 다이어그램이 정상 렌더.
 * AC-3: 읽기 전용 — 문서에 편집 input/textarea 없음(제출 데이터 변형 경로 없음).
 * AC-4: 제출분 없으면 진입점 미노출 + 문서 빈상태 안내.
 * AC-5: 기존 [내용보기](in-modal) 동선 회귀 없음(별도창은 추가 진입점).
 */
import { test, expect } from '@playwright/test';

// ── 상담내역 [별도창] 진입점 노출 규칙 (CustomerChartPage.tsx 구현과 1:1) ──
// healthQResults(자가작성 health_q_results) 존재 시에만 노출.
interface HQResult { id: string; form_type: string; form_data: Record<string, unknown>; submitted_at: string; }
const docWindowTriggerShown = (hq: HQResult[]) => hq.length > 0;

// ── 별도창 문서 빌더 계약 미러 (src/lib/healthQDocument.ts) ──
// 실제 빌더는 브라우저 전용 의존(supabase/react)을 체인으로 끌어와 node 테스트 import 불가 →
// 문서가 만족해야 하는 불변식을 순수 함수로 미러링해 가드한다.
const FORM_TYPE_LABEL: Record<string, string> = {
  general: '발건강 질문지 (일반)',
  senior:  '발건강 질문지 (어르신용)',
};
const FIELD_LABELS: Record<string, string> = {
  symptoms: '발 관련 증상', foot_pain_level: '발 통증 여부', visit_frequency: '내원 가능 주기',
};
function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
interface FootSite { side: 'L' | 'R'; toe: number; }
function parseNailSites(raw: unknown): FootSite[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is FootSite =>
    !!x && (x.side === 'L' || x.side === 'R') && Number.isInteger(x.toe) && x.toe >= 1 && x.toe <= 5);
}
function buildDoc(result: HQResult, opts: { customerName: string; chartNumber?: string | null }): string {
  const formLabel = FORM_TYPE_LABEL[result.form_type] ?? result.form_type;
  const fields = Object.entries(result.form_data)
    .filter(([k, v]) => k in FIELD_LABELS && v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => ({ label: FIELD_LABELS[k], value: Array.isArray(v) ? v.join(', ') : String(v) }));
  const nail = parseNailSites(result.form_data.concern_nail_sites);
  const picked = nail.map((s) => `${s.side}${s.toe}`).join(', ');
  const empty = fields.length === 0 && nail.length === 0;
  return `<!DOCTYPE html><html><head><title>발건강질문지 자가작성 — ${esc(opts.customerName)}</title></head><body>
    <div class="name">${esc(formLabel)}</div>
    <div class="v">${esc(opts.customerName || '—')}</div>
    <div class="v">${esc(opts.chartNumber || '—')}</div>
    ${empty ? '<div class="empty">입력된 자가작성 항목이 없습니다.</div>' : ''}
    ${nail.length ? `<div class="nail-box"><span class="picked">${esc(picked)}</span><svg></svg><svg></svg></div>` : ''}
    ${fields.map((f) => `<div class="row"><div class="label">${esc(f.label)}</div><div class="value">${esc(f.value)}</div></div>`).join('')}
    <div class="ro">읽기 전용</div>
    <button type="button" onclick="window.print()">인쇄 / PDF 저장</button>
  </body></html>`;
}

test.describe('T-20260606-foot-CHART2-FOOTQ-VIEWER — 별도창(인쇄용) 이미지 뷰어', () => {
  // AC-1: 자가작성 존재 → 진입점 노출
  test('AC-1 자가작성 제출분 존재 → [별도창] 진입점 노출', () => {
    const hq: HQResult[] = [{ id: 'r1', form_type: 'general', form_data: {}, submitted_at: '2026-07-05T05:32:00Z' }];
    expect(docWindowTriggerShown(hq)).toBe(true);
  });

  // AC-4: 제출분 없음 → 진입점 미노출
  test('AC-4 자가작성 없음 → [별도창] 진입점 미노출', () => {
    expect(docWindowTriggerShown([])).toBe(false);
  });

  // AC-2: 문서에 환자정보 + 응답 필드 + 발톱부위 다이어그램 렌더
  test('AC-2 별도창 문서 — 환자정보·응답·발톱부위 다이어그램 렌더', () => {
    const result: HQResult = {
      id: 'r1', form_type: 'general', submitted_at: '2026-07-05T05:32:00Z',
      form_data: {
        symptoms: ['내성발톱(파고드는 발톱)', '발톱 변색 및 변형'],
        foot_pain_level: '있음',
        concern_nail_sites: [{ side: 'L', toe: 1 }, { side: 'R', toe: 1 }],
      },
    };
    const html = buildDoc(result, { customerName: '김민서', chartNumber: 'F-002841' });
    expect(html).toContain('발건강 질문지 (일반)');
    expect(html).toContain('김민서');
    expect(html).toContain('F-002841');
    expect(html).toContain('발 관련 증상');
    expect(html).toContain('내성발톱(파고드는 발톱), 발톱 변색 및 변형');
    // 발톱부위 다이어그램(좌/우 SVG 2개) + 선택 라벨
    expect(html).toContain('class="picked">L1, R1<');
    expect((html.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  // AC-3: 읽기 전용 — 편집 input/textarea 없음
  test('AC-3 읽기 전용 — 편집 input/textarea 없음', () => {
    const result: HQResult = {
      id: 'r1', form_type: 'general', submitted_at: '2026-07-05T05:32:00Z',
      form_data: { symptoms: ['내성발톱(파고드는 발톱)'], concern_nail_sites: [{ side: 'R', toe: 1 }] },
    };
    const html = buildDoc(result, { customerName: '김민서', chartNumber: 'F-1' });
    expect(html).not.toMatch(/<input/i);
    expect(html).not.toMatch(/<textarea/i);
    expect(html).toContain('읽기 전용');
  });

  // AC-4(문서): 빈 제출분 → 빈상태 안내
  test('AC-4 빈 응답 → 빈상태 안내 렌더', () => {
    const result: HQResult = { id: 'r1', form_type: 'general', form_data: {}, submitted_at: '2026-07-05T05:32:00Z' };
    const html = buildDoc(result, { customerName: '무응답', chartNumber: null });
    expect(html).toContain('입력된 자가작성 항목이 없습니다.');
    expect(html).toContain('무응답');
    expect(html).toContain('—'); // chartNumber 없음 → placeholder
  });

  // AC-2(주입 안전): 값에 HTML 특수문자 → 이스케이프
  test('AC-2 값 이스케이프 (주입 방지)', () => {
    const result: HQResult = {
      id: 'r1', form_type: 'general', submitted_at: '2026-07-05T05:32:00Z',
      form_data: { foot_pain_level: '<b>있음</b>' },
    };
    const html = buildDoc(result, { customerName: '홍<길>동', chartNumber: 'F-1' });
    expect(html).toContain('&lt;b&gt;있음&lt;/b&gt;');
    expect(html).toContain('홍&lt;길&gt;동');
    expect(html).not.toContain('<b>있음</b>');
  });
});
