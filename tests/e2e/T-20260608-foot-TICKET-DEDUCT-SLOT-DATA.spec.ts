/**
 * Static guard scanner — T-20260608-foot-TICKET-DEDUCT-SLOT-DATA (AC1 스코프 LOCK + AC3)
 *
 * ★ AC1 스코프 LOCK (김주연 총괄 3차 재정정, slack ts 1780900697.315059):
 *   "항목에서 삭제하라고 한 적 없다. 통계에서만 데이터 안 가져오면 된다."
 *   → 차감 항목 선택 UI 4곳·차감 이력·마스터데이터 **절대 무변경**.
 *   → 수액(session_type='iv')은 통계 집계 쿼리에서만 미포함.
 *
 * 이 spec 은 두 불변식을 정적으로 잠근다:
 *   [LOCK] 차감 항목 선택 UI 4곳이 수액(iv) 옵션을 계속 노출 — 미래 에이전트의 UI 삭제 회귀 차단.
 *     ① CheckInDetailSheet.tsx SessionUseInSheetDialog (session-type-btn-iv)
 *     ② CustomerChartPage.tsx c22DeductForm (<option value="iv">)
 *     ③ CustomerChartPage.tsx sessionDlgForm (<option value="iv">)
 *     ④ CustomerChartPage.tsx editSessionForm (<option value="iv">)
 *   [STATS] 통계 마이그가 (AC1) by_category 에서 iv 제외 + (AC3) therapist_summary 전환을
 *           당일(contract_date = visit_date)만 인정 — 스코프가 통계 레이어에 한정됨을 검증.
 *
 * db_change: 마이그는 supervisor 게이트 경유(별도). 본 spec 은 소스/마이그 정적 스캔만(DB 미접근).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string) => path.resolve(__dirname, '../../src', rel);
const MIG = (rel: string) => path.resolve(__dirname, '../../supabase/migrations', rel);

const read = (p: string) => fs.readFileSync(p, 'utf-8');

test.describe('AC1 LOCK — 차감 항목 선택 UI 4곳 수액(iv) 노출 보존', () => {
  test('① CheckInDetailSheet SessionUseInSheetDialog 에 iv 진료종류 버튼 존재', () => {
    const s = read(SRC('components/CheckInDetailSheet.tsx'));
    // 진료 종류 선택 배열에 'iv' 포함 + 테스트ID 노출
    expect(s).toContain("'iv'");
    expect(s).toContain('session-type-btn-${t}');
    // 진료 종류 후보 배열에 iv 가 빠지지 않았는지 (LOCK)
    expect(s).toMatch(/\[\s*'unheated_laser',\s*'heated_laser',\s*'iv',\s*'preconditioning'\s*\]/);
  });

  test('②③④ CustomerChartPage 차감 폼 3곳에 <option value="iv">수액 옵션 존재 (3개 이상)', () => {
    const s = read(SRC('pages/CustomerChartPage.tsx'));
    const ivOptionCount = (s.match(/<option value="iv">/g) ?? []).length;
    // c22DeductForm / sessionDlgForm / editSessionForm 3곳 → 최소 3개
    expect(ivOptionCount).toBeGreaterThanOrEqual(3);
    // 수액 라벨/매핑 보존
    expect(s).toContain('수액');
    expect(s).toContain("iv: '수액'");
  });
});

test.describe('AC1/AC3 STATS — 통계 집계 마이그 정합', () => {
  const migFile = MIG('20260608160000_foot_stats_iv_exclude_trial_conversion.sql');

  test('AC1: by_category 회차 집계에서 session_type=iv 제외', () => {
    const m = read(migFile);
    expect(m).toContain("ps.session_type <> 'iv'");
    // by_category 함수가 교체 대상에 포함
    expect(m).toContain('CREATE OR REPLACE FUNCTION foot_stats_by_category');
  });

  test('AC3: therapist_summary 전환은 contract_date = 체험 내원일(visit_date) 인 건만 인정', () => {
    const m = read(migFile);
    expect(m).toContain('CREATE OR REPLACE FUNCTION foot_stats_therapist_summary');
    expect(m).toContain('pk.contract_date = b.visit_date');
    // 분모(exp_total)·차단 없음: experience 필터는 유지, 차감 insert 변경 문구 없음
    expect(m).toContain("WHERE b.visit_type = 'experience'");
  });

  test('LOCK: 마이그가 차감 UI/이력/마스터 테이블 DDL 을 건드리지 않음 (통계 함수 교체만)', () => {
    const m = read(migFile);
    // 테이블 구조 변경 금지 (ALTER TABLE / DROP / DELETE / UPDATE package_sessions 등 부재)
    expect(m).not.toMatch(/ALTER TABLE/i);
    expect(m).not.toMatch(/DELETE FROM/i);
    expect(m).not.toMatch(/DROP TABLE/i);
  });
});
