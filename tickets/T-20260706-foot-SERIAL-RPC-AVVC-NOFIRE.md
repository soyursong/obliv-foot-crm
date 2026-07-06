---
status: deploy-ready
deploy_ready: true
db_changed: false
e2e_spec: tests/e2e/T-20260706-foot-SERIAL-RPC-AVVC-NOFIRE.spec.ts
commit_sha: 6977fda0
risk_verdict: GO
risk_reason: "순수 FE 배선 수정(DocumentPrintPanel.handleBatchPrint). 기존 배포·정상동작 RPC(issue_foot_doc_serial) 를 배치 경로에서도 호출하도록 배선 — 단건 handlePrint 와 동형. 스키마/RPC/enum/컬럼 무변경(db_changed=false). 발번대장 무결성 가드(INSERT/RPC/조립 실패 시 가짜 번호 미생성) 승계. 비-연번호 양식·차트번호 미보유 케이스 종전 유지(회귀 0). build OK, 신규 E2E 8 PASS + 기존 serial/doc-split 회귀 43 PASS."
build_verified: "2026-07-06 — npm run build → ✓ built in 5.30s"
---

# T-20260706-foot-SERIAL-RPC-AVVC-NOFIRE — 진료확인서(VC)·통원확인서(AV) 연번호 발번 미작동 버그픽스

## 근인 (진단 결과)

배포 완료된 발번 로직(SERIAL-UNIQUE-HARDEN + SERIAL-RPC-FE-REWIRE)은 **단건 출력 경로
(IssueDialog.handlePrint)** 에만 배선되어 있었다. **일괄 출력 경로(DocumentPrintPanel.handleBatchPrint)**
는 `issue_foot_doc_serial` RPC 를 호출하지 않고 `visit_no` 문자열도 조립하지 않아, 배치로 출력되는
연번호 대상 양식이 `{{visit_no}}` 공란으로 인쇄되었다.

- 현장이 특정 인지한 2종(진료확인서=treat_confirm_code/nocode=VC, 통원확인서=visit_confirm=AV)은
  실제로는 배치 출력되는 양식이며(라이브 form_submissions 실측: 동일 `printed_at` 클러스터),
  **`{{visit_no}}` 를 렌더하는 양식이 진단서/진료확인서/통원확인서 3종뿐**이라(진단서는 최근 발행 0건)
  현장 눈에는 이 두 doc_type만 공란으로 보였다.
- 라이브 검증: form_submissions 85행 전수 중 정식 포맷 연번호(PREFIX-DATE-CHART-NN) **0건**.
  `doc_serial_seq` 컬럼은 채워지나(RPC/backfill) `field_data.visit_no` 는 항상 공란.
- RPC/컬럼(doc_serial_seq)/UNIQUE 제약은 프로덕션 적용·정상 동작 확인(멱등 재호출 검증 통과) →
  **DB 정상, 순수 FE 배선 누락**.

### 진단 가설 대조
1. **FE 배선(정답)**: 배치 경로에 RPC 호출·visit_no 조립 자체가 없었음 → 본 티켓에서 배선 추가.
2. RPC body doc_type 필터: 해당 없음 — RPC 는 doc_type 무관 generic MAX+1(clinic 파티션). AV/VC 필터 부재가 아님.
3. doc_type 코드값 정합: 정합 확인 — `visit_confirm→AV`, `treat_confirm(+code/nocode)→VC` 코드값 일치(대소문자·enum OK).

## 수정 (FE only, db_change=false)

`handleBatchPrint` 를 단건 `handlePrint` 와 동형으로:
1. 연번호 대상(`docSerialPrefix` 매핑 + 차트번호 보유) 양식 → `form_submissions` 선 INSERT
2. `issue_foot_doc_serial`(멱등) 발번 → 3. `buildDocSerial` 로 `visit_no` 조립
4. per-template 바인딩값(`valuesFor(t)`)에 주입 + `field_data` 갱신
- 인쇄 바인딩(html/jpg/pdf) 을 `valuesFor(t)` 로 전환 → 양식별 visit_no 반영
- `serialIssuedTemplateIds` 로 뒤 일괄 INSERT 에서 제외 → **이중 기록 0**
- 발번대장 무결성: INSERT/RPC/조립 실패 시 가짜 번호 미생성(공란 유지)
- 차트번호 미보유·비-연번호 양식은 종전대로(회귀 0)

## 원칙 준수
- 최소 diff, 순수 FE 코드 → `db_change=false`.
- 스키마·RPC 무변경 → data-architect CONSULT 비해당(ADDITIVE 초과 없음).
- 기존 발행 연번 소급 재발번 없음. 미발번 문서 backfill 미포함(범위 외).
- 다른 서류 타입 회귀 없음(E2E AC-6 + 기존 43 spec 회귀 PASS).

## 검증
- 신규 E2E: `tests/e2e/T-20260706-foot-SERIAL-RPC-AVVC-NOFIRE.spec.ts` 8 PASS
  (AC-1 배치 AV/VC visit_no 공란 아님 · AC-2 prefix 정합 · AC-3 이중 INSERT 0 · AC-4/5 비대상·차트미보유 회귀 · AC-6 기존 prefix 불변 · 통산 중복0)
- 회귀: SERIAL-RPC-FE-REWIRE / SERIAL-UNIQUE-HARDEN / DOCSERIAL-AUTOGEN / DOCCONFIRM-FORMPANEL-SPLIT → 43 PASS
- `npm run build` ✓
- commit `6977fda0` push origin/main (Vercel 자동배포)

## 후속 (비차단)
- 단건 handlePrint 는 이미 정상이나, 현장이 배치를 주로 사용 → 배치 픽스로 실사용 경로 해소.
- 미발번 기존 문서 backfill 은 본 티켓 범위 아님(필요 시 별도 티켓).
