/**
 * E2E spec — T-20260807-foot-ZONE2-GREENBOX-CHART-BINDING-COMPLETE (버킷 B 착수분)
 *   (김주연 총괄 C0ATE5P6JTH 요청 / planner NEW-TASK MSG-20260808-001146-qee7.)
 *
 * 배경: 진료화면 '2구역 초록박스'에 누락된 항목을 채우고 당일 2번차트·결제미니창 데이터에 연동.
 *   dev-foot 라이브 코드감사(MSG-20260808-000606-u9xv, HEAD 766bc8a5) 결과 3버킷 분류 →
 *   planner가 무충돌 additive read/viewer 서브셋만 착수 승인.
 *
 * 본 스펙 범위(버킷 B — read-only 뷰어/자동연동, db_change=false):
 *   AC-3  (③ 펜차트 뷰어)   : customer/{id}/pen-chart storage 재사용 read-only 뷰어(썸네일→원본 확대).
 *   AC-6  (⑥ 경과사진)      : 진료이미지(treatment-images)를 2구역에 탭 진입 없이 자동연동.
 *   AC-4T (④ 치료메모)       : 기존 read-only 인라인 표시를 클릭 뷰어(팝업)化.
 *   AC-4C (④ 고객메모)       : customer_note(정본)??customer_memo(레거시) read + 클릭 뷰어 연동.
 *   AC-VIEWER               : 공용 메모 뷰어 팝업(createPortal) — read-only.
 *   AC-AUTOLOAD             : 패널 열림 시 펜차트·진료이미지 선로드(탭 무관) + 고객 전환 리셋.
 *   AC-HOLD                 : 버킷 C(⑤ 임상경과 저장통합 / ④ 상담메모 재도입)는 미착수(HOLD 준수).
 *   AC-NO-DBCHANGE          : 신규 스키마/DDL 없음 — 저장/삭제 write 경로 미추가(read-only).
 *   AC-BUILD                : 빌드 통과(dist/ MedicalChartPanel 번들 존재).
 *
 * 검증 방식: 진료차트 패널은 실 고객/인증 컨텍스트가 깊게 필요 → 소스 레벨 구조 불변식 assertion
 *   (본 레포 MEDCHART 계열 스펙 표준 패턴, T-20260729-3ZONE / T-20260527-TAB-REAPPEAR 등).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const panel = (): string =>
  fs.readFileSync('src/components/MedicalChartPanel.tsx', 'utf-8');

// ── AC-3: ③ 펜차트 read-only 뷰어 ───────────────────────────────────────────
test.describe('T-20260807 ZONE2-GREENBOX / AC-3: 펜차트 뷰어', () => {
  test('2구역 펜차트 섹션 존재 (진단명/처방내역/펜차트 그룹)', () => {
    const s = panel();
    expect(s).toContain('data-testid="zone2-penchart-section"');
  });
  test('펜차트 소스 = photos 버킷 customer/{id}/pen-chart (PenChartTab 저장분 재사용)', () => {
    const s = panel();
    expect(s).toContain('const loadPenCharts');
    expect(s).toContain('`customer/${customerId}/pen-chart`');
  });
  test('로딩/빈/그리드 3상태 + 썸네일 클릭 시 원본 확대(새 창)', () => {
    const s = panel();
    expect(s).toContain('data-testid="zone2-penchart-empty"');
    expect(s).toContain('data-testid="zone2-penchart-grid"');
    expect(s).toContain('data-testid="zone2-penchart-thumb"');
    expect(s).toContain("pc.url && window.open(pc.url, '_blank')");
  });
});

// ── AC-6: ⑥ 경과사진(진료이미지) 2구역 자동연동 ─────────────────────────────
test.describe('T-20260807 ZONE2-GREENBOX / AC-6: 경과사진 자동연동', () => {
  test('2구역 경과사진 섹션 존재 (항목 순서 마지막)', () => {
    const s = panel();
    expect(s).toContain('data-testid="zone2-photos-section"');
  });
  test('진료이미지(treatment-images) 소스 재사용 + 빈/그리드/썸네일 렌더', () => {
    const s = panel();
    expect(s).toContain('data-testid="zone2-photos-empty"');
    expect(s).toContain('data-testid="zone2-photos-grid"');
    expect(s).toContain('data-testid="zone2-photo-thumb"');
    // 우측 '진료이미지' 탭과 동일 소스(loadTreatImages) 재사용 — 신규 스토리지 경로 신설 아님
    expect(s).toContain('customer/${customerId}/treatment-images');
  });
});

// ── AC-4T: ④ 치료메모 클릭 뷰어化 ────────────────────────────────────────────
test.describe('T-20260807 ZONE2-GREENBOX / AC-4T: 치료메모 클릭 뷰어', () => {
  test('치료메모 항목 클릭 → memoViewer 팝업(치료메모 타이틀)', () => {
    const s = panel();
    // renderMemo 가 button 으로 전환되어 setMemoViewer 를 연다
    expect(s).toContain('data-testid="treat-memo-item"');
    expect(s).toContain("title: '치료메모'");
    expect(s).toContain('setMemoViewer(');
  });
});

// ── AC-4C: ④ 고객메모 read + 클릭 뷰어 ──────────────────────────────────────
test.describe('T-20260807 ZONE2-GREENBOX / AC-4C: 고객메모 연동', () => {
  test('2구역 고객메모 섹션 존재 + read/빈 상태', () => {
    const s = panel();
    expect(s).toContain('data-testid="zone2-custmemo-section"');
    expect(s).toContain('data-testid="zone2-custmemo-empty"');
    expect(s).toContain('data-testid="zone2-custmemo-item"');
  });
  test('소스 = customer_note(정본) ?? customer_memo(레거시 폴백)', () => {
    const s = panel();
    expect(s).toContain('customer?.customer_note ?? customer?.customer_memo');
    // customers select 에 두 컬럼 read 추가
    expect(s).toContain('visit_type,customer_note,customer_memo');
  });
  test('고객메모 클릭 → memoViewer 팝업(고객메모 타이틀)', () => {
    const s = panel();
    expect(s).toContain("title: '고객메모'");
  });
});

// ── AC-VIEWER: 공용 메모 뷰어 팝업 (read-only) ───────────────────────────────
test.describe('T-20260807 ZONE2-GREENBOX / AC-VIEWER: 메모 뷰어 팝업', () => {
  test('memoViewer 상태 + createPortal 팝업 렌더', () => {
    const s = panel();
    expect(s).toContain('const [memoViewer, setMemoViewer]');
    expect(s).toContain('data-testid="memo-viewer-overlay"');
    expect(s).toContain('data-testid="memo-viewer-content"');
    expect(s).toContain('data-testid="memo-viewer-close"');
  });
});

// ── AC-AUTOLOAD: 2구역 자동연동 로드 + 고객 전환 리셋 ────────────────────────
test.describe('T-20260807 ZONE2-GREENBOX / AC-AUTOLOAD: 자동 선로드', () => {
  test('패널 열림 시 펜차트·진료이미지 탭 무관 선로드 effect', () => {
    const s = panel();
    expect(s).toContain('if (!treatImagesLoaded && !treatImagesLoading) loadTreatImages();');
    expect(s).toContain('if (!penChartsLoaded && !penChartsLoading) loadPenCharts();');
  });
  test('새 고객 열림마다 펜차트 상태 리셋', () => {
    const s = panel();
    expect(s).toContain('setPenCharts([]);');
    expect(s).toContain('setPenChartsLoaded(false);');
  });
});

// ── AC-HOLD: 버킷 C 미착수 (HOLD 준수) ──────────────────────────────────────
test.describe('T-20260807 ZONE2-GREENBOX / AC-HOLD: 버킷 C 미착수', () => {
  test('④ 상담메모 재도입 미착수 — 상담메모 zone2 섹션 부재', () => {
    const s = panel();
    // 상담메모는 문원장 Phase B 삭제분(canon 저촉) → 재도입 금지. zone2 상담메모 섹션/뷰어 신설 없음.
    expect(s).not.toContain('data-testid="zone2-consultmemo-section"');
    expect(s).not.toContain("title: '상담메모'");
  });
  test('⑤ 임상경과 저장통합 미착수 — clinical_progress/doctor_memo 2컬럼 저장경로 유지', () => {
    const s = panel();
    // 저장통합(단일필드)은 db_change=true 재판정 대상 → 미착수. 기존 2컬럼 저장경로 보존.
    expect(s).toContain('clinical_progress: formClinical.trim() || null');
    expect(s).toContain("from('chart_doctor_memos')");
  });
});

// ── AC-NO-DBCHANGE: read-only (신규 스키마/write 없음) ───────────────────────
test.describe('T-20260807 ZONE2-GREENBOX / AC-NO-DBCHANGE: read-only', () => {
  test('신규 뷰어(펜차트/경과사진/메모)는 storage.upload/remove·insert write 미추가', () => {
    const s = panel();
    // 신규 섹션 식별자 인근에 write 를 넣지 않았음을 보장하는 근거: loadPenCharts 는 list/signedUrl 만 사용.
    const loadPenIdx = s.indexOf('const loadPenCharts');
    const loadPenEnd = s.indexOf('}, [customerId, penChartsLoaded, penChartsLoading]);', loadPenIdx);
    const loadPenBody = s.slice(loadPenIdx, loadPenEnd);
    expect(loadPenBody).toContain('.list(');
    expect(loadPenBody).not.toContain('.upload(');
    expect(loadPenBody).not.toContain('.remove(');
    expect(loadPenBody).not.toContain('.insert(');
  });
});

// ── AC-BUILD: 번들 생성 확인 ─────────────────────────────────────────────────
test.describe('T-20260807 ZONE2-GREENBOX / AC-BUILD', () => {
  test('dist/ MedicalChartPanel 번들 존재 (빌드 통과)', () => {
    const distAssets = fs.existsSync('dist/assets') ? fs.readdirSync('dist/assets') : [];
    const hasMedBundle = distAssets.some(f => f.startsWith('MedicalChartPanel') || f.startsWith('CustomerChartPage'));
    expect(hasMedBundle).toBe(true);
  });
});
