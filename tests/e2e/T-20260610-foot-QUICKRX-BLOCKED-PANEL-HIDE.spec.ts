/**
 * E2E spec — T-20260610-foot-QUICKRX-BLOCKED-PANEL-HIDE
 * 빠른처방 불가(원내 비잔류) 환자 차단 안내패널 완전 제거 → 빈 렌더(null).
 *
 * 신고(문지은 대표원장 6/10, #project-doai-crm-풋확장):
 *   부모 INCLINIC-GATE(deployed)가 추가한 amber "빠른처방 불가" 박스(Ban 아이콘 + 레이블 + 메시지
 *   + '차트 열기' 버튼)가 지저분하다. "불가메세지 표시하지마… 그냥 버튼이 없으면 되는거"(옵션3).
 *   → 비잔류 환자는 QuickRxBar 영역을 아무것도 렌더하지 않는 빈 공간으로 둔다.
 *
 * 핵심: 게이트 판정 로직(blockedByUiGate = !uiGate.allowed)은 불변 — 차단 상태의 '표시'만 제거.
 *   QuickRxBar 구현 정본: `if (blockedByUiGate) { return null; }`
 *
 * 스타일: 형제 티켓(INCLINIC-GATE / CHARTBTN)과 동일 — 차단 게이트 SSOT in-page 모사
 *   + 소스 정적 가드. auth/DB 비의존(unit 프로젝트).
 *
 * AC:
 *   AC-1: 귀가/진료완료 등 비잔류 환자 행 확장 패널 = amber 박스·"빠른처방 불가" 텍스트·
 *         '차트 열기' 버튼 미표시(빈 영역).
 *   AC-2: 원내 잔류 환자는 기존 빠른처방 버튼 정상 표시(회귀 방지).
 *   AC-3: 렌더 결과에 data-testid="quick-rx-blocked" 요소 부재.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

// ── 정본 모사: checkRxInClinic (lib/inClinicRxGate.ts) — 게이트 판정은 불변(SSOT) ──
type GateReason = 'not_today' | 'discharged' | 'cancelled' | 'missing';
interface GateResult { allowed: boolean; reason: GateReason | null }
const seoulISODate = (iso: string): string =>
  new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const checkRxInClinic = (
  checkIn: { status?: string | null; checked_in_at?: string | null } | null | undefined,
  todayISO: string,
): GateResult => {
  if (!checkIn || !checkIn.checked_in_at) return { allowed: false, reason: 'missing' };
  const status = checkIn.status ?? '';
  if (status === 'cancelled') return { allowed: false, reason: 'cancelled' };
  if (seoulISODate(checkIn.checked_in_at) !== todayISO) return { allowed: false, reason: 'not_today' };
  if (status === 'done') return { allowed: false, reason: 'discharged' };
  return { allowed: true, reason: null };
};

const TODAY = '2026-06-10';
const todayCheckedIn = `${TODAY}T03:00:00+09:00`; // KST 오전 = 당일 잔류

/**
 * QuickRxBar 차단 분기 렌더 결정 모사(구현 정본 ~L333) — PANEL-HIDE 후:
 *   if (blockedByUiGate) { return null; }
 * → 비잔류면 onOpenChart 유무·차단 사유 무관 항상 빈 렌더(null). 잔류면 처방 버튼.
 */
function quickRxRender(
  checkIn: { status?: string | null; checked_in_at?: string | null },
  todayISO = TODAY,
): 'null' | 'rx-buttons' {
  const blockedByUiGate = !checkRxInClinic(checkIn, todayISO).allowed;
  if (blockedByUiGate) return 'null'; // PANEL-HIDE: 빈 렌더(return null) 를 의미하는 마커.
  return 'rx-buttons';
}

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — AC-1: 불가(비잔류) 환자 빈 렌더
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S1 AC-1 — 비잔류 환자 빈 렌더(차단 안내 UI 전체 제거)', () => {
  test('귀가(done) 환자 → 빈 렌더(null)', () => {
    expect(quickRxRender({ status: 'done', checked_in_at: todayCheckedIn })).toBe('null');
  });

  test('전날·미래·취소·미체크인 환자 모두 → 빈 렌더(null)', () => {
    const cases = [
      { status: 'confirmed', checked_in_at: '2026-06-09T03:00:00+09:00' }, // 전날
      { status: 'registered', checked_in_at: '2026-06-11T03:00:00+09:00' }, // 미래
      { status: 'cancelled', checked_in_at: todayCheckedIn }, // 취소
      { status: 'registered', checked_in_at: null }, // checked_in_at 누락(missing)
    ];
    for (const c of cases) {
      expect(quickRxRender(c)).toBe('null');
    }
  });

  test('소스 정본: blockedByUiGate → 무조건 return null (조건부 차트열기·앰버 분기 제거)', () => {
    const src = SRC('components/doctor/QuickRxBar.tsx');
    // 차단 분기 = 빈 렌더. `if (!onOpenChart) return null; return <button…>` 형태(CHARTBTN) 폐지.
    expect(src).toMatch(/if\s*\(blockedByUiGate\)\s*\{\s*return null;\s*\}/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 — AC-2: 원내 잔류 환자 정상 처방 버튼(회귀 방지)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S2 AC-2 — 원내 잔류 환자 빠른처방 정상(무회귀)', () => {
  for (const status of [
    'registered', 'consultation', 'examination', 'treatment_waiting',
    'preconditioning', 'laser', 'payment_waiting',
  ]) {
    test(`당일 잔류 + status=${status} → 처방 버튼 노출(차단 분기 미진입)`, () => {
      expect(quickRxRender({ status, checked_in_at: todayCheckedIn })).toBe('rx-buttons');
    });
  }

  test('게이트 판정 로직 불변 — 잔류(allowed) 환자만 처방 버튼', () => {
    expect(checkRxInClinic({ status: 'laser', checked_in_at: todayCheckedIn }, TODAY).allowed).toBe(true);
    expect(checkRxInClinic({ status: 'done', checked_in_at: todayCheckedIn }, TODAY).allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 — AC-3: data-testid="quick-rx-blocked" / 차단 안내 UI 잔재 부재
// ═══════════════════════════════════════════════════════════════════════════
test.describe('S3 AC-3 — 차단 안내 UI 잔재 부재(소스 가드)', () => {
  test('quick-rx-blocked testid 부재', () => {
    expect(SRC('components/doctor/QuickRxBar.tsx')).not.toContain('quick-rx-blocked');
  });

  test('차단용 quick-rx-open-chart 버튼 부재(빈 렌더로 통일)', () => {
    expect(SRC('components/doctor/QuickRxBar.tsx')).not.toContain('data-testid="quick-rx-open-chart"');
  });

  test('amber Ban 차단 패널 / "빠른처방 불가" 인라인 문구 부재', () => {
    const src = SRC('components/doctor/QuickRxBar.tsx');
    expect(src).not.toMatch(/\bBan\b/); // lucide Ban 아이콘 부활 금지
    // rxInClinicShortLabel("빠른처방 불가") 인라인 차단 패널 렌더 부활 금지(import 자체 제거 확인).
    expect(src).not.toContain('rxInClinicShortLabel');
  });
});
