/**
 * E2E spec — T-20260729-foot-CONFIRM-BTN-ROLE-OPEN (P1, FE only)
 *
 * 현장(김주연 총괄, C0ATE5P6JTH):
 *   부모 CONFIRM-BTN-SLACK-NOTIFY deployed(field-soak) 실사용 중 코디네이터가 [확정] 버튼을
 *   못 누르는 것 발견 → "권한 막지마 다 풀어줘" 직접 지시.
 *
 * 한 줄 스펙: 금일 배분 이력 [확정] 버튼의 역할 제한(canEditDistribution 조건 분기) 완전 제거
 *   → 코디네이터 포함 모든 역할이 버튼 표시+클릭 가능.
 *   + '코디네이터=미확정 텍스트' 폴백 렌더 경로(dist-notify-pending) 제거.
 *
 * 무접촉(부모 계승): 멱등 3-state(미확정→sending→sent), 발송 포맷/상담대기방 C0B4HEC9SHH,
 *   send-consult-notify EF 배선, DB/EF 변경 없음(FE only).
 * RED LINE INV-1: assigned_consultant_id 무접촉.
 *
 * 정본 소스 정적 단언(데이터/로그인 비의존) — 부모 spec 동형.
 * 실렌더(코디네이터 로그인→버튼 클릭→실발송)는 supervisor 맥스튜디오 실브라우저 단계 보강.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const PAGE = 'src/pages/Assignments.tsx';
const EF = 'supabase/functions/send-consult-notify/index.ts';

// 발송(확정) 셀 블록만 추출 — 3-state(sent/sending/확정) 렌더 ~ 셀 닫힘까지 (편집 대상 범위).
function confirmCell(src: string): string {
  const m = src.match(/\{r\.notifyStatus === 'sent' \?[\s\S]*?<\/td>\s*\n?\s*\)\}/);
  expect(m, '발송(확정) 셀 블록을 찾지 못함').not.toBeNull();
  return m![0];
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 코디네이터 포함 전 역할이 [확정] 버튼 표시+클릭 가능 (역할 제한 제거)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1: [확정] 버튼 렌더 경로가 canEditDistribution 게이트 밖 — sending 배지 else 로 직결', () => {
  const src = read(PAGE);
  const cell = confirmCell(src);
  // sending 배지 이후 곧바로 `) : (` else → Button (role 삼항 없음)
  expect(cell).toMatch(/dist-notify-sending[\s\S]*?\)\s*:\s*\(\s*\n?\s*<Button[\s\S]*?dist-confirm-btn/);
  // 발송(확정) 셀 안에서 canEditDistribution 조건 분기 완전 부재
  expect(cell).not.toContain('canEditDistribution');
});

test('시나리오1: 코디네이터 폴백(미확정 텍스트, dist-notify-pending) 렌더 경로 제거', () => {
  const src = read(PAGE);
  // 파일 전체에서 폴백 testid 제거 (전 역할이 실제 버튼을 봄)
  expect(src).not.toContain('dist-notify-pending');
  const cell = confirmCell(src);
  expect(cell).not.toContain('미확정');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 기존 역할 회귀 없음 (배정 이력 수정/삭제 게이트 무접촉 + 발송 배선 무접촉)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오2: 배분 이력 담당수정/삭제 권한 게이트(canEditDistribution)는 유지 — 확정 버튼만 개방', () => {
  const src = read(PAGE);
  // canEditDistribution 정의 = admin/manager/director 그대로
  expect(src).toMatch(
    /const canEditDistribution =\s*\n?\s*profile\?\.role === 'admin' \|\| profile\?\.role === 'manager' \|\| profile\?\.role === 'director'/,
  );
  // 삭제(soft-hide) 셀은 여전히 canEditDistribution 게이트
  expect(src).toMatch(/\{canEditDistribution && \(\s*\n?\s*<td[^>]*>\s*\n?\s*<Button[\s\S]*?data-testid=\{`dist-delete-btn-\$\{r\.id\}`\}[\s\S]*?setDistDeleteTarget/);
});

test('시나리오2: [확정] 클릭 → doConfirmNotify → send-consult-notify EF 배선 무접촉', () => {
  const src = read(PAGE);
  expect(src).toContain('data-testid={`dist-confirm-btn-${r.id}`}');
  expect(src).toMatch(/onClick=\{\(\) => void doConfirmNotify\(r\)\}/);
  expect(src).toMatch(/supabase\.functions\.invoke\(EDGE_FUNCTIONS\.SEND_CONSULT_NOTIFY/);
  expect(src).toMatch(/check_in_id: r\.checkIn\.id, clinic_id: clinic\.id, inflow: r\.inflow/);
});

test('시나리오2: EF 발송 포맷/상담대기방 C0B4HEC9SHH 무접촉 (FE only, DB/EF 변경 없음)', () => {
  const ef = read(EF);
  expect(ef).toMatch(/const text = `\$\{mention\} \$\{customerName\}님 \$\{inflow\}상담 대기중`/);
  expect(ef).toContain('C0B4HEC9SHH');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 멱등 role 무관 (sent/sending 건은 role 무관 배지/비활성, 이중발송 차단 유지)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오3: sent → 발송됨 배지 / sending → 발송중 배지 (role 무관, 버튼 비노출)', () => {
  const src = read(PAGE);
  const cell = confirmCell(src);
  expect(cell).toMatch(/r\.notifyStatus === 'sent' \?[\s\S]*?dist-notify-sent[\s\S]*?발송됨/);
  expect(cell).toMatch(/r\.notifyStatus === 'sending' \?[\s\S]*?dist-notify-sending[\s\S]*?발송중/);
  // sent/sending 배지는 role 게이트 밖(전 역할 동일하게 완료 상태를 봄)
  const sentSendingSeg = cell.slice(0, cell.indexOf('<Button'));
  expect(sentSendingSeg).not.toContain('canEditDistribution');
});

test('시나리오3: doConfirmNotify 멱등 가드 유지 — sent/sending 이면 재발송 차단 (role 무관)', () => {
  const src = read(PAGE);
  expect(src).toMatch(/if \(r\.notifyStatus === 'sent' \|\| r\.notifyStatus === 'sending'\) return/);
  // 상담 배정 한정(치료 탭 무의미)은 유지
  expect(src).toMatch(/if \(r\.role !== 'consult'\) return/);
});

test('시나리오3(RED LINE INV-1): 편집으로 매출귀속(assigned_consultant_id) write 유입 없음', () => {
  const cell = confirmCell(read(PAGE));
  expect(cell).not.toContain('assigned_consultant_id');
  expect(cell).not.toContain('consultant_id');
});
