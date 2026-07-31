/**
 * cband/supabaseAttemptStore.ts — cband_payment_attempts / payments 채널쓰기 실 저장소
 * ════════════════════════════════════════════════════════════════════════════
 * T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD (플랜A · 실 DB store)
 *   SSOT = memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_cband_cat_direct_pay_plana_20260731.md
 *   verdict = GO_ADDITIVE_WITH_CONDITIONS (DA-20260731-FOOT-CBAND-CAT-DIRECT-PAY-PLANA)
 *
 * paymentFlow.ts 의 AttemptStore 인터페이스를 supabase 로 구현한다.
 *
 * ── ★ DA 확정 반영 (C1/C4/C5/C6) ────────────────────────────────────────────
 *   C1 채널식별 = **pos_provider='cband'**(pg_provider 아님 — foot payments 에 pg_provider 컬럼 부재!) +
 *      **pos_transaction_id=AUTHNO**(둘 다 旣존재, mig 20260703183000 = §10-3a canonical, 채널라벨 DDL 0).
 *      ★external_trxid 는 절대 write 금지(RedPay 매칭 예약키 — Coban 이 채우면 reconcile 오링크).
 *   C4 멱등 = insert-first(cband_payment_attempts) UNIQUE(clinic_id,msg_trace) collide → throw → 송신 중단.
 *      payments INSERT·attempt UPDATE 는 **rows-affected assert**(cross_crm_write_rowcheck_standard INV-W2/W5:
 *      .select() 로 RETURNING → 0-row+error=null 을 silent write-failure 로 승격). 승인 성공 시 payment_id 링크(원자성).
 *   C5 취소(0430) = foot 기존 refund 경로 계승(payment_type='refund', method='card', pos_provider='cband',
 *      원거래 링크=auth_no 참조). 신규 refund 모델 발명 금지.
 *   C6 테스트금액(1001~1006) = is_simulation=true(attempt·payments 패리티, 매출/감사 제외).
 *
 * ── ★ DDL 게이트 (data policy §S2.4) ─────────────────────────────────────────
 *   cband_payment_attempts = 신규 테이블(mig 20260731190000, ADDITIVE). payments 는 무접촉(pos_* 旣존재).
 *   기능플래그(VITE_CBAND_PAY) OFF 로 격리 → DDL 적용·MIG-GATE 통과 전 런타임 미도달(프로덕션 무접점).
 */

import { supabase } from '@/lib/supabase';
import type { AttemptRecord, AttemptStore } from './paymentFlow';
import { TRANTYPE_CANCEL } from './protocol';

/** 코밴 결제 채널 식별자(payments.pos_provider). ★pg_provider 아님(foot payments 에 부재). §10-3a canonical, C2 술어가 verbatim 소비. */
export const CBAND_POS_PROVIDER = 'cband' as const;

