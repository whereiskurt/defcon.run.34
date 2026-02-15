// Reusable confirmation dialog (styled, replaces browser confirm())
// Returns nothing — calls onConfirm callback if user confirms.
// Options: { title, message, confirmLabel, confirmClass, onConfirm }
function showConfirmDialog(opts) {
  var overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[60] bg-black/50 flex items-center justify-center';
  var btnClass = opts.confirmClass || 'bg-green-600 hover:bg-green-500 text-white';
  overlay.innerHTML =
    '<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-xl p-6 max-w-sm mx-4">' +
      '<h3 class="text-base font-semibold mb-2">' + (opts.title || 'Are you sure?') + '</h3>' +
      '<p class="text-sm text-zinc-500 dark:text-zinc-400 mb-4">' + (opts.message || '') + '</p>' +
      '<div class="flex gap-2 justify-end">' +
        '<button class="rounded-md bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 px-4 py-2 text-sm" id="cfd-cancel">Cancel</button>' +
        '<button class="rounded-md ' + btnClass + ' px-4 py-2 text-sm font-medium" id="cfd-confirm">' + (opts.confirmLabel || 'Confirm') + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  function dismiss() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  overlay.querySelector('#cfd-cancel').onclick = dismiss;
  overlay.addEventListener('click', function(e) { if (e.target === overlay) dismiss(); });
  overlay.querySelector('#cfd-confirm').onclick = function() { dismiss(); if (opts.onConfirm) opts.onConfirm(); };
  function onKey(e) {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); dismiss(); }
  }
  document.addEventListener('keydown', onKey);
}

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

// Expand/collapse all panels
// Tri-state fold button helpers: + (all collapsed), − (all expanded), | (mixed)
function getFoldSymbol(openCount, totalCount) {
  if (openCount === 0) return '+';
  if (openCount === totalCount) return '\u2212';
  return '|';
}

function countAllPanelStates() {
  var panels = document.querySelectorAll('[data-panel]');
  var total = 0, open = 0;
  panels.forEach(function(p) {
    var body = document.getElementById('body-' + p.dataset.panel);
    if (body) { total++; if (body.style.display !== 'none') open++; }
  });
  return { open: open, total: total };
}

function updateGlobalFoldBtn() {
  var btn = document.getElementById('global-fold-btn');
  if (!btn) return;
  var s = countAllPanelStates();
  btn.textContent = getFoldSymbol(s.open, s.total);
}

function toggleAllPanels() {
  var s = countAllPanelStates();
  var expanding = s.open === 0; // mixed or all open → collapse; all collapsed → expand
  document.querySelectorAll('[data-panel]').forEach(function(panel) {
    var id = panel.dataset.panel;
    var body = document.getElementById('body-' + id);
    var chevron = document.getElementById('chevron-' + id);
    if (body) body.style.display = expanding ? '' : 'none';
    if (chevron) { if (expanding) chevron.classList.add('open'); else chevron.classList.remove('open'); }
  });
  updateAllFoldButtons();
}

function updateSectionFoldBtn(section) {
  var btn = document.getElementById('section-chevron-' + section);
  if (!btn) return;
  var ids = getSectionPanels(section);
  var total = 0, open = 0;
  ids.forEach(function(id) {
    var body = document.getElementById('body-' + id);
    if (body) { total++; if (body.style.display !== 'none') open++; }
  });
  btn.textContent = getFoldSymbol(open, total);
}

function updateAllFoldButtons() {
  updateGlobalFoldBtn();
  document.querySelectorAll('[data-section]').forEach(function(div) {
    updateSectionFoldBtn(div.dataset.section);
  });
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
  updateAllFoldButtons();
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
  var panel = document.getElementById('preview-panel');
  var handle = document.getElementById('preview-drag-handle');
  var grid = document.getElementById('form-grid');
  if (panel) {
    panel.classList.remove('hidden');
    panel.classList.add('flex');
  }
  if (handle) handle.classList.remove('hidden');
  if (grid) {
    grid.classList.remove('md:grid-cols-2');
    grid.classList.add('grid-cols-1');
    grid.querySelectorAll('.section-divider').forEach(function(el) {
      el.classList.remove('md:col-span-2');
    });
  }
}

function hidePreview() {
  var panel = document.getElementById('preview-panel');
  var handle = document.getElementById('preview-drag-handle');
  var grid = document.getElementById('form-grid');
  if (panel) {
    panel.classList.add('hidden');
    panel.classList.remove('flex');
  }
  if (handle) handle.classList.add('hidden');
  if (grid) {
    grid.classList.add('md:grid-cols-2');
    grid.classList.remove('grid-cols-1');
    grid.querySelectorAll('.section-divider').forEach(function(el) {
      el.classList.add('md:col-span-2');
    });
  }
}

// Draggable preview resize handle
(function() {
  var handle = document.getElementById('preview-drag-handle');
  var panel = document.getElementById('preview-panel');
  if (!handle || !panel) return;

  var dragging = false;

  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    dragging = true;
    handle.classList.add('dragging');
    document.body.classList.add('preview-dragging');
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var wrapperWidth = document.getElementById('content-wrapper').offsetWidth;
    var previewWidth = wrapperWidth - e.clientX;
    // Clamp between 200px and 80% of wrapper
    var minW = 200;
    var maxW = wrapperWidth * 0.8;
    previewWidth = Math.max(minW, Math.min(maxW, previewWidth));
    panel.style.width = previewWidth + 'px';
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.classList.remove('preview-dragging');
  });
})()

// Escape key closes preview (unless a modal dialog is open)
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    if (document.querySelector('.fixed.inset-0.z-\\[60\\]')) return;
    if (isPreviewOpen()) hidePreview();
  }
});

// --- Preview tab switching (global, no inline script) ---
var _previewDebounce = null;
var _activePreviewTab = null;
var _previewScroll = 0;

var TAB_ACTIVE = 'px-3 py-1.5 text-xs font-medium border-b-2 border-green-500 text-green-600 dark:text-green-400';
var TAB_INACTIVE = 'px-3 py-1.5 text-xs font-medium border-b-2 border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 cursor-pointer';

