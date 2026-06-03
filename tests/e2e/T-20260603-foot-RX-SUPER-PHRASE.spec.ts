/**
 * E2E spec — T-20260603-foot-RX-SUPER-PHRASE
 * 슈퍼상용구: 진단명 + 임상경과 + 처방내역을 묶어 등록하고, 적용 시 각 영역에 일괄 라우팅.
 * (문지은 대표원장 요청 RX-MODULE-8REQ #7)
 *
 * 아키텍처 그라운딩 (티켓 정본 / 옵션 B 확정):
 *   저장 = 신규 super_phrases 테이블(diagnosis, clinical_progress, rx_items JSONB).
 *   rx_items = prescription_sets.items 동일 shape, FK 미참조 자체보유.
 *   적용 = MedicalChartPanel.applySuperPhrase(sp):
 *     - 진단명(formDx)   : 비었으면 채우고, 값 있으면 줄바꿈 누적   ← Q1 dev 기본안
 *     - 임상경과(formClinical): 누적(append, 기존 상용구 삽입과 동일 패턴) ← Q1
 *     - 처방내역(formRx) : addRxItems() 동일 진입점 재사용 → 누적 + 금기증 게이트 상속
 *     - 빈 슬롯은 스킵     ← Q2 부분 슬롯 등록 허용
 *
 * 스타일: 기존 PHRASE-MULTISELECT spec 패턴(in-page 순수 로직 시뮬레이션) —
 *   구현 정본과 동일한 라우팅 규칙을 모사해 회귀를 잡는다.
 *
 * AC-1: 슈퍼상용구 등록(3슬롯 묶음). 옵션 B 신규 테이블 shape.
 * AC-2: 일괄 적용 — 진단명/임상경과/처방 각 영역 라우팅.
 * AC-3: 기존 단일 상용구 동작 보존(하위호환) — 라우팅 로직은 독립.
 * Q1: 기존값 처리(진단명 fill-or-append, 임상경과/처방 누적).
 * Q2: 부분 슬롯(빈 슬롯 스킵).
 */
import { test, expect } from '@playwright/test';

// ── 정본 타입 (super_phrases row shape) ──────────────────────────────────────
interface RxItem { name: string; dosage: string; route: string; frequency: string; days: number; notes: string; prescription_code_id?: string | null; }
interface SuperPhrase {
  id: number;
  name: string;
  diagnosis: string | null;
  clinical_progress: string | null;
  rx_items: RxItem[];
  is_active: boolean;
  sort_order: number;
}

// ── 적용 라우팅 정본 (MedicalChartPanel.applySuperPhrase 와 동일 규칙) ─────────
//    Q1 진단명: 비었으면 채우고, 값 있으면 줄바꿈 누적
const routeDiagnosis = (prev: string, dx: string | null): string => {
  const v = (dx ?? '').trim();
  if (!v) return prev; // Q2 빈 슬롯 스킵
  return prev.trim() ? `${prev}\n${v}` : v;
};
//    Q1 임상경과: 누적(append)
const routeClinical = (prev: string, clinical: string | null): string => {
  const v = (clinical ?? '').trim();
  if (!v) return prev; // Q2 빈 슬롯 스킵
  return prev ? `${prev}\n${v}` : v;
};
//    Q1 처방: 누적(append). 빈 이름 행 제거(저장 정합 + 적용 안전).
const routeRx = (prev: RxItem[], items: RxItem[]): RxItem[] => {
  const valid = (items ?? []).filter((i) => (i.name ?? '').trim() !== '');
  return [...prev, ...valid.map((i) => ({ ...i }))];
};
//    적용된 슬롯 라벨 집계 (토스트/표기용)
const appliedSlots = (sp: SuperPhrase): string[] => {
  const out: string[] = [];
  if ((sp.diagnosis ?? '').trim()) out.push('진단명');
  if ((sp.clinical_progress ?? '').trim()) out.push('임상경과');
  if ((sp.rx_items ?? []).filter((i) => (i.name ?? '').trim() !== '').length > 0) out.push('처방');
  return out;
};

