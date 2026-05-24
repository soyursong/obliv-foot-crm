---
id: T-20260523-foot-PENCHART-FORM-AUTOFILL
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: ""
commit_sha: "f0515e7"
qa_result: pass
qa_grade: Yellow
deployed_at: "2026-05-24T03:38:39+09:00"
deploy_commit: "179795c"
bundle_hash: "CustomerChartPage-f4WX0pYc.js"
field_soak_until: "2026-05-25T16:15:00+09:00"
created: 2026-05-23 23:00
completed: 2026-05-23 23:30
deadline: 2026-05-27
assignee: dev-foot
reporter_slack_id: U0ATDB587PV
slack_channel: C0ATE5P6JTH
related_tickets:
  - T-20260523-foot-PENCHART-PEN-SLOW
  - T-20260522-foot-PENCHART-REFUND-AUTOFILL
risk_verdict: GO_WARN
risk_note: "AC-R5 좌표 재보정 완료(f0515e7). 실기기 시각 확인 현장 배포 후 필요."
re_qa_at: "2026-05-24T07:45:00+09:00"
re_qa_result: pass
re_qa_bundle_hash: "CustomerChartPage-DtCQgKC8.js"
slack_deploy_notification_ts: "1779576451.982619"
reopen_deploy_notification_ts: "1779605260.964899"
reopen_commit_sha: "179795c"
reopen_reason: "MSG-20260524-110842-pnuu: AC-8 A안 확정 + AC-R4 서명란 제거 + AC-R5 좌표 스펙"
reopen_at: "2026-05-24T11:30:00+09:00"
reopen3_commit_sha: "8bb8186"
reopen3_reason: "MSG-20260524-191911-roce: AC-R6 성함+주민번호 1줄 inline 배치 + 폰트 축소"
reopen3_at: "2026-05-24T19:30:00+09:00"
reopen4_commit_sha: "f0515e7"
reopen4_reason: "AC-R5 환불동의서 좌표 전수 재보정 — P1 y 46px 수정(155→201,188→236) + P3 날짜 년/월/일 분리 배치"
reopen4_at: "2026-05-24T20:00:00+09:00"
---

# T-20260523-foot-PENCHART-FORM-AUTOFILL

환불동의서 자동채움 위치 보정 + 연락처 제거 + 펜차트 양식 성함/주민번호 연동

## 배경

PUSH MSG-20260523-225253-2zj9 (planner, P2→P1, 김주연 총괄 직접 보고).
보험차트 고객정보 필수 → 현장 긴급도 반영.

## 변경 내역

### PenChartTab.tsx

1. **AutofillFields 인터페이스**: `phone` 제거 → `chartNumber` 추가
2. **REFUND_AUTOFILL_POS 분리**:
   - `REFUND_AUTOFILL_POS_P1`: page 1 (차트번호·환자이름) 좌표 신규
   - `REFUND_AUTOFILL_POS_P3`: page 3 서명 섹션 (phone 제거, 3필드)
3. **PENCHART_AUTOFILL_POS**: 펜차트 양식 성함·생년월일 좌표 신규
4. **`drawAutofillOnCtx` 시그니처**: `positions` 파라미터 추가 (범용화)
5. **`initBgCanvas`**: refund_consent → P1+P3 2회, pen_chart → PENCHART 1회
6. **autofillDataRef useEffect**: `customerChartNumber` 연동, `phone` 제거
7. **Props**: `customerChartNumber?: string` 추가, `customerPhone` deprecated 유지 (하위 호환)

### CustomerChartPage.tsx

- `customerChartNumber={customer.chart_number?.toString() ?? undefined}` prop 전달 추가

## AC

- AC-1: 연락처(phone) 자동채움 제거
- AC-2: 환불동의서 page 1 — 차트번호 + 환자이름 자동채움
- AC-3: 환불동의서 page 3 — 날짜·성명·생년월일 (phone 없음)
- AC-4: 펜차트 양식 — 성함·생년월일 자동채움
- AC-5: `customerChartNumber` 신규 prop — CustomerChartPage에서 chart_number 전달
- AC-6: 빌드 OK

### REOPEN 추가 AC (MSG-20260524-110842-pnuu)

