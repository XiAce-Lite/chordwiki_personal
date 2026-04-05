const titleInput = document.getElementById('title');
const slugInput = document.getElementById('slug');
const artistInput = document.getElementById('artist');
const tagsInput = document.getElementById('tags');
const chordProInput = document.getElementById('chordPro');
const addForm = document.getElementById('add-form');
const messageBox = document.getElementById('message');
const cancelButton = document.getElementById('cancel-button');
let slugEdited = false;

titleInput.addEventListener('input', () => {
  if (!slugEdited) {
    slugInput.value = titleInput.value;
  }
});

slugInput.addEventListener('input', () => {
  if (slugInput.value !== titleInput.value) {
    slugEdited = true;
  }
});

cancelButton.addEventListener('click', () => {
  location.href = '/';
});

function normalizeNewlines(text) {
  return text.replace(/\r\n|\n\r|\r/g, '\n');
}

function generateUuid() {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function showMessage(text, type = 'error') {
  messageBox.textContent = text;
  messageBox.className = type;
}

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('', '');

  const title = titleInput.value.trim();
  const slug = slugInput.value.trim();
  const artist = artistInput.value.trim();
  const tagsText = tagsInput.value.trim();
  const chordProText = chordProInput.value.trim();

  if (!title || !slug || !artist || !tagsText || !chordProText) {
    showMessage('すべての項目を入力してください。', 'error');
    return;
  }

  const tags = normalizeNewlines(tagsText)
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (tags.length === 0) {
    showMessage('タグを1つ以上入力してください。', 'error');
    return;
  }

  const chordPro = normalizeNewlines(chordProText);
  const payload = {
    id: generateUuid(),
    title,
    slug,
    artist,
    tags,
    chordPro,
    updatedAt: new Date().toISOString()
  };

  try {
    const response = await fetch('/api/edit/song', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: "include",
      body: JSON.stringify(payload)
    });

    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = responseBody?.error?.detail || responseBody?.detail || responseBody?.error || '登録に失敗しました。';
      showMessage(detail, 'error');
      return;
    }

    showMessage('登録できました。トップページへ移動します...', 'success');
    setTimeout(() => {
      location.href = '/';
    }, 1500);
  } catch (error) {
    console.error(error);
    showMessage('通信エラーが発生しました。', 'error');
  }
});