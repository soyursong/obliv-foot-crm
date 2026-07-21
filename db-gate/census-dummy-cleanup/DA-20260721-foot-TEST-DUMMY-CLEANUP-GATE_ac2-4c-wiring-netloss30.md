# Foot TEST-DUMMY-CLEANUP — AC-2 러너 wiring 갱신 (DA 4차 GO / net-loss=30 / READ-ONLY prep)

Ticket: T-20260721-foot-TEST-DUMMY-CLEANUP (AC-2, db_change) · Branch: `db-gate/T-20260721-foot-TEST-DUMMY-CLEANUP-C2-CLEAR`
Trigger: planner NEW-TASK MSG-20260721-163800-lf1m ← DA 4차 CONSULT-REPLY **MSG-20260721-163320-szw3** (in_reply_to pi9j): Q1·Q2·Q3 전부 **GO**, net-loss SSOT **30 확정**.
Author: dev-foot · 2026-07-21 KST · **READ-ONLY prep (실 DELETE·--apply·prod 변경 없음).**

---

## 요약
DA 4차 GO 수신 → AC-2 러너를 net-loss=30 SSOT + 3종 하드조건으로 갱신. **prod 무접촉.** blocked/human_pending 유지 — apply 게이트 체인 (a)본 wiring →(b)credential 프로비저닝 →(c)supervisor DB-GATE dry-run 무영속 →(d)형 apply_gate → apply 불변. DELETE 는 (b)(c)(d) 통과 후에만.

## 갱신 요구 3종 (DA 하드조건) — 배선 결과

### ① freeze셋 30행 편입 (PK-고정)
- `_freeze.mjs`: `FREEZE_ASSIGNMENT_ACTIONS`(7 PK) + `FREEZE_CHECKIN_ROOM_LOGS`(1 PK) 추가 — off-git `snapshot_cascade_collateral_2026-07-21.json` 에서 PK 고정 계승.
- `EXPECT` 확장: `assignment_actions:7, check_in_room_logs:1, net_loss_total:30`. (기존 9c+6ci+7st=22 → +8 = 30)
- no-snapshot-no-delete: apply 러너 ① precondition 이 이제 전-컬럼 스냅샷(9/6/7) **+** cascade-collateral 스냅샷(7aa/1crl) 존재·카운트 이중 대조. preflight 도 cascade-collateral 스냅샷 재기록.

### ② fixpoint 전이-closure evidence emission (SOP §2-0, 손열거 BAN)
- 신규 공유 모듈 `_census_lib.mjs`: `buildFixpointClosureSql()` — customers/check_ins seed 로 pg_constraint inbound FK edge 를 기계열거, CASCADE(c) row 를 closure 에 편입해 **손자까지 fixpoint 재귀 walk**. edge별 confdeltype 분류 emit.
- 3항 증명(`adjudicateFixpoint`):
  - **(a)** NEW row 보유 자식 전량 CASCADE(c) 且 closure total == **정확히 30**.
  - **(b)** RESTRICT/NO-ACTION(a/r) NEW row == 0 (>0 이면 apply 원자실패를 dry-run 에서 선surface → ABORT).
  - **(c)** SET NULL(n) NEW row == 0 (>0 이면 off-ledger 조용한 mutation → ABORT).
  - check_ins 는 customers 의 `a`(NO-ACTION) edge 자식이자 frozen root 인 이중신분 — closure 선편입으로 blocker 오계상 배제(정확 처리).
- dry-run 러너(`_ac2_dryrun_fullfk.mjs`) + apply 러너(`_ac2_apply.mjs`) 양쪽이 동일 SQL 빌더 재사용. **자식 손열거 코드 전량 제거.**

### ③ DELETE 직전 freeze 재검증 abort-if-grown (Q2 하드조건)
- `buildAbortIfGrownSql()` = frozen 6 check_ins-**only** fixpoint 재census (customers seed 배제).
- `adjudicateAbortIfGrown`: CASCADE 서명 `{st:7, aa:7, crl:1}` 정확 일치 + closure total==21(6ci+15) + a/r·n·신규자식 테이블 0. 편차(야간 Daily Build E2E cron 이 frozen check_in 에 신규 aa 부착 or 신규 grandchild) 시 **ABORT·재adjudication**.
- apply 러너: `BEGIN` **직전** ④′ 단계로 실행. exact-30 POSTCHECK 와 이중 catch.

## POSTCHECK 하드 (갱신)
- 순소실 == **정확히 30** (`netLoss !== 30` → fail-closed, under/over 양방 catch).
- prefix 잔존 0. 실환자 collateral 0 (customers total 감소 == 정확히 9).
- DRY-RUN: 단일 TX trial-DELETE(aa/crl/st → check_ins → customers) → POSTCHECK assert → ROLLBACK → 무영속 post-probe(9/6/7/7/1 잔존).

## 오프라인 검증 (prod 무접촉)
- 5개 스크립트 `node --check` 전부 PASS.
- census_lib 파서/판정 단위테스트: 정상(30)=PASS · abort-if-grown(21)=PASS · GROWN(aa=8)=FAIL(정상) · SET NULL leak=FAIL(정상) · RESTRICT blocker=FAIL(정상). Management-API JSON body / pg-direct 실개행+CONTEXT 양형식 파싱 확인.
- **라이브 dry-run 미실행**: 본 세션 prod foot DB credential(SUPABASE_DB_PASSWORD / PAT) 부재. 트랜잭션 dry-run 무영속(전이-closure그래프 + confdeltype + exact-30 evidence)은 credential 프로비저닝 후 **supervisor DB-GATE** 가 본 러너로 실행. evidence 는 `ac2_dryrun_fullfk_evidence.txt` 로 자동 기록.

## 산출물
| 파일 | 변경 |
|---|---|
| `scripts/…_freeze.mjs` | freeze 30행(+aa7/+crl1) PK-고정 · EXPECT net_loss_total=30 · CASCADE_CHILD_SIGNATURE · CASCADE_COLLATERAL_SNAPSHOT |
| `scripts/…_census_lib.mjs` (신규) | fixpoint 전이-closure SQL 빌더 + 3항 증명 판정 + abort-if-grown (공유) |
| `scripts/…_ac2_dryrun_fullfk.mjs` | DA-divergence ABORT 제거(GO=30) · 손열거 census → fixpoint closure · 3항증명 emit · abort-if-grown · trial net-loss 30 |
| `scripts/…_ac2_apply.mjs` | ④ fixpoint closure 3항증명 · ④′ abort-if-grown · DELETE 순서 aa/crl 편입 · POSTCHECK exact-30 양방 |
| `scripts/…_ac2_preflight.mjs` | aa/crl 라이브 재검증 + cascade-collateral 스냅샷 재기록 |

## 잔여 게이트 (dev-foot 미수행 — 순서 고정, 불변)
1. **credential 프로비저닝** (형, foot prod DB pw) — human_pending.
2. **supervisor DB-GATE** — `ac2_apply.mjs`(무인자=DRY-RUN) 또는 `ac2_dryrun_fullfk.mjs` 실행 → 전이-closure그래프 + confdeltype + exact-30 무영속 evidence + MIG-GATE 4필드.
3. **형 apply_gate** → `--apply`(COMMIT).

## 근본해소 (재강조)
DA action#3: `T-20260721-foot-E2E-FIXTURE-SELFID`(픽스처 자기식별) 미착지 시 야간마다 teardown toil·freeze grown 재발. abort-if-grown 은 방어책일 뿐 근본치료 아님.

**실 DELETE·--apply·prod 변경 없음. deploy-ready 미마킹(credential 게이트 잔존). supervisor QA 미인계.**
