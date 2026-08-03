#!/usr/bin/env node
/**
 * T-20260803-foot-REDPAY-NOTXN-4TERM-RAWVERIFY-DEACTIVATE — AC-1 introspection (READ-ONLY)
 *
 * 목적:
 *  (1) redpay_terminal_registry 비활성 메커니즘 확인 = active/is_active mutable flag(soft) 존재? (AC-1)
 *  (2) 비활성 후보 4 TID(1047479476·1047479148·1047479155·1047479157) 현재 registry 상태·merchant·domain·created_at
 *  (3) 보류 158(1047479158) 대조행
 *  (4) 관찰구간 산정 근거(created_at) — ENVGAP 공백 vs 진짜0 구분용
 *
 * write 0 / DDL 0 — 순수 SELECT introspection.
 */
import { query } from './lib/foot_migration_ledger.mjs';

const CANDIDATES = ['1047479476', '1047479148', '1047479155', '1047479157'];
const HELD = ['1047479158'];

const j = (o) => JSON.stringify(o, null, 2);

// 1) 컬럼 스키마 — soft flag 컬럼 존재 확인
const cols = await query(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='redpay_terminal_registry'
  ORDER BY ordinal_position;`);
console.log('── AC-1: redpay_terminal_registry 컬럼 스키마 ──');
console.log(j(cols));

const colNames = cols.map((c) => c.column_name);
const softFlags = colNames.filter((c) => /^(is_)?active$|status|enabled|deactivat/i.test(c));
console.log(`\n  soft-flag 후보 컬럼 = ${JSON.stringify(softFlags)}`);

// 2) 후보 4대 + 보류 1대 현재 상태 (실제 존재하는 컬럼만 SELECT * 로)
const allTids = [...CANDIDATES, ...HELD].map((t) => `'${t}'`).join(',');
const rows = await query(`
  SELECT * FROM public.redpay_terminal_registry
  WHERE tid IN (${allTids})
  ORDER BY tid;`);
console.log('\n── 후보 4대 + 보류 158 registry 현재 행 ──');
console.log(j(rows));

// 3) tid 컬럼명이 다를 수 있으니 fallback: terminal_id 등으로도 조회
if (!rows || rows.length === 0) {
  console.log('\n  [WARN] tid 컬럼 매칭 0행 — 대체 컬럼명 탐색');
  const tidLike = colNames.filter((c) => /tid|terminal/i.test(c));
  console.log(`  tid-like 컬럼 = ${JSON.stringify(tidLike)}`);
  for (const c of tidLike) {
    const r = await query(`SELECT * FROM public.redpay_terminal_registry WHERE ${c} IN (${allTids}) ORDER BY ${c};`);
    console.log(`  by ${c}: ${r.length}행`);
    if (r.length) console.log(j(r));
  }
}
