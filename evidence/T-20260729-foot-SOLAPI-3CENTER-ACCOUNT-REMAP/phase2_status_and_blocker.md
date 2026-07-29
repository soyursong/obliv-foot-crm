# T-20260729-foot-SOLAPI-3CENTER-ACCOUNT-REMAP — 착수전 실증 + 블로커 + Phase2 현황

생성: 2026-07-29 (dev-foot, read-only 실증. prod vault write 미실행 — 착수전 게이트 준수)
근거 스크립트: `scripts/T-20260729-foot-SOLAPI-3CENTER-ACCOUNT-REMAP_readonly_diag.mjs`
방법: Supabase get_vault_secret RPC(값 미출력) + SolAPI `/cash/v1/balance`·`/senderid/v1/numbers` (READ-ONLY, 발송·과금 없음)

## 1. 이관방식 확정
- **(a) COPY 채택** (move/재발급 아님). no-DDL → DA 게이트 불요.
- 근거: move 시 송도 발송 공백. copy → 종로 검증 → (송도 credential 도착 시) b4dc0de5 overwrite 순.

## 2. vault ↔ 계정 실매핑 (핵심)

| vault slot | 사용 지점(현재) | SolAPI accountId | 잔액 | 비고 |
|---|---|---|---|---|
| `solapi_api_key_74967aea` | 종로(74967aea) | **26041008595272** | **7.47원** | 잘못된 계정 + 잔액 고갈 → 종로 문자 사실상 중단 |
| `solapi_api_key_b4dc0de5` | 송도(b4dc0de5) | **26041010278719** (박영진=목표) | 442,9xx원 | 티켓 전제 정확 |

- 종로 clinic_messaging_capability는 **이미** `solapi_api_key_74967aea` / `solapi_secret_74967aea` 를 가리킴.
  → 목표 달성에 **capability 변경 불필요, vault 값 overwrite(copy)만 필요.**

## 3. 🔴 블로커 — 발신번호 사전등록 갭

| SolAPI account | 등록 발신번호(status) |
|---|---|
| 26041008595272 (종로 현재) | 010-8827-****(종로발신) (ACTIVE) |
| 26041010278719 (박영진=목표) | 010-3457-****(송도발신)(ACTIVE), 02-6956-**(A)(ACTIVE), 02-6956-**(P)(PENDING) |

- 종로 발신번호 **010-8827-****(종로발신) 은 목표계정(26041010278719)에 미등록**.
- 발신번호 사전등록제상, vault copy만 하면 종로가 미등록 발신번호로 발송 → **거부**됨.
- **copy 단독으로는 목표 미달성.**

### 필요 조치 (planner→responder→현장)
1. 박영진이 SolAPI 콘솔에서 **010-8827-****(종로발신) 을 계정 26041010278719 에 발신번호 등록**(ARS/서류). 또는
2. 종로가 목표계정 기등록 번호를 사용하도록 sender_number 변경 결정.
- 위 결정 확정 후 dev-foot: vault copy(+기존 74967aea 값 백업 스냅샷) → accountId 재확인 → 발송 스모크 → deploy-ready.

## 4. Phase2 현황 (부가)

### A. clinic_messaging_capability
- 종로: enabled=true, sender=010-8827-****(종로발신), kakao_channel_id=(없음), vault=solapi_api_key_74967aea, valid=pending
- 송도: enabled=true, sender=010-3457-****(송도발신), kakao_channel_id=(없음), vault=solapi_api_key_b4dc0de5, valid=unchecked

### B. 카카오 채널
- 양 지점 모두 `kakao_channel_id` 미설정 → 알림톡 미구성(현재 SMS/LMS만).

### C. 활성 알림 템플릿 (notification_templates: 총 12 중 활성 5)
- 종로: resv_reminder_morning(sms), resv_reminder_d1(sms), resv_confirm(sms)
- 송도: resv_reminder_d1(sms), resv_confirm(sms)

## 5. 보류 상태
- Phase1-② 송도: 신규계정 26072925537740 API Key/Secret 미도착 → 착수 X (supervisor 보안채널 대기).
- Phase1-① 종로: 위 §3 발신번호 결정 대기로 vault write 보류.
