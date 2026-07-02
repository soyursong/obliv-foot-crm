---
id: T-20260702-foot-PROGRESS-CSV-EXPORT
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-07-02
completed: 2026-07-02
db_changed: false
e2e_spec: tests/e2e/T-20260702-foot-PROGRESS-CSV-EXPORT.spec.ts
risk_verdict: GO_WARN
risk_reason: "경과분석 탭 [CSV 다운로드] 신설 — 순수 additive FE(read-only 조회 + 클라이언트 CSV 조립). 스키마/트리거/RPC/비즈로직/발행동선 무변경, 외부0, npm 불요(네이티브 BOM+join). DA CONSULT·대표 게이트 불요. grain=환자×방문(시술일)×시술타입 → package_sessions(status='used', deleted_at IS NULL) 1건=1행(같은날 병행타입 자동 2행). 각 row 는 자기 package_id FK 로만 join(오매핑 0). PHI 가드: 버튼 hasOpsAuthority(admin/manager/대표원장)만 노출·동작 + export 감사로그(actor·시각·환자수·차트번호 범위) 기록. 힐러=레이저 한정 + session_date>=2026-06-14 만 적용/미적용, 그 외 빈 문자열(데이터 부재). 빌드 OK, typecheck OK, spec 14 green(라벨·힐러 3-state·grain·이스케이프·파일명). ⚠ FOLLOWUP 발행: 회차 시맨틱(현재회차=package_sessions.session_number 통합카운터·과잉소진 시 총회차 초과 가능)·code→라벨(podologue=발톱교정/ribbon=각질)·시술부위 coverage(check_in 연결분만)·감사 영속성 = 문원장/총괄 확인 항목(구현은 defensible default)."
author: dev-foot
build_verified: "2026-07-02 — npm run build → ✓ built in 5.23s / tsc -b --noEmit clean"
followups:
  - "planner FOLLOWUP: 회차 시맨틱·시술타입 code→라벨·시술부위 coverage·감사 영속성 4항목 문원장/총괄 확인 요청(구현 defensible default, 조정 시 1-line swap)"
---

# T-20260702-foot-PROGRESS-CSV-EXPORT

## 스펙 (문원장 대표원장 본인 + 총괄 확정)
- 화면: obliv-foot-crm 치료테이블 > 경과분석 탭
- [CSV 다운로드]: 환자 1~N명 선택 → 시술기록 전체 단일 CSV. 파일명 `경과분석_YYYYMMDD.csv`, UTF-8 BOM(엑셀 바로 열림).
- CSV 스키마(grain = 환자 × 방문(시술일) × 시술타입 → 1행):
  1 차트번호 / 2 환자명 / 3 시술일 / 4 시술타입(한글) / 5 세션번호(현재회차) / 6 총회차 / 7 시술부위(R1~L5 저장값) / 8 힐러적용여부

## 구현 (순수 additive FE)
- `src/lib/progressTreatmentCsv.ts` (신규): 헤더·이스케이프·BOM 다운로드·code→한글 라벨·힐러 3-state·감사로그(무의존, customerCsv 패턴 재사용).
- `src/components/treatment/ProgressTargetsSection.tsx`: 상단 툴바에 [CSV 다운로드] 버튼(일괄처리 옆). 선택된 예약 row → 대상 고객 → package_sessions(used) read-only 조회·조립·다운로드.
- 선택 소스 = 경과분석 리스트의 기존 체크박스(selectedIds) 재사용. 선택 0명 시 경고 toast.

## 착수-직후 feasibility 검증 결과 (dev DB 실측 + 코드 SSOT)
- **즉시추출 확인**: 차트번호(customers.chart_number)·환자명(customers.name)·시술일(package_sessions.session_date)·시술타입(package_sessions.session_type)·시술부위(check_ins.treatment_memo.foot_sites) ✔.
- **세션번호/총회차 매핑 = 규명 완료(오염 아님)**: 현재회차=`package_sessions.session_number`, 총회차=`packages.total_sessions`. 각 row 는 **자기 package_id FK 로만** join → 오매핑 0.
  - ⚠ 시맨틱 주의(문원장 확인용): session_number 는 **패키지 전체 통합 카운터(타입 무관)**. 과잉소진 시 `session_number > total_sessions`(dev 실측 13/12) 가능 = 저장값 그대로 = 오염 아님(mis-join 아님). 만약 "타입별 회차(예: 비가열레이저 N번째)"를 원하면 재정의 필요(1-line 변경).
- **시술타입 code→한글 라벨**(문원장 확정 표기 우선): heated_laser=레이저가열 / unheated_laser=레이저비가열 / podologue=**발톱교정**(내성) / ribbon=**각질**(발각질) / preconditioning=프리컨디셔닝 / iv=수액 / trial=체험 / reborn=Re:Born. (podologue↔ribbon 임상 라벨은 코드 SSOT `treatmentRequestCodes.ts` 기준 매핑 — 문원장 확인 항목.)
- **시술부위 coverage**: `check_ins.treatment_memo.foot_sites` = check_in_id FK 연결분만. 챠트 직접차감 등 미연결 session 은 저장 부재 → 빈 문자열(스펙 "저장값 그대로" 준수). treatment_kind 는 전건 null → 타입은 session_type 에서만 취함.
- **힐러적용여부**: `reservations.is_healer_intent`(2026-06-14 도입). 레이저 타입 + session_date>=2026-06-14 → 적용/미적용. 그 외(비레이저/6-14 이전) → **빈 문자열(0/false 아님)**.

## PHI 가드 (GO_WARN 필수 AC)
- [CSV 다운로드] 버튼 = `hasOpsAuthority(profile)`(admin/manager/대표원장) 에서만 노출·동작. 치료사/일반직원 미노출 + 핸들러 이중가드.
- export 실행 시 감사로그 기록: `logProgressCsvExport()` → actor·actorRole·시각·clinicId·환자수·행수·차트번호 범위. 안정 prefix `[PHI-AUDIT][progress-csv-export]`.
  - ⚠ 감사 영속성: 스키마 무변경 제약(신규 감사 테이블 = §S2.4 DA CONSULT 게이트, 본 티켓 scope 밖) → 클라이언트 구조화 감사로 구현. 서버 영속 감사 필요 시 후속 티켓 + DA CONSULT(문원장/총괄 판단).

## 검증
- `npm run build` ✓ (5.23s) / `tsc -b --noEmit` clean.
- E2E: `tests/e2e/T-20260702-foot-PROGRESS-CSV-EXPORT.spec.ts` 14 passed — 라벨 매핑·힐러 3-state(적용/미적용/빈문자열)·방문×타입 grain 2행·헤더 순서·이스케이프·과잉소진 저장값·파일명.
- DOCFORM(이미지업로드+CRM 시트생성) 미접촉 — 순수 additive, 형 게이트 잔존 scope 존중.
