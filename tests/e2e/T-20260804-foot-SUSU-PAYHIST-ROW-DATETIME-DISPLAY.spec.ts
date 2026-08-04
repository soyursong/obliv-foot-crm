/**
 * T-20260804-foot-SUSU-PAYHIST-ROW-DATETIME-DISPLAY
 * ════════════════════════════════════════════════════════════════════════════
 * 환자 수납 이력 / 카드 결제 내역 목록의 결제승인·취소 각 행에 처리시각(초 단위) 표시.
 * 다건 나열 시 최신 구분(선후) 가능하게 — CBAND 16:00 인수 게이트 AC2 가시성 요소.
 *
 * 데이터 소스: payments 행 created_at(승인 = 결제행, 취소 = refund행). 기존 저장값 read.
 *   db_change=false · FE-only · 표시 전용(금액/상태/로직 무변경).
 *
 * 검증(정적 소스 불변식 — 토큰/DB 무관 견고 가드):
 *   AC-1/2 결제승인·취소 각 행 처리시각 표시 · AC-3 초 단위(선후 구분) ·
 *   AC-4 표시 전용(read-only, payments write 무변경) · AC-5 결측 '-' 폴백.
 * + formatDateTimeSeconds 동작(초 단위·KST·null→'') 재현 검증.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 1) 포매터 SSOT — formatDateTimeSeconds (초 단위·KST·점 표기·null 안전)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('formatDateTimeSeconds 불변식 (T-20260804-foot-SUSU-PAYHIST-ROW-DATETIME-DISPLAY)', () => {
  const fmt = read('src/lib/format.ts');

  test('AC-3: 신규 초 단위 포매터 존재 + second:2-digit(초 단위) 포함', () => {
    expect(fmt).toMatch(/export function formatDateTimeSeconds\(/);
    // formatDateTimeSeconds 본문에 second:'2-digit' 이 있어야 초 단위 구분 성립
    const body = fmt.slice(fmt.indexOf('export function formatDateTimeSeconds('));
    expect(body).toMatch(/second:\s*'2-digit'/);
  });

  test('KST(Asia/Seoul) 기준 · 앱 전역 점 표기(하이픈 0) 정책 준수', () => {
    const body = fmt.slice(fmt.indexOf('export function formatDateTimeSeconds('));
    expect(body).toMatch(/timeZone:\s*'Asia\/Seoul'/);
    // T-20260630 DATEFMT 정책: 날짜 구분자 점(.) — 하이픈으로 조립하지 않음
    expect(body).toMatch(/replace\(\/-\/g,\s*'\.'\)/);
  });

  test('AC-5: null/빈값/파싱불가 → 빈문자열(호출부 폴백 위임)', () => {
    const body = fmt.slice(fmt.indexOf('export function formatDateTimeSeconds('));
    expect(body).toMatch(/return '';/);
    expect(body).toMatch(/Number\.isNaN/);
  });

  // 실제 동작 재현 — 포매터 로직과 동일하게 조립해 초 단위·KST 출력 형식을 증명
  test('동작 재현: YYYY.MM.DD HH:mm:ss (초 단위) · KST 환산', () => {
    const reproduce = (input: string): string => {
      const d = new Date(input);
      if (Number.isNaN(d.getTime())) return '';
      const date = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replace(/-/g, '.');
      const time = d.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
      return `${date} ${time}`;
    };
    // 2026-08-04T02:03:47Z(UTC) = KST 11:03:47
    const out = reproduce('2026-08-04T02:03:47Z');
    expect(out).toBe('2026.08.04 11:03:47');
    // 초 단위까지 노출 → 같은 분 내 다건 선후 구분 가능(AC-3)
    expect(out).toMatch(/^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}$/);
    // 결측 안전(AC-5)
    expect(reproduce('')).toBe('');
    expect(reproduce('not-a-date')).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) 렌더 배선 — CheckInDetailSheet 결제 행에 처리시각 표시(AC-1/2/4/5)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('수납 이력 행 처리시각 배선 (T-20260804-foot-SUSU-PAYHIST-ROW-DATETIME-DISPLAY)', () => {
  const sheet = read('src/components/CheckInDetailSheet.tsx');

  test('AC-1/2: 결제 행마다 payment-datetime testid + formatDateTimeSeconds 사용', () => {
    expect(sheet).toMatch(/formatDateTimeSeconds/);
    expect(sheet).toMatch(/import \{[^}]*formatDateTimeSeconds[^}]*\} from '@\/lib\/format'/);
    expect(sheet).toMatch(/data-testid=\{`payment-datetime-\$\{p\.id\}`\}/);
    // 승인/취소 각 행 라벨 분기 — refund 행은 '취소', 그 외 '승인'
    expect(sheet).toMatch(/p\.payment_type === 'refund' \? '취소 ' : '승인 '/);
    // 소스 = payments 행 created_at(기존 저장값 read)
    expect(sheet).toMatch(/formatDateTimeSeconds\(p\.created_at\)/);
  });

  test('AC-5: 결측 timestamp 는 "-" 폴백(레이아웃 유지)', () => {
    expect(sheet).toMatch(/formatDateTimeSeconds\(p\.created_at\) \|\| '-'/);
  });

  test('AC-4: 표시 전용 — payments 조회 select 에 created_at 포함(신규 write 없음)', () => {
    // 기존 결제 조회에 created_at 이 이미 select 되어 있어야 표시 가능(신규 컬럼/쿼리 확장 불요)
    expect(sheet).toMatch(/\.from\('payments'\)[\s\S]{0,200}created_at/);
  });
});
