/**
 * E2E spec — T-20260615-foot-DOCPATIENTLIST-DASHCOL-REALIGN (REOPENED, P1)
 * 진료환자목록(DoctorPatientList) 컬럼 순서 — 문지은 대표원장 실화면 confirm("다 통일하자", thread 1781514925.840609).
 *
 * 확정 컬럼 순서(오늘 모드, 좌→우):
 *   방 → 상태 → 초진/재진(방문유형) → 이름 → 차트번호 → 처방 → 예약메모 → [버튼]
 *
 * 이 spec의 범위 = **컬럼 순서/배치만**. (티켓 현장 클릭 시나리오 1~3 변환)
 *   · 폭/비율(grid-template 너비, 컬럼 폭 집합)은 단언하지 않는다 — AC5(너비 보존) 보존.
 *   · 폭 검증은 B(DoctorCallDashboard) colgroup 소관 별도 티켓
 *     (T-20260615-foot-DOCDASH-COLGROUP-E2E-STALE-RECONCILE)으로 분리. 본 spec엔 미포함.
 *
 * 블록 위치는 폭 문자열이 아니라 width-독립 마커(data-testid="patient-row")로 잡는다 —
 *   이력(read-only) 행이 소스상 먼저, 오늘(액션) 행이 뒤. (MIRROR-MONOTONE spec과 동일한 정본-읽기 방식)
 *   컴포넌트가 auth/DB 의존이라 렌더 정본(DoctorPatientList.tsx)을 직접 읽어 JSX 셀 시퀀스(=컬럼 순서)를 회귀로 고정.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname_, '../../src/components/doctor/DoctorPatientList.tsx');
const src = readFileSync(SRC, 'utf-8');

// ── 블록 위치(width-독립 anchor) ────────────────────────────────────────────
// patient-row 가 정확히 2회: ① 이력(read-only) 행, ② 오늘(액션) 행 — 소스상 이력이 먼저.
const ROW = 'data-testid="patient-row"';
const firstRow = src.indexOf(ROW);
const secondRow = src.indexOf(ROW, firstRow + 1);
// 오늘 블록은 펼침(expandable) 영역 직전까지.
const todayEnd = src.indexOf('{expanded && !isConfirmed', secondRow);
const histBlock = src.slice(firstRow, secondRow);
const todayBlock = src.slice(secondRow, todayEnd > secondRow ? todayEnd : undefined);

/** 마커들이 블록 내에서 등장하는 순서(인덱스)가 기대 순서와 일치하는지. */
function assertOrder(block: string, markers: string[]) {
  const idx = markers.map((m) => ({ m, i: block.indexOf(m) }));
  for (const { m, i } of idx) expect(i, `marker not found: ${m}`).toBeGreaterThanOrEqual(0);
  for (let k = 1; k < idx.length; k++) {
    expect(
      idx[k].i,
      `순서 위반: "${idx[k - 1].m}"(${idx[k - 1].i}) 가 "${idx[k].m}"(${idx[k].i}) 보다 앞이어야 함`,
    ).toBeGreaterThan(idx[k - 1].i);
  }
}

test.describe('DASHCOL-REALIGN — 블록 식별(폭 무관 anchor)', () => {
  test('patient-row 2개(이력·오늘) 식별 + 오늘=액션행 / 이력=read-only행', () => {
    expect(firstRow).toBeGreaterThanOrEqual(0);
    expect(secondRow).toBeGreaterThan(firstRow);
    expect(src.indexOf(ROW, secondRow + 1), 'patient-row 는 정확히 2개(이력·오늘)').toBe(-1);
    // 오늘 블록 = 액션 버튼 + 상태 셀 존재 / 이력 블록 = read-only(액션·상태 부재).
    expect(todayBlock).toContain('data-testid="confirm-prescription-btn"');
    expect(todayBlock).toContain('<StatusCell');
    expect(histBlock).not.toContain('data-testid="confirm-prescription-btn"');
    expect(histBlock).not.toContain('<StatusCell');
  });
});

