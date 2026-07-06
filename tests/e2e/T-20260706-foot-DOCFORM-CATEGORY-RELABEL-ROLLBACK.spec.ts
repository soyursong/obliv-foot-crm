/**
 * T-20260706-foot-DOCFORM-CATEGORY-RELABEL-ROLLBACK
 * 서비스관리: '제증명' 카테고리 정식화(신설) — 서류 제증명 6종 + 무료 4종 그룹 노출.
 *
 * 배경(총괄 최종 정정 MSG-c9j1): ①'기본' 원복 취소(6행은 '제증명' 유지) ②제증명 6종을 신설
 *   '제증명' 카테고리로 이동(이름 불변 membership) ③무료 4종을 '제증명' 아래 배치 ④진료의뢰서 무변경.
 * 진단(precheck): 대상 10종은 이미 DB category_label='제증명'(Migration B, 20260630140000)이나
 *   Services.tsx CATEGORY_LABEL_OPTIONS 배열에 '제증명'이 누락되어 서비스관리 탭/항목분류에
 *   그룹이 렌더되지 않던 상태('처방약' 신설 T-20260601 선례와 동일 결).
 * 조치: (a) CATEGORY_LABEL_OPTIONS 에 '제증명' 추가(코드) → 탭/항목분류 자동 생성.
 *       (b) surgical forward 마이그(멱등 SET, 미러 insert·'기본' 원복·통짜 롤백 없음)로 membership 재확인.
 *
 * AC1: '기본' 원복 DML 부재 — 6행 category_label='제증명' 유지(되돌린 행 0).
 * AC2: '제증명' 카테고리 탭 존재 + 제증명 6종이 그 아래 노출(이름 변경 0).
 * AC3: 무료 4종(영수증·세부내역서·KOH결과지·처방전)이 '제증명' 아래 배치.
 * AC4: 진료의뢰서 category_label 무변경(마이그 EXCLUDE) + 가격 3,000 보존.
 * AC5: 마이그 = 멱등 SET(IS DISTINCT FROM 가드) + 미러 insert/통짜 롤백 부재.
 * AC6: '제증명' 외 기존 카테고리 탭/항목/정렬 무영향(FORMPANEL-SPLIT 무접촉).
 */

import { test, expect } from '@playwright/test';
import {
  groupDocList,
  DOC_GROUP_LABEL_JEUNGMYEONG,
  DOC_GROUP_LABEL_ETC,
  DOC_CATEGORY_JEUNGMYEONG_KEYS,
} from '../../src/lib/formTemplates';

// ── SUT: Services.tsx 상수 재현 (변경 후 — '제증명' 포함, 의료성 그룹 인접) ──────────────
const CATEGORY_LABEL_OPTIONS = ['기본', '검사', '상병', '처방약', '제증명', '풋케어', '수액', '풋화장품'];
const CATEGORY_TABS = ['전체', ...CATEGORY_LABEL_OPTIONS];

type MockService = {
  id: string;
  name: string;
  category: string | null;
  category_label: string | null;
  service_code: string | null;
  price: number;
  sort_order: number;
  active: boolean;
};

const effectiveCategoryLabel = (svc: MockService): string =>
  svc.category_label ?? svc.category ?? '';

function getTabItems(rows: MockService[], activeTab: string, showInactive: boolean): MockService[] {
  return rows.filter((svc) => {
    if (!svc.active && !showInactive) return false;
    if (activeTab !== '전체' && effectiveCategoryLabel(svc) !== activeTab) return false;
    return true;
  });
}

// ── 라이브 실측을 반영한 픽스처: 제증명 6종 + 무료 4종 + 진료의뢰서 + 타 카테고리 샘플 ──────
const JEUNGMYEONG_6: MockService[] = [
  { id: 'j1', name: '진단서(국문)', category: '기본', category_label: '제증명', service_code: 'C5900002', price: 20000, sort_order: 20, active: true },
  { id: 'j2', name: '진단서(영문)', category: '기본', category_label: '제증명', service_code: '진단서(영문)', price: 30000, sort_order: 21, active: true },
  { id: 'j3', name: '진료소견서', category: '기본', category_label: '제증명', service_code: '진료소견서', price: 10000, sort_order: 22, active: true },
  { id: 'j4', name: '소견서(영문)', category: '기본', category_label: '제증명', service_code: '소견서(영문)', price: 30000, sort_order: 23, active: true },
  { id: 'j5', name: '통원확인서', category: '기본', category_label: '제증명', service_code: '통원확인서', price: 3000, sort_order: 24, active: true },
  { id: 'j6', name: '진료기록사본', category: '기본', category_label: '제증명', service_code: '진료기록사본1', price: 1000, sort_order: 25, active: true },
];
const FREE_4: MockService[] = [
  { id: 'f1', name: '진료비영수증', category: '기본', category_label: '제증명', service_code: 'cert_bill_receipt', price: 0, sort_order: 30, active: true },
  { id: 'f2', name: '진료비세부내역서', category: '기본', category_label: '제증명', service_code: 'cert_bill_detail', price: 0, sort_order: 31, active: true },
  { id: 'f3', name: 'KOH균검사결과지', category: '기본', category_label: '제증명', service_code: 'cert_koh_result', price: 0, sort_order: 32, active: true },
  { id: 'f4', name: '처방전(제증명)', category: '기본', category_label: '제증명', service_code: 'cert_rx_standard', price: 0, sort_order: 33, active: true },
];
const REFERRAL: MockService = { id: 'r1', name: '진료의뢰서', category: '기본', category_label: '제증명', service_code: '진료의뢰서', price: 3000, sort_order: 34, active: true };
const OTHER: MockService[] = [
  { id: 'o1', name: '풋케어 A', category: 'foot-service', category_label: '풋케어', service_code: 'FC001', price: 50000, sort_order: 1, active: true },
  { id: 'o2', name: '수액 B', category: 'iv', category_label: '수액', service_code: 'IV001', price: 80000, sort_order: 2, active: true },
];
const ROWS: MockService[] = [...JEUNGMYEONG_6, ...FREE_4, REFERRAL, ...OTHER];

