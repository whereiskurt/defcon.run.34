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
        '<button class="rounded-md ' + btnClass + ' px-4 py-2 text-sm font-medium" style="display:inline-flex;align-items:center;gap:6px;" id="cfd-confirm">' + (opts.confirmLabel || 'Confirm') + '</button>' +
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

function updatePreviewToggle(open) {
  var btn = document.getElementById('preview-toggle-btn');
  var iconOpen = document.getElementById('preview-icon-open');
  var iconClose = document.getElementById('preview-icon-close');
  if (!btn) return;
  if (open) {
    btn.classList.remove('border-green-600', 'text-green-400', 'hover:bg-green-700', 'hover:text-white');
    btn.classList.add('bg-green-700', 'text-white', 'border-green-700');
    if (iconOpen) iconOpen.classList.add('hidden');
    if (iconClose) iconClose.classList.remove('hidden');
  } else {
    btn.classList.add('border-green-600', 'text-green-400', 'hover:bg-green-700', 'hover:text-white');
    btn.classList.remove('bg-green-700', 'text-white', 'border-green-700');
    if (iconOpen) iconOpen.classList.remove('hidden');
    if (iconClose) iconClose.classList.add('hidden');
  }
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
    grid.classList.add('single-panel');
    grid.querySelectorAll('.section-divider').forEach(function(el) {
      el.classList.remove('md:col-span-2');
    });
    ['infra-modules', 'core-modules', 'svc-modules'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('md:col-span-2');
    });
  }
  updatePreviewToggle(true);
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
    grid.classList.remove('single-panel');
    grid.querySelectorAll('.section-divider').forEach(function(el) {
      el.classList.add('md:col-span-2');
    });
    ['infra-modules', 'core-modules', 'svc-modules'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('md:col-span-2');
    });
  }
  updatePreviewToggle(false);
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

// --- Diff (LCS) ---
// Compare old (on-disk) vs new (generated) lines. Returns {lines: string[]}
// where lines[i] is 'equal', 'add', or 'mod' for each newLine.
function computeDiff(oldLines, newLines) {
  var m = oldLines.length, n = newLines.length;
  if (m === 0) {
    var r = [];
    for (var i = 0; i < n; i++) r[i] = 'add';
    return {lines: r};
  }
  if (n === 0) return {lines: []};

  // Build LCS table
  var dp = [];
  for (var i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1);
    for (var j = 0; j <= n; j++) {
      if (i === 0 || j === 0) dp[i][j] = 0;
      else if (oldLines[i - 1] === newLines[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to ordered edit operations
  var ops = [];
  var i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({type: 'eq', ni: j - 1});
      i--; j--;
    } else if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) {
      ops.push({type: 'del'});
      i--;
    } else {
      ops.push({type: 'ins', ni: j - 1});
      j--;
    }
  }
  ops.reverse();

  // Merge adjacent del+ins pairs into 'mod'
  var result = new Array(n);
  for (var k = 0; k < n; k++) result[k] = 'equal';
  var o = 0;
  while (o < ops.length) {
    if (ops[o].type === 'eq') {
      result[ops[o].ni] = 'equal';
      o++;
    } else {
      var dels = [], ins = [];
      while (o < ops.length && ops[o].type !== 'eq') {
        if (ops[o].type === 'del') dels.push(ops[o]);
        else ins.push(ops[o]);
        o++;
      }
      var paired = Math.min(dels.length, ins.length);
      for (var p = 0; p < paired; p++) result[ins[p].ni] = 'mod';
      for (var p = paired; p < ins.length; p++) result[ins[p].ni] = 'add';
    }
  }
  return {lines: result};
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
// diffMap: optional array where diffMap[i] is 'equal'|'add'|'mod' per line
function processLines(lines, from, to, diffMap) {
  var html = '';
  var i = from;

  while (i < to) {
    var line = lines[i];
    var trimmed = line.trimEnd();
    var dt = diffMap ? diffMap[i] : null;

    if (isFoldOpener(trimmed)) {
      var openChar = trimmed[trimmed.length - 1];
      var closeChar = closeCharFor(trimmed);
      var end = findMatchingClose(lines, i, openChar, closeChar);
      if (end > to) end = to; // safety
      var innerCount = end - i - 1;
      var id = 'fold-' + (_foldUid++);
      var dc = (dt && dt !== 'equal') ? ' diff-' + dt : '';

      // Fold header line
      html += '<span class="fold-line' + dc + '" data-fold="' + id + '" data-count="' + innerCount + '">';
      html += '<span class="fold-icon" onclick="toggleFold(\'' + id + '\')">▾</span>';
      html += highlightLine(line);
      html += '</span>\n';

      // Inner content — recurse for nested folds
      html += '<span id="' + id + '" class="fold-content">';
      html += processLines(lines, i + 1, end, diffMap);
      html += '</span>';
      i = end;
    } else {
      var lh = highlightLine(line);
      if (dt && dt !== 'equal') {
        lh = '<span class="diff-' + dt + '">' + lh + '</span>';
      }
      html += lh + '\n';
      i++;
    }
  }

  return html;
}

function addCodeFolding(pre) {
  var raw = pre.textContent;
  pre.dataset.raw = raw;

  var lines = raw.split('\n');

  // Compute diff if original on-disk content is available
  var diffMap = null;
  if (pre.dataset.original !== undefined) {
    var orig = pre.dataset.original;
    if (orig !== raw) {
      if (orig === '') {
        // New file (doesn't exist on disk yet) — all lines are additions
        diffMap = [];
        for (var k = 0; k < lines.length; k++) diffMap[k] = 'add';
      } else {
        diffMap = computeDiff(orig.split('\n'), lines).lines;
      }
    }
  }

  pre.innerHTML = processLines(lines, 0, lines.length, diffMap);
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
    setTimeout(markFormClean, 500);
  };
}

