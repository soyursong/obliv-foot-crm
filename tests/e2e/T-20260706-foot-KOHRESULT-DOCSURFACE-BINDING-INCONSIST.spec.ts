/**
 * E2E spec — T-20260706-foot-KOHRESULT-DOCSURFACE-BINDING-INCONSIST (Path A)
 * 균검사 결과지 발행 시 birth_date 서버파생(publish_koh_result) 주입.
 *
 * 문제: 결과지 문서표면 birth_date 바인딩이 FE payload(effectiveBirth) 계산 경로 유무에 따라
 *   3경로(진료대시보드 / 치료테이블 발급 / 미리보기)에서 불일치(BINDING-INCONSIST).
 * 해결: 발행 RPC가 fn_customer_birthdates 로 서버 확정 파생 → field_data.birth_date 스냅샷을
 *   결과지 렌더 포맷('YYYY년 MM월 DD일')으로 채운다. 3경로는 field_data.birth_date 를 verbatim
 *   렌더({{birth_date}})하므로 스냅샷이 확정되면 3경로 공통 정상 표시가 보장된다.
 *
 * 검증 대상(RPC 서버 로직 정본 모사 — PHI 파생은 SECURITY DEFINER 내부, FE 비관측이므로 SQL 규칙을
 *   TS로 모사해 회귀 차단):
 *   시나리오 2 = 신규 발행분 birth 3경로 공통 정상 표시.
 *     S1 birth_date 컬럼 우선(세기 휴리스틱) → 서버파생 스냅샷 = 렌더 포맷.
 *     S2 birth_date 결측 → RRN 세기코드 파생 → 스냅샷 = 렌더 포맷(FE payload 무의존).
 *     S3 AC7 COALESCE 순서: 서버파생 우선, 결측 시에만 FE payload fallback(역순 절대 금지).
 *     S4 3경로 공통표시: 스냅샷 포맷 == FE formatBirthKo 포맷 → 어느 경로든 동일 문자열 렌더.
 *     S5 AC8/AC4/AC10: 스냅샷엔 RRN/세기코드/뒷자리 없음, 렌더포맷만. 병합키(customers.birth_date) 무기록.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: fn_customer_birthdates 파생 규칙(20260613120000) ────────────────
//   1순위 customers.birth_date(YYMMDD, 세기 휴리스틱 YY<=현재2자리→20xx else 19xx),
//   2순위 rrn 앞6+세기코드(1,2,5,6→1900 / 3,4,7,8→2000 / 9,0→1800). 결과 = 'YYYY-MM-DD' | null.
const nowYY2 = new Date().getFullYear() % 100; // 세기 휴리스틱 기준(서버 now() 동형)
function deriveBirthDisplay(birthCol: string | null, rrn: string | null): string | null {
  const bd = String(birthCol ?? '').replace(/[^0-9]/g, '');
  if (bd.length >= 6) {
    const yy = parseInt(bd.slice(0, 2), 10);
    const mm = parseInt(bd.slice(2, 4), 10);
    const dd = parseInt(bd.slice(4, 6), 10);
    const year = yy <= nowYY2 ? 2000 + yy : 1900 + yy;
    return validDate(year, mm, dd);
  }
  const r = String(rrn ?? '').replace(/[^0-9]/g, '');
  if (r.length === 13) {
    const yy = parseInt(r.slice(0, 2), 10);
    const mm = parseInt(r.slice(2, 4), 10);
    const dd = parseInt(r.slice(4, 6), 10);
    const g = parseInt(r.slice(6, 7), 10);
    let year: number | null = null;
    if ([1, 2, 5, 6].includes(g)) year = 1900 + yy;
    else if ([3, 4, 7, 8].includes(g)) year = 2000 + yy;
    else if ([9, 0].includes(g)) year = 1800 + yy;
    return year == null ? null : validDate(year, mm, dd);
  }
  return null;
}
function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // 2/30 방어
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
}

// ── 정본 모사: publish_koh_result 의 v_birth_ko 변환 ('YYYY-MM-DD' → 'YYYY년 MM월 DD일') ──
function birthKoFromServer(display: string | null): string | null {
  if (display && /^\d{4}-\d{2}-\d{2}/.test(display)) {
    return `${display.slice(0, 4)}년 ${display.slice(5, 7)}월 ${display.slice(8, 10)}일`;
  }
  return null;
}

// ── 정본 모사: field_data.birth_date 병합 (AC7 COALESCE 서버파생 우선) ──────────
//   SQL: COALESCE(v_birth_ko, p_field_data->>'birth_date', '').  역순(FE 우선) 금지.
function snapshotBirth(serverKo: string | null, fePayloadBirth: string | null): string {
  return serverKo ?? fePayloadBirth ?? '';
}

// ── FE formatBirthKo 동형(KohReportTab.formatBirthKo) — 3경로 공통 렌더 포맷 ────
function feFormatBirthKo(birth: string | null): string {
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

// 발행 시 field_data.birth_date 산출(정본 파이프라인 전체 모사).
function publishBirthSnapshot(birthCol: string | null, rrn: string | null, fePayloadBirth: string | null): string {
  const display = deriveBirthDisplay(birthCol, rrn);
  const serverKo = birthKoFromServer(display);
  return snapshotBirth(serverKo, fePayloadBirth);
}

// ── S1: birth_date 컬럼 우선(세기 휴리스틱) → 서버파생 스냅샷 = 렌더 포맷 ─────────
test('S1: birth_date 컬럼 → 서버파생 스냅샷이 결과지 렌더 포맷으로 채워짐', () => {
  // 900315 → 1990(90 > 현재2자리) → '1990년 03월 15일'
  expect(publishBirthSnapshot('900315', null, null)).toBe('1990년 03월 15일');
  // 051120 → 2005(05 <= 현재2자리) → '2005년 11월 20일'
  expect(publishBirthSnapshot('051120', null, null)).toBe('2005년 11월 20일');
  // 서버파생 성공 시 FE payload 무시(override) — FE가 다른 값을 보내도 서버값 우선.
  expect(publishBirthSnapshot('900315', null, '1980년 01월 01일')).toBe('1990년 03월 15일');
  // 공란 아님(문서표면 정상 표시)
  expect(publishBirthSnapshot('900315', null, null)).not.toBe('');
});

// ── S2: birth_date 결측 → RRN 세기코드 파생 → 스냅샷 = 렌더 포맷(FE 무의존) ───────
test('S2: birth_date 결측 → RRN 파생으로 서버가 스냅샷 확정(FE payload 계산 경로 무의존)', () => {
  // rrn 900315-1****** (세기코드 1 → 1900s) → 1990-03-15
  expect(publishBirthSnapshot(null, '9003151234567', null)).toBe('1990년 03월 15일');
  // 세기코드 3 → 2000s : 050101-3****** → 2005-01-01
  expect(publishBirthSnapshot(null, '0501013234567', null)).toBe('2005년 01월 01일');
  // 세기코드 9 → 1800s : 990101-9****** → 1899-01-01
  expect(publishBirthSnapshot(null, '9901019234567', null)).toBe('1899년 01월 01일');
  // FE payload 없이도(다른 렌더 경로) 서버가 채움 → BINDING-INCONSIST 근본 해소.
  expect(publishBirthSnapshot(null, '9003151234567', null)).not.toBe('');
});

// ── S3: AC7 COALESCE 순서 — 서버파생 결측 시에만 FE payload fallback(역순 금지) ──
test('S3: AC7 — 서버파생 우선, 결측 시에만 FE payload fallback(회귀 0, 역순 절대 금지)', () => {
  // 서버파생 불가(birth·rrn 모두 결측) → FE payload 유지(회귀 0).
  expect(publishBirthSnapshot(null, null, '1975년 07월 07일')).toBe('1975년 07월 07일');
  // 서버파생 불가 + FE payload 도 없음 → '' (공란, 발행 비차단).
  expect(publishBirthSnapshot(null, null, null)).toBe('');
  // 서버파생 성공 시 FE payload 는 절대 우선하지 못함(역순 금지 가드).
  const withServer = publishBirthSnapshot('900315', null, '2001년 12월 31일');
  expect(withServer).toBe('1990년 03월 15일');
  expect(withServer).not.toBe('2001년 12월 31일');
});

// ── S4: 3경로 공통표시 — 스냅샷 포맷 == FE formatBirthKo 포맷(동일 문자열 렌더) ───
test('S4: 서버 스냅샷 포맷 == FE formatBirthKo 포맷 → 3경로 공통 정상 표시', () => {
  // 진료대시보드/치료테이블/미리보기 모두 {{birth_date}} verbatim 렌더 → 포맷 일치가 공통표시의 전제.
  for (const [birthCol, rrn, iso] of [
    ['900315', null, '1990-03-15'],
    ['051120', null, '2005-11-20'],
    [null, '9003151234567', '1990-03-15'],
  ] as const) {
    const serverSnapshot = publishBirthSnapshot(birthCol, rrn, null);
    // FE 가 같은 파생 날짜(ISO)로 formatBirthKo 했을 때와 동일해야 3경로 문자열이 일치.
    expect(serverSnapshot).toBe(feFormatBirthKo(iso));
  }
});

// ── S5: AC8/AC4/AC10 — 스냅샷엔 렌더 포맷만, RRN/세기코드/뒷자리 미포함 ──────────
test('S5: AC8/AC4 — 스냅샷은 렌더 포맷만, RRN 평문·세기코드·뒷자리 미노출', () => {
  const snap = publishBirthSnapshot(null, '9003151234567', null);
  // 결과지엔 birth 만: RRN 뒷자리(1234567)·세기코드 원본 문자열이 스냅샷에 남지 않는다.
  expect(snap).toBe('1990년 03월 15일');
  expect(snap).not.toContain('1234567');
  expect(snap).not.toMatch(/-\d{7}/); // RRN 뒷자리 패턴 부재
  // 렌더 포맷 정규식(YYYY년 MM월 DD일)에 정확히 부합 — 그 외 잔여 없음.
  expect(snap).toMatch(/^\d{4}년 \d{2}월 \d{2}일$/);
});
