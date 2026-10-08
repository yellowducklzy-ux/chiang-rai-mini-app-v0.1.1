import './styles.css';
import { appConfig } from './config';
import { initLine, isInLineClient, shareApp } from './services/liff';
import { isSupabaseConfigured } from './services/supabase';
import { categoryTitle, createComplaint, getMapIssues, getMyComplaints, getNews, getNotices, getServices } from './services/repository';
import { getChiangRaiWeather } from './services/weather';
import { isAdminConfigured, isAdminLoggedIn, loginAdmin, logoutAdmin } from './services/adminAuth';
import { loadLeaflet } from './services/leaflet';
import type { ComplaintCategory, ComplaintDraft, ComplaintListItem, ComplaintStatus, ManagedMapLayer, NewsItem, NoticeItem, ServiceItem, UserProfile } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;

let profile: UserProfile = { userId: '', displayName: 'ผู้ใช้งาน', isDemo: false };
let lineProfileReady = false;
let services: ServiceItem[] = [];
let news: NewsItem[] = [];
let notices: NoticeItem[] = [];
let myComplaints: ComplaintListItem[] = [];
let complaintLoadState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let complaintLoadError = '';
let leafletMap: any = null;
let mapIssueGroups = new Map<string, any>();
let reportDraft: ComplaintDraft = { category: 'streetlight', subtype: 'ไฟดับ', description: '' };
let reportStep = 1;
const MAP_LAYERS_STORAGE_KEY = 'chiang-rai-managed-map-layers-v1';

function makeId(prefix: string): string {
  const value = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function loadManagedLayers(): ManagedMapLayer[] {
  try {
    const saved = localStorage.getItem(MAP_LAYERS_STORAGE_KEY);
    if (!saved) {
      return [{ id: makeId('layer'), name: 'สถานที่ของฉัน', color: '#ea580c', visible: true, markers: [] }];
    }

    const parsed = JSON.parse(saved) as ManagedMapLayer[];
    if (!Array.isArray(parsed)) throw new Error('Invalid map layers');
    return parsed.filter(layer => layer && typeof layer.id === 'string' && typeof layer.name === 'string').map(layer => ({
      id: layer.id,
      name: layer.name,
      color: /^#[0-9a-f]{6}$/i.test(layer.color) ? layer.color : '#2563eb',
      visible: layer.visible !== false,
      markers: Array.isArray(layer.markers) ? layer.markers.filter(marker =>
        marker && typeof marker.id === 'string' && typeof marker.name === 'string' &&
        Number.isFinite(marker.latitude) && Number.isFinite(marker.longitude)
      ) : []
    }));
  } catch (error) {
    console.warn('Could not read saved map layers:', error);
    return [{ id: makeId('layer'), name: 'สถานที่ของฉัน', color: '#ea580c', visible: true, markers: [] }];
  }
}

function saveManagedLayers(): void {
  localStorage.setItem(MAP_LAYERS_STORAGE_KEY, JSON.stringify(managedLayers));
}

let managedLayers: ManagedMapLayer[] = loadManagedLayers();

const ISSUE_FILTERS_STORAGE_KEY = 'chiang-rai-issue-filters-v1';
const ISSUE_FILTER_DEFS: Array<[ComplaintCategory, string, boolean]> = [
  ['streetlight', 'ไฟสาธารณะ', true],
  ['road', 'ถนนชำรุด', true],
  ['waste', 'จุดทิ้งขยะ', true],
  ['flood', 'จุดเสี่ยงน้ำท่วม', false]
];

function loadIssueFilters(): Record<string, boolean> {
  const defaults = Object.fromEntries(ISSUE_FILTER_DEFS.map(([id, , checked]) => [id, checked]));
  try {
    const saved = localStorage.getItem(ISSUE_FILTERS_STORAGE_KEY);
    if (!saved) return defaults;
    const parsed = JSON.parse(saved) as Record<string, boolean>;
    return { ...defaults, ...parsed };
  } catch (error) {
    console.warn('Could not read saved issue filters:', error);
    return defaults;
  }
}

function saveIssueFilters(): void {
  localStorage.setItem(ISSUE_FILTERS_STORAGE_KEY, JSON.stringify(issueFilters));
}

let issueFilters: Record<string, boolean> = loadIssueFilters();
let pendingMapFocus: { latitude: number; longitude: number } | null = null;

const icons: Record<string, string> = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.8 12 3l9 7.8v9.4a.8.8 0 0 1-.8.8h-5.4v-6.5H9.2V21H3.8a.8.8 0 0 1-.8-.8z"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="m19 13.5 2 1.2-2 3.5-2.1-.8a8 8 0 0 1-2.4 1.4l-.3 2.2h-4l-.3-2.2a8 8 0 0 1-2.4-1.4l-2.1.8-2-3.5 2-1.2a8 8 0 0 1 0-3l-2-1.2 2-3.5 2.1.8a8 8 0 0 1 2.4-1.4L10.2 3h4l.3 2.2a8 8 0 0 1 2.4 1.4l2.1-.8 2 3.5-2 1.2a8 8 0 0 1 0 3Z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="m12 3-9 5 9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>',
  locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M13.5 6.5 17.5 10.5M4 20l4.2-1 10.4-10.4a2.8 2.8 0 0 0-4-4L4.2 15 4 20Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M20 10c0 5.5-8 12-8 12S4 15.5 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24"><path d="M9 5H6.8A1.8 1.8 0 0 0 5 6.8v13.4h14V6.8A1.8 1.8 0 0 0 17.2 5H15"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M8 11h8M8 15h6"/></svg>'
};

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch] ?? ch);
}

