---
id: T-20260729-foot-PWRESET-EMAIL-LINK-BLOCKED-DANGEROUS
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-passed: "OK — npm run build ✓ built in 6.11s (template/config 변경은 FE 번들 무접촉이나 회귀 확인차 풀빌드 PASS)."
db-change: false
e2e-spec: "tests/e2e/T-20260729-foot-PWRESET-EMAIL-LINK.spec.ts — prod recovery template 불변식 회귀 가드(G1 anchor / G2 가시 URL fallback / G3 Korean). 2 passed (7.4s). SUPABASE_ACCESS_TOKEN 미설정 환경 skip(config-gated)."
commit: PENDING_SUPERVISOR_MERGE
reporter: planner
created: 2026-07-29
risk_verdict: GO
risk_reason: "변경 격리 = supabase/templates/recovery.html(신규) + supabase/config.toml [auth.email.template.recovery] 섹션(신규) + tests/e2e spec(신규) + evidence + 본 티켓. 실 prod 반영 = Supabase Auth 메일러 config PATCH(mailer_templates_recovery_content/subject) 1건 — reversible·DB무접점(db_change=false, 신규 컬럼·테이블·enum 0 → DA CONSULT 불요)·ef_only(EF 코드/스키마/비즈로직 무변경). FE·DB·EF 무접촉 → 적재/매출/동선 회귀 0. 롤백 = evidence/AC6-original-recovery-template-ROLLBACK-BASE.json 의 원본 content 를 동일 PATCH 로 복원."
rc_finding: "H2(anchor 미포함) = DISCONFIRMED. 원본 recovery template 이미 <a href=\"{{ .ConfirmationURL }}\">Reset Password</a> anchor 보유. runtime probe(admin generate_link type=recovery, throwaway user) → action_link well-formed https(rxlomoozakkjesdqjtvd.supabase.co) + redirect_to=https://obliv-foot-crm.pages.dev → 링크 생성 정상. 실 증상('클릭 불가 단순 텍스트') RC = 수신측 메일 클라이언트 text/plain 렌더(anchor→라벨 텍스트 붕괴, URL 소실) 또는 링크 스캐너 flatten 로 추정 — 정본 RC 확정엔 pk.choi 수신 메일 raw(.eml) 필요."
remediation_type: "defensive hardening (not confirmed-RC fix). anchor 버튼 유지 + 원본 URL 가시 fallback(flatten/text-only 클라이언트 복사용) + Korean 로컬라이즈. 어느 클라이언트에서도 사용자 행동 가능하도록 링크 실패 클래스를 방어."
field_confirm_gate: "required — 풋 §10: green build·spec PASS 를 종결 근거로 쓰지 않음. 테스트 계정 실 재설정 메일 수신→'비밀번호 재설정' 클릭/URL 복사 가능 렌더 실측(responder 경유 현장 confirm) 후에만 done. pk.choi 실계정 재발송 불요(우회 링크 A 로 이미 로그인 가능, 불필요 토큰 무효화 방지)."
followup: "① 정본 RC 확정용 pk.choi 수신 메일 raw(.eml) 확보(현장 '원본 보기') — planner 라우팅. ② FE recovery deep-link 핸들러 부재(PASSWORD_RECOVERY 이벤트/전용 set-new-password 라우트 없음 → recovery 링크 클릭 시 site_url 루트 착지, 재설정 화면 미노출) = 별도 후속 티켓 대상(redirect/route 근본개선)."
---

# T-20260729-foot-PWRESET-EMAIL-LINK-BLOCKED-DANGEROUS

**출처**: planner FIX-REQUEST MSG-20260729-095353-4n1f (pk.choi 비번재설정 스레드 1784708681.507149 4번째 접촉, H2 수렴). §13.1.A anti-churn — 기존 진단 티켓 fold.

## 진단 결과 (RC-first)

| 가설/점검 | 결과 | 근거 |
|-----------|------|------|
| **H2 — recovery template anchor 미포함** | **DISCONFIRMED** | 원본 template 이미 `<a href="{{ .ConfirmationURL }}">Reset Password</a>` 보유 (evidence AC6 ROLLBACK-BASE). |
| ConfirmationURL 유효성 | OK | runtime probe(throwaway user, admin generate_link) → well-formed https + 올바른 redirect 도메인. |
| 실 증상 RC | 추정(미확정) | 수신측 클라이언트 text/plain 렌더 / 링크 flatten. 정본 확정 = pk.choi .eml 필요. |
| FE recovery deep-link 핸들러 | 부재 (별도 후속) | `/reset-password` 라우트·`PASSWORD_RECOVERY` 핸들러 없음 → 클릭 시 site_url 루트 착지. |

## 처방 (AC#6)

- **anchor 부재 아님 → 단순 추가 no-op**. 대신 링크-실패 클래스를 방어하는 **하드닝**:
  1. anchor 버튼 유지(HTML 클라이언트 클릭 가능)
  2. 원본 `{{ .ConfirmationURL }}` 을 **가시 텍스트 fallback** 으로 노출(flatten/text-only 클라이언트 복사-붙여넣기 가능)
  3. Korean 로컬라이즈 + foot teal-emerald 테마
- dashboard-only 였던 template → repo version-control(`supabase/templates/recovery.html` + `config.toml`).
- 원본 template 전문 evidence 보존(롤백 근거).

## 검증

- **AC#6**: prod PATCH 200 + re-GET 검증 — anchor✓ / 가시 URL fallback✓ / Korean✓.
- **AC#7(테스트계정 링크 생성 실측)**: throwaway user recovery link 생성 정상(위 probe). **실 메일 수신 렌더 실측 = 현장 confirm 게이트(field_confirm_gate)로 위임** — 풋 §10.
- **우회(A)**: 이미 완료(admin generateLink 슬랙 공유). 본 티켓 = 이메일 경로 방어 하드닝.

## 잔여/후속

- `followup` frontmatter 참조 — ① pk.choi .eml 정본 RC 확정, ② FE recovery deep-link 핸들러 별도 티켓.
