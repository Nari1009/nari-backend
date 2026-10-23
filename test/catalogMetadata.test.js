const assert = require('node:assert/strict');
const test = require('node:test');
const { METADATA_MATCH, metadataListMatch, normalizeMetadataList } = require('../src/services/ai/catalogMetadata');

test('metadata normalizer accepts arrays and serialized JSON', () => {
  assert.deepEqual(normalizeMetadataList(['DRY']).values, ['DRY']);
  assert.deepEqual(normalizeMetadataList('["DRY", "SENSITIVE"]').values, ['DRY', 'SENSITIVE']);
  assert.equal(metadataListMatch('["DRY"]', ['DRY']), METADATA_MATCH.MATCH);
});

test('metadata normalizer distinguishes no match from unknown', () => {
  assert.equal(metadataListMatch(['OILY'], ['DRY']), METADATA_MATCH.NO_MATCH);
  assert.equal(metadataListMatch(null, ['DRY']), METADATA_MATCH.UNKNOWN);
  assert.equal(metadataListMatch('', ['DRY']), METADATA_MATCH.UNKNOWN);
  assert.equal(metadataListMatch('{bad json', ['DRY']), METADATA_MATCH.UNKNOWN);
});
