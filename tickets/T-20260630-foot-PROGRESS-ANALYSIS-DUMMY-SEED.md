---
id: T-20260630-foot-PROGRESS-ANALYSIS-DUMMY-SEED
domain: foot
priority: P2
status: deploy-ready
qa_result: n/a (데이터 시드 — supervisor 데이터 게이트 대기)
deploy_commit: 3b522034
deployed_at: n/a (prod 데이터 직접 시드 — Vercel 배포 무관, FE/앱 코드 변경 0)
bundle_hash: n/a (앱 코드 변경 없음)
db_change: "data-only — prod INSERT 7행(customers 1 + check_ins 2 + reservations 2 + medical_charts 2). DDL 0, 기존행 변경 0, backfill 0."
summary: "현장(김주연 총괄, jongno-foot) '경과분석 발행' 테스트용 더미 환자 1명 + before/after ≥2시점 시계열을 prod 시드. 역추적: '경과분석' 탭(ProgressTargetsSection.tsx:43-50)=reservations.progress_check_required=TRUE 당일예약 read-only 노출(트리거 無·직접세팅 가능, 20260527000000_progress_check_resv.sql), 실제 '발행'(소견서/진료서류)은 2번차트 금일 check_in 기반 → 오늘자 check_in 동반. 시드: 환자 '테스트경과분석'(is_simulation=true, memo MARKER, phone E.164 +821088090701, gender F) + check_ins 2(6/10 baseline 'done' + 7/01 6회차 'done') + reservations 2(7/01건 progress_check_required=true·label '6회 중간 경과분석'→경과분석 탭 1행 노출 확인) + medical_charts 2(6/10 baseline 70%→7/01 30% 호전 추세, signing_doctor=문지은 cd2639d0 의료법). GO_WARN 3종 충족: ①cross_crm_data_contract(phone E.164·visit_type 표준값·clinic slug jongno) ②테스트 식별('테스트' 접두+is_simulation+memo) ③정리 SQL 1발 동반(_cleanup.sql, is_simulation+MARKER 스코프). 검증: ProgressTargetsSection 정본쿼리 모사 1행 노출 + 오늘 check_in 1건 발행전제 충족."
created: 2026-06-30
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: n/a (앱 코드 변경 0 — 데이터 시드 task. 검증=prod 정본쿼리 모사 probe: scripts/T-20260630-foot-PROGRESS-ANALYSIS-DUMMY-SEED_probe.mjs)
medical_confirm_gate: n/a (§11/§11.1 — 진료대시보드/진료관리 '코드' 미수정. 데이터 시드만, 의료화면 코드 무변경 → 게이트 비대상. medical_charts는 데이터 INSERT일 뿐 화면 코드 변경 아님)
data_consult: n/a (신규 컬럼·테이블·enum 0 — INSERT only, DDL 0, §S2.4 자문 게이트 비대상)
seed_customer_id: 7da267d5-fbcb-458b-b361-204c4e76f06d
cleanup: scripts/T-20260630-foot-PROGRESS-ANALYSIS-DUMMY-SEED_cleanup.sql (현장 테스트 종료 후 1발 실행)
---

# T-20260630-foot-PROGRESS-ANALYSIS-DUMMY-SEED — 경과분석 발행 테스트용 더미 시드

## 결과
- prod(rxlomoozakkjesdqjtvd, jongno-foot) 시드 완료. 더미 환자 **테스트경과분석** (customer_id `7da267d5-fbcb-458b-b361-204c4e76f06d`).
- '경과분석' 탭(치료테이블 ③) 오늘(2026-07-01) 대상 1명 노출 확인 — "6회 중간 경과분석" / 14:00 / @테스트시드.
- before/after 시계열 2시점(6/10 baseline → 7/01 6회차 호전) medical_charts 2건 + 오늘 check_in 1건(발행 전제).

## 산출물
- `scripts/...SEED_probe.mjs` — prod 스키마/전제 introspect (read-only)
- `scripts/...SEED_apply.mjs` — 시드 INSERT(dry-run 기본, --apply, 단계별 롤백)
- `scripts/...SEED_cleanup.sql` — 정리 1발

## 핸드오프 (planner → responder 경유 현장 안내)
- 시드 환자: **테스트경과분석** (jongno, 6회차 경과분석 대상, 오늘 예약 14:00)
- 테스트 종료 후 정리: `_cleanup.sql` 1발 실행 (is_simulation+MARKER 스코프, 실데이터 무영향)
- ⚠ 가정: 현장이 말한 '경과분석 발행'을 (a) '경과분석' 탭에 대상자 노출 + (b) 그 환자 차트에서 서류 발행으로 해석. '발행' 버튼이 특정 다른 화면을 의미했다면 planner 회신 요망.
- ⚠ 의료법: 테스트 중 소견서/진료서류를 'published'까지 발행하면 불변(immutable)이라 cleanup customers DELETE가 FK로 막힐 수 있음. 발행자(총괄)는 의사권한 아니라 가능성 낮으나, 발생 시 supervisor 권한 처리(선례 T-20260629-foot-OPINIONDOC-DRAFT-MIXED-CLEANUP).
