---
id: T-20260523-foot-PENCHART-FORM-AUTOFILL
domain: foot
priority: P1
status: deployed
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: ""
commit_sha: "e86c953"
qa_result: pass
qa_grade: Yellow
deployed_at: "2026-05-24T03:38:39+09:00"
deploy_commit: "e86c953"
bundle_hash: "CustomerChartPage-88tiC3Zn.js"
field_soak_until: "2026-05-25T03:38:39+09:00"
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
risk_note: "page 1 + pen_chart 좌표는 추정값. 현장 육안 보정 필요 (supervisor QA에서 확인)."
re_qa_at: "2026-05-24T07:45:00+09:00"
re_qa_result: pass
re_qa_bundle_hash: "CustomerChartPage-DtCQgKC8.js"
slack_deploy_notification_ts: "1779576451.982619"
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
