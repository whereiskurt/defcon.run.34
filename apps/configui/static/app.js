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

// ========== Destroy Mode ==========
var _destroyCode = 'destroy';
var _destroyIndex = 0;
var _destroyActive = false;
var _escapeCount = 0;

// Capture-phase keydown: tracks "destroy" sequence, handles Escape deactivation
document.addEventListener('keydown', function(e) {
  // Skip when typing in form fields
  var tag = (e.target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  // In destroy mode: count Escape presses to deactivate
  if (_destroyActive) {
    if (e.key === 'Escape') {
      _escapeCount++;
      if (_escapeCount >= 3) {
        deactivateDestroyMode();
      }
    } else {
      _escapeCount = 0;
    }
    return;
  }

  // Track sequential letter matches against "destroy"
  if (e.key === _destroyCode[_destroyIndex]) {
    _destroyIndex++;
    updateDestroyDim(_destroyIndex);
    if (_destroyIndex === _destroyCode.length) {
      _destroyIndex = 0;
      activateDestroyMode();
    }
  } else {
    // Non-matching key resets
    _destroyIndex = 0;
    updateDestroyDim(0);
  }
}, true); // capture phase

// ========== Keyboard Shortcuts ==========
// Two-key sequences: ra=Refresh All, pa=Plan All, aa=Apply All
// Single key: - = collapse all panels (headers stay visible)
(function() {
  var _shortcutFirst = '';
  var _shortcutTimer = null;

  document.addEventListener('keydown', function(e) {
    var tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (_destroyActive) return;
    if (document.querySelector('.fixed.inset-0.z-\\[60\\]')) return;

    var key = e.key.toLowerCase();

    // Single-key: minus collapses all
    if (key === '-' && !_shortcutFirst) {
      e.preventDefault();
      var s = countAllPanelStates();
      if (s.open > 0) {
        // Collapse all
        document.querySelectorAll('[data-panel]').forEach(function(panel) {
          var id = panel.dataset.panel;
          var body = document.getElementById('body-' + id);
          var chevron = document.getElementById('chevron-' + id);
          if (body) body.style.display = 'none';
          if (chevron) chevron.classList.remove('open');
        });
        updateAllFoldButtons();
        showToast('All panels collapsed');
      } else {
        // Already collapsed — expand all
        toggleAllPanels();
        showToast('All panels expanded');
      }
      return;
    }

    // Two-key sequences
    if (_shortcutFirst) {
      clearTimeout(_shortcutTimer);
      var combo = _shortcutFirst + key;
      _shortcutFirst = '';
      if (combo === 'ra') {
        e.preventDefault();
        confirmRequery();
      } else if (combo === 'pa') {
        e.preventDefault();
        confirmPlanAll();
      } else if (combo === 'aa') {
        e.preventDefault();
        confirmApplyAll();
      }
      return;
    }

    // Start tracking first key of a two-key sequence
    if (key === 'r' || key === 'p' || key === 'a') {
      _shortcutFirst = key;
      _shortcutTimer = setTimeout(function() { _shortcutFirst = ''; }, 500);
    }
  });
})();

function updateDestroyDim(letterCount) {
  if (letterCount === 0) {
    document.body.classList.remove('destroy-dimming');
    document.body.style.removeProperty('--destroy-dim');
    document.body.style.removeProperty('--destroy-sepia');
    document.body.style.removeProperty('--destroy-sat');
    document.body.style.removeProperty('--destroy-hue');
    return;
  }
  document.body.classList.add('destroy-dimming');
  var t = letterCount / 7; // 0..1 over 7 letters
  // Darker: 1.0 → 0.35
  document.body.style.setProperty('--destroy-dim', (1.0 - t * 0.65).toFixed(2));
  // Redder: sepia shifts to warm tones, saturate intensifies, hue-rotate nudges toward red
  document.body.style.setProperty('--destroy-sepia', (t * 0.9).toFixed(2));
  document.body.style.setProperty('--destroy-sat', (1 + t * 3).toFixed(2));
  document.body.style.setProperty('--destroy-hue', Math.round(t * -15) + 'deg');
}

function activateDestroyMode() {
  _destroyActive = true;
  _escapeCount = 0;

  // Remove dimming
  updateDestroyDim(0);

  // Play chaos attractor activation animation
  playDestroyAnimation();

  // Red perimeter glow
  document.body.classList.add('destroy-mode');

  // Morph buttons
  morphButtonsToDestroy();

  // Persist across page reloads
  sessionStorage.setItem('destroyMode', 'active');

  // Red toast
  showDestroyToast('DESTROY MODE ACTIVATED — all Apply buttons are now Destroy. Press Esc x3 to exit.');
}

function deactivateDestroyMode() {
  _destroyActive = false;
  _escapeCount = 0;
  _destroyIndex = 0;

  document.body.classList.remove('destroy-mode');

  // Clear persistence
  sessionStorage.removeItem('destroyMode');

  // Restore buttons
  morphButtonsToApply();

  showToast('Destroy mode deactivated');
}

function showDestroyToast(message) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'rounded-md bg-red-900/90 border border-red-700 text-red-300 px-4 py-2 text-sm font-mono shadow-lg transition-opacity duration-300';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    setTimeout(function() { toast.remove(); }, 300);
  }, 6000);
}

