export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.endsWith('.mjs')) {
    let target = specifier
    if (target.endsWith('.js')) target = target.slice(0, -3)
    if (!target.endsWith('.ts')) target += '.ts'
    try {
      return await nextResolve(target, context)
    } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
}
