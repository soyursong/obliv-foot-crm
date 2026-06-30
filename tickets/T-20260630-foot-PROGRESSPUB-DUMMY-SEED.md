---
id: T-20260630-foot-PROGRESSPUB-DUMMY-SEED
domain: foot
priority: P2
status: deploy-ready
qa_result: n/a (데이터 시드 — supervisor 데이터 게이트 대기)
deploy_commit: afd4cc4a
deployed_at: n/a (prod 데이터 직접 시드 — Vercel 배포 무관, FE/앱 코드 변경 0)
bundle_hash: n/a (앱 코드 변경 없음)
db_change: "data-only — prod INSERT 21행(customers 3 + check_ins 6 + reservations 6 + medical_charts 6). DDL 0, 기존행 변경 0, backfill 0. db_change=false."
summary: "김주연 총괄(jongno-foot) '경과분석 발행' 직접 화면테스트용 더미 환자 3명(테스트경과01/02/03) + 각자 before/after ≥2시점 시계열을 prod 시드. 선행 단건 시드(T-20260630-foot-PROGRESS-ANALYSIS-DUMMY-SEED)의 멀티-환자 확장판. 역추적: '경과분석' 탭(ProgressTargetsSection.tsx:40-52 정본쿼리)=reservations.eq(clinic,jongno).eq(reservation_date,오늘).eq(progress_check_required,true).neq(status,cancelled), is_simulation 필터 無 → 직접세팅. 발행(2번차트 소견서)은 금일 check_in + medical_charts 시계열 전제. 시드(환자별): customers(is_simulation=true, memo MARKER, phone E.164 가짜 +82100000070N, gender) + check_ins 2(baseline done + 7/01 done) + reservations 2(7/01건 progress_check_required=true·label→경과분석 탭 노출) + medical_charts 2(baseline→7/01 호전추세, signing_doctor=문지은 cd2639d0 의료법). GO_WARN 3종 충족: ①cross_crm_data_contract(phone E.164·visit_type 표준·clinic jongno) ②테스트 식별(name '테스트경과0N'+is_simulation+memo MARKER+가짜전화 00000) ③정리 SQL 1발 동반(_cleanup.sql, is_simulation+MARKER 스코프). 검증: 정본쿼리 모사 → 오늘 경과분석 탭 신규 3행 노출(테스트경과01 14:00/02 14:30/03 15:00) + 환자별 오늘 check_in 1건 발행전제 충족."
created: 2026-06-30
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: n/a (앱 코드 변경 0 — 데이터 시드 task. 검증=prod 정본쿼리 모사 in-script)
medical_confirm_gate: n/a (§11/§11.1 — 진료대시보드/진료관리 '코드' 미수정. medical_charts 는 데이터 INSERT일 뿐 화면 코드 변경 아님 → 게이트 비대상)
data_consult: n/a (신규 컬럼·테이블·enum 0 — INSERT only, DDL 0, §S2.4 자문 게이트 비대상)
marker: "[TEST-DUMMY PROGRESSPUB 20260701]"
seed_customer_ids: 67e6bb1f-329f-48b9-a1f2-6ae56d889708, 80d6f3cf-a687-45ee-93a4-e273a491623f, 2af4b895-079a-488a-a228-05d52c028fc3
cleanup: scripts/T-20260630-foot-PROGRESSPUB-DUMMY-SEED_cleanup.sql (현장 테스트 종료 후 1발 실행)
---

# T-20260630-foot-PROGRESSPUB-DUMMY-SEED — 경과분석 발행 테스트용 더미 3명 시드

## 결과
- prod(rxlomoozakkjesdqjtvd, jongno-foot) 시드 완료. 더미 환자 3명:
  - **테스트경과01** (`67e6bb1f-…`) — 오늘 14:00, "6회 중간 경과분석", 무좀 70→30% 호전
  - **테스트경과02** (`80d6f3cf-…`) — 오늘 14:30, "10회 경과분석", 변색 80→25% 호전
  - **테스트경과03** (`2af4b895-…`) — 오늘 15:00, "3개월차 경과분석", 각질 비후 호전
- '경과분석' 탭(치료테이블 §③) 오늘(2026-07-01) 대상 노출 확인 — 위 3행 추가(정본쿼리 모사 검증).
  (선행 단건 시드 '테스트경과분석' 14:00 도 잔존 → 탭 총 4행. 둘 다 별개 cleanup 보유.)
- 각 환자 before/after 2시점 medical_charts(baseline → 7/01 호전) + 오늘 check_in 1건(발행 전제) 동반.

## 산출물
- `scripts/T-20260630-foot-PROGRESSPUB-DUMMY-SEED_apply.mjs` — 멀티-환자 시드 INSERT(dry-run 기본, --apply, 환자별 롤백)
- `scripts/T-20260630-foot-PROGRESSPUB-DUMMY-SEED_cleanup.sql` — 정리 1발(is_simulation+MARKER 스코프)

## 핸드오프 (planner → responder 경유 현장 안내)
- 시드 환자 3명: **테스트경과01 / 테스트경과02 / 테스트경과03** (jongno, 모두 오늘 2026-07-01 경과분석 대상)
- "이 환자들로 발행 테스트하세요" — 치료테이블 → 경과분석 탭에 오늘 대상자로 노출, 환자명 클릭 → 2번차트에서 발행.
- 테스트 종료 후 정리: `_cleanup.sql` 1발 실행 (is_simulation+MARKER 스코프, 실데이터 무영향)
- ⚠ 의료법: 테스트 중 소견서/진료서류를 'published'까지 발행하면 불변(immutable)이라 cleanup customers DELETE 가 FK로 막힐 수 있음. 발행자(총괄)는 의사권한 아니라 가능성 낮으나, 발생 시 supervisor 권한 처리(선례 T-20260629-foot-OPINIONDOC-DRAFT-MIXED-CLEANUP).
