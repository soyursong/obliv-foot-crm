/**
 * E2E spec — T-20260715-foot-TREATDASH-FLICKER
 *
 * 진료부 통합 대시보드(DoctorCallDashboard/MedicalChartPanel) 깜빡임(전면 re-render 스톰) 안정화.
 * RC(rc-report) 1순위 = realtime 구독 event:'*' + 20s/30s 다중 refetch 사이클 → check_ins 행 변경마다
 *   즉시 refetch → activeCalls/completedPatients/completedHourGroups 전부 재계산 → 전 행 re-render → 순간 플래시.
 *
 * [수정 핵심 · AC2] 데이터 산출·정렬·상태 의미·구독 대상 행 불변(비즈로직 무접촉), 렌더 빈도만 additive 교정:
 *   (1) realtime 구독 event:'*' → INSERT/UPDATE 로 좁힘(무관 DELETE 콜백 제거). 취소(status='cancelled')는
 *       UPDATE 이므로 여전히 반영(useDoctorCallFeed .neq 로 목록에서 사라짐).
 *   (2) 구독 refetch 를 debounce(600ms)로 병합 → 다수 변경 버스트가 refetch() 1회로 합쳐져 순간 플래시 제거.
 *       600ms 는 "3초 내 반영"(AC-1) 계약 내 → 실시간 반영 무회귀.
 *   (3) staleTime 상향(feed 5s→15s, clinical 10s→20s) + 백업 폴링 완화(feed 20s→30s, clinical 30s→60s)
 *       → 배경 refetch 사이클 수 감소.
 *
 * [현장 클릭 시나리오 변환]
 *   시나리오1(정상동선 — 30초 관찰 깜빡임 없음 + 실시간 반영 유지) → (S1) 구독 event narrow + debounce + 폴링/staleTime 완화 코드계약.
 *   시나리오2(엣지 — 무한 재시도 깜빡임 없음 + 레이아웃 shift 없음) → (S2) AC3 무회귀(self-heal/ErrorBoundary/CHART-UX) 코드계약.
 *
 * screenshot_gate=exempt (렌더-빈도/구독-경로 구조 단언형). 런타임 '30초 무깜빡임'·현장 체감은
 * field-soak 실기기(갤탭)에서 김주연 총괄 + 문지은 대표원장(풋 의료 R&R) 확인 + supervisor 필드 검증.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');

test.describe('T-20260715-foot-TREATDASH-FLICKER', () => {
  // ── 시나리오1: 정상 동선 — 깜빡임 해소(구독 narrow + debounce + 폴링/staleTime 완화) ──────────
  test('(S1-a) 대시보드 realtime 구독 event:* 제거 → INSERT/UPDATE 로 좁힘', () => {
    const dash = SRC('components/doctor/DoctorCallDashboard.tsx');
    // 클리닉-광역 구독에서 무관 DELETE 를 포함하던 event:'*' 콜백 제거
    expect(
      dash.includes("event: '*', schema: 'public', table: 'check_ins', filter: `clinic_id=eq."),
      '(S1-a) event:* 클리닉구독 제거',
    ).toBe(false);
    // 대시보드가 실제 반영하는 INSERT/UPDATE 로만 구독
    expect(dash.includes("{ event: 'INSERT', ...changeFilter }"), '(S1-a) INSERT 구독').toBe(true);
    expect(dash.includes("{ event: 'UPDATE', ...changeFilter }"), '(S1-a) UPDATE 구독').toBe(true);
  });

  test('(S1-b) 구독 refetch 를 debounce(600ms)로 병합 → 버스트 re-render 스톰 제거', () => {
    const dash = SRC('components/doctor/DoctorCallDashboard.tsx');
    // debounce 스케줄러: 직전 타이머 clear 후 600ms 뒤 refetch (버스트 병합)
    expect(/const scheduleRefetch = \(\) => \{/.test(dash), '(S1-b) scheduleRefetch 존재').toBe(true);
    expect(dash.includes('if (debounceTimer) clearTimeout(debounceTimer)'), '(S1-b) 직전 타이머 clear').toBe(true);
    expect(/setTimeout\(\(\) => \{[\s\S]*?void refetch\(\);[\s\S]*?\}, 600\)/.test(dash), '(S1-b) 600ms debounce refetch').toBe(true);
    // 언마운트 시 타이머 정리(누수/유령 refetch 방지)
    expect(dash.includes('return () => {') && dash.includes('void supabase.removeChannel(channel)'), '(S1-b) cleanup').toBe(true);
    // 구독 콜백은 즉시 refetch() 가 아니라 debounce 경유
    expect(dash.includes('scheduleRefetch)'), '(S1-b) 구독 콜백=scheduleRefetch').toBe(true);
  });

  test('(S1-c) 백업 폴링 완화 + staleTime 상향 → 배경 refetch 사이클 감소', () => {
    const dash = SRC('components/doctor/DoctorCallDashboard.tsx');
    // useDoctorCallFeed: 20s→30s / 5s→15s
    expect(dash.includes('refetchInterval: 30_000') && dash.includes('staleTime: 15_000'), '(S1-c) feed 폴링/staleTime 완화').toBe(true);
    // useCompletedClinicalProgress: 30s→60s / 10s→20s
    expect(dash.includes('refetchInterval: 60_000') && dash.includes('staleTime: 20_000'), '(S1-c) clinical 폴링/staleTime 완화').toBe(true);
    // 舊 과빈도 값(5s staleTime / 20s feed 폴링) 잔존 금지
    expect(dash.includes('staleTime: 5_000'), '(S1-c) 舊 feed staleTime 5s 제거').toBe(false);
  });

  test('(S1-d) 실시간 반영 무회귀 — 취소(cancelled) 필터·집계 로직 불변(비즈로직 무접촉)', () => {
    const dash = SRC('components/doctor/DoctorCallDashboard.tsx');
    // 목록 쿼리의 취소 제외(.neq status cancelled) 유지 → UPDATE→cancelled 가 refetch 시 목록에서 사라짐
    expect(dash.includes(".neq('status', 'cancelled')"), '(S1-d) 취소 제외 필터 유지').toBe(true);
    // 파생 집계(activeCalls purple / completedPatients / 정시그룹) 산출 규칙 불변
    expect(dash.includes("ci.status_flag === 'purple' && !ci.completed_at"), '(S1-d) activeCalls 산출 불변').toBe(true);
    expect(dash.includes("ci.completed_at || ci.status_flag === 'pink'"), '(S1-d) completedPatients 산출 불변').toBe(true);
  });

  test('(S1-e) MedicalChartPanel 진료화면 구독도 event:* → INSERT/UPDATE 좁힘', () => {
    const panel = SRC('components/MedicalChartPanel.tsx');
    // customer-scoped 구독 2건(doc_ack / treating) event:'*' 제거
    expect(
      panel.includes("event: '*', schema: 'public', table: 'check_ins', filter: `customer_id=eq."),
      '(S1-e) event:* customer구독 제거',
    ).toBe(false);
    expect(panel.includes("{ event: 'INSERT', ...ackFilter }"), '(S1-e) doc_ack INSERT').toBe(true);
    expect(panel.includes("{ event: 'UPDATE', ...ackFilter }"), '(S1-e) doc_ack UPDATE').toBe(true);
    expect(panel.includes("{ event: 'INSERT', ...treatFilter }"), '(S1-e) treating INSERT').toBe(true);
    expect(panel.includes("{ event: 'UPDATE', ...treatFilter }"), '(S1-e) treating UPDATE').toBe(true);
  });

  // ── 시나리오2: 엣지 — 무한 재시도 깜빡임 없음 + AC3 무회귀 ────────────────────────────────
  test('(S2-a) 무회귀 — self-heal(T-20260710)·ErrorBoundary(T-20260709) 계약 미접촉', () => {
    const dash = SRC('components/doctor/DoctorCallDashboard.tsx');
    // 본 fix 는 self-heal(chunkReload)·ErrorBoundary 재시도 로직에 코드를 추가/변경하지 않음
    //   (깜빡임 원인은 realtime refetch 스톰 — self-heal 20s 윈도우와 무관, RC 후보C 배제).
    expect(dash.includes('chunkReload') || dash.includes('ErrorBoundary'), '(S2-a) self-heal/EB 미도입').toBe(false);
    // 데이터 소스/쿼리키 불변(재마운트 유발 없음)
    expect(dash.includes("queryKey: ['doctor_call_dashboard', clinicId]"), '(S2-a) feed queryKey 불변').toBe(true);
  });

  test('(S2-b) 무회귀 — CHART-UX(인라인편집/미리보기 optimistic) 경로 불변', () => {
    const dash = SRC('components/doctor/DoctorCallDashboard.tsx');
    // 임상경과 저장 즉시반영 optimistic 경로 유지 → clinical 폴링 완화(60s)로도 체감 지연 없음
    expect(dash.includes('applyClinicalOptimistic'), '(S2-b) optimistic 미리보기 유지').toBe(true);
    expect(dash.includes("queryClient.setQueryData<Map<string, string>>"), '(S2-b) optimistic setQueryData 유지').toBe(true);
    // 인라인 임상경과/처방 팝오버 앵커(ColumnExpandPopover/RxPopover) 유지
    expect(dash.includes('ColumnExpandPopover') && dash.includes('RxPopover'), '(S2-b) 인라인편집 팝오버 유지').toBe(true);
  });
});
