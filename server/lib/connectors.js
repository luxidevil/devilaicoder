function truncateText(value, limit = 60000) {
  return String(value ?? '').slice(0, limit);
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'');
}

function stripHtml(html) {
  return decodeHtmlEntities(
    String(html ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
  );
}

function uniqueList(values, limit = 20) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((entry) => String(entry ?? '').trim()).filter(Boolean))).slice(0, limit);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch {
    return null;
  }
}

function normalizeSourceType(value) {
  const sourceType = String(value ?? '').trim().toLowerCase();
  return ['figma', 'github', 'web', 'openapi'].includes(sourceType) ? sourceType : 'web';
}

async function fetchWithError(url, init = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Fetch failed (${response.status})${text ? `: ${text.slice(0, 400)}` : ''}`);
  }
  return response;
}

function extractPageTitle(html) {
  const match = String(html ?? '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).trim() : '';
}

function extractHeadings(html) {
  const headings = [];
  for (const match of String(html ?? '').matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const heading = stripHtml(match[2]);
    if (heading) headings.push(heading);
    if (headings.length >= 12) break;
  }
  return headings;
}

function parseGitHubRepo(url) {
  try {
    const parsed = new URL(String(url ?? '').trim());
    if (parsed.hostname !== 'github.com') return null;
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return null;
    return {
      owner,
      repo: repo.replace(/\.git$/i, ''),
      url: parsed.toString(),
    };
  } catch {
    return null;
  }
}

function parseFigmaLink(url) {
  try {
    const parsed = new URL(String(url ?? '').trim());
    if (!/figma\.com$/i.test(parsed.hostname)) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const fileIndex = parts.findIndex((part) => part === 'file' || part === 'design');
    const fileKey = fileIndex >= 0 ? parts[fileIndex + 1] : '';
    if (!fileKey) return null;
    return {
      url: parsed.toString(),
      fileKey,
      nodeId: parsed.searchParams.get('node-id') ?? '',
    };
  } catch {
    return null;
  }
}

function summarizeOpenApiDocument(rawText, sourceUrl = '') {
  const parsed = safeJsonParse(rawText);
  if (parsed && typeof parsed === 'object') {
    const servers = Array.isArray(parsed.servers) ? parsed.servers.map((entry) => String(entry?.url ?? '').trim()).filter(Boolean) : [];
    const paths = parsed.paths && typeof parsed.paths === 'object' ? Object.entries(parsed.paths) : [];
    const endpoints = [];
    for (const [route, definition] of paths.slice(0, 80)) {
      const methods = Object.keys(definition ?? {}).filter((method) => ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method.toLowerCase()));
      endpoints.push(`${methods.map((method) => method.toUpperCase()).join(', ') || 'METHOD'} ${route}`);
    }
    return {
      title: String(parsed.info?.title ?? 'OpenAPI spec').trim() || 'OpenAPI spec',
      content: [
        '# OpenAPI Import',
        sourceUrl ? `Source: ${sourceUrl}` : null,
        parsed.openapi ? `Version: ${parsed.openapi}` : parsed.swagger ? `Swagger: ${parsed.swagger}` : null,
        parsed.info?.description ? `Description: ${String(parsed.info.description).trim()}` : null,
        servers.length > 0 ? `Servers:\n${servers.slice(0, 10).map((server) => `- ${server}`).join('\n')}` : null,
        endpoints.length > 0 ? `Endpoints:\n${endpoints.join('\n')}` : null,
        parsed.components?.schemas ? `Schemas: ${Object.keys(parsed.components.schemas).slice(0, 20).join(', ')}` : null,
      ].filter(Boolean).join('\n\n'),
    };
  }

  const versionMatch = String(rawText).match(/^\s*(openapi|swagger)\s*:\s*([^\n]+)/m);
  const titleMatch = String(rawText).match(/^\s*title\s*:\s*([^\n]+)/m);
  const serverMatches = Array.from(String(rawText).matchAll(/^\s*-\s*(https?:\/\/[^\s#]+)/gm)).map((match) => match[1]);
  const endpoints = [];
  const lines = String(rawText).split('\n');
  let currentPath = '';
  for (const line of lines) {
    const pathMatch = line.match(/^\s{0,4}(\/[A-Za-z0-9_./{}:-]+)\s*:\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = currentPath && line.match(/^\s{2,8}(get|post|put|patch|delete|options|head)\s*:\s*$/i);
    if (methodMatch) {
      endpoints.push(`${methodMatch[1].toUpperCase()} ${currentPath}`);
      if (endpoints.length >= 80) break;
    }
  }
  return {
    title: titleMatch ? String(titleMatch[1]).trim() : 'OpenAPI spec',
    content: [
      '# OpenAPI Import',
      sourceUrl ? `Source: ${sourceUrl}` : null,
      versionMatch ? `${versionMatch[1]}: ${String(versionMatch[2]).trim()}` : null,
      serverMatches.length > 0 ? `Servers:\n${uniqueList(serverMatches, 10).map((server) => `- ${server}`).join('\n')}` : null,
      endpoints.length > 0 ? `Endpoints:\n${endpoints.join('\n')}` : `Raw excerpt:\n${truncateText(rawText, 12000)}`,
    ].filter(Boolean).join('\n\n'),
  };
}

function collectFigmaNodes(node, results, depth = 0, maxDepth = 4) {
  if (!node || typeof node !== 'object' || results.length >= 30 || depth > maxDepth) return;
  const name = String(node.name ?? '').trim();
  const type = String(node.type ?? '').trim();
  if (name && type && depth > 0) {
    results.push(`${'  '.repeat(Math.max(depth - 1, 0))}- ${type}: ${name}`);
  }
  for (const child of Array.isArray(node.children) ? node.children : []) {
    if (results.length >= 30) break;
    collectFigmaNodes(child, results, depth + 1, maxDepth);
  }
}

function summarizeFigmaFile(fileData, sourceUrl, selectedNode = null) {
  const document = fileData?.document ?? {};
  const pages = Array.isArray(document.children) ? document.children : [];
  const pageNames = pages.map((page) => String(page?.name ?? '').trim()).filter(Boolean).slice(0, 12);
  const nodeOutline = [];
  for (const page of pages.slice(0, 4)) {
    collectFigmaNodes(page, nodeOutline, 0, 3);
    if (nodeOutline.length >= 24) break;
  }
  const components = Object.values(fileData?.components ?? {}).map((entry) => String(entry?.name ?? '').trim()).filter(Boolean);
  const styles = Object.values(fileData?.styles ?? {}).map((entry) => String(entry?.name ?? '').trim()).filter(Boolean);
  const selectedNodeSummary = selectedNode?.nodes
    ? Object.values(selectedNode.nodes)
      .map((entry) => entry?.document)
      .filter(Boolean)
      .map((node) => {
        const lines = [];
        collectFigmaNodes(node, lines, 0, 2);
        return lines.join('\n');
      })
      .filter(Boolean)
      .join('\n')
    : '';

  return {
    title: String(fileData?.name ?? 'Figma design').trim() || 'Figma design',
    content: [
      '# Figma Import',
      `Source: ${sourceUrl}`,
      fileData?.lastModified ? `Last modified: ${fileData.lastModified}` : null,
      fileData?.version ? `Version: ${fileData.version}` : null,
      pageNames.length > 0 ? `Pages:\n${pageNames.map((page) => `- ${page}`).join('\n')}` : null,
      components.length > 0 ? `Components:\n${uniqueList(components, 20).map((name) => `- ${name}`).join('\n')}` : null,
      styles.length > 0 ? `Styles:\n${uniqueList(styles, 20).map((name) => `- ${name}`).join('\n')}` : null,
      nodeOutline.length > 0 ? `Layout outline:\n${nodeOutline.join('\n')}` : null,
      selectedNodeSummary ? `Selected node:\n${selectedNodeSummary}` : null,
    ].filter(Boolean).join('\n\n'),
  };
}

async function importFromWebsite(url, title = '') {
  const response = await fetchWithError(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
  const raw = await response.text();
  if (contentType.includes('application/json')) {
    const pretty = safeJsonParse(raw);
    return {
      title: title || new URL(url).hostname,
      content: ['# Website Import', `Source: ${url}`, '```json', truncateText(pretty ? JSON.stringify(pretty, null, 2) : raw, 20000), '```'].join('\n\n'),
      sourceRef: url,
    };
  }

  const pageTitle = extractPageTitle(raw) || title || new URL(url).hostname;
  const headings = extractHeadings(raw);
  const text = stripHtml(raw);
  return {
    title: pageTitle,
    content: [
      '# Website Import',
      `Source: ${url}`,
      headings.length > 0 ? `Headings:\n${headings.map((heading) => `- ${heading}`).join('\n')}` : null,
      `Extracted text:\n${truncateText(text, 20000)}`,
    ].filter(Boolean).join('\n\n'),
    sourceRef: url,
  };
}

async function importFromOpenApi(url, title = '') {
  const response = await fetchWithError(url, {
    headers: {
      Accept: 'application/json,application/yaml,text/yaml,text/plain;q=0.9,*/*;q=0.8',
    },
  });
  const raw = await response.text();
  const summary = summarizeOpenApiDocument(raw, url);
  return {
    title: title || summary.title,
    content: truncateText(summary.content, 30000),
    sourceRef: url,
  };
}

async function importFromGitHub(url, token = '', title = '') {
  const repo = parseGitHubRepo(url);
  if (!repo) throw new Error('Enter a valid GitHub repository URL.');
  const headers = {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const repoResponse = await fetchWithError(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, { headers });
  const repoData = await repoResponse.json();

  let readme = '';
  try {
    const readmeResponse = await fetchWithError(`https://api.github.com/repos/${repo.owner}/${repo.repo}/readme`, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    readme = await readmeResponse.text();
  } catch {}

  return {
    title: title || `${repo.owner}/${repo.repo}`,
    content: [
      '# GitHub Import',
      `Source: ${repo.url}`,
      repoData.description ? `Description: ${String(repoData.description).trim()}` : null,
      repoData.default_branch ? `Default branch: ${repoData.default_branch}` : null,
      Array.isArray(repoData.topics) && repoData.topics.length > 0 ? `Topics: ${repoData.topics.join(', ')}` : null,
      repoData.language ? `Primary language: ${repoData.language}` : null,
      readme ? `README excerpt:\n${truncateText(readme, 20000)}` : null,
    ].filter(Boolean).join('\n\n'),
    sourceRef: repo.url,
  };
}

