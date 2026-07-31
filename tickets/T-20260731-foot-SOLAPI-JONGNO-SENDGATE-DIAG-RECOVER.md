---
id: T-20260731-foot-SOLAPI-JONGNO-SENDGATE-DIAG-RECOVER
domain: foot
priority: P1
status: deploy-ready
summary: 종로 발톱 수동 문자발송 '설정 미완료' 오류 진단·복구 — READ-ONLY, fail-closed. 판정=케이스(B) enabled=false 안전잠금.
created: 2026-07-31
assignee: dev-foot
qa_result: pass
deploy_commit: 77fa9325876c
deployed_at: n/a (EF-only — supabase functions deploy 별도, supervisor QA 후 실측 마킹)
bundle_hash: n/a (ef_only — FE 번들 무변경)
db_change: false
e2e_spec_exempt_reason: ef_only
sibling_dup: T-20260731-foot-MSGSET-SENDBLOCK-RECOVER (동일 과업, 코드/evidence 트레이스 태그)
parent: T-20260730-foot-SOLAPI-JONGNO-VAULT-ACTIVATE (step5 실환자 게이트 개방 = 총괄 go human_pending)
---

# T-20260731-foot-SOLAPI-JONGNO-SENDGATE-DIAG-RECOVER

## 요청
종로(오블리브의원 서울오리진점, `jongno-foot` / `74967aea`) 수동 문자발송 시 "설정 미완료(연결/발신번호 미설정) — 메시지 설정에서 먼저 저장하세요" 오류로 발송 차단. READ-ONLY 우선·fail-closed(실발송 0)로 원인을 A/B 판별하고 복구.

- (A) 연결정보·발신번호 미저장 → 저장 복구
- (B) self-halt(`enabled=false`) 안전잠금이 UI 오류로 표출 → **enabled 토글 금지, 보고만**

## 진단 결과 (READ-ONLY, 2026-07-31 live DB 재확인)
| 필드 | 값 | 판정 |
|------|----|------|
| enabled | **false** | ★차단 트리거 = 안전잠금(운영 self-halt) |
| sender_number | `0269563225` (02-6956-3225) | ✅ 저장됨 |
| solapi_api_key_vault_name | `solapi_api_key_74967aea` | ✅ present |
| solapi_secret_vault_name | `solapi_secret_74967aea` | ✅ present |
| solapi_validation_status | `pending` | 통과(not_registered 아님) |
| updated_at | 2026-07-30T12:03:20+00 | 07-29~30 계정 교체(26041010278719) 반영 시각 그대로 |

**판정 = 케이스 (B).** 연결정보·발신번호·vault 는 모두 저장 완료(→ A의 저장복구 불필요), 남은 유일 차단은 `enabled=false` 안전잠금. `enabled=true` 전환 = 실환자 개방과 동치 → 부모 step5(총괄 go) human_pending 이므로 **dev 무단 전환 금지**.

## 게이트 정합
- 별도 recipient-level self-halt 코드 없음 → 운영 self-halt = 이 `enabled=false` 토글 그 자체.
- FE `canSend` 는 enabled 에 비의존(phone/body/template) → 버튼은 클릭 가능하나, **실 발송 게이트는 EF `enabled` 에서 fail-closed 차단**(권위 지점). 저장 복구가 실발송을 여는 구조 아님 → **게이트 정합 SOUND**.

## 조치 (코드, db_change=false, EF-only)
- `send-notification` EF `manual_send` 게이트: `!enabled`(비활성화) ↔ 연결/발신번호 미설정을 2분기로 분리 → 현장 문구 정확화("비활성화되어 있습니다. 활성화를 켠 뒤 저장" vs "미설정. 먼저 저장"). **enabled 토글 미변경(fail-closed 유지).**
- regress: `manual-send-config-gate.regress.test.ts` (5 pass, 결정부 미러).
- `.gitleaks.toml`: vault-name(포인터 식별자) 오탐 allowlist 1줄.
- evidence PHI redaction: 실환자 성명·phone 삭제(§4.3 customer_id-only), 송도 발신번호 마스킹.

## 검증
- deno regress 5 pass / `deno check` EF OK / `npm run build` OK.
- E2E 면제 사유 `ef_only`: EF 문구분기 변경이며 fail-closed(실발송 0) 원칙상 live-send E2E 불가 → 순수 결정부 미러 회귀로 대체.

## 남은 조치 (dev 범위 밖 / go 게이트)
- 실발송까지 남은 유일 조치 = `enabled=true` 전환(설정>메시지 '발송 활성화' ON 후 저장) = 실환자 개방과 동치 → **총괄 go(planner 경유) 후에만.** dev 미수행.
- go 시점: 개방 직후 dev 내부 승인 수신번호 1건 스모크 → 확인 → 총괄이 실환자 발송(dev 실발송 미수행).

## PHI
환자 실명·phone 하드코딩 0 / 실발송 0. 테스트=순수 결정부 미러(발송 경로 미호출).
