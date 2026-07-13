export function stringifyQuery(params: Record<string, unknown>): string {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

export function queryValue(search: string, key: string): string {
  const source = search.startsWith('?') ? search.slice(1) : search;
  for (const pair of source.split('&')) {
    if (!pair) continue;
    const [rawKey, ...rawValue] = pair.split('=');
    if (decodeURIComponent(rawKey) === key) {
      return decodeURIComponent(rawValue.join('=') || '');
    }
  }
  return '';
}
