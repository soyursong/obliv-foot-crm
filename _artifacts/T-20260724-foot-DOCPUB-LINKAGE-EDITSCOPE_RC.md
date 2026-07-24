# T-20260724-foot-DOCPUB-LINKAGE-EDITSCOPE — AC-2 RC (진단 결과, 추정 금지)

reporter=김주연 총괄 / repo=obliv-foot-crm / diagnose-first / db_change=false

## 증상
소견서 작성 폼 '환자 자동연동' 3필드(생년월일 / 오늘 시술 / 처방내역)가 "하나도 연동 안 됨".

## RC (로그·코드·런타임 증거로 확정)
1. **시점**: AC-2 복명 = 2026-07-24 16:34 KST(MSG-20260724-163435).
   자매 티켓 **T-20260724-foot-DOCFORM-AUTOFILL-DOB-TX-RX-BLANK** 이 정확히 이 3필드를
   실 SSOT 로 재결선 → commit `4b4efbb7`(07-24 19:24 KST), **prod 배포 07-25 03:14 KST**.
   prod `version.json.commit` = `5f72805` = `origin/main` HEAD, 여기에 `src/lib/opinionAutofillRef.ts`
   가 포함되고 `OpinionDocTab` 에 `loadOpinionAutofillRef` 3회 결선(wired). → **복명이 자매 수정 배포를 선행**.
2. **구증상 원인(자매 티켓 RC 계승)**: 구배선은 실데이터 없는 소스만 읽음
   (medical_charts.treatment_record 거의 미기록 / visitor.birth_date 구조적 공란 / rx 단일소스) → 3필드 전부 공란.
3. **현 배포본 런타임 재현**(`scripts/T-20260724-...-DOCPUB-LINKAGE-EDITSCOPE_probe.mjs`, service_role read-only, 07-11~07-25 window):
   - **당일 시술** = ✅ `check_in_services` 에서 실 방문자 다수 정상 결선(예: "비가열성 진균증 레이저 치료" 등).
   - **처방내역** = ✅ 로더 경로 end-to-end 정상. rx 데이터 있는 고객 5명 mc 폴백 전원 결선 확인.
     dev DB 는 check_ins.prescription_items 배열이 전부 비어있고(200행) mc rx 는 24행(E2E)만 존재 →
     그 고객만 값 표시, 나머지는 데이터 부재로 '없음'(graceful, AC-4).
   - **생년월일** = 로더 경로 정상(birth_date → 주민번호 복호화 파생). **dev DB 데이터 부재**:
     birth_date 6/705 채움, `rrn_decrypt` 가 전원 `null`(dev 에 RRN 미입력) → dev 에선 '없음'.
     prod 는 RRN 입력 시 동일 헬퍼(`deriveBirthYYMMDDFromRrn`, 출력서류 T-20260601 DOC-PRINT-8FIX 에서 검증됨)로 생년월일 산출됨.

## 판정
**AC-2 = 배포된 자매 수정(DOCFORM-AUTOFILL)으로 이미 해소.** 잔존 코드 단절 없음.
3필드는 실 SSOT 에 결선되어 있고, 남는 '없음' 은 해당 고객 데이터 부재에 따른 설계된 graceful 표기(AC-4 엣지).
db_change=false(순수 read + pre-fill). 신규 영속 불요 → DA CONSULT 게이트 미해당.

## 방향C 수렴
현 구현 = read-only '환자 자동연동' 참고 박스(편집 불가). 원장 medical narrative 본문(editor SSOT)에는
자동 write 하지 않음 → AC-3(의료법§22·NOSYNC 편집권한 경계)와 정합. 방향C(상용구서식 워크플로우, 대형 스코프)로
확장하지 않음 — 본 티켓의 '기본 데이터 자동연동' 좁은 해석 범위에서 종결.

## 후속
- 코드 변경 없음 → deploy-ready 아님.
- planner 에 수렴(FOLLOWUP) 보고: AC-2 는 자매 배포로 종결, 현장 재확인은 prod(RRN 입력된 실환자)에서 갤탭 확인 권장.