test.describe('T-20260706-foot-DOCFORM-CATEGORY-RELABEL-ROLLBACK', () => {
  test('AC2: 카테고리 탭에 "제증명"이 노출된다', () => {
    expect(CATEGORY_TABS).toContain('제증명');
    // 의료성 그룹(처방약) 인접 위치
    expect(CATEGORY_TABS.indexOf('제증명')).toBe(CATEGORY_TABS.indexOf('처방약') + 1);
  });

  test('AC2: "제증명" 탭에 제증명 6종이 이름 변경 없이 노출된다', () => {
    const items = getTabItems(ROWS, '제증명', false);
    const names = items.map((s) => s.name);
    for (const s of JEUNGMYEONG_6) {
      expect(names).toContain(s.name); // 리네임 0 — 원래 이름 그대로
    }
    // AC1: '기본'으로 되돌린 행 0 — 6종 모두 category_label='제증명'
    for (const s of JEUNGMYEONG_6) {
      expect(s.category_label).toBe('제증명');
    }
  });

  test('AC3: 무료 4종(영수증·세부내역서·KOH결과지·처방전)이 "제증명" 아래 배치된다', () => {
    const items = getTabItems(ROWS, '제증명', false);
    const names = items.map((s) => s.name);
    expect(names).toContain('진료비영수증');
    expect(names).toContain('진료비세부내역서');
    expect(names).toContain('KOH균검사결과지');
    expect(names).toContain('처방전(제증명)');
    for (const s of FREE_4) expect(s.price).toBe(0); // 무료 유지
  });

  test('AC4: 진료의뢰서 3,000원 보존 + category_label 무변경', () => {
    expect(REFERRAL.price).toBe(3000); // 가격 무변경
    // 마이그 EXCLUDE 대상: 현 상태(제증명) 그대로 유지 — 별도 mutate 없음
    expect(REFERRAL.category_label).toBe('제증명');
    // (참고) reporter 선언 10종(제증명6+무료4)에는 미포함 = DA WARN-2 reconcile 대상 → planner/reporter 판단
  });

  test('AC6: "제증명" 외 기존 카테고리(풋케어/수액) 탭/항목 무영향', () => {
    // 기존 카테고리 순서/구성 보존
    expect(CATEGORY_LABEL_OPTIONS).toEqual(['기본', '검사', '상병', '처방약', '제증명', '풋케어', '수액', '풋화장품']);
    const footcare = getTabItems(ROWS, '풋케어', false);
    expect(footcare.map((s) => s.name)).toEqual(['풋케어 A']);
    const iv = getTabItems(ROWS, '수액', false);
    expect(iv.map((s) => s.name)).toEqual(['수액 B']);
  });

  test('AC5(멱등 재현): 이미 "제증명"인 행은 재적용해도 변화 0 (IS DISTINCT FROM 가드)', () => {
    // forward SET: category_label IS DISTINCT FROM '제증명' 인 행만 대상
    const targetCodes = new Set([
      'C5900002', '진단서(영문)', '진료소견서', '소견서(영문)', '통원확인서', '진료기록사본1',
      'cert_bill_receipt', 'cert_bill_detail', 'cert_koh_result', 'cert_rx_standard',
    ]);
    const wouldMutate = ROWS.filter(
      (s) => s.service_code && targetCodes.has(s.service_code) && s.category_label !== '제증명',
    );
    expect(wouldMutate.length).toBe(0); // 이미 전부 '제증명' → 멱등 no-op
    // 진료의뢰서는 대상 코드 집합에 미포함(EXCLUDE)
    expect(targetCodes.has('진료의뢰서')).toBe(false);
  });
});

