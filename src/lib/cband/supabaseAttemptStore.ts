/**
 * cband/supabaseAttemptStore.ts — payment_attempts / payments 채널확장 실 저장소 (★DDL 게이트)
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD (플랜A · 실 DB store)
 *
 * paymentFlow.ts 의 AttemptStore 인터페이스를 supabase 로 구현한다.
 *
 * ── ★ DDL 게이트 (data policy §S2.4) — 아래 스키마는 data-architect CONSULT-REPLY GO 후 확정 ──
 *   본 파일은 예상 스키마(ADDITIVE)로 선구현되어 있으며, DA 확정·마이그레이션 적용 전까지는
 *   기능플래그(VITE_CBAND_PAY)가 OFF 여서 런타임에 도달하지 않는다(프로덕션 무접점).
 *   DA CONSULT-REPLY 로 컬럼명/타입 확정 시 본 파일만 맞추면 됨(상위 흐름 무변경).
 *
 *   payment_attempts (신규, insert-first 시도레코드 — 이중결제 방지 D 근거):
 *     id uuid pk / clinic_id / customer_id / check_in_id / msg_trace text UNIQUE(12자리) /
 *     tran_type text('0210'|'0430') / amount int / merno text / tid text /
 *     original_auth_no text null / status text('requested'|'approved'|'failed'|'attention') /
 *     auth_no text null / response_code text null / created_at / updated_at.
 *     ▸ msg_trace UNIQUE = 교차세션 유일성(응답 유실 시 단말 승인내역조회 유일 키) + 멱등.
 *     ▸ 동시성 잠금(티켓 §7-4): (clinic_id) 부분 유니크/advisory lock 은 DA 확정에 따름.
 *
 *   payments (기존, 채널 ADDITIVE 확장 — REDPAY 선례 pg_provider 계승):
 *     pg_provider text null 에 'cband' 추가(레드페이 external/manual 과 병존, 채널 충돌 없음) /
 *     auth_no / msg_trace / merno / tran_type 채널메타 컬럼(ADDITIVE).
 */

import { supabase } from '@/lib/supabase';
import type { AttemptRecord, AttemptStore } from './paymentFlow';
import { TRANTYPE_CANCEL } from './protocol';

/** 코밴 결제 채널 식별자(payments.pg_provider). REDPAY(external/manual)와 병존하는 신규 채널. */
export const CBAND_PG_PROVIDER = 'cband' as const;

export const supabaseAttemptStore: AttemptStore = {
  async insertAttempt(rec: AttemptRecord): Promise<void> {
    // ★insert-first: 송신 전 저장. msg_trace UNIQUE 위반(중복) 시 error → 상위가 송신 중단.
    const { error } = await supabase.from('payment_attempts').insert({
      clinic_id: rec.clinicId,
      customer_id: rec.customerId,
      check_in_id: rec.checkInId,
      msg_trace: rec.msgTrace,
      tran_type: rec.tranType,
      amount: rec.amount,
      merno: rec.merno,
      tid: rec.tid,
      original_auth_no: rec.originalAuthNo,
      status: 'requested',
    });
    if (error) throw new Error(`결제 시도 기록 실패(insert-first): ${error.message}`);
  },

  async updateAttempt(msgTrace: string, patch: Partial<AttemptRecord>): Promise<void> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.authNo !== undefined) row.auth_no = patch.authNo;
    if (patch.responseCode !== undefined) row.response_code = patch.responseCode;
    const { error } = await supabase.from('payment_attempts').update(row).eq('msg_trace', msgTrace);
    if (error) {
      // 상태 갱신 실패는 결제 성립을 되돌리지 않는다(insert-first 레코드가 이미 추적 근거). 로그만.
      console.error(`결제 시도 상태 갱신 실패(msg_trace=${msgTrace}):`, error.message);
    }
  },

  async recordCardPayment(rec: AttemptRecord & { authNo: string }): Promise<void> {
    const isCancel = rec.tranType === TRANTYPE_CANCEL;
    // 취소 성공 = 수납취소(payment_type='refund', 음수 아님 — payment_type 으로 구분, 기존 규약 계승).
    const { error } = await supabase.from('payments').insert({
      clinic_id: rec.clinicId,
      check_in_id: rec.checkInId,
      customer_id: rec.customerId,
      amount: rec.amount,
      method: 'card',
      installment: 0,
      payment_type: isCancel ? 'refund' : 'payment',
      pg_provider: CBAND_PG_PROVIDER,   // 채널 식별(ADDITIVE, REDPAY 병존)
      auth_no: rec.authNo,
      msg_trace: rec.msgTrace,
      merno: rec.merno,
      tran_type: rec.tranType,
      memo: isCancel ? '코밴 단말 결제취소' : '코밴 단말 카드결제',
    });
    if (error) throw new Error(`수납 기록 실패: ${error.message}`);
  },
};
