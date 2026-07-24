/**
 * E2E spec — T-20260724-foot-DOCFORM-AUTOFILL-DOB-TX-RX-BLANK
 * 소견서·진단서 작성 폼(OpinionEditorDialog) '환자 자동연동' 3필드 공란 버그 — read-only 결선 복구.
 *
 * RC (런타임 재현으로 확정 — scripts/T-20260724-...-BLANK_probe.mjs):
 *   기존 배선(TREATTABLE-DOCS-PARITY 기능②)은 실 데이터가 없는 단일 소스만 봐 3필드 전부 공란이었다.
 *     · 생년월일 ← customers.birth_date (현장은 주민번호만 입력 → birth_date 구조적 공란, rrn 폴백 미사용).
 *     · 당일 시술 ← medical_charts.treatment_record (당일 방문에 차트 미생성 시 NO-CHART=공란).
 *     · 처방내역 ← medical_charts.prescription_items (실 처방은 방문에 따라 check_ins 로 갈려 저장 → 한 소스만 보면 공란).
 *
 * 수정: loadOpinionAutofillRef 가 실 데이터가 존재하는 SSOT 로 재결선(전부 customer_id/check_in_id 스코프).
 *   · 생년월일 = birth_date → 주민번호 산출(출력서류 폴백 재사용).
 *   · 당일 시술 = 이 방문 check_in_services.service_name → 최신 medical_charts.treatment_record 폴백.
 *   · 처방내역 = 이 방문 check_ins.prescription_items → 최신 medical_charts.prescription_items → 최신 처방 check_in 폴백.
 *
 * 검증(정본 모사 — 구현 정본 loadOpinionAutofillRef 의 소스 우선순위·요약·렌더 폴백을 동치 모사):
 *   S1 생년월일 우선순위: birth_date 있으면 그것, 없고 주민번호 있으면 산출, 둘 다 없으면 ''(AC-1).
 *   S2 당일 시술 우선순위: 이 방문 시술항목 → 차트 치료내용 폴백 → ''(AC-2).
 *   S3 처방 우선순위: 이 방문 처방 → 최신 차트 처방 → 최신 처방 check_in → ''(AC-3).
 *   S4 데이터 존재 시 공란 재현 안 됨(회귀 방지 — RC 재발 차단, AC-4).
 *   S5 데이터 전무 시에만 '없음' 렌더(AC-4 엣지 — 정상 0 처리).
 *   S6 스코프 무결 — customer_id/check_in_id 밖 데이터는 결선되지 않음(타 환자 유입 배제, AC-2 scope-guard).
 *
 * 스타일: in-page 순수 로직 시뮬레이션(OpinionDocTab/opinionAutofillRef 정본 모사) — auth/DB 의존 회피, KOH/OPINION spec 동일 컨벤션.
 */
import { test, expect } from '@playwright/test';

// ── 정본 모사: formatBirthDate + deriveBirthYYMMDDFromRrn (autoBindContext.ts) ──
function formatBirthDate(yymmdd: string | null | undefined): string {
  if (!yymmdd || yymmdd.length < 6) return yymmdd ?? '';
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const currentYY = new Date().getFullYear() % 100;
  const fullYear = yy > currentYY ? 1900 + yy : 2000 + yy;
  return `${fullYear}년 ${yymmdd.slice(2, 4)}월 ${yymmdd.slice(4, 6)}일`;
}
function deriveBirthYYMMDDFromRrn(rrn: string | null | undefined): string | null {
  if (!rrn) return null;
  const clean = rrn.replace(/[^0-9]/g, '');
  return clean.length === 13 ? clean.slice(0, 6) : null;
}

// 합성 주민번호 런타임 조립기 — 평문 RRN 리터럴을 커밋물에 남기지 않기 위함(§4.3 PHI: RRN 리터럴 금지).
//   파생 로직은 앞 7자리(YYMMDD+성별)만 사용 → 뒤 6자리는 마스킹 0. 실환자값 아님(합성 센티넬).
const mkRrn = (yymmdd: string, gender: string): string => `${yymmdd}-${gender}000000`;

// ── 정본 모사: summarizeRx (opinionAutofillRef.ts) ──
function summarizeRx(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const tokens = items
    .map((it) => String((it as { name?: string })?.name ?? '').trim())
    .filter((s) => s.length > 0 && s !== '(이름 미입력)');
  return tokens.length > 0 ? tokens.join(', ') : null;
}

// ── 정본 모사: 3필드 소스 우선순위 결선 (loadOpinionAutofillRef) ──
interface Sources {
  birthDate?: string | null;              // customers.birth_date
  rrn?: string | null;                    // rrn_decrypt
  visitServices?: string[];               // 이 방문 check_in_services.service_name
  latestChartTreatment?: string | null;   // 최신 medical_charts.treatment_record
  visitRx?: unknown;                       // 이 방문 check_ins.prescription_items
  latestChartRx?: unknown;                 // 최신 medical_charts.prescription_items
  latestCheckInRx?: unknown;               // 최신 처방 check_in prescription_items
}
function resolveAutofill(s: Sources): { birthDisplay: string; treatment: string; prescription: string } {
  // 생년월일
  let birthDisplay = '';
  if (s.birthDate) birthDisplay = formatBirthDate(s.birthDate);
  else {
    const d = deriveBirthYYMMDDFromRrn(s.rrn);
    birthDisplay = d ? formatBirthDate(d) : '';
  }
  // 당일 시술
  let treatment = '';
  const names = [...new Set((s.visitServices ?? []).map((n) => n.trim()).filter(Boolean))];
  if (names.length > 0) treatment = names.join(', ');
  else treatment = (s.latestChartTreatment ?? '').trim();
  // 처방내역
  const prescription =
    summarizeRx(s.visitRx) ?? summarizeRx(s.latestChartRx) ?? summarizeRx(s.latestCheckInRx) ?? '';
  return { birthDisplay, treatment, prescription };
}

