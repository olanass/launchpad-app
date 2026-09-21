'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { joinEndpoint } = require('../src/server/services/endpoint-security');

test('routing: operation URLs do not duplicate the advertised path; base URLs retain their prefix', () => {
  for (const [base, suffix, expected] of [
    ['https://api.example/api/score', '/api/score', '/api/score'],
    ['https://api.example/api/score/', '/api/score', '/api/score/'],
    ['https://api.example/api/score', '/api/score/', '/api/score'],
    ['https://api.example/v1/api/score', '/api/score', '/v1/api/score'],
    ['https://api.example', '/api/score', '/api/score'],
    ['https://api.example/v1', '/api/score', '/v1/api/score'],
    ['https://api.example/notapi/score', '/api/score', '/notapi/score/api/score'],
    ['https://api.example/api/score', '/history', '/api/score/history'],
    ['https://api.example/api/score', '', '/api/score']
  ]) {
    assert.equal(joinEndpoint(base, suffix, '?detail=1').href, 'https://api.example' + expected + '?detail=1');
  }
  assert.equal(joinEndpoint('https://api.example/api/score?version=1', '/api/score').search, '?version=1');
});
