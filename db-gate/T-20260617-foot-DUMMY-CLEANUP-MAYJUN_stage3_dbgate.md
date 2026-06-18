# DB-Gate 이관 — T-20260617-foot-DUMMY-CLEANUP-MAYJUN (Stage 3 더미 전수 DELETE)

> **to**: supervisor (DB 데이터게이트) · **from**: dev-foot · **db_change**: YES (운영 DML 대량삭제)
> **priority**: P1 · **risk_verdict**: GO_WARN · **status**: DB-GATE-PENDING — supervisor 데이터게이트 GO 대기
> **clinic**: jongno-foot (`74967aea-a60b-4da3-a0e7-9c997a930bc8`) 한정
> **data-architect CONSULT**: 신규 컬럼/테이블/enum **없음** (행 삭제만) → §S2.4 비해당. cross_crm 계약·도파민 push 스키마 무변경.
> **commit**: e82f4408 → **deadlock 하드닝 갱신** (아래 6/18 재검증 블록 참조)

## 🆕 2026-06-18 FRESH 재검증 + 데드락 하드닝 (GO 대기 13h+ 경과 → 당일 재실행)
6/17 야간 산출물이 stale(measured_at 2026-06-17T20:51)했고, supervisor GO가 6/17 21:34 이후 미응답이라 **6/18 당일 fresh DRY-RUN 재실행**.
- **드리프트 0**: delete_set=**1263** (overnight 변동 없음, EXPECT 정확 일치). 사후검증 **KEEP 18/18·HOLD 0/0·delete_set customers 잔존=0** → ROLLBACK(prod 무변경). 신지아 삭제셋포함=false / 강혜인·최다혜=true 명시검증 PASS. 산출물 6/18 재생성(measured_at `2026-06-18T01:31`).
- **⚠ NEW: 데드락 실관측**: 6/18 daytime(라이브 CRM 트래픽 中) 첫 DRY-RUN 시 trial-delete 단계에서 **`40P01` deadlock detected → ROLLBACK**. 재시도 시 PASS. = 야간엔 안 보였던 **주간 락 경합** 리스크. 대량 CASCADE 삭제(20여 테이블, status_transitions 2046행 등)가 동시 트래픽과 락 경합.
- **하드닝 적용(스크립트 갱신)**: 단일 txn에 **데드락/직렬화/lock_timeout 재시도 래퍼**(40P01·40001·55P03만 재시도, MAX_ATTEMPTS=apply 6회·backoff) + `SET LOCAL lock_timeout='20s'` + `statement_timeout='240s'`. **assert/무결성 위반은 재시도 없이 즉시 ROLLBACK+throw**(안전성 불변). delete_set 산출·KEEP/HOLD 가드·삭제 위상정렬 **로직 무변경** — 검수 결론 유지.
- **apply 권고**: 가능하면 **저트래픽 윈도(야간)** 적용 권장. 단 재시도 래퍼로 주간 단발 데드락도 자동 회복.

## ⚠ 경로 정정 안내 (이 파일이 왜 늦게 보였나)
- 직전 DB-GATE 요청 시 산출물이 **레포 내부**(`obliv-foot-crm/db-gate/`)에만 있어, supervisor가 기대한 handoff 경로(`memory/_handoff/db-gate/`)에 없어 NO-GO(정보부족)로 처리됨.
- 본 파일이 정정된 정본 핸드오프. **모든 증거 산출물의 절대경로**를 아래에 명시.

