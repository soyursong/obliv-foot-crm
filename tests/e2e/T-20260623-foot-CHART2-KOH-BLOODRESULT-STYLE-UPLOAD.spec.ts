/**
 * E2E spec — T-20260623-foot-CHART2-KOH-BLOODRESULT-STYLE-UPLOAD
 *
 * 2번차트(고객차트) → 검사결과 탭 → KOH균검사 입력 UI 를 기존 '사진 업로드 형태'(photos 버킷, 이미지 전용,
 * CustomerStorageImageSection prefix="koh-results")에서 피검사(혈액검사) 결과지와 동일한 폼
 * (PatientResultFiles, documents 버킷 + patient_file_records kind='koh_result')으로 통일.
 *
 *   AC-1 KOH 입력 UI 가 피검사 결과지(PatientResultFiles)와 동일한 업로드 폼으로 표시(사진 단순업로드 → 결과지형).
 *   AC-2 사진(image/*) + PDF 양쪽 다중 업로드 + 목록/보기/다운로드/삭제.
 *   AC-3 patient_file_records.kind='koh_result' 로 기록·필터(피검사 blood_result 와 섞이지 않음).
 *   AC-4 진료대시보드 KohReportTab 발행 동선 + 피검사 업로드 회귀 0.
 *   AC-5 DB free-text(kind) → 무변경(FE-only). mime CHECK(pdf/jpg/png) 정합.
 *   AC-6 PHI — 旣운영 documents 버킷 RLS·업로더 기록 패턴 상속, 신규 보안 표면 0.
 *
 * 검증: 현장 PHI 계정 → 실데이터 우회 불가. 정적 코드 검증 + 앱 로드(HTTP 200) +
 *   티켓 현장 클릭 시나리오를 코드 가드로 변환(BLOODTEST-RESULT-PUBLISH-BACKEND spec 패턴 동형).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const shared = () => read('src/components/PatientResultFiles.tsx');
const chart = () => read('src/pages/CustomerChartPage.tsx');
const bloodDialog = () => read('src/components/BloodResultDialog.tsx');
const kohReportTab = () => read('src/components/doctor/KohReportTab.tsx');

test.describe('T-20260623-foot-CHART2-KOH-BLOODRESULT-STYLE-UPLOAD', () => {
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── 시나리오 1: KOH 결과지 파일 업로드(피검사 폼과 동일 동선) ─────────────────
  test('AC-1: 2번차트 검사결과 KOH 가 PatientResultFiles(결과지형 폼)로 교체 — 旣 사진업로드(koh-results) 제거', () => {
    const c = chart();
    // 공통 결과지 폼 컴포넌트 사용 + KOH 분기(kind/prefix/testid)
    expect(c).toContain("import PatientResultFiles from '@/components/PatientResultFiles'");
    expect(c).toContain('<PatientResultFiles');
    expect(c).toContain('kind="koh_result"');
    expect(c).toContain('prefix="koh_result"');
    expect(c).toContain('testidPrefix="koh-result"');
    // 旣 사진 업로드 UI(photos 버킷, prefix="koh-results")는 검사결과 탭에서 제거
    expect(c).not.toContain('prefix="koh-results"');
  });

  test('AC-1: PatientResultFiles 폼 = 업로드 버튼 + 목록 + 보기/다운로드/삭제(피검사와 동형 구조)', () => {
    const s = shared();
    // 업로드 입력 + 다중 + 버튼
    expect(s).toContain('type="file"');
    expect(s).toContain('multiple');
    expect(s).toContain('${testidPrefix}-file-input');
    expect(s).toContain('${testidPrefix}-upload-btn');
    // 목록 + 보기/다운로드/삭제
    expect(s).toContain('${testidPrefix}-list');
    expect(s).toContain('${testidPrefix}-view');
    expect(s).toContain('${testidPrefix}-download');
    expect(s).toContain('${testidPrefix}-delete');
    // 빈 목록 상태
    expect(s).toContain('${testidPrefix}-empty');
    expect(s).toContain('등록된 결과지가 없습니다.');
  });

  // ── AC-2: 사진(image/*) + PDF 다중 업로드 + 동작 ────────────────────────────
  test('AC-2: PDF·JPG·PNG 다중 업로드 — documents 버킷(useDocumentUpload) + patient_file_records insert', () => {
    const s = shared();
    // 사진+파일 양쪽 accept
    expect(s).toContain("'.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'");
    expect(s).toContain("new Set(['pdf', 'jpg', 'jpeg', 'png'])");
    // documents 버킷 훅 재사용(신규버킷 X)
    expect(s).toContain("import { useDocumentUpload } from '@/hooks/useDocumentUpload'");
    expect(s).toContain('uploadMany(');
    // 메타 적재
    expect(s).toContain("from('patient_file_records').insert(");
    expect(s).toContain('clinic_id: clinic.id');
    expect(s).toContain('customer_id: customerId');
    expect(s).toContain('file_path: u.path');
    expect(s).toContain('uploaded_by: user?.id');
    expect(s).toContain('supabase.auth.getUser()');
    // 열람/다운로드 — documents 버킷 on-demand signedUrl(1h)
    expect(s).toContain("from('documents').createSignedUrl(path, 3600)");
    // 삭제
    expect(s).toContain("from('patient_file_records').delete().eq('id', row.id)");
    // read-after-write
    expect(s).toContain('await load();');
  });

  // ── AC-3: kind 분기 — KOH 와 피검사가 섞이지 않음 ────────────────────────────
  test('AC-3: 저장/조회가 prop kind 로 필터 — KOH=koh_result / 피검사=blood_result 격리', () => {
    const s = shared();
    // 조회 필터가 prop kind 로 동적 분기
    expect(s).toContain("eq('kind', kind)");
    // insert 시에도 prop kind 적재
    expect(s).toMatch(/kind,\s*\n/);
    // 차트2 호출부가 koh_result 로 고정
    const c = chart();
    expect(c).toContain('kind="koh_result"');
    // 피검사는 여전히 blood_result(분리 유지)
    const b = bloodDialog();
    expect(b).toContain("const BLOOD_KIND = 'blood_result'");
    expect(b).toContain("eq('kind', BLOOD_KIND)");
  });

  // ── 시나리오 2: 격리 + 발행 동선 회귀 ──────────────────────────────────────
  test('AC-3: 환자별 격리 — customer_id 로 목록 조회(다른 환자 미노출)', () => {
    const s = shared();
    expect(s).toContain("eq('customer_id', customerId)");
  });

  test('AC-4: 피검사 결과지(BloodResultDialog) 회귀 0 — kind=blood_result · testid·동선 불변', () => {
    const b = bloodDialog();
    // 혈액 폼은 본 티켓에서 미변경(독립 컴포넌트 유지) — 핵심 계약 strings 보존
    expect(b).toContain('data-testid="blood-result-dialog"');
    expect(b).toContain('data-testid="blood-result-file-input"');
    expect(b).toContain('data-testid="blood-result-upload-btn"');
    expect(b).toContain("prefix: BLOOD_KIND");
    expect(b).toContain('await load(); // AC-2: read-after-write');
  });

  test('AC-4: 진료대시보드 KohReportTab(균검사 결과보고서 발행 동선) 회귀 0 — 본 수집 UI 와 무관', () => {
    const k = kohReportTab();
    // 발행 동선은 form_submissions(form_key='koh_result') 기반 — patient_file_records 업로드를 끌어쓰지 않음
    expect(k).not.toContain("from('patient_file_records')");
    // KohReportTab 은 PatientResultFiles 를 사용하지 않음(수집 UI 와 분리)
    expect(k).not.toContain('PatientResultFiles');
  });

  // ── AC-5: DB free-text(kind) → 무변경 · mime 정합 ──────────────────────────
  test('AC-5: kind 는 free-text(CHECK/enum 제약 없음) → DB 변경 0(FE-only). mime pdf/jpg/png 정합', () => {
    // 마이그 본문: kind 는 CHECK 없는 text NOT NULL DEFAULT. (본 티켓 신규 마이그 0)
    const m = read('supabase/migrations/20260623150000_patient_file_records.sql');
    expect(m).toContain("kind        text        NOT NULL DEFAULT 'blood_result'");
    expect(m).not.toMatch(/kind[^\n]*CHECK/); // kind 에 CHECK 제약 없음
    // mime CHECK 3종 — FE ext 게이트와 정합
    expect(m).toContain("mime_type IN ('application/pdf', 'image/jpeg', 'image/png')");
    const s = shared();
    expect(s).toContain("{ ext: 'pdf', mime: 'application/pdf' }");
    expect(s).toContain("{ ext: 'png', mime: 'image/png' }");
  });

  // ── AC-6: PHI — 旣운영 패턴 상속, 신규 보안 표면 0 ──────────────────────────
  test('AC-6: documents 버킷·RLS·업로더 기록 패턴 상속(신규버킷·신규 storage from 0)', () => {
    const s = shared();
    // documents 외 storage.from 신설 없음
    expect(s).not.toMatch(/storage\.from\(['"](?!documents)/);
    // 업로더 기록
    expect(s).toContain('uploaded_by: user?.id ?? null');
  });

  // ── 방어성 ──────────────────────────────────────────────────────────────────
  test('방어성: patient_file_records 미적용 prod(42P01/42703) → 빈 목록 폴백(무파손)', () => {
    const s = shared();
    expect(s).toMatch(/42P01|42703/);
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 체크리스트 — 단계별 렌더 확인):
 *
 * [시나리오1] KOH 결과지 파일 업로드(피검사 폼과 동일 동선)
 *   1. 로그인 → 2번차트(고객차트) 진입 → 검사결과 탭 → KOH균검사 항목
 *   2. 입력 UI 가 피검사 결과지와 동일한 모양(결과지 업로드 버튼 + 목록 영역)으로 표시
 *   3. '결과지 업로드' → 이미지(JPG/PNG) 선택 → 업로드 → 목록에 파일명·시각·크기 표시
 *   4. 다시 '결과지 업로드' → PDF 선택 → 업로드 → 목록 추가(다중 업로드)
 *   5. 목록 [보기] → 새 창 열람 / [다운로드] → 저장 / [삭제] → 본인 업로드분 제거
 *   6. 허용 외(.exe/.hwp) → '허용되지 않는 형식' 토스트, 업로드 중단
 *
 * [시나리오2] 다른 환자/탭 격리 + 발행 동선 회귀
 *   1. 다른 환자 2번차트 검사결과 KOH 에는 위 업로드 파일이 노출되지 않음(환자별 격리)
 *   2. 진료대시보드 균검사지(KohReportTab) 발행 동선 기존과 동일(회귀 0)
 *   3. 피검사(혈액검사) 결과지 업로드 기존과 동일(kind 분기로 KOH 와 섞이지 않음)
 *
 * 비고: FE-only(kind=free-text → DB 변경 0). documents 버킷 + patient_file_records(kind='koh_result') 재사용.
 *   旣 photos 버킷 'koh-results' 사진은 신규 폼에 표시되지 않음(저장소 분리) — 신규 수집 채널.
 */
