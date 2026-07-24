/**
 * T-20260724-foot-TREATTABLE-LABTAB-SPLIT-BLOODLIST
 *
 * 치료테이블 [균검사 & 피검사 대상자] 단일 탭 → [균검사]/[피검사] 2탭 분리 + 피검사 일일 진행 리스트 신규.
 *
 * AC-1  탭 분리 — [균검사](tab-exam-targets, 기존 유지) + [피검사](tab-blood-daily, 신규).
 * AC-2  균검사 회귀0 — ExamTargetsSection 코드 무변경(기존 데이터 훅/집계/표기 보존).
 * AC-3  피검사 = '피검사 일일 진행 리스트' 8컬럼(순서·검사일자·환자명·차트번호·생년월일·접수여부·접수자명·서류수령여부).
 * AC-4  색상 — 접수여부/접수자명=핑크, 서류수령여부=노랑. 체크박스 미완료 빨간테두리 / 접수 빨간체크 / 서류수령 녹색체크.
 * AC-5  영속 — form_submissions(form_key=blood_reception_daily) 재사용(no-DDL). received/receiver_name/docs_received.
 *
 * 정적(빌드 산출 소스) 검증 — 데이터 계약/DB 상태 미의존(no-DDL 병행 착수분).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const treat = () => read('src/pages/TreatmentTable.tsx');
const blood = () => read('src/components/treatment/BloodDailyListSection.tsx');
const exam = () => read('src/components/treatment/ExamTargetsSection.tsx');

test.describe('AC-1: 탭 분리', () => {
  test('[균검사]/[피검사] 두 탭이 각각의 testid 로 존재', () => {
    const t = treat();
    expect(t).toContain('data-testid="tab-exam-targets"'); // 균검사(기존 유지)
    expect(t).toContain('data-testid="tab-blood-daily"'); // 피검사(신규)
    expect(t).toContain('<BloodDailyListSection');
    // 탭 순서: 균검사(exam) 다음 피검사(blood)
    const idxExam = t.indexOf('data-testid="tab-exam-targets"');
    const idxBlood = t.indexOf('data-testid="tab-blood-daily"');
    expect(idxExam).toBeGreaterThan(-1);
    expect(idxBlood).toBeGreaterThan(idxExam);
    // SectionTab 유니온에 blood 추가
    expect(t).toContain("'blood'");
  });
});

test.describe('AC-2: 균검사 회귀0', () => {
  test('ExamTargetsSection 데이터 훅/표기 보존(무변경)', () => {
    const e = exam();
    expect(e).toContain('useExamTargets');
    expect(e).toContain('exam-koh-badge');
    expect(e).toContain('exam-blood-badge');
    expect(e).toContain("{active ? '●' : '○'}");
  });
});

test.describe('AC-3: 피검사 일일 진행 리스트 8컬럼', () => {
  test('제목 + 8개 컬럼 헤더 존재', () => {
    const b = blood();
    expect(b).toContain('피검사 일일 진행 리스트');
    for (const col of ['순서', '검사일자', '환자명', '차트번호', '생년월일', '접수여부', '접수자명', '서류수령여부']) {
      expect(b).toContain(col);
    }
    expect(b).toContain('data-testid="blood-daily-table"');
    expect(b).toContain('data-testid="blood-daily-row"');
  });

  test('리스트업 = blood_test_requested 대상자(검사신청일 기준)', () => {
    const b = blood();
    expect(b).toContain("eq('blood_test_requested', true)");
    expect(b).toContain('check_in_services');
    // ADDITIVE 미적용 prod 42703 폴백
    expect(b).toContain('42703');
  });
});

test.describe('AC-4: 색상 규칙', () => {
  test('접수여부/접수자명=핑크, 서류수령여부=노랑', () => {
    const b = blood();
    expect(b).toContain('bg-pink-50'); // 접수여부/접수자명 셀
    expect(b).toContain('bg-yellow-50'); // 서류수령여부 셀
  });

  test('체크박스 — 미완료 빨간테두리 / 접수 빨간체크 / 서류수령 녹색체크', () => {
    const b = blood();
    expect(b).toContain('border-red-500'); // 미완료 공통 테두리
    expect(b).toContain('text-red-600'); // 접수 빨간체크
    expect(b).toContain('border-green-500'); // 서류수령 완료 테두리
    expect(b).toContain('text-green-600'); // 서류수령 녹색체크
    expect(b).toContain('testid="blood-received-checkbox"'); // 접수여부 체크박스
    expect(b).toContain('testid="blood-docs-checkbox"'); // 서류수령여부 체크박스
    expect(b).toContain('data-testid={testid}'); // LabCheckbox 가 data-testid 로 렌더
  });
});

test.describe('AC-5: 영속(form_submissions 재사용, no-DDL)', () => {
  test('form_key=blood_reception_daily 로 저장/불러오기', () => {
    const b = blood();
    expect(b).toContain("FORM_KEY = 'blood_reception_daily'");
    expect(b).toContain('form_submissions');
    // 불러오기 — field_data contains form_key
    expect(b).toContain("contains('field_data', { form_key: FORM_KEY })");
    // 저장 필드 3종
    expect(b).toContain('received');
    expect(b).toContain('receiver_name');
    expect(b).toContain('docs_received');
    // 없으면 INSERT / 있으면 UPDATE(field_data 병합), template_id NULL(builtin 패턴)
    expect(b).toContain('.update({ field_data: fieldData })');
    expect(b).toContain('template_id: null');
    // 재진입 유지 — 서버 상태를 행에 머지
    expect(b).toContain('useBloodReceptions');
  });
});
