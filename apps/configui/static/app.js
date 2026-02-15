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
function expandAllPanels() {
  document.querySelectorAll('[data-panel]').forEach(function(panel) {
    var id = panel.dataset.panel;
    var body = document.getElementById('body-' + id);
    var chevron = document.getElementById('chevron-' + id);
    if (body) { body.style.display = ''; }
    if (chevron) { chevron.classList.add('open'); }
  });
}
function collapseAllPanels() {
  document.querySelectorAll('[data-panel]').forEach(function(panel) {
    var id = panel.dataset.panel;
    var body = document.getElementById('body-' + id);
    var chevron = document.getElementById('chevron-' + id);
    if (body) { body.style.display = 'none'; }
    if (chevron) { chevron.classList.remove('open'); }
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

// PII blur: re-blur all pii-blur elements when clicking outside them
document.addEventListener('click', function(e) {
  document.querySelectorAll('.pii-blur.pii-revealed').forEach(function(el) {
    if (!el.contains(e.target) && e.target !== el) {
      el.classList.remove('pii-revealed');
    }
  });
});

// Global blur toggle (excludes AWS status fields)
function toggleGlobalBlur() {
  var body = document.body;
  var btn = document.getElementById('blur-toggle-btn');
  if (body.classList.contains('pii-disabled')) {
    // Re-blur: no confirmation needed
    body.classList.remove('pii-disabled');
    if (btn) btn.textContent = 'Unblur All';
  } else {
    // Unblur: confirm first
    confirmUnblur();
  }
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
    document.body.classList.add('pii-disabled');
    var btn = document.getElementById('blur-toggle-btn');
    if (btn) btn.textContent = 'Blur All';
  });
  var onKey = function(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); e.stopImmediatePropagation(); }
    if (e.key === 'Enter') { overlay.remove(); document.removeEventListener('keydown', onKey); e.stopImmediatePropagation(); document.body.classList.add('pii-disabled'); var btn = document.getElementById('blur-toggle-btn'); if (btn) btn.textContent = 'Blur All'; }
  };
  document.addEventListener('keydown', onKey);
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

// Toggle all modules in a section (infra or svc)
function toggleAllModules(section) {
  var btn = document.getElementById('toggle-' + section + '-btn');
  var grid = document.getElementById('form-grid');
  if (!grid) return;

  var startDiv = grid.querySelector('[data-section="' + section + '"]');
  if (!startDiv) return;

  // Collect panels between this divider and the next section (or end of grid)
  var panels = [];
  var sibling = startDiv.nextElementSibling;
  while (sibling && !sibling.hasAttribute('data-section')) {
    if (sibling.hasAttribute('data-panel')) {
      var cb = sibling.querySelector('.toggle-switch');
      if (cb) panels.push({ card: sibling, checkbox: cb, id: sibling.getAttribute('data-panel') });
    }
    sibling = sibling.nextElementSibling;
  }

  // Determine action: if any are enabled, disable all; otherwise enable all
  var anyEnabled = panels.some(function(p) { return p.checkbox.checked; });
  panels.forEach(function(p) {
    if (anyEnabled) {
      p.checkbox.checked = false;
      p.card.classList.add('panel-disabled');
      var body = document.getElementById('body-' + p.id);
      var chevron = document.getElementById('chevron-' + p.id);
      if (body) body.style.display = 'none';
      if (chevron) chevron.classList.remove('open');
    } else {
      p.checkbox.checked = true;
      p.card.classList.remove('panel-disabled');
    }
  });

  if (btn) btn.textContent = anyEnabled ? 'Enable All' : 'Disable All';
}

