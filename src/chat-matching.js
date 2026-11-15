function preferenceOf(session) {
  const preference = session?.looking_for ?? session?.lookingFor
  return preference === 'guy' || preference === 'girl' ? preference : 'random'
}

/**
 * With an anonymous target-only selector, identity is intentionally unknown.
 * Specific requests are therefore treated as reciprocal pairing preferences,
 * not verified partner genders. Random accepts any waiting partner.
 */
export function areChatPreferencesCompatible(first, second) {
  const firstPreference = preferenceOf(first)
  const secondPreference = preferenceOf(second)
  return firstPreference === 'random' || secondPreference === 'random' || firstPreference !== secondPreference
}

function preferenceScore(first, second) {
  return preferenceOf(first) !== 'random' && preferenceOf(second) !== 'random' ? 1 : 0
}

export function selectCompatiblePairs(sessions) {
  const waiting = [...sessions].sort((a, b) => String(a.key).localeCompare(String(b.key)))
  const used = new Set()
  const pairs = []

  for (let i = 0; i < waiting.length; i += 1) {
    const first = waiting[i]
    if (used.has(first.key)) continue

    const candidate = waiting
      .slice(i + 1)
      .filter(second => !used.has(second.key) && areChatPreferencesCompatible(first.meta, second.meta))
      .sort((a, b) => preferenceScore(first.meta, b.meta) - preferenceScore(first.meta, a.meta))[0]
    if (!candidate) continue
    pairs.push([first, candidate])
    used.add(first.key)
    used.add(candidate.key)
  }

  return pairs
}
