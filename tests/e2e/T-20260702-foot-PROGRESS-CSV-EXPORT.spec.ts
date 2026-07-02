/**
 * T-20260702-foot-PROGRESS-CSV-EXPORT — 경과분석 탭 시술기록 CSV 다운로드 (pure-logic E2E)
 *
 * 검증 대상 = CSV 계약의 결정론적 핵심(오염 시 임상 오독 유발):
 *   1. 시술타입 코드→한글 라벨 매핑(SESSION_TYPE_LABEL) — 문원장 확정 표기.
 *   2. 힐러적용여부 3-state 규칙(적용/미적용/'') — "6/14 이전=데이터 부재=빈 문자열(0/false 아님)" AC.
 *   3. 방문×시술타입 grain — 같은 날 레이저+발톱교정 = 2행 유지.
 *   4. CSV 헤더 순서(1~8 스펙 고정) · 셀 이스케이프(콤마/따옴표/개행) · CRLF.
 *   5. 파일명 경과분석_YYYYMMDD · BOM 상수.
 *
 * 왜 pure-logic: 매핑/라벨/힐러 규칙이 회차·힐러 오염의 실질 리스크. UI 게이팅(admin/manager)·
 *   supabase 조회 조립은 컴포넌트 통합(별도 수동 QA)로 확인. 본 spec 은 값 정확성을 못박는다.
 */
import { test, expect } from '@playwright/test';
import {
  SESSION_TYPE_LABEL,
  sessionTypeLabel,
  healerCell,
  HEALER_DATA_START,
  buildProgressCsv,
  progressCsvFilename,
  PROGRESS_CSV_HEADERS,
  type ProgressCsvRow,
} from '../../src/lib/progressTreatmentCsv';

test.describe('PROGRESS-CSV-EXPORT · 시술타입 라벨', () => {
  test('문원장 확정 한글 라벨 매핑', () => {
    expect(sessionTypeLabel('heated_laser')).toBe('레이저가열');
    expect(sessionTypeLabel('unheated_laser')).toBe('레이저비가열');
    expect(sessionTypeLabel('podologue')).toBe('발톱교정');
    expect(sessionTypeLabel('ribbon')).toBe('각질');
    expect(SESSION_TYPE_LABEL['preconditioning']).toBe('프리컨디셔닝');
  });

  test('미정의 코드는 원본 유지(무손실), 빈값은 빈 문자열', () => {
    expect(sessionTypeLabel('some_new_code')).toBe('some_new_code');
    expect(sessionTypeLabel('')).toBe('');
    expect(sessionTypeLabel(null)).toBe('');
    expect(sessionTypeLabel(undefined)).toBe('');
  });
});

test.describe('PROGRESS-CSV-EXPORT · 힐러적용여부 3-state', () => {
  test('힐러 데이터 시작일 = 2026-06-14', () => {
    expect(HEALER_DATA_START).toBe('2026-06-14');
  });

  test('레이저 + 6/14 이후 + true → 적용', () => {
    expect(healerCell('heated_laser', '2026-06-14', true)).toBe('적용');
    expect(healerCell('unheated_laser', '2026-07-02', true)).toBe('적용');
  });

  test('레이저 + 6/14 이후 + false → 미적용', () => {
    expect(healerCell('heated_laser', '2026-06-20', false)).toBe('미적용');
    expect(healerCell('unheated_laser', '2026-06-14', false)).toBe('미적용');
  });

  test('레이저 + 6/14 이전 → 빈 문자열(데이터 부재, false 아님)', () => {
    expect(healerCell('heated_laser', '2026-06-13', true)).toBe('');
    expect(healerCell('unheated_laser', '2026-05-01', false)).toBe('');
  });

  test('비레이저 시술타입 → 항상 빈 문자열', () => {
    expect(healerCell('podologue', '2026-07-02', true)).toBe('');
    expect(healerCell('ribbon', '2026-07-02', true)).toBe('');
    expect(healerCell('preconditioning', '2026-07-02', false)).toBe('');
  });

  test('연결 예약 없음(null) + 레이저 + 6/14 이후 → 미적용(적용 아님)', () => {
    expect(healerCell('heated_laser', '2026-07-02', null)).toBe('미적용');
  });
});

test.describe('PROGRESS-CSV-EXPORT · CSV 조립', () => {
  const mkRow = (o: Partial<ProgressCsvRow>): ProgressCsvRow => ({
    차트번호: '', 환자명: '', 시술일: '', 시술타입: '', 세션번호: '', 총회차: '', 시술부위: '', 힐러적용여부: '',
    ...o,
  });

  test('헤더 순서 = 스펙 1~8 고정', () => {
    expect([...PROGRESS_CSV_HEADERS]).toEqual([
      '차트번호', '환자명', '시술일', '시술타입', '세션번호', '총회차', '시술부위', '힐러적용여부',
    ]);
    const csv = buildProgressCsv([]);
    expect(csv.split('\r\n')[0]).toBe('차트번호,환자명,시술일,시술타입,세션번호,총회차,시술부위,힐러적용여부');
  });

  test('같은 날 레이저+발톱교정 = 2행 유지(방문×시술타입 grain)', () => {
    const rows: ProgressCsvRow[] = [
      mkRow({ 차트번호: 'C1', 환자명: '홍길동', 시술일: '2026-07-02', 시술타입: '레이저비가열', 세션번호: 5, 총회차: 10, 시술부위: 'R1, L3', 힐러적용여부: '적용' }),
      mkRow({ 차트번호: 'C1', 환자명: '홍길동', 시술일: '2026-07-02', 시술타입: '발톱교정', 세션번호: 6, 총회차: 10, 시술부위: '', 힐러적용여부: '' }),
    ];
    const lines = buildProgressCsv(rows).split('\r\n');
    expect(lines).toHaveLength(3); // 헤더 + 2행
    expect(lines[1]).toContain('레이저비가열');
    expect(lines[2]).toContain('발톱교정');
  });

  test('셀 이스케이프 — 콤마/따옴표는 따옴표로 감싸고 내부 따옴표 2배', () => {
    const rows = [mkRow({ 환자명: '김,철수', 시술부위: 'R1, L3', 시술타입: '메모"인용"' })];
    const line = buildProgressCsv(rows).split('\r\n')[1];
    expect(line).toContain('"김,철수"');
    expect(line).toContain('"R1, L3"');
    expect(line).toContain('"메모""인용"""');
  });

  test('세션번호>총회차(과잉소진) = 저장값 그대로 출력(오염 아님)', () => {
    const rows = [mkRow({ 세션번호: 13, 총회차: 12 })];
    const line = buildProgressCsv(rows).split('\r\n')[1];
    expect(line).toContain('13');
    expect(line).toContain('12');
  });

  test('파일명 = 경과분석_YYYYMMDD', () => {
    expect(progressCsvFilename(new Date('2026-07-02T09:00:00'))).toBe('경과분석_20260702');
    expect(progressCsvFilename(new Date('2026-01-05T09:00:00'))).toBe('경과분석_20260105');
  });
});
