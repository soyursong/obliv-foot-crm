import { q } from './dryrun_lib.mjs';
const out = {};
out.fndef = await q(`SELECT pg_get_functiondef('public.fn_designated_therapist_writeguard()'::regprocedure) AS def;`);
out.trgdef = await q(`SELECT pg_get_triggerdef(oid) AS def, tgenabled FROM pg_trigger WHERE tgname='trg_designated_therapist_writeguard';`);
out.secdef = await q(`SELECT prosecdef, proowner::regrole::text AS owner FROM pg_proc WHERE proname='fn_designated_therapist_writeguard';`);
console.log(JSON.stringify(out, null, 2));