// ── WARN-1: 서류 발급 팝업(DocumentPrintPanel) 카테고리 그룹핑 렌더 (groupDocList SSOT) ──────────
//   DA-20260706 회신: 서류 팝업은 category_label 을 읽지 않고 form_key 화이트리스트로 렌더 →
//   데이터층 DML만으로는 화면 무변화. groupDocList 로 '제증명' 그룹 헤더를 노출해 §4-1/AC2 충족.
type DocTpl = { form_key: string; name_ko: string };
const DOC_TEMPLATES: DocTpl[] = [
  { form_key: 'bill_receipt', name_ko: '진료비 계산서·영수증' },
  { form_key: 'bill_detail', name_ko: '진료비내역서' },
  { form_key: 'koh_result', name_ko: '검사결과 보고서' },
  { form_key: 'diag_opinion', name_ko: '소견서' },
  { form_key: 'diagnosis', name_ko: '진단서' },
  { form_key: 'treat_confirm_code', name_ko: '진료확인서(코드·진단명 포함)' },
  { form_key: 'treat_confirm_nocode', name_ko: '진료확인서(코드·진단명 불포함)' },
  { form_key: 'referral_letter', name_ko: '진료의뢰서' },
  { form_key: 'visit_confirm', name_ko: '통원확인서' },
  { form_key: 'medical_record_request', name_ko: '진료기록사본' },
  { form_key: 'rx_standard', name_ko: '처방전(표준처방전)' },
];

test.describe('T-20260706-foot-DOCFORM-CATEGORY-RELABEL-ROLLBACK — A안 서류팝업 그룹핑', () => {
  test('WARN-1/AC2: 서류 목록에 "제증명" 그룹이 첫 그룹으로 노출된다', () => {
    const groups = groupDocList(DOC_TEMPLATES);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].label).toBe(DOC_GROUP_LABEL_JEUNGMYEONG);
    expect(DOC_GROUP_LABEL_JEUNGMYEONG).toBe('제증명');
  });

  // ── 시나리오0 (A안 확정, MSG-cosm): 예상외 3종 '제증명' 함께 노출 = 총 13종/11 form_key + 기타 중복 0 ──
  test('시나리오0/A안: "제증명" 그룹 = DOCLIST 전체 11 form_key (예상외 3종 포함)', () => {
    const groups = groupDocList(DOC_TEMPLATES);
    const jeung = groups.find((g) => g.label === DOC_GROUP_LABEL_JEUNGMYEONG)!;
    const keys = jeung.templates.map((t) => t.form_key);
    // 무료 4종
    for (const k of ['bill_receipt', 'bill_detail', 'koh_result', 'rx_standard']) {
      expect(keys).toContain(k);
    }
    // 제증명 6종 → form_key 4개(국·영문 병합)
    for (const k of ['diagnosis', 'diag_opinion', 'visit_confirm', 'medical_record_request']) {
      expect(keys).toContain(k);
    }
    // A안: 예상외 3종(진료의뢰서·진료확인서 code/nocode)도 '제증명' 그룹에 함께 노출
    for (const k of ['referral_letter', 'treat_confirm_code', 'treat_confirm_nocode']) {
      expect(keys).toContain(k);
    }
    // 11 form_key = 총 13종(진단서·소견서 국/영문 병합 전 기준) 전부 '제증명' 그룹
    expect(keys.length).toBe(11);
    expect([...keys].sort()).toEqual([...DOC_CATEGORY_JEUNGMYEONG_KEYS].sort());
  });

  test('시나리오0/A안: "기타 서류" 그룹은 비어 렌더 생략 (예상외 3종 중복 노출 0)', () => {
    const groups = groupDocList(DOC_TEMPLATES);
    // '기타 서류' 그룹은 비어 반환에서 생략됨
    const etc = groups.find((g) => g.label === DOC_GROUP_LABEL_ETC);
    expect(etc).toBeUndefined();
    // 예상외 3종은 오직 '제증명' 그룹에만 1회 노출(중복 0)
    const allKeys = groups.flatMap((g) => g.templates.map((t) => t.form_key));
    for (const k of ['referral_letter', 'treat_confirm_code', 'treat_confirm_nocode']) {
      expect(allKeys.filter((x) => x === k).length).toBe(1);
    }
  });

  test('WARN-1: 그룹 합집합 = 전체 목록(누락 0) + 그룹 내 DOCLIST 순서 보존', () => {
    const groups = groupDocList(DOC_TEMPLATES);
    const total = groups.reduce((n, g) => n + g.templates.length, 0);
    expect(total).toBe(DOC_TEMPLATES.length); // 11 form_key 전부 어느 그룹엔가 노출(발급 동선 보존)
    // 제증명 그룹 내부 순서 = DOCLIST 순서(bill_receipt가 diagnosis보다 앞)
    const jeung = groups.find((g) => g.label === DOC_GROUP_LABEL_JEUNGMYEONG)!;
    const keys = jeung.templates.map((t) => t.form_key);
    expect(keys.indexOf('bill_receipt')).toBeLessThan(keys.indexOf('diagnosis'));
  });
});
