import test from 'node:test'
import assert from 'node:assert/strict'
import { areChatPreferencesCompatible, selectCompatiblePairs } from '../src/chat-matching.js'

test('pairs reciprocal girl and guy preferences without asking for identity', () => {
  assert.equal(areChatPreferencesCompatible(
    { looking_for: 'guy' },
    { looking_for: 'girl' }
  ), true)
})

test('does not prioritize two identical specific preferences', () => {
  assert.equal(areChatPreferencesCompatible(
    { looking_for: 'girl' },
    { looking_for: 'girl' }
  ), false)
})

test('random preference can pair with any preference', () => {
  assert.equal(areChatPreferencesCompatible(
    { looking_for: 'random' },
    { looking_for: 'girl' }
  ), true)
  assert.equal(areChatPreferencesCompatible(
    { looking_for: 'random' },
    { looking_for: 'random' }
  ), true)
})

test('missing preference from an older client safely defaults to random', () => {
  assert.equal(areChatPreferencesCompatible(
    { gender: 'guy', looking_for: 'girl' },
    { gender: 'girl' }
  ), true)
})

test('chooses compatible pairs in stable order and never reuses a session', () => {
  const pairs = selectCompatiblePairs([
    { key: 'c', meta: { looking_for: 'guy' } },
    { key: 'a', meta: { looking_for: 'girl' } },
    { key: 'b', meta: { looking_for: 'random' } },
    { key: 'd', meta: { looking_for: 'random' } }
  ])

  assert.deepEqual(pairs.map(pair => pair.map(session => session.key)), [['a', 'c'], ['b', 'd']])
})
