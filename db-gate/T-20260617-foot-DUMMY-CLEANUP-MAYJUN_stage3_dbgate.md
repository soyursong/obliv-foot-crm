# DB-Gate 이관 — T-20260617-foot-DUMMY-CLEANUP-MAYJUN (Stage 3 더미 전수 DELETE)

> **to**: supervisor (DB 데이터게이트) · **from**: dev-foot · **db_change**: YES (운영 DML 대량삭제)
> **priority**: P1 · **risk_verdict**: GO_WARN · **status**: DB-GATE-PENDING — supervisor 데이터게이트 GO 대기
> **clinic**: jongno-foot (`74967aea-a60b-4da3-a0e7-9c997a930bc8`) 한정
> **data-architect CONSULT**: 신규 컬럼/테이블/enum **없음** (행 삭제만) → §S2.4 비해당. cross_crm 계약·도파민 push 스키마 무변경.

## 무엇을 적용하나
5~6월 더미/테스트 데이터 **전수 삭제**. 단일 트랜잭션, 자식→부모 위상정렬 삭제.
- **delete_set = 1261명** = candidate(Tier A 850 ∪ Tier B 428, 중복제거 1278) − KEEP 14(후보내) − HOLD 3
- 스크립트: `scripts/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage3.mjs`
  - 기본 = **DRY-RUN**(trial-delete + ROLLBACK, prod 무변경). 실삭제 = `--apply`(COMMIT) — **supervisor GO 후에만**.
- 증거: `db-gate/..._stage3_dryrun.json`, `db-gate/..._stage3_runlog.txt`
- 백업: `rollback/..._stage3_backup.json` (실행 시 자동생성, 삭제 직전 대상 전 행 23개 테이블 = 10.1MB)

## 삭제 규모 (DRY-RUN 실측, 라이브 FK 검증 완료)
| 테이블 | 건수 | | 테이블 | 건수 |
|---|---|---|---|---|
| customers | 1261 | | reservations | 1228 |
| status_transitions | 1999 | | notification_logs | 1520 (SET NULL orphan 명시삭제) |
| check_ins | 805 | | check_in_services | 755 |
| check_in_room_logs | 514 | | reservation_logs | 351 |
| payments | 203 | | packages | 126 |
| package_sessions | 148 | | reservation_memo_history | 121 |
| health_q_tokens | 107 | | form_submissions | 95 |
| medical_charts | 62 (soft-link 명시삭제) | | timer_records | 45 |
| customer_treatment_memos | 43 | | health_q_results | 32 |
| payment_audit_logs | 19 | | service_charges | 15 |
| package_payments | 14 | | customer_special_notes | 6 |
| claim_diagnoses | 4 | | | |
- chart_doctor_memos: medical_charts 삭제 시 `medical_chart_id` CASCADE 자동삭제.

## 안전 설계 (검수 포인트)
1. **KEEP 17 보존 (차트번호 SSOT 1:1 대조)**: 현장 15(차트번호) + 자동제외 2(김진화·이시형) + 윤민희. 라이브 resolve + 이름 cross-check, 미해소/불일치 시 **ABORT**. 사후검증 KEEP 17/17 생존 확인.
2. **HOLD 3 보존 (잔여 오삭제 가드)**: 신지아(체험단)·강혜인(치료사)·최다혜(치료사) — phone E.164 정밀식별. **셋 다 candidate 포함**이나 이번 sweep **제외** + planner FOLLOWUP. 사후검증 HOLD 3/3 생존 확인.
3. **fail-closed assert 6종**: tier_a=850·tier_b=428 / KEEP·HOLD 교집합 0 / keep_in_candidate=14 / hold_in_candidate=3 / **delete_set=1261** / 타지점 혼입 0 / real_guard 이름 미포함. 1건이라도 어긋나면 ROLLBACK.
4. **FK 라이브 introspection**: `pg_constraint` 단일컬럼 FK → CASCADE/RESTRICT/NO-ACTION 전파(명시삭제), SET NULL/DEFAULT 미전파. 위상정렬 자식→부모.
5. **soft-link/뷰 처리 (RC 규명 완료)**: `aicc_crm_phone_match` 는 **customers 자동갱신 VIEW**(`SELECT id AS customer_id … FROM customers`) — DELETE 시 customers 로 rewrite됨. Phase 2-b 를 `relkind='r'`(실테이블)만으로 한정해 뷰 제외 → customers 는 **명시 최종삭제 1건**으로만 처리(이중삭제·순서혼란 제거). FK 없는 실테이블(medical_charts) + SET NULL(notification_logs)은 명시삭제로 dangling/orphan 방지.
6. **단일 트랜잭션**: DRY-RUN=ROLLBACK / APPLY=COMMIT. 사후검증(txn 내) 위반 시 ROLLBACK.

## POLLUTION 단일화 (gate 요건 #4)
T-20260617-foot-DUMMY-CHECKIN-POLLUTION 30건 check_ins **전부**(30/30) delete_set 고객 소유 → 이 sweep 이 **완전 흡수**. 별도 처리 필요 0건. (POLLUTION 티켓 in_progress였으나 본 삭제로 종결 가능.)

## ⚠ 검수자 확인 요청
- [ ] DRY-RUN runlog 의 KEEP 17/17 · HOLD 3/3 생존, delete_set customers=0 사후검증 라인 확인.
- [ ] delete_set=1261 + clinic 한정(타지점 0) assert 통과 확인.
- [ ] 백업(`rollback/..._stage3_backup.json`) — 실삭제(--apply) 직전 23개 테이블 전 행 보존 (one-way 삭제이므로 복구 유일 수단).
- [ ] **GO 시**: `node scripts/T-20260617-foot-DUMMY-CLEANUP-MAYJUN_stage3.mjs --apply` 1회. 이후 dev-foot 이 회귀 0 검증 + 현장 정상화(셀프접수 대기명단/일마감 접수목록/고객명단) FOLLOWUP.

## ⚠ 롤백 한계 (ONE-WAY)
실삭제 후 복구는 `rollback/..._stage3_backup.json` 역삽입만 가능(FK 순서 부모→자식 역). 운영 중 신규행 발생 시 충돌 가능 → **GO 직후 단일 윈도 적용 권고**.
