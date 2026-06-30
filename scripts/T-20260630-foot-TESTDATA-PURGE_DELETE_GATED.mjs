/**
 * T-20260630-foot-TESTDATA-PURGE — DELETE 실행 (★GATED★)
 *
 * ⚠ 비가역 cascade hard-delete. 현장 최종 GO 수신 후에만 실행.
 * 가드: env CONFIRM_GO=YES 없으면 dry-run(트랜잭션 ROLLBACK)만 수행하고 종료.
 *   - CONFIRM_GO 미설정 → BEGIN ... (deletes) ... ROLLBACK : 행수만 집계, 실삭제 0.
 *   - CONFIRM_GO=YES    → BEGIN ... (deletes) ... COMMIT   : 실삭제.
 *
 * 선행 완료 필수: AC1 PASS, AC2 백업(~/foot-purge-backup-*) 무결성 PASS.
 *
 * 삭제 범위: 보존 30 chart_number 제외 전체 customers(449) + 폐포 자식 전이 삭제.
 * (1차 pass: 보존 28 실고객 + 거버넌스 유예 2 = 30, 삭제대상 449. published 의무기록 0건.)
 * 순서: 폐포 의존(자식→부모) 역위상. 단일 트랜잭션 → 실패 시 전량 롤백(원자성).
 * 실행: Supabase Management API (/database/query) 단일 multi-statement 트랜잭션.
 */
const PROJ_REF='rxlomoozakkjesdqjtvd';
const TOKEN=process.env.SUPABASE_ACCESS_TOKEN||(()=>{throw new Error('SUPABASE_ACCESS_TOKEN env required')})();
const GO = process.env.CONFIRM_GO === 'YES';
async function sql(q){const r=await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${TOKEN}`},body:JSON.stringify({query:q})});const b=await r.json();if(!r.ok){console.error('SQL ERR',r.status,JSON.stringify(b).slice(0,500));throw new Error('SQL failed');}return b;}

// 1차 pass preserve = 30 (보존 28: 실고객 26 + 김민경 F-0177·정명희 F-4270 / 거버넌스 유예 2: F-4323·F-4352 트리거우회 미승인 → 2차로 이연). 30 제외 = 삭제대상 449.
const PRESERVE=['F-1190','F-0155','F-0156','F-0154','F-0187','F-0158','F-0157','F-0455','F-1089','F-0896','F-0521','F-1236','F-1237','F-3904','F-4067','F-4271','F-4272','F-4273','F-4310','F-4328','F-4343','F-4344','F-4365','F-4391','F-4380','F-4421','F-0177','F-4270','F-4323','F-4352'];
const inList=PRESERVE.map(c=>`'${c}'`).join(',');
const L=s=>console.log(s);

L('━'.repeat(60));
L(`T-20260630-foot-TESTDATA-PURGE DELETE  ${GO?'★ LIVE (COMMIT) ★':'DRY-RUN (ROLLBACK)'}  ${new Date().toISOString()}`);
L('━'.repeat(60));

// del-target 고객 id 임시집합 + 자식 삭제(자식→부모) + customers. 단일 트랜잭션.
// 각 테이블은 customer 소유 경로로 스코프(보존26 고객 행은 절대 미삭제).
const DEL = `
BEGIN;

CREATE TEMP TABLE _del_cust ON COMMIT DROP AS
  SELECT id FROM public.customers WHERE chart_number IS NULL OR chart_number NOT IN (${inList});

-- L4 결제/청구 말단
DELETE FROM public.payment_reconciliation_log WHERE payment_id IN (SELECT id FROM public.payments WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.claim_diagnoses WHERE payment_id IN (SELECT id FROM public.payments WHERE customer_id IN (SELECT id FROM _del_cust))
   OR package_payment_id IN (SELECT id FROM public.package_payments WHERE customer_id IN (SELECT id FROM _del_cust));

-- check_ins 자식(서비스/로그/타이머/배정/감사)
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

-- 결제/처방/문서/설문 (check_ins 보다 먼저: payments.check_in_id 등 NO ACTION)
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

-- 패키지 회차/결제 (packages 보다 먼저)
DELETE FROM public.package_sessions      WHERE package_id IN (SELECT id FROM public.packages WHERE customer_id IN (SELECT id FROM _del_cust))
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.package_payments      WHERE customer_id IN (SELECT id FROM _del_cust)
   OR package_id IN (SELECT id FROM public.packages WHERE customer_id IN (SELECT id FROM _del_cust));

-- 예약 로그/메모 (reservations·check_ins 보다 먼저)
DELETE FROM public.reservation_logs        WHERE reservation_id IN (SELECT id FROM public.reservations WHERE customer_id IN (SELECT id FROM _del_cust));
DELETE FROM public.reservation_memo_history WHERE customer_id IN (SELECT id FROM _del_cust)
   OR reservation_id IN (SELECT id FROM public.reservations WHERE customer_id IN (SELECT id FROM _del_cust))
   OR check_in_id IN (SELECT id FROM public.check_ins WHERE customer_id IN (SELECT id FROM _del_cust));

-- check_ins (자식 전부 제거 후) → packages/reservations 보다 먼저 (check_ins.package_id/reservation_id NO ACTION)
DELETE FROM public.check_ins             WHERE customer_id IN (SELECT id FROM _del_cust)
   OR reservation_id IN (SELECT id FROM public.reservations WHERE customer_id IN (SELECT id FROM _del_cust))
   OR package_id IN (SELECT id FROM public.packages WHERE customer_id IN (SELECT id FROM _del_cust));

-- packages / reservations
DELETE FROM public.packages              WHERE customer_id IN (SELECT id FROM _del_cust)
   OR transferred_to IN (SELECT id FROM _del_cust);
DELETE FROM public.reservations          WHERE customer_id IN (SELECT id FROM _del_cust);

-- 고객 직접 자식(나머지)
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

-- 보존고객이 삭제대상을 추천인으로 참조 시 끊기 (referrer_id SET NULL 자동이지만 명시)
UPDATE public.customers SET referrer_id=NULL WHERE referrer_id IN (SELECT id FROM _del_cust) AND id NOT IN (SELECT id FROM _del_cust);

-- 루트
DELETE FROM public.customers WHERE id IN (SELECT id FROM _del_cust);

SELECT (SELECT COUNT(*)::int FROM public.customers) AS customers_remaining,
       (SELECT COUNT(*)::int FROM public.customers WHERE chart_number IN (${inList})) AS preserve_remaining;

${GO ? 'COMMIT;' : 'ROLLBACK;'}
`;

const res = await sql(DEL);
// management API: multi-statement → 마지막 SELECT 결과 반환
L(`결과: ${JSON.stringify(res)}`);
L(GO ? '✅ COMMIT 완료 — 실삭제됨' : '🟡 ROLLBACK — dry-run(실삭제 0). GO 시 CONFIRM_GO=YES 로 재실행.');
L('DELETE_SCRIPT_DONE');
