/**
 * E2E spec — T-20260806-foot-ASSIGNCONFIRM-EF-NON2XX (P0 운영차단 핫픽스)
 *
 * 현장(김주연 총괄, C0ATE5P6JTH, 스샷 20260806_140842):
 *   풋 오리진점 > 상담 배정 > '금일 배분 이력' > [확정] 클릭 시
 *   "Edge Function returned a non-2xx status code" 팝업 → 당일 상담 배정 확정 전체 차단.
 *   김진무 #F-5700 외 다수 재현(8/6).
 *
 * ── 진단 확정(런타임 실증, 2026-08-06) ──
 *   근본원인 = send-consult-notify EF 의 Slack 발송 단계가 502 `channel_not_found` 로 실패.
 *   실증 절차:
 *     1) 배포 EF 를 테스트 admin JWT + 가짜 check_in_id 로 호출 → 404("배정 건 없음")
 *        ⇒ auth(verifyRoleJwt)·클리닉격리·check_ins read 전부 통과(=service_role 키 정상, role drift 아님).
 *     2) 실 행(신미수)으로 호출 → 502 body {"error":"Slack 발송 실패: channel_not_found"}.
 *     3) DB 로컬 재현: check_in/staff 로드 OK, claim UPDATE rows-affected=1, notify 4컬럼 write OK
 *        ⇒ 스키마·RLS·write 정상. 유일 실패 지점 = Slack chat.postMessage(channel_not_found).
 *     4) check_ins.consult_notify_status='sent' 148건, 최근 성공 2026-08-05 11:17
 *        ⇒ 8/5 오후~8/6 사이 발생한 회귀. 코드/스키마/키 무변경.
 *   결론: 상담대기방 채널(C0B4HEC9SHH) 접근 상실(채널 삭제/보관 또는 알림봇 강퇴/채널ID 재발급).
 *   ⇒ 실제 unblock = ops(Slack) 조치: 채널 상태 확인 + 정확한 채널ID 확보 + 알림봇 초대
 *      + CONSULT_NOTIFY_CHANNEL 시크릿 갱신. (코드 결함 아님 — planner FOLLOWUP 별도 라우팅)
 *
 * ── 본 티켓의 코드 fix(FE, in-domain·저위험·db_change=false) ──
 *   EF non-2xx 시 supabase-js 는 data=null·error=generic("...non-2xx status code")로 반환 →
 *   실제 원인(EF 응답 본문)이 삼켜져 현장은 불투명 오류만 봄(총괄이 원인 못 보고 티켓 제기).
 *   → doConfirmNotify 가 error.context(Response) 본문을 읽어 실 사유를 노출 + 채널 접근 실패는
 *     raw slack 코드를 감추고 현장 친화 한국어로 매핑(field_lang_dict 게이트).
 *   이 fix 는 배정 확정을 unblock 하지 않음(채널 복구는 ops). 실패 원인 가시성/진단성만 개선.
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(로그인→[확정]→친화 오류 노출)는 supervisor 맥스튜디오 실브라우저 단계 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const EF = 'supabase/functions/send-consult-notify/index.ts';

/** doConfirmNotify 핸들러 본문 슬라이스 추출. */
function confirmHandler(): string {
  const src = read(PAGE);
  const start = src.indexOf('const doConfirmNotify');
  expect(start).toBeGreaterThan(-1);
  // 다음 핸들러(doSoftHideDrill) 직전까지
  const end = src.indexOf('const doSoftHideDrill', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 정상 동선 계약 — 성공 응답 시 성공 토스트 + 상태 재조회(회귀 방지)
//   (fix 는 성공 경로를 건드리지 않음: res.alreadySent / 발송 완료 + load() 유지)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1: 성공 경로 불변 — 발송 완료 토스트 + consult_notify_status 재조회(load) 유지', () => {
  const h = confirmHandler();
  expect(h).toContain('상담대기방 발송 완료');
  expect(h).toContain('이미 발송된 건입니다.');
  expect(h).toMatch(/void load\(\)/); // '발송됨' 반영 재조회
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 재현(버그) → fix — non-2xx 시 실제 EF 사유 노출 + 채널실패 친화 매핑
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오2-a: non-2xx 시 error.context 응답 본문을 읽어 실 사유를 노출(불투명 generic 오류 대체)', () => {
  const h = confirmHandler();
  // FunctionsHttpError.context(Response) 본문 파싱 경로 존재
  expect(h).toMatch(/error\s+as\s+\{\s*context\?\s*:\s*Response/);
  expect(h).toMatch(/ctx\.json\(\)/);
  expect(h).toMatch(/body\?\.error/);
});

test('시나리오2-b: 채널 접근 실패(channel_not_found/not_in_channel/is_archived) → 현장 친화 한국어 매핑(raw 코드 비노출)', () => {
  const h = confirmHandler();
  expect(h).toMatch(/channel_not_found\|not_in_channel\|is_archived/);
  expect(h).toContain('상담대기방 발송 채널에 접근할 수 없습니다');
  expect(h).toContain('관리자에게 문의');
});

test('시나리오2-c: 현장 토스트에 raw slack 코드 문자열을 직접 뿌리지 않음(field_lang_dict 게이트)', () => {
  const h = confirmHandler();
  // toast.error 인자로 msg(친화 매핑 후 값)만 전달 — 사전 매핑 로직이 앞선다.
  const mapIdx = h.indexOf("상담대기방 발송 채널에 접근할 수 없습니다");
  const toastIdx = h.indexOf('toast.error(msg)');
  expect(mapIdx).toBeGreaterThan(-1);
  expect(toastIdx).toBeGreaterThan(mapIdx); // 매핑이 toast 앞
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 안전 불변 — EF 멱등/롤백/RED LINE 무훼손(FE-only fix)
// ─────────────────────────────────────────────────────────────────────────────
test('안전 불변: Slack 발송 실패 시 EF 는 claim 롤백(sending→NULL) 유지 → 재시도 가능', () => {
  const src = read(EF);
  expect(src).toContain('Slack 발송 실패');
  // 발송 실패 분기에서 status='sending'·by=userId 조건부 롤백
  expect(src).toMatch(/consult_notify_status:\s*null[\s\S]*?eq\("consult_notify_status",\s*"sending"\)/);
});

test('안전 불변: RED LINE INV-1 — claim SET 절은 consult_notify_* 만, 매출귀속(consultant_id) 무접촉', () => {
  const src = read(EF);
  expect(src).not.toMatch(/\.update\(\{[^}]*assigned_consultant_id:/);
  expect(src).not.toMatch(/\.update\(\{[^}]*\bconsultant_id:\s/);
});

test('안전 불변: FE-only fix — 성공/멱등 상태모델 무변경(status 3-state 텍스트 유지)', () => {
  const src = read(PAGE);
  // notifyStatus 3-state 게이트(sent/sending) 유지
  expect(src).toMatch(/notifyStatus === 'sent' \|\| .*notifyStatus === 'sending'/);
});