## 📂 증거 산출물 (절대경로 — supervisor 검수용)
| 산출물 | 절대경로 | 비고 |
|---|---|---|
| DB-GATE 정본(본 문서) | `~/claude-sync/memory/_handoff/db-gate/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage3_dbgate.md` | |
| 실행 스크립트 | `~/Documents/GitHub/obliv-foot-crm/scripts/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage3.mjs` | DRY-RUN 기본 / `--apply`=COMMIT |
| DRY-RUN 로그(runlog) | `~/Documents/GitHub/obliv-foot-crm/db-gate/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage3_runlog.txt` | 삭제 위상정렬·사후검증·ROLLBACK 라인 |
| DRY-RUN 결과(json) | `~/Documents/GitHub/obliv-foot-crm/db-gate/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage3_dryrun.json` | assert·keep_resolve 검증 |
| 백업(역삽입용) | `~/Documents/GitHub/obliv-foot-crm/rollback/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage3_backup.json` | **10.8MB, 23개 테이블 전 행 보존 완료** |
| Stage1 인벤토리/로스터 | `~/Documents/GitHub/obliv-foot-crm/db-gate/..._stage1_inventory.json` / `_roster.md` / `_tiered.json` | |

## ✅ supervisor 요청 2)항목 충족 체크
- [x] **dry-run 로그**: runlog.txt — KEEP 18/18·HOLD 0/0·delete_set customers 잔존=0 사후검증 후 `[DRY-RUN] ROLLBACK 완료 — prod 무변경` 확인.
- [x] **DELETE WHERE/스크립트**: stage3.mjs — 자식→부모 위상정렬 DELETE, fail-closed assert(delete_set=1263) 내장.
- [x] **백업 산출물**: rollback/..._stage3_backup.json (10.8MB, 23개 테이블 전 행) **이미 생성 완료**.
- [x] **롤백 조건**: 단일 트랜잭션(DRY-RUN=ROLLBACK / APPLY=COMMIT), 사후검증 위반 1건이라도 ROLLBACK. 실삭제 후 복구는 backup.json 역삽입(ONE-WAY).

## ⚠ Stage3 잔여 sub-track 종결 반영 (2026-06-17 20:35, planner NEW-SUBTASK q8eq) — delete_set 1261→1263
총괄 회신(20:33, slack_ts 1781695978.766079) **"신지아 010-9461-1240 남겨줘 나머진 삭제"** 정확 반영:
- **신지아**(+821094611240) → KEEP 영구확정(명단 18번). 삭제셋 **절대 제외** (dry-run: KEEP포함=true·삭제셋포함=**false** 검증).
- **강혜인**(+821022211444) + **최다혜**(+821031414010) → 더미 확정 삭제. delete_set 흡수(dry-run: 삭제셋포함=true 검증).
- **메인 배치(delete_set 1261) 미실행 확정** (probe 2026-06-17: delete_set 1261/1261 전원 생존) → 지시 3-① 경로 = **2명 포함 단일 실행(delete_set 1263)**. 별도 후처리 불요.

## 무엇을 적용하나
5~6월 더미/테스트 데이터 **전수 삭제**. 단일 트랜잭션, 자식→부모 위상정렬 삭제.
- **delete_set = 1263명** = candidate(Tier A 850 ∪ Tier B 428, 중복제거 1278) − KEEP 15(후보내, +신지아) − HOLD 0
- 기본 = **DRY-RUN**(trial-delete + ROLLBACK, prod 무변경). 실삭제 = `--apply`(COMMIT) — **supervisor GO 후에만**.

## 삭제 규모 (DRY-RUN 실측 2026-06-17 20:5x, delete_set 1263, 라이브 FK 검증 완료)
| 테이블 | 건수 | | 테이블 | 건수 |
|---|---|---|---|---|
| customers | 1263 | | reservations | 1234 |
| status_transitions | 2046 | | notification_logs | 1529 (SET NULL orphan 명시삭제) |
| check_ins | 811 | | check_in_services | 769 |
| check_in_room_logs | 546 | | reservation_logs | 353 |
| payments | 205 | | packages | 129 |
| package_sessions | 153 | | reservation_memo_history | 123 |
| health_q_tokens | 109 | | form_submissions | 114 |
| medical_charts | 62 (soft-link 명시삭제) | | timer_records | 48 |
| customer_treatment_memos | 45 | | health_q_results | 33 |
| payment_audit_logs | 19 | | service_charges | 15 |
| package_payments | 14 | | customer_special_notes | 6 |
| claim_diagnoses | 4 | | | |
> 1261→1263 대비 증분: customers +2(강혜인·최다혜) + 라이브 데이터 드리프트(20:09→20:5x 신규행). 사후검증 KEEP 18/18·HOLD 0/0·delete_set customers=0 PASS.
- chart_doctor_memos: medical_charts 삭제 시 `medical_chart_id` CASCADE 자동삭제.

