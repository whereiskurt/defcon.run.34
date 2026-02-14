// Theme toggle
function initTheme() {
  const stored = localStorage.getItem('theme');
  if (stored === 'light') {
    document.documentElement.classList.remove('dark');
  } else if (stored === 'dark') {
    document.documentElement.classList.add('dark');
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// Panel collapse/expand
function togglePanel(id) {
  const body = document.getElementById('body-' + id);
  const chevron = document.getElementById('chevron-' + id);
  if (!body) return;

  if (body.style.display === 'none') {
    body.style.display = '';
    chevron?.classList.add('open');
  } else {
    body.style.display = 'none';
    chevron?.classList.remove('open');
  }
}

// Module enable/disable checkbox
function toggleModule(id, checkbox) {
  const card = checkbox.closest('[data-panel]');
  if (!card) return;

  if (checkbox.checked) {
    card.classList.remove('panel-disabled');
  } else {
    card.classList.add('panel-disabled');
    const body = document.getElementById('body-' + id);
    const chevron = document.getElementById('chevron-' + id);
    if (body) body.style.display = 'none';
    if (chevron) chevron.classList.remove('open');
  }
}

// Preview panel (inline side-by-side)
function isPreviewOpen() {
  var panel = document.getElementById('preview-panel');
  return panel && !panel.classList.contains('hidden');
}

function showPreview() {
  const panel = document.getElementById('preview-panel');
  const grid = document.getElementById('form-grid');
  if (panel) {
    panel.classList.remove('hidden');
    panel.classList.add('flex');
  }
  if (grid) {
    grid.classList.remove('md:grid-cols-2');
    grid.classList.add('grid-cols-1');
    grid.querySelectorAll('.section-divider').forEach(function(el) {
      el.classList.remove('md:col-span-2');
    });
  }
}

function hidePreview() {
  const panel = document.getElementById('preview-panel');
  const grid = document.getElementById('form-grid');
  if (panel) {
    panel.classList.add('hidden');
    panel.classList.remove('flex');
  }
  if (grid) {
    grid.classList.add('md:grid-cols-2');
    grid.classList.remove('grid-cols-1');
    grid.querySelectorAll('.section-divider').forEach(function(el) {
      el.classList.add('md:col-span-2');
    });
  }
}

// Escape key closes preview
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    if (isPreviewOpen()) hidePreview();
  }
});

// --- Auto-refresh preview on form changes ---
var _previewDebounce = null;
function schedulePreviewRefresh() {
  if (!isPreviewOpen()) return;
  clearTimeout(_previewDebounce);
  _previewDebounce = setTimeout(function() {
    if (!isPreviewOpen()) return;
    htmx.ajax('POST', '/preview', {
      source: '#config-form',
      target: '#preview-content',
      swap: 'innerHTML'
    });
  }, 600);
}

var form = document.getElementById('config-form');
if (form) {
  form.addEventListener('input', schedulePreviewRefresh);
  form.addEventListener('change', schedulePreviewRefresh);
}

// =====================================================
// HCL Syntax Highlighting + Code Folding
// =====================================================
var _foldUid = 0;

