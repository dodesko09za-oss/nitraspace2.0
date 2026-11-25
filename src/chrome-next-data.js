import { getClerk, signOutClerk, syncClerkSessionToSupabase } from './features/clerk-auth.js'

/**
 * Data bridge for the Nitra Space app. Pass the existing Supabase client once.
 * Reads resolve {status: 'ready'|'empty'|'guest'|'error', data, error}; the UI
 * sets its own 'loading' state before awaiting them. Errors are user-readable.
 * Mutations execute only when called, resolve their result, and throw on failure.
 * No demo records, invented counts, presence estimates, or compatibility scores.
 */
export function createPreviewData(client) {
  let pendingAuthFlow = null
  const configured = () => {
    if (!client) throw new Error('Pripojenie k Nitra Space nie je nastavené.')
    return client
  }
  const unwrap = result => {
    if (result.error) throw result.error
    return result.data
  }
  const read = async operation => {
    try {
      configured()
      const data = await operation()
      return { status: data === null || (Array.isArray(data) && !data.length) ? 'empty' : 'ready', data, error: null }
    } catch (error) {
      return { status: 'error', data: null, error: error.message || 'Obsah sa nepodarilo načítať.' }
    }
  }
  const sessionUser = async () => unwrap(await configured().auth.getSession()).session?.user || null
  const requireUser = async () => {
    const user = await sessionUser()
    if (!user) throw new Error('Najprv sa prihlás do svojho účtu.')
    return user
  }
  const safeUrl = value => {
    if (!value) return ''
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : '' } catch { return '' }
  }
  const avatarUrl = path => path ? safeUrl(configured().storage.from('avatars').getPublicUrl(path).data.publicUrl) : ''
  const person = row => ({
    id: row.id, username: row.username || '', name: row.display_name || row.username || '',
    bio: row.bio || '', intro: row.status || row.bio || '', age: row.age ?? null,
    interests: row.people_interests || [], avatarUrl: avatarUrl(row.avatar_path),
    photoUrl: '', verified: row.is_verified === true, showOnline: row.show_online === true,
    // No online value without a subscribed presence source.
    online: null,
  })
  const signedPhotos = async rows => {
    if (!rows.length) return []
    const signed = unwrap(await configured().storage.from('matching-photos').createSignedUrls(rows.map(row => row.storage_path), 600))
    return rows.map((row, index) => {
      if (signed[index]?.error) throw new Error('Fotografie sa nepodarilo načítať.')
      return { id: row.id, userId: row.user_id, position: row.position, url: safeUrl(signed[index]?.signedUrl) }
    })
  }
  const api = {
    loadEvents: () => read(async () => {
      const rows = unwrap(await client.from('nitra_events')
        .select('id,organizer,title,performer,event_date,place,link,image_data,instagram_group_url,room_enabled')
        .order('event_date', { ascending: true })) || []
      return rows.map(row => ({ id: row.id, title: row.title, organizer: row.organizer,
        performer: row.performer, date: row.event_date, place: row.place,
        link: safeUrl(row.link), image: /^data:image\/(?:jpeg|png|webp);base64,/i.test(row.image_data || '') ? row.image_data : safeUrl(row.image_data),
        instagramGroupUrl: safeUrl(row.instagram_group_url), roomEnabled: row.room_enabled !== false }))
    }),
    isAdmin: () => read(async () => {
      const user = await sessionUser()
      if (!user) return false
      return unwrap(await client.rpc('is_admin')) === true
    }),
    loadPolls: (newsId = null) => read(async () => {
      const rows = unwrap(await client.rpc('nitra_community_polls', { p_news: newsId })) || []
      return rows.map(row => {
        const selectedOption = row.selected_option ?? null
        const visible = selectedOption !== null && selectedOption !== ''
        const totalVotes = visible && row.total_votes != null ? Number(row.total_votes) : null
        return { id: row.id, question: row.question, kind: row.kind, selectedOption,
          totalVotes, resultsVisible: visible, closesAt: row.closes_at || null,
          options: (row.options || []).map(option => ({ id: option.id, label: option.label,
            votes: visible && option.votes != null ? Number(option.votes) : null,
            percent: visible && totalVotes !== null && option.votes != null ? (totalVotes ? Math.round(Number(option.votes) / totalVotes * 100) : 0) : null })) }
      })
    }),
    loadAccount: async () => {
      const result = await read(async () => {
        const user = await sessionUser()
        if (!user) return null
        const profile = unwrap(await client.from('profiles')
          .select('id,username,display_name,bio,avatar_path,discoverable,show_online,people_interests')
          .eq('id', user.id).single())
        return { ...person(profile), email: user.email || '', discoverable: profile.discoverable === true }
      })
      if (result.status === 'empty') result.status = 'guest'
      return result
    },
    loadPeople: ({ after = '', interest = '', username = null } = {}) => read(async () => {
      const rows = unwrap(await client.rpc('nitra_community_people', { p_after: after, p_username: username, p_interest: interest })) || []
      const people = rows.map(person)
      if (people.length && await sessionUser()) {
        const photoRows = unwrap(await client.from('matching_photos').select('user_id,storage_path,position')
          .in('user_id', people.map(item => item.id)).eq('position', 1)) || []
        const photos = await signedPhotos(photoRows)
        people.forEach(item => { item.photoUrl = photos.find(photo => photo.userId === item.id)?.url || '' })
      }
      return people
    }),
    loadProfile: username => read(async () => {
      const rows = unwrap(await client.rpc('nitra_community_people', { p_after: '', p_username: username, p_interest: '' })) || []
      if (!rows.length) return null
      const profile = person(rows[0])
      const [matching, photos] = await Promise.all([
        client.from('matching_profiles').select('intro,matching_enabled').eq('user_id', profile.id).maybeSingle(),
        client.from('matching_photos').select('id,user_id,storage_path,position').eq('user_id', profile.id).order('position').limit(3),
      ])
      const matchingData = unwrap(matching)
      return { ...profile, intro: matchingData?.intro || profile.intro,
        photos: await signedPhotos(unwrap(photos) || []) }
    }),
    loadMatchingSetup: async () => {
      const result = await read(async () => {
        const user = await sessionUser()
        if (!user) return null
        const results = await Promise.all([
          client.from('matching_profiles').select('matching_enabled,intro').eq('user_id', user.id).maybeSingle(),
          client.from('matching_photos').select('id,user_id,storage_path,position').eq('user_id', user.id).order('position'),
          client.from('interests').select('id,display_name').order('sort_order'),
          client.from('matching_profile_interests').select('interest_id').eq('user_id', user.id),
        ])
        const [profile, photos, interests, selected] = results.map(unwrap)
        return { enabled: profile?.matching_enabled === true, intro: profile?.intro || '',
          photos: await signedPhotos(photos || []), interests: (interests || []).map(item => ({ id: item.id, name: item.display_name })),
          selectedInterestIds: (selected || []).map(item => item.interest_id) }
      })
      if (result.status === 'empty') result.status = 'guest'
      return result
    },
    async vote(pollId, optionId) {
      await requireUser()
      return unwrap(await client.rpc('nitra_community_vote', { p_poll: pollId, p_option: optionId }))
    },
    async requestMatch(userId) {
      const user = await requireUser()
      if (user.id === userId) throw new Error('Toto je tvoj vlastný profil.')
      const status = unwrap(await client.rpc('nitra_community_request', { p_target: userId }))
      const conversationId = status === 'connected' ? unwrap(await client.rpc('get_or_create_dm', { p_other_user_id: userId })) : null
      return { status, conversationId }
    },
    async signIn({ email, password }) {
      const clerk = await getClerk()
      const flow = clerk.client.signIn.__internal_future
      const result = await flow.password({ emailAddress: email.trim(), password })
      if (result?.error) throw result.error
      if (flow.status === 'needs_second_factor' || flow.status === 'needs_client_trust') {
        if (!flow.supportedSecondFactors?.some(factor => factor.strategy === 'email_code')) throw new Error('Účet vyžaduje ďalšie overenie e-mailovým kódom.')
        const sent = await flow.mfa.sendEmailCode()
        if (sent?.error) throw sent.error
        pendingAuthFlow = { type: 'signin', flow, email: email.trim() }
        return { confirmationRequired: true, email: email.trim() }
      }
      if (flow.status !== 'complete') throw new Error('Clerk nedokončil prihlásenie. Skús to znova.')
      const finalized = await flow.finalize()
      if (finalized?.error) throw finalized.error
      const linked = await syncClerkSessionToSupabase(configured())
      if (linked.profileRequired) throw new Error(linked.message || 'Dokonči svoj Nitra Space profil.')
      return { user: linked.user, confirmationRequired: false }
    },
    async signUp({ email, password, username, birthDate }) {
      if ([...String(password || '')].length < 8) throw new Error('Heslo musí mať aspoň 8 znakov.')
      const normalizedUsername = String(username || '').trim().toLowerCase()
      const birth = new Date(`${birthDate}T00:00:00Z`)
      const cutoff = new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 16)
      if (!birthDate || Number.isNaN(birth.getTime()) || birth > cutoff) throw new Error('Účet je dostupný od 16 rokov. Zadaj platný dátum narodenia.')
      if (!/^(?=.*[a-z_])[a-z0-9_]{4,24}$/.test(normalizedUsername)) throw new Error('Používateľské meno: 4 až 24 znakov, aspoň jedno písmeno, malé písmená, čísla alebo podčiarkovník.')
      const profile = { display_name: normalizedUsername, username: normalizedUsername, birth_date: birthDate }
      const clerk = await getClerk()
      const flow = clerk.client.signUp.__internal_future
      const result = await flow.password({ emailAddress: email.trim(), password, username: normalizedUsername, unsafeMetadata: { nitra_profile: profile } })
      if (result?.error) throw result.error
      if (flow.username !== normalizedUsername || flow.missingFields?.includes('username')) {
        const usernameResult = await flow.update({ username: normalizedUsername })
        if (usernameResult?.error) throw usernameResult.error
      }
      if (flow.username !== normalizedUsername || flow.missingFields?.includes('username')) {
        throw new Error('Clerk neuložil používateľské meno. Skontroluj, či je v Clerk → User & authentication → Username zapnuté používateľské meno.')
      }
      const sent = await flow.verifications.sendEmailCode()
      if (sent?.error) throw sent.error
      pendingAuthFlow = { type: 'signup', flow, email: email.trim(), profile }
      return { confirmationRequired: true, email: email.trim() }
    },
    async verifyAuthCode(code) {
      if (!pendingAuthFlow) throw new Error('Registrácia vypršala. Začni znova.')
      const pending = pendingAuthFlow
      const result = pending.type === 'signup'
        ? await pending.flow.verifications.verifyEmailCode({ code: String(code).trim() })
        : await pending.flow.mfa.verifyEmailCode({ code: String(code).trim() })
      if (result?.error) throw result.error
      if (pending.flow.status !== 'complete') throw new Error('Kód ešte nebol prijatý. Skontroluj ho a skús znova.')
      const finalized = await pending.flow.finalize()
      if (finalized?.error) throw finalized.error
      const linked = await syncClerkSessionToSupabase(configured(), pending.profile || null)
      if (linked.profileRequired) throw new Error(linked.message || 'Dokonči svoj Nitra Space profil.')
      pendingAuthFlow = null
      return linked.user
    },
    async resendAuthCode() {
      if (!pendingAuthFlow) throw new Error('Registrácia vypršala. Začni znova.')
      const result = pendingAuthFlow.type === 'signup'
        ? await pendingAuthFlow.flow.verifications.sendEmailCode()
        : await pendingAuthFlow.flow.mfa.sendEmailCode()
      if (result?.error) throw result.error
    },
    async signOut() {
      try { await signOutClerk() } catch {}
      unwrap(await configured().auth.signOut())
    },
    async updateProfile({ name, username, bio, interests, discoverable, showOnline }) {
      const user = await requireUser()
      const patch = {}
      if (name !== undefined) patch.display_name = name.trim()
      if (username !== undefined) patch.username = username.trim().toLowerCase()
      if (bio !== undefined) patch.bio = bio
      if (interests !== undefined) patch.people_interests = interests.map(value => value.trim()).filter(Boolean).slice(0, 8)
      if (discoverable !== undefined) patch.discoverable = Boolean(discoverable)
      if (showOnline !== undefined) patch.show_online = Boolean(showOnline)
      return unwrap(await client.from('profiles').update(patch).eq('id', user.id)
        .select('id,username,display_name,bio,discoverable,show_online,people_interests').single())
    },
    async saveMatchingProfile({ enabled, intro, interestIds }) {
      await requireUser()
      return unwrap(await client.rpc('save_matching_profile', { p_enabled: enabled, p_intro: intro.trim(), p_interest_ids: interestIds }))
    },
    onAuthChange(callback) {
      const { data } = configured().auth.onAuthStateChange(() => { setTimeout(callback, 0) })
      return () => data.subscription.unsubscribe()
    },
  }
  return api
}

