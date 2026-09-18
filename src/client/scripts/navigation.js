// -------------------------------------------------------------
// 1. NAVIGATION & ROUTING
// -------------------------------------------------------------
function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });

  const btnCreateNew = document.getElementById('btnCreateNew');
  if (btnCreateNew) {
    btnCreateNew.addEventListener('click', () => switchView('create'));
  }

  const navHome = document.getElementById('navHome');
  if (navHome) {
    navHome.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState(null, '', '/');
      switchView('create');
    });
  }
}

function switchView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.add('active');

  const activeBtn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (viewName === 'mylinks') {
    fetchMyLinks();
  }
}
