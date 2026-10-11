'use strict';
const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
let deck = window.PREFLIGHT_DECK;
const assetSource = src => deck.assets?.[src] || src;
function showAsset(img, src) {
  // The passcode-protected web app keeps photos encrypted until they are shown.
  if (!window.PREFLIGHT_LOCK) { img.src = assetSource(src); return; }
  window.PREFLIGHT_LOCK.imageUrl(src).then(url => {
    const release = () => URL.revokeObjectURL(url);
    img.addEventListener('load', release, {once: true});
    img.addEventListener('error', release, {once: true});
    img.src = url;
  }, () => { img.alt += ' Could not load this photo.'; });
}
const stage = $('photo-stage');
const labels = $('labels');
const mobileLabels = $('mobile-labels');
const arrows = $('arrow');
const status = $('status');
const hintButton = $('hints');
const hideButton = $('hide');
const notesDialog = $('notes-dialog');
const marksKey = 'preflight-study-marks-v1';
const positionKey = 'preflight-last-slide-v1';
const hintsKey = 'preflight-click-areas-v1';
const labelsKey = 'preflight-show-labels-v1';
const filterKey = 'preflight-slide-filter-v1';
const reviewed = new Set();
const revealed = new Set();
let slides = [];
let sections = [];
let parts = [];
let currentSlide = null;
let currentData = null;
let studyOnly = false;
let itemsOnly = readPreference(filterKey) === 'items';
let shuffled = null;
let loadSequence = 0;
let lastAllSlideId = readPreference(positionKey);
let studyMarks = readMarks();

function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function readMarks() {
  try {
    const values = JSON.parse(localStorage.getItem(marksKey) || '{}');
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value === 'more' || value === 'known'));
  } catch { return {}; }
}
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('theme-text').textContent = dark ? 'Light theme' : 'Dark theme';
  $('theme-icon').textContent = dark ? '☀' : '☾';
  $('theme-toggle').setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#00345e' : '#00467e';
}
applyTheme(document.documentElement.dataset.theme);
$('theme-toggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try { localStorage.setItem('preflight-theme-v1', theme); } catch { /* Works for this visit. */ }
});

