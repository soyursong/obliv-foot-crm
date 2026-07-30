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
