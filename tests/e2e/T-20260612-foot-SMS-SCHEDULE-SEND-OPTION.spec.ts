import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260612-foot-SMS-SCHEDULE-SEND-OPTION — 문자 발송 즉시/예약 구분 옵션
 * 원천: 김주연 총괄 (#project-doai-crm-풋확장, 채널 C0ATE5P6JTH).
 *
 * 진입점 2곳 모두 동일 발송방식 선택 UI(즉시/예약) 제공:
 *   (A) 대시보드 고객 우클릭 → [문자]  (SendSmsDialog, entrySource='dashboard')
 *   (B) 메시지 설정 화면 ④ 수동 발송      (AdminSettings SectionManual → SendSmsDialog, entrySource='settings')
 * 예약: 날짜+시간 picker 로 지정 시각 → scheduled_messages 적재 → pg_cron 디스패치(누락 금지).
 *
 * AC-1 양 진입점 선택 UI / AC-2 예약 지정·자동발송 / AC-3 즉시발송 회귀 비파괴 / AC-4 DB·롤백 안전.
 * 현장 클릭 시나리오 3종: ① 대시보드 즉시 ② 설정화면 예약 ③ 과거시각 차단.
 *
 * 테스트 방식 = source-integrity gating(정적 소스 단언). 거대-인라인 페이지 + DB게이트 관례.
 * 실 브라우저 동작은 supervisor field-soak, DB 적용은 supervisor 게이트(db_change=true)로 닫음.
 */

const SELECTOR  = fs.readFileSync(path.resolve('src/components/SendMethodSelector.tsx'), 'utf-8');
const SMS_DLG   = fs.readFileSync(path.resolve('src/components/SendSmsDialog.tsx'), 'utf-8');
const ADMIN     = fs.readFileSync(path.resolve('src/pages/AdminSettings.tsx'), 'utf-8');
const MIGRATION = fs.readFileSync(path.resolve('supabase/migrations/20260612120000_scheduled_messages.sql'), 'utf-8');
const ROLLBACK  = fs.readFileSync(path.resolve('supabase/migrations/20260612120000_scheduled_messages.rollback.sql'), 'utf-8');
const EF        = fs.readFileSync(path.resolve('supabase/functions/send-notification/index.ts'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — 양 진입점 동일 발송방식 선택 UI (즉시/예약)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-1: 양 진입점 발송방식 선택 UI', () => {
  test('AC1-1: 공용 SendMethodSelector — 즉시/예약 토글 존재', () => {
    expect(SELECTOR).toContain('data-testid="send-method-selector"');
    expect(SELECTOR).toContain('data-testid="send-mode-immediate"');
    expect(SELECTOR).toContain('data-testid="send-mode-scheduled"');
    expect(SELECTOR).toContain('즉시 발송');
    expect(SELECTOR).toContain('예약 발송');
  });

  test('AC1-2: 예약 모드 → 날짜+시간 picker(datetime-local) 노출', () => {
    expect(SELECTOR).toContain('type="datetime-local"');
    expect(SELECTOR).toContain('data-testid="send-schedule-datetime"');
  });

  test('AC1-3: 진입점 A(SendSmsDialog) — 공용 선택 위젯 재사용', () => {
    expect(SMS_DLG).toContain("import SendMethodSelector");
    expect(SMS_DLG).toContain('<SendMethodSelector');
  });

  test('AC1-4: 진입점 B(메시지설정 ④ 수동 발송) — 동일 SendSmsDialog 재사용(신규 경로 신설 금지)', () => {
    expect(ADMIN).toContain("import SendSmsDialog from '@/components/SendSmsDialog'");
    expect(ADMIN).toContain('<SendSmsDialog');
    expect(ADMIN).toContain('entrySource="settings"');
    // 고객 검색 → 문자 작성 버튼
    expect(ADMIN).toContain('InlinePatientSearch');
    expect(ADMIN).toContain('data-testid="manual-send-open-sms"');
    // stub 문구 제거 확인
    expect(ADMIN).not.toContain('D-1 자동 발송 안정화 후 오픈됩니다');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 — 예약 지정 → scheduled_messages 적재 → 지정 시각 자동발송(누락 금지)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-2: 예약 지정·자동발송', () => {
  test('AC2-1: 예약 모드 발송 시 scheduled_messages INSERT 경로', () => {
    expect(SMS_DLG).toContain("from('scheduled_messages')");
    expect(SMS_DLG).toContain('scheduled_at:');
    expect(SMS_DLG).toContain('parseScheduledKstToUtcIso');
  });

  test('AC2-2: KST 입력 → UTC 저장 변환(+09:00)', () => {
    expect(SELECTOR).toContain('+09:00');
    expect(SELECTOR).toContain('function parseScheduledKstToUtcIso');
  });

  test('AC2-3: DB 디스패처 — pg_cron 1분 주기 + claim(SKIP LOCKED)', () => {
    expect(MIGRATION).toContain('dispatch_scheduled_messages');
    expect(MIGRATION).toContain('FOR UPDATE SKIP LOCKED');
    expect(MIGRATION).toContain("'* * * * *'"); // 매 1분
    expect(MIGRATION).toContain('foot-scheduled-msg-dispatch');
  });

  test('AC2-4: 누락 금지 — stuck-reaper(processing 정체 회수) 존재', () => {
    expect(MIGRATION).toContain("status = 'processing'");
    expect(MIGRATION).toContain("INTERVAL '10 minutes'");
    expect(MIGRATION).toContain('reaper_requeued');
  });

  test('AC2-5: EF scheduled_send 핸들러 — 내부호출 전용 + 결과 기록', () => {
    expect(EF).toContain('scheduled_send');
    expect(EF).toContain('scheduled_message_id');
    expect(EF).toContain("status: ok ? \"sent\" : \"failed\""); // scheduled_messages 결과 기록
    // 중복발송 방지: processing 점유 건만 발송
    expect(EF).toContain('sr.status !== "processing"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — 즉시 발송 회귀 비파괴 (기존 manual_send 동선 보존)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-3: 즉시 발송 회귀 비파괴', () => {
  test('AC3-1: 즉시 모드 기존 EF manual_send 호출 보존', () => {
    expect(SMS_DLG).toContain("_action: 'manual_send'");
    expect(SMS_DLG).toContain("invoke('send-notification'");
  });

  test('AC3-2: 기존 발송 testid 보존(우클릭 [문자] 스펙 회귀)', () => {
    expect(SMS_DLG).toContain('data-testid="sms-send-btn"');
    expect(SMS_DLG).toContain('data-testid="sms-send-confirm-btn"');
  });

  test('AC3-3: scheduled_messages 미배포 환경 → 예약 비활성(즉시발송 보존)', () => {
    // probe 로 테이블 존재 확인 후에만 예약 활성
    expect(SMS_DLG).toContain("from('scheduled_messages')");
    expect(SMS_DLG).toContain('setScheduleAvailable');
    expect(SELECTOR).toContain('data-testid="send-schedule-unavailable"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-4 — DB·롤백 안전 + 과거시각 차단(시나리오 ③)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC-4: DB 안전 + 과거시각 차단', () => {
  test('AC4-1: 롤백 SQL — cron 해제 + 함수/테이블 drop', () => {
    expect(ROLLBACK).toContain("cron.unschedule('foot-scheduled-msg-dispatch')");
    expect(ROLLBACK).toContain('DROP FUNCTION IF EXISTS public.dispatch_scheduled_messages');
    expect(ROLLBACK).toContain('DROP TABLE IF EXISTS public.scheduled_messages');
  });

  test('AC4-2: 신규 테이블 RLS 활성 + 지점 격리', () => {
    expect(MIGRATION).toContain('ENABLE ROW LEVEL SECURITY');
    expect(MIGRATION).toContain('clinic_id = public.get_user_clinic_id()');
    expect(MIGRATION).toContain("status IN ('pending','processing','sent','failed','cancelled')");
  });

  test('AC4-3: 과거시각 차단 — validateScheduled 가 과거/현재 거부', () => {
    expect(SELECTOR).toContain('function validateScheduled');
    expect(SELECTOR).toContain('지난 시각으로는 예약할 수 없습니다');
    expect(SELECTOR).toContain('getTime() <= Date.now()');
  });

  test('AC4-4: 부모(SendSmsDialog) 가 과거시각이면 발송 차단', () => {
    expect(SMS_DLG).toContain('scheduledInvalid');
    expect(SMS_DLG).toContain('validateScheduled(sendMethod.localValue)');
  });
});
