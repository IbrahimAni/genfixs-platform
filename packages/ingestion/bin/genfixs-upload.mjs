#!/usr/bin/env node
/**
 * GenFixs CI uploader — the "lightweight CLI step in the customer's pipeline"
 * (spec §10.1). Add it after the test run in CI:
 *
 *   npx playwright test --reporter=json > pw-report.json || true
 *   genfixs-upload \
 *     --api "$GENFIXS_API_URL" --token "$GENFIXS_API_TOKEN" \
 *     --project "$GENFIXS_PROJECT_ID" \
 *     --report pw-report.json --commit "$GITHUB_SHA"
 *
 * Exits 0 even when tests failed — failing tests are GenFixs's input, not an
 * uploader error.
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: process.env.GENFIXS_API_URL ?? 'http://localhost:4000' },
    token: { type: 'string', default: process.env.GENFIXS_API_TOKEN },
    project: { type: 'string', default: process.env.GENFIXS_PROJECT_ID },
    report: { type: 'string' },
    commit: { type: 'string', default: process.env.GITHUB_SHA },
    'last-green': { type: 'string' },
    format: { type: 'string', default: 'playwright-json' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help || !values.report || !values.project || !values.commit) {
  console.log(
    'Usage: genfixs-upload --project <id> --report <file> --commit <sha> [--api <url>] [--token <token>] [--last-green <sha>] [--format playwright-json|junit-xml]',
  );
  process.exit(values.help ? 0 : 2);
}

const raw = await readFile(values.report, 'utf8');
const res = await fetch(`${values.api}/api/projects/${values.project}/ingest`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(values.token ? { authorization: `Bearer ${values.token}` } : {}),
  },
  body: JSON.stringify({
    commitSha: values.commit,
    ...(values['last-green'] ? { lastGreenSha: values['last-green'] } : {}),
    format: values.format,
    raw,
  }),
});

if (!res.ok) {
  console.error(`genfixs-upload: ingest failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const body = await res.json();
console.log(`genfixs-upload: ingested run ${body.runId} (${body.results} results)`);
