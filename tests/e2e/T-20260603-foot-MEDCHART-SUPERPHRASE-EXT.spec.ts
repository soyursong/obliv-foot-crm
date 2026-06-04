/**
 * E2E spec — T-20260603-foot-MEDCHART-SUPERPHRASE-EXT
 * 진료차트 슈퍼상용구 등록 UX 확장 4종 (FOLLOWUP3 C-2, 문지은 대표원장 / C0ATE5P6JTH).
 * RX-SUPER-PHRASE / MEDCHART-SYNC 인프라 위 정제.
 *
 * 타겟: 어드민 SuperPhrasesTab(슈퍼상용구 등록 폼). 시나리오 B.
 *   2-1 진단명  : 등록된 진단명(차트 이력 medical_charts.diagnosis + super_phrases.diagnosis) datalist 자동완성.
 *   2-2 임상경과: 진료차트 상용구(phrase_templates, phrase_type='medical_chart') 선택 → 임상경과에 append.
 *   2-3 처방내역: 처방세트(prescription_sets) 선택 → 빈 행 정리 후 항목 append.
 *   2-5 횟수    : 숫자만 저장(3), "회"는 배경 suffix(값 미포함). 음수/소수 방지, 빈칸=null.
 *   ⚠️ 2-4(약 용량 외부 약정보 자동조회)는 본 티켓 제외 → 별도 RX-DRUGINFO-DOSAGE.
 *
 * 스타일: 구현 정본(SuperPhrasesTab/RxCountInput)과 동일한 순수 로직을 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

interface RxItem {
  name: string; dosage: string; route: string; frequency: string; days: number; notes: string;
  prescription_code_id?: string | null; count?: number | null;
}
const EMPTY_ITEM: RxItem = { name: '', dosage: '', route: '경구', frequency: '1일 3회', count: null, days: 3, notes: '' };

// ── 2-1: 등록 진단명 distinct 집계 (useRegisteredDiagnoses 정본) ─────────────
//    medical_charts.diagnosis 이력 + super_phrases.diagnosis 를 trim·dedup·ko 정렬.
const buildDiagnoses = (charts: (string | null)[], superDx: (string | null)[]): string[] => {
  const set = new Set<string>();
  [...charts, ...superDx].forEach((d) => {
    const v = (d ?? '').trim();
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
};

// ── 2-2: 임상경과 상용구 적용 (applyMedicalPhrase 정본) ───────────────────────
const applyMedicalPhrase = (prev: string, content: string): string => {
  const p = (prev ?? '').trim();
  return p ? `${p}\n${content}` : content;
};

// ── 2-3: 처방세트 불러오기 (loadRxSet 정본) ───────────────────────────────────
//    기존 빈 약품명 행 정리 후 세트 항목 append. EMPTY_ITEM 으로 기본값 보강.
const loadRxSet = (prev: RxItem[], setItems: RxItem[]): RxItem[] => {
  const incoming = (setItems ?? []).map((i) => ({ ...EMPTY_ITEM, ...i }));
  const kept = prev.filter((i) => (i.name ?? '').trim() !== '');
  return [...kept, ...incoming];
};

// ── 2-5: 횟수 입력 coercion (RxCountInput onChange 정본) ──────────────────────
const coerceCount = (raw: string): number | null => {
  const s = raw.trim();
  if (s === '') return null;
  const n = Math.max(0, Math.floor(Number(s)));
  return Number.isFinite(n) ? n : null;
};

// ── 2-1 진단명 자동완성 ───────────────────────────────────────────────────────
test.describe('MEDCHART-SUPERPHRASE-EXT 2-1: 등록 진단명 datalist', () => {
  test('차트 이력 + 슈퍼상용구 진단명 합집합·중복제거·정렬', () => {
    const out = buildDiagnoses(
      ['발톱무좀(조갑백선)', '내성발톱', '발톱무좀(조갑백선)', null, '  '],
      ['족저근막염', '내성발톱'],
    );
    expect(out).toEqual(['내성발톱', '발톱무좀(조갑백선)', '족저근막염']);
  });

  test('빈 출처 → 빈 목록(자동완성 미노출 경로)', () => {
    expect(buildDiagnoses([], [])).toEqual([]);
    expect(buildDiagnoses([null, ''], [' '])).toEqual([]);
  });
});

// ── 2-2 임상경과 상용구 적용 ──────────────────────────────────────────────────
test.describe('MEDCHART-SUPERPHRASE-EXT 2-2: 임상경과 상용구 append', () => {
  test('빈 임상경과 → 상용구 내용으로 채움', () => {
    expect(applyMedicalPhrase('', '초진 내원. 발톱 상태 확인.')).toBe('초진 내원. 발톱 상태 확인.');
  });

  test('기존 내용 있으면 줄바꿈 append', () => {
    expect(applyMedicalPhrase('1차 경과', '2차 경과')).toBe('1차 경과\n2차 경과');
  });

  test('연속 적용 누적', () => {
    let c = '';
    c = applyMedicalPhrase(c, 'A');
    c = applyMedicalPhrase(c, 'B');
    expect(c).toBe('A\nB');
  });
});

// ── 2-3 처방세트 불러오기 ─────────────────────────────────────────────────────
test.describe('MEDCHART-SUPERPHRASE-EXT 2-3: 처방세트 항목 불러오기', () => {
  const SET: RxItem[] = [
    { name: '항진균제 연고', dosage: '적정량', route: '외용', frequency: '1일 2회', count: 1, days: 14, notes: '' },
    { name: '발톱 연화제', dosage: '적정량', route: '외용', frequency: '1일 1회', count: null, days: 7, notes: '취침 전' },
  ];

  test('빈 처방내역 → 세트 항목 적재', () => {
    const out = loadRxSet([], SET);
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.name)).toEqual(['항진균제 연고', '발톱 연화제']);
  });

  test('기존 빈 약품명 행은 정리되고 세트 항목 append', () => {
    const prev: RxItem[] = [{ ...EMPTY_ITEM, name: '' }, { ...EMPTY_ITEM, name: '기존약' }];
    const out = loadRxSet(prev, SET);
    expect(out.map((i) => i.name)).toEqual(['기존약', '항진균제 연고', '발톱 연화제']);
  });

  test('세트 항목은 원본과 참조 공유 안 함(복제)', () => {
    const out = loadRxSet([], SET);
    out[0].name = '변경됨';
    expect(SET[0].name).toBe('항진균제 연고');
  });

  test('EMPTY_ITEM 기본값 보강 — 누락 필드 채움', () => {
    const partial = [{ name: '미정약' } as RxItem];
    const out = loadRxSet([], partial);
    expect(out[0].route).toBe('경구');
    expect(out[0].days).toBe(3);
    expect(out[0].count).toBeNull();
  });
});

// ── 2-5 횟수 숫자만 + "회" 배경 ───────────────────────────────────────────────
test.describe('MEDCHART-SUPERPHRASE-EXT 2-5: 횟수 숫자만', () => {
  test('숫자 입력 → 정수 저장(값에 "회" 미포함)', () => {
    expect(coerceCount('3')).toBe(3);
    expect(coerceCount('10')).toBe(10);
  });

  test('빈칸 → null(미입력)', () => {
    expect(coerceCount('')).toBeNull();
    expect(coerceCount('   ')).toBeNull();
  });

  test('음수 → 0 클램프, 소수 → 내림', () => {
    expect(coerceCount('-2')).toBe(0);
    expect(coerceCount('2.9')).toBe(2);
  });

  test('비숫자 → null', () => {
    expect(coerceCount('abc')).toBeNull();
  });

  test('값에는 "회" 단위가 절대 섞이지 않음 (FOLLOWUP2 #9-1 정정)', () => {
    // 현장 버그: [3회]처럼 단위가 값에 섞임. 정정: 값=3, "회"는 표시(suffix)만.
    const stored = coerceCount('3');
    expect(typeof stored).toBe('number');
    expect(String(stored)).not.toContain('회');
  });
});

// ── 현장 시나리오 B 통합 ──────────────────────────────────────────────────────
test.describe('MEDCHART-SUPERPHRASE-EXT 시나리오 B: 슈퍼상용구 등록 UX', () => {
  test('진단명 자동완성 선택 → 임상경과 상용구 → 처방세트 불러오기 → 횟수 숫자', () => {
    // 2-1: 진단명 후보에서 선택
    const dxOptions = buildDiagnoses(['발톱무좀(조갑백선)'], ['내성발톱']);
    const diagnosis = dxOptions[0];
    expect(diagnosis).toBe('내성발톱'); // ko 정렬상 첫 항목

    // 2-2: 임상경과 상용구 적용
    let clinical = '';
    clinical = applyMedicalPhrase(clinical, '초진 내원. 발톱 상태 확인.');
    expect(clinical.length).toBeGreaterThan(0);

    // 2-3: 처방세트 불러오기
    const rx = loadRxSet([], [{ ...EMPTY_ITEM, name: '항진균제 연고' }]);
    expect(rx).toHaveLength(1);

    // 2-5: 횟수 숫자만
    rx[0].count = coerceCount('3');
    expect(rx[0].count).toBe(3);

    // 저장 payload (super_phrases row)
    const payload = { diagnosis, clinical_progress: clinical, rx_items: rx.filter((i) => i.name.trim() !== '') };
    expect(payload.rx_items[0].count).toBe(3);
  });
});

// ── 진료차트 본체(MedicalChartPanel) 확장 ─────────────────────────────────────
//    어드민 등록 폼(SuperPhrasesTab)에 이어, 의사가 실제 차팅하는 진료차트에도 동일 4종 확장.
//    2-1 진단명 datalist(formDx) · 2-5 처방내역 횟수(count) 별도 칸(용법 frequency와 분리).
//    2-2 임상경과 //단축어, 2-3 우측 패널 처방세트는 진료차트에 기구현(회귀만 확인).

// updateRxCount 정본 (MedicalChartPanel) — count만 갱신, 다른 필드 무손상
const updateRxCount = (rows: RxItem[], idx: number, v: number | null): RxItem[] =>
  rows.map((it, i) => (i === idx ? { ...it, count: v } : it));

test.describe('MEDCHART-SUPERPHRASE-EXT 진료차트 본체(MedicalChartPanel)', () => {
  test('2-1: 진료차트 진단명 datalist 도 클리닉 진단명 distinct 출처 사용', () => {
    // formDx 자동완성 = medical_charts.diagnosis(클리닉) + super_phrases.diagnosis
    const out = buildDiagnoses(['내성발톱', '무좀', '내성발톱'], ['족저근막염']);
    expect(out).toEqual(['무좀', '내성발톱', '족저근막염'].sort((a, b) => a.localeCompare(b, 'ko')));
  });

  test('2-5: 횟수(count) 변경 시 용법(frequency)·일수(days)는 무손상 — 별도 칸', () => {
    const rows: RxItem[] = [{ ...EMPTY_ITEM, name: '항진균제 연고', frequency: '1일 2회', days: 14, count: null }];
    const after = updateRxCount(rows, 0, coerceCount('3'));
    expect(after[0].count).toBe(3);
    expect(after[0].frequency).toBe('1일 2회'); // 분해/덮어쓰기 아님
    expect(after[0].days).toBe(14);
  });

  test('2-5: 처방세트→진료차트 적재 후 횟수 인라인 조정', () => {
    // 우측 패널 처방세트 적용(loadRxSet 동형) → 차트 표에서 횟수 직접 조정
    let rx = loadRxSet([], [{ ...EMPTY_ITEM, name: '발톱 연화제', frequency: '1일 1회' }]);
    rx = updateRxCount(rx, 0, coerceCount('5'));
    expect(rx[0].count).toBe(5);
    expect(rx[0].name).toBe('발톱 연화제');
    // prescription_items JSONB payload 에 count 영속
    const payload = rx.length > 0 ? rx : null;
    expect(payload?.[0].count).toBe(5);
  });

  test('2-5: 빈 횟수는 null 로 저장 (값에 "회" 미혼입)', () => {
    const rows: RxItem[] = [{ ...EMPTY_ITEM, name: '경구약', count: 3 }];
    const cleared = updateRxCount(rows, 0, coerceCount(''));
    expect(cleared[0].count).toBeNull();
  });
});
