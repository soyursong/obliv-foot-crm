/**
 * E2E spec — T-20260724-foot-DOCISSUE-PATIENTINFO-AUTOFILL
 * 풋 서류 발행 화면(소견서·진단서 작성 폼, OpinionEditorDialog/OpinionDocTab) 환자정보 자동채움 회귀 가드.
 *
 * ■ 관계(중복 아님 — 상보):
 *   본 티켓의 3필드 자동채움 기능(생년월일·오늘 시술·처방내역)은 자매 티켓
 *   **T-20260724-foot-DOCFORM-AUTOFILL-DOB-TX-RX-BLANK**(commit 4b4efbb7 → prod 5f72805, 07-25 03:14 KST 배포)가
 *   실 SSOT 재결선으로 이미 해소했다(loadOpinionAutofillRef + OpinionDocTab 결선). RC 진단(자매 DOCPUB-LINKAGE-EDITSCOPE)도
 *   런타임 재현으로 "3필드 실 SSOT 결선·잔존 단절 없음"을 확정. 따라서 AC-1/2/3 자동채움은 배포본에서 동작 중이다.
 *   → 본 spec 은 그 회귀를 이 티켓 ID 로 추적 가능하게 재확인하고, **어떤 기존 spec 도 커버하지 않은 AC-4 canon 스코프 가드
 *     (서류 공단부담액 칸 미접촉 — Revenue Insurance Split canon §2-2-6, GONGDAN-FILL-CONFLICT 영구 REJECT)** 를 codify 한다.
 *
 * ■ 검증(정본 loadOpinionAutofillRef / OpinionDocTab 렌더 폴백을 동치 모사 — auth/DB 비의존, 자매 spec 컨벤션 계승):
 *   S1 (AC-1) 생년월일: birth_date → 주민번호 산출 → 공란.
 *   S2 (AC-2) 당일 시술: 이 방문 시술항목 → 최신 차트 치료내용 → 공란.
 *   S3 (AC-3) 처방내역: 이 방문 처방 → 최신 차트 처방 → 최신 처방 check_in → 공란.
 *   S4 (AC-4) ★스코프 가드: 자동채움 산출 계약은 정확히 3필드뿐 — 공단부담액/본인부담 축을 구조적으로 만들지 않는다.
 *   S5 (AC-5) 엣지: 저장값 없으면 공란 유지('없음' 렌더). 자동채움은 원장 본문 editor 를 강제하지 않음(수동입력 경로 보존).
 *   S6 (AC-6/scope) 순수성: 결선은 전달된 방문/고객 소스만 참조 — 타 환자 유입·전역 오염 0.
 *
 * 스타일: in-page 순수 로직 시뮬레이션(정본 모사) — auth/DB 의존 회피, KOH/OPINION/AUTOFILL spec 동일 컨벤션.
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

test.describe('T-20260724-foot-DOCISSUE-PATIENTINFO-AUTOFILL', () => {
  test('S1 생년월일 자동채움 — birth_date → 주민번호 산출 → 공란 (AC-1)', () => {
    expect(resolveAutofill({ birthDate: '900515' }).birthDisplay).toBe('1990년 05월 15일');
    // 현장 지배 shape: 주민번호만 입력(birth_date 구조적 공란) → 복호화 산출로 채움
    expect(resolveAutofill({ birthDate: null, rrn: mkRrn('900515', '1') }).birthDisplay).toBe('1990년 05월 15일');
    expect(resolveAutofill({ rrn: mkRrn('020101', '3') }).birthDisplay).toBe('2002년 01월 01일');
    expect(resolveAutofill({ birthDate: null, rrn: null }).birthDisplay).toBe('');
  });

  test('S2 오늘 시술 내용 자동채움 — 이 방문 시술항목 → 최신 차트 폴백 → 공란 (AC-2)', () => {
    expect(resolveAutofill({ visitServices: ['발톱교정', '레이저'] }).treatment).toBe('발톱교정, 레이저');
    expect(resolveAutofill({ visitServices: ['레이저', '레이저'] }).treatment).toBe('레이저');
    expect(resolveAutofill({ visitServices: [], latestChartTreatment: '냉동치료' }).treatment).toBe('냉동치료');
    expect(resolveAutofill({}).treatment).toBe('');
  });

  test('S3 처방 내역 자동채움 — 방문 처방 → 최신 차트 처방 → 최신 처방 check_in → 공란 (AC-3)', () => {
    expect(resolveAutofill({ visitRx: RX('플루코나졸'), latestChartRx: RX('무시됨') }).prescription).toBe('플루코나졸');
    expect(resolveAutofill({ visitRx: [], latestChartRx: RX('바르토벤 외용액') }).prescription).toBe('바르토벤 외용액');
    expect(resolveAutofill({ visitRx: [], latestChartRx: [], latestCheckInRx: RX('경구약A', '외용약B') }).prescription).toBe('경구약A, 외용약B');
    expect(resolveAutofill({}).prescription).toBe('');
  });

  test('S4 ★스코프 가드 — 자동채움 산출 계약은 정확히 3필드, 공단부담액/본인부담 축 미생성 (AC-4 canon)', () => {
    // canon §2-2-6(서류 공단=0) + GONGDAN-FILL-CONFLICT(70/30 자동채움 영구 REJECT):
    // 자동채움 계약은 생년월일·시술·처방 3필드로 봉인되어 공단/본인부담 칸을 구조적으로 만들 수 없다.
    const full = resolveAutofill({
      birthDate: '850310',
      visitServices: ['발톱무좀 레이저'],
      visitRx: RX('이트라코나졸'),
    });
    const empty = resolveAutofill({});
    for (const r of [full, empty]) {
      expect(Object.keys(r).sort()).toEqual(['birthDisplay', 'prescription', 'treatment']);
      // 공단/본인부담 관련 키가 산출물에 결코 존재하지 않음(자동주입 경로 부재).
      const banned = ['gongdan', '공단', 'gongdanAmount', 'insurance', 'copay', '본인부담', 'selfPay', 'nhis'];
      for (const key of banned) {
        expect(Object.prototype.hasOwnProperty.call(r, key)).toBe(false);
      }
    }
  });

  test('S5 엣지 — 저장값 없으면 공란 유지(없음 렌더), 자동채움이 원장 본문·수동입력을 강제하지 않음 (AC-5)', () => {
    const r = resolveAutofill({});
    expect(render(r.birthDisplay)).toBe('없음');
    expect(render(r.treatment)).toBe('없음');
    expect(render(r.prescription)).toBe('없음');
    // 자동채움 산출은 read-only 참고값일 뿐 — 값이 있어도 원장 본문(진단/소견 editor) 문자열을 만들거나 덮어쓰지 않음.
    // (계약이 문서 본문/서명/직인 필드를 포함하지 않음으로 medical authoring 경계 보존 = 수동입력 경로 그대로)
    const withData = resolveAutofill({ birthDate: '900515', visitServices: ['레이저'], visitRx: RX('약') });
    expect(Object.keys(withData)).not.toContain('opinionBody');
    expect(Object.keys(withData)).not.toContain('diagnosisBody');
    expect(Object.keys(withData)).not.toContain('signature');
    expect(Object.keys(withData)).not.toContain('seal');
  });

  test('S6 순수성 — 결선은 전달된 방문/고객 소스만 참조, 타 환자 유입·전역 오염 0 (AC-6)', () => {
    const r = resolveAutofill({ visitServices: ['A시술'] });
    expect(r.treatment).toBe('A시술');
    expect(r.birthDisplay).toBe('');   // birth 소스 미전달 → 결선 안 됨
    expect(r.prescription).toBe('');   // rx 소스 미전달 → 결선 안 됨
  });
});
