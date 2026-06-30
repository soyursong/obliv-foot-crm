/**
 * T-20260630-foot-TESTDATA-PURGE — 2차 pass DELETE 실행 (★GATED★)
 *
 * 거버넌스 승인: 문지은 대표원장 A안 승인(2026-06-30 15:09) — 서류잠금 2건
 * 불변성 트리거 우회 강제삭제 명시 허용. governance_pending 해소.
 *
 * 대상(2건만): F-4323('서류테스트') / F-4352('단계이동_1782325833451')
 *   1차 449 삭제 시 preserve 30 중 거버넌스 유예된 2건. 삭제 후 최종 잔존 = 28(실고객).
 *
 * 트리거 우회 범위 한정:
 *   - trg_form_submissions_published_immutable (BEFORE DELETE OR UPDATE) 만 DISABLE.
 *   - 단일 원자 트랜잭션(BEGIN..COMMIT) 내에서만. 삭제 직후 즉시 ENABLE 원복.
 *   - 전역/세션 영구 비활성 아님. ROLLBACK 시에도 DDL 트랜잭셔널로 자동 원복.
 *   - DELETE 는 _del_cust(F-4323/F-4352 cascade)로만 스코프 → 타 published 의무기록 무영향.
 *
 * 가드(오삭 방지, 트랜잭션 내부):
 *   - _del_cust 행수 == 2 아니면 RAISE EXCEPTION → 전량 ROLLBACK.
 *   - chart_number ∈ {F-4323,F-4352} 아닌 행 포함 시 RAISE.
 *   - name 이 테스트패턴('서류테스트' | '단계이동_%') 불일치 시 RAISE.
 *
 * CONFIRM_GO=YES 없으면 dry-run(ROLLBACK)만. =YES 면 COMMIT(실삭제).
 * 실행: Supabase Management API (/database/query) 단일 multi-statement 트랜잭션.
 */
const PROJ_REF='rxlomoozakkjesdqjtvd';
const TOKEN=process.env.SUPABASE_ACCESS_TOKEN||(()=>{throw new Error('SUPABASE_ACCESS_TOKEN env required')})();
const GO = process.env.CONFIRM_GO === 'YES';
async function sql(q){const r=await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify({query:q})});const b=await r.json();if(!r.ok){console.error('SQL ERR',r.status,JSON.stringify(b).slice(0,800));throw new Error('SQL failed');}return b;}

// 2차 pass 최종 보존 = 28 (실고객 26 + 김민경 F-0177 + 정명희 F-4270). F-4323/F-4352 는 보존목록에서 제외 → 삭제대상.
const PRESERVE=['F-1190','F-0155','F-0156','F-0154','F-0187','F-0158','F-0157','F-0455','F-1089','F-0896','F-0521','F-1236','F-1237','F-3904','F-4067','F-4271','F-4272','F-4273','F-4310','F-4328','F-4343','F-4344','F-4365','F-4391','F-4380','F-4421','F-0177','F-4270'];
const inList=PRESERVE.map(c=>`'${c}'`).join(',');
const L=s=>console.log(s);

L('━'.repeat(60));
L(`TESTDATA-PURGE 2차 pass DELETE  ${GO?'★ LIVE (COMMIT) ★':'DRY-RUN (ROLLBACK)'}  ${new Date().toISOString()}`);
L(`대상: F-4323(서류테스트) / F-4352(단계이동_…)  보존=${PRESERVE.length}`);
L('━'.repeat(60));