function scopeSlides() {
  if (!itemsOnly) return slides;
  return shuffled || slides.filter(slide => slide.preflightItem);
}
function shuffleItems() {
  if (!itemsOnly) {
    status.textContent = 'Shuffle works in Preflight items only. Change Show to Preflight items only first.';
    return;
  }
  const order = slides.filter(slide => slide.preflightItem);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  shuffled = order;
  refreshSlides(filteredSlides()[0]?.id);
  if (currentSlide) status.textContent = `Shuffled ${filteredSlides().length} slides into a new random order. Click a part to reveal its inspection check.`;
}
function filteredSlides() {
  const scope = scopeSlides();
  return studyOnly ? scope.filter(slide => studyMarks[slide.id] === 'more') : scope;
}
function sectionSlides(id) {
  return filteredSlides().filter(slide => slide.sectionId === id);
}
function buildContents() {
  const grouped = new Map();
  slides.forEach(slide => {
    if (!grouped.has(slide.sectionId)) grouped.set(slide.sectionId, {
      id: slide.sectionId, title: slide.sectionTitle, tocTitle: slide.tocTitle || slide.sectionTitle
    });
  });
  sections = [...grouped.values()];
  $('contents').replaceChildren();
  $('section-jump').replaceChildren();
  sections.forEach(section => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toc-link';
    button.dataset.section = section.id;
    const label = document.createElement('span');
    label.className = 'toc-label';
    label.textContent = section.tocTitle;
    const count = document.createElement('span');
    count.className = 'toc-count';
    button.append(label, count);
    button.addEventListener('click', () => jumpToSection(section.id));
    $('contents').append(button);
    const option = document.createElement('option');
    option.value = section.id;
    option.textContent = section.tocTitle;
    $('section-jump').append(option);
  });
  $('deck-count').textContent = `${slides.length} SLIDES`;
}
function updateControls() {
  const available = filteredSlides();
  const scope = scopeSlides();
  setFilterControl();
  $('deck-count').textContent = `${scope.length} SLIDES`;
  const mark = currentSlide ? studyMarks[currentSlide.id] : null;
  $('study-more').disabled = $('know-well').disabled = !currentSlide;
  $('study-more').setAttribute('aria-pressed', String(mark === 'more'));
  $('know-well').setAttribute('aria-pressed', String(mark === 'known'));
  $('study-mark').textContent = !currentSlide ? 'No slide selected' : mark === 'more' ? 'Study more' : mark === 'known' ? 'Know well' : 'Unmarked';
  $('study-count').textContent = scope.filter(slide => studyMarks[slide.id] === 'more').length;
  $('review-study').setAttribute('aria-pressed', String(studyOnly));
  $('all-slides').hidden = !studyOnly;
  const index = available.findIndex(slide => slide.id === currentSlide?.id);
  $('slide-position').textContent = `${index < 0 ? 0 : index + 1} / ${available.length}`;
  $('previous-slide').disabled = index <= 0;
  $('next-slide').disabled = index < 0 || index >= available.length - 1;
  $('contents-caption').textContent = studyOnly ? 'Your Study more slides' : itemsOnly ? (shuffled ? 'Preflight items, shuffled' : 'Preflight inspection items') : 'Aircraft walk-around';
  const shuffleTip = itemsOnly ? (shuffled ? 'Shuffle again for a new random order' : 'Put the preflight items in a random order') : 'Switch Show to Preflight items only to shuffle';
  $('shuffle').setAttribute('aria-disabled', String(!itemsOnly));
  $('shuffle').setAttribute('aria-pressed', String(!!shuffled));
  $('shuffle-wrap').dataset.tooltip = $('shuffle-tip').textContent = shuffleTip;
  sections.forEach(section => {
    const entries = available.filter(slide => slide.sectionId === section.id);
    const position = entries.findIndex(slide => slide.id === currentSlide?.id);
    const button = document.querySelector(`.toc-link[data-section="${section.id}"]`);
    const inScope = scope.some(slide => slide.sectionId === section.id);
    button.hidden = !inScope;
    button.disabled = !entries.length;
    if (position >= 0) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
    button.querySelector('.toc-count').textContent = position >= 0 ? `${position + 1}/${entries.length}` : String(entries.length);
    button.setAttribute('aria-label', `${section.tocTitle}, ${entries.length} ${studyOnly ? 'marked slides' : 'slides'}${position >= 0 ? `, current slide ${position + 1}` : ''}`);
    const option = [...$('section-jump').options].find(item => item.value === section.id);
    option.hidden = !inScope;
    option.disabled = !entries.length;
    option.textContent = `${section.tocTitle} (${entries.length})`;
  });
  const inSection = currentSlide ? sectionSlides(currentSlide.sectionId) : [];
  const sectionIndex = inSection.findIndex(slide => slide.id === currentSlide?.id);
  $('section-position').textContent = currentSlide ? `In this section: ${sectionIndex + 1} of ${inSection.length}` : 'Exit review to continue.';
  $('mobile-section-position').textContent = currentSlide ? `${sectionIndex + 1} / ${inSection.length}` : '0 slides';
  $('section-jump').value = currentSlide?.sectionId || '';
  $('section-jump').disabled = !available.length;
  $('slide-jump').replaceChildren();
  available.forEach(slide => {
    const option = document.createElement('option');
    option.value = slide.id;
    option.textContent = `Slide ${slide.sourceSlide} · ${slide.kind === 'section' ? 'Section overview' : slide.kind === 'reference' ? 'Reference' : 'Practice photo'}`;
    $('slide-jump').append(option);
  });
  $('slide-jump').disabled = !available.length;
  $('slide-jump').value = currentSlide?.id || '';
}
function jumpToSection(id) {
  const next = sectionSlides(id)[0];
  if (next) showSlide(next);
}
function moveSlide(direction) {
  const available = filteredSlides();
  const index = available.findIndex(slide => slide.id === currentSlide?.id);
  if (index >= 0 && available[index + direction]) showSlide(available[index + direction]);
}
function refreshSlides(preferredId = currentSlide?.id) {
  const available = filteredSlides();
  const next = available.find(slide => slide.id === preferredId) || available[0];
  if (next) showSlide(next);
  else showEmptyReview();
}
function changeReviewMode(onlyMore) {
  studyOnly = onlyMore;
  refreshSlides(onlyMore ? currentSlide?.id : lastAllSlideId);
}
function setStudyMark(mark) {
  if (!currentSlide) return;
  const id = currentSlide.id;
  const before = filteredSlides();
  const position = before.findIndex(slide => slide.id === id);
  if (studyMarks[id] === mark) delete studyMarks[id];
  else studyMarks[id] = mark;
  try {
    localStorage.setItem(marksKey, JSON.stringify(studyMarks));
    $('save-note').textContent = 'Study marks saved in this browser.';
  } catch { $('save-note').textContent = 'Study marks last for this visit.'; }
  updateControls();
  if (studyOnly && studyMarks[id] !== 'more') {
    const next = before.slice(position + 1).find(slide => studyMarks[slide.id] === 'more') || filteredSlides()[0];
    if (next) showSlide(next); else showEmptyReview();
  } else status.textContent = studyMarks[id] === 'more'
    ? 'Marked Study more. This slide is in your review list.'
    : studyMarks[id] === 'known'
      ? 'Marked Know well. This slide is out of Study more review.'
      : 'Study mark cleared.';
}
$('study-more').addEventListener('click', () => setStudyMark('more'));
$('know-well').addEventListener('click', () => setStudyMark('known'));
$('review-study').addEventListener('click', () => changeReviewMode(!studyOnly));
$('all-slides').addEventListener('click', () => changeReviewMode(false));
$('browse-slides').addEventListener('click', () => changeReviewMode(false));
function setFilterControl() {
  document.querySelectorAll('input[name="slide-filter"]').forEach(radio => { radio.checked = radio.value === (itemsOnly ? 'items' : 'all'); });
}
setFilterControl();
$('slide-filter').addEventListener('change', event => {
  itemsOnly = event.target.value === 'items';
  shuffled = null;
  try { localStorage.setItem(filterKey, itemsOnly ? 'items' : 'all'); } catch { /* Retain the choice for this visit. */ }
  const available = filteredSlides();
  const preferred = available.find(slide => slide.id === currentSlide?.id)
    || available.find(slide => slide.sourceSlide > (currentSlide?.sourceSlide || 0)) || available[0];
  refreshSlides(preferred?.id);
});
$('shuffle').addEventListener('click', shuffleItems);
$('previous-slide').addEventListener('click', () => moveSlide(-1));
$('next-slide').addEventListener('click', () => moveSlide(1));
$('section-jump').addEventListener('change', event => jumpToSection(event.target.value));
$('slide-jump').addEventListener('change', event => {
  const next = filteredSlides().find(slide => slide.id === event.target.value);
  if (next) showSlide(next);
});

