/**
 * T-20260721-foot-TEST-DUMMY-CLEANUP — FREEZE SET (§4-B apply keying)
 *
 * PK-FIXED freeze — 단일 권위 = commit 15c3adfe
 *   (db-gate/census-dummy-cleanup/freeze_snapshot.sql, Phase-1 census).
 * 실행은 이 고정 PK 에만 keyed. **LIKE 재스캔으로 대상을 새로 뽑지 않는다.**
 * 이름/phone 술어는 selection 근거가 아니라 self-test(독립 재판정) 근거로만 사용(§4-B ②).
 *
 * DA 4차 CONSULT-REPLY (MSG-20260721-163320-szw3, in_reply_to pi9j): Q1·Q2·Q3 전부 GO.
 *   ★ net-loss SSOT = **30 확정** (기존 9c+6ci+7st=22 → +7 assignment_actions +1 check_in_room_logs).
 *   POSTCHECK 하드 요구: 순소실 == **정확히 30** (≠30 이면 fail-closed 양방[under/over] catch).
 *   근거: full-FK §2-0 census 실측(ac2_fullfk_census_ABORT.md) — DELETE FROM check_ins 시
 *   assignment_actions(7)·check_in_room_logs(1) 가 CASCADE 동반삭제(조용한 순소실 유발자).
 *   → 8행을 freeze 셋에 PK-고정 편입 + off-git cascade-collateral 스냅샷 = no-snapshot-no-delete 재충족.
 *
 * DA 3차 VERIFY (MSG-20260721-150028-4ug6): C2 CLEAR CONFIRMED(미귀속=0). §4-B 경량 apply GREENLIT.
 */

// FREEZE: customers (9)  — id | name(내장 ms) | chart_no
export const FREEZE_CUSTOMERS = [
  'd7be9306-524b-4d40-8e25-a455a632bbf8', // 단계이동_1783967359323  F-4710
  '44f4f14c-be85-4ef3-bc93-56a883447b67', // 단계이동_1784051960090  F-4765
  'b23a2267-1aff-438a-bf7d-f87838a4e870', // 단계이동_1784138614576  F-4800
  '7c385221-0a48-41be-bd2e-dadb5eedec54', // 단계이동_1784224882250  F-4835
  '47be6e07-25fc-476a-a561-acba2ee6e3c1', // 단계이동_1784311192303  F-4867
  'ac0748ea-8c2f-400f-98cd-9436d3f76e3e', // 단계이동_1784483430874  F-4890
  '64b2f7f0-0140-4bb8-ba9c-918d87a0f538', // 단계이동_1784573543898  F-4932
  'a24f706c-c06e-4668-b259-d4d53c56d13f', // 단계이동_1784573557930  F-4933 (orphan)
  '641637ff-a07e-4001-ae35-a5a3255f7319', // 단계이동_1784573572353  F-4934 (orphan)
];

// FREEZE: check_ins (6) — all customer_id ∈ FREEZE_CUSTOMERS
export const FREEZE_CHECKINS = [
  'cc1842dc-0ebd-4a7b-9359-ea25f139f453', // cust d7be9306
  'bf2b0e94-e855-4c32-bc2d-bf73d78eb676', // cust 44f4f14c
  'dfae725c-7a6b-4409-95c6-bcf4e81e5e41', // cust 7c385221
  '0bbbd3b3-0c3d-45b2-afcb-1b5979f3275a', // cust 47be6e07
  '39e297aa-8fc3-430f-9131-493a0098df4b', // cust ac0748ea
  '14c29c0c-c2fa-4d73-9a9a-e63551f67be9', // cust 64b2f7f0
];