function switchPreviewTab(tab) {
  _activePreviewTab = tab;
  var pc = document.getElementById('preview-content');
  if (!pc) return;
  pc.querySelectorAll('[id^="ptab-content-"]').forEach(function(el) {
    el.classList.toggle('hidden', el.id !== 'ptab-content-' + tab);
  });
  pc.querySelectorAll('#ptab-bar button').forEach(function(btn) {
    btn.className = btn.id === 'ptab-' + tab ? TAB_ACTIVE : TAB_INACTIVE;
  });
}

function schedulePreviewRefresh() {
  if (!isPreviewOpen()) return;
  clearTimeout(_previewDebounce);
  _previewDebounce = setTimeout(function() {
    if (!isPreviewOpen()) return;
    var pc = document.getElementById('preview-content');
    if (pc) _previewScroll = pc.scrollTop;
    var f = document.getElementById('config-form');
    if (!f) return;
    fetch('/preview', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams(new FormData(f)).toString()
    }).then(function(resp) { return resp.text(); })
      .then(function(html) {
        var pc = document.getElementById('preview-content');
        if (!pc) return;
        pc.innerHTML = html;
        pc.querySelectorAll('pre').forEach(addCodeFolding);
        if (_activePreviewTab) {
          switchPreviewTab(_activePreviewTab);
        }
        pc.scrollTop = _previewScroll;
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

// Expand all folds in a given tab's <pre> element
function expandAllFolds(tabId) {
  var pre = document.getElementById('pre-' + tabId);
  if (!pre) return;
  pre.querySelectorAll('.fold-content.fold-collapsed').forEach(function(el) {
    expandFold(el.id);
  });
}

// Apply folding + highlighting after htmx swaps preview content, then restore tab/scroll
document.addEventListener('htmx:afterSwap', function(e) {
  if (e.detail.target && e.detail.target.id === 'preview-content') {
    e.detail.target.querySelectorAll('pre').forEach(addCodeFolding);
    if (_activePreviewTab) {
      switchPreviewTab(_activePreviewTab);
    }
    var pc = document.getElementById('preview-content');
    if (pc) pc.scrollTop = _previewScroll;
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
  function onEsc(e) { if (e.key === 'Escape') { e.stopImmediatePropagation(); overlay.remove(); document.removeEventListener('keydown', onEsc); } }
  document.addEventListener('keydown', onEsc);
  overlay.querySelector('#confirm-save').onclick = function() {
    overlay.remove();
    hidePreview();
    htmx.ajax('POST', '/save', {source: '#config-form', target: '#save-result', swap: 'innerHTML'});
  };
}

// PII blur: re-blur individually revealed elements when clicking outside them
// Skip when global unblur is active — those should stay revealed until user clicks "Blur All"
document.addEventListener('click', function(e) {
  if (_globalUnblurred) return;
  document.querySelectorAll('.pii-blur.pii-revealed').forEach(function(el) {
    if (!el.contains(e.target) && e.target !== el) {
      el.classList.remove('pii-revealed');
    }
  });
});

// Global blur toggle — directly targets non-sensitive elements only
var _globalUnblurred = false;
function toggleGlobalBlur() {
  var btn = document.getElementById('blur-toggle-btn');
  if (_globalUnblurred) {
    // Re-blur: remove pii-revealed from ALL elements (including individually revealed sensitive ones)
    document.querySelectorAll('.pii-blur.pii-revealed').forEach(function(el) {
      el.classList.remove('pii-revealed');
    });
    _globalUnblurred = false;
    if (btn) btn.innerHTML = 'Unblur <span class="pii-blur" style="display:inline;cursor:pointer;">All</span>';
  } else {
    // Unblur: confirm first
    confirmUnblur();
  }
}

function doGlobalUnblur() {
  // Only reveal non-sensitive elements — pii-sensitive elements are NEVER touched
  document.querySelectorAll('.pii-blur:not(.pii-sensitive)').forEach(function(el) {
    el.classList.add('pii-revealed');
  });
  _globalUnblurred = true;
  var btn = document.getElementById('blur-toggle-btn');
  if (btn) btn.innerHTML = 'Blur All';
}

function confirmUnblur() {
  var overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[60] bg-black/50 flex items-center justify-center';
  overlay.innerHTML =
    '<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-xl p-6 max-w-md mx-4">' +
      '<h3 class="text-base font-semibold mb-3">Reveal Blurred Items</h3>' +
      '<p class="text-sm text-zinc-400 mb-4">You\'re about to reveal on-screen items which have been blurred out. Do you want to continue?</p>' +
      '<div class="flex justify-end gap-2">' +
        '<button class="rounded-md bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 px-4 py-2 text-sm" id="unblur-no-btn">No</button>' +
        '<button class="rounded-md bg-green-700 hover:bg-green-600 text-white px-4 py-2 text-sm font-medium" id="unblur-yes-btn">Yes</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.getElementById('unblur-no-btn').addEventListener('click', function() { overlay.remove(); });
  document.getElementById('unblur-yes-btn').addEventListener('click', function() {
    overlay.remove();
    doGlobalUnblur();
  });
  var onKey = function(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); e.stopImmediatePropagation(); }
    if (e.key === 'Enter') { overlay.remove(); document.removeEventListener('keydown', onKey); e.stopImmediatePropagation(); doGlobalUnblur(); }
  };
  document.addEventListener('keydown', onKey);
}

// Reload confirmation dialog
function confirmReload() {
  showConfirmDialog({
    title: 'Reload configuration?',
    message: 'This will reload from disk and overwrite any changes you have currently made.',
    confirmLabel: 'Reload',
    onConfirm: function() {
      fetch('/api/reload', { method: 'POST' }).then(function() { window.location.reload(); });
    }
  });
}

// Re-query AWS confirmation dialog
function confirmRequery() {
  showConfirmDialog({
    title: 'Re-query AWS?',
    message: 'This will query all AWS resources across all regions. This may take a few seconds.',
    confirmLabel: 'Re-query',
    onConfirm: function() {
      var btn = document.getElementById('requery-aws-btn');
      if (btn) btn.classList.add('spinning');
      fetch('/api/discovery/refresh', { method: 'POST' }).then(function() {
        htmx.trigger(document.body, 'refreshDiscovery');
      });
    }
  });
}

// Fix Locks confirmation dialog
function confirmFixLocks() {
  // Step 1: scan for locks first
  var scanOverlay = document.createElement('div');
  scanOverlay.className = 'fixed inset-0 z-[60] bg-black/60 flex items-center justify-center';
  scanOverlay.innerHTML =
    '<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-xl p-8 max-w-md mx-4 text-center">' +
      '<div class="discovery-dot loading mx-auto mb-4" style="width:24px;height:24px;border-width:3px;"></div>' +
      '<p class="text-sm font-mono text-zinc-400">Scanning DynamoDB tables for locks...</p>' +
    '</div>';
  document.body.appendChild(scanOverlay);

  fetch('/api/scan-locks', { method: 'POST' })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      scanOverlay.remove();
      var found = (data.found && data.found.length) || 0;
      var errors = data.errors || [];

      if (found === 0 && errors.length === 0) {
        // No locks — show clean result
        showFixLocksResult({ found: [], removed: [], errors: [] });
        return;
      }

      if (found === 0 && errors.length > 0) {
        showFixLocksResult(data);
        return;
      }

      // Step 2: show what was found, ask to remove
      var lockRows = '';
      data.found.forEach(function(l) {
        lockRows += '<tr class="border-t border-zinc-700">' +
          '<td class="py-1 pr-3 text-zinc-400">' + l.region + '</td>' +
          '<td class="py-1 font-mono text-xs text-zinc-300 break-all">' + l.lock_id + '</td>' +
        '</tr>';
      });

      var overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 z-[60] bg-black/60 flex items-center justify-center';
      overlay.innerHTML =
        '<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-xl p-6 max-w-lg mx-4">' +
          '<div class="flex items-center gap-3 mb-3">' +
            '<span class="text-amber-400 text-3xl">&#9888;</span>' +
            '<h3 class="text-base font-semibold">Found ' + found + ' stuck lock' + (found > 1 ? 's' : '') + '</h3>' +
          '</div>' +
          '<table class="w-full text-xs mb-4">' + lockRows + '</table>' +
          '<p class="text-sm text-zinc-400 mb-4">Remove ' + (found > 1 ? 'these locks' : 'this lock') + ' from DynamoDB?</p>' +
          '<div class="flex justify-end gap-2">' +
            '<button class="rounded-md bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 px-4 py-2 text-sm" id="fixlocks-cancel">Cancel</button>' +
            '<button class="rounded-md bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 text-sm font-medium" id="fixlocks-remove">Remove Locks</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      function dismiss() { overlay.remove(); document.removeEventListener('keydown', onKey); }
      overlay.querySelector('#fixlocks-cancel').onclick = dismiss;
      overlay.addEventListener('click', function(e) { if (e.target === overlay) dismiss(); });
      function onKey(e) { if (e.key === 'Escape') { e.stopImmediatePropagation(); dismiss(); } }
      document.addEventListener('keydown', onKey);

      overlay.querySelector('#fixlocks-remove').onclick = function() {
        dismiss();
        // Step 3: actually remove
        var removeOverlay = document.createElement('div');
        removeOverlay.className = 'fixed inset-0 z-[60] bg-black/60 flex items-center justify-center';
        removeOverlay.innerHTML =
          '<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-xl p-8 max-w-md mx-4 text-center">' +
            '<div class="discovery-dot loading mx-auto mb-4" style="width:24px;height:24px;border-width:3px;"></div>' +
            '<p class="text-sm font-mono text-zinc-400">Removing locks...</p>' +
          '</div>';
        document.body.appendChild(removeOverlay);

        fetch('/api/fix-locks', { method: 'POST' })
          .then(function(resp) { return resp.json(); })
          .then(function(result) {
            removeOverlay.remove();
            showFixLocksResult(result);
          })
          .catch(function(err) {
            removeOverlay.remove();
            showFixLocksResult({ found: [], removed: [], errors: ['Request failed: ' + err.message] });
          });
      };
    })
    .catch(function(err) {
      scanOverlay.remove();
      showFixLocksResult({ found: [], removed: [], errors: ['Scan failed: ' + err.message] });
    });
}

function showFixLocksResult(data) {
  var found = (data.found && data.found.length) || 0;
  var removed = (data.removed && data.removed.length) || 0;
  var errors = data.errors || [];

  var icon, title, detail;
  if (found === 0 && errors.length === 0) {
    icon = '<span class="text-green-400 text-3xl">&#10003;</span>';
    title = 'No stuck locks found';
    detail = '<p class="text-sm text-zinc-400">All DynamoDB state tables are clean.</p>';
  } else if (removed > 0) {
    icon = '<span class="text-amber-400 text-3xl">&#9888;</span>';
    title = 'Removed ' + removed + ' lock' + (removed > 1 ? 's' : '');
    var rows = '';
    data.removed.forEach(function(l) {
      rows += '<tr class="border-t border-zinc-700">' +
        '<td class="py-1 pr-3 text-zinc-400">' + l.region + '</td>' +
        '<td class="py-1 font-mono text-xs text-zinc-300 break-all">' + l.lock_id + '</td>' +
      '</tr>';
    });
    detail = '<table class="w-full text-xs mt-2">' + rows + '</table>';
  } else {
    icon = '<span class="text-red-400 text-3xl">&#10007;</span>';
    title = 'Lock fix failed';
    detail = '';
  }

  if (errors.length > 0) {
    detail += '<div class="mt-3 text-xs text-red-400">';
    errors.forEach(function(e) { detail += '<p>' + e + '</p>'; });
    detail += '</div>';
  }

  var overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[60] bg-black/60 flex items-center justify-center';
  overlay.innerHTML =
    '<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-xl p-6 max-w-lg mx-4">' +
      '<div class="flex items-center gap-3 mb-3">' +
        icon +
        '<h3 class="text-base font-semibold">' + title + '</h3>' +
      '</div>' +
      detail +
      '<div class="flex justify-end mt-4">' +
        '<button class="rounded-md bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 px-4 py-2 text-sm" id="fixlocks-close">Close</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  function dismiss() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  overlay.querySelector('#fixlocks-close').onclick = dismiss;
  overlay.addEventListener('click', function(e) { if (e.target === overlay) dismiss(); });
  function onKey(e) { if (e.key === 'Escape') { e.stopImmediatePropagation(); dismiss(); } }
  document.addEventListener('keydown', onKey);
}

// Apply All confirmation dialog
function confirmApplyAll() {
  showConfirmDialog({
    title: 'Are you sure you want to update your state?',
    message: 'This will run terragrunt apply --all across every infrastructure module.',
    confirmLabel: 'Apply All',
    confirmClass: 'bg-red-600 hover:bg-red-500 text-white',
    onConfirm: function() {
      openTerminal('all', 'apply-all', '');
    }
  });
}

// Export confirmation dialog
function confirmExport() {
  var overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[60] bg-black/50 flex items-center justify-center';
  overlay.innerHTML =
    '<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-xl p-6 max-w-md mx-4">' +
      '<h3 class="text-base font-semibold mb-3">Export Configuration</h3>' +
      '<p class="text-sm text-zinc-400 mb-4">This will download <span class="font-mono text-zinc-300">site-config.json</span> containing the current form values as a JSON snapshot. Secret values (SOPS-encrypted) are <strong>not</strong> included.</p>' +
      '<div class="flex justify-end gap-2">' +
        '<button class="rounded-md bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 px-4 py-2 text-sm" onclick="this.closest(\'.fixed\').remove()">Cancel</button>' +
        '<button class="rounded-md bg-green-700 hover:bg-green-600 text-white px-4 py-2 text-sm font-medium" id="export-confirm-btn">Export</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.getElementById('export-confirm-btn').addEventListener('click', function() {
    overlay.remove();
    window.location.href = '/export';
  });
  var onEsc = function(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); e.stopImmediatePropagation(); }
  };
  document.addEventListener('keydown', onEsc);
}