function clearLabels(message) {
  revealed.clear();
  labels.replaceChildren();
  mobileLabels.replaceChildren();
  mobileLabels.hidden = true;
  arrows.replaceChildren();
  document.querySelectorAll('.region').forEach(region => region.setAttribute('aria-pressed', 'false'));
  updateLabelButton();
  if (message) status.textContent = message;
}
function updateLabelButton() {
  const showing = labels.children.length > 0;
  hideButton.disabled = !showing && !parts.length;
  hideButton.setAttribute('aria-pressed', String(showing));
  hideButton.replaceChildren(showing ? 'Hide labels ' : 'Show labels');
  if (showing) {
    const key = document.createElement('kbd');
    key.textContent = 'Esc';
    hideButton.append(key);
  }
}
function saveLabelsPreference(show) {
  try { localStorage.setItem(labelsKey, show ? 'on' : 'off'); } catch { /* Retain the choice during this visit. */ }
}
function showAllLabels() {
  parts.forEach(part => { if (!revealed.has(part.id)) reveal(part); });
  if (parts.length) status.textContent = `${parts.length === 1 ? 'Label' : `All ${parts.length} labels`} shown. Labels stay on for every slide until you hide them.`;
}
function toggleLabels() {
  if (labels.children.length) {
    saveLabelsPreference(false);
    clearLabels(parts.length ? 'All labels hidden. Click a part to reveal its inspection check.' : null);
  } else if (parts.length) {
    saveLabelsPreference(true);
    showAllLabels();
  }
}
function toggleHints(force) {
  const show = force === undefined ? !stage.classList.contains('show-hints') : force;
  stage.classList.toggle('show-hints', show);
  hintButton.setAttribute('aria-pressed', String(show));
  hintButton.textContent = show ? 'Hide click areas' : 'Show click areas';
  try { localStorage.setItem(hintsKey, show ? 'on' : 'off'); } catch { /* Retain the choice during this visit. */ }
}
toggleHints(readPreference(hintsKey) === 'on');
function updateProgress() {
  $('reviewed-count').textContent = reviewed.size;
  $('progress-fill').style.width = `${parts.length ? reviewed.size / parts.length * 100 : 0}%`;
  $('part-progress').classList.toggle('complete', parts.length > 0 && reviewed.size === parts.length);
}
function resetPractice() {
  reviewed.clear();
  updateProgress();
  clearLabels();
}
function sourceParagraphs(lines, target, italicChecks = false) {
  (lines || []).forEach(line => {
    const p = document.createElement('p');
    const check = italicChecks ? line.search(/[-–—]/) : -1;
    if (check >= 0) {
      p.append(document.createTextNode(line.slice(0, check)));
      const em = document.createElement('em');
      em.textContent = line.slice(check);
      p.append(em);
    } else p.textContent = line;
    target.append(p);
  });
}
function place(element, box) {
  const [x, y, w, h] = box || [0, 0, 1, 1];
  Object.assign(element.style, {left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`});
}
function addPhoto(image, index) {
  const layer = document.createElement('div');
  layer.className = 'photo-layer';
  place(layer, image.box);
  if (image.frame) {
    // Center the source picture's frame on its edge without resizing the photo.
    layer.style.outline = `${image.frame.width * 100}cqw solid ${image.frame.color}`;
    layer.style.outlineOffset = `${image.frame.width * -50}cqw`;
  }
  if (image.rotation || image.flipH || image.flipV) {
    layer.style.transform = `rotate(${image.rotation || 0}deg) scale(${image.flipH ? -1 : 1}, ${image.flipV ? -1 : 1})`;
  }
  const photo = document.createElement('img');
  showAsset(photo, image.src);
  photo.alt = `Original training photo ${index + 1}: ${currentSlide.sectionTitle}.`;
  photo.draggable = false;
  const crop = image.crop || {};
  const left = crop.left || 0, top = crop.top || 0;
  const width = 1 - left - (crop.right || 0), height = 1 - top - (crop.bottom || 0);
  Object.assign(photo.style, {left: `${-left / width * 100}%`, top: `${-top / height * 100}%`, width: `${100 / width}%`, height: `${100 / height}%`});
  layer.append(photo);
  $('photo-scene').append(layer);
}
function makeMarker(color) {
  const id = `arrow-tip-${color.replace(/[^a-z0-9]/gi, '')}`;
  if (document.getElementById(id)) return id;
  const marker = document.createElementNS(svgNS, 'marker');
  for (const [name, value] of Object.entries({id, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '4', markerHeight: '4', orient: 'auto-start-reverse'})) marker.setAttribute(name, value);
  const tip = document.createElementNS(svgNS, 'path');
  tip.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  tip.setAttribute('fill', color);
  marker.append(tip);
  $('arrow-defs').append(marker);
  return id;
}
function fitSourceLabel(label, size) {
  label.dataset.fontSize = size;
  let font = size;
  label.style.fontSize = `${font}cqw`;
  if (!label.getClientRects().length) return;
  while (font > .7 && (label.scrollHeight > label.clientHeight + 1 || label.scrollWidth > label.clientWidth + 1)) {
    font -= .1;
    label.style.fontSize = `${font}cqw`;
  }
}
new ResizeObserver(() => {
  labels.querySelectorAll('.source-label').forEach(label => {
    fitSourceLabel(label, Number(label.dataset.fontSize));
  });
}).observe(stage);
function drawConnections(connections, id) {
  connections.forEach(connection => {
    const line = document.createElementNS(svgNS, 'line');
    for (const [name, value] of Object.entries({x1: connection.start[0] * 1000, y1: connection.start[1] * 1000, x2: connection.end[0] * 1000, y2: connection.end[1] * 1000})) line.setAttribute(name, value);
    const color = connection.color || '#ffff00';
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', connection.width ? connection.width * 1000 : 3.125);
    if (connection.head !== false) line.setAttribute('marker-end', `url(#${makeMarker(color)})`);
    if (connection.tail || connection.doubleHeaded) line.setAttribute('marker-start', `url(#${makeMarker(color)})`);
    line.dataset.part = id;
    arrows.append(line);
  });
}
function reveal(part) {
  if (revealed.has(part.id)) {
    status.textContent = 'This label is already visible. Click another part to continue.';
    return;
  }
  revealed.add(part.id);
  reviewed.add(part.id);
  updateProgress();
  const label = document.createElement('div');
  const mobileLabel = document.createElement('div');
  place(label, part.box);
  label.className = `source-label ${part.id}`;
  label.dataset.part = mobileLabel.dataset.part = part.id;
  mobileLabel.className = 'mobile-label';
  label.style.background = mobileLabel.style.background = part.boxColor || '#0070c0';
  label.style.color = mobileLabel.style.color = part.fontColor || '#fff';
  if (part.italic) label.style.fontStyle = mobileLabel.style.fontStyle = 'italic';
  if (part.boxColor === 'transparent') mobileLabel.style.background = '#fff';
  sourceParagraphs(part.lines, label, true);
  sourceParagraphs(part.lines, mobileLabel, true);
  labels.append(label);
  mobileLabels.append(mobileLabel);
  mobileLabels.hidden = false;
  fitSourceLabel(label, part.fontSize ? part.fontSize * 100 : 2.5);
  const connections = part.arrows || (part.arrow ? [part.arrow] : []);
  drawConnections(connections, part.id);
  document.querySelectorAll('.region').forEach(region => region.setAttribute('aria-pressed', String(revealed.has(region.dataset.part))));
  status.textContent = revealed.size === parts.length
    ? `All ${parts.length} revealed. Start over to practice.`
    : `${revealed.size} of ${parts.length} revealed. Click another part.`;
  mobileLabels.style.setProperty('--mobile-label-font', `${parts.length > 6 ? 10 : 12}px`);
  updateLabelButton();
}
function showNotes() {
  $('notes-content').replaceChildren();
  (currentData?.notes || []).forEach((note, index) => {
    sourceParagraphs(typeof note === 'string' ? [note] : note.lines, $('notes-content'));
    if (!note.box || labels.querySelector(`[data-note="${index}"]`)) return;
    const caption = document.createElement('div');
    caption.className = 'source-label source-note';
    caption.dataset.note = index;
    place(caption, note.box);
    caption.style.background = note.boxColor || 'transparent';
    caption.style.color = note.fontColor || '#172b3a';
    sourceParagraphs(note.lines, caption);
    labels.append(caption);
    fitSourceLabel(caption, note.fontSize ? note.fontSize * 100 : 2);
    drawConnections(note.arrows || [], `note-${index}`);
    hideButton.hidden = false;
    updateLabelButton();
    if (note.arrows?.length) $('interaction').removeAttribute('hidden');
  });
  $('notes-title').textContent = `Slide ${currentSlide.sourceSlide} notes`;
  notesDialog.showModal();
}
$('slide-notes').addEventListener('click', showNotes);
$('close-notes').addEventListener('click', () => notesDialog.close());
hintButton.addEventListener('click', () => toggleHints());
hideButton.addEventListener('click', toggleLabels);
$('reset').addEventListener('click', () => {
  saveLabelsPreference(false);
  resetPractice();
  status.textContent = parts.length ? 'Practice reset. All labels are hidden.' : 'Use Next slide or Contents to continue.';
});
document.addEventListener('keydown', event => {
  if (notesDialog.open) return;
  if (event.key === 'Escape') {
    saveLabelsPreference(false);
    clearLabels(parts.length ? 'All labels hidden. Click a part to reveal its inspection check.' : null);
  }
  if (event.target.closest('select, button, input, textarea')) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.toLowerCase() === 'h' && parts.length) { event.preventDefault(); toggleHints(); }
  if (event.key.toLowerCase() === 'l' && parts.length) { event.preventDefault(); toggleLabels(); }
  if (event.key === 'ArrowRight') { event.preventDefault(); moveSlide(1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); moveSlide(-1); }
});
$('interaction').addEventListener('click', event => {
  if (!event.target.closest('.region') && parts.length) status.textContent = 'No labeled component here. Try another part, or use Show click areas for a hint.';
});
function fitReference() {
  const reference = $('reference-content');
  if (reference.hidden) return;
  let font = matchMedia('(max-width: 650px)').matches ? 13 : 15;
  reference.style.fontSize = `${font}px`;
  const frame = $('photo-frame');
  reference.style.setProperty('--reference-height', `${frame.clientHeight}px`);
  const contentHeight = () => {
    const style = getComputedStyle(reference);
    return Math.max(...[...reference.children].map(child => child.getBoundingClientRect().height), 0) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  };
  while (font > 10 && contentHeight() > frame.clientHeight - 2) {
    font -= .5;
    reference.style.fontSize = `${font}px`;
  }
}
new ResizeObserver(fitReference).observe($('photo-frame'));
function displaySlide(data) {
  currentData = data;
  parts = data.parts || [];
  $('parts-total').textContent = parts.length;
  $('photo-frame').style.setProperty('--slide-ratio', (data.width || 16) / (data.height || 9));
  stage.style.background = data.backgroundColor || '#fff';
  $('photo-scene').replaceChildren();
  const images = data.renderedSlide ? [{src: data.renderedSlide, box: [0, 0, 1, 1]}]
    : data.images || (data.photo ? [{src: data.photo, box: [0, 0, 1, 1]}] : []);
  images.forEach(addPhoto);
  const reference = $('reference-content');
  reference.replaceChildren();
  const transcript = $('reference-transcript');
  transcript.replaceChildren();
  transcript.hidden = !data.renderedSlide;
  if (data.renderedSlide) {
    const original = $('photo-scene').querySelector('img');
    original.alt = `Original slide ${data.sourceSlide}: ${data.title}`;
    original.setAttribute('aria-describedby', 'reference-transcript');
    (data.notes || []).forEach(note => sourceParagraphs(typeof note === 'string' ? [note] : note.lines, transcript));
  }
  const showText = !data.renderedSlide && (!images.length || (!parts.length && (data.sourceSlide <= 9 || data.sourceSlide >= 93)));
  document.querySelector('.practice-main').classList.toggle('reference-page', !parts.length);
  reference.hidden = !showText;
  stage.hidden = showText;
  if (showText) {
    const copy = document.createElement('div');
    copy.className = 'reference-copy';
    reference.append(copy);
    (data.notes || []).forEach(note => {
      const block = document.createElement('div');
      block.className = 'reference-block';
      sourceParagraphs(typeof note === 'string' ? [note] : note.lines, block);
      copy.append(block);
    });
    const illustrations = images.filter(image => !image.src.endsWith('/image1.png'));
    if (illustrations.length) {
      const gallery = document.createElement('div');
      gallery.className = 'reference-gallery';
      illustrations.forEach(image => {
        const photo = document.createElement('img');
        showAsset(photo, image.src);
        photo.alt = `Original illustration from slide ${data.sourceSlide}.`;
        gallery.append(photo);
      });
      reference.append(gallery);
    }
    if (!copy.children.length) sourceParagraphs(['This slide has no additional text. Use Next slide to continue.'], copy);
    fitReference();
  }
  const group = $('click-regions');
  group.replaceChildren();
  $('arrow-defs').replaceChildren();
  // Draw broad skin areas first so the component inside them can receive clicks.
  parts.map((part, index) => ({part, index}))
    .sort((a, b) => (a.part.hitPriority || 0) - (b.part.hitPriority || 0))
    .forEach(({part, index}) => {
    const regions = part.regions || (part.region ? [part.region] : []);
    regions.forEach(points => {
      const region = document.createElementNS(svgNS, 'polygon');
      region.setAttribute('points', points.map(point => point.map(n => n * 1000).join(',')).join(' '));
      region.classList.add('region');
      region.dataset.part = part.id;
      region.setAttribute('tabindex', '0');
      region.setAttribute('role', 'button');
      region.setAttribute('aria-label', `Reveal inspection part ${index + 1}`);
      region.setAttribute('aria-pressed', 'false');
      region.addEventListener('click', () => reveal(part));
      region.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); reveal(part); }
      });
      group.append(region);
    });
  });
  $('interaction').setAttribute('aria-label', `Photo with ${parts.length} interactive inspection parts`);
  $('interaction').toggleAttribute('hidden', !parts.length);
  $('part-progress').hidden = !parts.length;
  document.querySelector('.below-photo').hidden = !parts.length;
  hintButton.hidden = hideButton.hidden = $('reset').hidden = !parts.length;
  hintButton.disabled = !parts.length;
  $('slide-notes').hidden = !!data.renderedSlide || showText || !(data.notes || []).length;
}
function showSlide(slide) {
  const sequence = ++loadSequence;
  currentSlide = slide;
  currentData = null;
  parts = [];
  resetPractice();
  if (notesDialog.open) notesDialog.close();
  stage.hidden = true;
  $('reference-transcript').hidden = true;
  $('reference-content').hidden = $('empty-review').hidden = $('load-error').hidden = true;
  $('photo-toolbar').hidden = false;
  $('slide-notes').hidden = true;
  hintButton.disabled = true;
  status.textContent = 'Loading slide…';
  $('slide-title').textContent = slide.kind === 'photo' ? (slide.tocTitle || slide.sectionTitle) : slide.title;
  $('section-name').textContent = `EMB-145 · SECTION ${sections.findIndex(section => section.id === slide.sectionId) + 1} OF ${sections.length}`;
  $('slide-reference').textContent = `Slide ${slide.sourceSlide}`;
  $('slide-kind').textContent = slide.kind === 'section' ? 'Section overview' : slide.kind === 'reference' ? 'Reference' : 'Practice photo';
  updateControls();
  try {
    const data = deck.data[slide.id];
    if (!data) throw new Error('Slide unavailable');
    if (sequence !== loadSequence) return;
    displaySlide(data);
    const isPractice = parts.length > 0;
    $('instructions').textContent = isPractice
      ? 'Name the parts first, then click to check.'
      : slide.kind === 'section' ? 'Section overview. Use Next slide to start the checks.' : 'Original training material. Use Next slide or Contents to continue.';
    status.textContent = isPractice ? 'All labels hidden. Click a part to reveal its inspection check.' : `Slide ${slide.sourceSlide} of ${slides.length}. Choose another slide or section to continue.`;
    updateLabelButton();
    if (isPractice && readPreference(labelsKey) === 'on') showAllLabels();
    if (!studyOnly) {
      lastAllSlideId = slide.id;
      try { localStorage.setItem(positionKey, slide.id); } catch { /* Navigation remains available. */ }
    }
  } catch {
    if (sequence !== loadSequence) return;
    $('load-error').hidden = false;
    status.textContent = 'Could not load this slide. Choose another slide or reload.';
  }
}
function showEmptyReview() {
  loadSequence++;
  currentSlide = currentData = null;
  parts = [];
  document.querySelector('.practice-main').classList.remove('reference-page');
  resetPractice();
  stage.hidden = $('reference-content').hidden = $('load-error').hidden = true;
  $('reference-transcript').hidden = true;
  $('empty-review').hidden = false;
  document.querySelector('.below-photo').hidden = false;
  $('photo-toolbar').hidden = $('part-progress').hidden = true;
  $('slide-title').textContent = 'Study more review';
  $('section-name').textContent = 'EMB-145 · YOUR REVIEW LIST';
  $('instructions').textContent = 'Review only the slides you marked for extra practice.';
  $('empty-review').querySelector('h2').textContent = itemsOnly ? 'No preflight items marked Study more' : 'No slides marked Study more';
  $('empty-review').querySelector('p').textContent = itemsOnly ? 'Exit review and mark a preflight item slide you want to revisit.' : 'Exit review and mark any slide you want to revisit.';
  $('browse-slides').textContent = itemsOnly ? 'Show preflight items' : 'Show all slides';
  status.textContent = 'No matching slides are marked Study more. Exit review to add one.';
  updateControls();
}
function startDeck() {
  try {
    if (!Array.isArray(deck?.slides)) throw new Error('Slide list unavailable');
    slides = deck.slides;
    buildContents();
    refreshSlides(lastAllSlideId || 'slide-14');
  } catch {
    $('load-error').hidden = false;
    status.textContent = 'Could not load the slide list. Please reload the page.';
  }
}
if (window.PREFLIGHT_LOCK) {
  window.PREFLIGHT_LOCK.ready.then(unlocked => { deck = unlocked; startDeck(); }, () => startDeck());
} else startDeck();

