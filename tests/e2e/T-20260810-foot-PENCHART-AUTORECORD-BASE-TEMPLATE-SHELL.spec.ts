import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  seedEditableRows,
  resolveEffectiveRows,
  isAutoVisitLogEligible,
  buildAutoVisitLogPrintHtml,
  maskRrnForPrint,
  PENCHART_AUTO_VISIT_LOG_FORM_KEY,
  type AutoVisitLogPackage,
  type AutoVisitLogSession,
  type EditableVisitLogRow,
} from '../../src/lib/autoVisitLog';

/**
 * T-20260810-foot-PENCHART-AUTORECORD-BASE-TEMPLATE-SHELL
 * 펜차트(자동기록용) 렌더 정정 — 별도 새 양식(emerald standalone form) → 기존 [펜차트양식] 기본 틀(neutral white-card) 재사용.
 *
 * 계보: T-20260808-...-2CHART(별도탭·RO) → T-20260809-...-EDITABLE-INCHARTFORM-REWORK(수정/저장/출력 신설·emerald 박스)
 *       → 본건(김주연 총괄 정정: emerald '별도양식' chrome → [펜차트양식] 기본 틀 재프레임).
 *
 * AC-1 탭 열면 기존 [펜차트양식]과 동일 기본 틀(neutral white-card) 표시(별도 새 양식 아님).
 * AC-2 방문일별 치료내용이 그 틀 안에 내용으로 쌓임.
 * AC-3 별도 새 양식·별도 화면 분리 렌더 부재(emerald standalone chrome 제거).
 * AC-4 (회귀가드) 손글씨 펜차트 펜/지우개/화이트아웃/사진첨부 + parent REWORK 수정/저장/출력 무회귀. RRN 마스킹 계승.
 * AC-5 (dev 선판정) = (a) FE-only. db_change=false. 저장 바인딩(form_key overlay) 무변경 → DA CONSULT 불요.
 *
 * ★핵심 불변식: 렌더 프레임만 정정. persistence(form_submissions.field_data overlay, form_key='penchart_auto_visit_log',
 *   parent REWORK DA GO)는 무변경 — 자동기록을 [펜차트양식]의 form_submissions 레코드에 write/merge 하지 않는다(AC-5-a).
 */

const PKG_12: AutoVisitLogPackage = { id: 'pkg-12', total_sessions: 12 };
function sess(
  p: Partial<AutoVisitLogSession> & Pick<AutoVisitLogSession, 'package_id' | 'session_date'>,
): AutoVisitLogSession {
  return { status: 'used', staff_name: null, ...p };
}

