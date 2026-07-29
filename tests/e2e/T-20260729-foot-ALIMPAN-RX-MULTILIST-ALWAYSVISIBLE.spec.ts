/**
 * E2E spec — T-20260729-foot-ALIMPAN-RX-MULTILIST-ALWAYSVISIBLE
 * 진료 알림판(DoctorCallDashboard 상시뷰) 소견서·진단서 '처리대기'/'서류 완료' 테이블 —
 *   '처방내역' 컬럼 한정: 당일 처방약 (1) 전건 나열 + (2) hover/클릭 없이 상시 표기.
 *   (현장 종로풋센터 2026-07-29 field-soak · 김주연 총괄 U0ATDB587PV · thread 1785293193.209349)
 *   parent: T-20260729-foot-JINRYO-ALIMPAN-3COL-DATA-CONNECT (995efb0d) 직후 refinement.
 *
 * feasibility 진단(diagnose-first) 결론:
 *   '일부만 보임'의 원인 = (b) 표시(CSS truncate + 클릭 ColumnExpandPopover 드롭다운) — 데이터 포집(a) 아님.
 *   useQueueTodayProcedureRx 는 이미 당일 처방약 '전건'을 today.prescriptions[] 배열로 모으고
 *   (extractRxDrugNames push(...) 전체), 셀은 rx = today.prescriptions.join(', ') 로 전건을 join.
 *   → 데이터·쿼리·스키마 무변경. read-only 표시 refinement (db_change=false, no-DDL).
 *
 * FIX(표시 전용):
 *   AC-1 전건 나열 — rx = today.prescriptions.join(', ') 유지(전 항목).
 *   AC-2 상시 표기 — 처방내역 셀에서 truncate·onClick·ColumnExpandPopover(docreq-rx-expand-pop) 제거,
 *                    whitespace-normal break-words 로 셀 안에서 줄바꿈 wrap 전체 노출.
 *   AC-3 없으면 '—' 유지.
 *   스코프: 처방내역 셀만. 오늘시술(truncate+title 미리보기)·임상경과(클릭 드롭다운) 무접촉(parent 3COL 회귀 방지).
 *
 * 검증 방식(§dev-foot): 현장 계정 PHI → 인증 우회 불가. 정적 코드 구조 검증 + 앱 로드(HTTP 200) + 회귀 가드.
 *   실브라우저 클릭 시나리오는 하단 체크리스트(갤탭 실기기 현장 confirm 대상 — green build·spec PASS 는 종결 근거 아님).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const queue = () => read('src/components/doctor/DocRequestQueue.tsx');

// 처방내역 셀(<td data-testid="docreq-cell-rx"> ... </td>) 블록만 잘라 검증 — 다른 셀 오탐 방지.
function rxCellBlock(): string {
  const q = queue();
  const anchor = q.indexOf('data-testid="docreq-cell-rx"');
  expect(anchor).toBeGreaterThan(-1);
  // 셀을 여는 <td 시작 ~ 이어지는 </td> 까지.
  const tdOpen = q.lastIndexOf('<td', anchor);
  const tdClose = q.indexOf('</td>', anchor);
  return q.slice(tdOpen, tdClose + 5);
}

test.describe('T-20260729-foot-ALIMPAN-RX-MULTILIST-ALWAYSVISIBLE — 처방내역 전건 나열 + 상시 표기', () => {

  // 회귀 가드: 앱 정상 로드
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1: 전건 나열 ────────────────────────────────────────────────────────────
  test('AC-1: 처방내역 = 당일 처방약 전건 나열(today.prescriptions join, 첫건/일부 아님)', () => {
    const q = queue();
    // 데이터는 전건 배열을 join — parent SSOT 계승(포집 무변경).
    expect(q).toMatch(/const rx = today\.prescriptions[\s\S]*?join\(', '\)/);
    // 셀은 join 된 전건(rx) 을 그대로 렌더.
    const cell = rxCellBlock();
    expect(cell).toContain('{rx || \'—\'}');
  });

  // ── AC-2: 상시 표기(truncate·클릭 드롭다운 제거) ────────────────────────────────
  test('AC-2: 처방내역 셀 = truncate 제거 + wrap 상시 노출', () => {
    const cell = rxCellBlock();
    // 미리보기 truncate 제거 → 줄바꿈 wrap 으로 전건 상시 표기.
    expect(cell).not.toContain('truncate');
    expect(cell).toContain('whitespace-normal');
    expect(cell).toContain('break-words');
  });

  test('AC-2: 처방내역 셀 = 클릭 토글/앵커 제거(hover·클릭 없이 표기)', () => {
    const cell = rxCellBlock();
    // 셀 자체에 onClick·cursor-pointer·rxCellRef 없음(비인터랙티브 read-display).
    expect(cell).not.toContain('onClick');
    expect(cell).not.toContain('cursor-pointer');
    expect(cell).not.toContain('rxCellRef');
  });

  test('AC-2: 처방내역 전용 ColumnExpandPopover(docreq-rx-expand-pop) 및 expandRx state 제거', () => {
    const q = queue();
    // rx 전용 펼침 팝오버·전문 노드·state 전면 제거.
    expect(q).not.toContain('docreq-rx-expand-pop');
    expect(q).not.toContain('docreq-rx-expand');
    expect(q).not.toContain('expandRx');
    expect(q).not.toContain('setExpandRx');
    expect(q).not.toContain('rxCellRef');
  });

  // ── AC-3: 없으면 '—' ────────────────────────────────────────────────────────────
  test('AC-3: 처방약 없으면 — 유지', () => {
    const cell = rxCellBlock();
    expect(cell).toContain('\'—\'');
    expect(cell).toContain('data-testid="docreq-cell-rx"');
  });

  // ── 회귀 가드: 다른 셀·동선 무접촉(parent 3COL 회귀 방지) ──────────────────────
  test('회귀: 오늘시술·임상경과 셀 및 발행/완료 동선 무접촉', () => {
    const q = queue();
    // 오늘시술 셀 = 기존 truncate+title 미리보기 유지.
    expect(q).toContain('data-testid="docreq-cell-today-proc"');
    expect(q).toMatch(/docreq-cell-today-proc"[\s\S]*?truncate/);
    // 임상경과 셀 = 클릭 드롭다운(ColumnExpandPopover) 유지 — 처방내역만 제거.
    expect(q).toContain('data-testid="docreq-cell-clinical"');
    expect(q).toContain('docreq-clinical-expand-pop');
    expect(q).toContain('setExpandClinical');
    expect(q).toContain('clinicalCellRef');
    // 완료 그룹 발행완료 뱃지 펼침 유지.
    expect(q).toContain('docreq-done-expand-pop');
    expect(q).toContain('setExpandDone');
    // 기존 컬럼 헤더 무회귀.
    for (const col of ['이름', '생년', '차트번호', '담당 진료의', '오늘시술', '처방내역', '임상경과', '서류종류', '해당항목', '발행']) {
      expect(q).toContain(col);
    }
    // 대기+완료 두 테이블 모두 동일 row 컴포넌트(DocRequestRow) 사용 — 양쪽 적용.
    expect((q.match(/todayForRow=/g)?.length ?? 0)).toBeGreaterThanOrEqual(2);
  });
});

/**
 * ── 갤탭 실기기 현장 confirm 체크리스트(§dev-foot: green build·spec PASS 는 종결 근거 아님) ──
 * [ ] AC-1: 처방약을 2개 이상 넣은 환자 행 "처방내역"에 전건이 모두 보이는지(첫 건/일부 아님).
 * [ ] AC-2: hover·클릭 없이 셀 안에 처방내역이 항상 보이는지(드롭다운 펼침 없이).
 * [ ] AC-2: 처방약이 길어도 셀 안에서 줄바꿈되어 잘리지 않는지(truncate 없음).
 * [ ] AC-3: 처방약 없는 환자 행은 '—' 유지.
 * [ ] 회귀: 처리대기 + 서류완료 두 테이블 모두 동일 적용.
 * [ ] 회귀: 생년(만나이)·오늘시술·임상경과·담당 진료의·발행/작성하기 동선 무회귀(오늘시술/임상경과 미리보기·드롭다운 정상).
 */
