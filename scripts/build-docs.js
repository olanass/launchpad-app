const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(projectRoot, 'docs', 'site');
const generatedRoot = path.join(projectRoot, 'src', 'client', 'generated');

function readPage(slug) {
  const candidates = [path.join(docsRoot, slug + '.mdx'), path.join(docsRoot, slug + '.md')];
  const file = candidates.find(candidate => fs.existsSync(candidate));
  if (!file) throw new Error(`Documentation page not found: ${slug}`);
  return { file, source: fs.readFileSync(file, 'utf8') };
}

function frontmatter(source, slug) {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  const values = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return {
    title: values.title || slug.split('/').pop().replace(/-/g, ' '),
    description: values.description || '',
    body: match ? source.slice(match[0].length) : source
  };
}

function quoteCallout(label, body) {
  const lines = body.trim().split(/\r?\n/).map(line => `> ${line}`);
  return `\n> **${label}**\n>\n${lines.join('\n')}\n`;
}

function mintlifyToMarkdown(source) {
  let result = source;
  for (const [tag, label] of [['Info', 'Info'], ['Warning', 'Warning'], ['Note', 'Note'], ['Check', 'Verified']]) {
    result = result.replace(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g'), (_, body) => quoteCallout(label, body));
  }
  result = result.replace(/<Card\s+title="([^"]+)"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/Card>/g,
    (_, title, href, body) => `\n### [${title}](${href})\n\n${body.trim()}\n`);
  result = result.replace(/<Card\s+title="([^"]+)"[^>]*>([\s\S]*?)<\/Card>/g,
    (_, title, body) => `\n### ${title}\n\n${body.trim()}\n`);
  result = result.replace(/<Step\s+title="([^"]+)"[^>]*>([\s\S]*?)<\/Step>/g,
    (_, title, body) => `\n### ${title}\n\n${body.trim()}\n`);
  result = result.replace(/<Tab\s+title="([^"]+)"[^>]*>([\s\S]*?)<\/Tab>/g,
    (_, title, body) => `\n### ${title}\n\n${body.trim()}\n`);
  result = result.replace(/<Accordion\s+title="([^"]+)"[^>]*>([\s\S]*?)<\/Accordion>/g,
    (_, title, body) => `\n### ${title}\n\n${body.trim()}\n`);
  result = result.replace(/<Frame\s+caption="([^"]+)"[^>]*>([\s\S]*?)<\/Frame>/g,
    (_, caption, body) => `\n${body.trim()}\n\n*${caption}*\n`);
  result = result.replace(/<\/?(?:Columns|Steps|Tabs|AccordionGroup)(?:\s+[^>]*)?>/g, '');
  result = result.replace(/src="\/images\//g, 'src="/generated/docs-assets/');
  return result;
}

async function buildDocs() {
  const { marked } = await import('marked');
  const config = JSON.parse(fs.readFileSync(path.join(docsRoot, 'docs.json'), 'utf8'));
  const slugs = [];
  for (const tab of config.navigation.tabs) {
    for (const group of tab.groups) {
      for (const slug of group.pages) if (!slugs.includes(slug)) slugs.push(slug);
    }
  }

  const pages = {};
  const markdownPages = {};
  for (const slug of slugs) {
    const { source } = readPage(slug);
    const parsed = frontmatter(source, slug);
    const markdown = mintlifyToMarkdown(parsed.body).trim();
    markdownPages[slug] = `# ${parsed.title}\n\n${parsed.description ? parsed.description + '\n\n' : ''}${markdown}\n`;
    let html = await marked.parse(markdown, { gfm: true });
    html = html.replace(/href="\/(?!docs(?:\/|"))/g, 'href="/docs/');
    pages[slug] = {
      slug,
      title: parsed.title,
      description: parsed.description,
      sourcePath: slug + (fs.existsSync(path.join(docsRoot, slug + '.mdx')) ? '.mdx' : '.md'),
      html
    };
  }

  fs.mkdirSync(generatedRoot, { recursive: true });
  const assetTarget = path.join(generatedRoot, 'docs-assets');
  fs.rmSync(assetTarget, { recursive: true, force: true });
  fs.cpSync(path.join(docsRoot, 'images'), assetTarget, { recursive: true });
  const payload = {
    name: config.name,
    description: config.description,
    sourceRepository: 'https://github.com/olanass/docs',
    navigation: config.navigation,
    pages
  };
  fs.writeFileSync(path.join(generatedRoot, 'docs-content.js'), `window.OLANAS_DOCS = ${JSON.stringify(payload)};\n`);
  const markdownRoot = path.join(generatedRoot, 'docs-markdown');
  fs.rmSync(markdownRoot, { recursive: true, force: true });
  for (const [slug, markdown] of Object.entries(markdownPages)) {
    const output = path.join(markdownRoot, slug + '.md');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, markdown);
  }
  const llms = [
    '# Olanas',
    '',
    '> The API launchpad for Robinhood Chain. Turn HTTP endpoints into x402-paid products for humans and AI agents.',
    '',
    'Canonical site: https://olanas.xyz',
    'MCP endpoint: https://olanas.xyz/mcp',
    'API discovery: https://olanas.xyz/discovery/resources',
    '',
    ...slugs.flatMap(slug => [`## ${pages[slug].title}`, '', `Source: https://olanas.xyz/docs/${slug}.md`, '', markdownPages[slug], ''])
  ].join('\n');
  fs.writeFileSync(path.join(generatedRoot, 'llms.txt'), llms);
  console.log(`Documentation portal built with ${slugs.length} pages.`);
}

if (require.main === module) buildDocs().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { buildDocs };
