/**
 * E2E spec — T-20260625-foot-RXPANEL-DISPLAY-ROUTE-NOTES-REMOVE
 * 의사 처방 화면(DoctorTreatmentPanel) 처방항목 행에서 route(투여경로)·notes(설명/메모)
 * 표시 span 2개를 제거 → SSOT formatRxItemToken '약물명 1/3/2' 단일 토큰만 노출.
 *
 * 신고(문지은 대표원장, MSG-20260625-105111-294o):
 *   "약 이름 뒤에 숫자 3개만 ({name} {dosage}/{횟수}/{일수}) 나오게.
 *    route(투여경로), notes(설명/메모) 표시는 빼줘."
 *   코드 위치 지정: DoctorTreatmentPanel.tsx L469(route), L470-472(notes) 둘 다 제거.
 *
 * supersedes: T-20260614-foot-RX-DISPLAY-BUNDLE-TOKEN-FIX (동일 reporter가 'route 부가칩 보존'을 명시 번복).
 *
 * 검증(AC → 정적 소스 가드 + 순수 토큰 회귀):
 *   AC-1: 처방항목 행에 formatRxItemToken 토큰만, route span·notes span 제거.
 *   AC-2: item.route/item.notes 데이터 필드 보존(표시만 제거) — DB 무변경(db_change:false).
 *   AC-3: notes span(ml-auto) 제거 후에도 삭제 ✕ 버튼이 ml-auto 우측정렬 유지.
 *   AC-4: 토큰 렌더 회귀 0 — formatRxItemToken '약물명 1/3/2' 규칙 불변.
 *
 * 스타일: 형제 RX 티켓과 동일 — 정본 토큰 로직 in-spec 모사 + 소스 정적 가드(auth/DB 비의존).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const PANEL = () => SRC('components/doctor/DoctorTreatmentPanel.tsx');

// ── 정본 모사: SSOT 토큰(@/lib/rxTooltip formatRxItemToken) 규칙과 동일 ──────────
interface RxLike {
  name?: string | null;
  medication_name?: string | null;
  dosage?: string | null;
  count?: number | null;
  frequency?: string | null;
  days?: number | null;
  duration_days?: number | null;
  route?: string | null;
  notes?: string | null;
}
function parseFrequencyPerDay(frequency: string | null | undefined): number | null {
  const m = (frequency ?? '').match(/(\d+)\s*회/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
function buildDoseTokens(it: RxLike): string {
  const tokens: string[] = [];
  const dosage = (it?.dosage ?? '').trim();
  if (dosage) tokens.push(dosage);
  const perDay =
    it?.count != null && Number.isFinite(it.count) ? it.count : parseFrequencyPerDay(it?.frequency);
  if (perDay != null) tokens.push(String(perDay));
  if (it?.days != null && Number.isFinite(it.days)) tokens.push(String(it.days));
  return tokens.join('/');
}
function formatRxItemToken(raw: RxLike): string {
  const name = (raw.name ?? raw.medication_name ?? '').trim() || '(이름 미입력)';
  const dose = buildDoseTokens({ ...raw, days: raw.days ?? raw.duration_days });
  return dose ? `${name} ${dose}` : name;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — 처방항목 행에 route/notes 표시 span 제거, 토큰만 노출
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 처방항목 행 route·notes span 제거', () => {
  test('처방항목 행 토큰 span(formatRxItemToken) 보존', () => {
    const src = PANEL();
    expect(src).toMatch(/data-testid="prescription-item-token"[\s\S]{0,60}formatRxItemToken\(item\)/);
  });

  test('route 표시 span 제거 — {item.route && <span ...>{item.route}</span>} 없음', () => {
    const src = PANEL();
    // 처방항목 행의 route 표시 span 패턴이 사라졌는지(데이터 참조가 아니라 표시 렌더).
    expect(src).not.toMatch(/\{item\.route && <span[^>]*>\{item\.route\}<\/span>\}/);
  });

  test('notes 표시 span 제거 — {item.notes && (<span ...>{item.notes}</span>)} 없음', () => {
    const src = PANEL();
    expect(src).not.toMatch(/\{item\.notes && \(\s*<span[^>]*>\{item\.notes\}<\/span>/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — 데이터 보존(표시 span만 제거, item.route/notes 필드·DB 무변경)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 데이터 보존', () => {
  test('PrescriptionItem 타입의 route/notes 필드 정의 보존(데이터 삭제 아님)', () => {
    // 본 티켓은 DoctorTreatmentPanel 표시 span만 제거 → 데이터 모델(PrescriptionItem)은 무변경.
    const src = SRC('components/admin/PrescriptionSetsTab.tsx');
    expect(src).toMatch(/export interface PrescriptionItem/);
    expect(src).toMatch(/\broute:\s*string/);
    expect(src).toMatch(/\bnotes:\s*string/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — 레이아웃: notes span(ml-auto) 제거 후 삭제 ✕ 버튼 우측정렬(ml-auto) 유지
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 삭제 버튼 우측정렬 유지', () => {
  test('삭제 ✕ 버튼이 ml-auto 보유(우측 push) + ✕ 보존', () => {
    const src = PANEL();
    // !confirmed 가드 삭제 버튼이 ml-auto 로 우측 정렬을 가져감.
    expect(src).toMatch(/!confirmed && \([\s\S]{0,200}className="ml-auto[\s\S]{0,200}✕/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — 토큰 렌더 회귀 0 (formatRxItemToken '약물명 1/3/2' 규칙 불변)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-4 토큰 회귀 0', () => {
  test('약물명 1/3/2 토큰 정상(dosage/count/days)', () => {
    expect(formatRxItemToken({ name: '아목시실린', dosage: '1', count: 3, days: 2 })).toBe('아목시실린 1/3/2');
  });

  test('count 결측 → frequency "1일 3회" 폴백', () => {
    expect(formatRxItemToken({ name: '타이레놀', dosage: '2', frequency: '1일 3회', days: 5 })).toBe('타이레놀 2/3/5');
  });

  test('route/notes 가 토큰에 섞이지 않음(표시 제거 후에도 토큰 규칙 불변)', () => {
    // route='경구', notes='식후' 가 있어도 토큰 출력엔 영향 없음.
    expect(formatRxItemToken({ name: '록소프로펜', dosage: '1', frequency: '1일 3회', days: 3, route: '경구', notes: '식후 복용' })).toBe('록소프로펜 1/3/3');
  });

  test('값 전무 → 이름만', () => {
    expect(formatRxItemToken({ name: '연고만' })).toBe('연고만');
  });
});
