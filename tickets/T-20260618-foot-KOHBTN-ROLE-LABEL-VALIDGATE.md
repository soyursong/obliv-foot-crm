---
ticket_id: T-20260618-foot-KOHBTN-ROLE-LABEL-VALIDGATE
id: T-20260618-foot-KOHBTN-ROLE-LABEL-VALIDGATE
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-18
owner: agent-fdd-dev-foot
requester: 문지은 대표원장 (진료대시보드 KOH 발급버튼 역할별 표기 요청)
approved_by: planner NEW-TASK MSG-20260618-234452-6h0m
build_ok: true
spec_added: tests/e2e/T-20260618-foot-KOHBTN-ROLE-LABEL-VALIDGATE.spec.ts
db_changed: false
data_architect_consult: 면제 (FE-only 표기 분기 — 신규 컬럼/테이블/enum/role 0. publish_koh_result RPC·스키마 무변경. §S2.4 데이터 정책 자문 게이트 미해당)
risk_level: GO (1/5 — FE 라벨/문장 표기 분기만. 게이트(canPublish)·실제 발급동작·DB 무변경. 치료사 경로 문자열 byte-identical 회귀0)
qa_result: pass
deploy_commit: f600d896
commit_sha: f600d896
deployed_at: 2026-06-18T22:30:00+09:00
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-18
field_soak_gate: 실 Galaxy Tab — ① 원장(director) 로그인 → 균검사지 발급버튼='발급하기'/일괄='일괄발급하기', 비검증 행 탭 시 사유 toast 노출(먹통 아님) ② 치료사(therapist) 로그인 → '발급요청'/'일괄발급요청' 현행 유지 ③ 문지은 대표원장 현장 confirm (최종 게이트)
---

# T-20260618-foot-KOHBTN-ROLE-LABEL-VALIDGATE — KOH 발급버튼 역할별 라벨 분기 + 의사 검증게이트

## 요약
진료대시보드(DoctorTools) 균검사지 탭의 KOH 검사결과 발급버튼을 역할별로 분기한다.
- **의사(원장=director)**: `발급하기` / `일괄발급하기` (본인이 직접 발급하는 주체)
- **그 외 직원(치료사 등)**: `발급요청` / `일괄발급요청` (현행 유지)

## RC 그라운딩 (구현 전 필수, db-gate evidence)
- **(a)** "진료대시보드" = `src/pages/DoctorTools.tsx`(`<h1>진료대시보드</h1>`) 의 균검사지 탭 = `KohReportTab`. 렌더 그라운딩 확정.
- **(b)** 역할 = `profile.role`(UserRole, `useAuth`). 의사 = `'director'`(원장, 풋센터 유일 physician role). 치료사 = `'therapist'`. 신규 role 컬럼 불필요 (L25 금지 준수).
- **(c)** **AC-4 1차가정(FE-only) 확정**. 티켓이 치료사를 "(현행)"으로 명시 = 치료사 동작 무변경. 현행 동작은 `handlePublish`가 `publish_koh_result` RPC 직접 호출(실제 발급)이며, "치료사 요청→의사 발급" 2단계 승인이라면 치료사 동작이 바뀌어야 하므로 모순. 요청상태 영속화/승인큐 언급 0 → ADDITIVE/DDL 불필요, data-architect CONSULT 게이트 미해당.

## 구현 (FE-only, KohReportTab.tsx)
- `isDoctor = profile?.role === 'director'`, `pubNoun = isDoctor ? '발급' : '발급요청'` 을 핸들러보다 위에 정의.
- 버튼 라벨 변수: `publishBtnLabel`(발급하기/발급요청), `bulkPublishBtnLabel`(일괄발급하기·선택 N건 일괄발급 / 일괄발급요청·선택 N건 일괄발급요청).
- confirm/toast/title 문장은 `pubNoun` 동일치환 — 단일 분기점, 치료사 경로 문자열은 旣값과 byte-identical.
- **(2) 의사 view 검증게이트**: `rowPublishable(canPublish = 조갑부위+생년월일+미발행)` 행만 발급하기 활성 표시(variant=default), 비검증 행은 outline(비활성처럼). 게이트는 역할 무관 단일 SSOT(canPublish).

## AC-3 회귀방지 (SINGLESEL-2FIX 이슈1 보존)
- 비검증 행도 탭 가능(`disabled`는 busy 한정) → 탭 시 `handlePublish` 사유 toast 노출(태블릿 hover 부재 대응). 생년 미입력 amber 배지 + 치료부위 프리필 배지(인라인 사유)도 그대로. 발급버튼 비활성처럼 보이되 발견성 유지.

## 검증
- 빌드: `npm run build` ✓ (4.63s)
- 신규 E2E: `tests/e2e/T-20260618-foot-KOHBTN-ROLE-LABEL-VALIDGATE.spec.ts` — 12 PASS (S1 라벨분기 / S2 검증게이트·AC-3 / S3 pubNoun 동일치환·회귀0)
- 동거 회귀: 4FIX + SINGLESEL-2FIX + KOHDASH-BULK-PUBLISH 31 PASS (회귀 0)
- commit: f600d896 (main → Vercel 자동 배포)

## 현장 클릭 시나리오
- S1: 원장 로그인 → 균검사지 탭 → 발급버튼 라벨이 `발급하기`, 일괄은 `일괄발급하기`. 검증완료(조갑부위+생년) 행만 활성 강조.
- S2: 치료사 로그인 → 동일 화면에서 버튼 라벨 `발급요청`/`일괄발급요청`(현행 동일).
- S3: 검증 미완료 행(조갑부위/생년 누락)에서 발급버튼 탭 → "먼저 선택"/"생년월일 미입력" 사유 안내 toast(먹통 아님).
