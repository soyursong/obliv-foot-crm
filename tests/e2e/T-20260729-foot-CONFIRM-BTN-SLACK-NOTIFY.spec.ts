/**
 * E2E spec — T-20260729-foot-CONFIRM-BTN-SLACK-NOTIFY (P0 hotfix, SENDCONFIRM 변경1+변경2 계승)
 *
 * 현장(김주연 총괄, C0ATE5P6JTH, MSG-20260729-133148-duna):
 *   "금일 배분 이력 화면에 [확정] 버튼 추가 → 버튼 눌렀을 때만 상담대기방(C0B4HEC9SHH) 알림 발송."
 *   + 신규 실장 등록 시 표시명 '실장' suffix + 실장↔슬랙 ID 매핑 6명.
 *
 * 봇 dependency [RESOLVED 2026-07-29T13:53] — 장쳰봇 C0B4HEC9SHH 초대 완료 → 실 Slack 발송 배선.
 * DA CONSULT 1차 게이트(MSG-20260729-140858-yxxi): GO Option A + refinement 4
 *   (R1 auth.users FK / R2 named CHECK / R3 3-state / R4 slack_ts) — 전부 채택.
 *
 * 안전 가드 인코딩:
 *   - 멱등(3-state): EF 조건부 claim(status IS NULL → 'sending' → 'sent') rows-affected 로 이중발송 차단.
 *   - RED LINE INV-1: 발송상태 컬럼만 write. consultant_id / assigned_consultant_id(매출귀속) 무접촉.
 *   - factual_check: 배정 자동 즉시발송 없음(신규 배선) — [확정] 클릭 시에만 발송.
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 형제 foot spec 동형.
 * 실렌더(버튼 클릭→실발송/상태영속/이중발송 차단)는 supervisor 맥스튜디오 실브라우저 단계 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const STAFF = 'src/pages/Staff.tsx';
const SILJANG = 'src/lib/siljangSlack.ts';
const EF = 'supabase/functions/send-consult-notify/index.ts';
const MIG = 'supabase/migrations/20260729140000_foot_consult_notify_confirm_gate.sql';
const ENGINE = 'src/lib/autoAssign.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1 (변경1): 신규 실장 등록 '실장' suffix + 6명 슬랙 ID 매핑
// ─────────────────────────────────────────────────────────────────────────────
test('변경1: withSiljangSuffix — 이름 뒤 "실장" 부여, 기존 suffix 중복 방지', () => {
  const src = read(SILJANG);
  expect(src).toMatch(/export function withSiljangSuffix/);
  expect(src).toContain("export const SILJANG_SUFFIX = '실장'");
  // 이미 '실장'으로 끝나면 중복 부여 안 함
  expect(src).toMatch(/if \(n\.endsWith\(SILJANG_SUFFIX\)\) return n/);
});

test('변경1: 6명 실장↔슬랙 ID 매핑 SSOT (총괄 확정 표 그대로)', () => {
  const src = read(SILJANG);
  const map: Record<string, string> = {
    엄경은: 'U0B4JFD5Z6V',
    송지현: 'U0B4BSU84E9',
    정연주: 'U0B49P7JB3P',
    강경민: 'U0BFYC35B0X',
    김지윤: 'U0B902NG8JF',
    김주연: 'U0ATDB587PV',
  };
  for (const [name, id] of Object.entries(map)) {
    expect(src).toContain(name);
    expect(src).toContain(id);
  }
});

test('변경1(QA-FIX A안): 신규 실장(consultant) 등록 시에만 name 에 실장 suffix — display_name insert 금지(prod 부재)', () => {
  const src = read(STAFF);
  expect(src).toMatch(/import \{ withSiljangSuffix \} from '@\/lib\/siljangSlack'/);
  // A안: suffix 는 name 에 저장(consultant 한정). display_name insert 금지(foot prod 부재 42703).
  expect(src).toMatch(/name: role === 'consultant' \? withSiljangSuffix\(name\) : name\.trim\(\)/);
  // insertRow 에 display_name 키 부재(불변식 준수)
  expect(src).not.toMatch(/insertRow\.display_name/);
  expect(src).not.toMatch(/display_name\?: string/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (변경2): 금일 배분 이력 [확정] 버튼 → 클릭 시에만 상담대기방 발송
// ─────────────────────────────────────────────────────────────────────────────
test('변경2: 금일 배분 이력 상담 탭에 [확정] 버튼 렌더 (admin/manager/director)', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid={`dist-confirm-btn-${r.id}`}');
  // 발송 열은 상담 탭 한정
  expect(src).toMatch(/activeTab === 'consult' && \(\s*\n?\s*<th[^>]*>발송<\/th>/);
  // 버튼 클릭 → doConfirmNotify
  expect(src).toMatch(/onClick=\{\(\) => void doConfirmNotify\(r\)\}/);
});

test('변경2: doConfirmNotify 가 send-consult-notify EF 를 클릭 시 호출 (자동발송 아님)', () => {
  const src = read(PAGE);
  expect(src).toMatch(/const doConfirmNotify = async \(r: TodayDistRow\) =>/);
  expect(src).toMatch(/supabase\.functions\.invoke\(EDGE_FUNCTIONS\.SEND_CONSULT_NOTIFY/);
  // check_in_id + clinic_id + inflow 바인딩
  expect(src).toMatch(/check_in_id: r\.checkIn\.id, clinic_id: clinic\.id, inflow: r\.inflow/);
});

test('변경2: EF 발송 포맷 = <@담당실장SlackID> [고객명]님 [유입경로] 상담 대기중', () => {
  const src = read(EF);
  expect(src).toMatch(/const mention = slackId \? `<@\$\{slackId\}>` : displayName/);
  expect(src).toMatch(/const text = `\$\{mention\} \$\{customerName\}님 \$\{inflow\}상담 대기중`/);
  // 발송 채널 = 상담대기방 C0B4HEC9SHH (티켓 정본)
  expect(src).toContain('C0B4HEC9SHH');
});

test('변경2(QA-FIX A안): 담당실장 Slack ID 해소 = staff.slack_user_id → name 6명 매핑 fallback → 이름', () => {
  const src = read(EF);
  // A안: staff.display_name select 금지(prod 부재) → name 만 조회, nameKey 가 ' 실장' strip 후 매핑 hit.
  expect(src).toMatch(/\.select\("name, slack_user_id"\)/);
  expect(src).not.toMatch(/\.select\("[^"]*display_name[^"]*"\)/);
  expect(src).toMatch(/\(staffRow\.slack_user_id \?\? ""\)\.trim\(\) \|\|\s*\n?\s*SILJANG_SLACK_MAP\[nameKey\(staffRow\.name\)\]/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 이중발송 방지 (멱등, 3-state)
// ─────────────────────────────────────────────────────────────────────────────
// ★ SUPERSEDED by T-20260806-foot-CONSULTCONFIRM-SLACK-DECOUPLE-HARDEN (canon-conformance):
//   인라인 claim/승격/롤백이 원자적 RPC(enqueue_consult_notify) + decouple(발송=outbox/retry/DLQ)로 이동.
//   claim(NULL→sending)=[확정] 영속. 발송 실패 시 sending→NULL 롤백/502 제거(구 tight-coupling=P0 원인=버그).
test('시나리오3(decouple): 조건부 claim(status NULL→sending)은 enqueue_consult_notify RPC 경유 + 멱등 alreadySent', () => {
  const src = read(EF);
  expect(src).toContain('enqueue_consult_notify');
  // 멱등: claim 안 됨(race/already) → 2xx alreadySent (이중확정 차단)
  expect(src).toMatch(/rpc\.claimed !== true[\s\S]{0,220}alreadySent: true/);
});

test('시나리오3(decouple): 발송 성공 시 outbox delivered + check_ins sending→sent 승격 / 실패 시 롤백 없음', () => {
  const src = read(EF);
  expect(src).toMatch(/status:\s*"delivered"/);
  expect(src).toMatch(/consult_notify_status:\s*"sent"[\s\S]{0,240}eq\("consult_notify_status",\s*"sending"\)/);
  // 발송 실패 시 sending→NULL 롤백 경로 제거됨(claim=[확정] 영속)
  expect(src).not.toMatch(/consult_notify_status:\s*null,\s*consult_notify_by:\s*null/);
});

test('시나리오3(decouple): FE 확정건(sent/sending/failed) 재발송 차단 + 배지(발송됨/발송 대기/발송실패)', () => {
  const src = read(PAGE);
  expect(src).toMatch(/notifyStatus === 'sent' \|\| .*notifyStatus === 'sending' \|\| .*notifyStatus === 'failed'.*return/);
  expect(src).toMatch(/r\.notifyStatus === 'sent' \?[\s\S]*?발송됨/);
  expect(src).toMatch(/r\.notifyStatus === 'sending' \?[\s\S]*?발송 대기/);
  expect(src).toMatch(/r\.notifyStatus === 'failed' \?[\s\S]*?발송실패/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RED LINE INV-1: 발송 트리거/UI/표시명만 — 매출귀속(assigned_consultant_id) 무접촉
// ─────────────────────────────────────────────────────────────────────────────
// ★ decouple(T-20260806-...HARDEN): EF 가 이제 consult_notify_outbox(별도 테이블)도 update → check_ins update 로 범위 축소.
//   INV-1 본질(매출귀속 consultant_id/assigned_consultant_id/therapist_id write 0)은 그대로 강제.
test('RED LINE INV-1: 매출귀속 write 0 + check_ins update SET 절은 consult_notify_* 만 (outbox update 는 별도 테이블)', () => {
  const code = read(EF)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  // 매출귀속 앵커는 코드 어디에도 write 없음 (customers 소재, EF 는 check_ins/outbox 만)
  expect(code).not.toMatch(/assigned_consultant_id/);
  expect(code).not.toMatch(/from\("customers"\)/);
  // check_ins.update({...}) 블록만 추출 → SET 키 전부 consult_notify_ 접두 (배정/매출귀속 포인터 무접촉).
  const checkInUpdates = code.match(/from\("check_ins"\)\s*\.update\(\{[\s\S]*?\}\)/g) ?? [];
  expect(checkInUpdates.length).toBeGreaterThan(0);
  for (const blk of checkInUpdates) {
    expect(blk).not.toMatch(/\bconsultant_id\b/);
    expect(blk).not.toMatch(/\btherapist_id\b/);
    const keys = (blk.match(/(\w+):/g) ?? []).map((k) => k.replace(':', ''));
    for (const key of keys) expect(key.startsWith('consult_notify_')).toBe(true);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// factual_check: 배정 자동 즉시발송 없음 (신규 배선) — 오직 [확정] EF 만 상담대기방 발송
// ─────────────────────────────────────────────────────────────────────────────
test('factual_check: autoAssign 엔진은 상담대기방 발송/EF 호출 부재 (자동발송 아님)', () => {
  const eng = read(ENGINE);
  expect(eng).not.toContain('C0B4HEC9SHH');
  expect(eng).not.toContain('chat.postMessage');
  expect(eng).not.toContain('send-consult-notify');
  expect(eng).not.toContain('SEND_CONSULT_NOTIFY');
});

// ─────────────────────────────────────────────────────────────────────────────
// 마이그레이션 (ADDITIVE + DA R1/R2/R4)
// ─────────────────────────────────────────────────────────────────────────────
test('마이그: check_ins 발송상태 4컬럼 ADDITIVE nullable (DEFAULT 없음, IF NOT EXISTS)', () => {
  const sql = read(MIG);
  for (const col of ['consult_notify_status', 'consult_notify_sent_at', 'consult_notify_by', 'consult_notify_slack_ts']) {
    expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}`));
  }
  // 파괴적 변경 부재
  expect(sql).not.toMatch(/DROP COLUMN/);
  expect(sql).not.toMatch(/ALTER COLUMN[\s\S]*?TYPE/);
});

test('마이그: DA R2 named CHECK (NULL/sending/sent) + R1 auth.users FK ON DELETE SET NULL', () => {
  const sql = read(MIG);
  expect(sql).toContain('chk_check_ins_consult_notify_status');
  expect(sql).toMatch(/consult_notify_status IS NULL OR consult_notify_status IN \('sending', 'sent'\)/);
  expect(sql).toContain('fk_check_ins_consult_notify_by');
  expect(sql).toMatch(/REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
});

test('마이그: RED LINE — 매출귀속/배정 컬럼 무접촉 (assigned_consultant_id write 부재)', () => {
  const sql = read(MIG);
  // 발송상태 컬럼만 ADD, assigned_consultant_id 는 코멘트 언급 외 DDL 대상 아님
  expect(sql).not.toMatch(/ALTER TABLE[^\n]*customers/);
  expect(sql).not.toMatch(/(ADD|DROP|ALTER) COLUMN[^\n]*assigned_consultant_id/);
});
