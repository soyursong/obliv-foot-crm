/**
 * T-20260726-foot-TREATTABLE-GUNTAB-FORM-CLEANUP-DEFAULTEXPAND
 *
 * 치료테이블 [균검사] 탭 잔여 피검사 양식 정리 + 당일 일자 그룹 기본 펼침.
 * 선행: T-20260724-foot-TREATTABLE-LABTAB-SPLIT-BLOODLIST(7/25 배포) 의 residual cleanup.
 *
 * A. [균검사] 탭 양식 정리 — LABTAB-SPLIT 후 [피검사] 탭(BloodDailyListSection)이 피검사 일일 진행 리스트·
 *    접수/서류수령·결과지 업로드/보기를 전담. [균검사] 탭(ExamTargetsSection)에서 피검사-origin 표시
 *    (피검사 badge·결과지 업로드/보기·blood_test_requested 리스트업)를 제거. 리스트업 필터 koh_requested=true.
 * A'. 피검사 기능 유실0 — [피검사] 탭(BloodDailyListSection)은 무변경(업로드/보기 상존).
 * B. 당일 일자 그룹 기본 펼침 — [균검사] 탭 초기 로드 시 오늘(KST) 그룹 펼침, 과거 그룹 접힘. 토글 무회귀.
 *
 * 정적(빌드 산출 소스) 검증 — no-DDL·FE-only. 데이터 계약/DB 상태 미의존(LABTAB-SPLIT spec 동일 패턴).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const exam = () => read('src/components/treatment/ExamTargetsSection.tsx');
const blood = () => read('src/components/treatment/BloodDailyListSection.tsx');

test.describe('A: [균검사] 탭 피검사-origin 표시 제거', () => {
  test('피검사 badge/결과지 업로드/보기 testid 가 균검사 탭에서 제거됨', () => {
    const e = exam();
    expect(e).not.toContain('exam-blood-badge'); // 피검사 badge 제거
    expect(e).not.toContain('exam-blood-group'); // 피검사 줄 그룹 제거
    expect(e).not.toContain('exam-blood-result-view'); // 결과지 보기 제거
    expect(e).not.toContain('exam-blood-result-upload'); // 결과지 업로드 제거
  });

  test('피검사 결과지 다이얼로그/카운트 훅이 균검사 탭에서 제거됨', () => {
    const e = exam();
    expect(e).not.toContain('BloodResultDialog'); // import·렌더 제거
    expect(e).not.toContain('useBloodResultCounts'); // 카운트 훅 제거
    expect(e).not.toContain('blood_result_counts'); // query key 제거
    expect(e).not.toContain('bloodTarget'); // 다이얼로그 타겟 state 제거
    expect(e).not.toContain('bloodRequested'); // 인터페이스/집계 필드 제거
  });

  test('리스트업 필터 = koh_requested=true (피검사-only 신청자 잔존행 제거)', () => {
    const e = exam();
    expect(e).toContain("eq('koh_requested', true)"); // koh 전용 필터
    // 기존 or(koh|blood) 혼합 필터 잔존 금지
    expect(e).not.toContain('koh_requested.eq.true,blood_test_requested.eq.true');
    // SEL 문자열에서 blood_test_requested 컬럼 미조회(코드 라인 기준; 설명 주석은 허용)
    expect(e).not.toContain("'id, koh_requested, blood_test_requested");
    // ADDITIVE 미적용 prod 42703 폴백은 유지(무파손)
    expect(e).toContain('42703');
  });

  test('균검사 기능 무회귀 — koh badge/발급/조갑/결과 보기 유지', () => {
    const e = exam();
    expect(e).toContain('exam-koh-badge'); // 균검사 badge
    expect(e).toContain('exam-koh-issue-btn'); // 발급하기
    expect(e).toContain('exam-koh-result-view'); // 결과 보기
    expect(e).toContain('exam-nail-site-editor'); // 채취조갑 선택
    expect(e).toContain('useExamTargets'); // 데이터 훅 유지
    expect(e).toContain('publish_koh_result'); // 발급 RPC 유지
  });

  test('제목/헤더/빈목록 문구에서 피검사 제거', () => {
    const e = exam();
    expect(e).toContain('균검사 대상자'); // 제목: '균검사 & 피검사 대상자' → '균검사 대상자'
    expect(e).not.toContain('균검사 &amp; 피검사 대상자');
    expect(e).toContain('해당 기간에 균검사를 신청한 환자가 없습니다.'); // 빈목록
    expect(e).not.toContain('균검사·피검사를 신청한');
  });
});

test.describe("A': [피검사] 탭 정상 유지(유실0)", () => {
  test('BloodDailyListSection 피검사 일일 진행 리스트·업로드/보기 상존(무변경)', () => {
    const b = blood();
    expect(b).toContain('피검사 일일 진행 리스트');
    expect(b).toContain('data-testid="blood-daily-table"');
    expect(b).toContain("eq('blood_test_requested', true)"); // 피검사 대상자 리스트업 유지
    expect(b).toContain('data-testid="blood-upload-btn"'); // 결과지 업로드/보기 유지
    expect(b).toContain('blood_result'); // 결과지 경로 유지
  });
});

test.describe('B: 당일 일자 그룹 기본 펼침', () => {
  test('expandedDates 초기 state 가 오늘(KST)로 세팅 — 마운트 즉시 펼침', () => {
    const e = exam();
    // 초기화 lazy initializer 에 오늘 날짜 주입(seoulISODate(new Date()))
    expect(e).toMatch(/useState<Set<string>>\(\(\)\s*=>\s*new Set\(\[seoulISODate\(new Date\(\)\)\]\)\)/);
    // 타이밍 취약한 ref 가드/effect 제거(계속 접혀있음 RC 제거)
    expect(e).not.toContain('didInitExpandRef');
  });

  test('그룹 렌더 — 오늘 배지 + 펼침/접힘 상태 표기 + 토글 유지(무회귀)', () => {
    const e = exam();
    expect(e).toContain('data-testid="exam-date-group"');
    expect(e).toContain("data-state={isOpen ? 'expanded' : 'collapsed'}"); // 펼침/접힘 상태
    expect(e).toContain('expandedDates.has(g.date)'); // 그룹별 펼침 판정
    expect(e).toContain('toggleGroup(g.date)'); // 헤더 클릭 토글(과거 그룹 무회귀)
    expect(e).toContain('g.date === today'); // 오늘 배지 판정
    expect(e).toContain('오늘'); // 오늘 배지 라벨
  });
});