// Toast notifications
function showToast(message, duration) {
  duration = duration || 4000;
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'rounded-md bg-green-900/90 border border-green-700 text-green-300 px-4 py-2 text-sm font-mono shadow-lg transition-opacity duration-300';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    setTimeout(function() { toast.remove(); }, 300);
  }, duration);
}

// Section-level expand/collapse — operates on panels within a data-section group
function getSectionPanels(section) {
  var grid = document.getElementById('form-grid');
  if (!grid) return [];
  var divider = grid.querySelector('[data-section="' + section + '"]');
  if (!divider) return [];

  var panels = [];
  var sibling = divider.nextElementSibling;
  while (sibling && !sibling.hasAttribute('data-section')) {
    if (sibling.hasAttribute('data-panel')) {
      panels.push(sibling.getAttribute('data-panel'));
    }
    sibling = sibling.nextElementSibling;
  }
  return panels;
}

function isSectionExpanded(section) {
  var ids = getSectionPanels(section);
  for (var i = 0; i < ids.length; i++) {
    var body = document.getElementById('body-' + ids[i]);
    if (body && body.style.display !== 'none') return true;
  }
  return false;
}

function toggleSection(section) {
  var ids = getSectionPanels(section);
  var expanding = !isSectionExpanded(section);
  ids.forEach(function(id) {
    var body = document.getElementById('body-' + id);
    var ch = document.getElementById('chevron-' + id);
    if (body) body.style.display = expanding ? '' : 'none';
    if (ch) { if (expanding) ch.classList.add('open'); else ch.classList.remove('open'); }
  });
  updateAllFoldButtons();
}

