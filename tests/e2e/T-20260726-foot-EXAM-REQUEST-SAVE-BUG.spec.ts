/**
 * T-20260726-foot-EXAM-REQUEST-SAVE-BUG
 *
 * 검사 신청 내역이 저장 안 됨 / 저장된 척 보였다가 사라짐 (치료테이블 균검사·피검사).
 *
 * ── 진단 결과 (prod READ-ONLY, service_role context — cross_crm_read_authcontext_standard) ──
 *   (A) write 실패 = 아님. 검사신청 write RPC(request_koh/blood_for_customer, SECURITY DEFINER)는
 *       정상 영속 — prod 실측 KOH 47행 / 피검사 89행 물리 존재. 실패 시 RPC 가 RAISE(P0002/42501).
 *   (B) render/조회 유실 = 지배 RC. 검사신청 목록(ExamTargetsSection 균검사 / BloodDailyListSection 피검사)이
 *       윈도/신청일을 부모 check_ins.checked_in_at(내원일) 기준으로 잡는데, write RPC 는 '가장 최근 내원'
 *       (과거일자 가능)에 신청행을 INSERT/UPDATE 한다. 오늘 신청했으나 신청행이 과거일자 내원에 붙으면
 *       내원일 스코프 밖 → 오늘 목록에서 사라짐. prod 실측: created_day != checkin_day 5행(07-24 KOH 4행 등).
 *
 * ── 수정 ──
 *   FIX-1 (RC=B 해소, read-side): 검사신청일/윈도 기준을 신청행 자신의 created_at(실제 신청시각)으로 교정.
 *          ExamTargetsSection(균검사) + BloodDailyListSection(피검사) 동일 적용. no-DDL·ADDITIVE read.
 *   FIX-2 (AC silent-write-failure, write-side convergence): 3개 write 진입점(KohRequestToggle /
 *          BloodTestRequestToggle / ManualExamRequestDialog)이 RPC 반환행(boolean)을 검증 —
 *          신청(ON)인데 true 미반환 시 성공 간주 금지·명시적 에러(cross_crm_write_rowcheck INV-W2/W3).
 *
 * 정적(빌드 산출 소스) 검증 — 데이터 계약/DB 상태 미의존(no-DDL). 회귀: 신청→새로고침/탭전환 후 유지(스코프 정합).
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
const kohToggle = () => read('src/components/KohRequestToggle.tsx');
const bloodToggle = () => read('src/components/BloodTestRequestToggle.tsx');
const dialog = () => read('src/components/treatment/ManualExamRequestDialog.tsx');

test.describe('FIX-1: 검사신청 목록 스코프 = 신청행 created_at (RC=B render/조회 유실 해소)', () => {
  test('균검사(ExamTargetsSection): 윈도 필터가 created_at 기준(내원일 checked_in_at 미사용)', () => {
    const e = exam();
    // 윈도 필터를 신청행 created_at 으로 — 과거일자 내원에 붙은 오늘 신청분 회수.
    expect(e).toContain(".gte('created_at', startTs)");
    expect(e).toContain(".lte('created_at', endTs)");
    // 旧 내원일(check_ins.checked_in_at) 윈도 필터 제거 확인(회귀 방지).
    expect(e).not.toContain(".gte('check_ins.checked_in_at'");
    expect(e).not.toContain(".lte('check_ins.checked_in_at'");
    // 신청일 그룹핑도 created_at 기준(내원일 폴백 허용).
    expect(e).toContain("raw['created_at'] ?? ci['checked_in_at']");
    // select 에 created_at 포함(기존).
    expect(e).toContain('created_at');
  });

  test('피검사(BloodDailyListSection): 동일 created_at 기준 스코프', () => {
    const b = blood();
    expect(b).toContain(".gte('created_at', startTs)");
    expect(b).toContain(".lte('created_at', endTs)");
    expect(b).not.toContain(".gte('check_ins.checked_in_at'");
    expect(b).not.toContain(".lte('check_ins.checked_in_at'");
    expect(b).toContain("raw['created_at'] ?? ci['checked_in_at']");
    // select 에 created_at 추가되었는지.
    expect(b).toMatch(/blood_test_requested,\s*created_at/);
  });

  test('clinic/status 스코프는 보존(부모 check_ins 필터 유지 — 데이터 계약 무변경)', () => {
    for (const src of [exam(), blood()]) {
      expect(src).toContain("eq('check_ins.clinic_id', clinicId)");
      expect(src).toContain("neq('check_ins.status', 'cancelled')");
    }
  });
});

test.describe('FIX-2: write 반환행 검증 — silent write-failure 차단 + 3진입점 단일 로직 수렴', () => {
  test('KohRequestToggle: RPC data 반환행 검증(신청 ON 시 true 미반환 → 에러)', () => {
    const k = kohToggle();
    expect(k).toContain('const { data, error } = await supabase.rpc');
    expect(k).toMatch(/if\s*\(next && data !== true\)/);
    expect(k).toContain('저장되지 않았습니다');
  });

  test('BloodTestRequestToggle: 동일 반환행 검증', () => {
    const b = bloodToggle();
    expect(b).toContain('const { data, error } = await supabase.rpc');
    expect(b).toMatch(/if\s*\(next && data !== true\)/);
    expect(b).toContain('저장되지 않았습니다');
  });

  test('ManualExamRequestDialog: 반환행 검증(신청은 항상 ON → data !== true 시 에러)', () => {
    const d = dialog();
    expect(d).toContain('const { data, error } = await supabase.rpc');
    expect(d).toMatch(/if\s*\(data !== true\)/);
    expect(d).toContain('저장되지 않았습니다');
  });
});

test.describe('회귀: 저장경로(RPC) 단일 수렴 유지 — 3진입점 동일 RPC', () => {
  test('토글·수기 모두 request_koh/blood_for_customer RPC 만 사용(직접 INSERT/UPDATE 없음)', () => {
    for (const src of [kohToggle(), bloodToggle(), dialog()]) {
      expect(src).toMatch(/request_(koh|blood_test)_for_customer/);
    }
    // 수기 다이얼로그: 직접 테이블 write 부재(RPC 위임만).
    expect(dialog()).not.toContain('.update(');
  });
});