function esc(text) {
  var d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// --- Syntax highlighting ---
// Tokenize a raw line into segments, then render with color spans.
function highlightLine(raw) {
  var html = '';
  var i = 0;

  while (i < raw.length) {
    // Whitespace — pass through
    if (raw[i] === ' ' || raw[i] === '\t') {
      html += raw[i];
      i++;
      continue;
    }

    // Comment: # to end of line
    if (raw[i] === '#') {
      html += '<span class="hl-cmt">' + esc(raw.substring(i)) + '</span>';
      break;
    }

    // String: "..."
    if (raw[i] === '"') {
      var j = i + 1;
      while (j < raw.length) {
        if (raw[j] === '\\') { j += 2; continue; }
        if (raw[j] === '"') break;
        j++;
      }
      var str = raw.substring(i, j + 1);
      // Highlight ${...} interpolations inside the string
      var strHtml = esc(str).replace(/\$\{([^}]*)\}/g, function(m) {
        return '</span><span class="hl-interp">' + esc(m) + '</span><span class="hl-str">';
      });
      html += '<span class="hl-str">' + strHtml + '</span>';
      i = j + 1;
      continue;
    }

    // Number (possibly with decimals)
    var numMatch = raw.substring(i).match(/^-?\d+\.?\d*/);
    if (numMatch && (i === 0 || ' \t=([,'.indexOf(raw[i - 1]) !== -1)) {
      html += '<span class="hl-num">' + numMatch[0] + '</span>';
      i += numMatch[0].length;
      continue;
    }

    // Word: identifier, keyword, boolean, function
    var wordMatch = raw.substring(i).match(/^[a-zA-Z_][a-zA-Z0-9_.]*/);
    if (wordMatch) {
      var word = wordMatch[0];
      if (word === 'true' || word === 'false' || word === 'null') {
        html += '<span class="hl-bool">' + word + '</span>';
      } else if (i + word.length < raw.length && raw[i + word.length] === '(') {
        html += '<span class="hl-func">' + esc(word) + '</span>';
      } else {
        html += '<span class="hl-key">' + esc(word) + '</span>';
      }
      i += word.length;
      continue;
    }

    // Operator: =
    if (raw[i] === '=') {
      html += '<span class="hl-op">=</span>';
      i++;
      continue;
    }

    // Brackets
    if ('{[()]}'.indexOf(raw[i]) !== -1) {
      html += '<span class="hl-brace">' + raw[i] + '</span>';
      i++;
      continue;
    }

    // Punctuation (commas, etc)
    html += esc(raw[i]);
    i++;
  }

  return html;
}

// --- Folding ---
function isFoldOpener(trimmed) {
  return (trimmed.endsWith('{') || trimmed.endsWith('[')) && trimmed.length > 1;
}

function closeCharFor(trimmed) {
  if (trimmed.endsWith('{')) return '}';
  if (trimmed.endsWith('[')) return ']';
  return null;
}

function findMatchingClose(lines, start, openChar, closeChar) {
  var depth = 1;
  var end = start + 1;
  while (end < lines.length && depth > 0) {
    var t = lines[end].trimEnd();
    for (var c = 0; c < t.length; c++) {
      if (t[c] === openChar) depth++;
      else if (t[c] === closeChar) depth--;
      if (depth === 0) break;
    }
    end++;
  }
  return end;
}

// Recursively process lines into folded + highlighted HTML
function processLines(lines, from, to) {
  var html = '';
  var i = from;

  while (i < to) {
    var line = lines[i];
    var trimmed = line.trimEnd();

    if (isFoldOpener(trimmed)) {
      var openChar = trimmed[trimmed.length - 1];
      var closeChar = closeCharFor(trimmed);
      var end = findMatchingClose(lines, i, openChar, closeChar);
      if (end > to) end = to; // safety
      var innerCount = end - i - 1;
      var id = 'fold-' + (_foldUid++);

      // Fold header line
      html += '<span class="fold-line" data-fold="' + id + '" data-count="' + innerCount + '">';
      html += '<span class="fold-icon" onclick="toggleFold(\'' + id + '\')">▾</span>';
      html += highlightLine(line);
      html += '</span>\n';

      // Inner content — recurse for nested folds
      html += '<span id="' + id + '" class="fold-content">';
      html += processLines(lines, i + 1, end);
      html += '</span>';
      i = end;
    } else {
      html += highlightLine(line) + '\n';
      i++;
    }
  }

  return html;
}

function addCodeFolding(pre) {
  var raw = pre.textContent;
  pre.dataset.raw = raw;

  var lines = raw.split('\n');
  pre.innerHTML = processLines(lines, 0, lines.length);
}