// FREEZE: assignment_actions (7) — CASCADE 자식, all check_in_id ∈ FREEZE_CHECKINS
//   PK-고정 편입 (DA 4차 net-loss 30). off-git snapshot_cascade_collateral_2026-07-21.json 계승.
export const FREEZE_ASSIGNMENT_ACTIONS = [
  'fd4867b7-509c-4782-9484-43248ad5de00', // ci cc1842dc  auto_assign
  '76e1067e-5333-4c81-8804-62e6e0533a6b', // ci cc1842dc  manual
  '943c7693-3cc5-4791-8dd8-96c849478ada', // ci bf2b0e94  auto_assign
  'e6aa2210-77fb-4576-8a13-0313b16cbde3', // ci dfae725c  auto_assign
  'b8268ccc-0647-4228-bdfb-9b2413e0d61e', // ci 0bbbd3b3  auto_assign
  'a5565c5c-c4cb-4935-bf4e-0b0538c9599c', // ci 39e297aa  auto_assign
  '93958c42-bcd3-4a4c-b6d3-c1dd6e28fcef', // ci 14c29c0c  auto_assign
];

// FREEZE: check_in_room_logs (1) — CASCADE 자식, check_in_id ∈ FREEZE_CHECKINS
export const FREEZE_CHECKIN_ROOM_LOGS = [
  '2fb4017f-7be9-4333-aa5b-ae44934c7d8d', // ci cc1842dc  room=C1
];

// POSTCHECK 하드 기대 순소실 (PK-fixed, DA 4차 net-loss=30 SSOT)
export const EXPECT = {
  customers: 9,
  check_ins: 6,
  status_transitions: 7,   // CASCADE (check_in_id ∈ FREEZE_CHECKINS)
  assignment_actions: 7,   // CASCADE (check_in_id ∈ FREEZE_CHECKINS) — DA 4차 편입
  check_in_room_logs: 1,   // CASCADE (check_in_id ∈ FREEZE_CHECKINS) — DA 4차 편입
  net_loss_total: 30,      // 9 + 6 + 7 + 7 + 1 — POSTCHECK 정확히 30 (≠30 fail-closed)
  // 아래 자식은 전부 0 이어야 apply 발동 (0 아니면 ABORT → §1 heavy 회부).
  // NOTE: assignment_actions·check_in_room_logs 는 이제 CASCADE collateral 로 편입되어 zero_children 에서 제외.
  zero_children: [
    'payments',
    'service_charges',
    'package_payments',
    'insurance_claims',
    'form_submissions',
    'medical_charts',
    'reservations',
  ],
};

// self-test(독립 재판정) 술어 — 픽스처 이름 접두 (selection 아님, 검증 전용)
export const DUMMY_NAME_PREFIXES = ['단계이동_', '칸반테스트_', 'cf1-new-'];

// prod pre-sweep 하드 precondition (AC-1 afterAll cleanup + AC-3 운영도메인 차단가드 착지)
export const PRESWEEP_COMMIT = '453e8475';

export const FREEZE_SOURCE_COMMIT = '15c3adfe';
export const TICKET = 'T-20260721-foot-TEST-DUMMY-CLEANUP';
export const OFFGIT_SNAPSHOT_DIR =
  'foot-test-dummy-cleanup-20260721'; // under ~/.config/medibuilder-secrets/backfill-snapshots/
// off-git CASCADE-collateral 스냅샷 (assignment_actions 7 + check_in_room_logs 1) — DA 4차 no-snapshot-no-delete 재충족
export const CASCADE_COLLATERAL_SNAPSHOT = 'snapshot_cascade_collateral_2026-07-21.json';

// §2-3 abort-if-grown (DA 4차 Q2 하드조건): DELETE 직전 frozen 6 check_ins 의 CASCADE 자식 집합이
// 아래 서명과 정확히 일치해야 apply 진행. 야간 Daily Build E2E cron 이 여전히 라이브(근본원인 미해소)
// → frozen check_in 에 신규 aa 부착 or 신규 grandchild 생성 시 서명 불일치 → ABORT·재adjudication.
export const CASCADE_CHILD_SIGNATURE = {
  status_transitions: 7,
  assignment_actions: 7,
  check_in_room_logs: 1,
};