async function importFromFigma(url, token = '', title = '') {
  if (!token) throw new Error('A Figma token is required. Provide one in the import form or store FIGMA_TOKEN in project secrets.');
  const figma = parseFigmaLink(url);
  if (!figma) throw new Error('Enter a valid Figma file URL.');
  const headers = { 'X-Figma-Token': token };
  const fileResponse = await fetchWithError(`https://api.figma.com/v1/files/${figma.fileKey}`, { headers });
  const fileData = await fileResponse.json();
  let selectedNode = null;
  if (figma.nodeId) {
    try {
      const nodeResponse = await fetchWithError(`https://api.figma.com/v1/files/${figma.fileKey}/nodes?ids=${encodeURIComponent(figma.nodeId)}`, { headers });
      selectedNode = await nodeResponse.json();
    } catch {}
  }
  const summary = summarizeFigmaFile(fileData, figma.url, selectedNode);
  return {
    title: title || summary.title,
    content: truncateText(summary.content, 30000),
    sourceRef: figma.url,
  };
}

export async function importProjectConnectorDoc(payload = {}) {
  const sourceType = normalizeSourceType(payload.sourceType);
  const url = String(payload.url ?? '').trim();
  const title = String(payload.title ?? '').trim();
  const token = String(payload.token ?? '').trim();
  const projectSecrets = payload.projectSecrets ?? {};

  if (!url) {
    throw new Error('A source URL is required.');
  }

  if (sourceType === 'figma') {
    return {
      sourceType,
      ...(await importFromFigma(url, token || projectSecrets.FIGMA_TOKEN || projectSecrets.FIGMA_API_TOKEN || '', title)),
    };
  }

  if (sourceType === 'github') {
    return {
      sourceType,
      ...(await importFromGitHub(url, token || projectSecrets.GITHUB_TOKEN || '', title)),
    };
  }

  if (sourceType === 'openapi') {
    return {
      sourceType,
      ...(await importFromOpenApi(url, title)),
    };
  }

  return {
    sourceType: 'web',
    ...(await importFromWebsite(url, title)),
  };
}
