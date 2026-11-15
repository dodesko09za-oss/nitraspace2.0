function accepts(preference, otherGender) {
  if (!preference || preference === 'random') return true
  return otherGender === preference
}

export function areChatPreferencesCompatible(first, second) {
  return accepts(first.looking_for, second.gender) && accepts(second.looking_for, first.gender)
}

export function selectCompatiblePairs(sessions) {
  const waiting = [...sessions].sort((a, b) => String(a.key).localeCompare(String(b.key)))
  const used = new Set()
  const pairs = []

  for (let i = 0; i < waiting.length; i += 1) {
    const first = waiting[i]
    if (used.has(first.key)) continue

    for (let j = i + 1; j < waiting.length; j += 1) {
      const second = waiting[j]
      if (used.has(second.key) || !areChatPreferencesCompatible(first.meta, second.meta)) continue
      pairs.push([first, second])
      used.add(first.key)
      used.add(second.key)
      break
    }
  }

  return pairs
}
