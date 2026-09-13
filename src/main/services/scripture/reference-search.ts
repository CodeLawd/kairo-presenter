/** Resolve only the translation selected by the operator; never substitute wording. */
export async function resolveReferenceLookup<TVerse, TResult>(options: {
  requested: string
  localIds: readonly string[]
  lookupLocal: (translation: string) => Promise<TVerse[]>
  lookupApi: (() => Promise<TResult[]>) | null
  toLocalResult: (verses: TVerse[], translation: string) => TResult
}): Promise<TResult[]> {
  const requested = options.requested
  const requestedIsLocal = options.localIds.some(
    (translation) => translation.toUpperCase() === requested.toUpperCase(),
  )
  if (requestedIsLocal) {
    const local = await options.lookupLocal(requested)
    return local.length > 0 ? [options.toLocalResult(local, requested)] : []
  }

  return options.lookupApi ? options.lookupApi() : []
}
