/**
 * Unit/static spec — T-20260630-foot-DATEFMT-YMD-RELATIVE-PURGE
 * (xcrm LEAD: T-20260630-derm-DATEFMT-XCRM-YMD-RELATIVE-PURGE §AC-1~6)
 *
 * 풋센터 CRM 화면 날짜 표시를 'YYYY.MM.DD'(점·2자리)로 통일 + 상대표기('방금' 등) 제거.
 * 저장값/쿼리/정렬 무변경(presentation only). 메인 네비 한글날짜 헤더(요일포함)는 제외(AC-4).
 *
 * 이 스펙은 auth·server 불요(playwright.config 'unit' 프로젝트). 순수함수 유닛 + 소스 grep 잔존0 가드.
 *   AC-5: 단일 포매터(formatDateDots/formatDateTimeDots) funnel + null/빈값/타임스탬프 처리 + grep 잔존0.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { formatDateDots, formatDateTimeDots, birthDateYMD } from '../../src/lib/format';
import { elapsedLabel } from '../../src/lib/elapsed';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

test.describe('AC-1/5: formatDateDots — 화면 날짜 YYYY.MM.DD SSOT', () => {
  test('순수 날짜 문자열(YYYY-MM-DD)은 tz 연산 없이 점 치환', () => {
    expect(formatDateDots('2026-06-30')).toBe('2026.06.30');
    expect(formatDateDots('1993-11-29')).toBe('1993.11.29');
  });

  test('타임스탬프(ISO/timestamptz)는 서울 기준 날짜로 점 표기', () => {
    // KST 09:00 → 당일
    expect(formatDateDots('2026-06-30T09:00:00+09:00')).toBe('2026.06.30');
    // UTC 00:30 = KST 09:30 → 당일
    expect(formatDateDots('2026-06-30T00:30:00Z')).toBe('2026.06.30');
  });

  test('null/빈값/파싱불가 → 빈 문자열(크래시 없음)', () => {
    expect(formatDateDots(null)).toBe('');
    expect(formatDateDots(undefined)).toBe('');
    expect(formatDateDots('')).toBe('');
    expect(formatDateDots('not-a-date')).toBe('');
  });

  test('하이픈/슬래시 잔존 0 — 출력에 - 와 / 없음', () => {
    const out = formatDateDots('2026-01-05');
    expect(out).toBe('2026.01.05');
    expect(out.includes('-')).toBeFalsy();
    expect(out.includes('/')).toBeFalsy();
  });
});

test.describe('AC-3/5: formatDateTimeDots — 날짜+시각 표기', () => {
  test('YYYY.MM.DD HH:mm (서울 24h)', () => {
    expect(formatDateTimeDots('2026-06-30T05:00:00+09:00')).toBe('2026.06.30 05:00');
    expect(formatDateTimeDots('2026-06-30T14:05:00+09:00')).toBe('2026.06.30 14:05');
  });

  test('null/빈값/파싱불가 → 빈 문자열', () => {
    expect(formatDateTimeDots(null)).toBe('');
    expect(formatDateTimeDots('')).toBe('');
    expect(formatDateTimeDots('xxx')).toBe('');
  });
});

test.describe('AC-1: birthDateYMD — 생년월일 YYYY.MM.DD(점)', () => {
  test('YYMMDD → 세기판별 + 점 표기', () => {
    expect(birthDateYMD('931129')).toBe('1993.11.29'); // 93 > 현재연도2자리 → 1900대
    expect(birthDateYMD('051129')).toBe('2005.11.29'); // 05 ≤ 현재연도2자리 → 2000대
  });
  test('결측/이상치 → 빈 문자열', () => {
    expect(birthDateYMD(null)).toBe('');
    expect(birthDateYMD('12')).toBe('');      // 6자리 미만
    expect(birthDateYMD('009913')).toBe('');  // 월 99 = 무효
  });
  test('하이픈 잔존 0', () => {
    expect(birthDateYMD('900515').includes('-')).toBeFalsy();
  });
});

test.describe('AC-2: 상대표기 제거 — elapsedLabel "방금" 0', () => {
  test('1분 미만은 "1분 미만"(상대어 방금 아님)', () => {
    expect(elapsedLabel(0)).toBe('1분 미만');
    expect(elapsedLabel(0)).not.toContain('방금');
  });
  test('분/시간 경과 표기는 유지(스톱워치 — 날짜 아님)', () => {
    expect(elapsedLabel(5)).toBe('5분');
    expect(elapsedLabel(75)).toBe('1시간 15분');
  });
});

test.describe('AC-5: 소스 grep 잔존 0 — 화면 날짜 포맷 가드', () => {
  test('format.ts에 SSOT 포매터 존재', () => {
    const f = read('src/lib/format.ts');
    expect(f).toContain('export function formatDateDots');
    expect(f).toContain('export function formatDateTimeDots');
  });

  test("elapsed.ts에 상대어 '방금' 렌더 잔존 0", () => {
    const f = read('src/lib/elapsed.ts');
    expect(f.includes("'방금'")).toBeFalsy();
    expect(f).toContain('1분 미만');
  });

  // 변환 완료 파일들: 화면 표시용 하이픈/슬래시 date-fns 포맷 문자열 잔존 0.
  //   (HH:mm 시각전용·query key·정산export·인쇄문서·메인헤더 한글날짜는 본 가드 대상 아님)
  const GUARD_FILES = [
    'src/pages/Customers.tsx',
    'src/pages/Notices.tsx',
    'src/pages/Packages.tsx',
    'src/components/BloodResultDialog.tsx',
    'src/components/PatientResultFiles.tsx',
    'src/components/PaymentEditDialog.tsx',
    'src/components/ReservationMemoTimeline.tsx',
    'src/components/PackageTicketReadonlyList.tsx',
    'src/components/insurance/InsuranceGradeSelect.tsx',
    'src/components/admin/HiraInsuranceSyncPanel.tsx',
    'src/components/admin/InsuranceStatusPanel.tsx',
  ];
  for (const rel of GUARD_FILES) {
    test(`${rel} — 'yyyy-MM-dd'/'MM/dd'/'MM-dd' 표시 포맷 잔존 0`, () => {
      const src = read(rel);
      // date-fns 표시 포맷 중 하이픈/슬래시 날짜 토큰
      expect(/['"]yyyy-MM-dd/.test(src)).toBeFalsy();
      expect(/['"]MM\/dd/.test(src)).toBeFalsy();
      expect(/['"]MM-dd/.test(src)).toBeFalsy();
      // ko-KR/sv-SE 날짜 toLocale* 표시 잔존 0
      expect(/toLocaleDateString\(['"](ko-KR|sv-SE)['"]/.test(src)).toBeFalsy();
    });
  }

  test('ReservationDetailPopup — raw reservation_date 하이픈 렌더 0(점 포매터 경유)', () => {
    const src = read('src/components/ReservationDetailPopup.tsx');
    // 예약일자 표시는 formatDateDots 경유
    expect(src).toContain('formatDateDots(reservation.reservation_date)');
    expect(src).toContain('formatDateDots(selectedResv.reservation_date)');
    // 슬래시/하이픈 date-fns 표시 포맷 잔존 0 (yyyy.MM.dd (E) 점 포맷은 허용)
    expect(/['"]yyyy-MM-dd \(E\)/.test(src)).toBeFalsy();
    expect(/['"]M\/d \(E\)/.test(src)).toBeFalsy();
  });
});
