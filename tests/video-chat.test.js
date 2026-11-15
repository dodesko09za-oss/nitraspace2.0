import test from 'node:test'
import assert from 'node:assert/strict'
import { selectVideoPair } from '../src/video-chat-core.js'

const presence = (...ids) => Object.fromEntries(ids.map(id => [id, [{ status: 'video-waiting' }]]))

test('video lobby pairs the first two waiting sessions consistently', () => {
  const people = presence('session-b', 'session-a')
  assert.deepEqual(selectVideoPair(people, 'session-a'), {
    initiator: 'session-a', partner: 'session-b', roomId: 'session-a-session-b'
  })
  assert.equal(selectVideoPair(people, 'session-b'), null)
})

test('odd waiting session waits while the next pair is selected independently', () => {
  const people = presence('a', 'b', 'c')
  assert.equal(selectVideoPair(people, 'c'), null)
  assert.deepEqual(selectVideoPair(presence('c', 'd'), 'c'), {
    initiator: 'c', partner: 'd', roomId: 'c-d'
  })
})

test('video lobby ignores non-video presence and unknown sessions', () => {
  const people = { a: [{ status: 'waiting' }], b: [{ status: 'video-waiting' }] }
  assert.equal(selectVideoPair(people, 'a'), null)
  assert.equal(selectVideoPair(people, 'missing'), null)
  assert.equal(selectVideoPair(null, 'a'), null)
})