// Collect module panels (with toggle-switch checkboxes) in a section
function getSectionModules(section) {
  var grid = document.getElementById('form-grid');
  if (!grid) return [];
  var startDiv = grid.querySelector('[data-section="' + section + '"]');
  if (!startDiv) return [];

  var panels = [];
  var sibling = startDiv.nextElementSibling;
  while (sibling && !sibling.hasAttribute('data-section')) {
    if (sibling.hasAttribute('data-panel')) {
      var cb = sibling.querySelector('.toggle-switch');
      if (cb) panels.push({ card: sibling, checkbox: cb, id: sibling.getAttribute('data-panel') });
    }
    sibling = sibling.nextElementSibling;
  }
  return panels;
}

// Toggle all modules in a section via the tri-state slider
function toggleAllModules(section, slider) {
  var panels = getSectionModules(section);
  var enabledCount = panels.filter(function(p) { return p.checkbox.checked; }).length;
  // If any are enabled, disable all; otherwise enable all
  var enabling = enabledCount === 0;

  panels.forEach(function(p) {
    if (enabling) {
      p.checkbox.checked = true;
      p.card.classList.remove('panel-disabled');
    } else {
      p.checkbox.checked = false;
      p.card.classList.add('panel-disabled');
      var body = document.getElementById('body-' + p.id);
      var chevron = document.getElementById('chevron-' + p.id);
      if (body) body.style.display = 'none';
      if (chevron) chevron.classList.remove('open');
    }
  });

  updateSectionToggle(section);
}

// Sync the section toggle slider to reflect actual module states
function updateSectionToggle(section) {
  var slider = document.getElementById('section-toggle-' + section);
  if (!slider) return;

  var panels = getSectionModules(section);
  if (panels.length === 0) return;

  var enabledCount = panels.filter(function(p) { return p.checkbox.checked; }).length;

  var label = document.getElementById('section-toggle-label-' + section);
  if (enabledCount === panels.length) {
    slider.checked = true;
    slider.classList.remove('partial');
    if (label) label.textContent = 'all';
  } else if (enabledCount === 0) {
    slider.checked = false;
    slider.classList.remove('partial');
    if (label) label.textContent = 'none';
  } else {
    slider.checked = false;
    slider.classList.add('partial');
    if (label) label.textContent = enabledCount + '/' + panels.length;
  }
}

// Listen for individual module toggle changes to update section slider
document.addEventListener('change', function(e) {
  if (e.target.classList.contains('toggle-switch')) {
    // Find which section this panel belongs to
    var panel = e.target.closest('[data-panel]');
    if (!panel) return;
    var grid = document.getElementById('form-grid');
    if (!grid) return;
    var dividers = grid.querySelectorAll('[data-section]');
    for (var i = dividers.length - 1; i >= 0; i--) {
      // Check if this panel comes after this divider
      if (dividers[i].compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING) {
        updateSectionToggle(dividers[i].dataset.section);
        break;
      }
    }
  }
});

// Discovery — per-region status dots on panel headers