// Installed web app: keep every slide on the device. The single-file and folder editions skip this.
function setOfflineStatus(text, action) {
  const note = $('offline-status');
  note.replaceChildren(text);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', action.run);
    note.append(button);
  }
  note.hidden = !text;
}
async function startOfflineApp() {
  if (!/^https?:$/.test(location.protocol) || !('serviceWorker' in navigator)) return;
  const worker = navigator.serviceWorker;
  const updating = () => !!worker.controller;
  let reloading = false, downloadingUpdate = false;
  worker.addEventListener('message', event => {
    const {type, percent} = event.data || {};
    if (type === 'precache-progress') {
      downloadingUpdate = updating();
      setOfflineStatus(`${downloadingUpdate ? 'Downloading update' : 'Saving for offline'}: ${percent}%`);
    }
    if ((type === 'precache-done' || type === 'ready') && !downloadingUpdate) setOfflineStatus('Ready offline');
    if (type === 'precache-failed') setOfflineStatus(updating() ? 'Ready offline · update retries later'
      : 'Offline save paused. It continues next time the app opens online.');
  });
  worker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  let registration;
  try { registration = await worker.register('sw.js'); } catch { return; }
  try { await navigator.storage?.persist?.(); } catch { /* Browser keeps its default storage policy. */ }
  const offerUpdate = waiting => setOfflineStatus('Update ready', {label: 'Reload', run: () => {
    reloading = true;
    waiting.postMessage({type: 'skip-waiting'});
  }});
  const watch = installing => installing.addEventListener('statechange', () => {
    if (installing.state === 'installed' && updating()) offerUpdate(installing);
  });
  if (registration.waiting && updating()) offerUpdate(registration.waiting);
  else if (worker.controller) worker.controller.postMessage({type: 'status'});
  if (registration.installing) watch(registration.installing);
  registration.addEventListener('updatefound', () => watch(registration.installing));
}
startOfflineApp();
