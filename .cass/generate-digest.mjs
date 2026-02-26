#!/usr/bin/env node
/**
 * Generate a thematic digest of the CASS playbook.
 * Parses .cass/playbook.yaml, calls Claude API in batches,
 * writes .cass/playbook-digest.md
 *
 * Usage: node .cass/generate-digest.mjs
 * Requires: ANTHROPIC_API_KEY env var
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAYBOOK_PATH = join(__dirname, 'playbook.yaml');
const OUTPUT_PATH = join(__dirname, 'playbook-digest.md');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

// ---- Extract bullets from YAML without a YAML library ----

function extractBullets(yamlText) {
  const bullets = [];
  const bulletBlocks = yamlText.split(/\n  - id: /);
  bulletBlocks.shift(); // remove header

  for (const block of bulletBlocks) {
    const category = block.match(/category: (.+?)$/m)?.[1] || '';
    const kind = block.match(/kind: (.+?)$/m)?.[1] || '';
    const scope = block.match(/scope: (.+?)$/m)?.[1] || '';
    const helpful = parseInt(block.match(/helpfulCount: (\d+)/)?.[1] || '0');

    // Get content (may span multiple indented lines)
    const contentMatch = block.match(/content: ([\s\S]*?)(?=\n    \w+:)/);
    let content = contentMatch
      ? contentMatch[1].trim().replace(/\n      /g, ' ').replace(/^"|"$/g, '')
      : '';

    if (content) bullets.push({ content, category, kind, scope, helpful });
  }
  return bullets;
}

const yamlText = readFileSync(PLAYBOOK_PATH, 'utf8');
const bullets = extractBullets(yamlText);
console.log(`Extracted ${bullets.length} bullets from ${PLAYBOOK_PATH}`);

// ---- Call Claude API ----

async function callClaude(systemPrompt, userContent, model = 'claude-sonnet-4-6') {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API error ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return data.content[0].text;
}

// ---- Phase 1: Cluster & summarize in batches ----

const BATCH_SIZE = 500;
const allBulletLines = bullets.map((b, i) =>
  `[${i}] (${b.kind}/${b.scope}) ${b.content}${b.helpful > 0 ? ` [helpful:${b.helpful}]` : ''}`
);

const batchSummaries = [];

for (let start = 0; start < allBulletLines.length; start += BATCH_SIZE) {
  const batch = allBulletLines.slice(start, start + BATCH_SIZE);
  const batchNum = Math.floor(start / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(allBulletLines.length / BATCH_SIZE);
  console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} bullets)...`);

  const systemPrompt = `You are summarizing a playbook of AI coding assistant rules for the defcon.run monorepo (DEF CON 34 event).

Your job: Group these rules into 8-12 thematic clusters and for each cluster, write 2-5 concise, actionable rules that capture the essential wisdom. Deduplicate aggressively — many rules say the same thing differently.

Focus on rules that would actually help someone coding in this project. Skip meta-rules about the playbook system itself, generic "explore the codebase" advice, and session management boilerplate.

Output format (markdown):
## Theme Name
- Rule 1 (concise, actionable)
- Rule 2
...

Prioritize rules marked [helpful:N] — these have been validated by usage.`;

  const result = await callClaude(systemPrompt, batch.join('\n'));
  batchSummaries.push(result);
}

// ---- Phase 2: Merge batch summaries into final digest ----

console.log('Merging batch summaries into final digest...');

const today = new Date().toISOString().split('T')[0];

const mergePrompt = `You are creating the final playbook digest for the defcon.run 34 monorepo (DEF CON 34 event — AWS multi-region infrastructure, Next.js apps, Terragrunt/Terraform, Docker/ECS, DynamoDB/ElectroDB, Strapi CMS, OIDC auth).

Below are themed summaries from ${batchSummaries.length} batches of ~${BATCH_SIZE} rules each, extracted from a ${bullets.length}-rule CASS playbook. Merge them into a single cohesive digest.

Requirements:
1. Organize into 12-20 thematic sections
2. Each section: 3-7 concise, actionable rules
3. Deduplicate across batches (many themes repeat)
4. Prioritize project-specific wisdom over generic advice
5. Total output: ~2-4 pages of markdown
6. Use imperative voice ("Use X when Y", "Always Z before W")
7. Skip meta-rules about playbook management, session initialization, and codebase exploration boilerplate

Output format:
# Playbook Digest
> Auto-generated summary of ${bullets.length} CASS playbook rules. See .cass/playbook.yaml for raw data.
> Generated: ${today}

## Section Name
- Rule
- Rule
...

Here are the batch summaries:

${batchSummaries.map((s, i) => `### Batch ${i + 1}\n${s}`).join('\n\n')}`;

const finalDigest = await callClaude(
  'You produce clean, well-organized markdown. Be concise and specific.',
  mergePrompt,
  'claude-sonnet-4-6'
);

// ---- Write output ----

writeFileSync(OUTPUT_PATH, finalDigest);
console.log(`\nDigest written to ${OUTPUT_PATH}`);
console.log(`Size: ${finalDigest.length} chars, ${finalDigest.split('\n').length} lines`);
