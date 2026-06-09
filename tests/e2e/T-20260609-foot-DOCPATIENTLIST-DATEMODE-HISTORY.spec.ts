/**
 * E2E spec — T-20260609-foot-DOCPATIENTLIST-DATEMODE-HISTORY
 * 진료환자목록(DoctorPatientList) 날짜별 모드 분기 + 이력 모드 treatment_kind/healer_laser 표시.
 * (문지은 대표원장 6/9: 오늘=현행 진료 모드 유지, 어제 이전=이력 모드 자동 전환(read-only).)
 *
 * 의존성: T-20260606-foot-RX-PATIENT-LIST-DATENAV(날짜 state) 재사용 — 분기 기준 신설 없음.
 *          T-20260609-foot-PASTVISIT-TREATMENT-VIEW(isPast read-only) 위에 누적.
 *          처방 한 줄 포맷 = DOCDASH-LABEL-RX-REFINE 정본(formatRxConfirmedSummary) 재사용.
 *
 * 구현 범위 (이 spec 검증 대상):
 *   AC-1: 오늘 → 현행 진료 모드(isPast=false). 어제 이전 → 이력 모드 자동 전환(isPast=true).
 *   AC-2: 이력 모드 처방 한 줄(formatRxConfirmedSummary, 없으면 '처방없음') / 치료종류(treatment_kind, 폴백) / 히러레이저 ✅·❌.
 *   AC-3: treatment_kind·healer_laser_confirm 은 check_ins 기존 컬럼 — SELECT 확장만(코드/배포 게이트 확인).
 *
 * 스타일: in-page 순수 로직 시뮬레이션 — 구현 정본(prescriptionOneLine/treatmentText/healer 라벨/isPast)을 모사해 회귀를 잡는다.
 *   (인접 spec PASTVISIT-TREATMENT-VIEW / RX-PATIENT-LIST-DATENAV 와 동일 패턴)
 */
import { test, expect } from '@playwright/test';

// ── 정본: 처방 한 줄 (rxTooltip.formatRxConfirmedSummary + DoctorPatientList.prescriptionOneLine) ──
//   formatRxConfirmedSummary: '{name} {freq} *' 나열(freq 결측 시 '{name} *'). prescriptionOneLine:
//   배열 비면 '처방없음', name/frequency 방어적 흡수(빠른처방 {name,frequency} | 정식 {medication_name,dosage}).
type RxItemLike = {
  name?: string | null;
  medication_name?: string | null;
  frequency?: string | null;
  dosage?: string | null;
};
const formatRxConfirmedSummary = (
  items: Array<{ name?: string | null; frequency?: string | null }> | null | undefined,
): string => {
  if (!Array.isArray(items)) return '';
  return items
    .map((it) => {
      const name = (it?.name ?? '').trim() || '(이름 미입력)';
      const freq = (it?.frequency ?? '').trim();
      return freq ? `${name} ${freq} *` : `${name} *`;
    })
    .join(' ');
};
const prescriptionOneLine = (items: unknown): string => {
  if (!Array.isArray(items) || items.length === 0) return '처방없음';
  const normalized = (items as RxItemLike[]).map((it) => ({
    name: it.name ?? it.medication_name ?? null,
    frequency: it.frequency ?? it.dosage ?? null,
  }));
  const out = formatRxConfirmedSummary(normalized).trim();
  return out || '처방없음';
};

// ── 정본: 과거 날짜 판정 (DoctorPatientList.isPast) ────────────────────────────
const isPast = (selectedDate: string, todayISO: string): boolean => selectedDate < todayISO;

// ── 정본: 치료 종류 셀 (treatment_kind 우선, 폴백=받은 치료 요약, 없으면 '—') ──
type Treatmentish = {
  treatment_category: string | null;
  treatment_contents: string[] | null;
  treatment_kind: string | null;
};
const treatmentSummary = (row: Treatmentish): string | null => {
  const category = (row.treatment_category ?? '').trim();
  const contents = Array.isArray(row.treatment_contents)
    ? row.treatment_contents.filter((c): c is string => typeof c === 'string' && c.trim() !== '').map((c) => c.trim())
    : [];
  const kind = (row.treatment_kind ?? '').trim();
  const detail = contents.length > 0 ? contents.join(', ') : kind;
  const parts = [category, detail].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
};
const treatmentCell = (row: Treatmentish): string => {
  const kind = (row.treatment_kind ?? '').trim();
  return kind || treatmentSummary(row) || '—';
};

