import type { CreatorRecipe, OruApi } from '../shared/types';

const api = (window as unknown as { oru: OruApi }).oru;
const c = api.creator;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const nameInput = $<HTMLInputElement>('name');
const consent = $<HTMLInputElement>('consent');
const pickPhoto = $<HTMLButtonElement>('pick-photo');
const buildBtn = $<HTMLButtonElement>('build');
const log = $<HTMLPreElement>('log');

const videos: Partial<Record<CreatorRecipe['id'], string>> = {};
let building = false;

const list = (el: HTMLElement, items: string[]) => {
  el.replaceChildren(...items.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
};

function refresh(): void {
  const named = nameInput.value.trim().length > 0;
  pickPhoto.disabled = !consent.checked || !named;
  buildBtn.disabled = building || !consent.checked || !named || !videos.hello;
  $('build-hint').textContent = !consent.checked || !named
    ? 'Fill in step 1 first'
    : videos.hello ? `${Object.keys(videos).length} of 3 videos added` : 'Add at least the Hello video';
}
nameInput.addEventListener('input', refresh);
consent.addEventListener('change', refresh);

// ---------- step 1: photo ----------
pickPhoto.addEventListener('click', async () => {
  const src = await c.pick('photo');
  if (src) await usePhoto(src);
});

let preparingPhoto = false;

async function usePhoto(src: string): Promise<void> {
  preparingPhoto = true;
  $('photo-status').textContent = 'Finding the person and preparing the image…';
  list($('photo-warnings'), []);
  try {
    const r = await c.preparePhoto(src);
    $<HTMLImageElement>('photo-img').src = r.preview;
    $('photo-preview').hidden = false;
    $('save-row').hidden = false;
    $('photo-status').textContent = `Backdrop: ${r.backdrop} (chosen so it doesn't match the clothes)`;
    list($('photo-warnings'), r.warnings);
  } catch (e) {
    $('photo-status').textContent = '';
    list($('photo-warnings'), [(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')]);
  } finally {
    preparingPhoto = false;
  }
}

$('save-image').addEventListener('click', async () => {
  const saved = await c.saveImage(nameInput.value.trim());
  if (saved) $('photo-status').textContent = `Saved to ${saved}`;
});

// ---------- step 2: recipes ----------
$('open-gemini').addEventListener('click', () => c.openGemini());

function renderRecipes(recipes: CreatorRecipe[]): void {
  $('recipes').replaceChildren(...recipes.map((r, i) => {
    const el = document.createElement('div');
    el.className = 'recipe';
    el.innerHTML = `
      <header><h3></h3><span class="makes"></span></header>
      <p></p>
      <div class="actions"><button class="btn copy">Copy prompt</button><button class="linkish more">Show all</button></div>`;
    el.querySelector('h3')!.textContent = `Video ${i + 1}: ${r.title}`;
    el.querySelector('.makes')!.textContent = r.makes.join(' · ');
    el.querySelector('p')!.textContent = r.prompt;
    const copy = el.querySelector<HTMLButtonElement>('.copy')!;
    copy.addEventListener('click', () => {
      c.copy(r.prompt);
      copy.textContent = 'Copied ✓';
      setTimeout(() => (copy.textContent = 'Copy prompt'), 1500);
    });
    const more = el.querySelector<HTMLButtonElement>('.more')!;
    more.addEventListener('click', () => {
      el.classList.toggle('open');
      more.textContent = el.classList.contains('open') ? 'Show less' : 'Show all';
    });
    return el;
  }));
}

// ---------- step 3: videos ----------
function renderVideoRows(recipes: CreatorRecipe[]): void {
  $('videos').replaceChildren(...recipes.map((r, i) => {
    const row = document.createElement('div');
    row.className = 'video-row';
    row.innerHTML = `<div><b></b><div class="file">Drop the video here or choose it</div></div><button class="btn">Choose…</button>`;
    row.querySelector('b')!.textContent = `${i + 1}. ${r.title.split(':')[0]}${r.id === 'hello' ? '' : ' (optional)'}`;
    const file = row.querySelector<HTMLDivElement>('.file')!;
    const set = (p: string) => {
      videos[r.id] = p;
      file.textContent = p.split('/').pop()!;
      file.classList.add('set');
      refresh();
    };
    row.querySelector('button')!.addEventListener('click', async () => {
      const p = await c.pick('video');
      if (p) set(p);
    });
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('over'); });
    row.addEventListener('dragleave', () => row.classList.remove('over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('over');
      const f = e.dataTransfer?.files[0];
      if (f) set(c.pathForFile(f));
    });
    return row;
  }));
}

c.onLog((line) => {
  // during photo prep (e.g. the one-time model download on Windows) show progress under the photo
  if (preparingPhoto) {
    $('photo-status').textContent = line;
    return;
  }
  // collapse "removing the background 40%" progress into one line
  const lines = log.textContent!.split('\n').filter(Boolean);
  const key = line.replace(/\d+%$/, '');
  if (lines.length && lines[lines.length - 1].replace(/\d+%$/, '') === key) lines.pop();
  lines.push(line);
  log.textContent = lines.join('\n') + '\n';
  log.scrollTop = log.scrollHeight;
});

buildBtn.addEventListener('click', async () => {
  building = true;
  refresh();
  buildBtn.textContent = 'Creating…';
  log.hidden = false;
  log.textContent = '';
  $('result').hidden = true;
  list($('build-warnings'), []);
  const r = await c.build({ name: nameInput.value.trim(), videos });
  building = false;
  buildBtn.textContent = 'Create again';
  refresh();
  if (!r.ok) {
    list($('build-warnings'), [r.error]);
    return;
  }
  list($('build-warnings'), r.warnings);
  $('clips').replaceChildren(...r.clips.map((clip) => {
    const fig = document.createElement('div');
    fig.className = 'clip';
    const v = Object.assign(document.createElement('video'), {
      src: `oru://app/char/${encodeURIComponent(r.id)}/${clip}.webm`, autoplay: true, loop: true, muted: true, playsInline: true,
    });
    fig.append(v, Object.assign(document.createElement('div'), { textContent: clip }));
    return fig;
  }));
  $('result').hidden = false;
  $<HTMLButtonElement>('use').onclick = () => {
    c.use(r.id);
    $<HTMLButtonElement>('use').textContent = 'In use ✓';
  };
});

c.info().then(({ supported, recipes }) => {
  renderRecipes(recipes);
  renderVideoRows(recipes);
  void supported; // every platform is supported now (Vision on macOS, portable keyer + U²-Net elsewhere)
  refresh();
});
