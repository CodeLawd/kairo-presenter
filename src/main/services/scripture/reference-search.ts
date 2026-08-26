/**
 * Reference lookup order: the translation the operator picked, then API.Bible
 * for licensed Bibles, then other local copies. Local fallbacks used to run
 * before the API, so NIV/NKJV searches always returned KJV and never hit the network.
 */
export async function resolveReferenceLookup<TVerse, TResult>(options: {
  requested: string
  localIds: readonly string[]
  lookupLocal: (translation: string) => Promise<TVerse[]>
  lookupApi: (() => Promise<TResult[]>) | null
  toLocalResult: (verses: TVerse[], translation: string) => TResult
}): Promise<TResult[]> {
  const requested = options.requested
  const local = await options.lookupLocal(requested)
  if (local.length > 0) return [options.toLocalResult(local, requested)]

  let apiError: unknown
  if (options.lookupApi) {
    try {
      const api = await options.lookupApi()
      if (api.length > 0) return api
    } catch (error) {
      apiError = error
    }
  }

  for (const translation of options.localIds) {
    if (translation.toUpperCase() === requested.toUpperCase()) continue
    const verses = await options.lookupLocal(translation)
    if (verses.length > 0) return [options.toLocalResult(verses, translation)]
  }

  if (apiError) throw apiError
  return []
}
