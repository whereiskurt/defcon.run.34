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
    // Collapse body when disabled
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

// --- Code folding for preview <pre> blocks ---
var _foldUid = 0;

function escapeHtml(text) {
  var d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// Determine if a trimmed line opens a foldable block
function isFoldOpener(trimmed) {
  return (trimmed.endsWith('{') || trimmed.endsWith('[')) && trimmed.length > 1;
}

// Determine the matching close character
function closeCharFor(trimmed) {
  if (trimmed.endsWith('{')) return '}';
  if (trimmed.endsWith('[')) return ']';
  return null;
}

function addCodeFolding(pre) {
  var raw = pre.textContent;
  // Store raw text for copy
  pre.dataset.raw = raw;

  var lines = raw.split('\n');
  var html = '';
  var i = 0;

  while (i < lines.length) {
    var line = lines[i];
    var trimmed = line.trimEnd();

    if (isFoldOpener(trimmed)) {
      var closer = closeCharFor(trimmed);
      // Find matching close by tracking depth
      var depth = 1;
      var end = i + 1;
      while (end < lines.length && depth > 0) {
        var t = lines[end].trimEnd();
        // Count opens/closes of the same type
        for (var c = 0; c < t.length; c++) {
          if (t[c] === trimmed[trimmed.length - 1]) depth++;
          else if (t[c] === closer) depth--;
          if (depth === 0) break;
        }
        end++;
      }

      var innerCount = end - i - 1; // lines between open and close (inclusive of close line)
      var id = 'fold-' + (_foldUid++);

      // Opening line with fold toggle
      html += '<span class="fold-line" data-fold="' + id + '" data-count="' + innerCount + '">';
      html += '<span class="fold-icon" onclick="toggleFold(\'' + id + '\')">▾</span>';
      html += escapeHtml(line);
      html += '</span>\n';

      // Inner content (collapsible)
      html += '<span id="' + id + '" class="fold-content">';
      for (var j = i + 1; j < end; j++) {
        // Recurse-ish: check inner lines too
        var innerLine = lines[j];
        var innerTrimmed = innerLine.trimEnd();

        if (isFoldOpener(innerTrimmed)) {
          var innerCloser = closeCharFor(innerTrimmed);
          var innerDepth = 1;
          var innerEnd = j + 1;
          while (innerEnd < end && innerDepth > 0) {
            var it = lines[innerEnd].trimEnd();
            for (var ic = 0; ic < it.length; ic++) {
              if (it[ic] === innerTrimmed[innerTrimmed.length - 1]) innerDepth++;
              else if (it[ic] === innerCloser) innerDepth--;
              if (innerDepth === 0) break;
            }
            innerEnd++;
          }

          var innerInnerCount = innerEnd - j - 1;
          var innerId = 'fold-' + (_foldUid++);

          html += '<span class="fold-line" data-fold="' + innerId + '" data-count="' + innerInnerCount + '">';
          html += '<span class="fold-icon" onclick="toggleFold(\'' + innerId + '\')">▾</span>';
          html += escapeHtml(innerLine);
          html += '</span>\n';
          html += '<span id="' + innerId + '" class="fold-content">';
          for (var k = j + 1; k < innerEnd; k++) {
            html += escapeHtml(lines[k]) + '\n';
          }
          html += '</span>';
          j = innerEnd - 1;
        } else {
          html += escapeHtml(innerLine) + '\n';
        }
      }
      html += '</span>';
      i = end;
    } else {
      html += escapeHtml(line) + '\n';
      i++;
    }
  }

  pre.innerHTML = html;
}

function toggleFold(id) {
  var content = document.getElementById(id);
  if (!content) return;
  var line = document.querySelector('[data-fold="' + id + '"]');
  var icon = line ? line.querySelector('.fold-icon') : null;

  if (content.classList.contains('fold-collapsed')) {
    content.classList.remove('fold-collapsed');
    if (icon) icon.textContent = '▾';
    // Remove the summary
    var summary = document.getElementById(id + '-summary');
    if (summary) summary.remove();
  } else {
    content.classList.add('fold-collapsed');
    if (icon) icon.textContent = '▸';
    // Add summary showing line count
    var count = line ? line.dataset.count : '?';
    if (!document.getElementById(id + '-summary')) {
      var summary = document.createElement('span');
      summary.id = id + '-summary';
      summary.className = 'fold-summary';
      summary.textContent = ' ...' + count + ' lines';
      summary.onclick = function() { toggleFold(id); };
      content.insertAdjacentElement('afterend', summary);
    }
  }
}

// Apply code folding after htmx swaps preview content
document.addEventListener('htmx:afterSwap', function(e) {
  if (e.detail.target && e.detail.target.id === 'preview-content') {
    var pres = e.detail.target.querySelectorAll('pre');
    pres.forEach(addCodeFolding);
  }
});

// Fix copy to use raw text (bypassing fold HTML)
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
