/**
 * E2E spec — T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX
 * 진료 알림판(DoctorCallDashboard) 3종 (문지은 대표원장, U0ALGAAAJAV):
 *   item1 — 환자 이름 텍스트 클릭 → 진료차트(MedicalChartPanel full) 오픈 (기존 onOpenChart 'full' 핸들러 재사용).
 *   item2 — '차트' 칼럼(📝 임상경과 / 🩺 진료차트 이모지 버튼) 헤더+셀 통째로 제거 (ts 1781527085 spec_correction).
 *   item3 — 임상경과 빈값 '—' 클릭 시 인라인 임상경과 편집창(showClinical) 열기 + 옅은회색→진한톤 가독.
 *
 * (이관) DoctorTools 서브탭 라벨 '진료 환자 목록' 역전은 본 티켓 비범위 → T-20260615-foot-DOCDASH-RX-DISPLAY-REVAMP item7.
 *
 * 정적 소스 검증 스타일 — 인접 DOCDASH spec 컨벤션 동일(DASH() 소스 grep).
 *
 * ⚠ GUARD (AC5 회귀 0):
 *   - DoctorPatientList의 DOCPATIENTLIST-DONE-CLINICAL-READONLY(완료=읽기전용/빈펼침금지)는 별 컴포넌트 → 무접촉.
 *   - RXLIST-RENAME-DOCFILTER 행필터(원장 진료완료만)는 라벨만 역전, 필터 불변.
 *   - data-testid 보존(removed=차트칼럼 testid만). 진료완료 전이·처방 표시·균검사지 로직 무변경.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(join(HERE, '../../src', rel), 'utf-8');
const DASH = () => SRC('components/doctor/DoctorCallDashboard.tsx');

// thead 블록의 <th>텍스트</th> 라벨 순서 추출(클래스 무관).
function thOrder(block: string): string[] {
  return [...block.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1].trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// item1 — 환자 이름 클릭 → 진료차트(full) 오픈
// ─────────────────────────────────────────────────────────────────────────────
test.describe('item1/AC1 — 이름 클릭 → 진료차트(full)', () => {
  test('대기/완료 양 섹션 이름 버튼 = onOpenChart full 핸들러 + cursor-pointer', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-name-chart-btn"');
    expect(s).toContain('data-testid="doctor-completed-name-chart-btn"');
    // 이름 버튼 onClick = 진료차트 full 오픈(기존 핸들러 재사용)
    expect(s).toMatch(/doctor-call-name-chart-btn"[\s\S]{0,200}cursor-pointer/);
    // onOpenChart('full') 핸들러가 이름 버튼에 부착(full variant)
    const callBtn = s.indexOf('doctor-call-name-chart-btn');
    expect(s.slice(callBtn - 260, callBtn)).toContain("onOpenChart(checkIn.customer_id, 'full')");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item2 — '차트' 칼럼 통째 제거
// ─────────────────────────────────────────────────────────────────────────────
test.describe('item2/AC2 — 차트 칼럼(헤더+셀+이모지) 제거', () => {
  test('차트 칼럼 testid 잔존 0 (call/completed chart-cell·chart-btn·fullchart-btn)', () => {
    const s = DASH();
    expect(s).not.toContain('data-testid="doctor-call-chart-cell"');
    expect(s).not.toContain('data-testid="doctor-completed-chart-cell"');
    expect(s).not.toContain('data-testid="doctor-call-chart-btn"');
    expect(s).not.toContain('data-testid="doctor-completed-chart-btn"');
    expect(s).not.toContain('data-testid="doctor-call-fullchart-btn"');
    expect(s).not.toContain('data-testid="doctor-completed-fullchart-btn"');
  });

  test('CHART_CELL_EMOJI_BTN 상수 + 차트셀 이모지(📝/🩺 aria-hidden span) 제거', () => {
    const s = DASH();
    expect(s).not.toContain('const CHART_CELL_EMOJI_BTN');
    expect(s).not.toContain('<span aria-hidden>📝</span>');
    expect(s).not.toContain('<span aria-hidden>🩺</span>');
  });

  // ⚠ SUPERSEDED by T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX AC-1 (드리프트 재동기, T-20260617-SPEC-DRIFT-3CAUSE):
  //   본 item2 의 핵심 의도('차트' 칼럼 제거)는 보존되나, 본 spec 이 박제한 9칼럼(끝 '시간' 칼럼 잔존)은
  //   ELAPSED-CLINICAL-3FIX 가 '시간' 칼럼까지 추가 제거하며 8칼럼으로 바뀌었다. deployed 정본 = 양 테이블 동일 8칼럼:
  //     방·상태·이름·생년(만나이)·차트번호·오늘시술·처방·임상경과. (차트·시간 칼럼 모두 폐지 — '차트' 잔존 0 의도 불변)
  test("thead '차트'·'시간' 헤더 잔존 0 + 순서 = 방·상태·이름·생년·차트번호·오늘시술·처방·임상경과(8칼럼)", () => {
    const s = DASH();
    const DEPLOYED = ['방', '상태', '이름', '생년(만나이)', '차트번호', '오늘시술', '처방', '임상경과'];
    // 대기(호출) 테이블 thead
    const callStart = s.indexOf('doctor-call-feed-table');
    const callEnd = s.indexOf('doctor-call-feed-rows');
    expect(thOrder(s.slice(callStart, callEnd))).toEqual(DEPLOYED);
    // 완료 테이블 thead (대기와 동일 8칼럼 — '시간' placeholder 칼럼도 ELAPSED 가 제거)
    const doneStart = s.indexOf('doctor-completed-table');
    const doneEnd = s.indexOf('doctor-completed-rows');
    expect(thOrder(s.slice(doneStart, doneEnd))).toEqual(DEPLOYED);
  });

  // SUPERSEDED by ELAPSED-CLINICAL-3FIX: 차트(6%) 제거(NAME-EMOJI) + 시간(5%) 제거(ELAPSED) → 8칼럼, 합 100%.
  test('colgroup 8칼럼 + 합 100% (양 섹션, 차트·시간 제거분 임상경과 흡수)', () => {
    const s = DASH();
    const g1Start = s.indexOf('<colgroup>');
    const g1 = s.slice(g1Start, s.indexOf('</colgroup>', g1Start));
    const g2Start = s.indexOf('<colgroup>', g1Start + 1);
    const g2 = s.slice(g2Start, s.indexOf('</colgroup>', g2Start));
    const cols = (b: string) => (b.match(/<col /g) ?? []).length;
    const pct = (b: string) =>
      [...b.matchAll(/w-\[(\d+)%\]/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(cols(g1)).toBe(8);
    expect(cols(g2)).toBe(8);
    expect(pct(g1)).toBe(100);
    expect(pct(g2)).toBe(100);
  });

  // SUPERSEDED by ELAPSED-CLINICAL-3FIX: 시간 칼럼 제거 → colSpan 9→8(양 테이블).
  test('인라인 펼침행 colSpan 상수 8 (시간 칼럼 제거 정본)', () => {
    const s = DASH();
    expect(s).toContain('const DOCDASH_COLSPAN = 8;');
    expect(s).toContain('const DOCDASH_COMPLETED_COLSPAN = 8;');
    expect(s).not.toContain('const DOCDASH_COLSPAN = 9;');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// item3 — 임상경과 빈값 '—' 클릭편집 + 가독
// ─────────────────────────────────────────────────────────────────────────────
test.describe('item3/AC3·AC4 — 빈 임상경과 "—" 클릭편집 + 진한톤', () => {
  test('빈값 "—" = 버튼(클릭 시 showClinical 인라인 편집 열기) — 양 섹션', () => {
    const s = DASH();
    expect(s).toContain('data-testid="doctor-call-clinical-empty-btn"');
    expect(s).toContain('data-testid="doctor-completed-clinical-empty-btn"');
    // onClick = setShowClinical(true) (기존 인라인 편집 동선 재사용)
    const callEmpty = s.indexOf('doctor-call-clinical-empty-btn');
    expect(s.slice(callEmpty - 220, callEmpty)).toContain('setShowClinical(true)');
  });

  test('AC4 가독 — "—" placeholder 진한톤(text-gray-500, 구 text-gray-300 옅은회색 아님)', () => {
    const s = DASH();
    // empty 버튼 클래스에 진한 톤 적용
    const callEmpty = s.indexOf('doctor-call-clinical-empty-btn');
    const block = s.slice(callEmpty, callEmpty + 360);
    expect(block).toContain('text-gray-500');
    expect(block).not.toContain('text-gray-300 underline'); // 옅은회색 본문톤 잔존 금지
  });

  test('GUARD — 인라인 임상경과 편집(MedicalChartPanel variant=clinical singleLine) 보존', () => {
    const s = DASH();
    expect(s).toContain('variant="clinical"');
    expect(s).toContain('singleLine');
    expect(s).toContain('data-testid="doctor-call-chart-inline"');
    expect(s).toContain('data-testid="doctor-completed-chart-inline"');
  });
});