// --- Fold toggle ---
// Collapse a single fold (mark collapsed, set icon, add summary)
function collapseFold(foldId) {
  var content = document.getElementById(foldId);
  if (!content || content.classList.contains('fold-collapsed')) return;
  var line = document.querySelector('[data-fold="' + foldId + '"]');
  var icon = line ? line.querySelector('.fold-icon') : null;

  content.classList.add('fold-collapsed');
  if (icon) icon.textContent = '▸';
  var count = line ? line.dataset.count : '?';
  if (!document.getElementById(foldId + '-summary')) {
    var summary = document.createElement('span');
    summary.id = foldId + '-summary';
    summary.className = 'fold-summary';
    summary.textContent = ' ...' + count + ' lines';
    summary.onclick = function() { toggleFold(foldId); };
    content.insertAdjacentElement('afterend', summary);
  }
}

// Expand a single fold (remove collapsed, set icon, remove summary)
function expandFold(foldId) {
  var content = document.getElementById(foldId);
  if (!content || !content.classList.contains('fold-collapsed')) return;
  var line = document.querySelector('[data-fold="' + foldId + '"]');
  var icon = line ? line.querySelector('.fold-icon') : null;

  content.classList.remove('fold-collapsed');
  if (icon) icon.textContent = '▾';
  var summary = document.getElementById(foldId + '-summary');
  if (summary) summary.remove();
}

function toggleFold(id) {
  var content = document.getElementById(id);
  if (!content) return;

  if (content.classList.contains('fold-collapsed')) {
    // EXPAND this level only — children stay collapsed
    expandFold(id);
    // Collapse all child folds so only this level is revealed
    content.querySelectorAll('.fold-content').forEach(function(child) {
      collapseFold(child.id);
    });
  } else {
    // COLLAPSE recursively — collapse all descendants first, then this
    content.querySelectorAll('.fold-content').forEach(function(child) {
      // Remove child summaries since they'll be hidden inside collapsed parent
      var childSummary = document.getElementById(child.id + '-summary');
      if (childSummary) childSummary.remove();
      child.classList.add('fold-collapsed');
      var childLine = document.querySelector('[data-fold="' + child.id + '"]');
      if (childLine) {
        var childIcon = childLine.querySelector('.fold-icon');
        if (childIcon) childIcon.textContent = '▸';
      }
    });
    collapseFold(id);
  }
}

// Apply folding + highlighting after htmx swaps preview content
document.addEventListener('htmx:afterSwap', function(e) {
  if (e.detail.target && e.detail.target.id === 'preview-content') {
    e.detail.target.querySelectorAll('pre').forEach(addCodeFolding);
  }
});

// Copy uses raw text (bypasses fold/highlight HTML)
function copyPreviewTab(tab) {
  var pre = document.getElementById('pre-' + tab);
  if (!pre) return;
  var text = pre.dataset.raw || pre.textContent;
  navigator.clipboard.writeText(text).then(function() {
    var btn = pre.parentElement.querySelector('button');
    if (btn) {
      var o = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(function(){ btn.textContent = o; }, 1500);
    }
  });
}

// Bulk version set
function setAllVersions() {
  const version = document.getElementById('bulk-version').value;
  if (!version) return;

  document.querySelectorAll('input[name^="versions."]').forEach(input => {
    if (!input.disabled) {
      input.value = version;
    }
  });
}

// Save All from preview with confirmation dialog
function confirmSaveAll() {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[60] bg-black/50 flex items-center justify-center';
  overlay.innerHTML = `
    <div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-xl p-6 max-w-sm mx-4">
      <h3 class="text-base font-semibold mb-2">Save all files?</h3>
      <p class="text-sm text-zinc-500 dark:text-zinc-400 mb-4">This will overwrite site.hcl, env.sh, env.local.sh, service.hcl files, and VERSION files. A backup will be created first.</p>
      <div class="flex gap-2 justify-end">
        <button id="confirm-cancel" class="rounded-md bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 px-4 py-2 text-sm">Cancel</button>
        <button id="confirm-save" class="rounded-md bg-green-600 hover:bg-green-500 text-white px-4 py-2 text-sm font-medium">Save All</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#confirm-cancel').onclick = function() {
    overlay.remove();
  };
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('#confirm-save').onclick = function() {
    overlay.remove();
    hidePreview();
    htmx.ajax('POST', '/save', {source: '#config-form', target: '#save-result', swap: 'innerHTML'});
  };
}

// Initialize on load
initTheme();
