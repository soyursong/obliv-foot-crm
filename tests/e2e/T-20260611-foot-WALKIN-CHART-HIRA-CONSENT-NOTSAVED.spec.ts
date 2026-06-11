/**
 * E2E spec: T-20260611-foot-WALKIN-CHART-HIRA-CONSENT-NOTSAVED
 *
 * 현장(김주연 총괄 C0ATE5P6JTH, 2026-06-11, MSG-20260611-100556-btbt):
 *   워크인 고객차트(CRM 어드민 직원 수기입력)에서 건강보험조회(HIRA) 동의 체크 후
 *   저장해도 차트에 반영 안 됨. 개인정보수집 동의는 별도(본 티켓 scope 아님).
 *
 * ── AC-0 화면 위치 확정 (repo 재판정, wrong-target 5R 교훈) ────────────────────
 *   1) 어드민 "고객차트 직접입력" 건강보험조회 토글 = obliv-foot-crm CustomerChartPage.tsx.
 *      → 토글은 DB 저장은 됐으나 cross-tab 갱신 신호(foot_crm_customer_refresh)를 쏘지
 *        않아, 같은 고객을 연 다른 뷰(CheckInDetailSheet 의 건보조회 게이트 / 1번차트 탭)가
 *        리프레시되지 않음 → "체크해도 미반영"으로 관측. privacy/sms 토글은
 *        saveCustomerField 경유로 신호를 쐈으나 hira 만 인라인 update 라 누락(분기).
 *   2) 워크인 셀프접수(키오스크) hira 누락은 부모 T-...-SELFCHECKIN-CONSENT-ADDR-NOTSAVED
 *      에서 foot-checkin(canonical CF Pages) 으로 수정 완료(commit e7a8494). obliv-foot-crm
 *      native SelfCheckIn 은 jongno-foot 에서 308 redirect 되는 stale 사본이나, 비-jongno
 *      slug/로컬 대비 + 부모와 단일 패턴 정합을 위해 동일하게 INSERT 선저장 + silent-fail 표면화.
 *
 * 수정 (3 invariant):
 *   AC-1/AC-3 (admin 고객차트, 실제 근인): CustomerChartPage.toggleHiraConsent 가
 *     privacy/sms 와 동일하게 공통 핸들러 saveCustomerField 경유 → DB 저장 + cross-tab
 *     refresh 신호(foot_crm_customer_refresh) 동시 발화. "한쪽만 고쳐지는" 분기 제거(단일경로).
 *   AC-1/AC-3 (워크인 셀프접수 write-path 정합/방어): SelfCheckIn 워크인 신규 INSERT
 *     payload 에 hira_consent(+_at) 선저장 — RPC 가용성과 무관하게 보관의무 충족.
 *   AC-2 (silent-fail 제거): fn_selfcheckin_update_personal_info 빈 catch{} → 에러 표면화
 *     (console.error). 무관측 silent-fail 재발 방지.
 *
 * DB(supervisor DB-gate, 부모 티켓에서 이미 적용 대기): 20260611100000 consolidate 마이그가
 *   fn_selfcheckin_update_personal_info 10-arg canonical 에서 p_insurance_consent→hira_consent(+at)
 *   를 기록. 본 티켓은 신규 컬럼/마이그 없음(FE write-path + 경로통일).
 *
 * 결정성: write-path/경로통일은 auth+실 DB 필요로 UI E2E 가 브리틀 → 소스 불변식 단언
 *   (obliv 테스트 지배 패턴, 125 spec 동일). 키 라인 변형 시 즉시 FAIL.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';

const CHART_SRC = new URL('../../src/pages/CustomerChartPage.tsx', import.meta.url).pathname;
const SELFCHECKIN_SRC = new URL('../../src/pages/SelfCheckIn.tsx', import.meta.url).pathname;
const RPC_MIG = new URL(
  '../../supabase/migrations/20260611100000_selfcheckin_personal_info_consolidate.sql',
  import.meta.url,
).pathname;

function read(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

test.describe('WALKIN-CHART-HIRA-CONSENT-NOTSAVED — 건강보험조회 동의 저장 복원 + 단일경로', () => {
  test('AC-1/AC-3 (admin 고객차트): toggleHiraConsent 가 공통 saveCustomerField 경유 (인라인 update 분기 제거)', () => {
    const src = read(CHART_SRC);
    const fn = src.slice(
      src.indexOf('const toggleHiraConsent'),
      src.indexOf('const toggleHiraConsent') + 600,
    );
    expect(fn, 'toggleHiraConsent 존재').toContain('toggleHiraConsent');
    // 공통 핸들러 경유 — privacy/sms 와 단일 경로
    expect(fn, 'saveCustomerField 경유').toContain('await saveCustomerField(');
    expect(fn).toContain('hira_consent');
    expect(fn).toContain('hira_consent_at');
    // 기존 "한쪽만 고쳐지는" 인라인 분기 금지: 토글 본문에서 직접 customers.update 호출 안 함
    expect(fn, '인라인 supabase update 분기 제거').not.toMatch(/from\(['"]customers['"]\)\s*\.update/);
  });

  test('AC-3 (cross-tab 반영): saveCustomerField 가 foot_crm_customer_refresh 신호 발화 (다른 뷰 리프레시)', () => {
    const src = read(CHART_SRC);
    const fn = src.slice(
      src.indexOf('const saveCustomerField'),
      src.indexOf('const saveCustomerField') + 700,
    );
    expect(fn, 'saveCustomerField 가 DB 저장').toContain("from('customers').update(patch)");
    // hira 토글이 이제 이 핸들러를 타므로, 토글 시에도 cross-tab 갱신 신호가 발화됨 = "미반영" 해소
    expect(fn, 'cross-tab refresh 신호 발화').toContain("localStorage.setItem('foot_crm_customer_refresh'");
    // 리스너 측 존재(다른 뷰가 신호를 수신해 재조회)
    expect(src, 'CustomerChartPage refresh 리스너').toContain("e.key !== 'foot_crm_customer_refresh'");
  });

  test('AC-1/AC-3 (워크인 셀프접수): 신규 고객 INSERT payload 에 hira_consent(+_at) 선저장', () => {
    const src = read(SELFCHECKIN_SRC);
    // 워크인 분기 블록 추출 (privacy + hira 동시 저장)
    const walkinBlock = src.slice(
      src.indexOf("if (reservationType === 'walkin') {"),
      src.indexOf("if (reservationType === 'walkin') {") + 1600,
    );
    expect(walkinBlock).toContain('newCustomerPayload.privacy_consent');
    // 핵심: hira 도 동일 INSERT 단계에서 선저장 — RPC 무관 보관의무 충족(단일 패턴)
    expect(walkinBlock, '워크인 INSERT 에 hira_consent 선저장').toContain('newCustomerPayload.hira_consent = insuranceConsent');
    expect(walkinBlock, 'hira_consent_at audit 병기').toContain('newCustomerPayload.hira_consent_at');
  });

  test('AC-2 (silent-fail 제거): personal_info RPC 빈 catch{} → 에러 표면화(console.error)', () => {
    const src = read(SELFCHECKIN_SRC);
    // RPC 호출 결과의 error 를 캡처
    expect(src, 'RPC error 캡처').toContain("const { error: piErr } = await anonClient.rpc('fn_selfcheckin_update_personal_info'");
    // 빈 catch 가 아니라 표면화
    expect(src, 'RPC 실패 표면화').toContain("console.error('[selfcheckin] fn_selfcheckin_update_personal_info 실패");
    expect(src, 'catch 예외도 표면화').toContain('console.error(\'[selfcheckin] fn_selfcheckin_update_personal_info 예외');
    // 과거 silent-fail 주석 텍스트가 단독 catch 본문으로 남지 않도록 — 표면화 로그가 함께 존재
    const rpcIdx = src.indexOf("await anonClient.rpc('fn_selfcheckin_update_personal_info'");
    const around = src.slice(rpcIdx, rpcIdx + 1200);
    expect(around, '비블로킹 유지(접수 완료 UX)').toContain('접수 완료');
  });

  test('AC-3 (단일경로 DB 계약): 공유 RPC 가 p_insurance_consent → hira_consent(+at) 기록 (키오스크/워크인 공통)', () => {
    const mig = read(RPC_MIG);
    // 키오스크(foot-checkin)와 워크인(obliv) 모두 이 동일 RPC 를 호출 = 단일 write 경로
    expect(mig).toContain('p_insurance_consent');
    expect(mig).toMatch(/hira_consent\s*=\s*CASE[\s\S]*?p_insurance_consent\s*=\s*true\s*THEN\s*true/);
    expect(mig).toMatch(/hira_consent_at\s*=\s*CASE[\s\S]*?p_insurance_consent\s*=\s*true\s*THEN\s*now\(\)/);
  });
});
