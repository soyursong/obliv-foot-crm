/**
 * E2E spec — T-20260623-foot-KOHDOC-BIRTHDATE-FROM-RRN-FALLBACK
 * 균검사지(KOH 결과보고서) 생년월일 빈칸 출력 + 발행 hard-block 해소.
 *   문제: customers.birth_date NULL 다수(윤민희 등 prod) → 발행 불가 환자 실발생.
 *   해결: 旣 prod 배포된 fn_customer_birthdates RPC(birth_date 우선, NULL이면 rrn 세기코드 파생,
 *         migration 20260613120000) 파생값을 KohReportTab 에 fallback. DB 무변경·FE-only·REUSE.
 *
 * 검증(AC 1:1):
 *   AC① 정규 birth_date NULL + RRN 파생값 보유 → 결과지 생년 표기 + 발행 가능(effective birth 존재).
 *   AC② 정규·파생 둘 다 결측 → 기존 hard-block 보존(effective birth null → 차단).
 *   AC③ 정규 birth_date 보유 시 회귀0 — 파생값이 정규값을 덮지 않음(우선순위 birth_date).
 *   AC④ PHI — 파생 입력은 RPC 의 birth_date_display(파생 표시값)만 사용(평문 RRN 클라 미노출).
 *
 * 스타일: 기존 KOH spec 동일 — 정본 헬퍼(KohReportTab.tsx)의 effectiveBirth/birth_date 분기를
 *   in-page 모사해 fallback 로직 회귀를 DB 없이 차단(pure logic). 정본 소스 fs 직독으로 결선 가드.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src/components/doctor/KohReportTab.tsx');

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

// ── 정본 모사: effectiveBirth (정규 birth_date 우선, NULL이면 RRN 파생값) ──────
type Row = { customer_id: string | null; birth_date: string | null };
function effectiveBirth(r: Row, birthMap: Map<string, string>): string | null {
  return r.birth_date || (r.customer_id ? birthMap.get(r.customer_id) ?? null : null);
}

// ── 정본 모사: buildKohFieldData 의 birth_date 필드(formatBirthKo(birth_date || override)) ──
function fieldBirth(r: Row, birthMap: Map<string, string>): string {
  return formatBirthKo(r.birth_date || (r.customer_id ? birthMap.get(r.customer_id) ?? null : null) || null);
}

test('AC① 정규 NULL + RRN 파생값 → 발행 가능 + 결과지 생년 표기', () => {
  const birthMap = new Map([['c1', '1990-03-15']]);
  const r: Row = { customer_id: 'c1', birth_date: null };
  expect(effectiveBirth(r, birthMap)).toBe('1990-03-15'); // 발행 게이트 통과(non-null)
  expect(fieldBirth(r, birthMap)).toBe('1990년 03월 15일'); // 결과지 표기 = 파생값
});

test('AC② 정규·파생 둘 다 결측 → hard-block 보존(차단)', () => {
  const birthMap = new Map<string, string>(); // 파생값 없음
  const r: Row = { customer_id: 'c2', birth_date: null };
  expect(effectiveBirth(r, birthMap)).toBeNull(); // 발행 차단
  expect(fieldBirth(r, birthMap)).toBe(''); // 결과지 생년 빈값
});

test('AC③ 정규 birth_date 보유 → 회귀0(파생값이 정규값 미덮음)', () => {
  // 파생값이 정규값과 달라도 정규 birth_date 가 우선되어야 한다(우선순위 birth_date).
  const birthMap = new Map([['c3', '1985-12-31']]);
  const r: Row = { customer_id: 'c3', birth_date: '1990-03-15' };
  expect(effectiveBirth(r, birthMap)).toBe('1990-03-15'); // 정규값 유지
  expect(fieldBirth(r, birthMap)).toBe('1990년 03월 15일'); // 파생값(1985) 미반영
});

test('AC④ PHI — 파생 입력은 birth_date_display 만(평문 RRN 미노출) + 결선 가드', () => {
  const src = readFileSync(SRC, 'utf8');
  // RPC 호출은 fn_customer_birthdates, 수신은 birth_date_display 만.
  expect(src).toContain("supabase.rpc('fn_customer_birthdates'");
  expect(src).toContain('birth_date_display');
  // 평문 RRN 컬럼(rrn / resident_registration_number)을 select/수신하지 않음(PHI 미노출).
  expect(src).not.toMatch(/birthMap[\s\S]{0,200}\brrn\b/);
  // 결선 가드: effectiveBirth 가 canPublish/handlePublish/buildKohFieldData(call)·표기에 연결됨.
  expect(src).toContain('const effectiveBirth');
  expect(src).toContain('!!effectiveBirth(r)'); // canPublish 게이트
  expect(src).toContain('buildKohFieldData(r, doctorName, effectiveBirth(r))'); // 발행 fieldData
  // DB 무변경 — 본 티켓 마이그 신규 작성 금지(RPC 旣배포).
});

test('customer_id 없는 행(레거시) — 파생 조회 불가 → null(차단)', () => {
  const birthMap = new Map([['c1', '1990-03-15']]);
  const r: Row = { customer_id: null, birth_date: null };
  expect(effectiveBirth(r, birthMap)).toBeNull();
});