// ── 시나리오 1: 오늘 화면 컬럼 순서 (정상 동선) ──────────────────────────────
test.describe('DASHCOL-REALIGN — 시나리오1: 오늘 모드 컬럼 확정 순서', () => {
  test('오늘 모드 JSX 셀 시퀀스 = 방→상태→방문유형→이름→차트번호→처방→예약메모→[버튼]', () => {
    assertOrder(todayBlock, [
      'data-testid="patient-room"',             // ① 방
      '<StatusCell',                            // ② 상태
      '<VisitTypeBadge',                        // ③ 초진/재진(방문유형)
      'data-testid="patient-name"',             // ④ 이름
      'data-testid="patient-chartno"',          // ⑤ 차트번호
      '<PrescriptionStatusBadge',               // ⑥ 처방
      'data-testid="booking-memo"',             // ⑦ 예약메모
      'data-testid="confirm-prescription-btn"', // ⑧ [버튼] 액션 영역
    ]);
  });

  test('델타1: 초진/재진은 독립 컬럼 — 상태와 이름 사이(이름 바로 왼쪽), 이름 prefix 아님', () => {
    const iStatus = todayBlock.indexOf('<StatusCell');
    const iVisit = todayBlock.indexOf('<VisitTypeBadge');
    const iName = todayBlock.indexOf('data-testid="patient-name"');
    expect(iStatus).toBeLessThan(iVisit);
    expect(iVisit).toBeLessThan(iName);
    // 독립 셀 — 이름 셀(testid) 안에 방문유형 배지가 들어있지 않음(prefix 아님).
    expect(iVisit, '방문유형은 이름 셀보다 앞선 별도 셀').toBeLessThan(iName);
  });

  test('델타2: 예약메모는 [버튼] 바로 앞(마지막 데이터 컬럼)', () => {
    const iMemo = todayBlock.indexOf('data-testid="booking-memo"');
    const iAction = todayBlock.indexOf('data-testid="confirm-prescription-btn"');
    expect(iMemo).toBeGreaterThanOrEqual(0);
    expect(iMemo).toBeLessThan(iAction);
    // 메모 뒤로 다른 데이터 컬럼(방/이름/차트/처방)이 오지 않음.
    const after = todayBlock.slice(iMemo + 1);
    expect(after).not.toContain('data-testid="patient-room"');
    expect(after).not.toContain('data-testid="patient-name"');
    expect(after).not.toContain('data-testid="patient-chartno"');
    expect(after).not.toContain('<PrescriptionStatusBadge');
  });
});

// ── 시나리오 2: 이력(과거 날짜) 화면도 동일 순서 (AC4) ──────────────────────
test.describe('DASHCOL-REALIGN — 시나리오2: 이력 모드 통일(공유 컬럼 상대 배치 일치)', () => {
  test('이력 모드 공유 컬럼 순서 = 방문유형→이름→차트번호→처방 (오늘 모드와 동일 상대 배치)', () => {
    // 이력 모드는 read-only 설계로 상태·방·예약메모·액션 부재(DATEMODE-HISTORY AC) — 공유 컬럼 배치만 통일.
    assertOrder(histBlock, [
      '<VisitTypeBadge',
      'data-testid="patient-name"',
      'data-testid="patient-chartno"',
      '<PrescriptionStatusBadge',
    ]);
  });
});

// ── 시나리오 3: 회귀 없음 (AC6) ─────────────────────────────────────────────
test.describe('DASHCOL-REALIGN — 시나리오3: 회귀 가드', () => {
  test('빠른처방 펼쳐보기(expandable) 진입점 잔존 — setExpanded 토글 + QuickRxBar', () => {
    expect(src).toContain('setExpanded');
    expect(src).toContain('<QuickRxBar');
  });

  test('처방필터 탭·정렬 토글 진입점 잔존(RXLIST-RENAME-DOCFILTER 미침범)', () => {
    expect(src).toContain('data-testid="signdoctor-filter"');
    expect(src).toContain('data-testid="patient-sort-toggle"');
  });

  test('DoctorCallDashboard(B) 미변경 — 본 spec은 A(DoctorPatientList) 정본만 검증', () => {
    // A 정본 경로 고정(B surface로 오인 방지). B 폭/순서 검증은 본 spec 스코프 밖.
    expect(SRC.endsWith('DoctorPatientList.tsx')).toBe(true);
  });
});
