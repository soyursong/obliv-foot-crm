# 오블리브 풋센터 CRM

종로 5층 문제성발톱클리닉 전용 CRM. 패키지 기반 시술 관리 + 이중 동선(신규/재진) 칸반.

## Stack

- React 18 + TypeScript + Vite 5
- Supabase (Auth, DB, Realtime, Storage)
- shadcn/ui + Tailwind CSS
- @dnd-kit (칸반 DnD)

## 개발

```bash
npm install
npm run dev    # localhost:8082
```

## 설계문서

- 풋센터_CRM설계.md — 인터뷰 기반 요구사항
- 풋센터_기능명세_DB아키텍처.md — 기능명세 + DB 스키마
- 풋센터_lovable_prompt_v1.md — UI 기능 상세
