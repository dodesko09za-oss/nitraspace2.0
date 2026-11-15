export function selectVideoPair(presenceState, sessionId) {
  if (!presenceState || !sessionId) return null
  const waiting = [...new Set(Object.entries(presenceState)
    .filter(([, metas]) => Array.isArray(metas) && metas.some(meta => meta?.status === 'video-waiting'))
    .map(([key]) => key))].sort()
  const index = waiting.indexOf(sessionId)
  if (index < 0 || index % 2 !== 0) return null
  const initiator = waiting[index]
  const partner = waiting[index + 1]
  if (!partner) return null
  return { initiator, partner, roomId: [initiator, partner].sort().join('-') }
}
