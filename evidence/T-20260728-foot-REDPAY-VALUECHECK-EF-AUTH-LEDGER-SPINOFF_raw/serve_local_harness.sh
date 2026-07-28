#!/bin/bash
# Fail-safe LOCAL-ONLY serve of the actual redpay-webhook EF handler (localhost:8000).
# NOT a public functions-deploy. Proves the introspection auth gate BEFORE any public exposure.
#
# NOTE: env values below are DUMMY placeholders (redacted for the secret scanner).
#   During the evidence run a throwaway literal was used for SUPABASE_SERVICE_ROLE_KEY,
#   and the SAME literal was sent as `Authorization: Bearer <literal>` for T3 (authed 200).
#   No production key is involved. Substitute any throwaway values to reproduce.
export SUPABASE_URL="http://localhost:54321"
export SUPABASE_SERVICE_ROLE_KEY="<DUMMY_SERVICE_ROLE_PLACEHOLDER>"   # throwaway literal
# (webhook signing secret / anon key omitted — GET ?introspect path never reads them;
#  index.ts treats them as optional and the introspection branch is no-DB.)
cd ~/GitHub/obliv-foot-crm
exec deno run --allow-net --allow-env supabase/functions/redpay-webhook/index.ts

# Reproduce (localhost only — never public):
#   SR="<same throwaway literal as SUPABASE_SERVICE_ROLE_KEY>"
#   B="http://localhost:8000/redpay-webhook"
#   curl -sw' %{http_code}' "$B?introspect=whitelist"                                   # T1 -> 401
#   curl -sw' %{http_code}' -H "Authorization: Bearer wrong" "$B?introspect=whitelist"  # T2 -> 401
#   curl -sw' %{http_code}' -H "Authorization: Bearer $SR" "$B?introspect=whitelist"    # T3 -> 200 + fingerprint
#   curl -sw' %{http_code}' -H "Authorization: Bearer $SR" "$B"                         # T4 -> 405
#   curl -sw' %{http_code}' -X POST --data '{"junk":1}' "$B?introspect=whitelist"       # T6 -> 401 invalid_signature (payment branch)
