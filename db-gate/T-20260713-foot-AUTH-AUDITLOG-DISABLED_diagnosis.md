# T-20260713-foot-AUTH-AUDITLOG-DISABLED — 진단 결과 (READ-ONLY)

**진단자**: dev-foot · **일시**: 2026-07-13 · **대상**: foot prod GoTrue (rxlomoozakkjesdqjtvd)
**방식**: READ-ONLY. Supabase Management API `database/query`(read_only) + `config/auth` + `analytics/logs`. prod 쓰기 0.
**스크립트**: `scripts/T-20260713-foot-AUTH-AUDITLOG-DISABLED_diag.mjs`(RPC 경로, 부재확인) / `_diag2.mjs`(Management API 경로, 사용).

---

## 결론 (1줄)
`auth.audit_log_entries` 24h/전체 0건의 근인은 **GoTrue 설정 `audit_log_disable_postgres = true`** — GoTrue가 Postgres 감사테이블에 **의도적으로 미기록**하도록 설정됨(Supabase 플랫폼 기본값). 감사 이벤트는 **Logflare(대시보드 Logs>Auth)로만** 흐르며 테이블은 legacy로 남아 비어있음. **로깅이 죽은 게 아니라 기록 경로가 DB테이블→플랫폼로그로 이관된 상태.**

---

## AC-1: OFF 원인 특정 + 근거
- **원인**: GoTrue config `audit_log_disable_postgres = true` (foot prod 확인).
- **감별 근거 (저트래픽/prune 배제)**:
  - `auth.audit_log_entries`: **total_all = 0** (24h만이 아니라 **전 기간 0건**, oldest/newest = null).
  - 동시각 `auth.users`: 48명, **최근 24h 로그인 17명 / 7d 27명 / 24h updated 30명, 마지막 로그인 = 진단시각 수분 전**.
  - → 로그인 이벤트는 대량 실재하는데 테이블만 0 → "저트래픽" 아님. total=0 & oldest=null → "보존기간 만료(prune)"도 아님(prune이면 과거행 흔적 존재). **미기록(OFF)로 확정.**
  - Logflare `auth_logs` 조회 시 이벤트 반환(count>0) → 감사 파이프라인 자체는 **생존**. 경로만 다름.

## AC-2: 활성화 방식 + 영향(스토리지·성능·PII)
- **활성화 방식**: **config-only** — GoTrue 설정 `audit_log_disable_postgres`를 `false`로 (Supabase 대시보드 Auth 설정 또는 Management API `PATCH /v1/projects/{ref}/config/auth`). **스키마 변경·마이그레이션 불요**(`auth.audit_log_entries` 테이블 이미 실재, regclass 확인). → **MIG-GATE 비대상**.
- **스토리지**: 활성화 시 로그인/로그아웃/**토큰 리프레시(세션당 ~1h 주기)**/유저변경 등 매 auth 이벤트마다 INSERT. auth.audit_log_entries는 **Supabase 자동 prune 없음 → 무한 증가**. 활성화 시 **보존/정리 잡 동반 필수**.
- **성능**: auth 이벤트당 INSERT 1건 추가 — 현 규모(48유저)에서 무시가능.
- **PII**: 과거 GoTrue audit payload는 `actor_id`, `actor_username`(=이메일), `action`, ip 등 적재. **비밀번호 평문은 미적재**(GoTrue 설계상). 이메일은 감사목적상 내재 필드. `auth` 스키마는 PostgREST 미노출 → **service_role/admin만 접근**(접근통제 이미 존재). 현재 테이블 0건이라 평문 PII 잔존 스캔 결과도 0건.

## AC-3: cross-CRM 대조
| CRM | audit_total | audit_30d | users | 7d 로그인 | `audit_log_disable_postgres` |
|-----|-------------|-----------|-------|-----------|------------------------------|
| foot | 0 | 0 | 48 | 27 | **true** |
| crm-long | 0 | 0 | 95 | 35 | **true** |
| body | 0 | 0 | 40 | 20 | **true** |
| derm | 0 | 0 | 32 | 26 | **true** |
| women | 0 | 0 | 4 | 1 | (default) |
| scalp | 0 | 0 | 26 | 16 | (default) |
- **6개 전 프로젝트 동일**: 로그인 활발하나 audit_log_entries 전부 0. **foot 고유 결함 아님 — Supabase org 전체 플랫폼 기본 동작.** Supabase가 감사기록을 성능·스케일 이유로 Postgres테이블→Logflare로 이관한 결과.

## AC-4: 권고 (GO/조건부/HOLD) + 실행 스코프
**판정: 조건부 GO (CONDITIONAL-GO)** — 다만 "테이블 켜기"가 원래 문제(FACEOFANGEL actor 추적불가)를 완전히 해결하지 못함에 유의.

- **실행 스코프**: config-only 1항목(`audit_log_disable_postgres=false`). 스키마/마이그 무변경 → MIG-GATE 불요. 대시보드 Auth 설정 or Management API PATCH.
- **조건**:
  1. **보존/정리 잡 동반**(무한증가 방지) — 예: 90일 초과 행 주기 삭제.
  2. **접근통제 유지**(auth 스키마 비노출 상태 유지 — 이미 충족).
  3. **이메일 외 민감정보 재확인**(활성화 후 첫 payload 표본검사, 평문 password/token 없음 재확증).
- **중요 한계 (actor 추적)**: FACEOFANGEL 비번 재설정이 **service_role 스크립트/Admin API**로 수행됐다면, Postgres 감사를 켜도 actor가 `null`/service로만 남아 **"어느 사람이 눌렀는지"는 여전히 미상**. 근본 해결은 (a) destructive auth 조치를 **로그인된 admin 세션**으로만 수행 + (b) Cross-CRM Auth Identity Resolution 표준의 앱레벨 actor 기록. → 테이블 활성화는 "이벤트/시각" 추적은 개선하나 "행위 사람" 귀속은 별도 보강 필요.
- **대안 (권고 우선순위)**: 즉효는 **Logflare 감사로그 보존기간 확대 + 조회 SOP화**(이미 데이터 존재, 경로만 부재). Postgres 테이블 활성화는 장기 SQL-조인 감사가 필요할 때.

---
## 후속 (planner)
- 활성화 실행은 **별도 스코프 티켓**으로(config PATCH + 보존잡). 본 티켓은 진단·권고까지.
- actor 귀속 근본해결은 Cross-CRM Auth Identity Resolution 표준 라인의 app-level audit로 승계 검토.