// PII blur: re-blur individually revealed elements when clicking outside them
// Skip when global unblur is active — those should stay revealed until user clicks "Blur All"
document.addEventListener('click', function(e) {
  if (_globalUnblurred) return;
  document.querySelectorAll('.pii-blur.pii-revealed:not(.pii-sensitive)').forEach(function(el) {
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
    // Re-blur: remove pii-revealed from non-sensitive elements only
    // pii-sensitive elements (like export creds) are fully independent of global toggle
    document.querySelectorAll('.pii-blur.pii-revealed:not(.pii-sensitive)').forEach(function(el) {
      el.classList.remove('pii-revealed');
    });
    _globalUnblurred = false;
    if (btn) { btn.textContent = 'Unblur All'; btn.style.filter = 'none'; }
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
  if (btn) { btn.textContent = 'Blur All'; btn.style.filter = 'blur(1px)'; }
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

// After any htmx swap, apply global unblur state to newly injected elements
document.addEventListener('htmx:afterSettle', function(e) {
  if (!_globalUnblurred) return;
  var target = e.detail.target || e.detail.elt;
  if (!target) return;
  target.querySelectorAll('.pii-blur:not(.pii-sensitive):not(.pii-revealed)').forEach(function(el) {
    el.classList.add('pii-revealed');
  });
});

// Reload confirmation dialog
function confirmReload() {
  var msg = _formDirty
    ? 'You have unsaved changes that will be lost. This will reload all values from disk.'
    : 'This will reload from disk and overwrite any changes you have currently made.';
  showConfirmDialog({
    title: _formDirty ? 'Discard unsaved changes?' : 'Reload configuration?',
    message: msg,
    confirmLabel: _formDirty ? 'Discard & Reload' : 'Reload',
    confirmClass: _formDirty ? 'bg-red-600 hover:bg-red-500 text-white' : undefined,
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
    confirmLabel: '<svg style="width:14px;height:14px;flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M4.93 9A10 10 0 0119.07 9M19.07 15A10 10 0 014.93 15"/></svg> Re-query',
    onConfirm: function() {
      var btn = document.getElementById('requery-aws-btn');
      if (btn) {
        btn.classList.add('spinning');
        btn.disabled = true;
        btn.style.opacity = '0.35';
        btn.style.cursor = 'not-allowed';
        var span = btn.querySelector('span');
        if (span) span.textContent = 'Scanning';
      }
      _globalDiscoveryRunning = true;
      updateModuleRefreshButtons();
      fetch('/api/discovery/refresh', { method: 'POST' }).then(function() {
        htmx.trigger(document.body, 'refreshDiscovery');
        // Poll until discovery finishes in case the conditional htmx polling misses it
        var poll = setInterval(function() {
          htmx.trigger(document.body, 'refreshDiscovery');
          if (!discoveryRunning()) {
            _globalDiscoveryRunning = false;
            updateModuleRefreshButtons();
            if (btn) {
              btn.classList.remove('spinning');
              btn.disabled = false;
              btn.style.opacity = '';
              btn.style.cursor = '';
              var span = btn.querySelector('span');
              if (span) span.textContent = 'Refresh All';
            }
            clearInterval(poll);
          }
        }, 2000);
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

// Plan/Apply All — with optional region scoping

function confirmPlanAll(region) {
  var label = region ? 'Plan ' + region : 'Plan all modules';
  var msg = region
    ? 'Run terragrunt plan --all in the ' + region + ' region?'
    : 'Run terragrunt plan --all across every infrastructure module?';
  showConfirmDialog({
    title: label + '?',
    message: msg,
    confirmLabel: region ? 'Plan ' + region : 'Plan All',
    onConfirm: function() {
      if (region) {
        openTerminal('region-all', 'plan-all', region);
      } else {
        openTerminal('all', 'plan-all', '');
      }
    }
  });
}

function confirmApplyAll(region) {
  var label = region ? 'Apply ' + region : 'Apply all modules';
  var msg = region
    ? 'Run terragrunt apply --all in the ' + region + ' region? Resources may be created, modified, or destroyed.'
    : 'Run terragrunt apply --all across every infrastructure module. Resources may be created, modified, or destroyed.';
  showConfirmDialog({
    title: label + '?',
    message: msg,
    confirmLabel: region ? 'Apply ' + region : 'Apply All',
    confirmClass: 'bg-red-600 hover:bg-red-500 text-white',
    onConfirm: function() {
      if (region) {
        openTerminal('region-all', 'apply-all', region);
      } else {
        openTerminal('all', 'apply-all', '');
      }
    }
  });
}

// Split-button dropdown for Plan All / Apply All
function initSplitButtons() {
  var regions = window.ALL_REGIONS || [];
  ['split-plan-all', 'split-apply-all'].forEach(function(id) {
    var container = document.getElementById(id);
    if (!container) return;
    var command = container.dataset.command; // "plan" or "apply"
    var isPlan = command === 'plan';
    var mainLabel = isPlan ? 'Plan All' : 'Apply All';
    var mainClass = isPlan ? 'split-btn-plan' : 'split-btn-apply';
    var confirmFn = isPlan ? confirmPlanAll : confirmApplyAll;

    container.innerHTML =
      '<button type="button" class="split-btn-main ' + mainClass + '">' + mainLabel + '</button>' +
      '<button type="button" class="split-btn-drop ' + mainClass + '" aria-label="Select region">' +
        '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>' +
      '</button>' +
      '<div class="split-menu hidden"></div>';

    var mainBtn = container.querySelector('.split-btn-main');
    var dropBtn = container.querySelector('.split-btn-drop');
    var menu = container.querySelector('.split-menu');

    // Build menu items
    var allItem = document.createElement('div');
    allItem.className = 'split-menu-item';
    allItem.textContent = mainLabel.replace('All', 'All Regions');
    allItem.onclick = function() { menu.classList.add('hidden'); confirmFn(); };
    menu.appendChild(allItem);

    var sep = document.createElement('div');
    sep.className = 'split-menu-sep';
    menu.appendChild(sep);

    regions.forEach(function(r) {
      var item = document.createElement('div');
      item.className = 'split-menu-item';
      item.textContent = r.label + ' (' + r.full + ')';
      item.onclick = function() { menu.classList.add('hidden'); confirmFn(r.full); };
      menu.appendChild(item);
    });

    // Main button = all regions
    mainBtn.onclick = function(e) { e.stopPropagation(); confirmFn(); };

    // Drop button = toggle menu
    dropBtn.onclick = function(e) {
      e.stopPropagation();
      // Close other split menus
      document.querySelectorAll('.split-menu').forEach(function(m) {
        if (m !== menu) m.classList.add('hidden');
      });
      menu.classList.toggle('hidden');
    };
  });
}

// Close split menus on outside click
document.addEventListener('click', function() {
  document.querySelectorAll('.split-menu').forEach(function(m) {
    m.classList.add('hidden');
  });
});

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

// Import confirmation dialog — file picker + upload
function confirmImport() {
  var overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[60] bg-black/50 flex items-center justify-center';
  overlay.innerHTML =
    '<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-xl p-6 max-w-md mx-4">' +
      '<h3 class="text-base font-semibold mb-3">Import Configuration</h3>' +
      '<p class="text-sm text-zinc-400 mb-3">Select a <span class="font-mono text-zinc-300">site-config.json</span> file to import. This will overwrite the current configuration. A backup will be created first.</p>' +
      '<div class="mb-4">' +
        '<input type="file" id="import-file-input" accept=".json,application/json" class="block w-full text-sm text-zinc-400 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-zinc-200 dark:file:bg-zinc-700 file:text-zinc-700 dark:file:text-zinc-200 hover:file:bg-zinc-300 dark:hover:file:bg-zinc-600 file:cursor-pointer">' +
      '</div>' +
      '<div class="flex justify-end gap-2">' +
        '<button class="rounded-md bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 px-4 py-2 text-sm" id="import-cancel-btn">Cancel</button>' +
        '<button class="rounded-md bg-green-700 hover:bg-green-600 text-white px-4 py-2 text-sm font-medium" id="import-confirm-btn">Import</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  function dismiss() { overlay.remove(); document.removeEventListener('keydown', onEsc); }
  overlay.querySelector('#import-cancel-btn').onclick = dismiss;
  overlay.addEventListener('click', function(e) { if (e.target === overlay) dismiss(); });

  overlay.querySelector('#import-confirm-btn').onclick = function() {
    var fileInput = document.getElementById('import-file-input');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      showToast('Please select a file first', 3000);
      return;
    }
    var formData = new FormData();
    formData.append('file', fileInput.files[0]);
    dismiss();
    fetch('/import', { method: 'POST', body: formData })
      .then(function(resp) { return resp.text(); })
      .then(function(html) {
        var container = document.getElementById('save-result');
        if (container) container.innerHTML = html;
        // The server response includes a script that shows toast + reloads
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        var script = tmp.querySelector('script');
        if (script) eval(script.textContent);
      })
      .catch(function(err) { showToast('Import failed: ' + err.message, 5000); });
  };

  var onEsc = function(e) {
    if (e.key === 'Escape') { dismiss(); e.stopImmediatePropagation(); }
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
  // Look inside the section's module container first
  var container = document.getElementById(section + '-modules');
  if (container) {
    var panels = [];
    container.querySelectorAll('[data-panel]').forEach(function(el) {
      panels.push(el.getAttribute('data-panel'));
    });
    return panels;
  }
  // Fallback: walk siblings from the section divider
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

// Roll up/down entire section — hides the modules container
function toggleSectionRollup(section) {
  var container = document.getElementById(section + '-modules');
  if (!container) return;
  var btn = document.getElementById('section-roll-' + section);
  if (container.style.display === 'none') {
    container.style.display = '';
    if (btn) btn.classList.add('open');
  } else {
    container.style.display = 'none';
    if (btn) btn.classList.remove('open');
  }
}

// Collect module panels (with toggle-switch checkboxes) in a section
function getSectionModules(section) {
  // Each section has a container: core-modules, infra-modules, svc-modules
  var container = document.getElementById(section + '-modules');
  if (!container) {
    // Fallback: walk siblings from the section divider
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

  var cards = container.querySelectorAll('[data-panel]');
  var panels = [];
  for (var i = 0; i < cards.length; i++) {
    var cb = cards[i].querySelector('.toggle-switch');
    if (cb) panels.push({ card: cards[i], checkbox: cb, id: cards[i].getAttribute('data-panel') });
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
    // Find which section container this panel belongs to
    var container = e.target.closest('#core-modules, #infra-modules, #svc-modules');
    if (container) {
      var section = container.id.replace('-modules', '');
      updateSectionToggle(section);
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

// Track whether a global (all-module) discovery was triggered
var _globalDiscoveryRunning = false;

// Hide/show per-module refresh buttons based on global discovery state
function updateModuleRefreshButtons() {
  var hide = _globalDiscoveryRunning || discoveryRunning();
  document.querySelectorAll('.term-btn-refresh').forEach(function(btn) {
    // Skip the global refresh button — it gets greyed out, not hidden
    if (btn.id === 'requery-aws-btn') return;
    // Use visibility to preserve layout (ml-auto spacing)
    if (hide || btn.classList.contains('spinning')) {
      btn.style.visibility = 'hidden';
      btn.style.pointerEvents = 'none';
    } else {
      btn.style.visibility = '';
      btn.style.pointerEvents = '';
    }
  });
}

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
      dotsContainer.className = 'discovery-dots flex items-center gap-1.5 mr-2';
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
    var regionalLabels = ['use1', 'cac1', 'apse1'];
    var regionOrder = regionalLabels.concat(['global']);

    // Determine if this panel is global-only or regional
    var hasGlobal = !!byRegion['global'];
    var hasRegional = regionalLabels.some(function(r) { return !!byRegion[r]; });

    // Always show all regional labels (greyed out if no result), or just global
    var displayRegions;
    if (hasGlobal && !hasRegional) {
      displayRegions = ['global'];
    } else {
      displayRegions = regionalLabels.slice();
      if (hasGlobal) displayRegions.push('global');
    }

    displayRegions.forEach(function(region) {
      var info = byRegion[region];

      var cls = 'discovery-dot';
      var tooltip = region;

      if (!info) {
        // Region not checked — show as unchecked grey
        cls += ' unchecked';
        tooltip += '\nnot checked';
      } else {
        var total = info.resources.length;
        var foundCount = 0;
        entries.forEach(function(e) { if (e.region === region && e.exists) foundCount++; });
        var allFound = foundCount === total;
        var noneFound = foundCount === 0;

        if (allFound) cls += ' found';
        else if (noneFound) cls += ' missing';
        else cls += ' partial';

        if (info.details.length > 0) tooltip += '\n' + info.details.join('\n');
        if (info.errors.length > 0) tooltip += '\n' + info.errors.join('\n');
        if (total > 1) tooltip += '\n(' + foundCount + '/' + total + ' found)';
      }

      html += '<div class="flex items-center gap-0.5" title="' + tooltip.replace(/"/g, '&quot;') + '">';
      html += '<span class="' + cls + '"></span>';
      html += '<span class="text-[10px] text-zinc-500">' + region + '</span>';
      html += '</div>';
    });

    dotsContainer.innerHTML = html;
  });
}

// Discovery timestamp — show "Xm ago" next to refresh icon
function updateDiscoveryTimestamp() {
  var data = document.getElementById('discovery-data');
  if (!data) return;
  var ts = parseInt(data.dataset.updatedAt, 10);
  if (!ts) return;

  var label = document.getElementById('discovery-timestamp');
  if (!label) return;

  var status = data.dataset.status;
  var rqBtn = document.getElementById('requery-aws-btn');
  if (status === 'running' && _globalDiscoveryRunning) {
    label.textContent = 'in progress';
    if (rqBtn) rqBtn.classList.add('spinning');
    return;
  }
  if (status !== 'running') {
    _globalDiscoveryRunning = false;
    updateModuleRefreshButtons();
    if (rqBtn) rqBtn.classList.remove('spinning');
  }

  var ago = Math.floor((Date.now() / 1000) - ts);
  if (ago < 60) label.textContent = ago + 's ago';
  else if (ago < 3600) label.textContent = Math.floor(ago / 60) + 'm ago';
  else label.textContent = Math.floor(ago / 3600) + 'h ago';
}

// Tick the timestamp label every 30s
setInterval(updateDiscoveryTimestamp, 30000);

// Listen for htmx swaps on discovery container
document.addEventListener('htmx:afterSwap', function(e) {
  if (e.detail.target && e.detail.target.id === 'discovery-container') {
    updateDiscoveryDots();
    updateDiscoveryTimestamp();
    // Stop spinning refresh buttons when discovery is done
    if (!discoveryRunning()) {
      _globalDiscoveryRunning = false;
      document.querySelectorAll('.term-btn-refresh.spinning').forEach(function(btn) {
        btn.classList.remove('spinning');
        btn.style.visibility = '';
        btn.style.pointerEvents = '';
      });
      var rqBtn = document.getElementById('requery-aws-btn');
      if (rqBtn) {
        rqBtn.classList.remove('spinning');
        rqBtn.disabled = false;
        rqBtn.style.opacity = '';
        rqBtn.style.cursor = '';
        var span = rqBtn.querySelector('span');
        if (span) span.textContent = 'Refresh All';
      }
    }
    updateModuleRefreshButtons();
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

// Persist AWS section open state across htmx swaps
var _awsSectionOpen = false;

// Toggle AWS section panel (identity + export creds) via the +/- button
function toggleAwsSection(btn) {
  _awsSectionOpen = !_awsSectionOpen;
  var panel = document.getElementById('aws-panel');
  if (btn) btn.textContent = _awsSectionOpen ? '\u2212' : '+';
  if (panel) {
    panel.style.display = _awsSectionOpen ? '' : 'none';
    if (_awsSectionOpen) {
      htmx.ajax('POST', '/api/export-creds', {target: '#aws-action-result', swap: 'innerHTML'});
    } else {
      var result = document.getElementById('aws-action-result');
      if (result) result.innerHTML = '';
    }
  }
}

// After AWS status reloads via htmx, restore the open/closed state
// (#aws-action-result is outside the swap zone, so it persists)
function syncAwsDetailsToggle() {
  var btn = document.getElementById('aws-section-toggle');
  var panel = document.getElementById('aws-panel');
  if (btn) btn.textContent = _awsSectionOpen ? '\u2212' : '+';
  if (panel && _awsSectionOpen) panel.style.display = '';
}

// Check if AWS is authenticated by looking at the aws-status container
function isAWSAuthed() {
  var el = document.getElementById('aws-status');
  if (!el) return false;
  return el.querySelector('.status-dot.ok') !== null;
}

// Build a joined action group: [Plan] [Apply] [region ▼] for regional, [Plan] [Apply] for global.
function buildModuleActionGroup(panelId, isGlobal) {
  var regions = window.ALL_REGIONS || [];
  var moduleName = panelId.replace(/_/g, '-');
  var selectedRegion = regions.length > 0 ? regions[0].full : '';
  var selectedLabel = regions.length > 0 ? regions[0].label : '';

  function doPlan(region) {
    var label = moduleName;
    if (region) label += ' (' + region + ')';
    showConfirmDialog({
      title: 'Plan ' + label + '?',
      message: 'Run terragrunt plan on <strong>' + label + '</strong>.',
      confirmLabel: 'Plan',
      onConfirm: function() { openTerminal(panelId, 'plan', region); }
    });
  }

  function doApply(region) {
    var label = moduleName;
    if (region) label += ' (' + region + ')';
    showConfirmDialog({
      title: 'Apply ' + label + '?',
      message: 'This will run <span class="font-mono text-zinc-300">terragrunt apply</span> on <strong>' + label + '</strong>. Resources may be created, modified, or destroyed.',
      confirmLabel: 'Apply',
      confirmClass: 'bg-red-600 hover:bg-red-500 text-white',
      onConfirm: function() { openTerminal(panelId, 'apply', region); }
    });
  }

  var wrapper = document.createElement('div');
  wrapper.className = 'action-group action-group-sm';
  wrapper.onclick = function(e) { e.stopPropagation(); };

  if (!isGlobal && regions.length > 0) {
    var regionBtn = document.createElement('button');
    regionBtn.type = 'button';
    regionBtn.className = 'action-group-btn action-group-region';
    regionBtn.innerHTML = '<span class="region-badge">' + selectedLabel + '</span> <svg class="w-2.5 h-2.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>';
    wrapper.appendChild(regionBtn);

    var menu = document.createElement('div');
    menu.className = 'split-menu hidden';
    regions.forEach(function(r) {
      var item = document.createElement('div');
      item.className = 'split-menu-item';
      item.textContent = r.label + ' (' + r.full + ')';
      item.onclick = function(e) {
        e.stopPropagation();
        menu.classList.add('hidden');
        selectedRegion = r.full;
        selectedLabel = r.label;
        regionBtn.innerHTML = '<span class="region-badge">' + r.label + '</span> <svg class="w-2.5 h-2.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>';
      };
      menu.appendChild(item);
    });
    wrapper.appendChild(menu);

    regionBtn.onclick = function(e) {
      e.stopPropagation();
      document.querySelectorAll('.split-menu').forEach(function(m) {
        if (m !== menu) m.classList.add('hidden');
      });
      menu.classList.toggle('hidden');
    };
  }

  var planBtn = document.createElement('button');
  planBtn.type = 'button';
  planBtn.className = 'action-group-btn action-group-plan';
  planBtn.textContent = 'Plan';
  planBtn.onclick = function(e) { e.stopPropagation(); doPlan(isGlobal ? '' : selectedRegion); };
  wrapper.appendChild(planBtn);

  var applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'action-group-btn action-group-apply';
  applyBtn.textContent = 'Apply';
  applyBtn.onclick = function(e) { e.stopPropagation(); doApply(isGlobal ? '' : selectedRegion); };
  wrapper.appendChild(applyBtn);

  return wrapper;
}

// Inject Plan/Apply split-buttons into discoverable panel headers
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
    container.className = 'term-actions flex items-center gap-2 ml-2';
    container.onclick = function(e) { e.stopPropagation(); };

    container.appendChild(buildModuleActionGroup(panelId, mod.global));

    // Insert action group before discovery dots or chevron
    var dots = header.querySelector('.discovery-dots');
    var chevron = header.querySelector('.chevron');
    if (dots) {
      dots.parentElement.insertBefore(container, dots);
    } else if (chevron) {
      chevron.parentElement.insertBefore(container, chevron);
    } else {
      header.appendChild(container);
    }

    // Refresh button — right before the discovery dots
    var refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'term-btn term-btn-refresh ml-auto mr-2';
    refreshBtn.title = 'Re-query AWS resources';
    refreshBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M4.93 9A10 10 0 0119.07 9M19.07 15A10 10 0 014.93 15"/></svg>';
    refreshBtn.onclick = function(e) {
      e.stopPropagation();
      showConfirmDialog({
        title: 'Re-query ' + panelId.replace(/_/g, '-') + '?',
        message: 'Are you sure you want to re-query AWS resources?',
        confirmLabel: 'Re-query',
        onConfirm: function() {
          refreshBtn.classList.add('spinning');
          refreshBtn.style.visibility = 'hidden';
          refreshBtn.style.pointerEvents = 'none';
          fetch('/api/discovery/refresh?module=' + encodeURIComponent(panelId), { method: 'POST' }).then(function() {
            htmx.trigger(document.body, 'refreshDiscovery');
            var poll = setInterval(function() {
              if (!refreshBtn.classList.contains('spinning')) { clearInterval(poll); return; }
              htmx.trigger(document.body, 'refreshDiscovery');
              if (!discoveryRunning()) {
                refreshBtn.classList.remove('spinning');
                refreshBtn.style.visibility = '';
                refreshBtn.style.pointerEvents = '';
                clearInterval(poll);
              }
            }, 2000);
          });
        }
      });
    };
    dots = header.querySelector('.discovery-dots');
    if (dots) {
      dots.parentElement.insertBefore(refreshBtn, dots);
    } else if (chevron) {
      chevron.parentElement.insertBefore(refreshBtn, chevron);
    } else {
      header.appendChild(refreshBtn);
    }
  });
  // Hide refresh buttons if global discovery is still running
  updateModuleRefreshButtons();
}

// Grey out infrastructure buttons when AWS is not connected
function updateTerminalButtonsVisibility() {
  var authed = isAWSAuthed();
  // Per-module and infra-all term-actions
  document.querySelectorAll('.term-actions').forEach(function(el) {
    if (authed) el.classList.remove('aws-disabled');
    else el.classList.add('aws-disabled');
  });
  // Global re-query button
  var rqBtn = document.getElementById('requery-aws-btn');
  if (rqBtn) {
    if (authed) rqBtn.classList.remove('aws-disabled');
    else rqBtn.classList.add('aws-disabled');
  }
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

    var icon;
    if (s.processRunning) {
      pill.classList.add('running');
      icon = '<span class="term-pill-dot running"></span>';
    } else if (s.exitCode === 0) {
      pill.classList.add('done');
      icon = '<span class="term-pill-icon done">&#10003;</span>';
    } else {
      pill.classList.add('error');
      icon = '<span class="term-pill-icon error">&#10007;</span>';
    }

    var summaryBit = '';
    if (!s.processRunning && s.summary) {
      summaryBit = '<span class="term-pill-summary">' + formatPillSummary(s.summary) + '</span>';
    }

    pill.innerHTML = icon +
      '<span class="term-pill-label">' + s.label + '</span>' +
      summaryBit +
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
  saveToHistory(id);
  if (s.es) { s.es.close(); s.es = null; }
  if (s.overlay) s.overlay.remove();
  if (s.onEsc) document.removeEventListener('keydown', s.onEsc);
  delete _termSessions[id];
  updatePillBar();
  htmx.trigger(document.body, 'refreshDiscovery');
}

// --- Terraform summary formatting ---

function formatSummaryHtml(summary, exitCode, command) {
  var icon = exitCode === 0
    ? '<span class="text-green-400">&#10003;</span>'
    : '<span class="text-red-400">&#10007;</span>';
  if (!summary) {
    // Fallback to exit code display
    if (exitCode === 0) return '<span class="text-green-400">&#10003; Done</span>';
    return '<span class="text-red-400">&#10007; Exit code: ' + exitCode + '</span>';
  }
  var isApply = command && command.indexOf('apply') !== -1;
  var prefix = isApply ? 'Applied ' : 'Planned ';
  if (summary.no_change) {
    return icon + ' <span class="text-zinc-400">No changes — infrastructure matches configuration</span>';
  }
  var parts = [];
  parts.push('<span class="' + (summary.add > 0 ? 'text-green-400' : 'text-zinc-500') + '">+' + summary.add + '</span>');
  parts.push('<span class="' + (summary.change > 0 ? 'text-yellow-400' : 'text-zinc-500') + '">~' + summary.change + '</span>');
  parts.push('<span class="' + (summary.destroy > 0 ? 'text-red-400' : 'text-zinc-500') + '">-' + summary.destroy + '</span>');
  return icon + ' ' + prefix + parts.join(', ');
}

function formatPillSummary(summary) {
  if (!summary) return '';
  if (summary.no_change) return '(no changes)';
  var parts = [];
  if (summary.add > 0) parts.push('+' + summary.add + ' add');
  if (summary.change > 0) parts.push('~' + summary.change + ' chg');
  if (summary.destroy > 0) parts.push('-' + summary.destroy + ' del');
  if (parts.length === 0) return '(no changes)';
  return parts.join(' ');
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
          '<div class="flex items-center gap-2" style="padding-left:1.1rem;">' +
            '<span class="text-[11px] text-zinc-500 font-mono">' + (session.work_dir || '') + '</span>' +
            '<span class="term-status text-[11px] font-mono text-green-400" style="padding-right:0.5rem;">Running...</span>' +
          '</div>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<button class="term-minimize-btn text-zinc-500 hover:text-zinc-200 text-sm px-2 font-mono" title="Minimize">_</button>' +
          '<button class="term-close-x text-zinc-500 hover:text-zinc-200 text-lg px-2" title="Close">&times;</button>' +
        '</div>' +
      '</div>' +
      '<pre class="terminal-output flex-1"></pre>' +
      '<div class="term-footer flex items-center justify-between px-4 py-2 border-t border-zinc-700 bg-zinc-800">' +
        '<span class="term-footer-status text-sm font-mono text-zinc-400"></span>' +
        '<button class="term-stop-btn rounded-md bg-red-900/50 hover:bg-red-800/50 border border-red-700 text-red-300 px-4 py-1.5 text-sm font-mono">Stop</button>' +
        '<button class="term-close-btn hidden rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-4 py-1.5 text-sm font-mono">Close</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var output = overlay.querySelector('.terminal-output');
  var statusEl = overlay.querySelector('.term-status');
  var stopBtn = overlay.querySelector('.term-stop-btn');
  var footer = overlay.querySelector('.term-footer');
  var footerStatus = overlay.querySelector('.term-footer-status');
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
    onEsc: null,
    command: session.command || '',
    module: session.module || '',
    cmdLine: cmdLine,
    workDir: session.work_dir || ''
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

  // Escape key handler — always minimize (user can explicitly close via X or Close button)
  function onEsc(e) {
    if (e.key === 'Escape') {
      // Only handle if this session's overlay is visible (not minimized)
      if (sessionState.minimized) return;
      // Check no confirm dialog is open
      if (document.querySelector('.fixed.inset-0.z-\\[60\\]:not(.terminal-modal)')) return;
      e.stopImmediatePropagation();
      minimizeSession(id);
    }
  }
  sessionState.onEsc = onEsc;
  document.addEventListener('keydown', onEsc);

  // Connect SSE — batch lines into a text buffer, flush via rAF
  var es = new EventSource('/api/terminal/stream?id=' + encodeURIComponent(id));
  sessionState.es = es;

  var _lineBuf = [];
  var _flushPending = false;
  var _hasOutput = false;

  function flushLines() {
    _flushPending = false;
    if (_lineBuf.length === 0) return;
    // Remove waiting placeholder on first real output
    if (!_hasOutput) {
      _hasOutput = true;
      var placeholder = output.querySelector('.term-waiting');
      if (placeholder) placeholder.remove();
    }
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

  es.addEventListener('tick', function(e) {
    var secs = parseInt(e.data, 10);
    if (sessionState.processRunning) {
      var m = Math.floor(secs / 60);
      var s = secs % 60;
      var elapsed = m > 0 ? m + 'm ' + s + 's' : s + 's';
      statusEl.textContent = 'Running... ' + elapsed;
      // Show waiting placeholder if no output after 3 seconds
      if (!_hasOutput && secs >= 3 && !output.querySelector('.term-waiting')) {
        var el = document.createElement('div');
        el.className = 'term-waiting';
        el.style.cssText = 'color:#a1a1aa;font-style:italic;padding:8px 0;';
        el.textContent = 'Waiting for terraform output...';
        output.appendChild(el);
      }
    }
  });

  es.addEventListener('summary', function(e) {
    try { sessionState.summary = JSON.parse(e.data); } catch(err) {}
  });

  es.addEventListener('done', function(e) {
    flushLines();
    var exitCode = parseInt(e.data, 10);
    sessionState.processRunning = false;
    sessionState.exitCode = exitCode;
    if (sessionState.es) {
      sessionState.es.close();
      sessionState.es = null;
    }
    stopBtn.classList.add('hidden');
    statusEl.textContent = exitCode === 0 ? 'Done' : 'Failed';
    statusEl.className = 'term-status text-[11px] font-mono ' +
      (exitCode === 0 ? 'text-green-400' : 'text-red-400');
    // Show exit code and close button in footer
    footerStatus.innerHTML = formatSummaryHtml(sessionState.summary, exitCode, sessionState.command);
    closeBtn.classList.remove('hidden');
    // Make Close button pop when done
    closeBtn.className = 'term-close-btn rounded-md px-4 py-1.5 text-sm font-mono font-bold ' +
      (exitCode === 0
        ? 'bg-green-500 hover:bg-green-400 text-black'
        : 'bg-red-500 hover:bg-red-400 text-white');
    updatePillBar();

    // Detect state lock errors and show helpful banner
    if (exitCode !== 0 && output.textContent.indexOf('Error acquiring the state lock') !== -1) {
      var lockBanner = document.createElement('div');
      lockBanner.className = 'flex items-center gap-3 px-4 py-2 bg-amber-900/40 border-t border-amber-700/50';
      lockBanner.innerHTML =
        '<svg class="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>' +
        '<span class="text-xs font-mono text-amber-300 flex-1">A stale Terraform state lock is blocking this operation. Use <strong>Fix Locks</strong> to scan and remove it.</span>' +
        '<button class="rounded-md bg-amber-700 hover:bg-amber-600 text-white px-3 py-1 text-xs font-mono font-medium flex-shrink-0">Fix Locks</button>';
      lockBanner.querySelector('button').onclick = function() {
        lockBanner.remove();
        confirmFixLocks();
      };
      // Insert before the footer
      var modalContainer = overlay.querySelector('.flex-1.flex.flex-col');
      modalContainer.insertBefore(lockBanner, footer);
    }

    // Detect SOPS decryption failures (expired SSO credentials)
    if (exitCode !== 0 && output.textContent.indexOf('Failed to get the data key required to decrypt the SOPS file') !== -1) {
      var sopsBanner = document.createElement('div');
      sopsBanner.className = 'flex items-center gap-3 px-4 py-2 bg-amber-900/40 border-t border-amber-700/50';
      sopsBanner.innerHTML =
        '<svg class="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>' +
        '<span class="text-xs font-mono text-amber-300 flex-1">SOPS decryption failed — your AWS SSO session has expired. Click <strong>SSO Login</strong> to re-authenticate.</span>' +
        '<button class="rounded-md bg-green-700 hover:bg-green-600 text-white px-3 py-1 text-xs font-mono font-medium flex-shrink-0" style="display:inline-flex;align-items:center;gap:6px;">' +
          '<svg style="width:14px;height:14px;flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.003 4.003 0 003 15z"/></svg>' +
          'SSO Login</button>';
      sopsBanner.querySelector('button').onclick = function() {
        sopsBanner.remove();
        fetch('/api/sso-login', { method: 'POST' }).then(function(resp) {
          return resp.text();
        }).then(function(html) {
          var result = document.getElementById('aws-action-result');
          if (result) result.innerHTML = html;
        });
      };
      var modalContainer = overlay.querySelector('.flex-1.flex.flex-col');
      modalContainer.insertBefore(sopsBanner, footer);
    }

    // Auto-refresh discovery after a successful apply
    if (exitCode === 0 && sessionState.command && sessionState.command.indexOf('apply') !== -1) {
      var mod = sessionState.module;
      // For "all" or "region-all", refresh everything; otherwise refresh the specific module
      var refreshUrl = (mod === 'all' || mod === 'region-all')
        ? '/api/discovery/refresh'
        : '/api/discovery/refresh?module=' + encodeURIComponent(mod);
      fetch(refreshUrl, { method: 'POST' }).then(function() {
        htmx.trigger(document.body, 'refreshDiscovery');
      });
    }
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
        // Only recover sessions that are still running
        if (s.status !== 'running') return;
        showTerminalModal(s);
        // Start minimized
        minimizeSession(s.id);
      });
    })
    .catch(function() { /* ignore on first load */ });
}

// Re-inject buttons after htmx settles (e.g., after AWS status loads)
document.addEventListener('htmx:afterSettle', function(e) {
  if (e.detail.target && e.detail.target.id === 'aws-status') {
    syncAwsDetailsToggle();
    injectTerminalButtons();
    updateTerminalButtonsVisibility();
  }
});

// =====================================================
// Run History — persisted across session dismissals
// =====================================================

var _termHistory = [];
var HISTORY_MAX = 20;

// Load history from localStorage on init
(function() {
  try {
    var saved = localStorage.getItem('configui-term-history');
    if (saved) _termHistory = JSON.parse(saved);
  } catch(e) {}
})();

function persistHistory() {
  try { localStorage.setItem('configui-term-history', JSON.stringify(_termHistory)); } catch(e) {}
}

function saveToHistory(id) {
  var s = _termSessions[id];
  if (!s) return;

  // Capture terminal output from the overlay's <pre>
  var outputText = '';
  if (s.overlay) {
    var pre = s.overlay.querySelector('.terminal-output');
    if (pre) outputText = pre.textContent || '';
  }

  var status = 'unknown';
  if (s.processRunning) status = 'running';
  else if (s.exitCode === 0) status = 'success';
  else if (s.exitCode != null) status = 'error';

  var entry = {
    id: id,
    label: s.label || '',
    command: s.command || '',
    cmdLine: s.cmdLine || '',
    workDir: s.workDir || '',
    exitCode: s.exitCode,
    status: status,
    summary: s.summary || null,
    timestamp: Date.now(),
    output: outputText
  };

  // Deduplicate by ID
  _termHistory = _termHistory.filter(function(h) { return h.id !== id; });
  // Add newest first
  _termHistory.unshift(entry);
  // Cap at max
  if (_termHistory.length > HISTORY_MAX) _termHistory.length = HISTORY_MAX;

  persistHistory();
  updateHistoryBadge();
}

function formatTimeAgo(ts) {
  var ago = Math.floor((Date.now() - ts) / 1000);
  if (ago < 60) return ago + 's ago';
  if (ago < 3600) return Math.floor(ago / 60) + 'm ago';
  if (ago < 86400) return Math.floor(ago / 3600) + 'h ago';
  return Math.floor(ago / 86400) + 'd ago';
}

function escapeHtml(text) {
  var d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function updateHistoryBadge() {
  var badge = document.getElementById('history-badge');
  if (!badge) return;
  if (_termHistory.length > 0) {
    badge.textContent = _termHistory.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function toggleHistoryDropdown() {
  var menu = document.getElementById('history-dropdown-menu');
  if (!menu) return;
  if (menu.classList.contains('hidden')) {
    renderHistoryMenu();
    menu.classList.remove('hidden');
  } else {
    menu.classList.add('hidden');
  }
}

function renderHistoryMenu() {
  var menu = document.getElementById('history-dropdown-menu');
  if (!menu) return;
  menu.innerHTML = '';

  if (_termHistory.length === 0) {
    menu.innerHTML = '<div class="history-menu-empty">No runs yet</div>';
    return;
  }

  _termHistory.forEach(function(entry) {
    var item = document.createElement('div');
    item.className = 'history-menu-item';

    var icon;
    if (entry.status === 'success') icon = '<span class="text-green-400">&#10003;</span>';
    else if (entry.status === 'error') icon = '<span class="text-red-400">&#10007;</span>';
    else icon = '<span class="text-zinc-500">&#9679;</span>';

    var labelHtml = '<span class="truncate">' + escapeHtml(entry.label) + '</span>';
    var summaryBit = entry.summary ? '<span class="term-pill-summary">' + formatPillSummary(entry.summary) + '</span>' : '';
    var cmdHtml = '<span class="text-zinc-500 truncate" style="max-width:120px;">' + escapeHtml(entry.command || '') + '</span>';
    var timeHtml = '<span class="text-zinc-500 whitespace-nowrap">' + formatTimeAgo(entry.timestamp) + '</span>';

    item.innerHTML =
      '<div class="flex items-center gap-1.5 min-w-0 flex-1">' +
        icon +
        labelHtml +
        summaryBit +
        cmdHtml +
      '</div>' +
      timeHtml;

    item.onclick = function() {
      menu.classList.add('hidden');
      showHistoryModal(entry);
    };

    menu.appendChild(item);
  });

  // Clear History footer
  var footer = document.createElement('div');
  footer.className = 'history-menu-footer';
  footer.textContent = 'Clear History';
  footer.onclick = function() {
    _termHistory = [];
    persistHistory();
    updateHistoryBadge();
    menu.classList.add('hidden');
  };
  menu.appendChild(footer);
}

function showHistoryModal(entry) {
  var overlay = document.createElement('div');
  overlay.className = 'terminal-modal fixed inset-0 z-[60] bg-black/70 flex flex-col p-4 md:p-8';
  overlay.innerHTML =
    '<div class="flex-1 flex flex-col bg-zinc-900 rounded-lg border border-zinc-700 shadow-2xl overflow-hidden max-w-5xl w-full mx-auto">' +
      '<div class="flex items-center justify-between px-4 py-2 border-b border-zinc-700 bg-zinc-800">' +
        '<div class="flex flex-col">' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-zinc-500 text-xs font-mono bg-zinc-700 px-1.5 py-0.5 rounded">[history]</span>' +
            '<span class="text-green-400 text-sm font-mono font-bold">$ </span>' +
            '<span class="text-sm font-mono text-zinc-200">' + escapeHtml(entry.cmdLine) + '</span>' +
          '</div>' +
          '<span class="text-[11px] text-zinc-500 font-mono" style="padding-left:1.1rem;">' + escapeHtml(entry.workDir) + '</span>' +
        '</div>' +
        '<div class="flex items-center gap-1">' +
          '<button class="history-close-x text-zinc-500 hover:text-zinc-200 text-lg px-2" title="Close">&times;</button>' +
        '</div>' +
      '</div>' +
      '<pre class="terminal-output flex-1">' + escapeHtml(entry.output) + '</pre>' +
      '<div class="flex items-center justify-between px-4 py-2 border-t border-zinc-700 bg-zinc-800">' +
        '<span class="text-xs font-mono text-zinc-400">' +
          formatSummaryHtml(entry.summary || null, entry.exitCode != null ? entry.exitCode : -1, entry.command) +
          ' &mdash; ' + formatTimeAgo(entry.timestamp) +
        '</span>' +
        '<button class="history-close-btn rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1 text-xs font-mono">Close</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var closeX = overlay.querySelector('.history-close-x');
  var closeBtn = overlay.querySelector('.history-close-btn');

  function dismiss() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  closeX.onclick = dismiss;
  closeBtn.onclick = dismiss;
  overlay.addEventListener('click', function(e) { if (e.target === overlay) dismiss(); });

  function onKey(e) {
    if (e.key === 'Escape') {
      if (document.querySelector('.fixed.inset-0.z-\\[60\\]:not(.terminal-modal)')) return;
      e.stopImmediatePropagation();
      dismiss();
    }
  }
  document.addEventListener('keydown', onKey);

  // Scroll output to bottom
  var output = overlay.querySelector('.terminal-output');
  if (output) output.scrollTop = output.scrollHeight;
}

// Close history dropdown on outside click (extend existing handler)
var _origClickHandler = document.onclick;
document.addEventListener('click', function(e) {
  var wrapper = document.getElementById('history-dropdown-wrapper');
  var menu = document.getElementById('history-dropdown-menu');
  if (menu && wrapper && !wrapper.contains(e.target)) {
    menu.classList.add('hidden');
  }
});

// --- Sortable module groups ---
var _sortableGroups = [
  { id: 'core-modules',  key: 'configui-core-order' },
  { id: 'infra-modules', key: 'configui-module-order' },
  { id: 'svc-modules',   key: 'configui-svc-order' }
];

// Restore saved panel order before masonry splits them into columns
function restoreModuleOrder() {
  _sortableGroups.forEach(function(g) {
    var container = document.getElementById(g.id);
    if (!container) return;
    var saved = localStorage.getItem(g.key);
    if (saved) {
      try {
        var order = JSON.parse(saved);
        order.forEach(function(panelId) {
          var el = container.querySelector('[data-panel="' + panelId + '"]');
          if (el) container.appendChild(el);
        });
      } catch (e) { /* ignore bad data */ }
    }
  });
}

function saveSortOrder(container, key) {
  // Collect panels from both masonry columns in visual order (left then right)
  var panels = container.querySelectorAll('[data-panel]');
  var order = [];
  panels.forEach(function(el) { order.push(el.getAttribute('data-panel')); });
  localStorage.setItem(key, JSON.stringify(order));
}

function initModuleSortable() {
  if (typeof Sortable === 'undefined') return;

  _sortableGroups.forEach(function(g) {
    var container = document.getElementById(g.id);
    if (!container) return;

    var cols = container.querySelectorAll('.masonry-col');
    if (cols.length > 0) {
      // Create sortable on each masonry column with shared group
      cols.forEach(function(col) {
        Sortable.create(col, {
          group: g.id,
          handle: '.drag-handle',
          animation: 200,
          ghostClass: 'sortable-ghost',
          chosenClass: 'sortable-chosen',
          onEnd: function() { saveSortOrder(container, g.key); }
        });
      });
    } else {
      // No masonry columns, sort container directly
      Sortable.create(container, {
        handle: '.drag-handle',
        animation: 200,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        onEnd: function() { saveSortOrder(container, g.key); }
      });
    }
  });
}

// --- Unsaved changes tracking ---
var _formDirty = false;
var _savedFormSnapshot = '';

function captureFormSnapshot() {
  var form = document.getElementById('config-form');
  if (!form) return '';
  var params = Array.from(new URLSearchParams(new FormData(form)).entries());
  params.sort(function(a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  return params.map(function(p) { return p[0] + '=' + p[1]; }).join('&');
}

function markFormClean() {
  _formDirty = false;
  _savedFormSnapshot = captureFormSnapshot();
  var banner = document.getElementById('unsaved-banner');
  if (banner) banner.classList.add('hidden');
}

function markFormDirty() {
  if (_formDirty) return;
  // Compare against saved snapshot to avoid false positives on initial load
  var current = captureFormSnapshot();
  if (current === _savedFormSnapshot) return;
  _formDirty = true;
  var banner = document.getElementById('unsaved-banner');
  if (banner) banner.classList.remove('hidden');
}

function dismissUnsavedBanner() {
  var banner = document.getElementById('unsaved-banner');
  if (banner) banner.classList.add('hidden');
}

function doSaveAll() {
  var banner = document.getElementById('unsaved-banner');
  if (banner) banner.classList.add('hidden');
  htmx.ajax('POST', '/save', {source: '#config-form', target: '#save-result', swap: 'innerHTML'});
  // Mark clean after a short delay to let the save complete
  setTimeout(markFormClean, 500);
}

function initDirtyTracking() {
  _savedFormSnapshot = captureFormSnapshot();
  var form = document.getElementById('config-form');
  if (!form) return;
  form.addEventListener('input', markFormDirty);
  form.addEventListener('change', markFormDirty);
}

// Split module-masonry containers into two fixed columns
function initMasonry() {
  document.querySelectorAll('.module-masonry').forEach(function(container) {
    if (container.querySelector('.masonry-col')) return;
    var children = Array.from(container.children);
    if (children.length < 2) return;
    var left = document.createElement('div');
    left.className = 'masonry-col';
    var right = document.createElement('div');
    right.className = 'masonry-col';
    var half = Math.ceil(children.length / 2);
    children.forEach(function(child, i) {
      if (i < half) left.appendChild(child);
      else right.appendChild(child);
    });
    container.appendChild(left);
    container.appendChild(right);
  });
}

// Initialize on load
initTheme();
initHeaderSync();
initFieldSync();
markDefaults();
updateSectionToggle('infra');
updateAllFoldButtons();
initSplitButtons();
injectTerminalButtons();
updateTerminalButtonsVisibility();
recoverTerminalSessions();
updateHistoryBadge();
restoreModuleOrder();
initMasonry();
initModuleSortable();
initDirtyTracking();
