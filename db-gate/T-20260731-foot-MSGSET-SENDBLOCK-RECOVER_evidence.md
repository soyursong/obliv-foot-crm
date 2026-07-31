# T-20260731-foot-MSGSET-SENDBLOCK-RECOVER — 진단·복구 증거 (READ-ONLY 진단, db_change=false)

> ⚠ DEDUP/LINKAGE: 본 증거의 과업은 planner 배정 티켓 **T-20260731-foot-SOLAPI-JONGNO-SENDGATE-DIAG-RECOVER** 와 **동일 과업(중복 티켓)**이다. 코드/테스트/evidence 는 선행 sibling ID(MSGSET-SENDBLOCK-RECOVER)의 트레이스 태그를 유지하되, deploy-ready 마킹·리포트는 배정 ID(SOLAPI-JONGNO-SENDGATE-DIAG-RECOVER) 기준으로 수행한다(planner FOLLOWUP 에 dedup 통지).
>
> ★ 2026-07-31 live DB 재확인(READ-ONLY, dev-foot): enabled=false / sender_number=0269563225 ✅ / vault 2종 present ✅ / validation=pending / updated_at 07-30T12:03 그대로 → **진단 stale 아님, 케이스(B) 확정 유지.**

- 도메인: foot / 대상: 오블리브의원 서울오리진점(jongno-foot, clinic_id `74967aea-a60b-4da3-a0e7-9c997a930bc8`)
- 진단 방식: Supabase Management API `/database/query` (SELECT only). prod ref `rxlomoozakkjesdqjtvd`.
- 실행자: dev-foot / 일시: 2026-07-31

## 현장 증상
총괄님(서울오리진점) 고객차트 → 수동 문자 즉시발송 시도 시 "…(연결/발신번호 미설정). 메시지 설정에서 먼저 저장하세요" 로 발송 버튼 차단. 대상 = 실환자 1인(성명·phone 은 PHI-redaction §4.3 에 따라 evidence 에 미기재 — customer_id 로만 참조).

## 진단 결과 — clinic_messaging_capability (서울오리진점)
| 필드 | 값 | 판정 |
|------|----|------|
| enabled | **false** | ★차단 트리거 |
| sender_number | `0269563225` (02-6956-3225) | ✅ 저장됨 |
| solapi_api_key_vault_name | `solapi_api_key_74967aea` | ✅ 존재·resolve(len 16) |
| solapi_secret_vault_name | `solapi_secret_74967aea` | ✅ 존재·resolve(len 32) |
| solapi_validation_status | `pending` | 통과(not_registered 아님) |
| updated_at | 2026-07-30 12:03:20+00 | vault 교체 시각과 일치 |

- vault.decrypted_secrets: 두 시크릿 모두 `has_value=true`, updated_at 07-30 12:03 = **07-29~30 Solapi 계정 교체(26041008595272→26041010278719)가 Vault·capability 에 정상 반영됨**. 발신번호·vault name·시크릿 모두 온전.

## 원인 판별 (AC-2)
- **cause = (a) config-state — 구체적으로 `enabled=false` (발송 활성화 토글 OFF).** 나머지 연결정보·발신번호는 이미 저장 완료.
- send-notification EF `manual_send` 게이트(index.ts)는 `!enabled` 를 **가장 먼저** 검사 → enabled=false 이면 "미설정…먼저 저장" 문구로 표출. 발신번호가 이미 있음에도 "미설정"으로 안내돼 현장 혼선 유발(→ 본 티켓에서 문구 분리 수정).
- **별도의 recipient-level self-halt 코드는 존재하지 않음.** EF 전 경로 grep 결과 수신번호 allowlist/dev-number/HALT env 없음. 즉 운영 self-halt(실환자 잠금) = 이 `enabled=false` 토글 그 자체. `enabled=true` 전환 = 모든 수신자(실환자 포함) 수동 발송 개방 = **self-halt 실환자 개방** 과 동치(수신자별 코드 게이트 없음).
- test_sms 경로는 `enabled` 를 검사하지 않음 → 개발팀 내부테스트(02-6956-3225→이광현 팀장, 07-30) 수신 성공은 정상. 동일 provider→vault→발신번호→Solapi 경로가 온전함을 입증.

## 발신번호 귀속 확인 (AC-1 ⚠)
- 02-6956-3225(`0269563225`) = 서울오리진점(jongno-foot) 발신번호. 서울오리진점 = **종로점**(slug `jongno-foot`)이므로 "종로 개통 테스트 번호"와 동일 = 동일 센터. 송도(songdo-foot)는 별도 발신번호(`010-3457-****`, 마지막4 마스킹). → **귀속 정합, 오센터 발송 위험 없음.**

## 복구 상태 (AC-3 / AC-5)
- 연결정보·발신번호·Vault: **이미 저장·resolve 완료(복구 불요).**
- 발송 가능까지 남은 유일 조치 = `enabled=true` 전환("메시지 발송 활성화" 토글 ON 후 저장) — 이는 실환자 개방과 동치이므로 **dev 임의 전환 금지, 총괄 go 게이트(planner 경유) 대기.**
- FE `canSend` 는 enabled 에 의존하지 않음(phone/body/template) → 버튼은 이미 클릭 가능. 실제 발송 성공 게이트만 EF enabled.

## 스모크 (AC-4)
- provider 경로 스모크 = **PASS** (test_sms → 이광현 팀장 수신, 07-30, manual_send 와 동일 apiKey/secret/senderNumber 경로).
- manual_send 고유 스모크(개발팀 수신번호)는 enabled=true 필요 → self-halt 개방과 동치이므로 **go 시점에 함께 수행**(개방 직후 dev 번호 1건 → 확인 → 총괄이 실환자 발송). 실환자 발송은 dev 미수행.

## 코드 변경 (부수, db_change=false)
- send-notification EF `manual_send` 게이트: `enabled=false`(비활성화) ↔ `연결/발신번호 미설정` 2분기 분리 → 현장 문구 정확화("비활성화되어 있습니다. …활성화를 켠 뒤 저장" vs "미설정. 먼저 저장").
- regress test 신규: `manual-send-config-gate.regress.test.ts` (5 pass).
