(function attachChordWikiAuth(global) {
  let principalPromise = null;

  async function getClientPrincipal() {
    if (!principalPromise) {
      principalPromise = fetch('/.auth/me', {
        credentials: 'include'
      })
        .then(async (response) => {
          if (!response.ok) {
            return { userRoles: [] };
          }

          const data = await response.json().catch(() => ({}));
          const principal = Array.isArray(data?.clientPrincipal)
            ? data.clientPrincipal[0]
            : data?.clientPrincipal;

          return principal && typeof principal === 'object'
            ? principal
            : { userRoles: [] };
        })
        .catch((error) => {
          console.warn('Failed to fetch /.auth/me:', error);
          return { userRoles: [] };
        });
    }

    return principalPromise;
  }

  async function isEditor() {
    const principal = await getClientPrincipal();
    const roles = Array.isArray(principal?.userRoles) ? principal.userRoles : [];
    return roles.includes('editor');
  }

  async function applyRoleVisibility(root = document) {
    const editor = await isEditor();
    const htmlEl = document.documentElement;

    htmlEl.classList.toggle('editor-enabled', editor);

    const elements = root.querySelectorAll?.('.editor-only') || [];
    for (const el of elements) {
      const desiredDisplay = el.dataset.display || '';

      if (editor) {
        if (desiredDisplay) {
          el.style.display = desiredDisplay;
        } else {
          el.style.removeProperty('display');
        }
        el.removeAttribute('aria-hidden');
      } else {
        el.style.display = 'none';
        el.setAttribute('aria-hidden', 'true');
      }
    }

    return editor;
  }

  global.ChordWikiAuth = {
    getClientPrincipal,
    isEditor,
    applyRoleVisibility
  };
})(window);