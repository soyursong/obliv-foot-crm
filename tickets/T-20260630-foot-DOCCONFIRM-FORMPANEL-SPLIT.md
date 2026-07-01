---
id: T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: ce091d58 (feat(foot): 진료확인서 발급폼 2개 분리 — code(코드·진단명 포함)/nocode(불포함))
deployed_at: n/a (코드 origin/main 기반영 — Vercel 자동배포·supervisor QA 대기)
bundle_hash: n/a (NOT yet verified on prod)
db_change: true (form_templates 신규 2행 ADDITIVE INSERT + 레거시 treat_confirm active=false forward-only 토글. DDL 0 = service_id 기존 컬럼. service_charges INS/UPD/DEL 0건. 마이그 20260630160000_foot_docconfirm_formpanel_split.sql — 라이브 적용·POSTVERIFY PASS 재검증 2026-07-01)
e2e_spec: tests/e2e/T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT.spec.ts (14 시나리오 PASS — S1 code/S2 nocode/S3 레거시 미노출/AC doc-serial VC 공유/회귀 진료확인서 외 무영향) + 회귀 DOCLIST-ORDER-10·DOCLABEL-RENAME-11·DOCSERIAL-AUTOGEN 31 PASS
medical_confirm_gate: confirmed (문지은 대표원장 U0ALGAAAJAV CONFIRMED "총괄님의견대로해" ts 1782910866.371119 · C0ATE5P6JTH thread 1782910746.891869 · responder MSG-20260701-220353-u3ut. §11/§11.1 의료 렌더 surface=DocumentPrintPanel(DoctorDocsHubDialog L151 재사용) 진료확인서 발급버튼 code/nocode 2개 노출 = 컨펌 완료된 가시 변경)
summary: "진료확인서 발급폼 2개 분리(방식 β, DA CONSULT-REPLY MSG-20260630-124429-aw11 GO + reporter 게이트 A 김주연 총괄 옵션② 확정 + §11 게이트 C 문원장 CONFIRMED). 단일 treat_confirm → 2 발급폼: treat_confirm_code(코드·진단명 포함, 상병 테이블 렌더·diag service_charges 읽기주입, service_id=b590d457/진료확인서1/10,000/제증명) + treat_confirm_nocode(불포함, 상병 미렌더, service_id=67ce0da3/진료확인서2/3,000/제증명). 레거시 treat_confirm = forward-only deactivate(DB active=false, DELETE 금지) + DOCLIST_ORDER_10 화이트리스트 제거 → 2관문(active 쿼리+화이트리스트) 미노출로 3중표시 차단. HTML_TEMPLATE_MAP.treat_confirm·FORM_META 보존 → 기존 발행문서(form_submissions 10건) 재출력 무손상. 서류종류 1개 유지 = code/nocode doc-serial prefix 둘 다 VC 공유(11번째 서류종류 신설 없음). 비파괴 가드: service_charges 무변경(폼 발행=읽기 snapshot), out-of-scope C5900004 무접촉, 신규 2행 멱등 INSERT(WHERE NOT EXISTS). 착수 선결 self-check 2건: ①패널 active 필터 경로(PaymentMiniWindow/DocumentPrintPanel .eq('active',true)+orderDocList DOCLIST_ORDER_10) 레거시 미노출·신규 2버튼 노출 확인 ②service_charges 무변경 read-only 확인. §11 렌더 surface 회귀: DocumentPrintPanel(DoctorDocsHubDialog L151 재사용) 문서허브 진료확인서 발급버튼 code/nocode 2개 노출 확인. 라이브 DB 재검증(2026-07-01): treat_confirm(active=f,svc=NULL)/treat_confirm_code(active=t,svc=b590d457)/treat_confirm_nocode(active=t,svc=67ce0da3) + 2 SKU(진료확인서1 10,000 제증명 / 진료확인서2 3,000 제증명). 빌드 OK. E2E 신규 14 PASS + 회귀 31 PASS. supervisor 게이트=DDL 0 → DDL-diff 불요, 대체 게이트 DML 리뷰+패널 렌더 검증(2버튼 표시·레거시 미표시·service_charges 무변경). DB변경: 있음(form_templates DML, service_charges 무변경)."
created: 2026-06-30
assignee: dev-foot
owner: agent-fdd-dev-foot
---

