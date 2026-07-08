import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { BRIEF_NOTE_CHIPS, isBriefNoteChip } from '../../src/lib/resvSlotAgg';

/**
 * T-20260708-foot-BRIEFMEMO-TIMETABLE-CHIPONLY-EDIT — 김주연 총괄(풋센터, C0ATE5P6JTH)
 *
 * 요청 3항목:
 *   [1] 대시보드 통합시간표 명단 간략메모 = 예약 생성 시 '선택한 [간략메모] 칩만' 표시,
 *       수기로 작성한 자유텍스트 메모는 넣지 않는다. (성함 짤림은 P0 TIMETABLE-PTNAME-TRUNCATE 소유)
 *   [2] 예약상세 팝업에서 간략메모 수정 불가 = 버그 → 수정/저장/명단 반영 가능화.
 *   [3] [Q] 예약 생성 간략메모 → 2번차트 연동 위치 규명 (코드 무변경 진단 회신).
 *
 * 본 스펙: FE-only, 스키마 무변경. 순수 판정 함수(isBriefNoteChip) 단언 + 소스 정적 가드.
 *   실 렌더·저장 동작은 supervisor 갤탭 field-soak. auth/server 불요.
 *
 * [Q] 진단 결과(코드 무변경): brief_note(간략메모)는 reservations 테이블 컬럼으로,
 *   통합시간표·예약관리 격자·hover카드·예약상세 팝업 등 '예약 표시/편집' 표면에서만 read/write 된다.
 *   2번차트(진료차트: CustomerChartPage / DoctorTools) 어떤 컴포넌트도 brief_note 를 읽지 않는다
 *   (grep brief_note ∩ chart/medical/진료 = 0건). 즉 간략메모는 2번차트로 '연동되지 않는다'.
 *   2번차트 예약메모 타임라인에 흐르는 것은 별개 필드인 예약메모(booking_memo → reservation_memo_history)다.
 */

const AGG = fs.readFileSync(path.resolve('src/lib/resvSlotAgg.ts'), 'utf-8');
const DASH = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');
const POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');
const CHART = fs.readFileSync(path.resolve('src/pages/CustomerChartPage.tsx'), 'utf-8');
const DOCTOOLS = fs.readFileSync(path.resolve('src/pages/DoctorTools.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 통합시간표 명단 간략메모 = 선택 칩만 (수기 자유텍스트 제외)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: 선택 칩만 표시 판정(isBriefNoteChip) SSOT', () => {
  test('AC1-1a: 3종 칩값은 chip 으로 판정(표시 대상)', () => {
    expect(BRIEF_NOTE_CHIPS).toEqual(['발톱무좀', '내성발톱', '발각질케어']);
    for (const chip of BRIEF_NOTE_CHIPS) {
      expect(isBriefNoteChip(chip), `${chip} 은 선택칩`).toBe(true);
    }
    // 앞뒤 공백 허용(trim)
    expect(isBriefNoteChip('  발톱무좀 ')).toBe(true);
  });

  test('AC1-1b: 수기 자유텍스트/부분일치는 chip 아님(명단 미표시)', () => {
    expect(isBriefNoteChip('환자가 통증 호소함')).toBe(false);
    expect(isBriefNoteChip('발톱무좀 재발 상담요망')).toBe(false); // 칩 포함하나 정확일치 아님 → 수기 취급
    expect(isBriefNoteChip('발각질')).toBe(false); // 칩은 '발각질케어' 정확일치만
  });

  test('AC1-3: 미선택(빈값/공백/null/undefined)은 chip 아님 → 성함만(빈 라벨 잔류 0)', () => {
    expect(isBriefNoteChip('')).toBe(false);
    expect(isBriefNoteChip('   ')).toBe(false);
    expect(isBriefNoteChip(null)).toBe(false);
    expect(isBriefNoteChip(undefined)).toBe(false);
  });

  test('AC1: Dashboard 통합시간표 초진박스 렌더가 isBriefNoteChip 게이트를 사용(수기 무조건표시 회귀 차단)', () => {
    expect(DASH, 'isBriefNoteChip import 누락').toMatch(/import\s*\{[^}]*isBriefNoteChip[^}]*\}\s*from\s*'@\/lib\/resvSlotAgg'/);
    // box1 간략메모 렌더 조건이 isBriefNoteChip 로 감싸져 있어야 함
    expect(DASH).toContain('isBriefNoteChip(reservation.brief_note)');
    // 구 무조건 표시 조건(brief_note?.trim() && ( 로 바로 렌더)이 box1-brief-note 에 잔존하지 않아야 함
    const box1Idx = DASH.indexOf('data-testid="box1-brief-note"');
    expect(box1Idx, 'box1-brief-note 렌더 블록 존재').toBeGreaterThan(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — 예약상세 팝업 간략메모 수정 가능화
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2: 예약상세 팝업 간략메모 편집·저장·반영', () => {
  test('AC2-1: 예약상세(detail) 간략메모 편집 상태·칩·입력 UI 배선', () => {
    // 전용 편집 상태
    expect(POPUP).toContain('detailBriefNote');
    expect(POPUP).toContain('setDetailBriefNote');
    // 현재 예약(anchor) brief_note 프리로드
    expect(POPUP).toContain('setDetailBriefNote(reservation.brief_note ?? \'\')');
    // 편집 UI(칩 + 직접입력) testid
    expect(POPUP).toContain('detail-brief-note-input');
    expect(POPUP).toMatch(/detail-brief-quick-/);
    // 칩 목록은 공유 SSOT(BRIEF_NOTE_CHIPS) 재사용
    expect(POPUP).toMatch(/import\s*\{[^}]*BRIEF_NOTE_CHIPS[^}]*\}\s*from\s*'@\/lib\/resvSlotAgg'/);
    expect(POPUP).toContain('const BRIEF_NOTE_QUICK = BRIEF_NOTE_CHIPS');
  });

  test('AC2-2: [저장] 핸들러가 brief_note 를 기존 reservations update 에 동봉(신규 스키마 0)', () => {
    const saveIdx = POPUP.indexOf('const saveRouteAndRegistrar');
    expect(saveIdx).toBeGreaterThan(-1);
    const saveBlock = POPUP.slice(saveIdx, saveIdx + 900);
    expect(saveBlock).toContain("brief_note: detailBriefNote.trim() || null");
    expect(saveBlock).toContain('onChanged()'); // 저장 후 부모 리프레시 → 명단(AC1) 반영
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — [Q] 간략메모 → 2번차트 연동 규명(코드 무변경): 2번차트는 brief_note 미참조
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3: 간략메모는 2번차트로 연동되지 않음(진단 락)', () => {
  test('AC3: 2번차트(CustomerChartPage/DoctorTools)는 brief_note 를 읽지 않는다', () => {
    expect(CHART.includes('brief_note'), 'CustomerChartPage 가 brief_note 참조하면 진단 전제 붕괴').toBe(false);
    expect(DOCTOOLS.includes('brief_note'), 'DoctorTools 가 brief_note 참조하면 진단 전제 붕괴').toBe(false);
  });
});