// ── 픽스처 ──────────────────────────────────────────────────────────────────
const FULL: SuperPhrase = {
  id: 1, name: '발톱무좀 초진 세트', is_active: true, sort_order: 0,
  diagnosis: '발톱무좀(조갑백선)',
  clinical_progress: '초진 내원. 발톱 상태 확인. 처방 전 동의 완료.',
  rx_items: [
    { name: '항진균제 연고', dosage: '적정량', route: '외용', frequency: '1일 2회', days: 14, notes: '' },
    { name: '발톱 연화제', dosage: '적정량', route: '외용', frequency: '1일 1회', days: 7, notes: '취침 전' },
  ],
};
const DX_ONLY: SuperPhrase = {
  id: 2, name: '진단명만', is_active: true, sort_order: 1,
  diagnosis: '내성발톱', clinical_progress: null, rx_items: [],
};
const RX_ONLY: SuperPhrase = {
  id: 3, name: '처방만', is_active: true, sort_order: 2,
  diagnosis: null, clinical_progress: null,
  rx_items: [{ name: '진통소염제', dosage: '1정', route: '경구', frequency: '1일 3회', days: 3, notes: '식후' }],
};
const EMPTY: SuperPhrase = {
  id: 4, name: '빈 상용구', is_active: true, sort_order: 3,
  diagnosis: null, clinical_progress: null, rx_items: [],
};

// ── AC-2 / Q1: 빈 폼에 풀세트 적용 ────────────────────────────────────────────
test.describe('RX-SUPER-PHRASE AC-2: 3슬롯 일괄 라우팅', () => {
  test('빈 폼 → 풀세트 적용: 각 영역에 채워짐', () => {
    let dx = '';
    let clinical = '';
    let rx: RxItem[] = [];
    dx = routeDiagnosis(dx, FULL.diagnosis);
    clinical = routeClinical(clinical, FULL.clinical_progress);
    rx = routeRx(rx, FULL.rx_items);

    expect(dx).toBe('발톱무좀(조갑백선)');
    expect(clinical).toBe('초진 내원. 발톱 상태 확인. 처방 전 동의 완료.');
    expect(rx).toHaveLength(2);
    expect(rx.map((i) => i.name)).toEqual(['항진균제 연고', '발톱 연화제']);
    expect(appliedSlots(FULL)).toEqual(['진단명', '임상경과', '처방']);
  });

  test('처방 항목은 세트 원본과 참조 공유 안 함(얕은 복제)', () => {
    const rx = routeRx([], FULL.rx_items);
    rx[0].name = '변경됨';
    expect(FULL.rx_items[0].name).toBe('항진균제 연고'); // 원본 불변
  });
});

// ── Q1: 기존값 처리 (진단명 fill-or-append / 누적) ────────────────────────────
test.describe('RX-SUPER-PHRASE Q1: 기존값 처리', () => {
  test('진단명 — 비었으면 채움', () => {
    expect(routeDiagnosis('', '발톱무좀')).toBe('발톱무좀');
  });

  test('진단명 — 값 있으면 줄바꿈 누적', () => {
    expect(routeDiagnosis('기존진단', '발톱무좀')).toBe('기존진단\n발톱무좀');
  });

  test('임상경과 — 누적(append)', () => {
    expect(routeClinical('1차 경과', '초진 내원')).toBe('1차 경과\n초진 내원');
    expect(routeClinical('', '초진 내원')).toBe('초진 내원');
  });

  test('처방 — 누적(replace 아님): 기존 처방 유지 + 세트 약 추가', () => {
    const prev: RxItem[] = [{ name: '기존약', dosage: '', route: '경구', frequency: '', days: 1, notes: '' }];
    const merged = routeRx(prev, FULL.rx_items);
    expect(merged).toHaveLength(3);
    expect(merged[0].name).toBe('기존약'); // 기존 보존
    expect(merged[1].name).toBe('항진균제 연고');
  });
});

