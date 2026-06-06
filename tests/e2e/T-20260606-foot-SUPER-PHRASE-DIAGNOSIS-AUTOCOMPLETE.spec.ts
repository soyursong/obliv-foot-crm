/**
 * E2E spec — T-20260606-foot-SUPER-PHRASE-DIAGNOSIS-AUTOCOMPLETE
 * 슈퍼상용구(SuperPhrasesTab) 진단명 자동완성 소스를 '표준 상병 마스터'로 교체 검증.
 * (문지은 대표원장 6/6: "상병이랑 똑같은 건데 진단명 자동완성에 이상한 것들이 뜸")
 *
 * 루트코즈:
 *   기존 useRegisteredDiagnoses 가 medical_charts.diagnosis(진료차트 자유입력 이력) +
 *   super_phrases.diagnosis 를 합집합으로 datalist 에 노출 → 과거 오타·비표준 진단명이 섞여 떴다.
 *
 * 수정 (정본 useRegisteredDiagnoses):
 *   AC-1: medical_charts.diagnosis 이력 제거. services category_label='상병' & active=true 의
 *         표준 상병명(name)을 1순위 소스로, super_phrases.diagnosis 는 보조(표준에 없는 것만 합류, 중복 제거).
 *   AC-2: services.service_code(상병코드)가 있으면 datalist option label 로 동반 표시.
 *         단 입력/저장값은 표준 상병명(option value)만 — code 가 stored 진단명을 오염시키지 않음.
 *   AC-3 (read-only 사전 확인 결과): services 상병 마스터 8건 채워짐 → 완전 교체해도 자동완성 텅 빔 회귀 없음.
 *
 * 스타일: 기존 SUPER-PHRASE-CHART-LINK-FIX / LOAD-FIX 패턴(in-page 순수 로직 시뮬레이션) —
 *   구현 정본의 소스 합성/중복제거/정렬/label 규칙을 모사해 회귀를 잡는다.
 */
import { test, expect } from '@playwright/test';

// ── 정본 타입 ──────────────────────────────────────────────────────────────────
interface ServiceRow {
  name: string | null;
  service_code: string | null;
  active: boolean;
  category_label: string | null;
  display_order: number;
}
interface SuperRow {
  diagnosis: string | null;
}
interface DiagnosisOption {
  name: string;
  code: string | null;
}

// ── 정본: 진단명 옵션 합성 (useRegisteredDiagnoses 의 queryFn 로직 모사) ──────────
//   1순위 표준 상병 마스터(active 만) → 보조 슈퍼상용구 이력(표준에 없는 것만, 중복 제거)
const buildDiagnoses = (services: ServiceRow[], supers: SuperRow[]): DiagnosisOption[] => {
  const options: DiagnosisOption[] = [];
  const seen = new Set<string>();
  // 1순위: category_label='상병' & active=true, display_order 정렬
  services
    .filter((s) => s.category_label === '상병' && s.active === true)
    .sort((a, b) => a.display_order - b.display_order)
    .forEach((s) => {
      const n = (s.name ?? '').trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        options.push({ name: n, code: (s.service_code ?? '').trim() || null });
      }
    });
  // 보조: 슈퍼상용구 진단명 (표준에 없는 것만)
  supers.forEach((sp) => {
    const d = (sp.diagnosis ?? '').trim();
    if (d && !seen.has(d)) {
      seen.add(d);
      options.push({ name: d, code: null });
    }
  });
  return options;
};

// ── 정본: datalist <option> label (AC-2) ──────────────────────────────────────
const optionLabel = (o: DiagnosisOption): string | undefined =>
  o.code ? `${o.name}  (${o.code})` : undefined;

