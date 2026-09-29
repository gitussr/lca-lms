import assert from 'node:assert/strict';
import test from 'node:test';

import { describeError, redactUrl } from './cli.js';

test('redactUrl hides the password', () => {
  assert.equal(redactUrl('postgresql://u:secret@h:5432/db'), 'postgresql://u:***@h:5432/db');
});

test('describeError unwraps an empty-message AggregateError', () => {
  const err = new AggregateError(
    [new Error('connect ECONNREFUSED ::1:5432'), new Error('connect ECONNREFUSED 127.0.0.1:5432')],
    '',
  );
  assert.equal(
    describeError(err),
    'connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432',
  );
});

test('describeError falls back to code, then name', () => {
  assert.equal(
    describeError(Object.assign(new Error(''), { code: 'ECONNREFUSED' })),
    'ECONNREFUSED',
  );
  assert.equal(describeError(new TypeError('')), 'TypeError');
  assert.equal(describeError('plain'), 'plain');
});
