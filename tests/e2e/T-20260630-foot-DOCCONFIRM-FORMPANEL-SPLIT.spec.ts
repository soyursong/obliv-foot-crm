/**
 * E2E Spec — T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT
 *
 * 진료확인서 발급폼 2개 분리 (방식 β). 단일 'treat_confirm' →
 *   · treat_confirm_code   = 코드·진단명 포함 (10,000, service_id 진료확인서1) — 상병 테이블 렌더
 *   · treat_confirm_nocode = 코드·진단명 불포함 (3,000, service_id 진료확인서2) — 상병 미렌더
 *   · 레거시 'treat_confirm' = 패널 미노출(DB active=false + DOCLIST_ORDER_10 제거), 재출력만 보존.
 *
 * 게이트: planner MSG-20260630-124723-qn24 (게이트 A reporter 옵션② + 게이트 B DA β, 양 GO).
 *
 * 현장 클릭 시나리오 3종 (티켓 §3):
 *  - S1: 코드포함 발급 — treat_confirm_code 버튼 노출 + 상병(코드·진단명) 테이블 렌더
 *  - S2: 불포함 발급 — treat_confirm_nocode 버튼 노출 + 상병 미렌더(코드·진단명 비표시)
 *  - S3: 레거시 미노출 회귀 — 단일 'treat_confirm' 패널 목록 비표시(3중표시 차단)
 *
 * AC:
 *  - 서류종류 1개 유지: code/nocode doc-serial prefix 둘 다 'VC' 공유(11번째 서류종류 신설 없음)
 *  - 두 화면 공유 orderDocList 결과 = 두 폼 노출 / 레거시 비노출
 *  - 남은 9종 서류 출력/바인딩 회귀 0 (L-006 보존)
 *
 * 실행: npx playwright test T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT.spec.ts
 * NOTE: orderDocList + getHtmlTemplate/bindHtmlTemplate(SSOT) + docSerialPrefix 단위 검증 — 실서버 불필요.
 */

import { test, expect } from '@playwright/test';
import {
  DOCLIST_ORDER_10,
  orderDocList,
  type FormTemplate,
} from '../../src/lib/formTemplates';
import {
  getHtmlTemplate,
  bindHtmlTemplate,
  isHtmlTemplate,
} from '../../src/lib/htmlFormTemplates';
import { docSerialPrefix } from '../../src/lib/docSerial';

function mockTpl(form_key: string, name_ko: string, active = true): FormTemplate {
  return {
    id: `db-${form_key}`,
    clinic_id: 'foot-clinic',
    category: 'foot-service',
    form_key,
    name_ko,
    template_path: '',
    template_format: 'html',
    field_map: [],
    requires_signature: false,
    required_role: 'admin|manager|coordinator',
    active,
    sort_order: 0,
  };
}

// 마이그 후 패널이 받는 활성(active=true) form_templates 집합 시뮬레이션.
// 레거시 treat_confirm 은 DB active=false → 쿼리(.eq('active',true))에서 제외되어 입력에 없음.
const ACTIVE_DB_TEMPLATES: FormTemplate[] = [
  mockTpl('bill_receipt', '진료비 계산서·영수증'),
  mockTpl('bill_detail', '진료비내역서'),
  mockTpl('koh_result', 'KOH균검사결과지'),
  mockTpl('diag_opinion', '소견서'),
  mockTpl('diagnosis', '진단서'),
  mockTpl('treat_confirm_code', '진료확인서(코드·진단명 포함)'),
  mockTpl('treat_confirm_nocode', '진료확인서(코드·진단명 불포함)'),
  mockTpl('referral_letter', '진료의뢰서'),
  mockTpl('visit_confirm', '통원확인서'),
  mockTpl('medical_record_request', '진료기록사본'),
  mockTpl('rx_standard', '처방전'),
];

const DISEASE_MARKERS = ['상 병 코 드', '특 정 기 호', '임상적추정', '최 종 진 단', '임상적진단'];
const DISEASE_TOKENS = ['{{diag_code_1}}', '{{diag_name_1}}', '{{diag_row_3_style}}'];

const SAMPLE_VALUES: Record<string, string> = {
  patient_name: '홍길동',
  patient_rrn: '900101-1234567',
  visit_date: '2026-06-30',
  issue_date: '2026-06-30',
  clinic_name: '오블리브 풋센터',
  doctor_name: '문지은',
  diag_code_1: 'L60.0',
  diag_name_1: '내향성 발톱',
  diag_code_2: 'B35.1',
  diag_name_2: '발톱백선',
  diag_row_3_style: 'display:none',
  diag_row_4_style: 'display:none',
};

