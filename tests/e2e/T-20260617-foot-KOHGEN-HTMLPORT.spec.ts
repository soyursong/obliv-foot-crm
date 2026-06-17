/**
 * E2E spec — T-20260617-foot-KOHGEN-HTMLPORT
 * 균검사지 생성기(대표원장 자작 HTML) → CRM 旣 발행 동선 이식 (KOH-REPORT-TAB Phase2 unblock).
 *
 * ★ 별도 페이지 신설 아님 — KOH_RESULT_HTML 템플릿 양식 교체 + KohResultDialog(출력/복사/저장 PNG).
 *
 * 검증 대상(현장 클릭 시나리오 3종 + 양식 정합 가드):
 *   S1 생년월일 표기(AC①) — formatBirthKo: DB DATE 'YYYY-MM-DD' → 'YYYY년 MM월 DD일'.
 *   S2 생년월일 6자리 방어 파싱(AC①) — 00~26 → 20xx, 그 외 → 19xx (대표원장 formatBirth 규칙).
 *   S3 양식 고정값 정합(AC②) — 템플릿에 의뢰기관 서울오리진점·담당의/검사자 문지은·면허 145617·
 *       Tel 02)6956-3438·D6201002·KOH mount·Hyphae/Yeast 포함.
 *   S4 결과 라벨 적색(AC②) — Hyphae/Yeast 라벨 적색(label-red), 값 흑색(val-black) 분리.
 *   S5 격리 불변식 — #koh-report-sheet 스코프, 전역 `* {}` reset 없음(앱 DOM 주입 안전).
 *   S6 html2canvas 안전(oklch-free) — koh 결과지 블록에 oklch() 색상 없음(1.4.1 파싱 충돌 회피).
 *   S7 PNG 파일명(AC③) — buildFileName: 검사결과보고서_{수진자}_{의뢰번호|날짜}.png.
 *
 * 스타일: 기존 KOH spec 동일 — 정본 헬퍼(formatBirthKo·buildFileName) in-page 모사 +
 *   실제 템플릿 소스(htmlFormTemplates.ts) fs 직독으로 양식 정합/격리 불변식 회귀 차단.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_SRC = resolve(__dirname, '../../src/lib/htmlFormTemplates.ts');

// ── 정본 모사: formatBirthKo (KohReportTab.tsx) ─────────────────────────────
function formatBirthKo(birth: string | null | undefined): string {
  if (!birth) return '';
  const s = String(birth).trim();
  const m10 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m10) return `${m10[1]}년 ${m10[2]}월 ${m10[3]}일`;
  const m6 = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m6) {
    const yy = parseInt(m6[1], 10);
    const prefix = yy >= 0 && yy <= 26 ? '20' : '19';
    return `${prefix}${m6[1]}년 ${m6[2]}월 ${m6[3]}일`;
  }
  return s;
}

// ── 정본 모사: buildFileName (KohResultDialog.tsx) ──────────────────────────
function buildFileName(fieldData: Record<string, unknown>): string {
  const name = String(fieldData['patient_name'] ?? '').trim() || 'report';
  const stamp =
    String(fieldData['request_no'] ?? '').trim() ||
    String(fieldData['collected_date'] ?? '').replace(/[.\-/]/g, '') ||
    new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `검사결과보고서_${name}_${stamp}.png`;
}

/** 실제 소스에서 KOH_RESULT_HTML 블록만 슬라이스(고정값/격리 불변식 검증용). */
function kohTemplateBlock(): string {
  const src = readFileSync(TEMPLATES_SRC, 'utf8');
  const start = src.indexOf('const KOH_RESULT_HTML = `');
  expect(start, 'KOH_RESULT_HTML 선언 발견').toBeGreaterThan(-1);
  const end = src.indexOf('`;', start);
  return src.slice(start, end);
}

