import test from 'node:test'
import assert from 'node:assert/strict'
import { areChatPreferencesCompatible, selectCompatiblePairs } from '../src/chat-matching.js'

test('pairs two people whose gender preferences are mutually compatible', () => {
  assert.equal(areChatPreferencesCompatible(
    { gender: 'guy', looking_for: 'girl' },
    { gender: 'girl', looking_for: 'guy' }
  ), true)
})

test('does not pair people when only one side accepts the other', () => {
  assert.equal(areChatPreferencesCompatible(
    { gender: 'guy', looking_for: 'girl' },
    { gender: 'girl', looking_for: 'girl' }
  ), false)
})

test('random preference accepts any declared or undisclosed gender', () => {
  assert.equal(areChatPreferencesCompatible(
    { gender: 'any', looking_for: 'random' },
    { gender: 'girl', looking_for: 'random' }
  ), true)
})

test('a specific preference does not match an undisclosed gender', () => {
  assert.equal(areChatPreferencesCompatible(
    { gender: 'guy', looking_for: 'girl' },
    { gender: 'any', looking_for: 'random' }
  ), false)
})

test('chooses compatible pairs in stable order and never reuses a session', () => {
  const pairs = selectCompatiblePairs([
    { key: 'c', meta: { gender: 'girl', looking_for: 'guy' } },
    { key: 'a', meta: { gender: 'guy', looking_for: 'girl' } },
    { key: 'b', meta: { gender: 'guy', looking_for: 'random' } },
    { key: 'd', meta: { gender: 'any', looking_for: 'random' } }
  ])

  assert.deepEqual(pairs.map(pair => pair.map(session => session.key)), [['a', 'c'], ['b', 'd']])
})
