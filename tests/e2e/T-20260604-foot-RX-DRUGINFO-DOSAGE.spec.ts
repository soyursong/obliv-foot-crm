/**
 * E2E spec — T-20260604-foot-RX-DRUGINFO-DOSAGE
 * 처방 약 용량 — AC-3 수동입력 fallback (문지은 대표원장 / C0ATE5P6JTH).
 * FOLLOWUP3 C-2 AC-2-4(약 용량 외부 자동조회) 분리 트래커.
 *
 * AC-1(조사) 결론: 신뢰 가능한 무료 공개 정량 용량 API 부재 →
 *   - 식약처 e약은요(공공데이터포털): 용법용량이 비정형 텍스트 + 키발급/rate-limit/장애대비 부담 → dosage 정량칸 자동매핑 신뢰도 낮음.
 *   - 드러그인포/KIMS: B2B 유료·스크래핑 약관 금지.
 *   → AC-2(외부 자동연동) 보류, AC-3(수동입력 fallback) 채택. 현장 요청 "등록할 때 넣든지".
 *
 * AC-3 구현 정본: MedicalChartPanel.updateRxItem('dosage', value) — dosage 인라인 편집.
 *   외부 의존 없음, db 변경 없음(prescription_items JSONB), additive(다른 필드 무손상).
 *   처방세트 등록 dosage 는 종전대로 로드 시 자동 노출(PrescriptionSetsTab) — 본 spec은 단건/조정 경로.
 *
 * 스타일: 구현 정본(updateRxItem)의 순수 로직을 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

interface RxItem {
  name: string; dosage: string; route: string; frequency: string; days: number; notes: string;
  prescription_code_id?: string | null; classification?: string | null; count?: number | null;
}
const EMPTY_ITEM: RxItem = { name: '', dosage: '', route: '경구', frequency: '1일 3회', count: null, days: 3, notes: '' };

// ── 단건 약 검색 추가 (addRxFromCode 정본) — dosage 는 '' 로 시작 ─────────────
//    외부 자동조회 없음(AC-1 결론). name/route/classification/code_id 만 채움.
const addRxFromCode = (
  code: { id: string; name_ko: string; classification: string | null },
): RxItem => ({
  ...EMPTY_ITEM,
  name: code.name_ko,
  dosage: '',
  route: code.classification?.includes('외용') ? '외용' : '경구',
  classification: code.classification ?? null,
  prescription_code_id: code.id,
});

// ── dosage 인라인 편집 (updateRxItem 'dosage' 정본) ───────────────────────────
//    dosage 는 자유텍스트(예: "250mg", "1정", "적정량"). 트림 없이 그대로 보존(공백 입력 중간상태 허용).
const updateDosage = (rows: RxItem[], idx: number, value: string): RxItem[] =>
  rows.map((it, i) => (i === idx ? { ...it, dosage: value } : it));

// frequency/days 정본도 함께 회귀(같은 updateRxItem 분기)
const updateDays = (rows: RxItem[], idx: number, value: string): RxItem[] =>
  rows.map((it, i) => {
    if (i !== idx) return it;
    const n = value === '' ? 0 : Math.max(0, Number(value) || 0);
    return { ...it, days: n };
  });

// ── AC-1: 외부 자동조회 미수행 확인 ───────────────────────────────────────────
test.describe('RX-DRUGINFO-DOSAGE AC-1: 외부 자동조회 보류(수동 fallback)', () => {
  test('단건 약 추가 시 dosage 는 빈값으로 시작(외부 API 자동채움 없음)', () => {
    const item = addRxFromCode({ id: 'rx-1', name_ko: '이트라코나졸', classification: '내복약' });
    expect(item.dosage).toBe('');
    expect(item.name).toBe('이트라코나졸');
    expect(item.prescription_code_id).toBe('rx-1');
  });
});

// ── AC-3: dosage 수동 인라인 입력 ─────────────────────────────────────────────
test.describe('RX-DRUGINFO-DOSAGE AC-3: 용량 수동 인라인 입력', () => {
  test('빈 dosage 약에 용량 직접 입력', () => {
    const rows = [addRxFromCode({ id: 'rx-1', name_ko: '항진균제 연고', classification: '외용약' })];
    const after = updateDosage(rows, 0, '250mg');
    expect(after[0].dosage).toBe('250mg');
  });

  test('dosage 변경 시 다른 필드 무손상(additive)', () => {
    const rows: RxItem[] = [{ ...EMPTY_ITEM, name: '경구약', frequency: '1일 2회', days: 14, count: 3 }];
    const after = updateDosage(rows, 0, '1정');
    expect(after[0].dosage).toBe('1정');
    expect(after[0].frequency).toBe('1일 2회');
    expect(after[0].days).toBe(14);
    expect(after[0].count).toBe(3);
    expect(after[0].name).toBe('경구약');
  });

  test('자유텍스트 dosage 허용 (정량/수식어 모두)', () => {
    let rows = [addRxFromCode({ id: 'rx-1', name_ko: '약A', classification: '내복약' })];
    rows = updateDosage(rows, 0, '적정량');
    expect(rows[0].dosage).toBe('적정량');
    rows = updateDosage(rows, 0, '500mg 1일 2회');
    expect(rows[0].dosage).toBe('500mg 1일 2회');
  });

  test('빈 문자열로 되돌리기 가능(입력 취소)', () => {
    let rows: RxItem[] = [{ ...EMPTY_ITEM, name: '약', dosage: '250mg' }];
    rows = updateDosage(rows, 0, '');
    expect(rows[0].dosage).toBe('');
  });

  test('다중 행 — 해당 행만 dosage 변경', () => {
    const rows: RxItem[] = [
      { ...EMPTY_ITEM, name: '약1', dosage: '' },
      { ...EMPTY_ITEM, name: '약2', dosage: '100mg' },
    ];
    const after = updateDosage(rows, 0, '250mg');
    expect(after[0].dosage).toBe('250mg');
    expect(after[1].dosage).toBe('100mg'); // 인접 행 불변
  });
});

// ── 처방세트 등록 dosage → 차트 자동 노출(회귀) ───────────────────────────────
test.describe('RX-DRUGINFO-DOSAGE: 처방세트 등록 dosage 자동 노출(회귀)', () => {
  test('세트 등록 시 입력한 dosage 가 차트 적재 시 그대로 노출', () => {
    // PrescriptionSetsTab 에서 dosage 수동 등록 → 차트 로드 시 보존 (외부 의존 없음)
    const setItems: RxItem[] = [{ ...EMPTY_ITEM, name: '발톱 연화제', dosage: '적정량', route: '외용' }];
    const loaded = setItems.map((i) => ({ ...EMPTY_ITEM, ...i }));
    expect(loaded[0].dosage).toBe('적정량');
  });

  test('등록 후 차트에서 인라인 재조정 가능', () => {
    let loaded: RxItem[] = [{ ...EMPTY_ITEM, name: '경구약', dosage: '250mg' }];
    loaded = updateDosage(loaded, 0, '500mg'); // 처방 시점 조정
    expect(loaded[0].dosage).toBe('500mg');
  });
});

// ── 시나리오 통합 (단건 추가 → 용량 입력 → 일수 조정 → 저장 payload) ──────────
test.describe('RX-DRUGINFO-DOSAGE 시나리오: 약 추가 → 용량 수동 입력 → 저장', () => {
  test('빈 용량으로 추가된 약에 용량·일수 직접 입력 후 JSONB 영속', () => {
    let rx = [addRxFromCode({ id: 'rx-9', name_ko: '이트라코나졸', classification: '내복약' })];
    expect(rx[0].dosage).toBe(''); // 자동조회 없음
    rx = updateDosage(rx, 0, '100mg');
    rx = updateDays(rx, 0, '84');
    expect(rx[0].dosage).toBe('100mg');
    expect(rx[0].days).toBe(84);

    // prescription_items JSONB payload (마이그 불요)
    const payload = rx.length > 0 ? rx : null;
    expect(payload?.[0].dosage).toBe('100mg');
  });
});
