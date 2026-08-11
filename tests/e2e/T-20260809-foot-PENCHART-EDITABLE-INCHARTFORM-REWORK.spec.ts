import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  buildAutoVisitLogRows,
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
 * T-20260809-foot-PENCHART-EDITABLE-INCHARTFORM-REWORK
 * 펜차트(자동기록용) 재작업 — 별도 탭 → 새 차트 작성 양식 내부 초록박스 + READ-ONLY → 수정·저장·출력.
 *
 * 저장방식(DA-REPLY GO MSG-20260809-094535-db57): form_submissions.field_data JSONB 재사용(신규 테이블/컬럼 0).
 *
 * AC-1 위치: 별도 탭 폐지 → 펜차트 새 차트 작성 양식 내부 배치.
 * AC-2 포맷: 초록박스 [ 펜차트(자동기록용) ].
 * AC-3 기능: 수정·저장·출력 가능(persist·재진입 유지·print).
 * AC-4 대상: 1회권 이상 패키지 생성 후 치료 진행 환자만.
 * AC-5 자동 차팅 유지(편집 가능 전환).
 * AC-6 출력물 RRN 마스킹.
 * AC-7 손글씨 펜차트(PenChartTab) 무손상.
 *
 * HARD verify-gate(DA):
 *  VG1 overlay ONLY(ledger write-back 0) · VG2 overlay 우선/부재 seed · VG3 form_key insert 누적 + rows-affected 검증
 *  VG4 raw RRN 미저장 + print 마스킹 · VG5 note(급여/비급여)=문서 표시 전용.
 */