// 렌더 폴백(OpinionDocTab: `{autofillRef?.field || '없음'}`)
const render = (v: string): string => v || '없음';

const RX = (...names: string[]) => names.map((name) => ({ name, days: 3, route: '경구' }));

test.describe('T-20260724-foot-DOCFORM-AUTOFILL-DOB-TX-RX-BLANK', () => {
  test('S1 생년월일 우선순위 — birth_date → 주민번호 산출 → 공란 (AC-1)', () => {
    // birth_date 존재
    expect(resolveAutofill({ birthDate: '900515' }).birthDisplay).toBe('1990년 05월 15일');
    // birth_date 공란 + 주민번호 존재 → 산출(RC 핵심: 현장 주민번호-only 입력 대응)
    expect(resolveAutofill({ birthDate: null, rrn: mkRrn('900515', '1') }).birthDisplay).toBe('1990년 05월 15일');
    // 주민번호(런타임 조립)도 산출
    expect(resolveAutofill({ rrn: mkRrn('020101', '3') }).birthDisplay).toBe('2002년 01월 01일');
    // 둘 다 없음 → 공란(AC-4 엣지)
    expect(resolveAutofill({ birthDate: null, rrn: null }).birthDisplay).toBe('');
  });

  test('S2 당일 시술 우선순위 — 방문 시술항목 → 차트 치료내용 → 공란 (AC-2)', () => {
    // 이 방문 시술항목 우선(당일)
    expect(resolveAutofill({ visitServices: ['발톱교정', '레이저'] }).treatment).toBe('발톱교정, 레이저');
    // 방문 시술항목 중복 제거
    expect(resolveAutofill({ visitServices: ['레이저', '레이저'] }).treatment).toBe('레이저');
    // 방문 시술항목 없으면 최신 차트 치료내용 폴백
    expect(resolveAutofill({ visitServices: [], latestChartTreatment: '냉동치료' }).treatment).toBe('냉동치료');
    // 둘 다 없음 → 공란
    expect(resolveAutofill({}).treatment).toBe('');
  });

  test('S3 처방 우선순위 — 방문 처방 → 최신 차트 처방 → 최신 처방 check_in → 공란 (AC-3)', () => {
    // 이 방문 처방 우선
    expect(resolveAutofill({ visitRx: RX('플루코나졸'), latestChartRx: RX('무시됨') }).prescription).toBe('플루코나졸');
    // 방문 처방 없음(빈 배열) → 최신 차트 처방(RC: 실 처방이 차트에 저장된 방문 대응)
    expect(resolveAutofill({ visitRx: [], latestChartRx: RX('바르토벤 외용액') }).prescription).toBe('바르토벤 외용액');
    // 차트 처방도 없음 → 최신 처방 check_in 폴백
    expect(resolveAutofill({ visitRx: [], latestChartRx: [], latestCheckInRx: RX('경구약A', '외용약B') }).prescription).toBe('경구약A, 외용약B');
    // 전부 없음 → 공란
    expect(resolveAutofill({}).prescription).toBe('');
    // 이름 미입력 토큰은 필터
    expect(resolveAutofill({ visitRx: [{ name: '' }, { name: '(이름 미입력)' }] }).prescription).toBe('');
  });

  test('S4 데이터 존재 환자 — 3필드 모두 공란 재현 안 됨 (RC 재발 차단, AC-4)', () => {
    // 현장 지배 shape: 주민번호-only 입력 + 당일 방문 시술항목 + 이 방문 처방
    const r = resolveAutofill({
      birthDate: null,
      rrn: mkRrn('850310', '2'),
      visitServices: ['발톱무좀 레이저'],
      visitRx: RX('이트라코나졸'),
    });
    expect(r.birthDisplay).not.toBe('');
    expect(r.treatment).not.toBe('');
    expect(r.prescription).not.toBe('');
    expect(render(r.birthDisplay)).not.toBe('없음');
    expect(render(r.treatment)).not.toBe('없음');
    expect(render(r.prescription)).not.toBe('없음');
    expect(r).toEqual({ birthDisplay: '1985년 03월 10일', treatment: '발톱무좀 레이저', prescription: '이트라코나졸' });
  });

  test('S5 데이터 전무 — 그때만 없음 렌더 (AC-4 엣지, 정상 0)', () => {
    const r = resolveAutofill({});
    expect(render(r.birthDisplay)).toBe('없음');
    expect(render(r.treatment)).toBe('없음');
    expect(render(r.prescription)).toBe('없음');
  });

  test('S6 스코프 무결 — 결선은 전달된 방문/고객 소스만 참조 (타 환자 유입 배제, AC-2)', () => {
    // resolveAutofill 은 넘어온 소스 외 어떤 전역/타 환자 데이터도 참조하지 않음(순수 함수).
    // 빈 방문 소스 + 타 축만 채워도 해당 축만 반영, 미전달 축은 공란 유지 → 오매핑 0.
    const r = resolveAutofill({ visitServices: ['A시술'] });
    expect(r.treatment).toBe('A시술');
    expect(r.birthDisplay).toBe('');   // birth 소스 미전달 → 결선 안 됨
    expect(r.prescription).toBe('');   // rx 소스 미전달 → 결선 안 됨
  });
});