export const supabaseAttemptStore: AttemptStore = {
  async insertAttempt(rec: AttemptRecord): Promise<void> {
    // ★insert-first: 송신 전 저장. UNIQUE(clinic_id,msg_trace) 위반(중복) 시 error → 상위가 송신 중단(멱등 L1).
    //   C4: .select('id') 로 RETURNING → 0-row+error=null(RLS 거부 등) 도 silent write-failure 로 승격.
    //   취소(0430)는 원거래 AUTHNO 를 auth_no 로 insert-time 저장(실측#2: 취소 AUTHNO=원거래 동일, tran_type 으로만 구분).
    const isCancel = rec.tranType === TRANTYPE_CANCEL;
    const { data, error } = await supabase
      .from('cband_payment_attempts')
      .insert({
        clinic_id: rec.clinicId,
        check_in_id: rec.checkInId,
        customer_id: rec.customerId,
        msg_trace: rec.msgTrace,
        merno: rec.merno,
        tran_type: rec.tranType,
        cat_tid: rec.tid,
        requested_amount: rec.amount,
        status: 'requested',
        auth_no: isCancel ? rec.originalAuthNo : null,
        is_simulation: rec.isSimulation,
      })
      .select('id');
    if (error) throw new Error(`결제 시도 기록 실패(insert-first): ${error.message}`);
    if (!data || data.length === 0) {
      // 0-row + error=null = RLS 거부/스코프 불일치(INV-W2). 추적 불가 상태로 과금 금지 → 송신 중단.
      throw new Error('결제 시도 기록 실패(insert-first): 0행 반영(권한/스코프 확인 필요).');
    }
  },

  async updateAttempt(msgTrace: string, patch: Partial<AttemptRecord>): Promise<void> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.authNo !== undefined) row.auth_no = patch.authNo;
    if (patch.responseCode !== undefined) row.response_code = patch.responseCode;
    const { error } = await supabase
      .from('cband_payment_attempts')
      .update(row)
      .eq('msg_trace', msgTrace);
    if (error) {
      // 상태 갱신 실패는 결제 성립을 되돌리지 않는다(insert-first 레코드가 이미 추적 근거). 로그만.
      console.error(`결제 시도 상태 갱신 실패(msg_trace=${msgTrace}):`, error.message);
    }
  },

  async recordCardPayment(rec: AttemptRecord & { authNo: string }): Promise<void> {
    const isCancel = rec.tranType === TRANTYPE_CANCEL;
    // C5 취소 성공 = 수납취소(payment_type='refund', 기존 규약 계승 — 신규 refund 모델 발명 금지).
    //   C1: 채널=pos_provider='cband', 거래식별자=pos_transaction_id=AUTHNO(둘 다 旣존재 컬럼).
    //     ★DA reconciliation(MSG-20260731-230159-7gnu, 23:01) 정본 착지 = AUTHNO→pos_transaction_id ·
    //       채널→pos_provider='cband' · TID→attempt.cat_tid(pos 계열). external_*(trxid/approval_no/tid)는
    //       RedPay 전용 홈 — Coban write 절대 금지(C2 방화벽 구조보호).
    //   ★BINDING#3 paid_at=승인시각(TRANDATE/TRANTIME): payments 는 별도 paid_at 컬럼 없이 created_at 을
    //     결제시각 권위로 사용(outbox trigger MIN(created_at)). 승인시각을 created_at 로 착지시킬지/paid_at
    //     신규 컬럼을 둘지는 payments 필드매핑 = DA delta 확정 + MIG-GATE 까지 held(현재 default now() 잠정).
    //   C4: .select('id') 로 rows-affected assert(silent write-failure 금지).
    const { data, error } = await supabase
      .from('payments')
      .insert({
        clinic_id: rec.clinicId,
        check_in_id: rec.checkInId,
        customer_id: rec.customerId,
        amount: rec.amount,
        method: 'card',
        installment: 0,
        payment_type: isCancel ? 'refund' : 'payment',
        pos_provider: CBAND_POS_PROVIDER,   // ★C1 채널 식별(旣존재 컬럼, no-DDL). REDPAY(pos_provider NULL)와 병존.
        pos_transaction_id: rec.authNo,      // ★C1 AUTHNO canonical home(旣존재 컬럼).
        is_simulation: rec.isSimulation,     // ★C6 테스트금액 격리(payments 패리티).
        memo: isCancel ? '코밴 단말 결제취소' : '코밴 단말 카드결제',
      })
      .select('id');
    if (error) throw new Error(`수납 기록 실패: ${error.message}`);
    const paymentId = data?.[0]?.id as string | undefined;
    if (!paymentId) {
      // 0-row + error=null = RLS 거부/스코프 불일치(INV-W5). 수납 미영속인데 성공 오인 금지.
      throw new Error('수납 기록 실패: 0행 반영(권한/스코프 확인 필요).');
    }
    // ★승인 성공 → attempt.payment_id 링크(C4 동일 흐름 원자성). 링크 실패는 수납 성립을 되돌리지 않음(로그만).
    const { error: linkErr } = await supabase
      .from('cband_payment_attempts')
      .update({ payment_id: paymentId, updated_at: new Date().toISOString() })
      .eq('clinic_id', rec.clinicId)
      .eq('msg_trace', rec.msgTrace);
    if (linkErr) {
      console.error(`수납-시도 링크 실패(msg_trace=${rec.msgTrace}, payment_id=${paymentId}):`, linkErr.message);
    }
  },
};