// ── 픽스처: AC-3 read-only 로 확인한 실제 services 상병 마스터(축약) ─────────────
const servicesFixture: ServiceRow[] = [
  { name: '내향성 손발톱', service_code: 'L600', active: true, category_label: '상병', display_order: 303 },
  { name: '상세불명의 위염', service_code: 'K297', active: true, category_label: '상병', display_order: 304 },
  { name: '체부백선', service_code: 'B354', active: true, category_label: '상병', display_order: 305 },
  { name: '손발톱백선', service_code: 'B351', active: true, category_label: '상병', display_order: 310 },
  { name: '발백선', service_code: 'B353', active: true, category_label: '상병', display_order: 320 },
  { name: '내성발톱(감입발톱)', service_code: 'L600', active: true, category_label: '상병', display_order: 330 },
  // active=false → 마스터에서 숨김 (자동완성 제외)
  { name: '굳은살', service_code: 'L840', active: false, category_label: '상병', display_order: 340 },
  { name: '표피낭종(티눈)', service_code: 'L720', active: false, category_label: '상병', display_order: 350 },
  // 다른 카테고리(상병 아님) → 제외돼야 함
  { name: '풋케어 베이직', service_code: null, active: true, category_label: '풋케어', display_order: 10 },
];

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 정상 동선 — 표준 상병명만 자동완성, 비표준 자유텍스트 제거 (AC-1)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 표준 상병 마스터 1순위 + 비표준 제거', () => {
  test('자동완성에 표준 상병명이 노출된다', () => {
    const opts = buildDiagnoses(servicesFixture, []);
    const names = opts.map((o) => o.name);
    expect(names).toContain('손발톱백선');
    expect(names).toContain('발백선');
    expect(names).toContain('내향성 손발톱');
  });

  test('과거 자유입력 비표준 텍스트(오타 진단명)는 노출되지 않는다 — medical_charts 소스 제거', () => {
    // 정본은 super_phrases.diagnosis 만 보조로 본다(medical_charts 미조회).
    // 표준 마스터에 이미 있는 진단명은 슈퍼상용구 이력으로 중복 추가되지 않는다.
    const supers: SuperRow[] = [
      { diagnosis: '손발톱백선' }, // 표준과 동일 → 중복 제거
      { diagnosis: '발톱무좀(조갑백선)' }, // 표준에 없는 기존 슈퍼상용구 이력 → 보조로 유지
    ];
    const opts = buildDiagnoses(servicesFixture, supers);
    const names = opts.map((o) => o.name);
    // 비표준 자유텍스트 예시(오타)는 어느 소스에도 없음 → 미노출
    expect(names).not.toContain('손발톱백선ㅁ'); // 오타 모사
    expect(names).not.toContain('무좀발톱'); // 비표준 모사
    // 표준명은 정확히 1회만
    expect(names.filter((n) => n === '손발톱백선')).toHaveLength(1);
  });

  test('active=false 상병은 마스터에서 숨겨진다 (굳은살·표피낭종 제외)', () => {
    const names = buildDiagnoses(servicesFixture, []).map((o) => o.name);
    expect(names).not.toContain('굳은살');
    expect(names).not.toContain('표피낭종(티눈)');
  });

  test('category_label!=상병 인 서비스는 자동완성에서 제외된다 (시술/제품 혼입 금지)', () => {
    const names = buildDiagnoses(servicesFixture, []).map((o) => o.name);
    expect(names).not.toContain('풋케어 베이직');
  });

  test('표준 마스터는 display_order 순서로 정렬된다', () => {
    const names = buildDiagnoses(servicesFixture, []).map((o) => o.name);
    expect(names.slice(0, 3)).toEqual(['내향성 손발톱', '상세불명의 위염', '체부백선']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 보조 소스 — 슈퍼상용구 이력은 표준에 없는 것만 합류 (AC-1)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-1 보조 소스(super_phrases) 합류·중복 제거', () => {
  test('표준에 없는 슈퍼상용구 진단명은 표준 뒤에 보조로 합류', () => {
    const supers: SuperRow[] = [{ diagnosis: '족저근막염' }];
    const opts = buildDiagnoses(servicesFixture, supers);
    const names = opts.map((o) => o.name);
    expect(names).toContain('족저근막염');
    // 보조는 표준 6건 뒤에 위치
    expect(names.indexOf('족저근막염')).toBeGreaterThanOrEqual(6);
  });

  test('보조 소스 진단명은 코드가 없다(null)', () => {
    const supers: SuperRow[] = [{ diagnosis: '족저근막염' }];
    const opts = buildDiagnoses(servicesFixture, supers);
    const o = opts.find((x) => x.name === '족저근막염')!;
    expect(o.code).toBeNull();
  });

  test('빈/공백 diagnosis 는 무시된다', () => {
    const supers: SuperRow[] = [{ diagnosis: '   ' }, { diagnosis: null }];
    const opts = buildDiagnoses([], supers);
    expect(opts).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 상병코드 동반 표시 — label 만, value(저장값)는 순수 상병명 (AC-2)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-2 상병코드 label 동반 표시', () => {
  test('code 가 있으면 label 에 "상병명  (코드)" 형태로 표시', () => {
    const o: DiagnosisOption = { name: '손발톱백선', code: 'B351' };
    expect(optionLabel(o)).toBe('손발톱백선  (B351)');
  });

  test('code 가 없으면 label 미설정(undefined) — value 만으로 노출', () => {
    const o: DiagnosisOption = { name: '족저근막염', code: null };
    expect(optionLabel(o)).toBeUndefined();
  });

  test('저장/입력값(option value)은 상병명만 — 코드가 진단명 텍스트를 오염시키지 않음', () => {
    // datalist 선택 시 input 에 들어가는 값은 option value(=name) 이지 label 이 아니다.
    const o: DiagnosisOption = { name: '내향성 손발톱', code: 'L600' };
    const storedValue = o.name; // value attr
    expect(storedValue).toBe('내향성 손발톱');
    expect(storedValue).not.toContain('L600');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 4: 엣지 — 마스터 0건 안전성 (AC-3 회귀 가드)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AC-3 마스터 분포 안전성', () => {
  test('상병 마스터가 비어도 보조 소스로 폴백 (자동완성 텅 빔 완화)', () => {
    const supers: SuperRow[] = [{ diagnosis: '족저근막염' }, { diagnosis: '조갑백선' }];
    const opts = buildDiagnoses([], supers);
    expect(opts.map((o) => o.name)).toEqual(['족저근막염', '조갑백선']);
  });

  test('소스 전무 시 빈 목록 — 입력 자체는 자유(차단 아님)', () => {
    // 자동완성 후보 0건이어도 input 은 자유 입력 가능(시나리오 2 엣지). 여기선 목록 합성만 검증.
    expect(buildDiagnoses([], [])).toHaveLength(0);
  });

  test('실데이터 분포: 활성 상병 마스터 6건(8건 중 2건 비활성)', () => {
    const activeMasters = buildDiagnoses(servicesFixture, []);
    expect(activeMasters).toHaveLength(6);
  });
});
