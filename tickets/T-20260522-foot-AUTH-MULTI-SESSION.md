---
id: T-20260522-foot-AUTH-MULTI-SESSION
domain: foot
priority: P2
status: done
title: CRM 동시접속 로그아웃 조사 — 동일 계정 12명 동시접속 원인 분석
created: 2026-05-22
deadline: 2026-05-29
assignee: dev-foot
db-change: false
deploy-ready: false
build-ok: true
regression-risk: none
e2e-spec: ""
qa_result: investigation-complete
---

# T-20260522-foot-AUTH-MULTI-SESSION — CRM 동시접속 로그아웃 조사

## 현상

현장 보고: CRM 전체적으로 로그인 유지 안 됨.  
당일 직원 12명이 **동일 계정**으로 동시접속 테스트 진행.

---

## 조사 결론: **A) Expected Behavior** — 동일 계정 12명 동시접속이 원인

**코드 변경 없음. DB 변경 없음. 추가 배포 불필요.**

---

## AC 결과

### AC-1: Supabase Auth 동시 세션 정책 확인

**패키지**: `@supabase/auth-js` v2.103.3 (supabase-js ^2.49.1 → 실제 설치 2.103.3)

**`signOut()` 기본 scope = `'global'`** — SDK 소스 확인:
```
// @supabase/auth-js/dist/main/GoTrueClient.js line 3141
async signOut(options = { scope: 'global' }) {
```

#### scope별 동작 차이

| scope | 동작 | 영향 범위 |
|-------|------|-----------|
| `'global'` (기본값) | GoTrue 서버에 POST → 해당 유저의 **모든 refresh token 서버 무효화** | 동일 계정 전체 세션 |
| `'local'` | 로컬 세션만 삭제, 서버 호출 없음 | 해당 기기만 |
| `'others'` | 현재 세션 제외 나머지 무효화 | 다른 기기만 |

**현재 auth.tsx**:
```typescript
// line 112 — scope 미지정 = global
await supabase.auth.signOut();
```

#### GOTRUE_MAX_SESSIONS_PER_USER

Supabase Cloud 관리형 인스턴스는 이 설정을 대시보드로 직접 노출하지 않음.  
기본값은 제한 없음(unlimited). 이 설정이 주요 원인은 아님.

#### Refresh Token Rotation

- 12개 기기 각각 로그인 → 각자 독립 AT + RT 발급 (서로 간섭 없음)
- AT 만료(1시간) 후 각 기기가 독립적으로 refreshSession() 호출 → 정상 (RT가 기기별 독립)
- **BUT**: 어느 기기 1대에서라도 `signOut({ scope: 'global' })` 호출 시 → 해당 계정의 **모든 RT 서버 무효화** → 나머지 11대 다음 refresh 시 401 → SIGNED_OUT cascade

---

### AC-2: 12명 동시접속(동일 계정) 세션 무효화 발생 여부 결론

**YES — 발생하며, Supabase Auth의 설계된 동작(Expected Behavior)**

#### 동작 시나리오 (재현 메커니즘)

```
기기1 ~ 기기12: 동일 계정으로 각자 로그인 → AT_1~AT_12 + RT_1~RT_12 발급
                  (각 RT는 서로 독립적 — 직접 간섭 없음)

1시간 경과 후:
기기1: AT 만료 → refreshSession(RT_1) → 성공 → AT_1_new + RT_1_new
기기2: AT 만료 → refreshSession(RT_2) → 성공 → AT_2_new + RT_2_new
...각 기기 독립 정상 갱신

BUT 어느 한 기기에서:
- 사용자가 [로그아웃] 버튼 클릭 → signOut() → scope:'global'
  → GoTrue 서버: 해당 계정의 모든 RT 서버 무효화 (RT_1 ~ RT_12 전부)
  → 나머지 11개 기기: 다음 AT 만료 시 refreshSession() 호출
  → GoTrue 서버: "이 RT는 이미 revoked" → 401
  → Supabase SDK: SIGNED_OUT 이벤트 발화
  → auth.tsx: refreshSession() 재시도 → 실패 (서버 무효화됨) → getSession() null
  → ProtectedRoute: /login 리다이렉트 (전원 로그아웃)
```

#### SSN-SESSION-KILL / CUST-REG-LOGOUT 배포 후에도 재현?

**YES** — 두 수정은 JWT 만료 시 race condition 방지가 목적.  
동일 계정 global signOut으로 인한 서버측 RT 일괄 무효화는 별개 메커니즘.  
`refreshSession()` 재시도(v2 auth.tsx)도 서버에서 이미 revoked된 RT에는 무력.

---

### AC-3: 현장 회신 내용

아래 내용으로 현장 팀에 안내:

---

**[CRM 로그아웃 원인 확인]**

금일 발생한 CRM 로그아웃 현상의 원인을 조사했습니다.

**원인**: 직원 12명이 동일 계정(이메일/비밀번호)으로 동시 접속한 것이 원인입니다.

**메커니즘**:  
Supabase(CRM 인증 서버)의 기본 설정에서, 한 계정으로 로그인된 모든 기기 중 **어느 한 기기에서 로그아웃**하면 해당 계정으로 연결된 **전체 기기가 동시에 로그아웃**됩니다. 이는 보안을 위한 설계된 동작입니다.

**해결**: 직원마다 **개인 계정(개인 이메일)** 으로 로그인하면 이 문제가 발생하지 않습니다.

**오늘 배포된 수정(SSN-SESSION-KILL)**: JWT 토큰 갱신 타이밍 오류로 인한 개인 계정 로그아웃 버그를 수정했습니다. 이 수정은 개인 계정 사용 시 적용됩니다.

**요청**: 오늘 이후 테스트 시 각 직원 개인 계정으로 접속해 주세요. 개인 계정에서도 로그아웃이 발생하면 즉시 알려주세요(별도 조사 진행합니다).

---

## 기술 메모 (향후 참고)

### scope:'local' 변경 검토 (P3 — 현재 범위 외)

```typescript
// 현재 (global scope)
await supabase.auth.signOut();

// 대안: 로컬 only
await supabase.auth.signOut({ scope: 'local' });
```

**trade-off**:
- local scope: 해당 기기만 로그아웃 → 분실 기기 세션 잔존 보안 위험
- global scope(현재): 한 기기 로그아웃 시 전체 영향 → 동일 계정 공유 시 cascade

현재 풋센터 운영 환경(기기당 1계정)에서는 global이 적절.  
다만 동일 계정 공유 테스트 시나리오에서는 cascade 발생.

→ **별도 P3 티켓으로 검토 (현장 안내 완료 후)**

---

## 변경 파일

없음 — 조사 전용 티켓