const DEL = `
BEGIN;

CREATE TEMP TABLE _del_cust ON COMMIT DROP AS
  SELECT id, chart_number, name FROM public.customers WHERE chart_number IS NULL OR chart_number NOT IN (${inList});

-- ★ 오삭 방지 가드 (트랜잭션 내부) ★
DO $$
DECLARE n int; bad int;
BEGIN
  SELECT COUNT(*) INTO n FROM _del_cust;
  IF n <> 2 THEN RAISE EXCEPTION '2차 삭제대상 수 이상: 기대 2, 실제 % — 중단', n; END IF;
  SELECT COUNT(*) INTO bad FROM _del_cust WHERE chart_number NOT IN ('F-4323','F-4352');
  IF bad <> 0 THEN RAISE EXCEPTION '삭제대상에 예상외 chart % 건 포함 — 중단', bad; END IF;
  SELECT COUNT(*) INTO bad FROM _del_cust WHERE NOT (name = '서류테스트' OR name LIKE '단계이동\\_%');
  IF bad <> 0 THEN RAISE EXCEPTION '삭제대상 이름 테스트패턴 불일치 % 건 — 중단', bad; END IF;
  RAISE NOTICE '가드 통과: 삭제대상 2건 (F-4323/F-4352) 신원 확인';
END $$;

-- ★ 트리거 우회: 의무기록 불변성 가드 일시 DISABLE (이 트랜잭션 한정) ★
ALTER TABLE public.form_submissions DISABLE TRIGGER trg_form_submissions_published_immutable;

-- ===== 자식→부모 역위상 cascade hard-delete (pass1 과 동일 경로) =====
DELETE FROM public.payment_reconciliation_log WHERE payment_id IN (SELECT id FROM public.payments WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.claim_diagnoses WHERE payment_id IN (SELECT id FROM public.payments WHERE customer_id IN (SELECT id FROM _del_cust))
   OR package_payment_id IN (SELECT id FROM public.package_payments WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.check_in_services WHERE check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust))
   OR package_session_id IN (SELECT ps.id FROM public.package_sessions ps JOIN public.packages p ON p.id=ps.package_id WHERE p.customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.assignment_actions   WHERE check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.check_in_room_logs   WHERE check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.status_transitions   WHERE check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.timer_records         WHERE check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.payment_audit_logs    WHERE check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.payment_code_claims   WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.insurance_receipts    WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.receipt_ocr_results   WHERE check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.notifications         WHERE check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.payments              WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.service_charges       WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.prescription_items    WHERE prescription_id IN (SELECT id FROM public.prescriptions WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.prescriptions         WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.insurance_claim_diagnoses WHERE claim_id IN (SELECT id FROM public.insurance_claims WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.claim_items           WHERE claim_id IN (SELECT id FROM public.insurance_claims WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.edi_submissions       WHERE claim_id IN (SELECT id FROM public.insurance_claims WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.insurance_claims      WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.insurance_documents   WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.form_submissions      WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.consent_forms         WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.checklists            WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.clinical_images       WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.health_q_results      WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust))
   OR token_id IN (SELECT id FROM public.health_q_tokens WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.health_q_tokens       WHERE customer_id IN (SELECT id FROM _del_cust)
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.package_sessions      WHERE package_id IN (SELECT id FROM public.packages WHERE customer_id IN (SELECT id FROM _del_cust))
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.package_payments      WHERE customer_id IN (SELECT id FROM _del_cust)
   OR package_id IN (SELECT id FROM public.packages WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.reservation_logs        WHERE reservation_id IN (SELECT id FROM public.reservations WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.reservation_memo_history WHERE customer_id IN (SELECT id FROM _del_cust)
   OR reservation_id IN (SELECT id FROM public.reservations WHERE customer_id IN (SELECT id FROM _del_cust))
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.check_ins             WHERE customer_id IN (SELECT id FROM _del_cust)
   OR reservation_id IN (SELECT id FROM public.reservations WHERE customer_id IN (SELECT id FROM _del_cust))
   OR package_id IN (SELECT id FROM public.packages WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.packages              WHERE customer_id IN (SELECT id FROM _del_cust)
   OR transferred_to IN (SELECT id FROM _del_cust);
DELETE FROM public.reservations          WHERE customer_id IN (SELECT id FROM _del_cust);
DELETE FROM public.notification_logs       WHERE customer_id IN (SELECT id FROM _del_cust);
DELETE FROM public.notification_opt_outs   WHERE customer_id IN (SELECT id FROM _del_cust);
DELETE FROM public.message_logs            WHERE customer_id IN (SELECT id FROM _del_cust);
DELETE FROM public.patient_file_records    WHERE customer_id IN (SELECT id FROM _del_cust);
DELETE FROM public.patient_past_history    WHERE customer_id IN (SELECT id FROM _del_cust);
DELETE FROM public.patient_room_daily_log  WHERE patient_id IN (SELECT id FROM _del_cust);
DELETE FROM public.customer_consult_memos     WHERE customer_id IN (SELECT id FROM _del_cust);
DELETE FROM public.customer_reservation_memos WHERE customer_id IN (SELECT id FROM _del_cust);
DELETE FROM public.customer_special_notes     WHERE customer_id IN (SELECT id FROM _del_cust);
DELETE FROM public.customer_treatment_memos   WHERE customer_id IN (SELECT id FROM _del_cust);
UPDATE public.customers SET referrer_id=NULL WHERE referrer_id IN (SELECT id FROM _del_cust) AND id NOT IN (SELECT id FROM _del_cust);
DELETE FROM public.customers WHERE id IN (SELECT id FROM _del_cust);

-- ★ 트리거 즉시 원복 (COMMIT 이전) — 원래 상태 'O'(default origin) ★
ALTER TABLE public.form_submissions ENABLE TRIGGER trg_form_submissions_published_immutable;

SELECT (SELECT COUNT(*)::int FROM public.customers) AS customers_remaining,
       (SELECT COUNT(*)::int FROM public.customers WHERE chart_number IN (${inList})) AS preserve_remaining,
       (SELECT COUNT(*)::int FROM public.customers WHERE chart_number IN ('F-4323','F-4352')) AS target_remaining,
       (SELECT t.tgenabled FROM pg_trigger t WHERE t.tgname='trg_form_submissions_published_immutable') AS trg_state;

${GO ? 'COMMIT;' : 'ROLLBACK;'}
`;

const res = await sql(DEL);
L(`결과: ${JSON.stringify(res)}`);
L(GO ? '✅ COMMIT 완료 — 2건 실삭제됨, 트리거 원복(O)' : '🟡 ROLLBACK — dry-run(실삭제 0). GO 시 CONFIRM_GO=YES 로 재실행.');
L('PASS2_DELETE_SCRIPT_DONE');
