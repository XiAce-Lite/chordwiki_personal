(function attachChordWikiSetlistUi(global) {
  const setlistStore = global.ChordWikiSetlists;

  function ensureToastContainer() {
    let container = document.getElementById('cw-toast-container');
    if (container) {
      return container;
    }

    container = document.createElement('div');
    container.id = 'cw-toast-container';
    container.className = 'cw-toast-container';
    document.body.appendChild(container);
    return container;
  }

  function showToast(message, tone = 'info') {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `cw-toast is-${tone}`;
    toast.textContent = String(message || '').trim() || '完了しました';
    container.appendChild(toast);

    global.setTimeout(() => {
      toast.classList.add('is-hide');
      global.setTimeout(() => toast.remove(), 220);
    }, 2200);
  }

  function createModalShell(title) {
    const overlay = document.createElement('div');
    overlay.className = 'cw-modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'cw-modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const heading = document.createElement('h2');
    heading.className = 'cw-modal-title';
    heading.textContent = title;

    const body = document.createElement('div');
    body.className = 'cw-modal-body';

    const actions = document.createElement('div');
    actions.className = 'cw-modal-actions';

    dialog.appendChild(heading);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        overlay.remove();
      }
    });

    return { overlay, body, actions };
  }

  function openCreateSetlistModal({ onCreated, defaultName = '' } = {}) {
    const { overlay, body, actions } = createModalShell('新規セットリストを作成');

    const input = document.createElement('input');
    input.className = 'cw-input';
    input.type = 'text';
    input.maxLength = 80;
    input.placeholder = 'セットリスト名を入力';
    input.value = String(defaultName || '').trim();

    const message = document.createElement('div');
    message.className = 'cw-modal-message';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'cw-button';
    cancelButton.textContent = 'キャンセル';

    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'cw-button cw-button-primary';
    createButton.textContent = '作成';

    const submit = () => {
      const name = String(input.value || '').trim();
      if (!name) {
        message.textContent = 'セットリスト名を入力してください。';
        return;
      }

      let created;
      try {
        created = setlistStore.createSetlist(name);
      } catch (error) {
        message.textContent = String(error?.message || 'セットリストを作成できませんでした。');
        return;
      }

      overlay.remove();
      if (typeof onCreated === 'function') {
        onCreated(created);
      }
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });

    cancelButton.addEventListener('click', () => overlay.remove());
    createButton.addEventListener('click', submit);

    body.appendChild(input);
    body.appendChild(message);
    actions.appendChild(cancelButton);
    actions.appendChild(createButton);
    document.body.appendChild(overlay);
    input.focus();
  }

  function openSetlistSelectionModal(song, { onDone } = {}) {
    const songId = String(song?.id || '').trim();
    if (!songId) {
      showToast('曲IDが不正です。', 'error');
      return;
    }

    const setlists = setlistStore.readSetlists();

    if (setlists.length === 0) {
      openCreateSetlistModal({
        onCreated: (createdSetlist) => {
          const result = setlistStore.addSongToSetlist(createdSetlist.id, songId);
          if (result.ok) {
            showToast('セットリストを作成し、曲を追加しました', 'success');
            onDone?.(result);
          }
        }
      });
      return;
    }

    const { overlay, body, actions } = createModalShell('セットリストに追加');
    const list = document.createElement('div');
    list.className = 'cw-setlist-select-list';

    setlists.forEach((setlist) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cw-setlist-select-item';
      button.textContent = `${setlist.name} (${setlist.songs.length})`;
      button.addEventListener('click', () => {
        const result = setlistStore.addSongToSetlist(setlist.id, songId);
        if (result.ok) {
          overlay.remove();
          showToast('セットリストに曲を追加しました', 'success');
          onDone?.(result);
          return;
        }

        if (result.reason === 'duplicate') {
          showToast('この曲はすでにセットリストに含まれています', 'warn');
          return;
        }

        showToast('曲を追加できませんでした', 'error');
      });
      list.appendChild(button);
    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'cw-button';
    closeButton.textContent = '閉じる';
    closeButton.addEventListener('click', () => overlay.remove());

    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'cw-button cw-button-primary';
    createButton.textContent = '+ 新規セットリストを作成';
    createButton.addEventListener('click', () => {
      overlay.remove();
      openCreateSetlistModal({
        onCreated: (createdSetlist) => {
          const result = setlistStore.addSongToSetlist(createdSetlist.id, songId);
          if (result.ok) {
            showToast('セットリストを作成し、曲を追加しました', 'success');
            onDone?.(result);
          }
        }
      });
    });

    body.appendChild(list);
    actions.appendChild(closeButton);
    actions.appendChild(createButton);
    document.body.appendChild(overlay);
  }

  function createSongAddPanel(container, songId) {
    const root = container;
    if (!root) {
      return;
    }

    const toggleButton = root.querySelector('[data-role="setlist-toggle"]');
    const panel = root.querySelector('[data-role="setlist-panel"]');
    if (!toggleButton || !panel) {
      return;
    }

    const closePanel = () => {
      panel.hidden = true;
      toggleButton.setAttribute('aria-expanded', 'false');
    };

    const renderPanel = () => {
      const setlists = setlistStore.readSetlists();
      panel.innerHTML = '';

      if (setlists.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cw-inline-empty';
        empty.textContent = 'セットリストがありません';
        panel.appendChild(empty);
      } else {
        setlists.forEach((setlist) => {
          const itemButton = document.createElement('button');
          itemButton.type = 'button';
          itemButton.className = 'cw-inline-setlist-item';
          itemButton.textContent = `${setlist.name} (${setlist.songs.length})`;
          itemButton.addEventListener('click', () => {
            const result = setlistStore.addSongToSetlist(setlist.id, songId);
            if (result.ok) {
              showToast('セットリストに曲を追加しました', 'success');
              renderPanel();
              return;
            }

            if (result.reason === 'duplicate') {
              showToast('この曲はすでにセットリストに含まれています', 'warn');
              return;
            }

            showToast('曲を追加できませんでした', 'error');
          });
          panel.appendChild(itemButton);
        });
      }

      const createButton = document.createElement('button');
      createButton.type = 'button';
      createButton.className = 'cw-inline-create';
      createButton.textContent = '+ 新規セットリストを作成';
      createButton.addEventListener('click', () => {
        openCreateSetlistModal({
          onCreated: (createdSetlist) => {
            const result = setlistStore.addSongToSetlist(createdSetlist.id, songId);
            if (result.ok) {
              showToast('セットリストを作成し、曲を追加しました', 'success');
              renderPanel();
            }
          }
        });
      });
      panel.appendChild(createButton);
    };

    toggleButton.addEventListener('click', () => {
      const isOpen = !panel.hidden;
      if (isOpen) {
        closePanel();
        return;
      }

      renderPanel();
      panel.hidden = false;
      toggleButton.setAttribute('aria-expanded', 'true');
    });

    document.addEventListener('click', (event) => {
      if (!root.contains(event.target)) {
        closePanel();
      }
    });
  }

  global.ChordWikiSetlistUi = Object.freeze({
    showToast,
    openSetlistSelectionModal,
    openCreateSetlistModal,
    createSongAddPanel
  });
})(window);
