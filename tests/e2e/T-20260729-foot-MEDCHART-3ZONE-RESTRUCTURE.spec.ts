/**
 * E2E spec — T-20260729-foot-MEDCHART-3ZONE-RESTRUCTURE (Phase B — 3구역 탭 재편 착수분)
 *   (김주연 총괄 요청 / 원장 U0ALGAAAJAV 직접 컨펌 캐논. 진료차트 = PHI 핵심 의료 surface.)
 *
 * 배경: 진료차트 3구역(파랑박스=우측 탭 패널) 탭을 [결제내역 | 발행서류 | 진료이미지]로 재편.
 *   원장 직접 컨펌 '삭제 항목 = 처방세트·상용구·상담·임상사진' + '슈퍼상용구→발행서류 개칭(템플릿 유지)'.
 *   planner Phase B 판정(CONDITIONAL_GO, MSG-20260730-125932-i40u):
 *     - 상담(consult)·임상사진(clinical_photos) = read-only 뷰어(입력능력 0) + superseded 확정 → 무회귀 삭제.
 *     - 처방세트(rx)·상용구(phrase) = in-chart 입력능력 보유 → 2구역 PMW read-path 검증(Phase A) 전까지 국소 HOLD.
 *
 * 본 스펙 범위(이번 착수분):
 *   AC-B1: '상담' 탭(consult) 삭제 — 탭 버튼·콘텐츠 블록·컴포넌트 import 모두 부재.
 *   AC-B2: '임상사진' 탭(clinical_photos) 삭제 — 동일.
 *   AC-B3: '슈퍼상용구' → '발행서류' 개칭 (탭 라벨). super-phrase 적용 기능(applySuperPhrase)은 유지.
 *   AC-B4: rightTab 타입 유니온에서 삭제 탭 값 제거 + legacy deep-link fallback 가드.
 *   AC-B5: 삭제 미대상(처방세트·상용구·방문이력·진료이미지) 탭은 보존(회귀 방지).
 *   AC-BUILD: 빌드 통과(dist/ MedicalChartPanel 번들 존재).
 *
 * 검증 방식: 진료차트 패널은 실 고객/인증 컨텍스트가 깊게 필요 → 소스 레벨 구조 불변식 assertion
 *   (본 레포 MEDCHART 계열 스펙 표준 패턴, T-20260527-TAB-REAPPEAR 등).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const panel = (): string =>
  fs.readFileSync('src/components/MedicalChartPanel.tsx', 'utf-8');
const chartPage = (): string =>
  fs.readFileSync('src/pages/CustomerChartPage.tsx', 'utf-8');

// ── AC-B1: '상담'(consult) 탭 삭제 ──────────────────────────────────────────
test.describe('T-20260729 MEDCHART-3ZONE Phase B / AC-B1: 상담 탭 삭제', () => {
  test('탭 버튼 배열에 consult 엔트리 부재', () => {
    const s = panel();
    expect(s).not.toContain("{ key: 'consult', label: '상담' }");
  });
  test('consult 콘텐츠 블록(rightTab === consult) 부재', () => {
    const s = panel();
    expect(s).not.toContain("rightTab === 'consult'");
  });
  test('ConsultRecordTab import·사용 부재', () => {
    const s = panel();
    expect(s).not.toContain("import ConsultRecordTab");
    expect(s).not.toContain('<ConsultRecordTab');
  });
});

// ── AC-B2: '임상사진'(clinical_photos) 탭 삭제 ──────────────────────────────
test.describe('T-20260729 MEDCHART-3ZONE Phase B / AC-B2: 임상사진 탭 삭제', () => {
  test('탭 버튼 배열에 clinical_photos 엔트리 부재', () => {
    const s = panel();
    expect(s).not.toContain("{ key: 'clinical_photos', label: '임상사진' }");
  });
  test('clinical_photos 콘텐츠 블록 부재', () => {
    const s = panel();
    expect(s).not.toContain("rightTab === 'clinical_photos'");
  });
  test('TreatmentPhotoGallery import·사용 부재', () => {
    const s = panel();
    expect(s).not.toContain("import TreatmentPhotoGallery");
    expect(s).not.toContain('<TreatmentPhotoGallery');
  });
});

// ── AC-B3: 슈퍼상용구 → 발행서류 개칭 (템플릿 기능 유지) ──────────────────────
test.describe('T-20260729 MEDCHART-3ZONE Phase B / AC-B3: 발행서류 개칭', () => {
  test("탭 라벨 '발행서류' 존재 + super 키 보존(하위호환)", () => {
    const s = panel();
    expect(s).toContain("{ key: 'super', label: '발행서류' }");
  });
  test("탭 라벨에 '슈퍼상용구' 부재(개칭 완료)", () => {
    const s = panel();
    expect(s).not.toContain("label: '슈퍼상용구'");
  });
  test('super-phrase 적용 기능(applySuperPhrase) 유지 — 템플릿 능력 보존', () => {
    const s = panel();
    expect(s).toContain('applySuperPhrase');
  });
});

// ── AC-B4: 타입 유니온 정리 + legacy deep-link fallback ─────────────────────
test.describe('T-20260729 MEDCHART-3ZONE Phase B / AC-B4: 타입·fallback', () => {
  test('rightTab useState 유니온에 consult/clinical_photos 부재', () => {
    const s = panel();
    // 삭제된 탭 값이 rightTab 유니온에 남아있지 않아야 함(신규 useState 라인 기준)
    expect(s).toContain("useState<'rx' | 'phrase' | 'super' | 'visit_hist' | 'images'>('rx')");
  });
  test('legacy deep-link fallback 가드(validTabs) 존재', () => {
    const s = panel();
    expect(s).toContain('validTabs');
    expect(s).toContain("'rx', 'phrase', 'super', 'visit_hist', 'images'");
  });
  test('CustomerChartPage RIGHT_TAB_KEYS 에서 consult 제거', () => {
    const s = chartPage();
    expect(s).toContain("const RIGHT_TAB_KEYS = ['rx', 'phrase', 'super', 'visit_hist', 'images'] as const");
    expect(s).not.toContain("'visit_hist', 'images', 'consult'");
  });
});

// ── AC-B5: 삭제 미대상 탭 보존(회귀 방지) ────────────────────────────────────
test.describe('T-20260729 MEDCHART-3ZONE Phase B / AC-B5: 미대상 탭 보존', () => {
  test('처방세트(rx) 탭 보존 — Phase A PMW read-path 검증까지 국소 HOLD', () => {
    const s = panel();
    expect(s).toContain("{ key: 'rx', label: '처방세트' }");
    expect(s).toContain("rightTab === 'rx'");
  });
  test('상용구(phrase) 탭 보존', () => {
    const s = panel();
    expect(s).toContain("{ key: 'phrase', label: '상용구' }");
    expect(s).toContain("rightTab === 'phrase'");
  });
  test('방문이력(visit_hist)·진료이미지(images) 탭 보존', () => {
    const s = panel();
    expect(s).toContain("{ key: 'visit_hist', label: '방문이력' }");
    expect(s).toContain("{ key: 'images', label: '진료이미지' }");
  });
});

// ── AC-BUILD: 번들 생성 확인 ─────────────────────────────────────────────────
test.describe('T-20260729 MEDCHART-3ZONE Phase B / AC-BUILD', () => {
  test('dist/ MedicalChartPanel 번들 존재 (빌드 통과)', () => {
    const distAssets = fs.existsSync('dist/assets') ? fs.readdirSync('dist/assets') : [];
    const hasMedBundle = distAssets.some(f => f.startsWith('MedicalChartPanel') || f.startsWith('CustomerChartPage'));
    expect(hasMedBundle).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Phase A — 처방-무관 착수분 (planner INFO MSG-20260730-151904-dov6 승인)
//  원장 캐논 3구역 발행서류: "해당 고객 앞으로 발행된 서류 일자별로 리스트업 상단에 추가".
//  planner no-regression 불변식(즉시 확정): 2구역 처방내역 약이름-only 다운그레이드 금지 /
//    rx·phrase 탭 삭제·재소싱 HOLD 유지(문원장 A/B/C field 결정 대기).
//  검증 방식: 소스 레벨 구조 불변식 assertion (Phase B와 동일 표준).
// ══════════════════════════════════════════════════════════════════════════════

// ── AC-A1: 발행서류 일자별 리스트 섹션 신설 ─────────────────────────────────
test.describe('T-20260729 MEDCHART-3ZONE Phase A / AC-A1: 발행서류 일자별 리스트', () => {
  test("발행서류 탭에 일자별 리스트 섹션(issued-docs-section) 존재", () => {
    const s = panel();
    expect(s).toContain('data-testid="issued-docs-section"');
    expect(s).toContain('발행 서류 (일자별)');
  });
  test('loadIssuedDocs 로더 + lazy-load 트리거(rightTab super) 존재', () => {
    const s = panel();
    expect(s).toContain('loadIssuedDocs');
    expect(s).toContain("else if (rightTab === 'super') loadIssuedDocs()");
  });
  test('로딩/에러/빈/리스트 4상태 렌더 분기 존재', () => {
    const s = panel();
    expect(s).toContain('data-testid="issued-docs-loading"');
    expect(s).toContain('data-testid="issued-docs-error"');
    expect(s).toContain('data-testid="issued-docs-empty"');
    expect(s).toContain('data-testid="issued-docs-list"');
  });
});

// ── AC-A2: 발행서류 소스 = form_submissions (기존 패턴 재사용·read-only·additive) ──
test.describe('T-20260729 MEDCHART-3ZONE Phase A / AC-A2: 소스 재사용', () => {
  test("소스 = form_submissions + form_templates(form_key) 조인 (CustomerChartPage 발행서류 조회 패턴 재사용)", () => {
    const s = panel();
    expect(s).toContain(".from('form_submissions')");
    expect(s).toContain('form_templates!template_id(form_key)');
  });
  test('발행 시각(printed_at/signed_at) 있는 항목만 = 실제 발행 이력', () => {
    const s = panel();
    expect(s).toContain('r.ts'); // ts = printed_at ?? signed_at, filter(r => r.ts)
  });
  test('read-only — loadIssuedDocs 로더는 select 전용(insert/update/delete 미포함)', () => {
    const s = panel();
    const start = s.indexOf('const loadIssuedDocs');
    expect(start, 'loadIssuedDocs 로더 존재').toBeGreaterThan(-1);
    // 로더 함수 본문 범위(다음 useCallback/함수까지) 슬라이스
    const body = s.slice(start, start + 1600);
    expect(body).toContain('.select(');
    expect(body).not.toContain('.insert(');
    expect(body).not.toContain('.update(');
    expect(body).not.toContain('.delete(');
  });
});

// ── AC-A3: 일자별 그룹핑 ────────────────────────────────────────────────────
test.describe('T-20260729 MEDCHART-3ZONE Phase A / AC-A3: 일자별 그룹핑', () => {
  test('groupIssuedDocsByDate — 최신 일자 먼저 그룹핑', () => {
    const s = panel();
    expect(s).toContain('function groupIssuedDocsByDate');
    expect(s).toContain('data-testid="issued-docs-date-group"');
  });
  test('form_key → 한국어 라벨 매핑(fmtDocLabel/ISSUED_DOC_LABEL) 존재', () => {
    const s = panel();
    expect(s).toContain('ISSUED_DOC_LABEL');
    expect(s).toContain('function fmtDocLabel');
  });
});

// ── AC-A4: G1 폴백 불변식 가드 (문원장 B 결정 후 갱신) ──────────────────────
//   문원장 B(2026-07-30 ts 1785395371.418339)로 "약이름-only 다운그레이드 금지" interim 은 LIFTED.
//   B = PMW 유입 처방약 약이름-only 표시(의도적 결정, 회귀 아님). 단 G1(legacy 이력손실 방지) 가드는 유지:
//   PMW 처방약 없는 방문은 기존 formRx(prescription_items 구조화)로 폴백해야 함.
test.describe('T-20260729 MEDCHART-3ZONE Phase A / AC-A4: G1 legacy 폴백 불변식', () => {
  test('G1 폴백 — PMW 처방약 없을 때 formRx(prescription_items 구조화) 표시 경로 유지', () => {
    const s = panel();
    // 재소싱 3항 ternary: visitRxDrugNames(PMW) → formRx(구조화·legacy 폴백) → 빈 상태
    expect(s).toContain('prescription_items');
    expect(s).toContain('formRx.length > 0');
    // PMW 브랜치가 비었을 때만 formRx 로 폴백하는 순서 보장
    expect(s).toContain('visitRxDrugNames.length > 0 ? (');
  });
  test('rx(처방세트) 탭 잔존 — Q2 순서 게이트(재소싱→실브라우저 확인→삭제) 미도달, 삭제 금지', () => {
    const s = panel();
    expect(s).toContain("{ key: 'rx', label: '처방세트' }");
    expect(s).toContain("rightTab === 'rx'");
  });
  test('phrase(상용구) 탭 잔존 — G2 보류 가드 유지(대체경로 브라우저 확인 前 삭제 금지)', () => {
    const s = panel();
    expect(s).toContain("{ key: 'phrase', label: '상용구' }");
    expect(s).toContain("rightTab === 'phrase'");
  });
});

// ── AC-A5: rx 재소싱 배선 (문원장 B — PMW 유입 처방약 약이름-only) ───────────────
//   재소싱 = JINRYO-ALIMPAN read 로직(extractRxDrugNames) 재사용, 무근거 재구현 금지.
//   소스 = check_in_services(services.category_label='처방약') → service_name(약이름).
test.describe('T-20260729 MEDCHART-3ZONE Phase A / AC-A5: rx 재소싱 배선(문원장 B)', () => {
  test('extractRxDrugNames(JINRYO read 로직) import 재사용 — 신규 PMW 쿼리 재구현 금지', () => {
    const s = panel();
    expect(s).toContain("import { extractRxDrugNames } from '@/lib/opinionRequest'");
    expect(s).toContain('extractRxDrugNames(');
  });
  test('재소싱 로더 loadVisitRxDrugNames — check_in_services 처방약 조회(read-only)', () => {
    const s = panel();
    const start = s.indexOf('const loadVisitRxDrugNames');
    expect(start, 'loadVisitRxDrugNames 로더 존재').toBeGreaterThan(-1);
    const body = s.slice(start, start + 1400);
    expect(body).toContain(".from('check_in_services')");
    expect(body).toContain('services:service_id(category_label)');
    expect(body).not.toContain('.insert(');
    expect(body).not.toContain('.update(');
    expect(body).not.toContain('.delete(');
  });
  test('PMW 약이름-only 표시 브랜치(rx-pmw-name) 존재 — B 의도적 표시', () => {
    const s = panel();
    expect(s).toContain('data-testid="prescription-items-pmw"');
    expect(s).toContain('rx-pmw-name-');
  });
  test('로더가 방문 로드/일자 변경 시 배선(resetForm + date onChange)', () => {
    const s = panel();
    expect(s).toContain('loadVisitRxDrugNames(chart.visit_date)');
    expect(s).toContain('loadVisitRxDrugNames(today)');
    expect(s).toContain('loadVisitRxDrugNames(e.target.value)');
  });
});
