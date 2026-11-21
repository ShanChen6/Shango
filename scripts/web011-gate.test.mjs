import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, openItems, pendingEvidence } from './web011-gate.mjs';

test('counts only unchecked items inside the named section', () => {
  const md =
    '# T\n- [ ] outside\n## Parity checklist\n- [x] done\n- [ ] open one\n## Other\n- [ ] later';
  assert.deepEqual(openItems(md, '## Parity checklist'), ['open one']);
  assert.deepEqual(openItems('no section', '## Gate'), ['(missing section ## Gate)']);
});

test('reports evidence rows still marked not run', () => {
  const md =
    '| Thiết bị | OS |\n| Chờ | iOS | Safari | Foreground | Chưa chạy |\n| Pixel 8 | Android | Chrome | Lock | ok |';
  assert.equal(pendingEvidence(md).length, 1);
});

test('all gates closed only when every source is complete', () => {
  const ok = '## Parity checklist\n- [x] a\n## Gate\n- [x] b';
  assert.ok(
    evaluate({ evidence: '| a | b |', customer: ok, driver: ok, plan: ok }).every(
      (r) => r.open.length === 0,
    ),
  );
  assert.ok(
    evaluate({ evidence: '| x | Chưa chạy |', customer: ok, driver: ok, plan: ok }).some(
      (r) => r.open.length,
    ),
  );
});