// ===========================================================================
test.describe('T-20260617-foot-KOHGEN-HTMLPORT', () => {
  // S1 — 생년월일 한글 표기(DB DATE 정규 경로)
  test('S1: formatBirthKo — YYYY-MM-DD → "YYYY년 MM월 DD일"', () => {
    expect(formatBirthKo('1998-08-01')).toBe('1998년 08월 01일');
    expect(formatBirthKo('2024-12-31')).toBe('2024년 12월 31일');
    // timestamptz(시간 동반)도 날짜부만
    expect(formatBirthKo('1990-05-09T00:00:00+09:00')).toBe('1990년 05월 09일');
    // 결측
    expect(formatBirthKo(null)).toBe('');
    expect(formatBirthKo('')).toBe('');
  });

  // S2 — 6자리 방어 파싱(세기 추정 00~26 → 20xx)
  test('S2: formatBirthKo — 6자리(YYMMDD) 00~26→20xx, 그 외 19xx', () => {
    expect(formatBirthKo('980801')).toBe('1998년 08월 01일'); // 98 → 19xx
    expect(formatBirthKo('000101')).toBe('2000년 01월 01일'); // 00 → 20xx
    expect(formatBirthKo('260315')).toBe('2026년 03월 15일'); // 26 → 20xx (경계)
    expect(formatBirthKo('270315')).toBe('1927년 03월 15일'); // 27 → 19xx (경계 밖)
    // 6자리 아님 → 원본 passthrough
    expect(formatBirthKo('1998년 8월 1일')).toBe('1998년 8월 1일');
  });

  // S3 — 양식 고정값 정합(대표원장 양식)
  test('S3: 템플릿 고정값 — 서울오리진점·문지은·145617·Tel·D6201002·KOH mount', () => {
    const block = kohTemplateBlock();
    expect(block).toContain('오블리브의원 서울오리진점');
    expect(block).toContain('문지은');
    expect(block).toContain('145617');
    expect(block).toContain('02)6956-3438'); // Tel
    expect(block).toContain('02)6956-3439'); // Fax
    expect(block).toContain('D6201002');
    expect(block).toContain('KOH mount');
    expect(block).toContain('임상미생물');
    // 종전 인천 양식 Tel/Fax 흔적 제거(회귀 가드)
    expect(block).not.toContain('032)851-9119');
    expect(block).not.toContain('032)858-8118');
  });

  // S4 — Hyphae/Yeast 라벨 적색 + 값 흑색 분리(AC②)
  test('S4: 검사결과 — Hyphae/Yeast 라벨 적색·값 흑색 분리', () => {
    const block = kohTemplateBlock();
    expect(block).toContain('Hyphae');
    expect(block).toContain('Yeast');
    expect(block).toContain('label-red');
    expect(block).toContain('val-black');
    // 적색 라벨 색상(hex) 존재
    expect(block).toContain('#e74c3c');
  });

  // S5 — 격리 불변식: #koh-report-sheet 스코프 + 전역 `* {}` reset 없음
  test('S5: 격리 — #koh-report-sheet 스코프, 전역 * reset 없음', () => {
    const block = kohTemplateBlock();
    expect(block).toContain('#koh-report-sheet');
    // 스코프 없는 전역 `* {` reset 금지(앱 DOM 주입 시 margin/padding 0 오염 차단).
    //   허용: '#koh-report-sheet * {' (스코프드). 금지: 라인 시작 또는 공백 뒤 '* {'.
    expect(/(^|\n)\s*\*\s*\{/.test(block)).toBe(false);
    expect(block).toContain('#koh-report-sheet * {'); // 스코프드 box-sizing 은 허용
  });

  // S6 — html2canvas 1.4.1 안전: oklch() 색상 없음
  test('S6: oklch-free — 결과지 블록에 oklch() 미사용', () => {
    const block = kohTemplateBlock();
    expect(block.toLowerCase()).not.toContain('oklch');
  });

  // S7 — PNG 파일명(AC③)
  test('S7: buildFileName — 검사결과보고서_{수진자}_{의뢰번호}.png', () => {
    expect(buildFileName({ patient_name: '홍길동', request_no: '20260617001' }))
      .toBe('검사결과보고서_홍길동_20260617001.png');
    // 의뢰번호 없으면 검체채취일(구분자 제거) 폴백
    expect(buildFileName({ patient_name: '김환자', collected_date: '2026.06.17' }))
      .toBe('검사결과보고서_김환자_20260617.png');
    // 수진자명 없으면 report 폴백
    const fn = buildFileName({ request_no: '20260617002' });
    expect(fn.startsWith('검사결과보고서_report_20260617002')).toBe(true);
  });
});
