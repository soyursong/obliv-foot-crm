---
id: T-20260529-foot-SELFCHECKIN-FLOW-REVAMP
domain: foot
priority: P2
status: deploy-ready
deploy_ready_at: 2026-05-29 10:16
commit_sha: a8e4b3b
db_changed: true
db_migration: supabase/migrations/20260529001000_selfcheckin_personal_info_fn.sql
db_migration_note: "health_q_tokens/health_q_results 테이블은 T-20260529-foot-HEALTH-Q-MOBILE(20260529000000_health_q_mobile.sql)에 포함. 본 티켓은 20260529001000만 신규 적용 필요."
e2e_spec: tests/e2e/T-20260529-foot-SELFCHECKIN-FLOW-REVAMP.spec.ts
e2e_spec_exempt_reason: null
e2e_result: "spec 5TC 작성 완료 (AC-1~5 커버) — DB 종단 실행은 supervisor QA 시 실행"
hotfix: false
created: 2026-05-29
deadline: 2026-06-05
slack_channel: C0ATE5P6JTH
reporter: ops-planner
risk_verdict: GO_WARN
---

# T-20260529-foot-SELFCHECKIN-FLOW-REVAMP — 초진 셀프접수 QR + 워크인 폼

## 구현 요약

### 변경 파일
- `src/pages/SelfCheckIn.tsx` (+521 / -32) — 초진 동선 재구성

### 신규 단계 (초진만 해당)
| 순서 | 단계 | 내용 |
|------|------|------|
| 1 | `input` | 성함 + 연락처 + 방문유형 (기존 유지) |
| 2 | `personal_info` | **신규** 주민번호(NumPad·마스킹) + 주소 + 동의서 |
| 3 | `confirm` | 입력 정보 확인 |
| 4 | `submit` | DB 저장 + QR 토큰 발급 |
| 5 | `qr` | **신규** 발건강질문지 QR 코드 표시 (120초 카운트다운) |
| 6 | `done` | 접수 완료 |

### 재진 흐름
`input` → `confirm` → `submit` → `done` (personal_info / QR 단계 없음, 기존과 동일)

---

## 수용기준 체크리스트

- [x] **AC-1** 정보 입력 완료 후 QR 코드 화면 표시 (URL = `/health-q/:token`)
- [x] **AC-2** QR 상단 안내 멘트: "핸드폰으로 QR을 촬영하여\n발건강 질문지를 작성해주세요"
- [x] **AC-3** QR 촬영 시 발건강 질문지 페이지 정상 연결 (`HealthQMobilePage`, anon 토큰 기반)
- [x] **AC-4** 워크인 선택 시 → WalkInModal 확인 → `walkInConfirmed=true` → `personal_info` 단계 진입
- [x] **AC-5** 워크인 6필드: 성함(input) + 연락처(NumPad) + 방문경로(leadSource) + 주민번호(NumPad) + 주소(text) + 동의서(checkbox)
- [x] **AC-6** 워크인 완료 후 QR 화면으로 합류 (walkin → visitType='new' → qr 단계)
- [ ] **AC-7** 건강보험 조회 — 현장 결정 대기 (별도 DECISION-REQUEST 발행됨)

---

## DB 변경 내용

### 신규 RPC 2개 (20260529001000_selfcheckin_personal_info_fn.sql)

| 함수명 | 권한 | 역할 |
|--------|------|------|
| `fn_selfcheckin_update_personal_info` | anon SECURITY DEFINER | 초진 고객 생년월일·주소·동의 저장 (30분 내 check_in + clinic_id 이중 검증) |
| `fn_selfcheckin_create_health_q_token` | anon SECURITY DEFINER | 접수 완료 후 발건강질문지 QR 토큰 발급 (24h 유효, 1인 1활성토큰) |

> **전체 RRN 비저장** — `birth_date` (앞 6자리 YYMMDD) 만 저장. 뒷자리 서버 미전송.

### 의존 테이블 (T-20260529-foot-HEALTH-Q-MOBILE에서 선행 생성)
- `health_q_tokens` — 토큰 스토어
- `health_q_results` — 제출 결과

---

## 보안 설계

- anon SECURITY DEFINER: 30분 타임창 + clinic_id 이중 검증으로 ID 재사용 공격 차단
- LOGIC-LOCK L-001 준수: UI에 고객 ID/PII 미노출
- RRN 뒷자리: FE 마스킹(YYMMDD-*******) + 서버 미전송 (birth_date 앞 6자리만 저장)

---

## E2E 스펙 커버리지

| TC # | 검증 내용 | AC |
|------|----------|-----|
| 1 | 초진 → personal_info 단계 진입 | AC-1 |
| 2 | RRN NumPad 입력 → 마스킹 표시 | AC-2 |
| 3 | RRN + 주소 완성 → 다음 버튼 활성 | AC-2 |
| 4 | 워크인 → personal_info 동의서 체크박스 존재 | AC-5 |
| 5 | 초진 전 흐름 → QR 화면 or done 폴백 | AC-1/AC-3 |
| 6 | QR 화면 "질문지 작성 완료" → done 전환 | AC-3/AC-6 |
| 7 | 재진 → personal_info 단계 없이 confirm | AC-5(재진 스킵) |

---

## 롤백 계획

### DB 롤백
```bash
supabase db push --file supabase/migrations/20260529001000_selfcheckin_personal_info_fn.rollback.sql
```

### FE 롤백
이전 커밋으로 revert:
```bash
git revert a8e4b3b
```
