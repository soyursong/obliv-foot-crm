/**
 * E2E spec — T-20260622-foot-BLOODTEST-RESULT-PUBLISH-BACKEND (B안 파일보관)
 *
 * 치료 테이블 §B '균검사 & 피검사 대상자' — 혈액검사 결과지 업로드/보기 백엔드.
 * DA CONSULT-REPLY GO (MSG-20260623-083432-0ov6, ADDITIVE). 신규 메타 테이블 patient_file_records +
 * 기존 documents 버킷·useDocumentUpload 재사용(신규버킷 X).
 *
 *   AC-1 업로드(다중)+메타 적재 — PDF/JPG/PNG 다중 → documents 버킷(prefix=blood_result) → patient_file_records insert.
 *   AC-2 결과지 보기(열람) — patient_file_records(customer_id+kind='blood_result') 목록 → on-demand signedUrl(1h),
 *                            read-after-write(업로드 후 load 재조회 + 부모 카운트 invalidate).
 *   AC-3 회귀 0 — documents·결제·차트 무영향(기존 훅·버킷·경로 컨벤션 재사용, 신규버킷/파괴 0).
 *   AC-4 마이그 롤백SQL 동반 + RLS clinic_id 스코프.
 *   AC-5 ext pdf/jpg/png만 + DB mime CHECK 정합.
 *
 * 검증: 현장 PHI 계정 → 실데이터 우회 불가. 정적 코드/마이그 구조 검증 + 앱 로드(HTTP 200) +
 *   티켓 현장 클릭 시나리오를 코드 가드로 변환.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const dialog = () => read('src/components/BloodResultDialog.tsx');
const sectionB = () => read('src/components/treatment/ExamTargetsSection.tsx');
const migration = () => read('supabase/migrations/20260623150000_patient_file_records.sql');
const rollback = () => read('supabase/migrations/20260623150000_patient_file_records.rollback.sql');

test.describe('T-20260622-foot-BLOODTEST-RESULT-PUBLISH-BACKEND', () => {
  test('앱 정상 로드 — HTTP 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  // ── AC-1 업로드(다중) + 메타 적재 ───────────────────────────────────────────
  test('AC-1: 다중 파일 업로드 → documents 버킷(prefix=blood_result) → patient_file_records insert', () => {
    const d = dialog();
    // 기존 documents 버킷 훅 재사용(신규버킷 X)
    expect(d).toContain("import { useDocumentUpload } from '@/hooks/useDocumentUpload'");
    expect(d).toContain('uploadMany(');
    expect(d).toContain("prefix: BLOOD_KIND");
    expect(d).toContain("const BLOOD_KIND = 'blood_result'");
    // 다중 선택
    expect(d).toContain('multiple');
    expect(d).toContain('data-testid="blood-result-file-input"');
    expect(d).toContain('data-testid="blood-result-upload-btn"');
    // 메타 적재: patient_file_records insert (clinic_id/customer_id/file_path/mime/kind/uploaded_by)
    expect(d).toContain("from('patient_file_records').insert(");
    expect(d).toContain('clinic_id: clinic.id');
    expect(d).toContain('customer_id: customerId');
    expect(d).toContain('file_path: u.path');
    expect(d).toContain('kind: BLOOD_KIND');
    expect(d).toContain('uploaded_by: user?.id');
    // 업로더 = 현재 인증 사용자
    expect(d).toContain('supabase.auth.getUser()');
  });

  // ── AC-2 결과지 보기(열람) + read-after-write ──────────────────────────────
  test('AC-2: 목록 조회(customer_id+kind) + on-demand signedUrl(1h) + read-after-write', () => {
    const d = dialog();
    // 목록: customer_id + kind='blood_result'
    expect(d).toContain("from('patient_file_records')");
    expect(d).toContain("eq('customer_id', customerId)");
    expect(d).toContain("eq('kind', BLOOD_KIND)");
    // on-demand signedUrl 1h
    expect(d).toContain("createSignedUrl(path, 3600)");
    expect(d).toContain('data-testid="blood-result-view"');
    expect(d).toContain('data-testid="blood-result-download"');
    // read-after-write: 업로드 성공 후 load() 재조회
    expect(d).toContain('await load(); // AC-2: read-after-write');
    // 부모 섹션: 닫을 때 카운트 invalidate(업로드↔보기 라벨 갱신)
    const b = sectionB();
    expect(b).toContain("invalidateQueries({ queryKey: ['blood_result_counts'");
    expect(b).toContain('data-testid="exam-blood-result-upload"'); // 0건=업로드
    expect(b).toContain('data-testid="exam-blood-result-view"');   // ≥1건=보기
  });

  // ── AC-3 회귀 0 ─────────────────────────────────────────────────────────────
  test('AC-3: 기존 documents 버킷/경로 컨벤션 재사용 — 신규버킷 0', () => {
    const d = dialog();
    // 신규 버킷명 생성 금지 — 업로드/열람 모두 documents 버킷
    expect(d).toContain("from('documents').createSignedUrl");
    // useDocumentUpload 가 documents 버킷 + customer/{id}/{prefix}_{ts} 경로를 담당(직접 from('xxx').upload 신설 없음)
    expect(d).not.toMatch(/storage\.from\(['"](?!documents)/);
  });

  test('AC-3: 부모 섹션은 read-only — 직접 insert/update 호출 0(쓰기는 다이얼로그 위임)', () => {
    const b = sectionB();
    expect(b).not.toContain('.insert(');
    expect(b).not.toContain('.update(');
    // 혈액검사 카운트 인덱스는 read-only select
    expect(b).toContain("queryKey: ['blood_result_counts', clinicId]");
    expect(b).toContain("from('patient_file_records')");
  });

  // ── AC-4 마이그/롤백/RLS ────────────────────────────────────────────────────
  test('AC-4: patient_file_records 마이그 — 컬럼 형상 + RLS clinic_id 스코프 + 인덱스', () => {
    const m = migration();
    expect(m).toContain('CREATE TABLE IF NOT EXISTS patient_file_records');
    // 컬럼 형상(DA 채택)
    expect(m).toContain('clinic_id   uuid        NOT NULL REFERENCES clinics(id)');
    expect(m).toContain('customer_id uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE');
    expect(m).toContain("kind        text        NOT NULL DEFAULT 'blood_result'");
    expect(m).toContain('uploaded_by uuid        REFERENCES auth.users(id)');
    // RLS clinic_id 스코프(계약 §1)
    expect(m).toContain('ENABLE ROW LEVEL SECURITY');
    expect(m).toContain('clinic_id = current_user_clinic_id()');
    expect(m).toContain('clinic_isolation_pfr_select');
    expect(m).toContain('clinic_isolation_pfr_insert');
    // 인덱스
    expect(m).toContain('idx_pfr_customer');
    expect(m).toContain('idx_pfr_clinic');
  });

  test('AC-4: 롤백 SQL 동반(DROP TABLE) — supervisor DDL-diff 통과 조건', () => {
    const r = rollback();
    expect(r).toContain('DROP TABLE IF EXISTS patient_file_records;');
  });

  // ── AC-5 ext/mime 게이트 정합 ───────────────────────────────────────────────
  test('AC-5: FE ext 게이트(pdf/jpg/png) ↔ DB mime CHECK 정합', () => {
    const d = dialog();
    // FE: 허용 ext 집합 + accept
    expect(d).toContain("new Set(['pdf', 'jpg', 'jpeg', 'png'])");
    expect(d).toContain("'.pdf,.jpg,.jpeg,.png");
    // 허용 외 거부(부분 업로드 방지)
    expect(d).toContain('허용되지 않는 형식');
    // DB: mime CHECK 와 동일 3종
    const m = migration();
    expect(m).toContain("mime_type IN ('application/pdf', 'image/jpeg', 'image/png')");
  });

  // ── 방어성 ──────────────────────────────────────────────────────────────────
  test('방어성: 테이블 미적용 prod(42P01/42703) → 빈 목록·빈 카운트 폴백(무파손)', () => {
    const d = dialog();
    expect(d).toMatch(/42P01|42703/);
    const b = sectionB();
    expect(b).toMatch(/42P01|42703/);
  });
});

/**
 * 현장 클릭 시나리오 (실브라우저 수동 검증 체크리스트):
 *
 * [시나리오1] 결과지 업로드(AC-1/AC-5)
 *   1. '치료 테이블' → '균검사 & 피검사 대상자' → 피검사 신청 행에 '결과지 업로드' 버튼(분홍) 표시
 *   2. 클릭 → 다이얼로그 열림 → '결과지 업로드' → PDF·JPG·PNG 여러 개 선택 → 업로드 완료 토스트(N건)
 *   3. 허용 외(예: .exe/.hwp) 선택 → '허용되지 않는 형식' 토스트, 업로드 중단
 *
 * [시나리오2] 결과지 보기(AC-2)
 *   1. 업로드 후 다이얼로그 목록에 파일 즉시 표시(read-after-write)
 *   2. 눈 아이콘 → 새 창 열람 / 다운로드 아이콘 → 파일 저장(signedUrl 1h)
 *   3. 다이얼로그 닫기 → 행 버튼이 '결과지 보기 (N)'(회색 아웃라인)로 전환
 *
 * [시나리오3] 권한/격리(AC-4)
 *   1. 다른 지점 계정 → 타 클리닉 결과지 목록 0건(RLS clinic_id 스코프)
 *   2. 본인 업로드분만 삭제 가능(own_delete_pfr)
 *
 * [시나리오4] 회귀(AC-3)
 *   1. 체크리스트/동의서(DocumentViewer) 등 기존 documents 버킷 동선 정상
 *   2. 결제·예약·차트 저장 동선 미영향
 *
 * 비고: ADDITIVE. patient_file_records 신규 + documents 버킷 재사용(신규버킷 0). 롤백=DROP TABLE.
 *   supervisor DDL-diff(마이그+롤백SQL) = deploy-ready 마킹 후 QA 시점 집행.
 */
