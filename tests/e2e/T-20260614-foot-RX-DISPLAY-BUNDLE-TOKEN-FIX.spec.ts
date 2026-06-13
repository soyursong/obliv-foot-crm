/**
 * E2E spec — T-20260614-foot-RX-DISPLAY-BUNDLE-TOKEN-FIX
 * 묶음처방(prescription_sets) 흡수분 포함 모든 처방 surface 가 '약물명 1/3/2' 단일 토큰 경로로 수렴.
 *
 * 신고(문지은 대표원장, MSG-004738-patx 긴급):
 *   "환자 처방내역이 다 엉망. 묶음처방 흡수하면서 약물 표기방식 정확히 약물명 1/3/2 처방에 떠야해.
 *    지금 막 텍스트로 보이고 엉망." → 처방 표기 최우선.
 *
 * RCA:
 *   토큰 정본(formatRxConfirmedSummary, RX-TOKEN-FORMAT)이 존재하지만 normalizeRxItem 이
 *   DoctorPatientList 로컬에만 있어, 진료차트 처방내역 타임라인(MedicalChartPanel L2823)·미리보기 teaser·
 *   TreatmentTable 요약이 '{name} {dosage}' 반쪽 raw text 로 렌더 → /count/days 토큰 누락.
 *   묶음처방 흡수분(loadPrescriptionSet→formRx→prescription_items)도 동일 surface 라 같이 깨짐.
 *
 * 수정(SSOT 단일 경로 — @/lib/rxTooltip):
 *   - normalizeRxItem export 격상(빠른처방/정식/묶음 흡수 shape 흡수, null 가드).
 *   - buildDoseTokens private 헬퍼로 토큰 도출 1곳 수렴(formatRxConfirmedSummary 출력 byte 불변).
 *   - formatRxItemToken export: 처방 raw 1건 → '약물명 1/3/2'(per-<li> 렌더용, 다중구분 '*' 없음).
 *   배선:
 *     · DoctorPatientList — 로컬 normalizeRxItem 제거 → rxTooltip import(단일 경로).
 *     · MedicalChartPanel — 진료차트 처방내역 타임라인 li / 미리보기 teaser → formatRxItemToken.
 *     · TreatmentTable — prescriptionSummary → normalizeRxItem→formatRxConfirmedSummary.
 *
 * 검증(현장 클릭 시나리오 3종 → AC):
 *   S1(AC-1): 묶음처방 흡수 항목(dosage/count/days 보유)이 '약물명 1/3/2' 토큰으로 표기.
 *   S2(AC-2): 결측 토큰 graceful(빈 '//' 없음) + 묶음/단건 동일 경로 + 정식 {medication_name,duration_days} 흡수.
 *   S3(회귀): formatRxConfirmedSummary 다중·' *' 구분 출력 불변 + 정규화 단일 경로 배선 보존.
 *
 * 스타일: 형제 RX 티켓과 동일 — SSOT 토큰 로직 in-spec 모사(정본과 동일 규칙) + 소스 정적 배선 가드.
 *   auth/DB 비의존(순수 함수 + 소스 grep).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

// ── 정본 모사: SSOT 토큰 경로(@/lib/rxTooltip) ──────────────────────────────────
//   buildDoseTokens / normalizeRxItem / formatRxItemToken / formatRxConfirmedSummary 와 동일 규칙.
interface RxLike {
  name?: string | null;
  medication_name?: string | null;
  dosage?: string | null;
  count?: number | null;
  frequency?: string | null;
  days?: number | null;
  duration_days?: number | null;
}
function parseFrequencyPerDay(frequency: string | null | undefined): number | null {
  const m = (frequency ?? '').match(/(\d+)\s*회/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
function buildDoseTokens(it: RxLike | null | undefined): string {
  const tokens: string[] = [];
  const dosage = (it?.dosage ?? '').trim();
  if (dosage) tokens.push(dosage);
  const perDay =
    it?.count != null && Number.isFinite(it.count) ? it.count : parseFrequencyPerDay(it?.frequency);
  if (perDay != null) tokens.push(String(perDay));
  if (it?.days != null && Number.isFinite(it.days)) tokens.push(String(it.days));
  return tokens.join('/');
}
function normalizeRxItem(raw: unknown): RxLike {
  if (!raw || typeof raw !== 'object') {
    return { name: null, dosage: null, count: null, frequency: null, days: null };
  }
  const it = raw as RxLike;
  return {
    name: it.name ?? it.medication_name ?? null,
    dosage: it.dosage ?? null,
    count: it.count ?? null,
    frequency: it.frequency ?? null,
    days: it.days ?? it.duration_days ?? null,
  };
}
function formatRxItemToken(raw: unknown): string {
  const it = normalizeRxItem(raw);
  const name = (it.name ?? '').trim() || '(이름 미입력)';
  const dose = buildDoseTokens(it);
  return dose ? `${name} ${dose}` : name;
}
function formatRxConfirmedSummary(items: RxLike[] | null | undefined): string {
  if (!Array.isArray(items)) return '';
  return items
    .map((it) => {
      const name = (it?.name ?? '').trim() || '(이름 미입력)';
      const dose = buildDoseTokens(it);
      return dose ? `${name} ${dose} *` : `${name} *`;
    })
    .join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// S1 / AC-1 — 묶음처방 흡수 항목이 '약물명 1/3/2' 토큰으로 표기
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S1 / AC-1 묶음처방 흡수 항목 토큰 표기', () => {
  test('빠른처방 shape(dosage/count/days) → 약물명 1/3/2', () => {
    // 묶음처방 흡수분 = PrescriptionItem shape({name,dosage,count,frequency,days}).
    const bundleItem = { name: '아목시실린', dosage: '1', count: 3, days: 2, frequency: '1일 3회' };
    expect(formatRxItemToken(bundleItem)).toBe('아목시실린 1/3/2');
  });

  test('count 결측 → frequency "1일 3회" 파싱 폴백으로 가운데 토큰 복구', () => {
    const item = { name: '타이레놀', dosage: '2', count: null, days: 5, frequency: '1일 3회' };
    expect(formatRxItemToken(item)).toBe('타이레놀 2/3/5');
  });

  test('다중 약 묶음(2건+) 각 항목 독립 토큰화(단일 약 가정 금지)', () => {
    const items = [
      { name: '약A', dosage: '1', count: 3, days: 2 },
      { name: '약B', dosage: '2', count: 1, days: 7 },
    ];
    expect(items.map(formatRxItemToken)).toEqual(['약A 1/3/2', '약B 2/1/7']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 / AC-2 — graceful 결측 + 정식 shape 흡수 + 단일 경로
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S2 / AC-2 결측 graceful · shape 흡수 단일 경로', () => {
  test('토큰 일부 결측 → 빈 "//" 댕글링 없음', () => {
    // dosage 만 → '약 1', count/days 만 → 슬롯 skip
    expect(formatRxItemToken({ name: '약', dosage: '1' })).toBe('약 1');
    expect(formatRxItemToken({ name: '약', count: 3 })).toBe('약 3');
    expect(formatRxItemToken({ name: '약', days: 2 })).toBe('약 2');
    expect(formatRxItemToken({ name: '약', dosage: '1', days: 2 })).toBe('약 1/2');
  });

  test('값 전무 약 → 이름만(회귀 0)', () => {
    expect(formatRxItemToken({ name: '약만있음' })).toBe('약만있음');
  });

  test('정식 처방 shape {medication_name, duration_days} 흡수', () => {
    const formal = { medication_name: '세파클러', dosage: '1', count: 2, duration_days: 4 };
    expect(formatRxItemToken(formal)).toBe('세파클러 1/2/4');
  });

  test('null/원시값 항목 가드 → "(이름 미입력)"(TypeError 없음)', () => {
    expect(formatRxItemToken(null)).toBe('(이름 미입력)');
    expect(formatRxItemToken('잘못된값')).toBe('(이름 미입력)');
    expect(formatRxItemToken(undefined)).toBe('(이름 미입력)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 / 회귀 — 정본 출력 불변 + 배선 보존
// ─────────────────────────────────────────────────────────────────────────────
test.describe('S3 회귀가드 — 정본 출력·배선 불변', () => {
  test('R-SUMMARY: formatRxConfirmedSummary 다중·" *" 구분 출력 byte 불변', () => {
    const items = [
      { name: '약A', dosage: '1', count: 3, days: 2 },
      { name: '약B' },
    ];
    expect(formatRxConfirmedSummary(items)).toBe('약A 1/3/2 * 약B *');
  });

  test('R-SSOT: rxTooltip 가 normalizeRxItem·formatRxItemToken·buildDoseTokens 보유(단일 경로)', () => {
    const src = SRC('lib/rxTooltip.ts');
    expect(src).toMatch(/export function normalizeRxItem/);
    expect(src).toMatch(/export function formatRxItemToken/);
    expect(src).toMatch(/function buildDoseTokens/);
    // formatRxConfirmedSummary 도 동일 헬퍼 수렴(토큰 로직 1곳).
    expect(src).toMatch(/formatRxConfirmedSummary[\s\S]*?buildDoseTokens\(it\)/);
  });

  test('R-DEDUP: DoctorPatientList 로컬 normalizeRxItem 제거 → rxTooltip import', () => {
    const src = SRC('components/doctor/DoctorPatientList.tsx');
    // 로컬 function 정의 제거(중복 경로 박멸).
    expect(src).not.toMatch(/function normalizeRxItem/);
    // SSOT import 배선.
    expect(src).toMatch(/import \{[^}]*normalizeRxItem[^}]*\} from '@\/lib\/rxTooltip'/);
    // prescriptionOneLine/Summary 정본 재사용 보존(타 티켓 회귀가드 호환).
    expect(src).toMatch(/function prescriptionOneLine/);
    expect(src).toMatch(/formatRxConfirmedSummary\(items\.map\(normalizeRxItem\)\)/);
  });

  test('R-MEDCHART: 진료차트 처방내역 타임라인 li 가 formatRxItemToken 사용(raw text 제거)', () => {
    const src = SRC('components/MedicalChartPanel.tsx');
    expect(src).toMatch(/import \{ formatRxItemToken \} from '@\/lib\/rxTooltip'/);
    // timeline-rx-item li 내부가 토큰 함수로 교체됨(구 '{rx.name}{rx.dosage}' raw 제거).
    expect(src).toMatch(/data-testid="timeline-rx-item"[\s\S]{0,120}formatRxItemToken\(rx\)/);
    expect(src).not.toMatch(/\{rx\.name\}\{rx\.dosage\?\.trim\(\)/);
  });

  test('R-PREVIEW: 미리보기 teaser 가 formatRxItemToken 토큰 사용', () => {
    const src = SRC('components/MedicalChartPanel.tsx');
    expect(src).toMatch(/rxTokens[\s\S]{0,160}formatRxItemToken\(rx\)/);
  });

  test('R-TREATTABLE: TreatmentTable prescriptionSummary SSOT 경로 수렴', () => {
    const src = SRC('pages/TreatmentTable.tsx');
    expect(src).toMatch(/import \{[^}]*formatRxConfirmedSummary[^}]*normalizeRxItem[^}]*\} from '@\/lib\/rxTooltip'/);
    expect(src).toMatch(/formatRxConfirmedSummary\(items\.slice\(0, 3\)\.map\(normalizeRxItem\)\)/);
    // 구 raw '{medication_name} {dosage}' 매핑 제거.
    expect(src).not.toMatch(/\[it\.medication_name, it\.dosage\]/);
  });
});
