export function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', css: 'css', scss: 'scss',
    html: 'html', json: 'json', md: 'markdown', sh: 'shell',
    yaml: 'yaml', yml: 'yaml', sql: 'sql', toml: 'toml',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', java: 'java',
    kt: 'kotlin', swift: 'swift', rb: 'ruby', php: 'php',
    vue: 'html', svelte: 'html', xml: 'xml', env: 'ini',
  };
  return map[ext] ?? 'plaintext';
}

export function getLangBadgeColor(lang: string): string {
  const colors: Record<string, string> = {
    typescript: 'text-blue-400 bg-blue-400/10',
    javascript: 'text-yellow-400 bg-yellow-400/10',
    python: 'text-green-400 bg-green-400/10',
    rust: 'text-orange-400 bg-orange-400/10',
    go: 'text-cyan-400 bg-cyan-400/10',
    css: 'text-pink-400 bg-pink-400/10',
    html: 'text-red-400 bg-red-400/10',
    json: 'text-gray-400 bg-gray-400/10',
    markdown: 'text-slate-400 bg-slate-400/10',
  };
  return colors[lang] ?? 'text-gray-400 bg-gray-400/10';
}