// ── S1: 코드포함 발급 ──────────────────────────────────────────────────────────
test.describe('S1 — 진료확인서(코드·진단명 포함) treat_confirm_code', () => {
  test('패널 화이트리스트(DOCLIST_ORDER_10)에 포함 → 버튼 노출', () => {
    expect(DOCLIST_ORDER_10).toContain('treat_confirm_code');
    const ordered = orderDocList(ACTIVE_DB_TEMPLATES);
    expect(ordered.map((t) => t.form_key)).toContain('treat_confirm_code');
  });

  test('HTML 템플릿 등록 + 상병(병명) 테이블 렌더', () => {
    expect(isHtmlTemplate('treat_confirm_code')).toBe(true);
    const html = getHtmlTemplate('treat_confirm_code');
    expect(html).toBeTruthy();
    for (const m of DISEASE_MARKERS) expect(html!).toContain(m);
    for (const tok of DISEASE_TOKENS) expect(html!).toContain(tok);
    expect(html!).toContain('진 료 확 인 서'); // 제목 보존
  });

  test('바인딩 시 상병 코드·진단명 출력 + 잔존토큰 없음', () => {
    const bound = bindHtmlTemplate(getHtmlTemplate('treat_confirm_code')!, SAMPLE_VALUES);
    expect(bound).toContain('L60.0');
    expect(bound).toContain('내향성 발톱');
    expect(bound).not.toMatch(/\{\{[a-z_0-9]+\}\}/i); // 미치환 토큰 0
  });
});

// ── S2: 불포함 발급 ────────────────────────────────────────────────────────────
test.describe('S2 — 진료확인서(코드·진단명 불포함) treat_confirm_nocode', () => {
  test('패널 화이트리스트에 포함 → 버튼 노출', () => {
    expect(DOCLIST_ORDER_10).toContain('treat_confirm_nocode');
    const ordered = orderDocList(ACTIVE_DB_TEMPLATES);
    expect(ordered.map((t) => t.form_key)).toContain('treat_confirm_nocode');
  });

  test('HTML 템플릿 등록 + 상병(병명) 테이블 미렌더', () => {
    expect(isHtmlTemplate('treat_confirm_nocode')).toBe(true);
    const html = getHtmlTemplate('treat_confirm_nocode');
    expect(html).toBeTruthy();
    for (const m of DISEASE_MARKERS) expect(html!).not.toContain(m);
    for (const tok of DISEASE_TOKENS) expect(html!).not.toContain(tok);
    expect(html!).toContain('진 료 확 인 서'); // 제목 보존
  });

  test('바인딩 시 상병 코드·진단명 미출력', () => {
    const bound = bindHtmlTemplate(getHtmlTemplate('treat_confirm_nocode')!, SAMPLE_VALUES);
    expect(bound).not.toContain('L60.0');
    expect(bound).not.toContain('내향성 발톱');
    expect(bound).not.toMatch(/\{\{[a-z_0-9]+\}\}/i);
  });
});

// ── S3: 레거시 미노출 회귀 ──────────────────────────────────────────────────────
test.describe('S3 — 레거시 treat_confirm 패널 미노출(3중표시 차단)', () => {
  test('DOCLIST_ORDER_10 에서 단일 treat_confirm 제거', () => {
    expect(DOCLIST_ORDER_10).not.toContain('treat_confirm');
  });

  test('active 입력에 레거시 부재 → orderDocList 결과에 미표시 / code·nocode만 표시', () => {
    const keys = orderDocList(ACTIVE_DB_TEMPLATES).map((t) => t.form_key);
    expect(keys).not.toContain('treat_confirm');
    expect(keys.filter((k) => k.startsWith('treat_confirm')).sort()).toEqual([
      'treat_confirm_code',
      'treat_confirm_nocode',
    ]);
  });

  test('레거시 HTML 템플릿은 재출력 위해 보존(맵 유지)', () => {
    // 기존 발행문서 10건 재출력 경로 보존 — getHtmlTemplate('treat_confirm') 살아있음
    expect(getHtmlTemplate('treat_confirm')).toBeTruthy();
  });
});

// ── AC: 서류종류 1개 유지 (doc-serial VC 공유) ──────────────────────────────────
test.describe('AC — 서류종류 1개 유지: doc-serial prefix VC 공유', () => {
  test('code/nocode/legacy 모두 prefix=VC (11번째 서류종류 신설 없음)', () => {
    expect(docSerialPrefix('treat_confirm_code')).toBe('VC');
    expect(docSerialPrefix('treat_confirm_nocode')).toBe('VC');
    expect(docSerialPrefix('treat_confirm')).toBe('VC');
  });
});

// ── 회귀: 남은 서류 무영향 ──────────────────────────────────────────────────────
test.describe('회귀 — 진료확인서 외 서류 무영향', () => {
  test('orderDocList 항목 수 = 11 (진료확인서만 1→2, 나머지 9종 불변)', () => {
    expect(orderDocList(ACTIVE_DB_TEMPLATES)).toHaveLength(11);
  });

  test('비-진료확인서 서류 prefix/HTML 불변 (예: 소견서 OPN / 진단서 DIAG)', () => {
    expect(docSerialPrefix('diag_opinion')).toBe('OPN');
    expect(docSerialPrefix('diagnosis')).toBe('DIAG');
    expect(getHtmlTemplate('diagnosis')).toBeTruthy();
    expect(getHtmlTemplate('referral_letter')).toBeTruthy();
  });

  test('진료확인서 슬롯 순서: 소견서·진단서 다음, 진료의뢰서 앞', () => {
    const keys = orderDocList(ACTIVE_DB_TEMPLATES).map((t) => t.form_key);
    const iCode = keys.indexOf('treat_confirm_code');
    const iNocode = keys.indexOf('treat_confirm_nocode');
    expect(keys.indexOf('diagnosis')).toBeLessThan(iCode);
    expect(iCode).toBeLessThan(iNocode);
    expect(iNocode).toBeLessThan(keys.indexOf('referral_letter'));
  });
});
