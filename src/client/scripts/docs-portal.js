const docsState = { activeSlug: 'index', query: '' };

function docsEscape(value) {
  const element = document.createElement('span');
  element.textContent = String(value ?? '');
  return element.innerHTML;
}

function docsRouteSlug() {
  const path = window.location.pathname.replace(/^\/docs\/?/, '').replace(/\/$/, '');
  try { return decodeURIComponent(path) || 'index'; }
  catch (_) { return 'index'; }
}

function docsPageOrder() {
  const data = window.OLANAS_DOCS;
  if (!data) return [];
  return data.navigation.tabs.flatMap(tab => tab.groups.flatMap(group => group.pages));
}

function docsPageUrl(slug) {
  return slug === 'index' ? '/docs' : '/docs/' + slug.split('/').map(encodeURIComponent).join('/');
}

function renderDocsSidebar() {
  const data = window.OLANAS_DOCS;
  const container = document.getElementById('docsSidebarNav');
  if (!data || !container) return;
  const query = docsState.query.trim().toLowerCase();
  const groups = [];
  for (const tab of data.navigation.tabs) {
    for (const group of tab.groups) {
      const pages = group.pages.filter(slug => {
        const page = data.pages[slug];
        if (!page || !query) return Boolean(page);
        const haystack = `${page.title} ${page.description} ${page.html.replace(/<[^>]+>/g, ' ')}`.toLowerCase();
        return haystack.includes(query);
      });
      if (!pages.length) continue;
      groups.push(`<div class='docs-nav-group'><span>${docsEscape(group.group)}</span>${pages.map(slug => {
        const page = data.pages[slug];
        return `<a href='${docsPageUrl(slug)}' data-doc-slug='${docsEscape(slug)}' class='${slug === docsState.activeSlug ? 'active' : ''}'>${docsEscape(page.title)}</a>`;
      }).join('')}</div>`);
    }
  }
  container.innerHTML = groups.join('') || '<p class="docs-search-empty">No documentation matched that search.</p>';
}

function enhanceDocsArticle(article) {
  article.querySelectorAll('pre').forEach(pre => {
    const wrapper = document.createElement('div');
    wrapper.className = 'docs-code-wrap';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'docs-copy-code';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(pre.textContent);
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy'; }, 1400);
    });
    wrapper.appendChild(button);
  });
  article.querySelectorAll('a[href^="http"]').forEach(link => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
}

function openDocsPage(slug, options = {}) {
  const data = window.OLANAS_DOCS;
  if (!data) return;
  const page = data.pages[slug] || data.pages.index;
  if (!page) return;
  docsState.activeSlug = page.slug;
  switchView('docs');
  if (options.history !== false && window.location.pathname !== docsPageUrl(page.slug)) {
    history.pushState(null, '', docsPageUrl(page.slug));
  }
  renderDocsSidebar();

  const article = document.getElementById('docsArticle');
  const order = docsPageOrder();
  const index = order.indexOf(page.slug);
  const previous = index > 0 ? data.pages[order[index - 1]] : null;
  const next = index >= 0 && index < order.length - 1 ? data.pages[order[index + 1]] : null;
  const sourceUrl = `${data.sourceRepository}/blob/main/${page.sourcePath}`;
  article.innerHTML = `
    <div class='docs-article-head'>
      <div><span>Olanas documentation</span><h1>${docsEscape(page.title)}</h1><p>${docsEscape(page.description)}</p></div>
      <a href='${docsEscape(sourceUrl)}' target='_blank' rel='noopener noreferrer'>Edit on GitHub ↗</a>
    </div>
    <div class='docs-rendered'>${page.html}</div>
    <nav class='docs-page-nav'>
      ${previous ? `<a href='${docsPageUrl(previous.slug)}' data-doc-slug='${docsEscape(previous.slug)}'><small>Previous</small><strong>← ${docsEscape(previous.title)}</strong></a>` : '<span></span>'}
      ${next ? `<a href='${docsPageUrl(next.slug)}' data-doc-slug='${docsEscape(next.slug)}'><small>Next</small><strong>${docsEscape(next.title)} →</strong></a>` : '<span></span>'}
    </nav>`;
  enhanceDocsArticle(article);
  document.getElementById('docsMain')?.scrollTo({ top: 0 });
  document.title = `${page.title} · Olanas Docs`;
}

function renderDocsRoute() {
  openDocsPage(docsRouteSlug(), { history: false });
}

function initDocsPortal() {
  const data = window.OLANAS_DOCS;
  const article = document.getElementById('docsArticle');
  if (!data || !article) {
    if (article) article.innerHTML = '<div class="docs-load-error">Documentation could not be loaded.</div>';
    return;
  }
  document.getElementById('docsSourceLink').href = data.sourceRepository;
  document.getElementById('docsSearch')?.addEventListener('input', event => {
    docsState.query = event.target.value;
    renderDocsSidebar();
  });
  document.getElementById('view-docs')?.addEventListener('click', event => {
    const link = event.target.closest('a[data-doc-slug]');
    if (!link) return;
    event.preventDefault();
    openDocsPage(link.dataset.docSlug);
  });
  renderDocsSidebar();
  if (window.location.pathname === '/docs' || window.location.pathname.startsWith('/docs/')) renderDocsRoute();
}

window.renderDocsRoute = renderDocsRoute;