// Panels that have AWS resource discovery checks
var DISCOVERABLE_PANELS = {
  github_oidc: true, ecs_clusters: true, ecs_services: true, ecs_tasks: true,
  dynamodb: true, ecr: true, cloudfront: true, ec2spots: true,
  email: true, secrets: true, s3_uploads: true, waf: true,
  cloudtrail: true, upload_proc: true
};

// Used by htmx conditional polling: returns true while discovery is running
function discoveryRunning() {
  var data = document.getElementById('discovery-data');
  return data && data.dataset.status === 'running';
}

function updateDiscoveryDots() {
  var container = document.getElementById('discovery-container');
  if (!container) return;
  var data = document.getElementById('discovery-data');
  if (!data) return;

  var status = data.dataset.status;
  var spans = container.querySelectorAll('[data-panel][data-region]');

  // Group by panel
  var panels = {};
  spans.forEach(function(span) {
    var panel = span.dataset.panel;
    if (!panels[panel]) panels[panel] = [];
    panels[panel].push({
      region: span.dataset.region,
      resource: span.dataset.resource,
      exists: span.dataset.exists === 'true',
      error: span.dataset.error,
      detail: span.dataset.detail
    });
  });

  // For each discoverable panel, find or create dots container in header
  document.querySelectorAll('[data-panel]').forEach(function(panelEl) {
    var panelId = panelEl.dataset.panel;
    if (!DISCOVERABLE_PANELS[panelId]) return;

    var header = panelEl.querySelector('.flex.justify-between');
    if (!header) return;

    // Find or create dots container
    var dotsContainer = header.querySelector('.discovery-dots');
    if (!dotsContainer) {
      dotsContainer = document.createElement('div');
      dotsContainer.className = 'discovery-dots flex items-center gap-1.5 ml-auto mr-2';
      // Insert before the chevron svg
      var chevron = header.querySelector('.chevron');
      if (chevron) {
        chevron.parentElement.insertBefore(dotsContainer, chevron);
      } else {
        header.appendChild(dotsContainer);
      }
    }

    var entries = panels[panelId];
    if (status === 'running' && !entries) {
      // Show loading spinner only on discoverable panels
      dotsContainer.innerHTML = '<span class="discovery-dot loading" title="Scanning..."></span>';
      return;
    }

    if (!entries || entries.length === 0) {
      dotsContainer.innerHTML = '';
      return;
    }

    // Deduplicate by region (keep best status per region)
    var byRegion = {};
    entries.forEach(function(e) {
      var key = e.region;
      if (!byRegion[key]) {
        byRegion[key] = { exists: false, errors: [], details: [], resources: [] };
      }
      byRegion[key].resources.push(e.resource);
      if (e.exists) byRegion[key].exists = true;
      if (e.error) byRegion[key].errors.push(e.resource + ': ' + e.error);
      if (e.detail) byRegion[key].details.push(e.resource + ': ' + e.detail);
    });

    // Count resources per region for summary
    var html = '';
    var regionOrder = ['use1', 'cac1', 'apse1', 'global'];
    var sortedRegions = Object.keys(byRegion).sort(function(a, b) {
      var ai = regionOrder.indexOf(a); if (ai < 0) ai = 99;
      var bi = regionOrder.indexOf(b); if (bi < 0) bi = 99;
      return ai - bi;
    });

    sortedRegions.forEach(function(region) {
      var info = byRegion[region];
      // Count found vs total
      var total = info.resources.length;
      var foundCount = 0;
      entries.forEach(function(e) { if (e.region === region && e.exists) foundCount++; });
      var allFound = foundCount === total;
      var noneFound = foundCount === 0;

      var cls = 'discovery-dot';
      if (allFound) cls += ' found';
      else if (noneFound) cls += ' missing';
      else cls += ' partial';

      var tooltip = region;
      if (info.details.length > 0) tooltip += '\n' + info.details.join('\n');
      if (info.errors.length > 0) tooltip += '\n' + info.errors.join('\n');
      if (total > 1) tooltip += '\n(' + foundCount + '/' + total + ' found)';

      html += '<div class="flex items-center gap-0.5" title="' + tooltip.replace(/"/g, '&quot;') + '">';
      html += '<span class="' + cls + '"></span>';
      html += '<span class="text-[10px] text-zinc-500">' + region + '</span>';
      html += '</div>';
    });

    dotsContainer.innerHTML = html;
  });
}

// Listen for htmx swaps on discovery container
document.addEventListener('htmx:afterSwap', function(e) {
  if (e.detail.target && e.detail.target.id === 'discovery-container') {
    updateDiscoveryDots();
    // Stop spinning refresh buttons when discovery is done
    if (!discoveryRunning()) {
      document.querySelectorAll('.term-btn-refresh.spinning').forEach(function(btn) {
        btn.classList.remove('spinning');
      });
      var rqBtn = document.getElementById('requery-aws-btn');
      if (rqBtn) rqBtn.classList.remove('spinning');
    }
  }
});

// Header live labels — sync form inputs to header text
function initHeaderSync() {
  var labelInput = document.querySelector('input[name="site.label"]');
  var zoneInput = document.querySelector('input[name="dns.zonename"]');
  if (labelInput) {
    labelInput.addEventListener('input', function() {
      var el = document.getElementById('header-site-label');
      if (el) el.textContent = this.value || 'dc34';
    });
  }
  if (zoneInput) {
    zoneInput.addEventListener('input', function() {
      var el = document.getElementById('header-zone-name');
      if (el) el.textContent = this.value || 'defcon.run';
    });
  }
}

// =====================================================
// Field Sync — linked fields across panels with lock icons
// =====================================================

// Sync groups: arrays of field names that should stay in sync.
// When any field in a group changes, all others update to match.
var SYNC_GROUPS = [
  { fields: ['site.label', 'env.site_label'], label: 'Site Label' },
  { fields: ['dns.zonename', 'env.site_domain'], label: 'Domain' }
];

// Panel name lookup for human-readable "synced with X" tooltip
var FIELD_PANEL_NAMES = {
  'site.label': 'Site Identity',
  'env.site_label': 'Environment',
  'dns.zonename': 'DNS Config',
  'env.site_domain': 'Environment'
};

var _syncLock = false; // prevent infinite loops

function initFieldSync() {
  var form = document.getElementById('config-form');
  if (!form) return;

  SYNC_GROUPS.forEach(function(group) {
    var inputs = [];
    group.fields.forEach(function(name) {
      var input = form.querySelector('[name="' + name + '"]');
      if (input) inputs.push({ name: name, el: input });
    });

    if (inputs.length < 2) return;

    // Inject lock icon next to each field's label
    inputs.forEach(function(inp) {
      var label = inp.el.parentElement.querySelector('label');
      if (!label || label.querySelector('.sync-lock')) return;

      // Build "synced with" tooltip listing the other panels
      var otherPanels = [];
      inputs.forEach(function(other) {
        if (other.name !== inp.name) {
          otherPanels.push(FIELD_PANEL_NAMES[other.name] || other.name);
        }
      });

      var lock = document.createElement('span');
      lock.className = 'sync-lock';
      lock.title = 'Synced with ' + otherPanels.join(', ');
      lock.innerHTML =
        '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
          '<path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>' +
        '</svg>' +
        '<span class="sync-label">' + otherPanels.join(', ') + '</span>';
      label.appendChild(lock);
    });

    // Wire up bidirectional sync
    inputs.forEach(function(source) {
      source.el.addEventListener('input', function() {
        if (_syncLock) return;
        _syncLock = true;
        var val = source.el.value;
        inputs.forEach(function(target) {
          if (target.name !== source.name) {
            target.el.value = val;
            // Trigger input event so other listeners (header sync, preview refresh, defaults) fire
            target.el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        _syncLock = false;
      });
    });
  });
}

// Default value indicators — dim fields that still hold default values
function markDefaults() {
  var defaults = window.FORM_DEFAULTS;
  if (!defaults) return;

  var form = document.getElementById('config-form');
  if (!form) return;

  Object.keys(defaults).forEach(function(name) {
    var input = form.querySelector('[name="' + name + '"]');
    if (!input) return;

    var defVal = defaults[name];

    function update() {
      var badge = input.parentElement.querySelector('.default-badge');
      if (input.value === defVal) {
        input.classList.add('is-default');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'default-badge';
          badge.textContent = 'default';
          // Insert badge after the label, before the input
          var label = input.parentElement.querySelector('label');
          if (label) {
            label.appendChild(badge);
          }
        }
      } else {
        input.classList.remove('is-default');
        if (badge) badge.remove();
      }
    }

    update();
    input.addEventListener('input', update);
    input.addEventListener('change', update);
  });
}

// =====================================================
// Terminal — Concurrent Terragrunt execution with minimize/restore
// =====================================================

// Module definitions: which panels are global vs regional
var TERMINAL_MODULES = {
  github_oidc: { global: true },
  cloudtrail:  { global: true },
  cloudfront:  { global: true },
  waf:         { global: true },
  ecs_clusters: { global: false },
  ecs_services: { global: false },
  ecs_tasks:    { global: false },
  dynamodb:     { global: false },
  ecr:          { global: false },
  ec2spots:     { global: false },
  email:        { global: false },
  secrets:      { global: false },
  s3_uploads:   { global: false },
  upload_proc:  { global: false }
};

// Multi-session tracking: id → { es, overlay, minimized, processRunning, label, exitCode }
var _termSessions = {};

// Check if AWS is authenticated by looking at the aws-status container
function isAWSAuthed() {
  var el = document.getElementById('aws-status');
  if (!el) return false;
  return el.querySelector('.status-dot.ok') !== null;
}

// Inject Plan/Apply buttons into discoverable panel headers
function injectTerminalButtons() {
  Object.keys(TERMINAL_MODULES).forEach(function(panelId) {
    var panelEl = document.querySelector('[data-panel="' + panelId + '"]');
    if (!panelEl) return;
    var header = panelEl.querySelector('.flex.justify-between');
    if (!header) return;

    // Skip if already injected
    if (header.querySelector('.term-actions')) return;

    var mod = TERMINAL_MODULES[panelId];
    var container = document.createElement('div');
    container.className = 'term-actions flex items-center gap-1 ml-2';

    if (!mod.global) {
      // Region selector for regional modules
      var sel = document.createElement('select');
      sel.className = 'term-region-select text-[10px] bg-zinc-800 border border-zinc-600 text-zinc-300 rounded px-1 py-0 font-mono';
      sel.style.height = '18px';
      sel.dataset.panel = panelId;
      (window.ALL_REGIONS || []).forEach(function(r) {
        var opt = document.createElement('option');
        opt.value = r.full;
        opt.textContent = r.label;
        sel.appendChild(opt);
      });
      container.appendChild(sel);
    }

    var planBtn = document.createElement('button');
    planBtn.type = 'button';
    planBtn.className = 'term-btn term-btn-plan';
    planBtn.textContent = 'Plan';
    planBtn.onclick = function(e) {
      e.stopPropagation();
      var region = '';
      if (!mod.global) {
        var regionSel = container.querySelector('.term-region-select');
        region = regionSel ? regionSel.value : '';
      }
      openTerminal(panelId, 'plan', region);
    };

    var applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'term-btn term-btn-apply';
    applyBtn.textContent = 'Apply';
    applyBtn.onclick = function(e) {
      e.stopPropagation();
      var region = '';
      if (!mod.global) {
        var regionSel = container.querySelector('.term-region-select');
        region = regionSel ? regionSel.value : '';
      }
      var label = panelId.replace(/_/g, '-');
      if (region) label += ' (' + region + ')';
      showConfirmDialog({
        title: 'Apply ' + label + '?',
        message: 'This will run <span class="font-mono text-zinc-300">terragrunt apply</span> on <strong>' + label + '</strong>. Resources may be created, modified, or destroyed.',
        confirmLabel: 'Apply',
        confirmClass: 'bg-red-600 hover:bg-red-500 text-white',
        onConfirm: function() { openTerminal(panelId, 'apply', region); }
      });
    };

    var refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'term-btn term-btn-refresh';
    refreshBtn.title = 'Re-query AWS resources';
    refreshBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M4.93 9A10 10 0 0119.07 9M19.07 15A10 10 0 014.93 15"/></svg>';
    refreshBtn.onclick = function(e) {
      e.stopPropagation();
      refreshBtn.classList.add('spinning');
      fetch('/api/discovery/refresh?module=' + encodeURIComponent(panelId), { method: 'POST' }).then(function() {
        htmx.trigger(document.body, 'refreshDiscovery');
      });
    };

    container.appendChild(planBtn);
    container.appendChild(applyBtn);
    container.appendChild(refreshBtn);

    // Insert before discovery dots or chevron
    var dots = header.querySelector('.discovery-dots');
    var chevron = header.querySelector('.chevron');
    if (dots) {
      dots.parentElement.insertBefore(container, dots);
    } else if (chevron) {
      chevron.parentElement.insertBefore(container, chevron);
    } else {
      header.appendChild(container);
    }
  });
}

// Show/hide terminal buttons based on AWS auth status
function updateTerminalButtonsVisibility() {
  var authed = isAWSAuthed();
  document.querySelectorAll('.term-actions').forEach(function(el) {
    el.style.display = authed ? '' : 'none';
  });
}

// --- Pill bar management ---

function ensurePillBar() {
  var bar = document.getElementById('term-pill-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'term-pill-bar';
    document.body.appendChild(bar);
  }
  return bar;
}

function updatePillBar() {
  var bar = document.getElementById('term-pill-bar');
  if (!bar) return;
  var ids = Object.keys(_termSessions);
  if (ids.length === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = '';
  bar.innerHTML = '';
  ids.forEach(function(id) {
    var s = _termSessions[id];
    var pill = document.createElement('div');
    pill.className = 'term-pill';
    pill.dataset.sessionId = id;

    var icon, statusText;
    if (s.processRunning) {
      pill.classList.add('running');
      icon = '<span class="term-pill-dot running"></span>';
      statusText = 'running';
    } else if (s.exitCode === 0) {
      pill.classList.add('done');
      icon = '<span class="term-pill-icon done">&#10003;</span>';
      statusText = '0';
    } else {
      pill.classList.add('error');
      icon = '<span class="term-pill-icon error">&#10007;</span>';
      statusText = '' + (s.exitCode != null ? s.exitCode : '?');
    }

    pill.innerHTML = icon +
      '<span class="term-pill-label">' + s.label + ': ' + statusText + '</span>' +
      '<span class="term-pill-close" title="Dismiss">&times;</span>';

    // Click pill → restore session
    pill.addEventListener('click', function(e) {
      if (e.target.classList.contains('term-pill-close')) return;
      restoreSession(id);
    });

    // Click × → dismiss session
    pill.querySelector('.term-pill-close').addEventListener('click', function(e) {
      e.stopPropagation();
      dismissSession(id);
    });

    bar.appendChild(pill);
  });
}

function minimizeSession(id) {
  var s = _termSessions[id];
  if (!s) return;
  s.minimized = true;
  if (s.overlay) s.overlay.style.display = 'none';
  updatePillBar();
}

function restoreSession(id) {
  var s = _termSessions[id];
  if (!s) return;
  s.minimized = false;
  if (s.overlay) {
    s.overlay.style.display = '';
    // Scroll output to bottom
    var output = s.overlay.querySelector('.terminal-output');
    if (output) output.scrollTop = output.scrollHeight;
  }
  updatePillBar();
}

function dismissSession(id) {
  var s = _termSessions[id];
  if (!s) return;

  if (s.processRunning) {
    showConfirmDialog({
      title: 'Process still running',
      message: 'Stop the process and dismiss this session?',
      confirmLabel: 'Stop & Dismiss',
      confirmClass: 'bg-red-600 hover:bg-red-500 text-white',
      onConfirm: function() {
        var body = new URLSearchParams();
        body.append('id', id);
        fetch('/api/terminal/stop', { method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: body.toString() });
        doCleanupSession(id);
      }
    });
    return;
  }
  doCleanupSession(id);
}

function doCleanupSession(id) {
  var s = _termSessions[id];
  if (!s) return;
  if (s.es) { s.es.close(); s.es = null; }
  if (s.overlay) s.overlay.remove();
  if (s.onEsc) document.removeEventListener('keydown', s.onEsc);
  delete _termSessions[id];
  updatePillBar();
  htmx.trigger(document.body, 'refreshDiscovery');
}

// --- Terminal open / modal ---

function openTerminal(module, command, region) {
  var body = new URLSearchParams();
  body.append('module', module);
  body.append('command', command);
  if (region) body.append('region', region);

  fetch('/api/terminal/start', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: body.toString()
  }).then(function(resp) {
    return resp.json().then(function(data) {
      if (!resp.ok) {
        showToast(data.error || 'Failed to start terminal', 5000);
        return;
      }
      showTerminalModal(data);
    });
  }).catch(function(err) {
    showToast('Terminal error: ' + err.message, 5000);
  });
}

function showTerminalModal(session) {
  var id = session.id;
  var label = session.module.replace(/_/g, '-');
  if (session.region) label += ' (' + session.region + ')';

  var cmdLine = session.cmd_line || ('terragrunt ' + session.command);

  var overlay = document.createElement('div');
  overlay.className = 'terminal-modal fixed inset-0 z-[60] bg-black/70 flex flex-col p-4 md:p-8';
  overlay.dataset.sessionId = id;
  overlay.innerHTML =
    '<div class="flex-1 flex flex-col bg-zinc-900 rounded-lg border border-zinc-700 shadow-2xl overflow-hidden max-w-5xl w-full mx-auto">' +
      '<div class="flex items-center justify-between px-4 py-2 border-b border-zinc-700 bg-zinc-800">' +
        '<div class="flex flex-col">' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-green-400 text-sm font-mono font-bold">$ </span>' +
            '<span class="text-sm font-mono text-zinc-200">' + cmdLine + '</span>' +
            '<button class="term-copy-cmd text-zinc-500 hover:text-green-400 transition-colors" title="Copy command">' +
              '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>' +
            '</button>' +
          '</div>' +
          '<span class="text-[11px] text-zinc-500 font-mono" style="padding-left:1.1rem;">' + (session.work_dir || '') + '</span>' +
        '</div>' +
        '<div class="flex items-center gap-1">' +
          '<button class="term-minimize-btn text-zinc-500 hover:text-zinc-200 text-sm px-2 font-mono" title="Minimize">_</button>' +
          '<button class="term-close-x text-zinc-500 hover:text-zinc-200 text-lg px-2" title="Close">&times;</button>' +
        '</div>' +
      '</div>' +
      '<pre class="terminal-output flex-1"></pre>' +
      '<div class="flex items-center justify-between px-4 py-2 border-t border-zinc-700 bg-zinc-800">' +
        '<span class="term-status text-xs font-mono text-zinc-400">Running...</span>' +
        '<div class="flex gap-2">' +
          '<button class="term-stop-btn rounded-md bg-red-900/50 hover:bg-red-800/50 border border-red-700 text-red-300 px-3 py-1 text-xs font-mono">Stop</button>' +
          '<button class="term-close-btn rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1 text-xs font-mono">Close</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var output = overlay.querySelector('.terminal-output');
  var statusEl = overlay.querySelector('.term-status');
  var stopBtn = overlay.querySelector('.term-stop-btn');
  var closeBtn = overlay.querySelector('.term-close-btn');
  var closeX = overlay.querySelector('.term-close-x');
  var minimizeBtn = overlay.querySelector('.term-minimize-btn');
  var copyCmd = overlay.querySelector('.term-copy-cmd');

  // Track session
  var sessionState = {
    es: null,
    overlay: overlay,
    minimized: false,
    processRunning: true,
    label: label,
    exitCode: null,
    onEsc: null
  };
  _termSessions[id] = sessionState;

  ensurePillBar();
  updatePillBar();

  if (copyCmd) {
    copyCmd.onclick = function(e) {
      e.stopPropagation();
      navigator.clipboard.writeText(cmdLine).then(function() {
        showToast('Command copied to clipboard');
      });
    };
  }

  minimizeBtn.onclick = function(e) {
    e.stopPropagation();
    minimizeSession(id);
  };

  function doClose() {
    doCleanupSession(id);
  }

  function closeModal() {
    if (sessionState.processRunning) {
      showConfirmDialog({
        title: 'Process still running',
        message: 'A terragrunt process is still running. Close anyway? The process will be stopped.',
        confirmLabel: 'Stop & Close',
        confirmClass: 'bg-red-600 hover:bg-red-500 text-white',
        onConfirm: function() {
          var body = new URLSearchParams();
          body.append('id', id);
          fetch('/api/terminal/stop', { method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: body.toString() });
          doClose();
        }
      });
      return;
    }
    doClose();
  }

  closeBtn.onclick = closeModal;
  closeX.onclick = closeModal;

  stopBtn.onclick = function() {
    showConfirmDialog({
      title: 'Stop process?',
      message: 'This may leave resources in a partial state.',
      confirmLabel: 'Stop',
      confirmClass: 'bg-red-600 hover:bg-red-500 text-white',
      onConfirm: function() {
        var body = new URLSearchParams();
        body.append('id', id);
        fetch('/api/terminal/stop', { method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: body.toString() });
        stopBtn.disabled = true;
        stopBtn.textContent = 'Stopping...';
      }
    });
  };

  // Escape key handler
  function onEsc(e) {
    if (e.key === 'Escape') {
      // Only handle if this session's overlay is visible (not minimized)
      if (sessionState.minimized) return;
      // Check no confirm dialog is open
      if (document.querySelector('.fixed.inset-0.z-\\[60\\]:not(.terminal-modal)')) return;
      e.stopImmediatePropagation();
      closeModal();
    }
  }
  sessionState.onEsc = onEsc;
  document.addEventListener('keydown', onEsc);

  // Connect SSE — batch lines into a text buffer, flush via rAF
  var es = new EventSource('/api/terminal/stream?id=' + encodeURIComponent(id));
  sessionState.es = es;

  var _lineBuf = [];
  var _flushPending = false;

  function flushLines() {
    _flushPending = false;
    if (_lineBuf.length === 0) return;
    output.textContent += _lineBuf.join('\n') + '\n';
    _lineBuf.length = 0;
    output.scrollTop = output.scrollHeight;
  }

  es.onmessage = function(e) {
    _lineBuf.push(e.data);
    if (!_flushPending) {
      _flushPending = true;
      requestAnimationFrame(flushLines);
    }
  };

  es.addEventListener('done', function(e) {
    flushLines();
    var exitCode = parseInt(e.data, 10);
    sessionState.processRunning = false;
    sessionState.exitCode = exitCode;
    if (sessionState.es) {
      sessionState.es.close();
      sessionState.es = null;
    }
    stopBtn.style.display = 'none';
    if (exitCode === 0) {
      statusEl.innerHTML = '<span class="text-green-400">&#10003; Exit code: 0</span>';
    } else {
      statusEl.innerHTML = '<span class="text-red-400">&#10007; Exit code: ' + exitCode + '</span>';
    }
    updatePillBar();
  });

  es.onerror = function() {
    flushLines();
    sessionState.processRunning = false;
    sessionState.exitCode = -1;
    if (sessionState.es) {
      sessionState.es.close();
      sessionState.es = null;
    }
    stopBtn.style.display = 'none';
    statusEl.innerHTML = '<span class="text-zinc-500">Connection closed</span>';
    updatePillBar();
  };
}

// Recover sessions on page load (e.g., after reload)
function recoverTerminalSessions() {
  fetch('/api/terminal/list')
    .then(function(resp) { return resp.json(); })
    .then(function(sessions) {
      if (!sessions || sessions.length === 0) return;
      sessions.forEach(function(s) {
        if (_termSessions[s.id]) return; // already tracked
        // Only recover running sessions or recently completed ones
        showTerminalModal(s);
        // If not running, mark as done
        if (s.status !== 'running') {
          var state = _termSessions[s.id];
          if (state) {
            state.processRunning = false;
            state.exitCode = s.exit_code;
            // Close the EventSource since process is done (SSE will send done event)
          }
        }
        // Start minimized
        minimizeSession(s.id);
      });
    })
    .catch(function() { /* ignore on first load */ });
}

// Re-inject buttons after htmx swaps (e.g., after AWS status loads)
document.addEventListener('htmx:afterSwap', function(e) {
  if (e.detail.target && e.detail.target.id === 'aws-status') {
    // Delay slightly to let DOM settle
    setTimeout(function() {
      injectTerminalButtons();
      updateTerminalButtonsVisibility();
    }, 100);
  }
});

// Initialize on load
initTheme();
initHeaderSync();
initFieldSync();
markDefaults();
updateSectionToggle('infra');
updateAllFoldButtons();
injectTerminalButtons();
updateTerminalButtonsVisibility();
recoverTerminalSessions();