## 안전 설계 (검수 포인트)
1. **KEEP 18 보존 (차트번호 SSOT 1:1 대조 + 신지아 phone)**: 현장 15(차트번호) + 자동제외 2(김진화·이시형) + 윤민희 + 신지아(phone +821094611240, Stage3 18번). 라이브 resolve + 이름 cross-check, 미해소/불일치 시 **ABORT**. 사후검증 KEEP 18/18 생존 확인.
2. **Stage3 잔여 종결 검증 (신지아 KEEP / 강혜인·최다혜 삭제)**: phone E.164 정밀식별. 신지아 = KEEP포함·삭제셋제외 / 강혜인·최다혜 = 삭제셋포함·KEEP미포함. 위반 1건이라도 **ABORT**. HOLD 0(전원 현장 종결).
3. **fail-closed assert**: tier_a=850·tier_b=428 / KEEP·HOLD 교집합 0 / keep_in_candidate=15 / hold_in_candidate=0 / **delete_set=1263** / 타지점 혼입 0 / real_guard 이름 미포함 / 신지아 KEEP보존·강혜인·최다혜 삭제셋포함. 1건이라도 어긋나면 ROLLBACK.
4. **FK 라이브 introspection**: `pg_constraint` 단일컬럼 FK → CASCADE/RESTRICT/NO-ACTION 전파(명시삭제), SET NULL/DEFAULT 미전파. 위상정렬 자식→부모.
5. **soft-link/뷰 처리 (RC 규명 완료)**: `aicc_crm_phone_match` 는 **customers 자동갱신 VIEW** — DELETE 시 customers 로 rewrite됨. Phase 2-b 를 `relkind='r'`(실테이블)만으로 한정해 뷰 제외 → customers 는 **명시 최종삭제 1건**으로만 처리. FK 없는 실테이블(medical_charts) + SET NULL(notification_logs)은 명시삭제로 dangling/orphan 방지.
6. **단일 트랜잭션**: DRY-RUN=ROLLBACK / APPLY=COMMIT. 사후검증(txn 내) 위반 시 ROLLBACK.

## POLLUTION 단일화 (gate 요건 #4)
T-20260617-foot-DUMMY-CHECKIN-POLLUTION 30건 check_ins **전부**(30/30) delete_set 고객 소유 → 이 sweep 이 **완전 흡수**. 별도 처리 필요 0건.

## ⚠ 검수자 확인 요청
- [ ] DRY-RUN runlog 의 KEEP 18/18 · HOLD 0/0 생존, delete_set customers=0 사후검증 라인 확인.
- [ ] Stage3 잔여 종결 검증 라인: 신지아 삭제셋포함=false / 강혜인·최다혜 삭제셋포함=true 확인.
- [ ] delete_set=1263 + clinic 한정(타지점 0) assert 통과 확인.
- [ ] 백업(`rollback/..._stage3_backup.json`, 10.8MB/23테이블) 보존 확인 (one-way 삭제이므로 복구 유일 수단).
- [ ] **GO 시**: `node scripts/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage3.mjs --apply` 1회. 이후 dev-foot 이 회귀 0 검증 + 현장 정상화(셀프접수 대기명단/일마감 접수목록/고객명단) FOLLOWUP.

## ⚠ 롤백 한계 (ONE-WAY)
실삭제 후 복구는 `rollback/..._stage3_backup.json` 역삽입만 가능(FK 순서 부모→자식 역). 운영 중 신규행 발생 시 충돌 가능 → **GO 직후 단일 윈도 적용 권고**.