// Section-level expand/collapse — operates on panels within a data-section group
function getSectionPanels(section) {
  var grid = document.getElementById('form-grid');
  if (!grid) return [];
  var divider = grid.querySelector('[data-section="' + section + '"]');
  if (!divider) return [];

  // Walk siblings until next section-divider or end of grid
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

function expandSection(section) {
  getSectionPanels(section).forEach(function(id) {
    var body = document.getElementById('body-' + id);
    var chevron = document.getElementById('chevron-' + id);
    if (body) body.style.display = '';
    if (chevron) chevron.classList.add('open');
  });
}

function collapseSection(section) {
  getSectionPanels(section).forEach(function(id) {
    var body = document.getElementById('body-' + id);
    var chevron = document.getElementById('chevron-' + id);
    if (body) body.style.display = 'none';
    if (chevron) chevron.classList.remove('open');
  });
}

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
// Terminal — Terragrunt execution modal
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

var _termEventSource = null;

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
      if (!confirm('Run terragrunt apply on ' + label + '?')) return;
      openTerminal(panelId, 'apply', region);
    };

    container.appendChild(planBtn);
    container.appendChild(applyBtn);

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
  var label = session.module.replace(/_/g, '-');
  if (session.region) label += ' (' + session.region + ')';

  var overlay = document.createElement('div');
  overlay.id = 'terminal-modal';
  overlay.className = 'fixed inset-0 z-[60] bg-black/70 flex flex-col p-4 md:p-8';
  overlay.innerHTML =
    '<div class="flex-1 flex flex-col bg-zinc-900 rounded-lg border border-zinc-700 shadow-2xl overflow-hidden max-w-5xl w-full mx-auto">' +
      '<div class="flex items-center justify-between px-4 py-2 border-b border-zinc-700 bg-zinc-800">' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-green-400 text-sm font-mono font-bold">&#9654;</span>' +
          '<span class="text-sm font-mono text-zinc-200">terragrunt ' + session.command + '</span>' +
          '<span class="text-xs text-zinc-500 font-mono">' + label + '</span>' +
        '</div>' +
        '<button id="term-close-x" class="text-zinc-500 hover:text-zinc-200 text-lg px-2" title="Close">&times;</button>' +
      '</div>' +
      '<div id="term-output" class="terminal-output flex-1"></div>' +
      '<div id="term-footer" class="flex items-center justify-between px-4 py-2 border-t border-zinc-700 bg-zinc-800">' +
        '<span id="term-status" class="text-xs font-mono text-zinc-400">Running...</span>' +
        '<div class="flex gap-2">' +
          '<button id="term-stop-btn" class="rounded-md bg-red-900/50 hover:bg-red-800/50 border border-red-700 text-red-300 px-3 py-1 text-xs font-mono">Stop</button>' +
          '<button id="term-close-btn" class="rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1 text-xs font-mono">Close</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var output = document.getElementById('term-output');
  var statusEl = document.getElementById('term-status');
  var stopBtn = document.getElementById('term-stop-btn');
  var closeBtn = document.getElementById('term-close-btn');
  var closeX = document.getElementById('term-close-x');

  function closeModal() {
    if (_termEventSource) {
      _termEventSource.close();
      _termEventSource = null;
    }
    overlay.remove();
    // Trigger discovery refresh
    htmx.trigger(document.body, 'refreshDiscovery');
  }

  closeBtn.onclick = closeModal;
  closeX.onclick = closeModal;

  stopBtn.onclick = function() {
    fetch('/api/terminal/stop', { method: 'POST' });
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping...';
  };

  // Escape key handler
  function onEsc(e) {
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      closeModal();
      document.removeEventListener('keydown', onEsc);
    }
  }
  document.addEventListener('keydown', onEsc);

  // Connect SSE
  _termEventSource = new EventSource('/api/terminal/stream');

  _termEventSource.onmessage = function(e) {
    var line = document.createElement('div');
    line.className = 'terminal-line';
    line.textContent = e.data;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  };

  _termEventSource.addEventListener('done', function(e) {
    var exitCode = parseInt(e.data, 10);
    if (_termEventSource) {
      _termEventSource.close();
      _termEventSource = null;
    }
    stopBtn.style.display = 'none';
    if (exitCode === 0) {
      statusEl.innerHTML = '<span class="text-green-400">&#10003; Exit code: 0</span>';
    } else {
      statusEl.innerHTML = '<span class="text-red-400">&#10007; Exit code: ' + exitCode + '</span>';
    }
  });

  _termEventSource.onerror = function() {
    if (_termEventSource) {
      _termEventSource.close();
      _termEventSource = null;
    }
    stopBtn.style.display = 'none';
    statusEl.innerHTML = '<span class="text-zinc-500">Connection closed</span>';
  };
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
markDefaults();
injectTerminalButtons();
updateTerminalButtonsVisibility();