// ── 픽스처 ───────────────────────────────────────────────────────────────
const PKG_12: AutoVisitLogPackage = { id: 'pkg-12', total_sessions: 12 };
function sess(
  p: Partial<AutoVisitLogSession> & Pick<AutoVisitLogSession, 'package_id' | 'session_date'>,
): AutoVisitLogSession {
  return { status: 'used', staff_name: null, ...p };
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-5 (자동 차팅 유지) — seed 는 buildAutoVisitLogRows 계승
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-5 자동 차팅 유지 — seed', () => {
  test('seedEditableRows = 자동집계 4열 + 편집용 note 공란', () => {
    const rows = seedEditableRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-08', staff_name: '혜인' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-05', staff_name: '지민' }),
      ],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBe('2026-08-08'); // 최신순 유지
    expect(rows[0].packageContent).toBe('12회');
    // TODAYCOUNT-CUMULATIVE-FIX(T-20260811): 첫 숫자 = 그날 기준 잔여(누적차감).
    //   2026-08-05 차감 1 후 진입한 2026-08-08 은 잔여 11 → '11-1'(구버그 '12-1' 아님).
    expect(rows[0].todayCount).toBe('11-1');
    expect(rows[0].therapists).toBe('혜인');
    // 더 이른 방문(2026-08-05)은 당일 시작 시점 잔여 12 → '12-1'.
    expect(rows[1].date).toBe('2026-08-05');
    expect(rows[1].todayCount).toBe('12-1');
    for (const r of rows) expect(r.note).toBe('');
  });

  test('취소/환불(status!=used) 회차 제외 — seed 계승', () => {
    const rows = seedEditableRows(
      [PKG_12],
      [
        sess({ package_id: 'pkg-12', session_date: '2026-08-08', status: 'used' }),
        sess({ package_id: 'pkg-12', session_date: '2026-08-08', status: 'cancelled' }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].todayCount).toBe('12-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 (대상) — 1회권 이상 패키지 + 치료 진행 환자만
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-4 대상 판정 (isAutoVisitLogEligible)', () => {
  test('패키지 + 치료(used) 있으면 대상', () => {
    expect(
      isAutoVisitLogEligible([PKG_12], [sess({ package_id: 'pkg-12', session_date: '2026-08-08' })]),
    ).toBe(true);
  });
  test('패키지 없으면 비대상', () => {
    expect(isAutoVisitLogEligible([], [sess({ package_id: 'x', session_date: '2026-08-08' })])).toBe(false);
  });
  test('패키지는 있으나 치료(used) 회차 0 이면 비대상', () => {
    expect(
      isAutoVisitLogEligible([PKG_12], [sess({ package_id: 'pkg-12', session_date: '2026-08-08', status: 'cancelled' })]),
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VG2 (reader) — overlay 우선 / 부재 시 seed
// ═══════════════════════════════════════════════════════════════════════════
test.describe('VG2 resolveEffectiveRows', () => {
  const seed: EditableVisitLogRow[] = [
    { key: 'k1', date: '2026-08-08', packageContent: '12회', todayCount: '12-1', therapists: '혜인', note: '' },
  ];
  const overlay: EditableVisitLogRow[] = [
    { key: 'k1', date: '2026-08-08', packageContent: '12회(수정)', todayCount: '12-1', therapists: '혜인', note: '비급여' },
  ];
  test('overlay 존재 → overlay 우선', () => {
    expect(resolveEffectiveRows(overlay, seed)).toBe(overlay);
  });
  test('overlay 부재(null) → seed', () => {
    expect(resolveEffectiveRows(null, seed)).toBe(seed);
  });
  test('overlay 빈 배열(의도적 비움)도 편집본으로 채택', () => {
    expect(resolveEffectiveRows([], seed)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// VG4 (PHI) — print-time RRN 마스킹 + raw 자릿수 미노출
// ═══════════════════════════════════════════════════════════════════════════
test.describe('VG4 print 마스킹', () => {
  const rows: EditableVisitLogRow[] = [
    { key: 'k1', date: '2026-08-08', packageContent: '12회', todayCount: '12-1', therapists: '혜인', note: '급여' },
  ];
  // 합성 RRN — 실환자 아님. §4.3/§4 PHI 규율: 소스에 RRN-shape(\d{6}-\d{7}) 리터럴을 두지 않도록
  //   앞/뒷자리 조각을 런타임 조립한다(조각 단독은 RRN 패턴 미매치). 마스킹 검증 목적의 픽스처.
  const RRN_FRONT = '900101';
  const RRN_BACK = '1234567';
  const SYNTH_RRN = `${RRN_FRONT}-${RRN_BACK}`;
  test('maskRrnForPrint — 실 RRN 자릿수 미노출', () => {
    expect(maskRrnForPrint(SYNTH_RRN)).not.toMatch(/\d/);
    expect(maskRrnForPrint(SYNTH_RRN)).toBe('●●●●●●-●●●●●●●');
    expect(maskRrnForPrint(null)).toBe('●●●●●●-●●●●●●●');
  });
  test('출력 HTML 에 raw RRN 자릿수 미포함(마스킹만) + 성별 파생 표시', () => {
    const html = buildAutoVisitLogPrintHtml({
      customerName: '홍길동',
      chartNumber: '10023',
      rrn: SYNTH_RRN,
      genderLabel: '남',
      rows,
      printedAt: '2026.08.09 10:00',
    });
    expect(html).not.toContain(RRN_BACK); // raw 뒷자리 미노출
    expect(html).not.toContain(SYNTH_RRN);
    expect(html).toContain('●●●●●●-●●●●●●●'); // 마스킹 placeholder
    expect(html).toContain('홍길동');
    expect(html).toContain('(남)');
    expect(html).toContain('급여'); // note 표시(VG5)
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 소스 가드 — AC-1 위치(별도탭 폐지·양식 내부) · AC-7 손글씨 펜차트 무손상 · VG1/VG3 write 규율
// ═══════════════════════════════════════════════════════════════════════════
const CHART_PAGE = fs.readFileSync(path.resolve('src/pages/CustomerChartPage.tsx'), 'utf-8');
const BOX = fs.readFileSync(path.resolve('src/components/EditableAutoVisitLogBox.tsx'), 'utf-8');

test.describe('소스 가드', () => {
  test('AC-1: auto_visit_log 별도 탭 폐지 — CLINICAL_TABS/IMPLEMENTED 에서 제거', () => {
    expect(CHART_PAGE).not.toMatch(/key:\s*'auto_visit_log'/);
    expect(CHART_PAGE).not.toMatch(/chartTab === 'auto_visit_log'/);
    expect(CHART_PAGE).not.toMatch(/IMPLEMENTED_CLINICAL\s*=\s*\[[^\]]*'auto_visit_log'/);
  });

  test('AC-1: EditableAutoVisitLogBox 가 pen_chart 탭(새 차트 작성 양식) 내부에 마운트', () => {
    expect(CHART_PAGE).toMatch(/chartTab === 'pen_chart'/);
    expect(CHART_PAGE).toMatch(/<EditableAutoVisitLogBox/);
    // pen_chart 블록 안에서 PenChartTab 과 형제로 함께 렌더(양식 내부 배치)
    const penBlock = CHART_PAGE.slice(CHART_PAGE.indexOf("chartTab === 'pen_chart'"));
    expect(penBlock.slice(0, 2000)).toContain('<EditableAutoVisitLogBox');
    expect(penBlock.slice(0, 2000)).toContain('<PenChartTab');
  });

  // AC-2(포맷) SUPERSEDED by T-20260810-foot-PENCHART-AUTORECORD-BASE-TEMPLATE-SHELL:
  //   김주연 총괄 정정 = emerald '별도양식' chrome → [펜차트양식] 기본 틀(neutral white-card) 재프레임.
  //   라벨은 유지, emerald 단정은 폐기(신 base-frame spec 이 권위).
  test('AC-2: 라벨 유지 (포맷은 후속 티켓이 base-frame 으로 supersede)', () => {
    expect(BOX).toContain('펜차트(자동기록용)');
  });

  test('AC-3: 수정·저장·출력 UI (save/print/addrow testid)', () => {
    expect(BOX).toContain('penchart-auto-visit-log-save');
    expect(BOX).toContain('penchart-auto-visit-log-print');
    expect(BOX).toContain('penchart-auto-visit-log-addrow');
  });

  test('저장방식: form_submissions.field_data 재사용 + form_key(신규 테이블/컬럼 0)', () => {
    expect(PENCHART_AUTO_VISIT_LOG_FORM_KEY).toBe('penchart_auto_visit_log');
    expect(BOX).toContain("from('form_submissions')");
    expect(BOX).toContain('template_id: null');
    // 신규 테이블 write 금지(overlay ONLY = form_submissions 만)
    expect(BOX).not.toMatch(/from\('package_sessions'\)|from\('packages'\)/);
  });

  test('VG1: package_sessions/packages ledger write-back 0 (insert/update/upsert 없음)', () => {
    expect(BOX).not.toMatch(/\.update\(|\.upsert\(/); // overlay 는 insert 누적만
    // packages/package_sessions 로의 write 경로 부재
    expect(BOX).not.toMatch(/(packages|package_sessions)[\s\S]{0,40}\.(insert|update|upsert)/);
  });

  test('VG3: insert 후 rows-affected 검증(0행 성공 오인 차단)', () => {
    expect(BOX).toContain(".select('id')");
    expect(BOX).toMatch(/data\.length === 0/);
  });

  test('VG4: raw RRN 을 field_data 에 저장하지 않음(fieldData 에 rrn 키 부재)', () => {
    // field_data 스냅샷 정의 블록에 rrn/주민 '필드 할당'이 없어야 함(주석의 'RRN' 언급은 허용).
    const fdBlock = BOX.slice(BOX.indexOf('PenchartAutoVisitLogFieldData = {'), BOX.indexOf('.insert('));
    expect(fdBlock).not.toMatch(/\brrn\s*:/i);       // rrn: 할당 없음
    expect(fdBlock).not.toMatch(/customerRrn/);       // prop 을 field_data 로 흘리지 않음
    expect(fdBlock).not.toMatch(/resident|주민등록/i);
  });

  test('AC-7: PenChartTab 무접촉(여전히 import·마운트 유지)', () => {
    expect(CHART_PAGE).toContain("import { PenChartTab } from '@/components/PenChartTab'");
    expect(CHART_PAGE).toContain('<PenChartTab');
  });
});
