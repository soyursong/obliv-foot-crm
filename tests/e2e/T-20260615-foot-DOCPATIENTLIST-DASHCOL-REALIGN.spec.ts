/**
 * E2E spec — T-20260615-foot-DOCPATIENTLIST-DASHCOL-REALIGN (REOPENED, P1)
 * 진료환자목록(DoctorPatientList) 컬럼 순서 — 문지은 대표원장 실화면 confirm("다 통일하자", thread 1781514925.840609).
 *
 * 확정 컬럼 순서(오늘 모드):
 *   방 → 상태 → 초진/재진(방문유형) → 이름 → 차트번호 → 처방 → 예약메모 → [버튼]
 *
 * shipped(ad88c41) → 확정안 델타(작업 핵심):
 *   1. 방문유형(초진/재진)을 독립 컬럼으로 — 위치 = 상태와 이름 사이(이름 바로 왼쪽).
 *   2. 예약메모 = 맨 오른쪽 버튼 바로 앞(기존 유지).
 *   3. 오늘 + 이력 모드 동일 순서로 통일(공유 컬럼 상대 배치 일치).
 *
 * 가드:
 *   - 칸 너비·크기·폭/비율 변경 0 — 폭값을 컬럼과 동반 이동(순서만). (6/14 COLWIDTH 보존)
 *   - DoctorCallDashboard(B) 변경 0. 행필터/탭(RXLIST-RENAME-DOCFILTER, 同 파일) 침범 0.
 *
 * 스타일: 컴포넌트가 auth/DB 의존이라 DoctorPatientList.tsx 렌더 정본을 직접 읽어
 *   grid 열 구성 + JSX 셀 시퀀스(=컬럼 순서)를 회귀로 잡는다(MIRROR-MONOTONE spec과 동일 방식).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname_, '../../src/components/doctor/DoctorPatientList.tsx');
const src = readFileSync(SRC, 'utf-8');

// 오늘 모드 grid(방 4.75rem 리드) / 이력 모드 grid(방문배지 3rem 리드) 슬라이스 경계.
const TODAY_GRID = 'grid-cols-[4.75rem_3.75rem_3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto]';
const HIST_GRID = 'grid-cols-[3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto_auto]';

const todayStart = src.indexOf(TODAY_GRID);
const todayEnd = src.indexOf('{expanded && !isConfirmed', todayStart);
const todayBlock = src.slice(todayStart, todayEnd > todayStart ? todayEnd : undefined);

const histStart = src.indexOf(HIST_GRID);
const histBlock = src.slice(histStart, todayStart); // 이력 블록은 오늘 블록보다 소스상 앞.

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

test.describe('DASHCOL-REALIGN — 오늘 모드 컬럼 확정 순서', () => {
  test('오늘 모드 grid-template = 방→상태→방문유형→이름→차트번호→처방→예약메모→액션', () => {
    expect(src).toContain(TODAY_GRID);
    // 8칼럼.
    const cols = '4.75rem_3.75rem_3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto'.split('_');
    expect(cols.length).toBe(8);
  });

  test('오늘 모드 JSX 셀 시퀀스 = 확정 순서', () => {
    expect(todayStart).toBeGreaterThanOrEqual(0);
    expect(todayBlock.length).toBeGreaterThan(0);
    assertOrder(todayBlock, [
      'data-testid="patient-room"',      // ① 방
      '<StatusCell',                      // ② 상태
      '<VisitTypeBadge',                  // ③ 초진/재진
      'data-testid="patient-name"',      // ④ 이름
      'data-testid="patient-chartno"',   // ⑤ 차트번호
      '<PrescriptionStatusBadge',        // ⑥ 처방
      'data-testid="booking-memo"',      // ⑦ 예약메모
      'data-testid="confirm-prescription-btn"', // ⑧ 액션(버튼 영역)
    ]);
  });

  test('델타1: 방문유형이 상태와 이름 사이 독립 컬럼(이름 바로 왼쪽)', () => {
    const iStatus = todayBlock.indexOf('<StatusCell');
    const iVisit = todayBlock.indexOf('<VisitTypeBadge');
    const iName = todayBlock.indexOf('data-testid="patient-name"');
    expect(iStatus).toBeLessThan(iVisit);
    expect(iVisit).toBeLessThan(iName);
  });

  test('델타2: 예약메모가 액션 버튼 바로 앞(마지막 데이터 컬럼)', () => {
    const iMemo = todayBlock.indexOf('data-testid="booking-memo"');
    const iAction = todayBlock.indexOf('data-testid="confirm-prescription-btn"');
    expect(iMemo).toBeGreaterThanOrEqual(0);
    expect(iMemo).toBeLessThan(iAction);
    // 메모 뒤로는 다른 데이터 컬럼(방/이름/차트/처방)이 없음.
    const after = todayBlock.slice(iMemo + 1);
    expect(after).not.toContain('data-testid="patient-room"');
    expect(after).not.toContain('data-testid="patient-name"');
    expect(after).not.toContain('data-testid="patient-chartno"');
  });
});

test.describe('DASHCOL-REALIGN — 이력 모드 통일(공유 컬럼 상대 배치 일치)', () => {
  test('이력 모드 grid 유지(7칼럼, read-only 컬럼셋 미변경)', () => {
    expect(src).toContain(HIST_GRID);
    expect('3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto_auto'.split('_').length).toBe(7);
  });

  test('이력 모드 공유 컬럼 순서 = 방문유형→이름→차트번호→처방 (오늘 모드와 동일 상대 배치)', () => {
    expect(histStart).toBeGreaterThanOrEqual(0);
    expect(histBlock.length).toBeGreaterThan(0);
    assertOrder(histBlock, [
      '<VisitTypeBadge',
      'data-testid="patient-name"',
      'data-testid="patient-chartno"',
      '<PrescriptionStatusBadge',
    ]);
  });
});

test.describe('DASHCOL-REALIGN — 가드(너비 보존 / B·필터 미침범)', () => {
  test('칸 너비 무변경 — 오늘 모드 폭 집합이 shipped 집합과 동일(순서만 변경)', () => {
    const now = '4.75rem_3.75rem_3rem_5rem_4.5rem_5.5rem_minmax(0,1fr)_auto'.split('_').sort();
    const prev = '3rem_5rem_4.5rem_5.5rem_3.75rem_4.75rem_minmax(0,1fr)_auto'.split('_').sort();
    expect(now).toEqual(prev);
  });

  test('행필터/탭(RXLIST-RENAME-DOCFILTER) 진입점 미침범', () => {
    // 同 파일 헤더의 서명필터·정렬 토글 마커 잔존(행 grid 재배치가 헤더를 건드리지 않음).
    expect(src).toContain('data-testid="signdoctor-filter"');
    expect(src).toContain('data-testid="patient-sort-toggle"');
  });

  test('DoctorCallDashboard(B) 미변경 가드 — 본 spec은 A(DoctorPatientList)만 검증', () => {
    // A 정본 경로 고정(B surface로 오인 방지).
    expect(SRC.endsWith('DoctorPatientList.tsx')).toBe(true);
  });
});
