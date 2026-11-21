#!/usr/bin/env node
// WEB-011 gate: Expo/mobile removal is allowed only when every evidence source below is complete.
// Reads repository docs (the single source of truth) and exits 1 while any gate is open.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/** Unchecked "- [ ]" items, optionally limited to the section under a given heading. */
export function openItems(markdown, heading) {
  let text = markdown;
  if (heading) {
    const start = markdown.indexOf(heading);
    if (start < 0) return [`(missing section ${heading})`];
    const rest = markdown.slice(start + heading.length);
    const next = rest.search(/\n## /);
    text = next < 0 ? rest : rest.slice(0, next);
  }
  return text
    .split('\n')
    .filter((line) => /^\s*- \[ \]/.test(line))
    .map((line) => line.replace(/^\s*- \[ \]\s*/, '').trim());
}

/** Evidence matrix rows still marked as not run. */
export function pendingEvidence(markdown) {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('|') && /Chưa chạy/.test(line))
    .map((line) =>
      line
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .slice(1, 4)
        .join(' · '),
    );
}

export function evaluate(docs) {
  return [
    {
      gate: 'WEB-002 device evidence (Safari iOS, Chrome Android)',
      open: pendingEvidence(docs.evidence),
    },
    {
      gate: 'WEB-006 Customer parity checklist',
      open: openItems(docs.customer, '## Parity checklist'),
    },
    {
      gate: 'WEB-007 Driver parity checklist',
      open: openItems(docs.driver, '## Parity checklist'),
    },
    {
      gate: 'WEB-011 release gate (staging, review, archive)',
      open: openItems(docs.plan, '## Gate'),
    },
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = evaluate({
    evidence: read('docs/web-002-browser-evidence.md'),
    customer: read('docs/web-006-customer-parity.md'),
    driver: read('docs/web-007-driver-parity.md'),
    plan: read('docs/web-011-expo-deprecation.md'),
  });
  let blocked = 0;
  for (const { gate, open } of results) {
    console.log(
      `${open.length ? '✗' : '✓'} ${gate}${open.length ? ` — ${open.length} mục mở` : ''}`,
    );
    for (const item of open.slice(0, 20)) console.log(`    - ${item}`);
    blocked += open.length;
  }
  if (blocked) {
    console.log(
      `\nWEB-011 CHƯA ĐƯỢC PHÉP: còn ${blocked} mục. Không xóa Expo/mobile cho đến khi tất cả đóng.`,
    );
    process.exit(1);
  }
  console.log('\nTất cả gate WEB-011 đã đóng. Vẫn cần reviewer độc lập duyệt PR; không tự merge.');
}