- AC-8: 주민번호 A안 전체 표시 확정 — `rrnFull` 상태 추가, `customerRrn=rrnFull` (commit `5798b62`)
- AC-R4: 환불동의서 하단 서명란 제거 — SignaturePad import/UI/상태 전체 삭제, REFUND_AUTOFILL_POS_P3 name 제거 (commit `179795c`)
- AC-R5: 환불동의서 autofill 좌표 코드레벨 스펙 — P1/P3 범위 단언 + name 제거 소스 검증 (commit `179795c`)

## 주의 (GO_WARN)

page 1 (chartNumber x=225 y=190 / name x=225 y=240) 및 펜차트(name x=165 y=68 / birthDate x=420 y=68) 좌표는
refund_consent.png·pen_chart_form.png 300DPI 원본 픽셀 측정 없이 레이아웃 추정값.
supervisor QA에서 실제 양식 렌더 확인 후 좌표 보정 필요.

## 독립 재검증 (2026-05-24T07:45:00+09:00)

supervisor 재검증 통과. 최초 QA(03:48 KST, 5358afd) 결과 유효 확인.

| 항목 | 결과 | 비고 |
|------|------|------|
| C5 빌드 | PASS | 3.55s, exit 0 |
| C1 env 매트릭스 | PASS | VITE_SUPABASE_URL·VITE_SUPABASE_ANON_KEY 2종 — 운영 bundle grep 매치 |
| E2E spec | PASS | 27/27 (17.5s) — AC-1~12 전체 커버 |
| Phase 7.5 Runtime Safety | PASS | for-of positions: const배열 null불가 / val if-guard / autofillDataRef.current 체크 / customerRrn??'' 가드 |
| 운영 bundle 확인 | PASS | CustomerChartPage-DtCQgKC8.js — customerRrn·rrn_decrypt·3071·3206 grep 4건 |
| 브라우저 smoke | PASS | 로그인 화면 정상 렌더 (white-screen 없음) |
| DB/RLS/Cross-CRM | N/A | db_change: false |
| 배포 알림 | 발송 | <@U0ATDB587PV> C0ATE5P6JTH thread:1779543851.547859 → ts:1779576451.982619 |

**판정: Yellow GO_WARN 유지** — PII(주민번호) B-lite 마스킹 정책 현장 확인 필요. bundle_hash 변경(88tiC3Zn→DtCQgKC8)은 후속 5 commits(SPACE-DASH-SYNC 등) 반영에 의한 정상 갱신.

## REOPEN QA 최종 검증 (2026-05-24T16:15:00+09:00) — conductor KICK N=1 처리

supervisor 재검증. reopen_commit 179795c (AC-8 A안 + AC-R4 + AC-R5) 최종 QA PASS.

| 항목 | 결과 | 비고 |
|------|------|------|
| C5 빌드 | PASS | 3.37s, exit 0 |
| C1 env 매트릭스 | PASS | 신규 env var 없음 (순수 프론트엔드 변경) |
| E2E spec | PASS | 33/33 (17.2s) — AC-1~12 + AC-R4 + AC-R5 전체 커버 |
| Phase 7.5 Runtime Safety | PASS | for-of: const배열/length>0 가드 / autofillDataRef.current null체크 / customerRrn??'' / rrnFull??undefined |
| 운영 bundle 확인 | PASS | CustomerChartPage-f4WX0pYc.js (274KB) — customerRrn(2건) + 3071(1건) grep 확인. 3206 없음=AC-R4 name제거 정상 |
| 브라우저 smoke | PASS | https://obliv-foot-crm.vercel.app/ 200 OK, white-screen 없음 |
| DB/RLS/Cross-CRM | N/A | db_change: false |
| AC-R4 서명란 제거 | PASS | SignaturePad import 없음, REFUND_AUTOFILL_POS_P3 date만 유지 |
| AC-8 A안 (rrnFull) | PASS | CustomerChartPage rrnFull 상태(slice포맷) → PenChartTab customerRrn 전달 |

**최종 판정: Yellow GO (deployed)** — AC-8 A안(주민번호 전체표시)은 현장 확정(김주연 총괄). 실기기 좌표 시각 확인은 field-soak 중 현장 자체 검증. field_soak_until: 2026-05-25T16:15:00+09:00.