## 요청 (planner NEW-TASK, MSG-20260701-221311-06w0 = 구 MSG-20260630-124723-qn24 재발행)

진료확인서 발급폼 **2개 분리** 확정. **§11 의료 컨펌게이트(게이트 C) 해소** 후 착수.

### 게이트 3종 최종 상태
- **A (reporter 의도)**: 김주연 총괄 옵션② 직접 확정 — '진료확인서(코드·진단명 포함)' / '(불포함)' 2개 버튼=2개 발급폼 각각 분리. ✅
- **B (DA CONSULT-REPLY MSG-20260630-124429-aw11)**: GO, 방식 β. 비파괴 → 대표 게이트 면제(autonomy §3.1). ✅
- **C (§11 의료화면 컨펌게이트)**: 문지은 대표원장(U0ALGAAAJAV) CONFIRMED — "총괄님의견대로해" (ts 1782910866.371119, C0ATE5P6JTH thread 1782910746.891869, responder MSG-20260701-220353-u3ut). ✅

## 구현 = β (DA spec)

### 1. 신규 2행 INSERT (ADDITIVE) — form_templates
- `treat_confirm_code`  → service_id=b590d457 (10,000, code·진단명 **포함**). diag rows = service_charges 상병항목 **읽기 주입**(INS-FIELD-BIND, write 0).
- `treat_confirm_nocode` → service_id=67ce0da3 (3,000, code·진단명 **불포함**). diag 바인딩 **제거**(별 템플릿 분기).
- form_key = formTemplates.ts FALLBACK 키와 동일 → FALLBACK·doc-serial 정합 유지.

### 2. 레거시 단일행 deactivate — forward-only (DELETE 금지)
`UPDATE form_templates SET active=false WHERE form_key='treat_confirm' AND service_id IS NULL;`

### 3. dev 착수 선결 self-check 2건 (risk GO_WARN)
- §2 발급 패널 active 필터 경로 — 레거시 미노출·신규 2버튼 노출 확인. ✅
- service_charges 무변경(INS/UPD/DEL 0건) self-check — 읽기-only. ✅

### 4. §11 렌더 surface 회귀 확인 (게이트 C 대상)
- DocumentPrintPanel(DoctorDocsHubDialog L151 재사용) 문서 허브에서 진료확인서 발급 버튼이 code/nocode 2개로 노출. 문원장 컨펌 완료된 가시 변경. ✅

## 이행 결과 (2026-07-01, 게이트 C 해소 후 재검증)

- 코드: ce091d58 이미 main 반영(FE formTemplates.ts/htmlFormTemplates.ts/docSerial.ts + 마이그 + 신규 spec). §11 재-block 전 커밋됨.
- DB 라이브 재검증(Management API read-only): treat_confirm(active=false, service_id=NULL) / treat_confirm_code(active=true, service_id=b590d457) / treat_confirm_nocode(active=true, service_id=67ce0da3). 2 SKU = 진료확인서1(10,000·제증명) / 진료확인서2(3,000·제증명). POSTVERIFY 상태 그대로 유지.
- 빌드: OK. E2E: 신규 14 PASS + 회귀 31 PASS(DOCLIST-ORDER-10/DOCLABEL-RENAME-11/DOCSERIAL-AUTOGEN).
- deploy-ready 마킹 = 게이트 C 해소로 비로소 완료(구 qn24 소비분 재발행 MSG-20260701-221311-06w0 처리).

## E2E 시나리오 (3종)
1. 코드·진단명 포함 발급(10,000 SKU 유지) 2. 코드·진단명 불포함 발급(3,000 SKU 유지) 3. 레거시 단일폼 미노출(회귀).