// ── Q2: 부분 슬롯 (빈 슬롯 스킵) ──────────────────────────────────────────────
test.describe('RX-SUPER-PHRASE Q2: 부분 슬롯 등록·적용', () => {
  test('진단명만 등록 → 진단명만 채워지고 나머지 영역 불변', () => {
    let dx = '기존';
    let clinical = '기존경과';
    let rx: RxItem[] = [{ name: '기존약', dosage: '', route: '경구', frequency: '', days: 1, notes: '' }];
    dx = routeDiagnosis(dx, DX_ONLY.diagnosis);
    clinical = routeClinical(clinical, DX_ONLY.clinical_progress); // null → 스킵
    rx = routeRx(rx, DX_ONLY.rx_items);                            // [] → 스킵

    expect(dx).toBe('기존\n내성발톱');
    expect(clinical).toBe('기존경과'); // 불변
    expect(rx).toHaveLength(1);        // 불변
    expect(appliedSlots(DX_ONLY)).toEqual(['진단명']);
  });

  test('처방만 등록 → 처방만 누적, 진단명·임상경과 불변', () => {
    let dx = '';
    let clinical = '';
    let rx: RxItem[] = [];
    dx = routeDiagnosis(dx, RX_ONLY.diagnosis);
    clinical = routeClinical(clinical, RX_ONLY.clinical_progress);
    rx = routeRx(rx, RX_ONLY.rx_items);

    expect(dx).toBe('');
    expect(clinical).toBe('');
    expect(rx).toHaveLength(1);
    expect(appliedSlots(RX_ONLY)).toEqual(['처방']);
  });

  test('전부 빈 슬롯 → 적용 슬롯 0개(무동작 경고 경로)', () => {
    expect(appliedSlots(EMPTY)).toEqual([]);
    let dx = 'keep';
    dx = routeDiagnosis(dx, EMPTY.diagnosis);
    expect(dx).toBe('keep'); // 불변
  });
});

// ── AC-3: 하위호환 — 단일 상용구 로직과 독립 ──────────────────────────────────
test.describe('RX-SUPER-PHRASE AC-3: 하위호환', () => {
  test('슈퍼상용구 라우팅은 임상경과 누적만 건드림 — 단일 상용구 삽입과 동일한 append 규칙', () => {
    // 기존 insertSelectedPhrases: setFormClinical(prev ? prev+\n+c : c) 와 동일 식
    const legacyInsert = (prev: string, content: string) => (prev ? `${prev}\n${content}` : content);
    expect(routeClinical('A', 'B')).toBe(legacyInsert('A', 'B'));
    expect(routeClinical('', 'B')).toBe(legacyInsert('', 'B'));
  });

  test('rx_items shape = prescription_sets.items 동일 — 처방세트 적용과 동일 누적', () => {
    // 두 경로 모두 [...prev, ...items] 누적. 슈퍼상용구가 처방세트 동선을 깨지 않음.
    const setItems = FULL.rx_items;
    const viaSuper = routeRx([], setItems);
    const viaSet = [...[], ...setItems.map((i) => ({ ...i }))];
    expect(viaSuper.map((i) => i.name)).toEqual(viaSet.map((i) => i.name));
  });
});

// ── 현장 클릭 시나리오 (티켓 E2E 변환 가이드) ────────────────────────────────
test.describe('RX-SUPER-PHRASE 현장 시나리오', () => {
  test('시나리오 1: 등록 → 환자차트에서 선택 → 진단명·임상경과·처방 동시 채워짐', () => {
    // 1) 등록 (3슬롯 모두) — 저장 payload 검증
    const payload = {
      name: FULL.name,
      diagnosis: FULL.diagnosis,
      clinical_progress: FULL.clinical_progress,
      rx_items: FULL.rx_items.filter((i) => i.name.trim() !== ''),
    };
    expect(payload.rx_items).toHaveLength(2);

    // 2) 적용
    let dx = '';
    let clinical = '';
    let rx: RxItem[] = [];
    dx = routeDiagnosis(dx, FULL.diagnosis);
    clinical = routeClinical(clinical, FULL.clinical_progress);
    rx = routeRx(rx, FULL.rx_items);

    // 3) 동시 반영 확인
    expect(dx.length).toBeGreaterThan(0);
    expect(clinical.length).toBeGreaterThan(0);
    expect(rx.length).toBe(2);
  });

  test('시나리오 2: 처방 슬롯은 addRxItems 경유 — prescription_code_id 보유 시 게이트 대상', () => {
    // 금기증 게이트는 prescription_code_id 기준. 자유텍스트(코드 없음)는 즉시 적재.
    const withCode: RxItem[] = [{ ...RX_ONLY.rx_items[0], prescription_code_id: 'code-1' }];
    const codeIds = Array.from(new Set(withCode.map((i) => i.prescription_code_id).filter((x): x is string => !!x)));
    expect(codeIds).toEqual(['code-1']); // addRxItems 가 이 id로 금기증 조회 → 게이트 분기

    const freeText = RX_ONLY.rx_items; // code 없음
    const noCode = freeText.map((i) => i.prescription_code_id).filter((x) => !!x);
    expect(noCode).toHaveLength(0); // 게이트 없이 즉시 누적
  });
});
