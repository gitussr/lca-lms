import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDirection } from './migrate.js';

test('parseDirection defaults to up and accepts up/down', () => {
  assert.equal(parseDirection(undefined), 'up');
  assert.equal(parseDirection('up'), 'up');
  assert.equal(parseDirection('down'), 'down');
});

test('parseDirection rejects anything else', () => {
  assert.throws(() => parseDirection('sideways'), /unknown direction "sideways"/);
});
