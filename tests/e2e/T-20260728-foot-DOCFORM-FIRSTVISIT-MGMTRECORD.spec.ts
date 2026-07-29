/**
 * E2E Spec — T-20260728-foot-DOCFORM-FIRSTVISIT-MGMTRECORD
 *
 * 풋 CRM 서류 목록에 '초진 관리기록지'(초진 상태·관리계획 9섹션 양식) 신규 추가.
 * 기존 DocumentPrintPanel 패턴 재사용(중복 구현·별도 동선 금지). 인쇄 출력까지 동일 동선.
 *
 * 검증(SSOT 단위 + HTML 템플릿 무결성 — 실서버 불필요):
 *  - AC-1: DOCLIST_ORDER_10 화이트리스트에 first_visit_mgmt_record 등재(목록 노출 게이트).
 *  - AC-1: groupDocList 결과에 '관리기록' 그룹 신설 + 해당 서류 귀속(제증명과 분리).
 *  - AC-2: HTML 템플릿에 9개 섹션 + 서명영역(발급일/센터명/담당자/직인) 모두 렌더.
 *  - AC-2: 자동채움 필드(성명·생년월일·연락처·초진일) 바인딩. 미체크 체크박스는 빈 네모(플레이스홀더 노출 0).
 *  - AC-3: template_format='html' + getHtmlTemplate 반환(DocumentPrintPanel HTML 경로 재사용).
 *  - AC-5(회귀 0): 기존 확정 11종 form_key·순서 prefix 보존 + 중복 0. 기존 HTML 템플릿 무접촉.
 *  - 엣지: 빈 값(신규 고객)에서도 {{...}} 미치환 잔존 0(양식 깨짐 없음).
 *
 * 실행: npx playwright test T-20260728-foot-DOCFORM-FIRSTVISIT-MGMTRECORD.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  DOCLIST_ORDER_10,
  DOC_CATEGORY_JEUNGMYEONG_KEYS,
  DOC_CATEGORY_MGMTRECORD_KEYS,
  DOC_GROUP_LABEL_MGMTRECORD,
  DOC_GROUP_LABEL_JEUNGMYEONG,
  FALLBACK_TEMPLATES,
  FORM_META,
  groupDocList,
  orderDocList,
  type FormTemplate,
} from '../../src/lib/formTemplates';
import { getHtmlTemplate, bindHtmlTemplate } from '../../src/lib/htmlFormTemplates';

const NEW_KEY = 'first_visit_mgmt_record';

function mockTpl(form_key: string, name_ko: string): FormTemplate {
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
    active: true,
    sort_order: 0,
  };
}

// 운영 DB 정본 11종 + 신규 초진 관리기록지(=12) 시뮬레이션 입력.
const CONFIRMED_11 = [
  'bill_receipt_new', 'bill_detail', 'rx_standard', 'koh_result', 'diag_opinion',
  'diagnosis', 'treat_confirm_code', 'treat_confirm_nocode', 'referral_letter',
  'visit_confirm', 'medical_record_request',
];

// ── AC-1: 목록 노출 게이트 (화이트리스트) ──────────────────────────────────
test('AC-1: DOCLIST_ORDER_10 에 초진 관리기록지 additive 등재 + 11종 prefix 보존', () => {
  expect(DOCLIST_ORDER_10).toContain(NEW_KEY);
  // 확정 11종이 선두 prefix 로 순서·항목 보존(회귀 0), 신규는 뒤에 append.
  expect(DOCLIST_ORDER_10.slice(0, CONFIRMED_11.length)).toEqual(CONFIRMED_11);
  // 중복 없음
  expect(new Set(DOCLIST_ORDER_10).size).toBe(DOCLIST_ORDER_10.length);
});

// ── AC-1: '관리기록' 그룹 신설 + 귀속 ───────────────────────────────────────
test("AC-1: groupDocList — '관리기록' 그룹 신설 + 초진 관리기록지 귀속(제증명과 분리)", () => {
  expect(DOC_CATEGORY_MGMTRECORD_KEYS).toContain(NEW_KEY);
  // 제증명 그룹엔 초진 관리기록지가 섞이지 않는다.
  expect(DOC_CATEGORY_JEUNGMYEONG_KEYS).not.toContain(NEW_KEY);

  const input = [...CONFIRMED_11, NEW_KEY].map((k) => mockTpl(k, k));
  const groups = groupDocList(input);
  const mgmt = groups.find((g) => g.label === DOC_GROUP_LABEL_MGMTRECORD);
  const jeung = groups.find((g) => g.label === DOC_GROUP_LABEL_JEUNGMYEONG);

  expect(mgmt).toBeTruthy();
  expect(mgmt!.templates.map((t) => t.form_key)).toContain(NEW_KEY);
  // 제증명 그룹엔 초진 관리기록지 미포함(분리 노출)
  expect(jeung!.templates.map((t) => t.form_key)).not.toContain(NEW_KEY);
  // 전체 노출 개수 = 12(11 제증명계열 + 1 관리기록), orderDocList 통과분과 일치
  const total = groups.reduce((n, g) => n + g.templates.length, 0);
  expect(total).toBe(orderDocList(input).length);
});

// ── AC-3: HTML 경로 재사용 + FALLBACK/META 정합 ─────────────────────────────
test('AC-3: template_format=html + getHtmlTemplate 반환 + FALLBACK/FORM_META 정합', () => {
  const fb = FALLBACK_TEMPLATES.find((t) => t.form_key === NEW_KEY);
  expect(fb).toBeTruthy();
  expect(fb!.template_format).toBe('html');
  expect(fb!.category).toBe('foot-service');
  expect(fb!.name_ko).toBe('초진 관리기록지');
  // 의료 게이트 서류 아님 → 데스크 직군 발행. 의사 전용 required_role 아님.
  expect(fb!.required_role).toContain('admin');
  expect(FORM_META[NEW_KEY]).toBeTruthy();
  expect(getHtmlTemplate(NEW_KEY)).not.toBeNull();
});

// ── AC-2: 섹션 + 서명영역 렌더 (T-20260729-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P2 로 개편된 정본 구조) ──
//   NOTE: 본 양식은 T-20260729-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P2 로 7건 개편됨(관리부위·발가락·초진촬영기록·
//   기타확인·발톱상태·관리계획 제거 / 시술및처방·상병명·증상경과·2열 서명란 반영). 개편 세부 검증은
//   T-20260729-foot-DOCFORM-FIRSTVISIT-MGMTRECORD-P2.spec.ts. 본 회귀 테스트는 개편 후 잔존 불변 섹션만 확인.
test('AC-2: HTML 템플릿에 잔존 섹션 + 서명영역 마커 존재(개편 후)', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  expect(html).toContain('초 진 관 리 기 록 지');
  for (const label of [
    '성', '생년월일', '연 락 처', '초 진 일',
    '방문 목적', '증상 발생 경위', '증상경과',
    '피부 상태', '통증 여부', '보행 불편',
    '시술 및 처방', '상병명', '특이사항',
    '발 급 일', '담당의사 (성함 / 직인)', '병원명 (법인도장)',
  ]) {
    expect(html).toContain(label);
  }
  for (const cb of ['내성발톱', '무좀발톱', '두꺼운 발톱', '변형발톱']) {
    expect(html).toContain(cb);
  }
});

// ── AC-2: 자동채움 바인딩 + 미치환 플레이스홀더 잔존 0 ───────────────────────
test('AC-2: bindHtmlTemplate — 자동채움 + 체크마크 바인딩 + {{}} 잔존 0', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  const values: Record<string, string> = {
    patient_name: '홍길동',
    patient_birthdate: '1990년 05월 15일',
    patient_phone: '010-1234-5678',
    visit_date: '2026년 07월 29일',
    issue_date: '2026년 07월 29일',
    clinic_name: '오블리브 풋센터 종로',
    doctor_name: '김담당',
    institution_seal_html: '(인)',
    // 체크: 내성발톱 + 좌 + 엄지 + 통증있음
    vp_ingrown: '✔', side_left: '✔', toe_1: '✔', pain_yes: '✔',
  };
  const bound = bindHtmlTemplate(html, values);
  expect(bound).toContain('홍길동');
  expect(bound).toContain('010-1234-5678');
  expect(bound).toContain('1990년 05월 15일');
  expect(bound).toContain('오블리브 풋센터 종로');
  // 미치환 {{...}} 잔존 0 (bindHtmlTemplate 이 미설정 키를 '' 로 치환)
  expect(bound).not.toMatch(/\{\{\s*\w+\s*\}\}/);
});

// ── 엣지: 빈 값(신규 고객)에서도 양식 깨짐/플레이스홀더 노출 0 ─────────────────
test('엣지: 빈 값 바인딩 — {{}} 잔존 0(양식 렌더 무결)', () => {
  const html = getHtmlTemplate(NEW_KEY)!;
  const bound = bindHtmlTemplate(html, {});
  expect(bound).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  expect(bound).toContain('초 진 관 리 기 록 지');
});

// ── AC-5: 회귀 0 — 기존 확정 11종 HTML 템플릿 무접촉 ───────────────────────────
test('AC-5: 기존 HTML 서류 템플릿 회귀 0(모두 반환·초진 관리기록지 미침투)', () => {
  for (const k of ['bill_receipt_new', 'bill_detail', 'koh_result', 'diagnosis', 'visit_confirm']) {
    const tpl = getHtmlTemplate(k);
    expect(tpl).not.toBeNull();
    expect(tpl!).not.toContain('초 진 관 리 기 록 지');
  }
});