// Procedural destroy animation: Lorenz attractor spirals into chaos
function playDestroyAnimation() {
  var container = document.getElementById('destroy-explosion');
  if (!container) return;

  var canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText = 'width:100%;height:100%';
  container.innerHTML = '';
  container.appendChild(canvas);
  container.classList.add('active');

  var ctx = canvas.getContext('2d');
  var w = canvas.width, h = canvas.height;
  var cx = w / 2, cy = h / 2;

  // Lorenz system parameters
  var sigma = 10, rho = 28, beta = 8 / 3;
  var x = 0.1, y = 0, z = 0;
  var dt = 0.005;
  var scale = 12;

  // Pre-compute a batch of Lorenz points
  var points = [];
  for (var i = 0; i < 6000; i++) {
    var dx = sigma * (y - x) * dt;
    var dy = (x * (rho - z) - y) * dt;
    var dz = (x * y - beta * z) * dt;
    x += dx; y += dy; z += dz;
    points.push({ x: x, y: z }); // project x,z for the butterfly shape
  }

  var frame = 0;
  var totalFrames = 90; // ~1.5s at 60fps
  var startTime = performance.now();
  var duration = 1500;

  function draw(now) {
    var elapsed = now - startTime;
    var t = Math.min(elapsed / duration, 1);

    ctx.fillStyle = 'rgba(0,0,0,' + (0.15 + t * 0.3) + ')';
    ctx.fillRect(0, 0, w, h);

    // How many points to draw this frame (accelerating)
    var pointCount = Math.floor(t * t * points.length);
    var drawScale = scale * (1 + t * 0.5);

    // Collapse toward center as t increases
    var collapse = 1 - t * t * 0.6;

    for (var i = Math.max(0, pointCount - 400); i < pointCount; i++) {
      var p = points[i];
      var px = cx + p.x * drawScale * collapse;
      var py = cy - (p.y - 25) * drawScale * collapse; // offset z center (~25)

      // Age: older points are dimmer
      var age = 1 - (pointCount - i) / 400;
      if (age < 0) continue;

      // Color: red with hints of orange/yellow at the edges
      var r = 220 + Math.floor(age * 35);
      var g = Math.floor(30 + age * 30 + Math.sin(i * 0.02) * 20);
      var b = Math.floor(20 + Math.sin(i * 0.03) * 15);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (age * 0.8) + ')';

      var size = 1.5 + age * 2;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Red shockwave ring expanding outward at the end
    if (t > 0.3) {
      var ringT = (t - 0.3) / 0.7;
      var radius = ringT * Math.max(w, h) * 0.6;
      ctx.strokeStyle = 'rgba(220,38,38,' + ((1 - ringT) * 0.5) + ')';
      ctx.lineWidth = 2 + (1 - ringT) * 4;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (t < 1) {
      requestAnimationFrame(draw);
    } else {
      // Fade out
      container.style.transition = 'opacity 0.3s';
      container.style.opacity = '0';
      setTimeout(function() {
        container.classList.remove('active');
        container.style.transition = '';
        container.style.opacity = '';
        container.innerHTML = '';
      }, 300);
    }
  }

  requestAnimationFrame(draw);
}

function morphButtonsToDestroy() {
  // Global split buttons: morph Apply All → Destroy All
  var applyAllContainer = document.getElementById('split-apply-all');
  if (applyAllContainer) {
    var mainBtn = applyAllContainer.querySelector('.split-btn-main');
    if (mainBtn) {
      mainBtn.textContent = 'Destroy All';
      mainBtn.className = mainBtn.className.replace('split-btn-apply', 'split-btn-destroy');
      mainBtn.onclick = function(e) { e.stopPropagation(); confirmDestroyAll(); };
    }
    var dropBtn = applyAllContainer.querySelector('.split-btn-drop');
    if (dropBtn) {
      dropBtn.className = dropBtn.className.replace('split-btn-apply', 'split-btn-destroy');
    }
    // Update menu items
    var menuItems = applyAllContainer.querySelectorAll('.split-menu-item');
    if (menuItems.length > 0) {
      menuItems[0].textContent = 'Destroy All Regions';
      menuItems[0].onclick = function() {
        applyAllContainer.querySelector('.split-menu').classList.add('hidden');
        confirmDestroyAll();
      };
      var regions = window.ALL_REGIONS || [];
      for (var i = 0; i < regions.length; i++) {
        if (menuItems[i + 2]) { // +2 to skip "all" item and separator
          (function(r) {
            menuItems[i + 2].onclick = function() {
              applyAllContainer.querySelector('.split-menu').classList.add('hidden');
              confirmDestroyAll(r.full);
            };
          })(regions[i]);
        }
      }
    }
  }

  // Per-module action groups: morph Apply → Destroy
  document.querySelectorAll('.action-group-apply').forEach(function(btn) {
    btn.textContent = 'Destroy';
    btn.classList.remove('action-group-apply');
    btn.classList.add('action-group-destroy');

    // Find parent action group to get panelId and region
    var wrapper = btn.closest('.action-group');
    if (!wrapper) return;
    var termActions = wrapper.closest('.term-actions');
    if (!termActions) return;
    var panelEl = termActions.closest('[data-panel]');
    if (!panelEl) return;
    var panelId = panelEl.dataset.panel;
    var isGlobal = TERMINAL_MODULES[panelId] && TERMINAL_MODULES[panelId].global;

    // Clone and replace to remove old click handlers
    var newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.onclick = function(e) {
      e.stopPropagation();
      // Get the currently selected region from the region button
      var region = '';
      if (!isGlobal) {
        var regionBadge = wrapper.querySelector('.region-badge');
        if (regionBadge) {
          var regions = window.ALL_REGIONS || [];
          var label = regionBadge.textContent;
          for (var i = 0; i < regions.length; i++) {
            if (regions[i].label === label) { region = regions[i].full; break; }
          }
        }
      }
      confirmDestroy(panelId, region);
    };
  });
}

function morphButtonsToApply() {
  // Re-run the standard button builders to restore global split buttons
  initSplitButtons();
  // Remove only per-module .term-actions (injected by injectTerminalButtons),
  // NOT #infra-all-actions which is the global toolbar from the HTML template.
  document.querySelectorAll('[data-panel] .term-actions').forEach(function(el) { el.remove(); });
  document.querySelectorAll('[data-panel] .term-btn-refresh').forEach(function(el) { el.remove(); });
  injectTerminalButtons();
}

function confirmDestroyAll(region) {
  var label = region ? 'Destroy ' + region : 'Destroy ALL modules';
  var msg = region
    ? 'This will run <span class="font-mono text-red-300">terragrunt destroy --all</span> in <strong>' + region + '</strong>. All resources in this region will be permanently deleted.'
    : 'This will run <span class="font-mono text-red-300">terragrunt destroy --all</span> across <strong>every infrastructure module</strong>. ALL resources will be permanently deleted.';
  showConfirmDialog({
    title: label + '?',
    message: msg,
    confirmLabel: region ? 'Destroy ' + region + ' \uD83D\uDD25' : 'Destroy Everything \uD83D\uDD25',
    confirmClass: 'bg-red-700 hover:bg-red-600 text-white',
    onConfirm: function() {
      if (region) {
        openTerminal('region-all', 'destroy-all', region);
      } else {
        openTerminal('all', 'destroy-all', '');
      }
    }
  });
}

function confirmDestroy(panelId, region) {
  var moduleName = panelId.replace(/_/g, '-');
  var label = moduleName;
  if (region) label += ' (' + region + ')';
  showConfirmDialog({
    title: 'Destroy ' + label + '?',
    message: 'This will run <span class="font-mono text-red-300">terragrunt destroy</span> on <strong>' + label + '</strong>. All resources in this module will be permanently deleted.',
    confirmLabel: 'Destroy \uD83D\uDD25',
    confirmClass: 'bg-red-700 hover:bg-red-600 text-white',
    onConfirm: function() { openTerminal(panelId, 'destroy', region); }
  });
}

function initDestroyMode() {
  if (sessionStorage.getItem('destroyMode') === 'active') {
    _destroyActive = true;
    document.body.classList.add('destroy-mode');
    morphButtonsToDestroy();
  }
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
var _activePreviewCategory = 'config';
var _previewScroll = 0;

var _tabActiveColors = {
  config:    'border-green-500 text-green-600 dark:text-green-400',
  services:  'border-cyan-500 text-cyan-600 dark:text-cyan-400',
  infra:     'border-purple-500 text-purple-600 dark:text-purple-400',
  campaigns: 'border-orange-500 text-orange-600 dark:text-orange-400'
};
function tabActive() {
  var colors = _tabActiveColors[_activePreviewCategory] || _tabActiveColors.config;
  return 'px-3 py-1.5 text-xs font-medium border-b-2 ' + colors;
}
var TAB_INACTIVE = 'px-3 py-1.5 text-xs font-medium border-b-2 border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 cursor-pointer';
var _pcatLabels = { config: 'Config', services: 'Services', infra: 'Infra', campaigns: 'Campaigns' };

function togglePcatDropdown() {
  var menu = document.getElementById('pcat-menu');
  if (menu) menu.classList.toggle('hidden');
}

function selectPcatItem(cat, label) {
  var menu = document.getElementById('pcat-menu');
  if (menu) menu.classList.add('hidden');
  var trigger = document.getElementById('pcat-trigger');
  if (trigger) {
    trigger.innerHTML = label + ' <svg class="inline w-3 h-3 ml-0.5 -mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>';
    trigger.className = 'pcat-pill pcat-' + cat;
  }
  switchPreviewCategory(cat);
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  var dd = document.getElementById('pcat-bar');
  var menu = document.getElementById('pcat-menu');
  if (dd && menu && !dd.contains(e.target)) menu.classList.add('hidden');
});

function switchPreviewCategory(cat) {
  _activePreviewCategory = cat;
  var pc = document.getElementById('preview-content');
  if (!pc) return;

  // Update trigger pill style
  var trigger = document.getElementById('pcat-trigger');
  if (trigger) {
    var lbl = _pcatLabels[cat] || cat;
    trigger.innerHTML = lbl + ' <svg class="inline w-3 h-3 ml-0.5 -mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>';
    trigger.className = 'pcat-pill pcat-' + cat;
  }

  // Theme tab bar with category colour
  var bar = pc.querySelector('#ptab-bar');
  if (bar) bar.dataset.activeCat = cat;

  // Show/hide tab buttons by data-category
  var firstVisible = null;
  pc.querySelectorAll('#ptab-bar button[data-category]').forEach(function(btn) {
    var show = btn.dataset.category === cat;
    btn.style.display = show ? '' : 'none';
    if (show && !firstVisible) firstVisible = btn;
  });

  // Auto-select first visible tab
  if (firstVisible) {
    var tabId = firstVisible.id.replace('ptab-', '');
    switchPreviewTab(tabId);
  }
}

function switchPreviewTab(tab) {
  _activePreviewTab = tab;
  var pc = document.getElementById('preview-content');
  if (!pc) return;
  pc.querySelectorAll('[id^="ptab-content-"]').forEach(function(el) {
    el.classList.toggle('hidden', el.id !== 'ptab-content-' + tab);
  });
  pc.querySelectorAll('#ptab-bar button[data-category]').forEach(function(btn) {
    var isVisible = btn.style.display !== 'none';
    if (isVisible) {
      btn.className = btn.id === 'ptab-' + tab ? tabActive() : TAB_INACTIVE;
    }
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
        if (_activePreviewCategory) {
          switchPreviewCategory(_activePreviewCategory);
        }
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

// --- YAML Syntax Highlighting ---
function highlightYAMLLine(raw) {
  var html = '';
  var i = 0;

  // Leading whitespace
  while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) {
    html += raw[i];
    i++;
  }

  if (i >= raw.length) return html;

  // Comment: # to end of line
  if (raw[i] === '#') {
    html += '<span class="hl-cmt">' + esc(raw.substring(i)) + '</span>';
    return html;
  }

  // List item marker: "- "
  if (raw[i] === '-' && i + 1 < raw.length && raw[i + 1] === ' ') {
    html += '<span class="hl-op">-</span>';
    i++;
    // Continue to parse the rest of the line
  }

  var rest = raw.substring(i);

  // Key: value pattern
  var kvMatch = rest.match(/^(\s*)([\w./$][^:]*?)(\s*:\s*)(.*)/);
  if (kvMatch) {
    html += kvMatch[1]; // whitespace before key
    html += '<span class="hl-key">' + esc(kvMatch[2]) + '</span>';
    html += '<span class="hl-op">' + esc(kvMatch[3]) + '</span>';
    var val = kvMatch[4];

    if (val) {
      // Inline comment
      var commentIdx = -1;
      var inQuote = false;
      for (var c = 0; c < val.length; c++) {
        if (val[c] === '"' || val[c] === "'") inQuote = !inQuote;
        if (!inQuote && val[c] === '#') { commentIdx = c; break; }
      }
      var valPart = commentIdx >= 0 ? val.substring(0, commentIdx) : val;
      var commentPart = commentIdx >= 0 ? val.substring(commentIdx) : '';
      html += highlightYAMLValue(valPart.trimEnd());
      if (valPart.length < (commentIdx >= 0 ? commentIdx : val.length)) {
        html += val.substring(valPart.trimEnd().length, commentIdx >= 0 ? commentIdx : val.length);
      }
      if (commentPart) {
        html += '<span class="hl-cmt">' + esc(commentPart) + '</span>';
      }
    }
    return html;
  }

  // Plain value line (after list marker, etc.)
  html += highlightYAMLValue(rest);
  return html;
}

function highlightYAMLValue(val) {
  val = val.trim();
  if (!val) return '';

  // {{ }} interpolation
  if (/\{\{.*\}\}/.test(val)) {
    return esc(val).replace(/\{\{([^}]*)\}\}/g, function(m) {
      return '<span class="hl-interp">' + m + '</span>';
    });
  }

  // Quoted string
  if ((val[0] === '"' && val[val.length - 1] === '"') || (val[0] === "'" && val[val.length - 1] === "'")) {
    var inner = esc(val).replace(/\{\{([^}]*)\}\}/g, function(m) {
      return '</span><span class="hl-interp">' + m + '</span><span class="hl-str">';
    });
    return '<span class="hl-str">' + inner + '</span>';
  }

  // Boolean
  if (val === 'true' || val === 'false' || val === 'null' || val === '~') {
    return '<span class="hl-bool">' + val + '</span>';
  }

  // Number
  if (/^-?\d+\.?\d*$/.test(val)) {
    return '<span class="hl-num">' + val + '</span>';
  }

  return esc(val);
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
// hlFn: highlighter function (highlightLine or highlightYAMLLine)
function processLines(lines, from, to, diffMap, hlFn) {
  if (!hlFn) hlFn = highlightLine;
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
      html += hlFn(line);
      html += '</span>\n';

      // Inner content — recurse for nested folds
      html += '<span id="' + id + '" class="fold-content">';
      html += processLines(lines, i + 1, end, diffMap, hlFn);
      html += '</span>';
      i = end;
    } else {
      var lh = hlFn(line);
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

  var hlFn = pre.dataset.lang === 'yaml' ? highlightYAMLLine : highlightLine;
  pre.innerHTML = processLines(lines, 0, lines.length, diffMap, hlFn);
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
    if (_activePreviewCategory) {
      switchPreviewCategory(_activePreviewCategory);
    }
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

// Check ECR for image tag existence
function checkECRTags() {
  var btn = document.getElementById('ecr-check-btn');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-50');
  }

  // Set all badge spans to loading state
  document.querySelectorAll('.ecr-badge').forEach(function(el) {
    el.className = 'ecr-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400';
    el.textContent = '...';
  });
  showToast('Checking ECR...');

  // Build form data from current version inputs
  var form = document.getElementById('config-form');
  var formData = new FormData(form);

  fetch('/api/ecr-tags', { method: 'POST', body: formData })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      Object.keys(data).forEach(function(key) {
        var el = document.getElementById('ecr-' + key);
        if (!el) return;
        var result = data[key];
        if (result.exists) {
          el.className = 'ecr-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
          el.innerHTML = '<span class="status-dot ok"></span> exists';
        } else if (result.error) {
          el.className = 'ecr-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
          el.innerHTML = '<span class="status-dot warning"></span> needs build';
        }
      });
      showToast('ECR check complete');
    })
    .catch(function(err) {
      document.querySelectorAll('.ecr-badge').forEach(function(el) {
        if (el.textContent === '...') {
          el.className = 'ecr-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
          el.innerHTML = '<span class="status-dot error"></span> error';
        }
      });
      showToast('ECR check failed: ' + err.message, 5000);
    })
    .finally(function() {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('opacity-50');
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

// Refresh AWS confirmation dialog
function confirmRequery() {
  showConfirmDialog({
    title: 'Refresh AWS?',
    message: 'This will query all AWS resources across all regions. This may take a few seconds.',
    confirmLabel: '<svg style="width:14px;height:14px;flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M4.93 9A10 10 0 0119.07 9M19.07 15A10 10 0 014.93 15"/></svg> Refresh',
    onConfirm: function() {
      // Expand Infrastructure Modules section if hidden
      var infraContainer = document.getElementById('infra-modules');
      if (infraContainer && infraContainer.style.display === 'none') {
        infraContainer.style.display = '';
        var rollBtn = document.getElementById('section-roll-infra');
        if (rollBtn) rollBtn.classList.add('open');
      }
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

// Aggressive Locks mode
var _aggressiveLocks = localStorage.getItem('aggressiveLocks') === 'true';

function toggleAggressiveLocks(on) {
  _aggressiveLocks = on;
  localStorage.setItem('aggressiveLocks', on ? 'true' : 'false');
  updateAggressiveLocksUI();
}

function updateAggressiveLocksUI() {
  var cb = document.getElementById('aggressive-locks-toggle');
  if (cb) cb.checked = _aggressiveLocks;
  var mainBtn = document.querySelector('#split-fix-locks .split-btn-main');
  if (mainBtn) {
    if (_aggressiveLocks) {
      mainBtn.classList.add('split-btn-active-warn');
    } else {
      mainBtn.classList.remove('split-btn-active-warn');
    }
  }
}

function toggleFixLocksMenu(e) {
  e.stopPropagation();
  var menu = document.getElementById('fix-locks-menu');
  if (!menu) return;
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden')) {
    var close = function() { menu.classList.add('hidden'); document.removeEventListener('click', close); };
    setTimeout(function() { document.addEventListener('click', close); }, 0);
  }
}

// Init aggressive locks state on load
document.addEventListener('DOMContentLoaded', function() {
  updateAggressiveLocksUI();
});

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
    confirmLabel: region ? 'Apply ' + region + ' 🚀' : 'Apply All 🚀',
    confirmClass: 'bg-green-600 hover:bg-green-500 text-white',
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
    var isDestroyApply = !isPlan && _destroyActive;
    var mainLabel = isDestroyApply ? 'Destroy All' : (isPlan ? 'Plan All' : 'Apply All');
    var mainClass = isDestroyApply ? 'split-btn-destroy' : (isPlan ? 'split-btn-plan' : 'split-btn-apply');
    var confirmFn = isDestroyApply ? confirmDestroyAll : (isPlan ? confirmPlanAll : confirmApplyAll);

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
  // If expanding and the section is rolled up (hidden), unhide it first
  if (expanding) {
    var container = document.getElementById(section + '-modules');
    if (container && container.style.display === 'none') {
      container.style.display = '';
      var btn = document.getElementById('section-roll-' + section);
      if (btn) btn.classList.add('open');
    }
  }
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

    // Only show dots for regions that have actual discovery data
    var displayRegions = [];
    regionOrder.forEach(function(r) {
      if (byRegion[r]) displayRegions.push(r);
    });

    displayRegions.forEach(function(region) {
      var info = byRegion[region];

      var cls = 'discovery-dot';
      var tooltip = region;

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
      // Check if none of the discovery results found anything — may indicate expired creds
      var allSpans = document.querySelectorAll('#discovery-container [data-panel][data-region]');
      var anyFound = false;
      allSpans.forEach(function(s) { if (s.dataset.exists === 'true') anyFound = true; });
      if (!anyFound && allSpans.length > 0) {
        // Re-check AWS auth — if creds are expired, warn the user
        fetch('/api/aws-status').then(function(r) { return r.text(); }).then(function(html) {
          var tmp = document.createElement('div');
          tmp.innerHTML = html;
          var ok = tmp.querySelector('.status-dot.ok');
          if (!ok) {
            showConfirmDialog({
              title: 'AWS SSO Session Expired',
              message: 'Discovery found <strong>0 resources</strong> — your AWS SSO session appears to have expired. Re-authenticate to get accurate results.',
              confirmLabel: '<svg style="width:14px;height:14px;flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.003 4.003 0 003 15z"/></svg> SSO Login',
              onConfirm: function() {
                fetch('/api/sso-login', { method: 'POST' }).then(function(resp) {
                  return resp.text();
                }).then(function(h) {
                  var result = document.getElementById('aws-action-result');
                  if (result) result.innerHTML = h;
                  // Refresh AWS status display
                  htmx.trigger(document.body, 'refreshAwsStatus');
                });
              }
            });
            // Also update the AWS status bar
            var awsEl = document.getElementById('aws-status');
            if (awsEl) awsEl.innerHTML = html;
            updateTerminalButtonsVisibility();
          }
        });
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
      confirmLabel: 'Apply 🚀',
      confirmClass: 'bg-green-600 hover:bg-green-500 text-white',
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
  if (_destroyActive) {
    applyBtn.className = 'action-group-btn action-group-destroy';
    applyBtn.textContent = 'Destroy';
    applyBtn.onclick = function(e) { e.stopPropagation(); confirmDestroy(panelId, isGlobal ? '' : selectedRegion); };
  } else {
    applyBtn.className = 'action-group-btn action-group-apply';
    applyBtn.textContent = 'Apply';
    applyBtn.onclick = function(e) { e.stopPropagation(); doApply(isGlobal ? '' : selectedRegion); };
  }
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
    refreshBtn.title = 'Refresh AWS resources';
    refreshBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M4.93 9A10 10 0 0119.07 9M19.07 15A10 10 0 014.93 15"/></svg>';
    refreshBtn.onclick = function(e) {
      e.stopPropagation();
      showConfirmDialog({
        title: 'Refresh ' + panelId.replace(/_/g, '-') + '?',
        message: 'Are you sure you want to refresh AWS resources?',
        confirmLabel: 'Refresh',
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
  // Sort: minimized sessions first (most recently minimized), then by creation order (newest first)
  var ids = Object.keys(_termSessions);
  ids.sort(function(a, b) {
    var sa = _termSessions[a], sb = _termSessions[b];
    var aMin = sa.minimized ? 1 : 0;
    var bMin = sb.minimized ? 1 : 0;
    if (aMin !== bMin) return bMin - aMin; // minimized first
    if (sa.minimized && sb.minimized) return (sb.minimizedAt || 0) - (sa.minimizedAt || 0);
    return (sb.createdAt || 0) - (sa.createdAt || 0); // most recently run first
  });
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
    var isDestroy = s.command && s.command.indexOf('destroy') !== -1;
    if (s.processRunning) {
      pill.classList.add('running');
      if (isDestroy) {
        pill.style.borderColor = '#ef4444';
        pill.style.color = '#fca5a5';
        icon = '<span class="term-pill-dot running" style="background:#ef4444"></span>';
      } else {
        icon = '<span class="term-pill-dot running"></span>';
      }
    } else if (s.exitCode !== 0) {
      pill.classList.add('error');
      icon = '<span class="term-pill-icon error">&#10007;</span>';
    } else {
      pill.classList.add('done');
      icon = '<span class="term-pill-icon done">&#10003;</span>';
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
  s.minimizedAt = Date.now();
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

function formatSummaryHtml(summary, exitCode, command, sessionId) {
  var icon = exitCode === 0
    ? '<span class="text-green-400">&#10003;</span>'
    : '<span class="text-red-400">&#10007;</span>';
  if (!summary) {
    // Fallback to exit code display
    var elapsed = sessionId && _termSessions[sessionId] ? _termSessions[sessionId].lastElapsed : null;
    if (exitCode === 0) return '<span class="text-green-400">&#10003; ' + (elapsed || 'Done') + '</span>';
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
  var html = icon + ' ' + prefix + parts.join(', ');
  // Add stats button if we have per-module or per-type breakdown
  if (sessionId) {
    var s = _termSessions[sessionId];
    var stats = s && s.stats;
    if (stats && (Object.keys(stats.by_module || {}).length > 1 || Object.keys(stats.by_type || {}).length > 0)) {
      var sa = 0, sc = 0, sd = 0, sm = stats.by_module || {};
      for (var sk in sm) { sa += sm[sk].add || 0; sc += sm[sk].change || 0; sd += sm[sk].destroy || 0; }
      html += ' <button onclick="showStatsPopup(\'' + sessionId + '\')" class="text-sm font-mono text-zinc-400 hover:text-green-400 border border-zinc-600 hover:border-green-600 rounded-md px-4 py-1.5 ml-2 transition-colors">' +
        '<span class="text-zinc-500">[</span>Stats ' +
        '<span class="' + (sa > 0 ? 'text-green-400' : 'text-zinc-600') + '">+' + sa + '</span> ' +
        '<span class="' + (sc > 0 ? 'text-yellow-400' : 'text-zinc-600') + '">~' + sc + '</span> ' +
        '<span class="' + (sd > 0 ? 'text-red-400' : 'text-zinc-600') + '">-' + sd + '</span>' +
        '<span class="text-zinc-500">]</span></button>';
    }
  }
  return html;
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
  var isInfraCmd = /^(plan|apply|destroy|plan-all|apply-all|destroy-all)$/.test(command);

  function doStart(prependLines) {
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
        data._prependLines = prependLines || [];
        showTerminalModal(data);
      });
    }).catch(function(err) {
      showToast('Terminal error: ' + err.message, 5000);
    });
  }

  if (_aggressiveLocks && isInfraCmd) {
    fetch('/api/fix-locks', { method: 'POST' })
      .then(function(resp) { return resp.json(); })
      .then(function(result) {
        var lines = [{text: '>>> Aggressive Mode: clearing all locks before ' + command, cls: 'text-amber-400'}];
        var removed = (result.removed && result.removed.length) || 0;
        var errors = (result.errors && result.errors.length) || 0;
        if (removed > 0) {
          lines.push({text: '>>> Removed ' + removed + ' lock' + (removed > 1 ? 's' : ''), cls: 'text-amber-400'});
        } else if (errors === 0) {
          lines.push({text: '>>> No locks found (clean)', cls: 'text-amber-400'});
        }
        if (errors > 0) {
          result.errors.forEach(function(e) { lines.push({text: '>>> Lock error: ' + e, cls: 'text-red-400'}); });
        }
        lines.push({text: '', cls: ''});
        doStart(lines);
      })
      .catch(function(err) {
        doStart([{text: '>>> Aggressive lock clear failed: ' + err.message, cls: 'text-red-400'}, {text: '', cls: ''}]);
      });
  } else {
    doStart();
  }
}

function showTerminalModal(session) {
  var id = session.id;
  var cmdPrefix = (session.command || '').replace(/-all$/, '');
  var label = cmdPrefix + ' ' + session.module.replace(/_/g, '-');
  if (session.region) label += ' (' + session.region + ')';

  var cmdLine = session.cmd_line || ('terragrunt ' + session.command);

  var overlay = document.createElement('div');
  overlay.className = 'terminal-modal fixed inset-0 z-[60] bg-black/70 flex flex-col p-3 md:p-5';
  overlay.dataset.sessionId = id;
  overlay.innerHTML =
    '<div class="flex-1 flex flex-col bg-zinc-900 rounded-lg border border-zinc-700 shadow-2xl overflow-hidden max-w-[90%] w-full mx-auto">' +
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
          '<button class="term-minimize-btn rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-400 hover:text-zinc-200 text-lg px-3 pt-0.5 pb-1.5 font-mono leading-none" title="Minimize">_</button>' +
          '<button class="term-close-x rounded-md bg-red-900/50 hover:bg-red-800/50 border border-red-700 text-red-300 text-lg px-2" title="Close">&times;</button>' +
        '</div>' +
      '</div>' +
      '<pre class="terminal-output flex-1"></pre>' +
      '<div class="term-footer flex items-center justify-between px-4 py-2 border-t border-zinc-700 bg-zinc-800">' +
        '<div class="flex items-center gap-3">' +
          '<button class="term-live-stats-btn hidden rounded-md border border-zinc-600 hover:border-green-600 text-zinc-400 hover:text-green-400 px-4 py-1.5 text-sm font-mono transition-colors">[Stats]</button>' +
          '<span class="term-footer-status text-sm font-mono text-zinc-400"></span>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<button class="term-stop-btn rounded-md bg-red-900/50 hover:bg-red-800/50 border border-red-700 text-red-300 px-4 py-1.5 text-sm font-mono">Stop</button>' +
          '<button class="term-close-btn hidden rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-4 py-1.5 text-sm font-mono">Close</button>' +
        '</div>' +
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
  var liveStatsBtn = overlay.querySelector('.term-live-stats-btn');

  // Track session
  var sessionState = {
    es: null,
    overlay: overlay,
    minimized: false,
    minimizedAt: 0,
    createdAt: Date.now(),
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

  liveStatsBtn.onclick = function(e) {
    e.stopPropagation();
    showStatsPopup(id);
  };

  function closeModal() {
    if (sessionState.processRunning) {
      showConfirmDialog({
        title: 'Process still running',
        message: 'A terragrunt process is still running. Stop and minimize?',
        confirmLabel: 'Stop & Minimize',
        confirmClass: 'bg-red-600 hover:bg-red-500 text-white',
        onConfirm: function() {
          var body = new URLSearchParams();
          body.append('id', id);
          fetch('/api/terminal/stop', { method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: body.toString() });
          minimizeSession(id);
        }
      });
      return;
    }
    minimizeSession(id);
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
      // Defer to higher-z overlays (stats z-[70], confirm dialogs)
      if (document.querySelector('.fixed.inset-0.z-\\[70\\]')) return;
      if (document.querySelector('.fixed.inset-0.z-\\[60\\]:not(.terminal-modal)')) return;
      e.stopImmediatePropagation();
      minimizeSession(id);
    }
  }
  sessionState.onEsc = onEsc;
  document.addEventListener('keydown', onEsc);

  // Connect SSE — batch lines into a text buffer, flush via rAF
  // Prepend aggressive-lock-clear lines if present
  if (session._prependLines && session._prependLines.length) {
    session._prependLines.forEach(function(entry) {
      if (entry.cls) {
        var span = document.createElement('span');
        span.className = entry.cls;
        span.textContent = entry.text + '\n';
        output.appendChild(span);
      } else {
        output.appendChild(document.createTextNode((entry.text || '') + '\n'));
      }
    });
  }

  var es = new EventSource('/api/terminal/stream?id=' + encodeURIComponent(id));
  sessionState.es = es;

  var _lineBuf = [];
  var _flushPending = false;
  var _hasOutput = session._prependLines && session._prependLines.length > 0;

  // Progress block — collapses "Still creating/modifying/destroying" lines
  var _stillRe = /^\[([^\]]+)\]\s+(\S+):\s+Still\s+(\w+)\.\.\.\s+\[([^\]]+)\s+elapsed\]/;
  var _progMap = {};    // "module|resource" → { module, resource, action, elapsed, count }
  var _progEl = null;   // live-updating DOM element
  var _progLines = 0;   // total "Still..." lines collapsed

  function shortMod(mod) {
    var parts = mod.split('/');
    return parts[parts.length - 1] || mod;
  }

  function renderProgress() {
    if (!_progEl) {
      _progEl = document.createElement('div');
      _progEl.className = 'term-progress-block';
      output.appendChild(_progEl);
    }
    var keys = Object.keys(_progMap).sort();
    if (keys.length === 0) return;

    // Count distinct actions
    var actions = {};
    keys.forEach(function(k) { actions[_progMap[k].action] = true; });
    var actionLabel = Object.keys(actions).join('/');

    var html = '<span class="tp-header">\u23f3 Still ' + escapeHtml(actionLabel) +
      ' ' + keys.length + ' resource' + (keys.length !== 1 ? 's' : '') +
      '... <span class="tp-collapsed">' + _progLines + ' line' + (_progLines !== 1 ? 's' : '') + ' collapsed</span></span>\n';

    keys.forEach(function(k) {
      var p = _progMap[k];
      var acls = p.action === 'creating' ? 'tp-creating' : p.action === 'destroying' ? 'tp-destroying' : 'tp-modifying';
      html += '  <span class="tp-mod">' + escapeHtml(shortMod(p.module)) + '</span> ' +
        escapeHtml(p.resource) + '  <span class="' + acls + '">' + escapeHtml(p.elapsed) + '</span>' +
        (p.count > 1 ? ' <span class="tp-count">\u00d7' + p.count + '</span>' : '') + '\n';
    });

    _progEl.innerHTML = html;
  }

  function freezeProgress() {
    if (!_progEl) return;
    // Leave the frozen block in place, detach tracking
    _progEl.classList.add('tp-frozen');
    _progEl = null;
    _progMap = {};
    _progLines = 0;
  }

  function appendText(text) {
    output.appendChild(document.createTextNode(text));
  }

  function flushLines() {
    _flushPending = false;
    if (_lineBuf.length === 0) return;
    // Remove waiting placeholder on first real output
    if (!_hasOutput) {
      _hasOutput = true;
      var placeholder = output.querySelector('.term-waiting');
      if (placeholder) placeholder.remove();
    }

    var textChunk = [];
    function drainText() {
      if (textChunk.length > 0) {
        appendText(textChunk.join('\n') + '\n');
        textChunk = [];
      }
    }

    for (var i = 0; i < _lineBuf.length; i++) {
      var line = _lineBuf[i];
      var m = _stillRe.exec(line);
      if (m) {
        drainText();
        var key = m[1] + '|' + m[2];
        var prev = _progMap[key];
        _progMap[key] = { module: m[1], resource: m[2], action: m[3], elapsed: m[4], count: (prev ? prev.count : 0) + 1 };
        _progLines++;
        renderProgress();
      } else {
        // Normal line — freeze any active progress block first
        if (_progEl) { drainText(); freezeProgress(); }
        textChunk.push(line);
      }
    }
    drainText();
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
      sessionState.lastElapsed = elapsed;
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

  es.addEventListener('stats', function(e) {
    try {
      sessionState.stats = JSON.parse(e.data);
      // Show live stats button and update its label with running totals
      if (liveStatsBtn) {
        var stats = sessionState.stats;
        if (stats && (Object.keys(stats.by_module || {}).length > 0 || Object.keys(stats.by_type || {}).length > 0)) {
          liveStatsBtn.classList.remove('hidden');
          // Sum totals across all modules
          var a = 0, c = 0, d = 0;
          var mods = stats.by_module || {};
          for (var k in mods) { a += mods[k].add || 0; c += mods[k].change || 0; d += mods[k].destroy || 0; }
          liveStatsBtn.innerHTML = '<span class="text-zinc-500">[</span>Stats ' +
            '<span class="' + (a > 0 ? 'text-green-400' : 'text-zinc-600') + '">+' + a + '</span> ' +
            '<span class="' + (c > 0 ? 'text-yellow-400' : 'text-zinc-600') + '">~' + c + '</span> ' +
            '<span class="' + (d > 0 ? 'text-red-400' : 'text-zinc-600') + '">-' + d + '</span>' +
            '<span class="text-zinc-500">]</span>';
        }
      }
    } catch(err) {}
  });

  es.addEventListener('summary', function(e) {
    try {
      var data = JSON.parse(e.data);
      sessionState.summary = data;
      if (data.stats) sessionState.stats = data.stats;
    } catch(err) {}
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
    if (liveStatsBtn) liveStatsBtn.classList.add('hidden');
    var doneText = exitCode === 0
      ? (sessionState.lastElapsed ? sessionState.lastElapsed : 'Done')
      : 'Failed';
    statusEl.textContent = doneText;
    statusEl.className = 'term-status text-[11px] font-mono ' +
      (exitCode === 0 ? 'text-green-400' : 'text-red-400');
    // Show exit code and close button in footer
    footerStatus.innerHTML = formatSummaryHtml(sessionState.summary, exitCode, sessionState.command, id);
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

    // Auto-refresh discovery after any apply/destroy (partial applies still change state)
    if (sessionState.command && sessionState.command.indexOf('apply') !== -1) {
      // Expand Infrastructure Modules section if hidden so dots are visible
      var infraContainer = document.getElementById('infra-modules');
      if (infraContainer && infraContainer.style.display === 'none') {
        infraContainer.style.display = '';
        var rollBtn = document.getElementById('section-roll-infra');
        if (rollBtn) rollBtn.classList.add('open');
      }
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
    stats: s.stats || null,
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
  overlay.className = 'terminal-modal fixed inset-0 z-[60] bg-black/70 flex flex-col p-3 md:p-5';
  overlay.innerHTML =
    '<div class="flex-1 flex flex-col bg-zinc-900 rounded-lg border border-zinc-700 shadow-2xl overflow-hidden max-w-[90%] w-full mx-auto">' +
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
          '<button class="history-close-x rounded-md bg-red-900/50 hover:bg-red-800/50 border border-red-700 text-red-300 text-lg px-2" title="Close">&times;</button>' +
        '</div>' +
      '</div>' +
      '<pre class="terminal-output flex-1">' + escapeHtml(entry.output) + '</pre>' +
      '<div class="flex items-center justify-between px-4 py-2 border-t border-zinc-700 bg-zinc-800">' +
        '<span class="text-xs font-mono text-zinc-400">' +
          formatSummaryHtml(entry.summary || null, entry.exitCode != null ? entry.exitCode : -1, entry.command, null) +
          (entry.stats && (Object.keys(entry.stats.by_module || {}).length > 1 || Object.keys(entry.stats.by_type || {}).length > 0)
            ? (function() { var ha=0,hc=0,hd=0,hm=entry.stats.by_module||{}; for(var hk in hm){ha+=hm[hk].add||0;hc+=hm[hk].change||0;hd+=hm[hk].destroy||0;} return ' <button class="history-stats-btn text-[10px] font-mono text-zinc-400 hover:text-green-400 border border-zinc-600 hover:border-green-600 rounded px-1.5 py-0.5 ml-2 transition-colors"><span class="text-zinc-500">[</span>Stats <span class="'+(ha>0?'text-green-400':'text-zinc-600')+'">+'+ha+'</span> <span class="'+(hc>0?'text-yellow-400':'text-zinc-600')+'">~'+hc+'</span> <span class="'+(hd>0?'text-red-400':'text-zinc-600')+'">-'+hd+'</span><span class="text-zinc-500">]</span></button>'; })()
            : '') +
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

  var histStatsBtn = overlay.querySelector('.history-stats-btn');
  if (histStatsBtn && entry.stats) {
    histStatsBtn.onclick = function(e) {
      e.stopPropagation();
      showHistoryStatsPopup(entry.stats);
    };
  }

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

// --- Resource Stats Popup ---

function showStatsPopup(sessionId) {
  var s = _termSessions[sessionId];
  var stats = s && s.stats;
  if (!stats) return;

  var overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4';
  overlay.onclick = function(e) { if (e.target === overlay) dismiss(); };

  // Snapshot previous values so we can detect deltas between refreshes
  var prevSnapshot = {};
  function snapshotData(data) {
    var snap = {};
    for (var k in data) {
      snap[k] = { add: data[k].add || 0, change: data[k].change || 0, destroy: data[k].destroy || 0 };
    }
    return snap;
  }
  function hasChanged(key, field, prev, cur) {
    if (!prev[key]) return (cur[key][field] || 0) > 0;
    return (cur[key][field] || 0) !== (prev[key][field] || 0);
  }

  function statCell(val, cls, changed) {
    if (val === 0) return '<td class="px-3 py-1 text-right text-zinc-600">0</td>';
    var flash = changed ? ' stats-flash' : '';
    return '<td class="px-3 py-1 text-right ' + cls + ' font-medium' + flash + '">' + val + '</td>';
  }

  function buildTable(title, data, sortByName, prev) {
    var keys = Object.keys(data);
    if (keys.length === 0) return '';
    if (sortByName) {
      keys.sort();
    } else {
      keys.sort(function(a, b) {
        var ta = (data[a].add || 0) + (data[a].change || 0) + (data[a].destroy || 0);
        var tb = (data[b].add || 0) + (data[b].change || 0) + (data[b].destroy || 0);
        return tb - ta;
      });
    }
    var html = '<h3 class="text-sm font-mono font-bold text-zinc-300 mb-2">' + title + '</h3>';
    html += '<div class="overflow-auto max-h-64"><table class="w-full text-xs font-mono">';
    html += '<thead><tr class="border-b border-zinc-700"><th class="text-left px-3 py-1 text-zinc-400">Name</th><th class="text-right px-3 py-1 text-green-400">+Add</th><th class="text-right px-3 py-1 text-yellow-400">~Chg</th><th class="text-right px-3 py-1 text-red-400">-Del</th></tr></thead><tbody>';
    keys.forEach(function(k) {
      var d = data[k];
      var isNew = prev && !prev[k];
      html += '<tr class="border-b border-zinc-800 hover:bg-zinc-800/50' + (isNew ? ' stats-flash' : '') + '">';
      html += '<td class="px-3 py-1 text-zinc-200 truncate" style="max-width:300px;" title="' + escapeHtml(k) + '">' + escapeHtml(k) + '</td>';
      html += statCell(d.add || 0, 'text-green-400', prev && hasChanged(k, 'add', prev, data));
      html += statCell(d.change || 0, 'text-yellow-400', prev && hasChanged(k, 'change', prev, data));
      html += statCell(d.destroy || 0, 'text-red-400', prev && hasChanged(k, 'destroy', prev, data));
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function renderContent() {
    var curStats = (_termSessions[sessionId] && _termSessions[sessionId].stats) || stats;
    var byMod = curStats.by_module || {};
    var byType = curStats.by_type || {};

    // Aggregate by service
    var byService = {};
    Object.keys(byMod).forEach(function(mod) {
      var parts = mod.replace(/^\.\//, '').split('/');
      var svc = parts[parts.length - 1] || mod;
      if (!byService[svc]) byService[svc] = { add: 0, change: 0, destroy: 0 };
      byService[svc].add += (byMod[mod].add || 0);
      byService[svc].change += (byMod[mod].change || 0);
      byService[svc].destroy += (byMod[mod].destroy || 0);
    });

    var prevMod = prevSnapshot.mod || null;
    var prevType = prevSnapshot.type || null;
    var prevSvc = prevSnapshot.svc || null;

    var content = '';
    if (Object.keys(byService).length > 1) {
      content += buildTable('By Service', byService, true, prevSvc);
      content += '<div class="border-t border-zinc-700 my-4"></div>';
    }
    content += buildTable('By Module', byMod, true, prevMod);
    if (Object.keys(byMod).length > 0 && Object.keys(byType).length > 0) {
      content += '<div class="border-t border-zinc-700 my-4"></div>';
    }
    content += buildTable('By Resource Type', byType, false, prevType);

    // Save snapshot for next interval
    prevSnapshot = { mod: snapshotData(byMod), type: snapshotData(byType), svc: snapshotData(byService) };

    return content;
  }

  var isRunning = s && s.processRunning;

  overlay.innerHTML =
    '<div class="bg-zinc-900 rounded-lg border border-zinc-700 shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">' +
      '<div class="flex items-center justify-between px-4 py-3 border-b border-zinc-700">' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-sm font-mono font-bold text-zinc-200">Resource Stats Breakdown</span>' +
          (isRunning ? '<span class="stats-live-dot"></span>' : '') +
        '</div>' +
        '<button class="stats-close rounded-md bg-red-900/50 hover:bg-red-800/50 border border-red-700 text-red-300 text-lg px-2" title="Close">&times;</button>' +
      '</div>' +
      '<div class="stats-content p-4 overflow-auto flex-1">' + renderContent() + '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  var contentEl = overlay.querySelector('.stats-content');
  var refreshTimer = null;

  // Auto-refresh while process is running
  if (isRunning) {
    refreshTimer = setInterval(function() {
      var cur = _termSessions[sessionId];
      if (!cur || !cur.processRunning) {
        clearInterval(refreshTimer);
        refreshTimer = null;
        var dot = overlay.querySelector('.stats-live-dot');
        if (dot) dot.remove();
        return;
      }
      if (contentEl) contentEl.innerHTML = renderContent();
    }, 5000);
  }

  function dismiss() {
    if (refreshTimer) clearInterval(refreshTimer);
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  overlay.querySelector('.stats-close').onclick = dismiss;

  function onKey(e) {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); dismiss(); }
  }
  document.addEventListener('keydown', onKey);
}

function showHistoryStatsPopup(stats) {
  if (!stats) return;
  // Reuse the same popup logic but with a fake session
  var fakeId = '_history_stats_' + Date.now();
  _termSessions[fakeId] = { stats: stats };
  showStatsPopup(fakeId);
  delete _termSessions[fakeId];
}

// =====================================================
// Output Explorer — browse terragrunt outputs
// =====================================================

function openOutputExplorer() {
  var overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[60] bg-black/70 flex flex-col p-4 md:p-8';
  overlay.innerHTML =
    '<div class="flex-1 flex flex-col bg-zinc-900 rounded-lg border border-zinc-700 shadow-2xl overflow-hidden max-w-4xl w-full mx-auto">' +
      '<div class="flex items-center justify-between px-4 py-2 border-b border-zinc-700 bg-zinc-800">' +
        '<div class="flex items-center gap-2">' +
          '<svg class="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>' +
          '<span class="text-sm font-mono font-bold text-zinc-200">Output Explorer</span>' +
        '</div>' +
        '<button class="output-close-x rounded-md bg-red-900/50 hover:bg-red-800/50 border border-red-700 text-red-300 text-lg px-2" title="Close">&times;</button>' +
      '</div>' +
      '<div class="output-tree flex-1 overflow-auto p-4 font-mono text-sm">' +
        '<div class="text-zinc-500 text-xs">Loading modules...</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  function dismiss() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  overlay.querySelector('.output-close-x').onclick = dismiss;
  overlay.addEventListener('click', function(e) { if (e.target === overlay) dismiss(); });

  function onKey(e) {
    if (e.key === 'Escape') {
      if (document.querySelector('.fixed.inset-0.z-\\[70\\]')) return;
      e.stopImmediatePropagation();
      dismiss();
    }
  }
  document.addEventListener('keydown', onKey);

  // Fetch module list
  fetch('/api/outputs/modules')
    .then(function(resp) { return resp.json(); })
    .then(function(modules) {
      renderOutputTree(overlay.querySelector('.output-tree'), modules);
    })
    .catch(function(err) {
      overlay.querySelector('.output-tree').innerHTML =
        '<div class="text-red-400 text-xs">Failed to load modules: ' + escapeHtml(err.message) + '</div>';
    });
}

function renderOutputTree(container, modules) {
  container.innerHTML = '';

  // Group by category
  var categories = { infra: { global: [], regional: [] }, services: { global: [], regional: [] }, apps: { global: [], regional: [] } };
  modules.forEach(function(m) {
    var cat = categories[m.category || 'infra'];
    if (!cat) cat = categories.infra;
    if (m.global) cat.global.push(m);
    else cat.regional.push(m);
  });

  var regions = (window.ALL_REGIONS || []).map(function(r) { return r.Full || r.full; });
  var catLabels = { infra: 'Infrastructure', services: 'Services', apps: 'Apps' };

  ['infra', 'services', 'apps'].forEach(function(catKey) {
    var cat = categories[catKey];
    if (cat.global.length === 0 && cat.regional.length === 0) return;

    // Category header
    var catHeader = document.createElement('div');
    catHeader.className = 'text-[10px] uppercase tracking-widest text-green-600 font-bold mt-3 mb-1 px-1';
    catHeader.textContent = catLabels[catKey];
    container.appendChild(catHeader);

    // Global modules in this category
    if (cat.global.length > 0) {
      var section = createOutputSection('Global', cat.global, null);
      container.appendChild(section);
    }

    // Regional modules in this category
    if (cat.regional.length > 0) {
      regions.forEach(function(region) {
        var section = createOutputSection(region, cat.regional, region);
        container.appendChild(section);
      });
    }
  });
}

function createOutputSection(title, modules, region) {
  var section = document.createElement('div');
  section.className = 'mb-3';

  var header = document.createElement('div');
  header.className = 'flex items-center gap-2 cursor-pointer py-1 text-zinc-300 hover:text-green-400 transition-colors';
  header.innerHTML =
    '<span class="output-chevron text-[10px]">&#9654;</span>' +
    '<span class="font-bold text-xs uppercase tracking-wider">' + escapeHtml(title) + '</span>' +
    '<span class="text-zinc-600 text-[10px]">(' + modules.length + ')</span>';

  var body = document.createElement('div');
  body.className = 'hidden pl-4 border-l border-zinc-800 ml-1.5';

  modules.forEach(function(mod) {
    var modNode = createOutputModuleNode(mod, region);
    body.appendChild(modNode);
  });

  header.onclick = function() {
    var chevron = header.querySelector('.output-chevron');
    if (body.classList.contains('hidden')) {
      body.classList.remove('hidden');
      chevron.innerHTML = '&#9660;';
    } else {
      body.classList.add('hidden');
      chevron.innerHTML = '&#9654;';
    }
  };

  section.appendChild(header);
  section.appendChild(body);
  return section;
}

function createOutputModuleNode(mod, region) {
  var node = document.createElement('div');
  node.className = 'my-0.5';

  var header = document.createElement('div');
  header.className = 'flex items-center gap-2 cursor-pointer py-1 px-1 rounded hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-colors group';
  var displayName = mod.panel.replace(/_/g, '-');
  header.innerHTML =
    '<span class="output-chevron text-[10px]">&#9654;</span>' +
    '<span class="text-xs">' + escapeHtml(displayName) + '</span>' +
    '<button class="output-refresh hidden group-hover:inline-block text-zinc-600 hover:text-green-400 text-[10px] ml-auto" title="Refresh">&#8635;</button>';

  var body = document.createElement('div');
  body.className = 'hidden pl-4 border-l border-zinc-800/50 ml-1.5';

  var loaded = false;

  function doFetch() {
    body.innerHTML = '<div class="text-zinc-600 text-[10px] py-1">Loading outputs...</div>';
    body.classList.remove('hidden');
    header.querySelector('.output-chevron').innerHTML = '&#9660;';
    fetchModuleOutputs(mod.panel, region, body);
    loaded = true;
  }

  header.onclick = function(e) {
    if (e.target.classList.contains('output-refresh')) return;
    var chevron = header.querySelector('.output-chevron');
    if (body.classList.contains('hidden')) {
      if (!loaded) { doFetch(); return; }
      body.classList.remove('hidden');
      chevron.innerHTML = '&#9660;';
    } else {
      body.classList.add('hidden');
      chevron.innerHTML = '&#9654;';
    }
  };

  var refreshBtn = header.querySelector('.output-refresh');
  if (refreshBtn) {
    refreshBtn.onclick = function(e) {
      e.stopPropagation();
      doFetch();
    };
  }

  node.appendChild(header);
  node.appendChild(body);
  return node;
}

function fetchModuleOutputs(panel, region, container) {
  var url = '/api/outputs?module=' + encodeURIComponent(panel);
  if (region) url += '&region=' + encodeURIComponent(region);

  fetch(url)
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      container.innerHTML = '';
      if (data.error) {
        container.innerHTML = '<div class="text-red-400 text-[11px] py-1">' + escapeHtml(data.error) + '</div>';
        return;
      }
      var outputs = data.outputs || {};
      var keys = Object.keys(outputs);
      if (keys.length === 0) {
        container.innerHTML = '<div class="text-zinc-600 text-[10px] py-1">No outputs defined</div>';
        return;
      }
      keys.sort();
      keys.forEach(function(key) {
        var out = outputs[key];
        var row = document.createElement('div');
        row.className = 'py-0.5 text-[11px]';

        var valPreview = formatOutputValue(out.value);
        var isComplex = out.value !== null && typeof out.value === 'object';

        if (out.sensitive) {
          row.innerHTML =
            '<span class="text-green-400">' + escapeHtml(key) + '</span>' +
            ' <span class="text-zinc-600">=</span> ' +
            '<span class="pii-blur text-zinc-300" onclick="this.classList.toggle(\'pii-revealed\')">(sensitive)</span>';
        } else if (isComplex) {
          var chevron = document.createElement('span');
          chevron.className = 'output-chevron text-[9px] cursor-pointer mr-1';
          chevron.innerHTML = '&#9654;';

          var label = document.createElement('span');
          label.className = 'text-green-400 cursor-pointer';
          label.textContent = key;

          var preview = document.createElement('span');
          preview.className = 'text-zinc-600 ml-1';
          preview.textContent = '= ' + valPreview;

          var detail = document.createElement('pre');
          detail.className = 'hidden text-zinc-400 text-[10px] pl-4 py-1 overflow-x-auto max-h-48 bg-zinc-800/30 rounded mt-0.5 mb-1';
          detail.textContent = JSON.stringify(out.value, null, 2);

          function toggleDetail() {
            if (detail.classList.contains('hidden')) {
              detail.classList.remove('hidden');
              chevron.innerHTML = '&#9660;';
            } else {
              detail.classList.add('hidden');
              chevron.innerHTML = '&#9654;';
            }
          }
          chevron.onclick = toggleDetail;
          label.onclick = toggleDetail;

          row.appendChild(chevron);
          row.appendChild(label);
          row.appendChild(preview);
          row.appendChild(detail);
        } else {
          row.innerHTML =
            '<span class="text-green-400">' + escapeHtml(key) + '</span>' +
            ' <span class="text-zinc-600">=</span> ' +
            '<span class="text-zinc-300">' + escapeHtml(valPreview) + '</span>';
        }

        container.appendChild(row);
      });
    })
    .catch(function(err) {
      container.innerHTML = '<div class="text-red-400 text-[11px] py-1">Error: ' + escapeHtml(err.message) + '</div>';
    });
}

function formatOutputValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return '"' + value + '"';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return '[' + value.length + ' items]';
  if (typeof value === 'object') return '{' + Object.keys(value).length + ' keys}';
  return String(value);
}

// --- Sortable module groups ---
var _sortableGroups = [
  { id: 'core-modules',  key: 'configui-core-order' },
  { id: 'infra-modules', key: 'configui-module-order' },
  { id: 'svc-modules',   key: 'configui-svc-order' },
  { id: 'apps-modules',  key: 'configui-apps-order' }
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
    if (children.length === 0) return;
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

// =====================================================
// WAF Testing (waffaw) — Fleet management, campaigns, log streaming, intel
// =====================================================

var _wafLogEventSource = null;
var _wafLogNodeFilter = 'all';

// Auto-populate UA from target URL when UA hasn't been manually edited
var _wafUAManuallySet = false;
(function() {
  var target = document.getElementById('waf-campaign-target');
  var ua = document.getElementById('waf-campaign-ua');
  if (!target || !ua) return;
  // If UA already has a saved value, mark as manually set
  if (ua.value) _wafUAManuallySet = true;
  ua.addEventListener('input', function() { _wafUAManuallySet = true; });
  target.addEventListener('input', function() {
    if (_wafUAManuallySet) return;
    try {
      var host = new URL(target.value).hostname;
      ua.value = 'WafFAw/1.0 (' + host + ')';
    } catch (e) { /* invalid URL, skip */ }
  });
})();

function switchWaffawTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.waffaw-tab-btn').forEach(function(btn) {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
      btn.classList.remove('border-transparent', 'text-zinc-500', 'dark:text-zinc-400');
      btn.classList.add('border-green-500', 'text-green-600', 'dark:text-green-400');
    } else {
      btn.classList.remove('active');
      btn.classList.remove('border-green-500', 'text-green-600', 'dark:text-green-400');
      btn.classList.add('border-transparent', 'text-zinc-500', 'dark:text-zinc-400');
    }
  });

  // Show/hide tab content (visibility swap — height stays stable)
  document.querySelectorAll('.waffaw-tab-content').forEach(function(el) {
    el.classList.toggle('waffaw-tab-visible', el.dataset.tab === tabName);
  });

  // SSE lifecycle: start log stream when switching to logs tab (keeps running in background)
  if (tabName === 'logs' && !_wafLogEventSource) {
    startWAFLogStream();
  }
}

function checkWaffawImage() {
  var btn = document.getElementById('waf-check-btn');
  var badge = document.getElementById('waffaw-ecr-badge');
  var uri = (document.getElementById('waffaw-image-uri') || {}).value;
  if (!uri) { showToast('No image URI set'); return; }

  if (btn) { btn.disabled = true; btn.classList.add('opacity-50'); }
  if (badge) {
    badge.style.display = '';
    badge.className = 'ecr-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400';
    badge.textContent = '...';
  }

  fetch('/api/waf/check-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'image_uri=' + encodeURIComponent(uri)
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!badge) return;
      if (data.exists) {
        badge.className = 'ecr-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
        badge.innerHTML = '<span class="status-dot ok"></span> ' + data.repo + ':' + data.tag;
      } else {
        badge.className = 'ecr-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
        badge.innerHTML = '<span class="status-dot warning"></span> not found';
      }
    })
    .catch(function(err) {
      if (badge) {
        badge.className = 'ecr-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
        badge.innerHTML = '<span class="status-dot error"></span> error';
      }
      showToast('ECR check failed: ' + err.message, 5000);
    })
    .finally(function() {
      if (btn) { btn.disabled = false; btn.classList.remove('opacity-50'); }
    });
}

// Waffaw IP quota/cost calculator
var wafQuotas = {}; // populated by fetchWafQuotas()

function wafQuotaMin(key) {
  return wafQuotas[key] ? wafQuotas[key].min : 0;
}

function updateWafQuotaBar() {
  var ec2Input = document.querySelector('input[name="waffaw.ec2_count"]');
  var fargateInput = document.querySelector('input[name="waffaw.ecs_desired_count"]');
  if (!ec2Input || !fargateInput) return;

  var ec2Count = parseInt(ec2Input.value, 10) || 0;
  var fargateCount = parseInt(fargateInput.value, 10) || 0;
  var totalIPs = ec2Count + fargateCount;
  var monthlyCost = totalIPs * 0.005 * 24 * 30; // $0.005/hr per IPv4

  var totalEl = document.getElementById('waf-ip-total');
  var eipEl = document.getElementById('waf-eip-count');
  var fargateEl = document.getElementById('waf-fargate-ips');
  var costEl = document.getElementById('waf-ip-cost');
  var warnEl = document.getElementById('waf-eip-warn');

  if (totalEl) totalEl.textContent = totalIPs;
  if (eipEl) eipEl.textContent = ec2Count;
  if (fargateEl) fargateEl.textContent = fargateCount;
  if (costEl) costEl.textContent = '$' + monthlyCost.toFixed(0) + '/mo';

  // EIP warning
  var eipQuota = wafQuotaMin('eip');
  if (warnEl && eipQuota > 0) {
    if (ec2Count > eipQuota) {
      warnEl.classList.remove('hidden');
      warnEl.textContent = 'EIP quota is ' + eipQuota + '/region — request increase via Service Quotas';
    } else {
      warnEl.classList.add('hidden');
    }
  }

  // EC2 instance limit (vCPU quota / vCPUs per instance)
  var ec2LimitEl = document.getElementById('waf-ec2-limit');
  if (ec2LimitEl) {
    var ec2Spot = document.querySelector('input[name="waffaw.ec2_use_spot"]');
    var isSpot = ec2Spot && ec2Spot.checked;
    var vcpuQuota = wafQuotaMin(isSpot ? 'ec2_spot_vcpu' : 'ec2_ondemand_vcpu');
    var ec2TypeSel = document.querySelector('select[name="waffaw.ec2_instance_type"]');
    var ec2Vcpus = 2; // default for t3.medium/t3.large/m5.large
    if (ec2TypeSel) {
      var match = ec2TypeSel.options[ec2TypeSel.selectedIndex].text.match(/(\d+)\s*vCPU/);
      if (match) ec2Vcpus = parseInt(match[1], 10);
    }
    if (vcpuQuota > 0) {
      var maxInstances = Math.floor(vcpuQuota / ec2Vcpus);
      var eipLimit = eipQuota > 0 ? eipQuota : maxInstances;
      var effectiveMax = Math.min(maxInstances, eipLimit);
      ec2LimitEl.textContent = '(max ~' + effectiveMax + ': ' + eipLimit + ' EIP, ' + maxInstances + ' vCPU)';
      if (ec2Count > effectiveMax) ec2LimitEl.className = 'text-amber-400';
      else ec2LimitEl.className = 'text-zinc-600';
    }
  }

  // Fargate task limit (vCPU quota / vCPUs per task)
  var fgLimitEl = document.getElementById('waf-fargate-limit');
  if (fgLimitEl) {
    var fgSpot = document.querySelector('input[name="waffaw.ecs_use_spot"]');
    var isFgSpot = fgSpot && fgSpot.checked;
    var fgVcpuQuota = wafQuotaMin(isFgSpot ? 'fargate_spot_vcpu' : 'fargate_ondemand_vcpu');
    var cpuSel = document.querySelector('select[name="waffaw.ecs_task_cpu"]');
    var taskVcpus = 1;
    if (cpuSel) taskVcpus = parseInt(cpuSel.value, 10) / 1024;
    if (fgVcpuQuota > 0) {
      var maxTasks = Math.floor(fgVcpuQuota / taskVcpus);
      fgLimitEl.textContent = '(max ~' + maxTasks + ' from ' + fgVcpuQuota + ' vCPU quota)';
      if (fargateCount > maxTasks) fgLimitEl.className = 'text-amber-400';
      else fgLimitEl.className = 'text-zinc-600';
    }
  }
}

function fetchWafQuotas() {
  fetch('/api/waf/quota').then(function(r) { return r.json(); }).then(function(data) {
    wafQuotas = data;
    updateWafQuotaBar();
    // Render per-region EIP breakdown
    var container = document.getElementById('waf-region-quotas');
    if (container && data.eip && data.eip.regions) {
      var html = '<span class="text-zinc-400">EIP Quotas:</span>';
      data.eip.regions.forEach(function(rq) {
        var color = rq.error ? 'text-red-400' : (rq.value <= 5 ? 'text-amber-400' : 'text-green-400');
        var label = rq.region.replace(/-\d+$/, '').replace(/-/g, '\u2011');
        html += '<span class="' + color + '">' + label + ' <span class="text-zinc-200">' + rq.value + '</span></span>';
      });
      container.innerHTML = html;
      container.style.display = '';
    }
  }).catch(function() { /* keep defaults */ });
}

// Bind to input changes — recalculate on count, type, cpu, or spot toggle changes
document.addEventListener('input', function(e) {
  if (e.target.name && e.target.name.startsWith('waffaw.')) updateWafQuotaBar();
});
document.addEventListener('change', function(e) {
  if (e.target.name && e.target.name.startsWith('waffaw.')) updateWafQuotaBar();
});

// Initialize on load
document.addEventListener('DOMContentLoaded', function() {
  updateWafQuotaBar();
  fetchWafQuotas();
  // Start log stream immediately so logs accumulate across tab switches and survive reloads
  startWAFLogStream();
});
// Also run after htmx swaps (in case the waffaw tab loads late)
document.addEventListener('htmx:afterSettle', updateWafQuotaBar);

function buildWaffaw() {
  var btn = document.getElementById('waf-build-btn');

  showConfirmDialog({
    title: 'Build & Push Waffaw Image?',
    message: 'This will build the Docker image and push it to ECR. This may take a few minutes.',
    confirmLabel: 'Build',
    confirmClass: 'bg-zinc-600 hover:bg-zinc-500 text-white',
    onConfirm: function() {
      if (btn) { btn.disabled = true; btn.textContent = 'Building...'; }

      // Create terminal modal (same pattern as showTerminalModal)
      var overlay = document.createElement('div');
      overlay.className = 'terminal-modal fixed inset-0 z-[60] bg-black/70 flex flex-col p-3 md:p-5';
      overlay.innerHTML =
        '<div class="flex-1 flex flex-col bg-zinc-900 rounded-lg border border-zinc-700 shadow-2xl overflow-hidden max-w-[90%] w-full mx-auto">' +
          '<div class="flex items-center justify-between px-4 py-2 border-b border-zinc-700 bg-zinc-800">' +
            '<div class="flex flex-col gap-1">' +
              '<div class="flex items-center gap-2">' +
                '<span class="text-green-400 text-sm font-mono font-bold">$ </span>' +
                '<span class="text-sm font-mono text-zinc-200">apps/waffaw/build.sh</span>' +
              '</div>' +
              '<div class="flex items-center gap-3" style="padding-left:1.1rem;">' +
                '<span class="waf-build-status text-[11px] font-mono text-green-400">Starting...</span>' +
                '<span class="waf-build-elapsed text-[11px] font-mono text-zinc-500"></span>' +
              '</div>' +
              '<div class="waf-build-steps flex items-center gap-1" style="padding-left:1.1rem;"></div>' +
            '</div>' +
            '<div class="flex items-center gap-2">' +
              '<button class="waf-build-close-x rounded-md bg-red-900/50 hover:bg-red-800/50 border border-red-700 text-red-300 text-lg px-2" title="Close">&times;</button>' +
            '</div>' +
          '</div>' +
          '<pre class="terminal-output flex-1"></pre>' +
          '<div class="flex items-center justify-end px-4 py-2 border-t border-zinc-700 bg-zinc-800">' +
            '<button class="waf-build-close-btn hidden rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-4 py-1.5 text-sm font-mono">Close</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      var output = overlay.querySelector('.terminal-output');
      var statusEl = overlay.querySelector('.waf-build-status');
      var elapsedEl = overlay.querySelector('.waf-build-elapsed');
      var stepsEl = overlay.querySelector('.waf-build-steps');
      var closeBtn = overlay.querySelector('.waf-build-close-btn');
      var closeX = overlay.querySelector('.waf-build-close-x');
      var running = true;
      var es = null;
      var buildPhase = '';

      // Build step definitions
      var buildSteps = [
        { id: 'ecr-login', label: 'ECR Login' },
        { id: 'docker-build', label: 'Docker Build' },
        { id: 'docker-push', label: 'Push to ECR' },
        { id: 'complete', label: 'Done' }
      ];

      function renderSteps(activePhase) {
        var reached = false;
        var html = '';
        for (var i = 0; i < buildSteps.length; i++) {
          var step = buildSteps[i];
          var isCurrent = step.id === activePhase;
          var isPast = false;
          // All steps before the current one are "past"
          if (!reached && !isCurrent) {
            // Check if the current phase comes after this step
            for (var j = i + 1; j < buildSteps.length; j++) {
              if (buildSteps[j].id === activePhase) { isPast = true; break; }
            }
          }
          if (isCurrent) reached = true;

          var cls = 'build-step';
          if (isPast) cls += ' build-step-done';
          else if (isCurrent) cls += ' build-step-active';
          else cls += ' build-step-pending';

          html += '<span class="' + cls + '">';
          if (isPast) html += '<span class="text-green-400 text-[9px]">&#10003;</span> ';
          else if (isCurrent) html += '<span class="build-step-dot"></span> ';
          html += step.label + '</span>';

          if (i < buildSteps.length - 1) {
            html += '<span class="text-zinc-600 text-[9px]">&#9656;</span>';
          }
        }
        stepsEl.innerHTML = html;
      }

      function formatElapsed(secs) {
        var m = Math.floor(secs / 60);
        var s = secs % 60;
        return m > 0 ? m + 'm ' + s + 's' : s + 's';
      }

      renderSteps('');

      function resetBtn() {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<svg style="width:14px;height:14px;flex-shrink:0;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg> Build &amp; Push';
        }
      }

      function closeModal() {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          e.stopImmediatePropagation();
          if (!running) { closeModal(); return; }
          if (confirm('Build is still running. Close anyway?')) forceClose();
        }
      }
      document.addEventListener('keydown', onKey);

      function forceClose() {
        if (es) { es.close(); es = null; }
        running = false;
        resetBtn();
        closeModal();
      }
      closeX.onclick = function() {
        if (!running) { closeModal(); return; }
        // Build still running — confirm close
        if (confirm('Build is still running. Close anyway?')) forceClose();
      };
      closeBtn.onclick = closeModal;
      overlay.addEventListener('click', function(e) {
        if (e.target !== overlay) return;
        if (!running) { closeModal(); return; }
        if (confirm('Build is still running. Close anyway?')) forceClose();
      });

      es = new EventSource('/api/waf/build');
      es.onmessage = function(e) {
        try {
          var data = JSON.parse(e.data);

          // Tick event — update elapsed timer
          if (data.tick !== undefined) {
            elapsedEl.textContent = formatElapsed(data.tick);
            return;
          }

          // Phase event — update step indicators
          if (data.phase) {
            buildPhase = data.phase;
            renderSteps(buildPhase);
            var phaseLabels = { 'ecr-login': 'Logging into ECR...', 'docker-build': 'Building Docker image...', 'docker-push': 'Pushing to ECR...', 'complete': 'Complete' };
            statusEl.textContent = phaseLabels[data.phase] || data.phase;
            return;
          }

          // Layer summary event — update push progress in-place
          if (data.layers) {
            var lc = data.layers;
            var total = data.total || 0;
            var pushed = (lc['Pushed'] || 0) + (lc['Layer already exists'] || 0) + (lc['Mounted'] || 0);
            var pushing = lc['Pushing'] || 0;
            var waiting = (lc['Waiting'] || 0) + (lc['Preparing'] || 0);

            statusEl.textContent = 'Pushing to ECR... ' + pushed + '/' + total + ' layers';

            // Update or create the layer progress element
            var layerEl = output.querySelector('.build-layer-progress');
            if (!layerEl) {
              layerEl = document.createElement('div');
              layerEl.className = 'build-layer-progress';
              layerEl.style.cssText = 'border-left:2px solid #22c55e; padding-left:8px; margin:4px 0; color:#71717a; font-size:10px; line-height:1.6;';
              output.appendChild(layerEl);
            }
            var pct = total > 0 ? Math.round(pushed / total * 100) : 0;
            var barW = 20;
            var filled = Math.round(barW * pushed / (total || 1));
            var bar = '<span style="color:#22c55e">' + '\u2588'.repeat(filled) + '</span>' +
                      '<span style="color:#3f3f46">' + '\u2588'.repeat(barW - filled) + '</span>';
            var html = '<span style="color:#a1a1aa; font-style:italic;">\u2B06 Pushing ' + total + ' layers to ECR...</span>\n';
            html += '  ' + bar + ' ' + pct + '%\n';
            html += '  <span style="color:#4ade80">\u2713 ' + pushed + ' done</span>';
            if (pushing > 0) html += '  <span style="color:#fbbf24">\u2191 ' + pushing + ' uploading</span>';
            if (waiting > 0) html += '  <span style="color:#52525b">\u23f3 ' + waiting + ' waiting</span>';
            // Show pending layer details when few remain
            var pendingLayers = data.pending || [];
            if (pendingLayers.length > 0 && pendingLayers.length <= 5) {
              html += '\n';
              pendingLayers.forEach(function(pl) {
                var statusColor = pl.status === 'Pushing' ? '#fbbf24' : '#52525b';
                html += '  <span style="color:#52525b">' + escapeHtml(pl.id) + '</span> <span style="color:' + statusColor + '">' + escapeHtml(pl.detail) + '</span>\n';
              });
            }
            layerEl.innerHTML = html;
            output.scrollTop = output.scrollHeight;
            return;
          }

          // Line event — skip if data.line is missing/undefined (not empty string)
          if (data.line === undefined && !data.done) return;

          var line = document.createElement('div');
          line.style.color = data.done ? (data.exit === 0 ? '#4ade80' : '#f87171') : '#a1a1aa';
          line.textContent = data.line || '';
          output.appendChild(line);
          output.scrollTop = output.scrollHeight;

          if (data.image_uri) {
            var uriInput = document.getElementById('waffaw-image-uri');
            if (uriInput) {
              uriInput.value = data.image_uri;
              showToast('Image URI auto-filled');
            }
          }

          if (data.done) {
            es.close();
            running = false;
            resetBtn();
            closeBtn.classList.remove('hidden');
            renderSteps('complete');
            // Freeze the layer progress block if present
            var layerEl = output.querySelector('.build-layer-progress');
            if (layerEl) layerEl.style.borderLeftColor = '#3f3f46';
            if (data.exit === 0) {
              statusEl.textContent = 'Done in ' + formatElapsed(data.elapsed || 0);
              elapsedEl.textContent = '';
              showToast('Build completed successfully');
            } else {
              statusEl.textContent = 'Failed (exit ' + data.exit + ')';
              statusEl.className = statusEl.className.replace('text-green-400', 'text-red-400');
              showToast('Build failed (exit ' + data.exit + ')', 5000);
            }
          }
        } catch(err) {
          // Only show non-empty unparseable lines
          var raw = (e.data || '').trim();
          if (raw && raw.charAt(0) !== '{') {
            var line = document.createElement('div');
            line.style.color = '#a1a1aa';
            line.textContent = raw;
            output.appendChild(line);
          }
        }
      };
      es.addEventListener('error', function() {
        es.close();
        running = false;
        resetBtn();
        closeBtn.classList.remove('hidden');
        statusEl.textContent = 'Connection lost';
        statusEl.className = statusEl.className.replace('text-green-400', 'text-red-400');
      });
    }
  });
}

function sendWAFCommand(targetIP) {
  var script = prompt('Enter shell script to send to ' + (targetIP || 'all nodes') + ':');
  if (!script) return;

  var body = new URLSearchParams();
  body.append('target', targetIP || 'global');
  body.append('script', script);

  fetch('/api/waf/command', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: body.toString()
  }).then(function(resp) {
    return resp.json().then(function(data) {
      if (!resp.ok) {
        showToast('Command error: ' + (data.error || resp.statusText), 5000);
        return;
      }
      showToast('Script uploaded: ' + data.key);
    });
  }).catch(function(err) {
    showToast('Command failed: ' + err.message, 5000);
  });
}

// Open preview pane to the selected campaign template for editing
function editCampaignTemplate() {
  var sel = document.getElementById('waf-campaign-template');
  if (!sel) return;
  var val = sel.value; // e.g. "low-and-slow"
  if (val === 'custom') {
    showToast('Custom templates cannot be edited here', 'warning');
    return;
  }
  var tabId = 'camp-' + val;

  // Open preview pane if not already open
  if (!isPreviewOpen()) {
    showPreview();
    htmx.ajax('POST', '/preview', {
      source: '#config-form',
      target: '#preview-content',
      swap: 'innerHTML'
    }).then(function() {
      switchPreviewCategory('campaigns');
      switchPreviewTab(tabId);
    });
  } else {
    switchPreviewCategory('campaigns');
    switchPreviewTab(tabId);
  }
}

// Save edited campaign template YAML back to disk
function saveCampaignTemplate(tabId) {
  var pre = document.getElementById('pre-' + tabId);
  if (!pre) return;
  var content = pre.innerText;

  fetch('/api/waf/campaign-template', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: 'tab_id=' + encodeURIComponent(tabId) + '&content=' + encodeURIComponent(content)
  }).then(function(r) {
    if (r.ok) {
      showToast('Template saved');
      // Update the data-original so diff tracking resets
      pre.dataset.original = content;
    } else {
      r.text().then(function(t) { showToast('Save failed: ' + t, 'error'); });
    }
  }).catch(function(e) { showToast('Save error: ' + e, 'error'); });
}

function launchWAFCampaign() {
  var templateEl = document.getElementById('waf-campaign-template');
  var loglevelEl = document.getElementById('waf-campaign-loglevel');
  var targetEl = document.getElementById('waf-campaign-target');

  var templateVal = templateEl ? templateEl.value : 'low-and-slow';
  var logLevel = loglevelEl ? loglevelEl.value : 'normal';
  var targetURL = targetEl ? targetEl.value : 'https://defcon.run';

  showConfirmDialog({
    title: 'Launch Campaign?',
    message: 'Start <strong>' + templateVal + '</strong> campaign against <strong>' + escapeHtml(targetURL) + '</strong>.',
    confirmLabel: 'Launch',
    confirmClass: 'bg-green-600 hover:bg-green-500 text-white',
    onConfirm: function() {
      var btn = document.getElementById('waf-launch-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Launching...'; }

      var uaEl = document.getElementById('waf-campaign-ua');
      var hdrKeyEl = document.getElementById('waf-campaign-hdr-key');
      var hdrValEl = document.getElementById('waf-campaign-hdr-val');

      var body = new URLSearchParams();
      body.append('action', 'start');
      body.append('template', templateVal);
      body.append('log_level', logLevel);
      body.append('target_url', targetURL);
      if (uaEl && uaEl.value) body.append('user_agent', uaEl.value);
      if (hdrKeyEl && hdrKeyEl.value) body.append('custom_header_key', hdrKeyEl.value);
      if (hdrValEl && hdrValEl.value) body.append('custom_header_value', hdrValEl.value);

      fetch('/api/waf/campaign', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: body.toString()
      }).then(function(resp) {
        if (btn) { btn.disabled = false; btn.textContent = 'Launch Campaign'; }
        if (!resp.ok) {
          return resp.text().then(function(t) { showToast('Launch error: ' + t, 5000); });
        }
        return resp.json().then(function(data) {
          showToast('Campaign launched: ' + data.campaign);
          updateWAFCampaignStatus('running', data.campaign, new Date().toISOString());
        });
      }).catch(function(err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Launch Campaign'; }
        showToast('Launch failed: ' + err.message, 5000);
      });
    }
  });
}

function haltWAFFleet() {
  showConfirmDialog({
    title: 'Halt Fleet?',
    message: 'This will send a halt signal to all waffaw nodes. Running campaigns will be stopped.',
    confirmLabel: 'Halt Fleet',
    confirmClass: 'bg-red-600 hover:bg-red-500 text-white',
    onConfirm: function() {
      var btn = document.getElementById('waf-halt-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Halting...'; }

      var body = new URLSearchParams();
      body.append('action', 'halt');

      fetch('/api/waf/campaign', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: body.toString()
      }).then(function(resp) {
        return resp.json().then(function(data) {
          if (btn) { btn.disabled = false; btn.textContent = 'Halt Fleet'; }
          if (!resp.ok) {
            showToast('Halt error: ' + (data.error || resp.statusText), 5000);
            return;
          }
          showToast('Fleet halted');
          updateWAFCampaignStatus('halted', '');
        });
      }).catch(function(err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Halt Fleet'; }
        showToast('Halt failed: ' + err.message, 5000);
      });
    }
  });
}

function updateWAFCampaignStatus(status, campaign, startedAt) {
  var dot = document.getElementById('waf-campaign-dot');
  var text = document.getElementById('waf-campaign-text');
  var timeEl = document.getElementById('waf-campaign-time');
  if (!dot || !text) return;

  if (status === 'running') {
    dot.className = 'w-2 h-2 rounded-full bg-green-400 animate-pulse';
    text.className = 'text-sm text-green-400';
    text.textContent = 'Campaign running: ' + campaign;
  } else if (status === 'halted') {
    dot.className = 'w-2 h-2 rounded-full bg-red-400';
    text.className = 'text-sm text-red-400';
    text.textContent = 'Campaign halted';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-zinc-400';
    text.className = 'text-sm text-zinc-400';
    text.textContent = 'No campaign running';
  }

  if (timeEl) {
    if (startedAt) {
      var d = new Date(startedAt);
      timeEl.textContent = 'Started ' + d.toLocaleString();
    } else {
      timeEl.textContent = '';
    }
  }
}

// Fetch campaign state from S3 on load to restore status across reloads
function fetchWAFCampaignState() {
  fetch('/api/waf/campaign-state').then(function(r) { return r.json(); }).then(function(data) {
    if (data.status === 'running' || data.status === 'halted') {
      updateWAFCampaignStatus(data.status, data.campaign || '', data.started_at || '');
    }
  }).catch(function() {});
}
document.addEventListener('DOMContentLoaded', fetchWAFCampaignState);

function startWAFLogStream(clearViewer) {
  stopWAFLogStream(); // Close any existing connection

  var nodeFilter = '';
  var filterEl = document.getElementById('waf-log-node-filter');
  if (filterEl) nodeFilter = filterEl.value;
  _wafLogNodeFilter = nodeFilter;

  var viewer = document.getElementById('waf-log-viewer');
  if (viewer && clearViewer) viewer.innerHTML = '';

  var dot = document.getElementById('waf-log-dot');
  var statusEl = document.getElementById('waf-log-status');
  if (dot) dot.className = 'w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block';
  if (statusEl) statusEl.textContent = 'Connected';

  var url = '/api/waf/logs';
  if (nodeFilter && nodeFilter !== 'all') {
    url += '?node=' + encodeURIComponent(nodeFilter);
  }

  _wafLogEventSource = new EventSource(url);
  var lineCount = 0;
  var lastMsgText = '';
  var lastMsgEl = null;
  var lastMsgCount = 0;

  _wafLogEventSource.onmessage = function(e) {
    if (!viewer) return;
    try {
      var data = JSON.parse(e.data);
      var lineText = data.line || e.data;

      // Extract message without timestamp for dedup comparison
      var msgBody = lineText.replace(/^\d{2}:\d{2}:\d{2}\.\d{3}\s+/, '');

      // Collapse consecutive identical messages
      if (msgBody === lastMsgText && lastMsgEl) {
        lastMsgCount++;
        var badge = lastMsgEl.querySelector('.waf-log-repeat');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'waf-log-repeat';
          badge.style.cssText = 'margin-left:8px;padding:0 5px;border-radius:8px;background:#3f3f46;color:#a1a1aa;font-size:10px;font-style:normal;';
          lastMsgEl.appendChild(badge);
        }
        badge.textContent = '\u00d7' + lastMsgCount;
        return;
      }
      lastMsgText = msgBody;
      lastMsgCount = 1;

      var line = document.createElement('div');
      line.className = 'waf-log-line';

      // Color code by status
      var status = data.status || 0;
      if (data.raw) {
        line.style.color = '#71717a'; // zinc-500 (agent lifecycle)
        line.style.fontStyle = 'italic';
      } else if (status === 403) {
        line.style.color = '#f87171'; // red-400
      } else if (status >= 500) {
        line.style.color = '#fbbf24'; // yellow-400
      } else {
        line.style.color = '#a1a1aa'; // zinc-400
      }

      line.textContent = lineText;
      viewer.appendChild(line);
      lastMsgEl = line;
      lineCount++;

      // Cap displayed lines
      if (lineCount > 2000) {
        var first = viewer.firstChild;
        if (first) viewer.removeChild(first);
      }

      // Auto-scroll if checkbox checked
      var autoScroll = document.getElementById('waf-log-autoscroll');
      if (autoScroll && autoScroll.checked) {
        viewer.scrollTop = viewer.scrollHeight;
      }

      // Update rate display
      var rateEl = document.getElementById('waf-log-rate');
      if (rateEl) rateEl.textContent = lineCount + ' events';

      // Update blocked count
      if (status === 403) {
        var blockedEl = document.getElementById('waf-log-blocked');
        if (blockedEl) {
          var current = parseInt(blockedEl.dataset.blocked || '0', 10);
          current++;
          blockedEl.dataset.blocked = current;
          blockedEl.textContent = current + ' blocked';
        }
      }
    } catch(err) {
      // Plain text fallback
      var line = document.createElement('div');
      line.className = 'waf-log-line';
      line.style.color = '#a1a1aa';
      line.textContent = e.data;
      viewer.appendChild(line);
    }
  };

  _wafLogEventSource.addEventListener('error', function() {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-red-400 inline-block';
    if (statusEl) statusEl.textContent = 'Disconnected';
  });
}

function restartWAFLogStream() {
  startWAFLogStream(true);
}

function stopWAFLogStream() {
  if (_wafLogEventSource) {
    _wafLogEventSource.close();
    _wafLogEventSource = null;
  }
  var dot = document.getElementById('waf-log-dot');
  var statusEl = document.getElementById('waf-log-status');
  if (dot) dot.className = 'w-2 h-2 rounded-full bg-zinc-600 inline-block';
  if (statusEl) statusEl.textContent = 'Disconnected';
}

function runWAFIntel() {
  var btn = document.getElementById('waf-intel-btn');
  var dashboard = document.getElementById('waf-intel-dashboard');
  var timestamp = document.getElementById('waf-intel-timestamp');

  if (btn) { btn.disabled = true; btn.textContent = 'Querying Athena...'; }
  if (dashboard) dashboard.innerHTML = '<div class="text-xs text-zinc-500 py-8 text-center">Running Athena queries...</div>';

  fetch('/api/waf/intel', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: 'campaign='
  }).then(function(resp) {
    return resp.json().then(function(data) {
      if (btn) { btn.disabled = false; btn.textContent = 'Run Analysis'; }
      if (timestamp) timestamp.textContent = new Date().toLocaleTimeString();

      if (!resp.ok) {
        if (dashboard) dashboard.innerHTML = '<div class="text-xs text-red-400 py-4">Query error: ' + escapeHtml(JSON.stringify(data)) + '</div>';
        return;
      }
      renderWAFIntelDashboard(data);
    });
  }).catch(function(err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Run Analysis'; }
    if (dashboard) dashboard.innerHTML = '<div class="text-xs text-red-400 py-4">Failed: ' + escapeHtml(err.message) + '</div>';
  });
}

function renderWAFIntelDashboard(data) {
  var dashboard = document.getElementById('waf-intel-dashboard');
  if (!dashboard) return;
  dashboard.innerHTML = '';

  // Extract summary metrics for cards
  function renderSummaryCards(summaryRows) {
    if (!summaryRows || summaryRows.length < 2) return '';
    var headers = summaryRows[0];
    var row = summaryRows[1]; // First data row

    function findCol(name) {
      for (var i = 0; i < headers.length; i++) {
        if (headers[i].toLowerCase().indexOf(name) >= 0) return row[i] || '0';
      }
      return '0';
    }

    var cards = [
      { label: 'Total Requests', value: findCol('total_requests'), color: 'text-zinc-200' },
      { label: 'Unique IPs', value: findCol('unique_ips'), color: 'text-blue-400' },
      { label: 'Blocked (403)', value: findCol('blocked'), color: 'text-red-400' },
      { label: 'Block Rate', value: findCol('block_rate') + '%', color: 'text-yellow-400' },
      { label: 'Avg Response', value: findCol('avg_response') + 'ms', color: 'text-green-400' },
      { label: 'Duration', value: findCol('duration') + ' min', color: 'text-purple-400' }
    ];

    var html = '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">';
    cards.forEach(function(card) {
      html += '<div class="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-center">';
      html += '<div class="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">' + escapeHtml(card.label) + '</div>';
      html += '<div class="text-lg font-bold font-mono ' + card.color + '">' + escapeHtml(card.value) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderTable(title, rows) {
    if (!rows || rows.length === 0) {
      return '<div class="text-xs text-zinc-500 py-2">' + escapeHtml(title) + ': No data</div>';
    }
    var html = '<div class="mb-4">';
    html += '<h4 class="text-xs uppercase tracking-wide text-green-500 mb-2">' + escapeHtml(title) + '</h4>';
    html += '<div class="overflow-auto"><table class="w-full text-xs font-mono"><thead><tr class="border-b border-zinc-700">';
    var headers = rows[0];
    headers.forEach(function(h) {
      html += '<th class="text-left px-2 py-1 text-zinc-400">' + escapeHtml(h) + '</th>';
    });
    html += '</tr></thead><tbody>';
    for (var i = 1; i < rows.length; i++) {
      var isBlockRow = false;
      rows[i].forEach(function(cell) {
        if (cell && cell.indexOf && cell.indexOf('403') >= 0) isBlockRow = true;
      });
      var rowClass = isBlockRow ? 'border-b border-zinc-800 bg-red-900/10' : 'border-b border-zinc-800 hover:bg-zinc-800/50';
      html += '<tr class="' + rowClass + '">';
      rows[i].forEach(function(cell, idx) {
        var cellClass = 'px-2 py-1 text-zinc-300';
        // Highlight block rate percentages
        if (headers[idx] && headers[idx].toLowerCase().indexOf('block_rate') >= 0) {
          var pct = parseFloat(cell || '0');
          if (pct >= 80) cellClass = 'px-2 py-1 text-red-400 font-bold';
          else if (pct >= 50) cellClass = 'px-2 py-1 text-yellow-400';
          else if (pct > 0) cellClass = 'px-2 py-1 text-green-400';
        }
        html += '<td class="' + cellClass + '">' + escapeHtml(cell || '') + '</td>';
      });
      html += '</tr>';
    }
    html += '</tbody></table></div></div>';
    return html;
  }

  var html = '';
  if (data.summary) html += renderSummaryCards(data.summary);
  if (data.summary) html += renderTable('Campaign Summary', data.summary);
  if (data.detection) html += renderTable('Detection Timeline', data.detection);
  if (data.scenarios) html += renderTable('Scenario Breakdown', data.scenarios);
  if (data.hourly) html += renderTable('Hourly Distribution', data.hourly);
  if (data.correlation) html += renderTable('Node Type Correlation', data.correlation);

  if (html === '') html = '<div class="text-xs text-zinc-500 py-4 text-center">No analytics data available. Run a campaign first.</div>';

  dashboard.innerHTML = html;
}

// Initialize on load
initTheme();
initDestroyMode();
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