function route(): string {
  return location.hash.replace(/^#\/?/, '') || 'home';
}

function go(path: string): void {
  location.hash = `#/${path}`;
}

function nav(active: string): string {
  const items = [
    ['home', 'หน้าหลัก', '🏠'],
    ['services', 'บริการ', '🧩'],
    ['map', 'แผนที่', '🗺️'],
    ['settings', 'ตั้งค่า', '⚙️']
  ];
  return `<nav class="tab-bar">${items.map(([id, label, icon]) => `<button class="tab-item ${active === id ? 'active' : ''}" data-go="${id}"><span>${icon}</span><small>${label}</small></button>`).join('')}</nav>`;
}

function shell(content: string, active = '', options: { title?: string; back?: boolean; noTabs?: boolean } = {}): string {
  const title = options.title
    ? `<header class="ios-nav"><button class="nav-back ${options.back ? '' : 'hidden'}" data-back>${icons.back}</button><strong>${esc(options.title)}</strong><span class="nav-space"></span></header>`
    : '';
  return `<div class="app-shell ${active === 'home' ? 'home' : ''}">${title}<main class="page ${options.title ? 'with-nav' : ''}">${content}</main>${options.noTabs ? '' : nav(active)}</div>`;
}

function serviceIcon(item: ServiceItem): string {
  return `<span class="service-icon" style="--icon-color:${esc(item.color)}">${esc(item.icon)}</span>`;
}

function dashboard(): string {
  const quick = services.slice(0, 6);
  const story = news.slice(0, 4);
  return shell(`
    <section class="dashboard-head">
      <div class="profile-row">
        ${profile.pictureUrl
          ? `<img class="avatar" src="${esc(profile.pictureUrl)}" alt="รูปโปรไฟล์ LINE ของ ${esc(profile.displayName)}" />`
          : '<span class="avatar avatar-fallback" aria-hidden="true">ชร</span>'}
        <div><h1>สวัสดี, ${esc(profile.displayName)}</h1><p>${appConfig.cityName} · ${lineProfileReady ? (profile.isDemo ? 'โหมดทดลอง' : 'บัญชี LINE') : 'กำลังเชื่อมต่อ LINE'}</p></div>
        <button class="circle-button" data-go="notifications" aria-label="การแจ้งเตือน">🔔<span class="badge">3</span></button>
      </div>
      <article class="hero-card">
        <img src="/watch_tower.jpg" alt="หอนาฬิกาเชียงรายยามเย็น" width="627" height="535" />
        <div class="hero-overlay"><span>เทศบาลนครเชียงราย</span><small>เมืองน่าอยู่ สิ่งแวดล้อมดี ชีวิตมีคุณภาพ</small></div>
      </article>
      <article class="weather-card glass">
        <div class="weather-main"><span class="weather-icon" id="weather-icon">🌤️</span><strong id="weather-temp">--°</strong><small id="weather-desc">กำลังโหลด...</small></div>
        <div class="weather-detail"><b>เชียงราย</b><span id="weather-range">↑ --° ↓ --°</span><span id="weather-humidity">ความชื้น --%</span></div>
        <div class="rain"><span>💧</span><small id="weather-rain">ฝน --%</small></div>
      </article>
    </section>
    <section class="content-section"><div class="section-title"><h2>บริการของเรา</h2><button data-go="services">ดูทั้งหมด</button></div>
      <div class="quick-grid">${quick.map(item => `<button class="quick-card" data-service="${esc(item.slug)}">${serviceIcon(item)}<span>${esc(item.title.replace('แจ้งปัญหา', 'แจ้ง'))}</span></button>`).join('')}</div>
    </section>
    <section class="content-section">
      <div class="section-title"><h2>ประกาศสำคัญจากเทศบาล</h2><button type="button" data-go="notices">ดูทั้งหมด</button></div>
      <div class="notice-list">${notices.slice(0, 3).map(item => `<article class="notice-card notice-${item.priority}"><span class="notice-icon">${item.priority === 'urgent' ? '⚠️' : item.priority === 'important' ? '📢' : 'ℹ️'}</span><div class="notice-copy"><strong>${esc(item.title)}</strong><p>${esc(item.summary)}</p><small>${new Date(item.published_at).toLocaleDateString('th-TH', { dateStyle: 'medium' })}</small></div></article>`).join('')}</div>
    </section>
    <section class="content-section"><div class="section-title"><h2>ข่าวสาร & กิจกรรม</h2><button data-go="news">ดูทั้งหมด</button></div>
      <div class="story-strip">${story.map((item, index) => `<article class="story-card story-${(index % 3) + 1}"><span class="story-type">${item.type === 'activity' ? 'กิจกรรม' : 'ข่าวสาร'}</span><div><strong>${esc(item.title)}</strong><small>${new Date(item.published_at).toLocaleDateString('th-TH', { dateStyle: 'medium' })}</small></div></article>`).join('')}</div>
    </section>
    ${lineProfileReady && (profile.isDemo || !isSupabaseConfigured) ? `<div class="demo-banner">โหมดทดลอง: ${profile.isDemo ? 'ยังไม่ได้ตั้งค่า LIFF' : ''}${profile.isDemo && !isSupabaseConfigured ? ' · ' : ''}${!isSupabaseConfigured ? 'ยังไม่ได้ตั้งค่า Supabase' : ''}</div>` : ''}
  `, 'home');
}

function servicesPage(): string {
  return shell(`
    <div class="page-heading"><h1>บริการ</h1></div>
    <label class="search-box"><span>⌕</span><input id="service-search" type="search" placeholder="ค้นหาบริการ..." /></label>
    <section class="list-section"><h3>บริการทั้งหมด</h3><div class="ios-list" id="service-list">
      ${services.map(item => `<button class="ios-list-item" data-service="${esc(item.slug)}" data-search="${esc(`${item.title} ${item.subtitle}`)}">${serviceIcon(item)}<span class="list-copy"><b>${esc(item.title)}</b><small>${esc(item.subtitle)}</small></span><span class="chevron">${icons.chevron}</span></button>`).join('')}
    </div></section>
  `, 'services');
}

function mapPage(): string {
  return shell(`
    <div class="map-page"><div id="map" class="map-canvas"></div>
      <button class="map-fab layers" id="map-filter-btn" aria-label="เลือกประเภทข้อมูลบนแผนที่" aria-expanded="false">${icons.layers}</button>
      <button class="map-fab locate" id="locate-btn" aria-label="ไปยังตำแหน่งของฉัน">${icons.locate}</button>
      <section class="map-sheet map-filter-sheet" id="map-filter-sheet" aria-label="ตัวกรองข้อมูลบนแผนที่" hidden>
        <div class="map-sheet-heading">
          <div><small>ข้อมูลสาธารณะ</small><h2>เลือกประเภทข้อมูล</h2></div>
          <div class="map-sheet-heading-actions"><button class="sheet-close-button" id="map-filter-close" type="button" aria-label="ปิดตัวกรอง">${icons.close}</button></div>
        </div>
        <div class="map-sheet-scroll"><section class="system-layers">
          <h3>แสดงบนแผนที่</h3>
          <div class="system-layer-grid">
            ${ISSUE_FILTER_DEFS.map(([id, label]) => `<label class="system-layer-toggle"><input class="issue-filter" type="checkbox" value="${id}" ${issueFilters[id] ? 'checked' : ''}/><i></i><span>${label}</span></label>`).join('')}
          </div>
          <p class="map-filter-note">ตัวกรองนี้ใช้สำหรับเลือกดูข้อมูลเท่านั้น การเพิ่มหรือแก้ไขข้อมูลจำกัดไว้สำหรับเจ้าหน้าที่</p>
        </section></div>
      </section>
    </div>
  `, 'map');
}

function managedLayerCardsHtml(): string {
  return managedLayers.length
    ? managedLayers.map(layer => `
      <article class="managed-layer-card" style="--layer-color:${esc(layer.color)}">
        <div class="managed-layer-head">
          <label class="layer-visibility">
            <input class="managed-layer-toggle" type="checkbox" value="${esc(layer.id)}" ${layer.visible ? 'checked' : ''}>
            <i aria-hidden="true"></i>
            <span class="layer-color" aria-hidden="true"></span>
            <span class="layer-title"><b>${esc(layer.name)}</b><small>${layer.markers.length} สถานที่</small></span>
          </label>
        </div>
        <div class="layer-actions">
          <button type="button" class="layer-action primary" data-add-marker="${esc(layer.id)}">${icons.pin}<span>เพิ่มสถานที่</span></button>
          <button type="button" class="layer-action" data-edit-layer="${esc(layer.id)}">${icons.edit}<span>แก้ไขชื่อ</span></button>
          <button type="button" class="layer-action danger" data-delete-layer="${esc(layer.id)}">${icons.trash}<span>ลบ</span></button>
        </div>
        ${layer.markers.length ? `<div class="layer-place-list">${layer.markers.map(marker => `
          <div class="layer-place-row">
            <button type="button" class="place-summary" data-focus-marker="${esc(layer.id)}:${esc(marker.id)}">
              <span class="place-dot" aria-hidden="true"></span>
              <span><b>${esc(marker.name)}</b><small>${marker.latitude.toFixed(5)}, ${marker.longitude.toFixed(5)}</small></span>
            </button>
            <button type="button" class="icon-action" data-edit-marker="${esc(layer.id)}:${esc(marker.id)}" aria-label="แก้ไข ${esc(marker.name)}">${icons.edit}</button>
            <button type="button" class="icon-action danger" data-delete-marker="${esc(layer.id)}:${esc(marker.id)}" aria-label="ลบ ${esc(marker.name)}">${icons.trash}</button>
          </div>`).join('')}</div>` : '<p class="layer-empty">ยังไม่มีสถานที่ในเลเยอร์นี้</p>'}
      </article>`).join('')
    : '<div class="map-empty-state"><b>ยังไม่มีเลเยอร์ส่วนตัว</b><span>สร้างเลเยอร์เพื่อเริ่มเพิ่มสถานที่ลงบนแผนที่</span></div>';
}

function staffPage(): string {
  if (!isAdminLoggedIn()) {
    return shell(`
      <section class="staff-intro"><span class="staff-shield">🛡️</span><h1>ระบบเจ้าหน้าที่</h1><p>ทางเข้านี้แยกจากบริการประชาชน ใช้สำหรับจัดการเลเยอร์ส่วนตัวบนอุปกรณ์นี้เท่านั้น</p></section>
      <section class="settings-group"><h3>เข้าสู่ระบบ</h3><div class="ios-list">
        <form id="admin-login-form" class="dialog-form" style="padding:14px">
          ${isAdminConfigured() ? '<p class="form-helper">การตรวจรหัสผ่านนี้ป้องกันเฉพาะการแก้ไขข้อมูล localStorage บนอุปกรณ์ ไม่ใช่สิทธิ์เข้าถึงข้อมูลฐานข้อมูล</p>' : '<p class="form-helper">โหมดทดลอง: ยังไม่ได้ตั้งค่ารหัสผ่านเจ้าหน้าที่ (VITE_ADMIN_PASSWORD_HASH) กด “เข้าสู่ระบบ” เพื่อทดสอบได้ทันที</p>'}
          <label><span>รหัสผ่านผู้ดูแล</span><input id="admin-password" type="password" autocomplete="current-password" placeholder="กรอกรหัสผ่าน"></label>
          <div class="dialog-actions"><button type="submit" class="dialog-primary">เข้าสู่ระบบ</button></div>
        </form>
      </div></section>`, '', { title: 'สำหรับเจ้าหน้าที่', back: true, noTabs: true });
  }
  return shell(`
    <section class="staff-intro compact"><span class="staff-shield">🛡️</span><div><h1>จัดการข้อมูลแผนที่</h1><p>เลเยอร์ส่วนตัวบนอุปกรณ์นี้</p></div></section>
    <section class="settings-group"><h3>ผู้ดูแลระบบ</h3><div class="ios-list">
      <div class="ios-list-item"><span class="setting-icon blue">✓</span><span class="list-copy"><b>เข้าสู่ระบบผู้ดูแลแล้ว</b><small>จัดการเลเยอร์และหมุดบนอุปกรณ์นี้ได้</small></span></div>
      <button class="ios-list-item" id="admin-logout-btn"><span class="setting-icon gray">⎋</span><span class="list-copy"><b>ออกจากระบบผู้ดูแล</b></span></button>
    </div></section>
    <section class="settings-group">
      <div class="subsection-title" style="margin:22px 14px 8px"><h3 style="margin:0">เลเยอร์ของฉันบนแผนที่</h3><button class="add-layer-button" id="add-layer-btn" type="button">${icons.plus}<span>เพิ่มเลเยอร์</span></button></div>
      ${managedLayerCardsHtml()}
    </section>
    <p class="page-note">ข้อมูลส่วนนี้เก็บใน localStorage และการตรวจรหัสผ่านทำงานฝั่งเบราว์เซอร์เท่านั้น ข้อมูลจริงบน Supabase ต้องตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์</p>
  `, '', { title: 'สำหรับเจ้าหน้าที่', back: true, noTabs: true });
}

function openAppDialog(title: string, content: string): HTMLDialogElement {
  document.querySelector<HTMLDialogElement>('.app-dialog')?.close();
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog';
  dialog.setAttribute('aria-label', title);
  dialog.innerHTML = `<div class="dialog-card"><div class="dialog-heading"><h2>${esc(title)}</h2><button type="button" data-close-dialog aria-label="ปิด">${icons.close}</button></div>${content}</div>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.querySelector('[data-close-dialog]')?.addEventListener('click', () => dialog.close());
  dialog.showModal();
  requestAnimationFrame(() => dialog.querySelector<HTMLElement>('input, textarea, button')?.focus());
  return dialog;
}

function openLayerDialog(layerId?: string): void {
  const layer = managedLayers.find(item => item.id === layerId);
  const dialog = openAppDialog(layer ? 'แก้ไขเลเยอร์' : 'เพิ่มเลเยอร์', `
    <form id="layer-form" class="dialog-form">
      <label><span>ชื่อเลเยอร์ <b aria-hidden="true">*</b></span><input id="layer-name" name="name" required maxlength="60" value="${esc(layer?.name || '')}" autocomplete="off"></label>
      <label><span>สีของหมุด</span><input id="layer-color" class="color-input" name="color" type="color" value="${esc(layer?.color || '#2563eb')}"></label>
      <div class="dialog-actions"><button type="button" class="dialog-secondary" data-close-dialog-footer>ยกเลิก</button><button type="submit" class="dialog-primary">${layer ? 'บันทึกการแก้ไข' : 'สร้างเลเยอร์'}</button></div>
    </form>`);
  dialog.querySelector('[data-close-dialog-footer]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector<HTMLFormElement>('#layer-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const name = dialog.querySelector<HTMLInputElement>('#layer-name')?.value.trim() || '';
    const color = dialog.querySelector<HTMLInputElement>('#layer-color')?.value || '#2563eb';
    if (!name) return;
    if (layer) {
      layer.name = name;
      layer.color = color;
    } else {
      managedLayers.push({ id: makeId('layer'), name, color, visible: true, markers: [] });
    }
    saveManagedLayers();
    dialog.close();
    toast(layer ? 'แก้ไขเลเยอร์แล้ว' : 'สร้างเลเยอร์แล้ว');
    void render();
  });
}

function openMarkerDialog(layerId: string, markerId?: string): void {
  const layer = managedLayers.find(item => item.id === layerId);
  const marker = layer?.markers.find(item => item.id === markerId);
  if (!layer) return toast('ไม่พบเลเยอร์ที่เลือก');

  const dialog = openAppDialog(marker ? 'แก้ไขสถานที่' : 'เพิ่มสถานที่', `
    <form id="marker-form" class="dialog-form">
      <p class="dialog-context"><span class="layer-color" style="--layer-color:${esc(layer.color)}" aria-hidden="true"></span>เลเยอร์: <b>${esc(layer.name)}</b></p>
      <label><span>ชื่อสถานที่ <b aria-hidden="true">*</b></span><input id="marker-name" required maxlength="80" value="${esc(marker?.name || '')}" autocomplete="off"></label>
      <label><span>ข้อมูลเพิ่มเติม</span><textarea id="marker-info" maxlength="500" rows="3" placeholder="รายละเอียด เวลาเปิดทำการ หรือข้อมูลติดต่อ">${esc(marker?.info || '')}</textarea></label>
      <div class="coordinate-fields">
        <label><span>ละติจูด <b aria-hidden="true">*</b></span><input id="marker-latitude" type="number" inputmode="decimal" min="-90" max="90" step="any" required value="${marker ? marker.latitude : ''}" placeholder="19.9072"></label>
        <label><span>ลองจิจูด <b aria-hidden="true">*</b></span><input id="marker-longitude" type="number" inputmode="decimal" min="-180" max="180" step="any" required value="${marker ? marker.longitude : ''}" placeholder="99.8326"></label>
      </div>
      <div class="coordinate-tools"><button type="button" id="use-map-center">ใช้จุดกึ่งกลางแผนที่</button><button type="button" id="use-current-location">ใช้ตำแหน่งปัจจุบัน</button></div>
      <p class="form-helper" id="coordinate-status" aria-live="polite">กรอกพิกัดด้วยเลขทศนิยม เช่น 19.9072, 99.8326</p>
      <div class="dialog-actions"><button type="button" class="dialog-secondary" data-close-dialog-footer>ยกเลิก</button><button type="submit" class="dialog-primary">${marker ? 'บันทึกการแก้ไข' : 'เพิ่มหมุด'}</button></div>
    </form>`);

  const setCoordinates = (latitude: number, longitude: number, message: string) => {
    const latitudeInput = dialog.querySelector<HTMLInputElement>('#marker-latitude');
    const longitudeInput = dialog.querySelector<HTMLInputElement>('#marker-longitude');
    if (latitudeInput) latitudeInput.value = latitude.toFixed(6);
    if (longitudeInput) longitudeInput.value = longitude.toFixed(6);
    const status = dialog.querySelector('#coordinate-status');
    if (status) status.textContent = message;
  };

  dialog.querySelector('[data-close-dialog-footer]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('#use-map-center')?.addEventListener('click', () => {
    const center = leafletMap?.getCenter();
    if (center) setCoordinates(center.lat, center.lng, 'ใช้พิกัดจากจุดกึ่งกลางแผนที่แล้ว');
  });
  dialog.querySelector('#use-current-location')?.addEventListener('click', () => {
    const status = dialog.querySelector('#coordinate-status');
    if (!navigator.geolocation) {
      if (status) status.textContent = 'อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง';
      return;
    }
    if (status) status.textContent = 'กำลังค้นหาตำแหน่งปัจจุบัน...';
    navigator.geolocation.getCurrentPosition(
      position => setCoordinates(position.coords.latitude, position.coords.longitude, 'ใช้ตำแหน่งปัจจุบันแล้ว'),
      () => { if (status) status.textContent = 'ไม่สามารถอ่านตำแหน่งได้ กรุณาตรวจสอบสิทธิ์การเข้าถึง'; },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });
  dialog.querySelector<HTMLFormElement>('#marker-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const name = dialog.querySelector<HTMLInputElement>('#marker-name')?.value.trim() || '';
    const info = dialog.querySelector<HTMLTextAreaElement>('#marker-info')?.value.trim() || '';
    const latitude = Number(dialog.querySelector<HTMLInputElement>('#marker-latitude')?.value);
    const longitude = Number(dialog.querySelector<HTMLInputElement>('#marker-longitude')?.value);
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return toast('กรุณากรอกชื่อและพิกัดให้ถูกต้อง');
    }
    if (marker) {
      Object.assign(marker, { name, info, latitude, longitude });
    } else {
      layer.markers.push({ id: makeId('marker'), name, info, latitude, longitude });
    }
    layer.visible = true;
    saveManagedLayers();
    dialog.close();
    toast(marker ? 'แก้ไขสถานที่แล้ว' : 'เพิ่มสถานที่บนแผนที่แล้ว');
    void render();
  });
}

function splitLayerMarkerKey(value: string): [string, string] {
  const separator = value.indexOf(':');
  return separator < 0 ? [value, ''] : [value.slice(0, separator), value.slice(separator + 1)];
}

function settingsPage(): string {
  const notificationPrefs = loadNotificationPrefs();
  return shell(`
    <div class="page-heading"><h1>ตั้งค่า</h1></div>
    <section class="settings-group"><h3>การแจ้งเตือน</h3><div class="ios-list">
      <label class="ios-list-item"><span class="setting-icon green">🔔</span><span class="list-copy"><b>เปิด/ปิดการแจ้งเตือน</b></span><input class="switch" id="notification-toggle" type="checkbox" ${notificationPrefs.enabled ? 'checked' : ''}><i></i></label>
      <button class="ios-list-item" data-go="notifications"><span class="setting-icon red">●</span><span class="list-copy"><b>ประเภทการแจ้งเตือน</b></span><span class="chevron">${icons.chevron}</span></button>
    </div></section>
    <section class="settings-group"><h3>การแสดงผล</h3><div class="ios-list">
      <label class="ios-list-item"><span class="setting-icon gray">🌙</span><span class="list-copy"><b>โหมดมืด</b></span><input class="switch" id="dark-toggle" type="checkbox"><i></i></label>
    </div></section>
    <section class="settings-group"><h3>บัญชี</h3><div class="ios-list">
      <button class="ios-list-item" data-go="profile"><span class="setting-icon blue">👤</span><span class="list-copy"><b>ข้อมูลส่วนตัว</b><small>${esc(profile.displayName)}</small></span><span class="chevron">${icons.chevron}</span></button>
      <button class="ios-list-item" data-go="requests"><span class="setting-icon green">✓</span><span class="list-copy"><b>ติดตามคำร้อง</b><small>ดูสถานะและประวัติของฉัน</small></span><span class="chevron">${icons.chevron}</span></button>
      <button class="ios-list-item" id="share-btn"><span class="setting-icon cyan">↗</span><span class="list-copy"><b>แชร์แอป</b><small>${isInLineClient() ? 'ส่งให้เพื่อนใน LINE' : 'คัดลอกลิงก์'}</small></span><span class="chevron">${icons.chevron}</span></button>
    </div></section>
    <section class="settings-group"><h3>เกี่ยวกับ</h3><div class="ios-list">
      <button class="ios-list-item" data-go="about"><span class="list-copy"><b>เกี่ยวกับแอป</b></span><span class="chevron">${icons.chevron}</span></button>
      <button class="ios-list-item" data-go="privacy"><span class="list-copy"><b>นโยบายความเป็นส่วนตัว</b></span><span class="chevron">${icons.chevron}</span></button>
      <div class="ios-list-item"><span class="list-copy"><b>เวอร์ชัน</b></span><small>1.0.0</small></div>
    </div></section>
  `, 'settings');
}

type InformationService = 'information' | 'health';

function serviceInformationPage(service: InformationService): string {
  const isHealth = service === 'health';
  const title = isHealth ? 'บริการสุขภาพ' : 'ขอข้อมูลข่าวสาร';
  const unit = isHealth ? 'กองสาธารณสุขและสิ่งแวดล้อม / กองการแพทย์' : 'ศูนย์ข้อมูลข่าวสารเทศบาลนครเชียงราย';
  const description = isHealth
    ? 'ตรวจสอบข้อมูลบริการส่งเสริมสุขภาพ ป้องกันโรค การแพทย์ และสาธารณสุขที่เทศบาลให้บริการ ก่อนเดินทางหรือยื่นเรื่อง'
    : 'ตรวจสอบข้อมูล เอกสารที่เปิดเผย และขั้นตอนการขอข้อมูลข่าวสารกับหน่วยงานเจ้าของข้อมูลก่อนยื่นคำขอ';
  return shell(`
    <article class="service-info-hero"><span>${isHealth ? '🏥' : '📄'}</span><small>ข้อมูลบริการและช่องทางติดต่อ</small><h1>${title}</h1><p>${description}</p></article>
    <section class="service-info-section"><h2>หน่วยงานที่ให้บริการ</h2><div class="contact-card"><b>${unit}</b><p>กรุณาติดต่อเจ้าหน้าที่เพื่อยืนยันบริการ เอกสารที่ต้องใช้ ผู้รับผิดชอบ และเวลารับเรื่องก่อนดำเนินการ</p></div></section>
    <section class="service-info-section"><h2>ช่องทางติดต่อ</h2><div class="contact-actions">
      ${isHealth ? '<a class="contact-action primary" href="tel:053711333"><b>กองสาธารณสุขฯ</b><small>053 711 333 ต่อ 404</small></a><a class="contact-action" href="tel:053727189"><b>กองการแพทย์</b><small>053 727 189</small></a>' : '<a class="contact-action primary" href="tel:053711333"><b>โทรศัพท์กลางเทศบาล</b><small>053 711 333</small></a>'}
      <a class="contact-action" href="https://www.chiangraicity.go.th/frontpage" target="_blank" rel="noopener noreferrer"><b>เว็บไซต์เทศบาล</b><small>ดูข้อมูลทางการและศูนย์ข้อมูลข่าวสาร</small></a>
    </div><p class="page-note">หน้านี้ยังไม่รับคำร้องออนไลน์ จนกว่าจะกำหนดขั้นตอนรับเรื่อง ผู้รับผิดชอบ และการติดตามสถานะอย่างชัดเจน</p></section>
  `, '', { title, back: true, noTabs: true });
}

type NotificationPrefs = { enabled: boolean; complaints: boolean; notices: boolean; news: boolean };
const NOTIFICATION_PREFS_KEY = 'chiang-rai-notification-prefs-v1';

function loadNotificationPrefs(): NotificationPrefs {
  const defaults = { enabled: true, complaints: true, notices: true, news: false };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(NOTIFICATION_PREFS_KEY) || '{}') }; }
  catch { return defaults; }
}

function saveNotificationPrefs(prefs: NotificationPrefs): void {
  localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(prefs));
}

function noticesPage(): string {
  return shell(`<section class="detail-list">${notices.length ? notices.map(item => `
    <article class="detail-card notice-${item.priority}"><small>${new Date(item.published_at).toLocaleDateString('th-TH', { dateStyle: 'long' })}</small><h2>${esc(item.title)}</h2><p>${esc(item.summary)}</p></article>`).join('') : '<div class="empty-state">ยังไม่มีประกาศในขณะนี้</div>'}</section>`, '', { title: 'ประกาศทั้งหมด', back: true, noTabs: true });
}

function newsPage(): string {
  return shell(`<section class="detail-list">${news.length ? news.map(item => `
    <article class="detail-card"><span class="story-type">${item.type === 'activity' ? 'กิจกรรม' : 'ข่าวสาร'}</span><h2>${esc(item.title)}</h2><p>${esc(item.excerpt)}</p><small>${new Date(item.published_at).toLocaleDateString('th-TH', { dateStyle: 'long' })}</small></article>`).join('') : '<div class="empty-state">ยังไม่มีข่าวสารในขณะนี้</div>'}</section>`, '', { title: 'ข่าวสารและกิจกรรม', back: true, noTabs: true });
}

function profilePage(): string {
  return shell(`<section class="profile-detail">
    ${profile.pictureUrl ? `<img src="${esc(profile.pictureUrl)}" alt="รูปโปรไฟล์ LINE ของ ${esc(profile.displayName)}">` : '<span class="avatar avatar-fallback">ชร</span>'}
    <h1>${esc(profile.displayName)}</h1><p>${profile.isDemo ? 'โหมดทดลอง — ยังไม่ได้เชื่อมบัญชี LINE' : 'ยืนยันตัวตนด้วยบัญชี LINE แล้ว'}</p>
    ${profile.statusMessage ? `<blockquote>${esc(profile.statusMessage)}</blockquote>` : ''}
  </section>`, '', { title: 'ข้อมูลส่วนตัว', back: true, noTabs: true });
}

function notificationsPage(): string {
  const prefs = loadNotificationPrefs();
  return shell(`<section class="settings-group"><h3>การแจ้งเตือนที่ต้องการรับ</h3><div class="ios-list">
    ${([['complaints', 'สถานะคำร้อง', 'ความคืบหน้าและผลดำเนินการ'], ['notices', 'ประกาศสำคัญ', 'ประกาศเร่งด่วนจากเทศบาล'], ['news', 'ข่าวสารและกิจกรรม', 'กิจกรรมและข่าวประชาสัมพันธ์']] as const).map(([key, title, detail]) => `<label class="ios-list-item"><span class="list-copy"><b>${title}</b><small>${detail}</small></span><input class="switch notification-pref" data-pref="${key}" type="checkbox" ${prefs[key] ? 'checked' : ''} ${prefs.enabled ? '' : 'disabled'}><i></i></label>`).join('')}
  </div><p class="page-note">ค่าที่เลือกจะถูกเก็บในอุปกรณ์นี้ และพร้อมใช้เมื่อเชื่อมระบบส่งข้อความแจ้งเตือนของเทศบาล</p></section>`, '', { title: 'การแจ้งเตือน', back: true, noTabs: true });
}

function aboutPage(): string {
  return shell(`<article class="legal-page"><h1>บริการเทศบาลนครเชียงราย</h1><p>LINE Mini App สำหรับเข้าถึงบริการประชาชน แจ้งปัญหา ติดตามสถานะ ดูประกาศ ข่าวสาร และข้อมูลบนแผนที่ได้จากโทรศัพท์</p><h2>เวอร์ชัน</h2><p>1.0.0</p><h2>การช่วยเหลือ</h2><p>หากพบปัญหาในการใช้งาน โปรดติดต่อเทศบาลผ่านช่องทางราชการที่ประกาศไว้</p></article>`, '', { title: 'เกี่ยวกับแอป', back: true, noTabs: true });
}

function privacyPage(): string {
  return shell(`<article class="legal-page"><h1>นโยบายความเป็นส่วนตัว</h1><p>ระบบใช้ LINE user ID และชื่อโปรไฟล์เพื่อยืนยันเจ้าของคำร้องและแสดงประวัติของผู้ใช้คนนั้นเท่านั้น</p><h2>ข้อมูลที่จัดเก็บ</h2><p>ประเภทและรายละเอียดคำร้อง พิกัดที่ผู้ใช้อนุญาต รูปภาพที่ผู้ใช้เลือก และเวลาที่ส่งคำร้อง</p><h2>การใช้ข้อมูล</h2><p>ใช้เพื่อรับเรื่อง ตรวจสอบ ดำเนินการ และแจ้งสถานะคำร้องแก่ผู้ใช้ รูปคำร้องถูกเก็บแบบ private และไม่เปิดเป็น public URL</p><h2>สิทธิ์ของผู้ใช้</h2><p>ผู้ใช้สามารถติดต่อเทศบาลเพื่อสอบถาม ขอแก้ไข หรือลบข้อมูลตามช่องทางราชการที่ประกาศไว้</p></article>`, '', { title: 'ความเป็นส่วนตัว', back: true, noTabs: true });
}

const complaintStatusText: Record<ComplaintStatus, string> = {
  received: 'รับเรื่องแล้ว', in_progress: 'กำลังดำเนินการ', resolved: 'เสร็จสิ้น', rejected: 'ไม่รับดำเนินการ'
};

function requestsPage(): string {
  let content = '';
  if (complaintLoadState === 'loading' || complaintLoadState === 'idle') content = '<div class="empty-state"><span class="spinner"></span><p>กำลังโหลดคำร้องของคุณ...</p></div>';
  else if (complaintLoadState === 'error') content = `<div class="empty-state"><p>${esc(complaintLoadError)}</p><button class="primary-button" id="requests-retry">ลองใหม่</button></div>`;
  else if (!myComplaints.length) content = '<div class="empty-state"><b>ยังไม่มีคำร้อง</b><p>เมื่อส่งคำร้องแล้ว สถานะจะแสดงที่หน้านี้</p><button class="primary-button" data-go="services">เลือกบริการ</button></div>';
  else content = myComplaints.map(item => `<article class="request-card"><div class="request-head"><span class="status-pill status-${item.status}">${complaintStatusText[item.status]}</span><small>${new Date(item.created_at).toLocaleDateString('th-TH', { dateStyle: 'medium' })}</small></div><h2>${esc(item.title)}</h2><b>${esc(item.ticket_no)}</b><p>${esc(item.subtype)} · ${esc(item.description)}</p>${item.has_photo ? '<small>📎 มีรูปภาพประกอบ</small>' : ''}</article>`).join('');
  return shell(`<div class="page-heading"><h1>ติดตามคำร้อง</h1><button class="refresh-button" id="requests-refresh" type="button">รีเฟรช</button></div><section class="request-list">${content}</section>`, 'requests');
}

async function loadMyComplaintHistory(force = false): Promise<void> {
  if (complaintLoadState === 'loading' || (complaintLoadState === 'ready' && !force)) return;
  complaintLoadState = 'loading';
  if (route() === 'requests') await render();
  try {
    myComplaints = await getMyComplaints();
    complaintLoadState = 'ready';
    complaintLoadError = '';
  } catch (error) {
    complaintLoadState = 'error';
    complaintLoadError = error instanceof Error && error.message !== 'LINE_LOGIN_REQUIRED' ? error.message : 'กรุณาเปิดแอปผ่าน LINE และเข้าสู่ระบบอีกครั้ง';
  }
  if (route() === 'requests') await render();
}

const subtypeMap: Record<ComplaintCategory, string[]> = {
  streetlight: ['ไฟดับ', 'ไฟกระพริบ', 'ไฟสว่างตลอดวัน', 'โคมไฟชำรุด'],
  road: ['ถนนเป็นหลุม', 'ทางเท้าชำรุด', 'ฝาท่อชำรุด', 'ป้ายจราจรเสียหาย'],
  waste: ['ขยะตกค้าง', 'ถังขยะเต็ม', 'ทิ้งขยะไม่ถูกที่', 'ถังขยะชำรุด'],
  flood: ['น้ำท่วมขัง', 'ท่อระบายน้ำอุดตัน', 'น้ำเอ่อล้น', 'จุดเสี่ยงน้ำท่วม'],
  pm25: ['การเผาในที่โล่ง', 'ควันผิดปกติ', 'ฝุ่นจากก่อสร้าง', 'อื่น ๆ'],
  information: ['ขอสำเนาเอกสาร', 'ขอตรวจดูข้อมูล', 'สอบถามขั้นตอน', 'อื่น ๆ'],
  health: ['ขอรับบริการสุขภาพ', 'แจ้งเหตุด้านสาธารณสุข', 'สอบถามบริการ', 'อื่น ๆ']
};

function reportPage(category: ComplaintCategory): string {
  if (category === 'information' || category === 'health') return serviceInformationPage(category);
  if (!subtypeMap[category]) category = 'streetlight';
  reportDraft.category = category;
  const progress = (reportStep / 3) * 100;
  let body = '';
  if (reportStep === 1) {
    body = `<h3>ประเภทปัญหา</h3><div class="radio-card">${subtypeMap[category].map(value => `<label class="radio-row"><input type="radio" name="subtype" value="${esc(value)}" ${reportDraft.subtype === value ? 'checked' : ''}><i></i><span>${esc(value)}</span></label>`).join('')}</div>
      <h3>รายละเอียด</h3><label class="textarea-card"><textarea id="description" maxlength="500" placeholder="ระบุรายละเอียดของปัญหา...">${esc(reportDraft.description)}</textarea><small><span id="char-count">${reportDraft.description.length}</span>/500</small></label>`;
  } else if (reportStep === 2) {
    body = `<h3>ตำแหน่งที่เกิดปัญหา</h3><div class="location-card"><span>📍</span><div><b id="location-label">${reportDraft.latitude ? `${reportDraft.latitude.toFixed(6)}, ${reportDraft.longitude?.toFixed(6)}` : 'ยังไม่ได้ระบุตำแหน่ง'}</b><small>กดปุ่มเพื่อใช้ตำแหน่งปัจจุบัน</small></div></div><button class="secondary-button" id="get-location">ใช้ตำแหน่งปัจจุบัน</button>
      <h3>รูปภาพ (ถ้ามี)</h3><label class="photo-picker"><input id="photo-input" type="file" accept="image/*" capture="environment"><span>📷</span><b id="photo-label">${reportDraft.photo ? esc(reportDraft.photo.name) : 'เพิ่มรูปภาพ'}</b><small>รองรับ JPG, PNG และ HEIC</small></label>`;
  } else {
    body = `<h3>ตรวจสอบข้อมูล</h3><div class="summary-card"><div><span>ประเภท</span><b>${esc(categoryTitle(category))}</b></div><div><span>ลักษณะปัญหา</span><b>${esc(reportDraft.subtype)}</b></div><div><span>รายละเอียด</span><b>${esc(reportDraft.description || '-')}</b></div><div><span>ตำแหน่ง</span><b>${reportDraft.latitude ? `${reportDraft.latitude.toFixed(5)}, ${reportDraft.longitude?.toFixed(5)}` : 'ไม่ได้ระบุ'}</b></div><div><span>รูปภาพ</span><b>${reportDraft.photo ? esc(reportDraft.photo.name) : 'ไม่มี'}</b></div></div><label class="consent"><input id="consent" type="checkbox"><i></i><span>ยืนยันว่าข้อมูลถูกต้องและยินยอมให้เทศบาลใช้ข้อมูลเพื่อดำเนินการตามคำร้อง</span></label>`;
  }
  return shell(`
    <div class="progress-row"><div class="progress-track"><i style="width:${progress}%"></i></div><small>${reportStep}/3</small></div>
    <section class="report-content">${body}</section>
    <div class="report-actions">${reportStep > 1 ? '<button class="secondary-button" id="report-prev">ย้อนกลับ</button>' : ''}<button class="primary-button" id="report-next">${reportStep === 3 ? 'ส่งคำร้อง' : 'ถัดไป'}</button></div>
  `, '', { title: `แจ้ง${categoryTitle(category).replace('ปัญหา', 'ปัญหา')}`, back: true, noTabs: true });
}

function successPage(id: string, demo: boolean): string {
  return shell(`<section class="success-view"><div class="success-icon">✓</div><h1>ส่งคำร้องสำเร็จ</h1><p>เลขที่คำร้อง</p><strong>${esc(id)}</strong>${demo ? '<small>บันทึกใน localStorage เนื่องจากเป็นโหมดทดลอง</small>' : '<small>ระบบได้ส่งข้อมูลเข้าสู่ฐานข้อมูลแล้ว</small>'}<button class="primary-button" data-go="requests">ติดตามคำร้อง</button><button class="secondary-button" data-go="home">กลับหน้าหลัก</button></section>`, '', { title: 'สำเร็จ', noTabs: true });
}

async function render(): Promise<void> {
  leafletMap?.remove();
  leafletMap = null;
  mapIssueGroups = new Map();
  const current = route();
  if (current === 'home') app.innerHTML = dashboard();
  else if (current === 'services') app.innerHTML = servicesPage();
  else if (current === 'requests') app.innerHTML = requestsPage();
  else if (current === 'map') app.innerHTML = mapPage();
  else if (current === 'settings') app.innerHTML = settingsPage();
  else if (current === 'staff') app.innerHTML = staffPage();
  else if (current === 'notices') app.innerHTML = noticesPage();
  else if (current === 'news') app.innerHTML = newsPage();
  else if (current === 'profile') app.innerHTML = profilePage();
  else if (current === 'notifications') app.innerHTML = notificationsPage();
  else if (current === 'about') app.innerHTML = aboutPage();
  else if (current === 'privacy') app.innerHTML = privacyPage();
  else if (current === 'service-info/information') app.innerHTML = serviceInformationPage('information');
  else if (current === 'service-info/health') app.innerHTML = serviceInformationPage('health');
  else if (current.startsWith('report/')) app.innerHTML = reportPage((current.split('/')[1] || 'streetlight') as ComplaintCategory);
  else if (current.startsWith('success/')) app.innerHTML = successPage(decodeURIComponent(current.split('/')[1] || ''), current.endsWith('/demo'));
  else app.innerHTML = dashboard();
  bindEvents();
  if (current === 'requests' && complaintLoadState === 'idle') void loadMyComplaintHistory();
  if (current === 'map') await initMap();
  if (current === 'home') void updateWeather();
}

function bindEvents(): void {
  document.querySelectorAll<HTMLElement>('[data-go]').forEach(el => el.addEventListener('click', () => go(el.dataset.go || 'home')));
  document.querySelectorAll<HTMLElement>('[data-back]').forEach(el => el.addEventListener('click', () => history.length > 1 ? history.back() : go('home')));
  document.querySelectorAll<HTMLElement>('[data-service]').forEach(el => el.addEventListener('click', () => {
    const slug = el.dataset.service || '';
    if (slug === 'information' || slug === 'health') {
      go(`service-info/${slug}`);
      return;
    }
    if (slug in subtypeMap) {
      reportStep = 1;
      reportDraft = { category: slug as ComplaintCategory, subtype: subtypeMap[slug as ComplaintCategory][0] || '', description: '' };
      go(`report/${slug}`);
    } else toast('ไม่พบบริการที่เลือก');
  }));

  document.querySelector<HTMLInputElement>('#service-search')?.addEventListener('input', event => {
    const query = (event.target as HTMLInputElement).value.toLowerCase().trim();
    document.querySelectorAll<HTMLElement>('#service-list [data-search]').forEach(item => item.hidden = !(item.dataset.search || '').toLowerCase().includes(query));
  });

  const darkToggle = document.querySelector<HTMLInputElement>('#dark-toggle');
  if (darkToggle) {
    darkToggle.checked = localStorage.getItem('dark-mode') === 'true';
    darkToggle.addEventListener('change', () => {
      document.documentElement.classList.toggle('dark', darkToggle.checked);
      localStorage.setItem('dark-mode', String(darkToggle.checked));
    });
  }

  document.querySelector<HTMLInputElement>('#notification-toggle')?.addEventListener('change', event => {
    const prefs = loadNotificationPrefs();
    prefs.enabled = (event.target as HTMLInputElement).checked;
    saveNotificationPrefs(prefs);
    toast(prefs.enabled ? 'เปิดการแจ้งเตือนแล้ว' : 'ปิดการแจ้งเตือนแล้ว');
  });
  document.querySelectorAll<HTMLInputElement>('.notification-pref').forEach(input => input.addEventListener('change', () => {
    const prefs = loadNotificationPrefs();
    const key = input.dataset.pref as keyof Pick<NotificationPrefs, 'complaints' | 'notices' | 'news'>;
    if (key) prefs[key] = input.checked;
    saveNotificationPrefs(prefs);
    toast('บันทึกการตั้งค่าแล้ว');
  }));
  document.querySelector('#requests-refresh')?.addEventListener('click', () => void loadMyComplaintHistory(true));
  document.querySelector('#requests-retry')?.addEventListener('click', () => void loadMyComplaintHistory(true));

  document.querySelector('#share-btn')?.addEventListener('click', async () => {
    try {
      if (await shareApp()) toast('เปิดหน้าต่างแชร์ LINE แล้ว');
      else {
        await navigator.clipboard.writeText(location.href);
        toast('คัดลอกลิงก์แล้ว');
      }
    } catch { toast('ไม่สามารถแชร์ได้ในขณะนี้'); }
  });

  document.querySelector<HTMLFormElement>('#admin-login-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>('#admin-password');
    const result = await loginAdmin(input?.value || '');
    if (!result.ok) return toast('รหัสผ่านไม่ถูกต้อง');
    toast(result.demo ? 'เข้าสู่ระบบผู้ดูแล (โหมดทดลอง) แล้ว' : 'เข้าสู่ระบบผู้ดูแลแล้ว');
    void render();
  });
  document.querySelector('#admin-logout-btn')?.addEventListener('click', () => {
    logoutAdmin();
    toast('ออกจากระบบผู้ดูแลแล้ว');
    void render();
  });

  document.querySelectorAll<HTMLInputElement>('.issue-filter').forEach(input => {
    input.addEventListener('change', () => {
      issueFilters[input.value] = input.checked;
      saveIssueFilters();
      const group = mapIssueGroups.get(input.value);
      if (!group || !leafletMap) return;
      if (input.checked) group.addTo(leafletMap);
      else leafletMap.removeLayer(group);
    });
  });
  const mapFilterButton = document.querySelector<HTMLButtonElement>('#map-filter-btn');
  const mapFilterSheet = document.querySelector<HTMLElement>('#map-filter-sheet');
  const setMapFilterOpen = (open: boolean) => {
    if (!mapFilterSheet || !mapFilterButton) return;
    mapFilterSheet.hidden = !open;
    mapFilterButton.setAttribute('aria-expanded', String(open));
  };
  mapFilterButton?.addEventListener('click', () => setMapFilterOpen(mapFilterSheet?.hidden !== false));
  document.querySelector('#map-filter-close')?.addEventListener('click', () => setMapFilterOpen(false));
  document.querySelectorAll<HTMLInputElement>('.managed-layer-toggle').forEach(input => {
    input.addEventListener('change', () => {
      const layer = managedLayers.find(item => item.id === input.value);
      if (!layer) return;
      layer.visible = input.checked;
      saveManagedLayers();
    });
  });
  document.querySelector('#add-layer-btn')?.addEventListener('click', () => openLayerDialog());
  document.querySelectorAll<HTMLElement>('[data-edit-layer]').forEach(button => button.addEventListener('click', () => openLayerDialog(button.dataset.editLayer)));
  document.querySelectorAll<HTMLElement>('[data-add-marker]').forEach(button => button.addEventListener('click', () => {
    const layerId = button.dataset.addMarker;
    if (layerId) openMarkerDialog(layerId);
  }));
  document.querySelectorAll<HTMLElement>('[data-edit-marker]').forEach(button => button.addEventListener('click', () => {
    const [layerId, markerId] = splitLayerMarkerKey(button.dataset.editMarker || '');
    if (layerId && markerId) openMarkerDialog(layerId, markerId);
  }));
  document.querySelectorAll<HTMLElement>('[data-delete-layer]').forEach(button => button.addEventListener('click', () => {
    const layer = managedLayers.find(item => item.id === button.dataset.deleteLayer);
    if (!layer || !confirm(`ลบเลเยอร์ “${layer.name}” และสถานที่ ${layer.markers.length} รายการหรือไม่?`)) return;
    managedLayers = managedLayers.filter(item => item.id !== layer.id);
    saveManagedLayers();
    toast('ลบเลเยอร์แล้ว');
    void render();
  }));
  document.querySelectorAll<HTMLElement>('[data-delete-marker]').forEach(button => button.addEventListener('click', () => {
    const [layerId, markerId] = splitLayerMarkerKey(button.dataset.deleteMarker || '');
    const layer = managedLayers.find(item => item.id === layerId);
    const marker = layer?.markers.find(item => item.id === markerId);
    if (!layer || !marker || !confirm(`ลบสถานที่ “${marker.name}” หรือไม่?`)) return;
    layer.markers = layer.markers.filter(item => item.id !== markerId);
    saveManagedLayers();
    toast('ลบสถานที่แล้ว');
    void render();
  }));
  document.querySelectorAll<HTMLElement>('[data-focus-marker]').forEach(button => button.addEventListener('click', () => {
    const [layerId, markerId] = splitLayerMarkerKey(button.dataset.focusMarker || '');
    const marker = managedLayers.find(item => item.id === layerId)?.markers.find(item => item.id === markerId);
    if (!marker) return;
    pendingMapFocus = { latitude: marker.latitude, longitude: marker.longitude };
    go('map');
  }));

  const desc = document.querySelector<HTMLTextAreaElement>('#description');
  desc?.addEventListener('input', () => {
    reportDraft.description = desc.value;
    const count = document.querySelector('#char-count');
    if (count) count.textContent = String(desc.value.length);
  });
  document.querySelectorAll<HTMLInputElement>('input[name="subtype"]').forEach(input => input.addEventListener('change', () => reportDraft.subtype = input.value));
  document.querySelector('#get-location')?.addEventListener('click', getCurrentLocation);
  document.querySelector<HTMLInputElement>('#photo-input')?.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    reportDraft.photo = input.files?.[0];
    const label = document.querySelector('#photo-label');
    if (label) label.textContent = reportDraft.photo?.name || 'เพิ่มรูปภาพ';
  });
  document.querySelector('#report-prev')?.addEventListener('click', () => { reportStep -= 1; void render(); });
  document.querySelector('#report-next')?.addEventListener('click', handleReportNext);
}

async function handleReportNext(): Promise<void> {
  if (reportStep === 1) {
    const desc = document.querySelector<HTMLTextAreaElement>('#description');
    reportDraft.description = desc?.value.trim() || '';
    if (!reportDraft.subtype) return toast('กรุณาเลือกประเภทปัญหา');
    if (reportDraft.description.length < 5) return toast('กรุณาระบุรายละเอียดอย่างน้อย 5 ตัวอักษร');
    reportStep = 2;
    return void render();
  }
  if (reportStep === 2) {
    reportStep = 3;
    return void render();
  }
  const consent = document.querySelector<HTMLInputElement>('#consent');
  if (!consent?.checked) return toast('กรุณายืนยันความถูกต้องของข้อมูล');
  const button = document.querySelector<HTMLButtonElement>('#report-next');
  if (button) { button.disabled = true; button.textContent = 'กำลังส่ง...'; }
  try {
    const result = await createComplaint(reportDraft, profile);
    go(`success/${encodeURIComponent(result.id)}${result.demo ? '/demo' : ''}`);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error && error.message !== 'LINE_LOGIN_REQUIRED'
      ? error.message
      : 'กรุณาเปิดแอปผ่าน LINE และเข้าสู่ระบบก่อนส่งคำร้อง';
    toast(message);
    if (button) { button.disabled = false; button.textContent = 'ส่งคำร้อง'; }
  }
}

function getCurrentLocation(): void {
  if (!navigator.geolocation) return toast('อุปกรณ์ไม่รองรับการระบุตำแหน่ง');
  const label = document.querySelector('#location-label');
  if (label) label.textContent = 'กำลังค้นหาตำแหน่ง...';
  navigator.geolocation.getCurrentPosition(position => {
    reportDraft.latitude = position.coords.latitude;
    reportDraft.longitude = position.coords.longitude;
    if (label) label.textContent = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
  }, error => {
    console.error(error);
    if (label) label.textContent = 'ไม่สามารถระบุตำแหน่งได้';
    toast('กรุณาอนุญาตการเข้าถึงตำแหน่ง');
  }, { enableHighAccuracy: true, timeout: 12000 });
}

async function initMap(): Promise<void> {
  const container = document.querySelector<HTMLDivElement>('#map');
  if (!container) return;
  try {
    await loadLeaflet();
  } catch (error) {
    console.error('Leaflet unavailable:', error);
    toast('ไม่สามารถโหลดแผนที่ได้ กรุณาลองใหม่');
    return;
  }
  if (route() !== 'map' || !document.querySelector('#map')) return;
  leafletMap = L.map(container, { zoomControl: false }).setView([appConfig.mapCenter.lat, appConfig.mapCenter.lng], appConfig.mapZoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(leafletMap);
  L.control.zoom({ position: 'topright' }).addTo(leafletMap);
  const issues = await getMapIssues();
  for (const issue of issues) {
    const group = mapIssueGroups.get(issue.category) ?? L.layerGroup().addTo(leafletMap);
    mapIssueGroups.set(issue.category, group);
    const icon = L.divIcon({ className: 'issue-marker-wrap', html: `<span class="issue-marker ${issue.category}"><i>${markerEmoji(issue.category)}</i></span>`, iconSize: [38, 38], iconAnchor: [19, 36] });
    L.marker([issue.latitude, issue.longitude], { icon }).bindPopup(`<b>${esc(issue.title)}</b><br>${esc(issue.status)}`).addTo(group);
  }
  for (const [category, group] of mapIssueGroups) {
    if (!issueFilters[category]) leafletMap.removeLayer(group);
  }
  for (const layer of managedLayers) {
    const group = L.layerGroup();
    for (const marker of layer.markers) {
      const initial = Array.from(marker.name.trim())[0] || '•';
      const markerIcon = L.divIcon({
        className: 'managed-marker-wrap',
        html: `<span class="managed-marker" style="--marker-color:${esc(layer.color)}"><i>${esc(initial)}</i></span>`,
        iconSize: [40, 46],
        iconAnchor: [20, 44],
        popupAnchor: [0, -42]
      });
      const info = marker.info ? `<p>${esc(marker.info).replace(/\n/g, '<br>')}</p>` : '';
      L.marker([marker.latitude, marker.longitude], { icon: markerIcon })
        .bindPopup(`<div class="place-popup"><b>${esc(marker.name)}</b>${info}<small>${marker.latitude.toFixed(6)}, ${marker.longitude.toFixed(6)}</small></div>`)
        .addTo(group);
    }
    if (layer.visible) group.addTo(leafletMap);
  }
  if (pendingMapFocus) {
    leafletMap.setView([pendingMapFocus.latitude, pendingMapFocus.longitude], Math.max(leafletMap.getZoom(), 17));
    pendingMapFocus = null;
  }
  document.querySelector('#locate-btn')?.addEventListener('click', () => {
    leafletMap?.locate({ setView: true, maxZoom: 17 });
    leafletMap?.once('locationfound', (event: any) => L.circleMarker(event.latlng, { radius: 8 }).addTo(leafletMap!).bindPopup('ตำแหน่งของคุณ').openPopup());
    leafletMap?.once('locationerror', () => toast('ไม่สามารถระบุตำแหน่งได้'));
  });
}

function markerEmoji(category: string): string {
  return ({ streetlight: '💡', road: '!', waste: '♻', flood: '≋', pm25: '☁' } as Record<string, string>)[category] || '•';
}

async function updateWeather(): Promise<void> {
  const weather = await getChiangRaiWeather();
  if (!weather || route() !== 'home') return;
  const set = (id: string, value: string) => {
    const el = document.querySelector(`#${id}`);
    if (el) el.textContent = value;
  };
  set('weather-icon', weather.icon);
  set('weather-temp', `${weather.temperature}°`);
  set('weather-desc', weather.description);
  set('weather-range', `↑ ${weather.high}° ↓ ${weather.low}°`);
  set('weather-humidity', `ความชื้น ${weather.humidity}%`);
  set('weather-rain', `ฝน ${weather.rainChance}%`);
}

function toast(message: string): void {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 2400);
}

async function start(): Promise<void> {
  document.documentElement.classList.toggle('dark', localStorage.getItem('dark-mode') === 'true');
  window.addEventListener('hashchange', () => void render());
  await render();

  void initLine().then(result => {
    profile = result;
    lineProfileReady = true;
    if (['home', 'settings', 'profile', 'requests'].includes(route())) void render();
  });

  void Promise.all([getServices(), getNews(), getNotices()]).then(result => {
    [services, news, notices] = result;
    if (['home', 'services', 'notices', 'news'].includes(route())) void render();
  }).catch(error => {
    console.error(error);
    toast('เชื่อม Supabase ไม่สำเร็จ กรุณาตรวจสอบตารางและ RLS');
  });
}

void start();
