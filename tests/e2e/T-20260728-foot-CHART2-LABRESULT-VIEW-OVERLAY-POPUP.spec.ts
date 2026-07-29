/**
 * T-20260728-foot-CHART2-LABRESULT-VIEW-OVERLAY-POPUP
 *
 * 2번 차트 [검사결과] 탭 — 결과지 '보기'(Eye) 클릭 시 브라우저 새 탭(window.open '_blank')
 *   대신 앱 내 별도 팝업(overlay/modal)으로 결과지 파일(PDF/JPG/PNG) 표시로 전환.
 *
 *   · KOH균검사 + 피검사 결과지 열람 진입점 = PatientResultFiles(kind='koh_result'/'blood_result').
 *   · 피검사 결과지(치료테이블) = BloodResultDialog 에도 동일 팝업 패턴 적용.
 *   · 신규 재사용 컴포넌트 ResultFileViewerDialog(기존 ui/dialog base-ui 패턴 계승).
 *   · 순수 FE — DB·데이터 연동(patient_file_records + documents 버킷 signedUrl) 무변경.
 *
 * 현장 클릭 시나리오(티켓) → 정적(빌드 산출 소스) 검증.
 *   시나리오1: KOH 결과지 '보기' → 팝업 오버레이
 *   시나리오2: 피검사 결과지 '보기' → 팝업 오버레이 (PatientResultFiles + BloodResultDialog)
 *   시나리오3: 데이터 회귀 없음 (kind 쿼리·업로드·다운로드 경로 유지)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const viewer = () => read('src/components/ResultFileViewerDialog.tsx');
const patientFiles = () => read('src/components/PatientResultFiles.tsx');
const bloodDialog = () => read('src/components/BloodResultDialog.tsx');
const chart = () => read('src/pages/CustomerChartPage.tsx');

// 주석(//) 라인 제외 — JSX/코드 실체만 검사(오탐 방지)
const codeOnly = (s: string) =>
  s.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

test.describe('0: ResultFileViewerDialog — 앱 내 팝업(overlay) 뷰어 신규', () => {
  test('컴포넌트 파일 존재', () => {
    expect(() => viewer()).not.toThrow();
  });

  test('base-ui ui/dialog(Dialog/DialogContent) 패턴 재사용 = 오버레이', () => {
    const v = viewer();
    expect(v).toContain("from '@/components/ui/dialog'");
    expect(v).toContain('<Dialog open={open} onOpenChange={onOpenChange}>');
    expect(v).toContain('<DialogContent');
    expect(v).toContain('data-testid="result-file-viewer"');
  });

  test('PDF=iframe / 이미지=img 렌더 + 로딩·닫기·다운로드·새창 폴백', () => {
    const v = viewer();
    expect(v).toContain('data-testid="result-file-viewer-frame"'); // iframe(PDF)
    expect(v).toContain('data-testid="result-file-viewer-image"'); // img(이미지)
    expect(v).toContain('<iframe');
    expect(v).toContain('<img');
    // 닫기(X) + 로딩 스피너 + 다운로드/새창 폴백
    expect(v).toContain('data-testid="result-file-viewer-close"');
    expect(v).toContain('onClick={() => onOpenChange(false)}');
    expect(v).toContain('animate-spin'); // signedUrl 발급 중 로더
    expect(v).toContain('data-testid="result-file-viewer-download"');
    expect(v).toContain('data-testid="result-file-viewer-newtab"');
  });
});

test.describe('1+2: 보기 → 팝업 (PatientResultFiles — KOH·피검사 공통 진입점)', () => {
  test('ResultFileViewerDialog import + 렌더', () => {
    const p = patientFiles();
    expect(p).toContain("import ResultFileViewerDialog from '@/components/ResultFileViewerDialog'");
    expect(codeOnly(p)).toContain('<ResultFileViewerDialog');
  });

  test("'보기'(Eye) 버튼이 window.open 새 탭 대신 openInViewer(팝업) 호출", () => {
    const code = codeOnly(patientFiles());
    expect(code).toContain('onClick={() => openInViewer(r)}');
    // 구 동작(새 탭 열람)이 view 버튼에서 제거됨
    expect(code).not.toContain('onClick={() => openSigned(r.file_path, false)}');
  });

  test('openInViewer 는 signedUrl(1h)을 발급해 팝업 state 를 연다', () => {
    const p = patientFiles();
    expect(p).toContain('const openInViewer = async (row: PfrRow)');
    expect(p).toContain("createSignedUrl(row.file_path, 3600)");
    expect(p).toContain('setViewer({ url: data.signedUrl, row })');
  });
});

test.describe('2b: 피검사 결과지(치료테이블 BloodResultDialog) 동일 팝업 패턴', () => {
  test('ResultFileViewerDialog import + 렌더', () => {
    const b = bloodDialog();
    expect(b).toContain("import ResultFileViewerDialog from '@/components/ResultFileViewerDialog'");
    expect(codeOnly(b)).toContain('<ResultFileViewerDialog');
  });

  test("'보기'(Eye) 버튼이 openInViewer(팝업) 호출 + 구 새탭 제거", () => {
    const code = codeOnly(bloodDialog());
    expect(code).toContain('onClick={() => openInViewer(r)}');
    expect(code).not.toContain('onClick={() => openSigned(r.file_path, false)}');
    expect(bloodDialog()).toContain("createSignedUrl(row.file_path, 3600)");
  });
});

test.describe('3: 데이터 회귀 없음 — kind 쿼리·업로드·다운로드 경로 유지', () => {
  test('PatientResultFiles: patient_file_records + kind 조회 그대로', () => {
    const p = patientFiles();
    expect(p).toContain("from('patient_file_records')");
    expect(p).toContain(".eq('kind', kind)");
    // 다운로드 버튼(별개 경로)은 그대로 유지
    expect(p).toContain('onClick={() => openSigned(r.file_path, true, r.file_name)}');
  });

  test('BloodResultDialog: blood_result kind 조회 + 업로드 경로 유지', () => {
    const b = bloodDialog();
    expect(b).toContain("const BLOOD_KIND = 'blood_result'");
    expect(b).toContain(".eq('kind', BLOOD_KIND)");
    expect(b).toContain('onClick={() => openSigned(r.file_path, true, r.file_name)}');
  });

  test('2번 차트 [검사결과] 탭이 KOH·피검사 PatientResultFiles 를 그대로 렌더', () => {
    const c = chart();
    expect(c).toContain("label: '검사결과'");
    expect(c).toContain('<PatientResultFiles');
    expect(c).toContain('kind="koh_result"');
    expect(c).toContain('kind="blood_result"');
  });
});