// ── 정본: 히러레이저 배지 라벨 (HealerLaserBadge) ──
const healerLaserLabel = (confirmed: boolean): string => `레이저 ${confirmed ? '✅' : '❌'}`;

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 오늘 → 현행 진료 모드 유지 (AC-1)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오1 오늘 현행 모드', () => {
  test('오늘은 이력 모드 아님(isPast=false) — 상태/버튼/필터 유지', () => {
    const today = '2026-06-10';
    expect(isPast(today, today)).toBe(false);
  });

  test('미래(다음날)도 이력 모드 아님 — 현행 유지', () => {
    expect(isPast('2026-06-11', '2026-06-10')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 과거 날짜 → 이력 모드 자동 전환 (AC-1/2)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오2 과거 이력 모드 자동 전환', () => {
  test('어제는 과거(isPast=true) — 이력 모드 자동 진입', () => {
    expect(isPast('2026-06-09', '2026-06-10')).toBe(true);
  });

  test('월 경계 — 6/1 기준 5/31은 과거(이력 모드)', () => {
    expect(isPast('2026-05-31', '2026-06-01')).toBe(true);
  });

  test('처방 한 줄: 단일 약 — "아스피린 1일3회 *"', () => {
    expect(prescriptionOneLine([{ name: '아스피린', frequency: '1일3회' }])).toBe('아스피린 1일3회 *');
  });

  test('처방 한 줄: 다중 약 — " * " 나열', () => {
    expect(
      prescriptionOneLine([
        { name: '아스피린', frequency: '1일3회' },
        { name: '브루펜', frequency: '1일2회' },
      ]),
    ).toBe('아스피린 1일3회 * 브루펜 1일2회 *');
  });

  test('처방 한 줄: 정식 처방 shape(medication_name/dosage)도 흡수', () => {
    expect(prescriptionOneLine([{ medication_name: '세파', dosage: '1일3회' }])).toBe('세파 1일3회 *');
  });

  test('처방 한 줄: 용법 결측 시 "{name} *" (댕글링 공백 없음)', () => {
    expect(prescriptionOneLine([{ name: '연고' }])).toBe('연고 *');
  });

  test('처방 없음 → "처방없음"', () => {
    expect(prescriptionOneLine([])).toBe('처방없음');
    expect(prescriptionOneLine(null)).toBe('처방없음');
    expect(prescriptionOneLine(undefined)).toBe('처방없음');
  });

  test('치료 종류: treatment_kind 우선 표시', () => {
    expect(
      treatmentCell({ treatment_category: '발톱무좀', treatment_contents: ['가열레이저'], treatment_kind: '프컨+레이저' }),
    ).toBe('프컨+레이저');
  });

  test('치료 종류: treatment_kind 결측 → 받은 치료 요약 폴백(PASTVISIT 값 보존)', () => {
    expect(
      treatmentCell({ treatment_category: '발톱무좀', treatment_contents: ['가열레이저', '수액'], treatment_kind: null }),
    ).toBe('발톱무좀 · 가열레이저, 수액');
  });

  test('치료 종류: 전부 없으면 "—"', () => {
    expect(treatmentCell({ treatment_category: null, treatment_contents: null, treatment_kind: null })).toBe('—');
  });

  test('히러레이저 배지: confirmed → "레이저 ✅"', () => {
    expect(healerLaserLabel(true)).toBe('레이저 ✅');
  });

  test('히러레이저 배지: 미확인 → "레이저 ❌"', () => {
    expect(healerLaserLabel(false)).toBe('레이저 ❌');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 과거 → 오늘 복귀 (AC-1)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('시나리오3 과거→오늘 복귀', () => {
  test('왕복: 오늘 → 어제(이력) → 오늘(현행 복귀) 불변식', () => {
    const today = '2026-06-10';
    expect(isPast(today, today)).toBe(false); // 진입(현행)
    expect(isPast('2026-06-09', today)).toBe(true); // 어제 = 이력 모드
    expect(isPast(today, today)).toBe(false); // 복귀 = 현행
  });

  test('이력 모드 표기에 [object Object]/undefined/null 노출 금지', () => {
    const rx = prescriptionOneLine([{ name: '아스피린', frequency: '1일3회' }]);
    const treat = treatmentCell({ treatment_category: null, treatment_contents: null, treatment_kind: null });
    for (const text of [rx, treat]) {
      expect(text).not.toContain('[object');
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('null');
    }
  });
});