const BOX = fs.readFileSync(path.resolve('src/components/EditableAutoVisitLogBox.tsx'), 'utf-8');
const CHART_PAGE = fs.readFileSync(path.resolve('src/pages/CustomerChartPage.tsx'), 'utf-8');
const PEN_LIST_FRAME = 'rounded-lg border bg-white p-3'; // [펜차트양식] 목록/작성 base frame (PenChartTab)

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 / AC-3 : [펜차트양식] 기본 틀 재사용 · 별도 emerald 양식 chrome 부재
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-1/AC-3 base-frame 재사용 (별도양식 렌더 제거)', () => {
  test('AC-1: 자동기록 컨테이너 = [펜차트양식]과 동일 neutral white-card 기본 틀', () => {
    // 대상/비대상/eligible 3분기 컨테이너 모두 base frame class 사용.
    const boxDivs = BOX.match(/data-testid="penchart-auto-visit-log-box"[\s\S]{0,80}/g) ?? [];
    expect(boxDivs.length).toBeGreaterThan(0);
    expect(BOX).toContain(PEN_LIST_FRAME);
  });

  test('AC-3: emerald standalone-form chrome 부재(별도 새 양식 렌더 제거)', () => {
    expect(BOX).not.toMatch(/border-emerald|bg-emerald|text-emerald|border-2 border-emerald/);
    // border-2(별도 강조 테두리)로 별도양식처럼 튀지 않음 — 기본 틀 border 사용.
    expect(BOX).not.toMatch(/border-2/);
  });

  test('AC-1: 표준 차트헤더(성명·차트번호·주민번호) — [펜차트양식] identity 계승', () => {
    expect(BOX).toContain('penchart-auto-visit-log-header');
    expect(BOX).toContain('성명:');
    expect(BOX).toContain('차트번호:');
    expect(BOX).toContain('주민등록번호:');
    // VG4: 헤더는 마스킹 RRN 사용(raw 미노출)
    expect(BOX).toContain('maskRrnForPrint(customerRrn)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 : 방문일별 치료내용이 틀 안에 누적(단일 히스토리 테이블에 행 쌓임)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-2 방문행 누적', () => {
  test('다중 방문일 → 같은 틀 안에서 최신순 누적(새 캔버스 분기 없음)', () => {
    const rows = seedEditableRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-03', staff_name: '임별' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-08', staff_name: '혜인' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-05', staff_name: '지민' }),
      ],
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.date)).toEqual(['2026-08-08', '2026-08-05', '2026-08-03']); // 최신순 누적
  });

  test('방문 0건 → 빈 틀(자동기록 행 없음), 별도 form 생성 없음', () => {
    expect(isAutoVisitLogEligible([PKG_12], [])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 회귀가드 — parent REWORK 수정/저장/출력 능력 + VG 유지
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-4 회귀가드 (parent REWORK 능력 무회귀)', () => {
  test('수정·저장·출력·행추가 UI 유지', () => {
    for (const id of [
      'penchart-auto-visit-log-save',
      'penchart-auto-visit-log-print',
      'penchart-auto-visit-log-addrow',
      'penchart-auto-visit-log-delrow',
    ]) {
      expect(BOX).toContain(id);
    }
  });

  test('AC-5-a 저장 바인딩 무변경: form_submissions.field_data overlay + form_key(신규 테이블/컬럼 0)', () => {
    expect(PENCHART_AUTO_VISIT_LOG_FORM_KEY).toBe('penchart_auto_visit_log');
    expect(BOX).toContain("from('form_submissions')");
    expect(BOX).toContain('template_id: null');
    // [펜차트양식] pen_chart 레코드에 write/merge 하지 않음(별도 슬롯 유지 = AC-5-a).
    expect(BOX).not.toMatch(/template_id:\s*penChart|form_key:\s*'pen_chart'/);
  });

  test('VG1: package_sessions/packages ledger write-back 0', () => {
    expect(BOX).not.toMatch(/\.update\(|\.upsert\(/);
    expect(BOX).not.toMatch(/(packages|package_sessions)[\s\S]{0,40}\.(insert|update|upsert)/);
  });

  test('VG3: insert 후 rows-affected 검증(0행 성공 오인 차단)', () => {
    expect(BOX).toContain(".select('id')");
    expect(BOX).toMatch(/data\.length === 0/);
  });

  test('VG4: raw RRN 을 field_data 에 저장하지 않음', () => {
    const fdBlock = BOX.slice(BOX.indexOf('PenchartAutoVisitLogFieldData = {'), BOX.indexOf('.insert('));
    expect(fdBlock).not.toMatch(/\brrn\s*:/i);
    expect(fdBlock).not.toMatch(/customerRrn/);
    expect(fdBlock).not.toMatch(/resident|주민등록/i);
  });

  test('VG2 reader: overlay 우선 / 부재 seed', () => {
    const seed: EditableVisitLogRow[] = [
      { key: 'k1', date: '2026-08-03', packageContent: '12회', todayCount: '12-1', therapists: '임별', note: '' },
    ];
    const overlay: EditableVisitLogRow[] = [
      { key: 'k1', date: '2026-08-03', packageContent: '12회', todayCount: '12-1', therapists: '임별', note: '급여' },
    ];
    expect(resolveEffectiveRows(overlay, seed)).toBe(overlay);
    expect(resolveEffectiveRows(null, seed)).toBe(seed);
  });

  test('출력물 RRN 마스킹 계승(raw 자릿수 미노출)', () => {
    const RRN_FRONT = '900101';
    const RRN_BACK = '1234567';
    const SYNTH_RRN = `${RRN_FRONT}-${RRN_BACK}`;
    expect(maskRrnForPrint(SYNTH_RRN)).not.toMatch(/\d/);
    const html = buildAutoVisitLogPrintHtml({
      customerName: '김나혜',
      chartNumber: 'F-5486',
      rrn: SYNTH_RRN,
      genderLabel: '여',
      rows: [{ key: 'k', date: '2026-08-03', packageContent: '12회', todayCount: '12-1', therapists: '임별', note: '급여' }],
      printedAt: '2026.08.10 11:48',
    });
    expect(html).not.toContain(RRN_BACK);
    expect(html).toContain('●●●●●●-●●●●●●●');
    expect(html).toContain('(여)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 손글씨 펜차트 무접촉 — PenChartTab 형제 마운트 유지, 캔버스 미접촉
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-4 손글씨 펜차트(PenChartTab) 무접촉', () => {
  test('pen_chart 탭 내 PenChartTab + EditableAutoVisitLogBox 형제 렌더 유지', () => {
    expect(CHART_PAGE).toMatch(/chartTab === 'pen_chart'/);
    const penBlock = CHART_PAGE.slice(CHART_PAGE.indexOf("chartTab === 'pen_chart'"), CHART_PAGE.indexOf("chartTab === 'pen_chart'") + 2500);
    expect(penBlock).toContain('<PenChartTab');
    expect(penBlock).toContain('<EditableAutoVisitLogBox');
  });

  test('본건은 EditableAutoVisitLogBox 렌더 프레임만 변경 — PenChartTab(손글씨 캔버스) import·마운트 무접촉', () => {
    expect(CHART_PAGE).toContain("import { PenChartTab } from '@/components/PenChartTab'");
  });
});
