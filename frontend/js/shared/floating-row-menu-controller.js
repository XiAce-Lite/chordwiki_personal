(function attachChordWikiFloatingRowMenuController(global) {
  let active = null;
  let outsideBound = false;

  function isInSubtree(root, node) {
    if (!root || !node) return false;
    if (root === node) return true;
    return typeof root.contains === 'function' ? root.contains(node) : false;
  }

  function bindOutsideHandlers() {
    if (outsideBound) return;
    outsideBound = true;

    document.addEventListener('click', (event) => {
      if (!active) return;
      const { triggerEl, menuEl, controller } = active;
      const target = event.target;
      if (isInSubtree(triggerEl, target) || isInSubtree(menuEl, target)) {
        return;
      }
      controller.close();
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' && event.code !== 'Escape') return;
      if (!active) return;
      active.controller.close();
    });
  }

  function createFloatingRowMenuController({
    triggerEl,
    menuEl,
    offsetY = 6,
    flip = true
  }) {
    bindOutsideHandlers();

    if (!triggerEl || !menuEl) {
      throw new Error('createFloatingRowMenuController requires triggerEl and menuEl.');
    }

    let isOpen = false;
    let originalParentEl = menuEl.parentElement;
    let originalNextSibling = menuEl.nextSibling;
    let updateRafId = 0;
    const controllerApi = {
      close: () => {
        close();
      }
    };

    function setAria(isExpanded) {
      try {
        triggerEl.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      } catch {
        // ignore
      }
      try {
        menuEl.setAttribute('aria-hidden', isExpanded ? 'false' : 'true');
      } catch {
        // ignore
      }
    }

    function restoreMenuToOriginalParent() {
      if (!originalParentEl || !originalParentEl.isConnected) return;

      // nextSibling が既に置換されている場合は append 寄せで妥協する
      if (originalNextSibling && originalNextSibling.parentElement === originalParentEl) {
        originalParentEl.insertBefore(menuEl, originalNextSibling);
      } else {
        originalParentEl.appendChild(menuEl);
      }
    }

    function positionMenu() {
      if (!isOpen) return;

      if (updateRafId) {
        global.cancelAnimationFrame?.(updateRafId);
      }

      updateRafId = global.requestAnimationFrame(() => {
        updateRafId = 0;

        const triggerRect = triggerEl.getBoundingClientRect();

        // 計測用に一旦左上へ固定し、透明にして高さ/幅を取る
        menuEl.hidden = false;
        menuEl.style.display = 'block';
        menuEl.style.visibility = 'hidden';
        menuEl.style.position = 'fixed';
        menuEl.style.right = 'auto';
        menuEl.style.top = '0px';
        menuEl.style.left = '0px';

        const menuRect = menuEl.getBoundingClientRect();
        const menuWidth = menuRect.width || 0;
        const menuHeight = menuRect.height || 0;

        const margin = 8; // 画面端との最小マージン
        const bottomTop = triggerRect.bottom + offsetY;
        const topTop = triggerRect.top - menuHeight - offsetY;

        let useTop = false;
        if (flip && bottomTop + menuHeight > global.innerHeight) {
          useTop = topTop >= margin;
        }

        const desiredTop = useTop ? topTop : bottomTop;
        const clampedTop = Math.max(margin, Math.min(desiredTop, global.innerHeight - menuHeight - margin));

        // existing CSS は right:0 で右寄せの見た目なので、右端を揃える
        const desiredLeft = triggerRect.right - menuWidth;
        const clampedLeft = Math.max(margin, Math.min(desiredLeft, global.innerWidth - menuWidth - margin));

        menuEl.style.top = `${clampedTop}px`;
        menuEl.style.left = `${clampedLeft}px`;
        menuEl.style.visibility = '';
      });
    }

    function open() {
      if (isOpen) return;

      // 別のメニューが開いているなら先に閉じる
      if (active?.controller?.close) {
        active.controller.close();
      }

      isOpen = true;
      active = { triggerEl, menuEl, controller: controllerApi };
      setAria(true);

      // 現在親が list でも overflow で切られないよう body にポータル
      if (menuEl.parentElement !== global.document.body) {
        originalParentEl = menuEl.parentElement;
        originalNextSibling = menuEl.nextSibling;
        global.document.body.appendChild(menuEl);
      }

      menuEl.hidden = false;
      positionMenu();

      global.addEventListener('resize', positionMenu);
      global.addEventListener('scroll', positionMenu, true);
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      if (active && active.controller === controllerApi) {
        active = null;
      }

      setAria(false);
      menuEl.hidden = true;

      global.removeEventListener('resize', positionMenu);
      global.removeEventListener('scroll', positionMenu, true);

      // DOM クリッピング回避のため開封時だけ body に出す。閉じたら戻す。
      restoreMenuToOriginalParent();
    }

    function toggle() {
      if (isOpen) {
        close();
        return;
      }
      open();
    }

    triggerEl.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle();
    });

    // メニュー内クリックは選択扱いで閉じる（open は保持してからでOK）
    menuEl.addEventListener('click', () => {
      if (!isOpen) return;
      if (global.queueMicrotask) {
        global.queueMicrotask(close);
      } else {
        close();
      }
    });

    // initial state
    setAria(false);
    menuEl.hidden = true;

    return Object.freeze({
      open,
      close,
      toggle,
      get isOpen() {
        return isOpen;
      }
    });
  }

  global.ChordWikiFloatingRowMenuController = Object.freeze({
    createFloatingRowMenuController
  });
})(window);

