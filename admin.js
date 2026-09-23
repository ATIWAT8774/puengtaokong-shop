const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const moneyNumber = n => Number(n || 0).toLocaleString('th-TH', {minimumFractionDigits:0,maximumFractionDigits:2});
const money = n => moneyNumber(n) + ' บาท';
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const STORAGE_KEY = 'ptk-orders';
const PAID_STATUSES = new Set(['paid','packing','shipped','ready_pickup','completed']);
const FILTER_TABS = [
  ['all','ทั้งหมด'], ['unpaid','ยังไม่ชำระเงิน'], ['paid_group','ชำระเงินแล้ว'],
  ['shipped_group','จัดส่งแล้ว'], ['cancelled','ยกเลิกแล้ว'], ['payment_rejected','ชำระเงินไม่สำเร็จ']
];
const SIZE_ORDER = ['BS','BM','BL','BXL','XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','7XL'];
let searchText = '';
let filterStatus = 'all';
const selectedOrderNos = new Set();
let currentLabelKind = 'shipping';
let currentSummaryText = '';
let remoteOrders = [];
let adminToken = sessionStorage.getItem('ptk-admin-token') || '';
let isLoading = false;

function readJSON(key, fallback){ try{return JSON.parse(localStorage.getItem(key) || '') || fallback;}catch{return fallback;} }
function writeJSON(key, value){ try{localStorage.setItem(key, JSON.stringify(value));return true;}catch{return false;} }
function api(){ return window.PTKSheetAPI; }
function remoteEnabled(){ return !!api()?.isConfigured?.(); }
function getOrders(){ return remoteEnabled() ? remoteOrders : readJSON(STORAGE_KEY, []); }
function saveLocalOrders(v){ return writeJSON(STORAGE_KEY, v); }
function statusLabel(s){ return ({pending_payment:'รอชำระเงิน',payment_review:'รอตรวจสอบสลิป',payment_rejected:'สลิปไม่ผ่านการตรวจสอบ',paid:'ยืนยันชำระเงินแล้ว',packing:'กำลังจัดสินค้า',shipped:'จัดส่งแล้ว',ready_pickup:'พร้อมรับสินค้า',completed:'สำเร็จ',cancelled:'ยกเลิก'}[s]||s); }
function sourceLabel(s){return ({website:'เว็บไซต์',phone:'โทรศัพท์',facebook:'Facebook / Messenger',line:'LINE',store:'หน้าร้าน',other:'ช่องทางอื่น'}[s]||'เว็บไซต์');}
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),2600); }
function orderItemsSummary(o){ const items=o.items||[]; if(!items.length) return '-'; return items.map(i=>`${i.size || '-'} × ${i.qty || 1}`).join(', '); }
function formatDate(v){
  if(!v) return '-';
  const d=new Date(v); if(Number.isNaN(d.getTime())) return '-';
  const x=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).reduce((o,p)=>(o[p.type]=p.value,o),{});
  return `${x.day}/${x.month}/${Number(x.year)+543} ${x.hour}:${x.minute}`;
}
function customerAddress(o){ const c=o.customer||{}; return [c.address,c.subdistrict,c.district,c.province,c.postalCode].filter(Boolean).join(' '); }
function displayCustomerName(name){
  const n=String(name||'-').trim();
  if(!n || n==='-') return '-';
  return /^(คุณ|นาย|นางสาว|นาง|ดร\.|ดร\s|พระ|เด็กชาย|เด็กหญิง)/.test(n) ? n : `คุณ${n}`;
}
function sizeOrderValue(size){ const s=String(size||'').toUpperCase().replace(/\s+/g,''); const i=SIZE_ORDER.indexOf(s); return i>=0?i:999; }
function groupedSizeSummary(o){
  const map=new Map();
  (o.items||[]).forEach(i=>{ const size=String(i.size||'-').toUpperCase(); map.set(size,(map.get(size)||0)+Number(i.qty||1)); });
  return [...map.entries()].sort((a,b)=>sizeOrderValue(a[0])-sizeOrderValue(b[0]) || a[0].localeCompare(b[0])).map(([s,q])=>`${s} /${q}`).join('  ') || '-';
}
function labelSizeSummary(o){
  const tally=summarySizeTotals([o]);
  return tally.map(([size,qty])=>`${size} × ${qty}`).join('  ·  ') || '-';
}
function paymentLineLabel(o){
  if(PAID_STATUSES.has(o.status)) return 'ชำระเงินแล้ว';
  return ({payment_review:'รอตรวจสลิป',payment_rejected:'สลิปไม่ผ่าน',pending_payment:'ยังไม่ชำระ',cancelled:'ยกเลิก'}[o.status]||statusLabel(o.status));
}
function receiveLineLabel(o){ return o.shipping==='shipping' ? '*จัดส่ง' : '*รับหน้างาน'; }
function compactOrderLine(o){ return `${displayCustomerName(o.customer?.name)}  ${groupedSizeSummary(o)}  ${paymentLineLabel(o)}  ${receiveLineLabel(o)}`; }
function summarySizeTotals(orders){
  const map=new Map();
  orders.forEach(o=>(o.items||[]).forEach(i=>{ const size=String(i.size||'-').toUpperCase(); map.set(size,(map.get(size)||0)+Number(i.qty||1)); }));
  return [...map.entries()].sort((a,b)=>sizeOrderValue(a[0])-sizeOrderValue(b[0]) || a[0].localeCompare(b[0]));
}
function totalShirts(orders){ return orders.reduce((sum,o)=>sum+(o.items||[]).reduce((s,i)=>s+Number(i.qty||1),0),0); }
function summaryEligibleOrders(orders){ return orders.filter(o=>PAID_STATUSES.has(o.status)); }
function hasSlip(o){ return !!(o.slipUrl || o.slipData); }
function matchesOrderStatus(o,group){
  if(group==='all') return true;
  if(group==='unpaid') return ['pending_payment','payment_review'].includes(o.status);
  if(group==='paid_group') return PAID_STATUSES.has(o.status) && !(o.shipping==='shipping' && ['shipped','completed'].includes(o.status));
  if(group==='shipped_group') return o.shipping==='shipping' && ['shipped','completed'].includes(o.status);
  if(group==='to_ship') return o.shipping==='shipping' && ['paid','packing'].includes(o.status);
  if(group==='shipping') return o.shipping==='shipping';
  return o.status===group;
}
function renderStatusTabs(){
  const orders=getOrders();
  $('#orderStatusTabs').innerHTML=FILTER_TABS.map(([key,label])=>`<button type="button" class="order-filter-tab ${filterStatus===key?'active':''}" data-filter-tab="${key}" aria-pressed="${filterStatus===key}">${label} <b>${orders.filter(o=>matchesOrderStatus(o,key)).length}</b></button>`).join('');
  $$('[data-filter-tab]').forEach(btn=>btn.onclick=()=>{filterStatus=btn.dataset.filterTab;$('#statusFilter').value='all';renderAll();});
}

function filteredOrders(){
  const q=searchText.trim().toLowerCase();
  return getOrders().slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).filter(o=>{
    if(!matchesOrderStatus(o,filterStatus)) return false;
    if(!q) return true;
    const hay=[o.orderNo,o.trackingNo,o.customer?.name,o.customer?.phone,o.customer?.email].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function updateConnectionUI(message, state=''){
  const box=$('#sheetConnection');
  box.classList.remove('connected','error');
  if(state) box.classList.add(state);
  $('#sheetConnectionStatus').textContent=message;
  const input=$('#adminTokenInput');
  const connect=$('#connectAdminBtn');
  const forget=$('#forgetAdminBtn');
  if(!remoteEnabled()){
    input.hidden=true; connect.hidden=true; forget.hidden=true;
  }else if(adminToken){
    input.hidden=true; connect.hidden=true; forget.hidden=false;
  }else{
    input.hidden=false; connect.hidden=false; forget.hidden=true;
  }
}

function renderStats(){
  const all=getOrders();
  const review=all.filter(o=>o.status==='payment_review').length;
  const paid=all.filter(o=>PAID_STATUSES.has(o.status)).length;
  const revenue=all.filter(o=>PAID_STATUSES.has(o.status)).reduce((s,o)=>s+Number(o.total||0),0);
  $('#statAll').textContent=all.length.toLocaleString('th-TH');
  $('#statReview').textContent=review.toLocaleString('th-TH');
  $('#statPaid').textContent=paid.toLocaleString('th-TH');
  $('#statRevenue').textContent=moneyNumber(revenue);
  $('#statToShip').textContent=all.filter(o=>o.shipping==='shipping' && ['paid','packing'].includes(o.status)).length.toLocaleString('th-TH');
  $('#statShipped').textContent=all.filter(o=>o.shipping==='shipping' && ['shipped','completed'].includes(o.status)).length.toLocaleString('th-TH');
  $('#statPickup').textContent=all.filter(o=>o.shipping!=='shipping').length.toLocaleString('th-TH');
  $('#statShirts').textContent=totalShirts(all.filter(o=>PAID_STATUSES.has(o.status))).toLocaleString('th-TH');
  renderInsights(all);
}

function thaiDateKey(value){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const found=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${found.year}-${found.month}-${found.day}`;
}
function renderInsights(orders){
  const today=thaiDateKey(new Date());
  const daily=[];
  // Use midday UTC, then convert to Bangkok, avoiding local-browser timezone drift.
  const todayUtc=new Date(today+'T05:00:00Z');
  for(let offset=6;offset>=0;offset--){
    const d=new Date(todayUtc.getTime()-offset*86400000);
    daily.push({key:thaiDateKey(d),label:new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',timeZone:'Asia/Bangkok'}).format(d),value:0});
  }
  const byDate=new Map(daily.map(x=>[x.key,x]));
  orders.filter(o=>PAID_STATUSES.has(o.status)).forEach(o=>{
    if(!o.createdAt || Number.isNaN(new Date(o.createdAt).getTime()))return;
    const key=thaiDateKey(o.createdAt);
    if(byDate.has(key))byDate.get(key).value+=Number(o.total||0);
  });
  const top=Math.max(1,...daily.map(d=>d.value));
  $('#salesChart').innerHTML=daily.map(d=>`<div class="sales-chart-col"><span class="sales-chart-value" title="${money(d.value)}">${moneyNumber(d.value)}</span><div class="sales-chart-track" title="${esc(d.label)}: ${money(d.value)}"><div class="sales-chart-fill" style="height:${Math.max(d.value?3:0,d.value/top*100)}%"></div></div><span class="sales-chart-day">${esc(d.label)}</span></div>`).join('');
  $('#salesChart').setAttribute('aria-label',daily.map(d=>d.label+': '+money(d.value)).join(', '));
  const tally=summarySizeTotals(orders.filter(o=>PAID_STATUSES.has(o.status)));
  $('#sizeBreakdown').innerHTML=tally.length?tally.map(([size,qty])=>`<span class="size-chip"><b>${esc(size)}</b> ${Number(qty).toLocaleString('th-TH')} ตัว</span>`).join(''):'<span class="insight-empty">ยังไม่มีรายการที่ยืนยันชำระแล้ว</span>';
}
function statusSelect(o, cls='admin-status-select'){
  const waiting=o.status==='payment_review';
  const statuses=['pending_payment','payment_review','payment_rejected','paid','packing','shipped','ready_pickup','completed','cancelled'];
  return `<select class="${cls}" data-admin-status="${esc(o.orderNo)}" ${waiting?'disabled title="กรุณาตรวจสลิปก่อน"':''}>${statuses.map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}</select>`;
}
function verifyActions(o){
  if(o.status!=='payment_review' || !hasSlip(o)) return '';
  return `<div class="admin-pay-actions"><button class="btn mini confirm-pay" data-confirm-pay="${esc(o.orderNo)}"><svg class="icon"><use href="#i-check"></use></svg>ยืนยันชำระ</button><button class="btn mini reject-pay" data-reject-pay="${esc(o.orderNo)}">ปฏิเสธ</button></div>`;
}
function slipAction(o){ return hasSlip(o)?`<button class="btn mini ghost" data-slip="${esc(o.orderNo)}"><svg class="icon"><use href="#i-image"></use></svg>ดูสลิป</button>`:'<span class="muted">ยังไม่มีสลิป</span>'; }
function verifiedText(o){ return o.verifiedAt?`<small class="verified-time">ยืนยัน ${formatDate(o.verifiedAt)}</small>`:''; }

function selectableForPrinting(o){ return PAID_STATUSES.has(o.status); }
function selectionControl(o){
  return `<input class="order-select-checkbox" data-select-order="${esc(o.orderNo)}" type="checkbox" aria-label="เลือกออเดอร์ ${esc(o.orderNo)}" ${selectedOrderNos.has(o.orderNo)?'checked':''} ${selectableForPrinting(o)?'':'disabled title="ต้องชำระเงินแล้วก่อนพิมพ์"'}>`;
}
function updateSelectionUI(){
  const visible = filteredOrders().filter(selectableForPrinting);
  const allVisibleSelected=visible.length>0 && visible.every(o=>selectedOrderNos.has(o.orderNo));
  const input=$('#selectVisibleOrders'); input.checked=allVisibleSelected;
  input.indeterminate=!allVisibleSelected && visible.some(o=>selectedOrderNos.has(o.orderNo));
  $('#selectedOrderCount').textContent=`(${selectedOrderNos.size} รายการ)`;
  $('#printSelectedShipping').disabled=!getOrders().some(o=>selectedOrderNos.has(o.orderNo)&&o.shipping==='shipping'&&selectableForPrinting(o));
  $('#printSelectedPickup').disabled=!getOrders().some(o=>selectedOrderNos.has(o.orderNo)&&o.shipping!=='shipping'&&selectableForPrinting(o));
}
function renderDesktop(orders){
  $('#adminOrders').innerHTML=orders.map(o=>`<tr>
    <td>${selectionControl(o)}</td>
    <td><button class="link-btn" data-detail="${esc(o.orderNo)}"><b>${esc(o.orderNo)}</b></button><br><small>${formatDate(o.createdAt)}</small><br><small>${esc(sourceLabel(o.orderSource))}</small></td>
    <td>${esc(o.customer?.name||'-')}<br><small>${esc(o.customer?.phone||'-')}</small></td>
    <td>${esc(orderItemsSummary(o))}</td>
    <td><b>${money(o.total)}</b></td>
    <td>${o.shipping==='shipping'?'จัดส่ง':'รับเอง'}${o.trackingNo?`<span class="shipment-mini">${esc(o.trackingNo)}</span><span class="shipment-status">${esc(o.lastTrackStatus||'รอข้อมูลติดตาม')}</span>`:''}</td>
    <td><span class="status-badge ${o.status==='payment_rejected'?'status-rejected':''}">${statusLabel(o.status)}</span>${verifiedText(o)}<div class="admin-status-followup">${statusSelect(o,'admin-status-select')}</div></td>
    <td><div class="admin-slip-cell">${slipAction(o)}${verifyActions(o)}<button class="btn mini ghost" data-print-label="${esc(o.orderNo)}">พิมพ์ใบแปะหน้าซอง</button></div></td>
  </tr>`).join('');
}

function renderMobile(orders){
  $('#mobileOrders').innerHTML=orders.map(o=>`<article class="order-card">
    <div class="order-card-head"><label class="order-card-select">${selectionControl(o)}<span>เลือก</span></label><div><strong>${esc(o.orderNo)}</strong><small>${formatDate(o.createdAt)} • ${esc(sourceLabel(o.orderSource))}</small></div><span class="status-badge ${o.status==='payment_rejected'?'status-rejected':''}">${statusLabel(o.status)}</span></div>
    <div class="order-card-grid">
      <div class="order-card-kv"><span>ลูกค้า</span><b>${esc(o.customer?.name||'-')}</b></div>
      <div class="order-card-kv"><span>โทรศัพท์</span><b>${esc(o.customer?.phone||'-')}</b></div>
      <div class="order-card-kv"><span>ยอดรวม</span><b>${money(o.total)}</b></div>
      <div class="order-card-kv"><span>วิธีรับ</span><b>${o.shipping==='shipping'?'จัดส่ง':'รับเอง'}</b>${o.trackingNo?`<span class="shipment-mini">${esc(o.trackingNo)}</span><span class="shipment-status">${esc(o.lastTrackStatus||'รอข้อมูลติดตาม')}</span>`:''}</div>
      <div class="order-card-kv" style="grid-column:1/-1"><span>รายการ</span><b>${esc(orderItemsSummary(o))}</b></div>
    </div>
    ${verifiedText(o)}
    <div style="margin-top:8px">${statusSelect(o)}</div>
    <div class="order-card-actions"><button class="btn ghost" data-detail="${esc(o.orderNo)}">ดูรายละเอียด</button><button class="btn ghost" data-print-label="${esc(o.orderNo)}">พิมพ์ใบแปะหน้าซอง</button>${hasSlip(o)?`<button class="btn ghost" data-slip="${esc(o.orderNo)}"><svg class="icon"><use href="#i-image"></use></svg>ดูสลิป</button>`:''}${o.status==='payment_review'&&hasSlip(o)?`<button class="btn confirm-pay full-row" data-confirm-pay="${esc(o.orderNo)}"><svg class="icon"><use href="#i-check"></use></svg>ยืนยันชำระเงิน</button><button class="btn reject-pay full-row" data-reject-pay="${esc(o.orderNo)}">ปฏิเสธสลิป</button>`:''}</div>
  </article>`).join('');
}

function renderAll(){
  renderStats();
  renderStatusTabs();
  const orders=filteredOrders();
  // Avoid retaining selections that were removed from the database or refunded/cancelled.
  const allowed=new Set(getOrders().filter(selectableForPrinting).map(o=>o.orderNo));
  for(const id of selectedOrderNos)if(!allowed.has(id))selectedOrderNos.delete(id);
  renderDesktop(orders); renderMobile(orders);
  $('#emptyState').hidden=orders.length!==0;
  bindRowActions();
  updateSelectionUI();
}

async function refreshOrders(showToast=false){
  if(isLoading) return;
  if(!remoteEnabled()){
    updateConnectionUI('ยังไม่ได้ใส่ Web app URL ใน config.js — กำลังใช้ข้อมูลทดสอบในเบราว์เซอร์','error');
    renderAll(); return;
  }
  if(!adminToken){
    remoteOrders=[]; updateConnectionUI('เชื่อม Google Sheets แล้ว กรุณากรอกรหัสหลังบ้าน'); renderAll(); return;
  }
  isLoading=true;
  updateConnectionUI('กำลังโหลดออเดอร์จาก Google Sheets...');
  try{
    remoteOrders=await api().listOrders(adminToken);
    updateConnectionUI(`เชื่อมต่อแล้ว • ${remoteOrders.length.toLocaleString('th-TH')} ออเดอร์`,'connected');
    renderAll(); if(showToast) toast('โหลดข้อมูลล่าสุดแล้ว');
  }catch(err){
    remoteOrders=[];
    updateConnectionUI(err.message || 'เชื่อม Google Sheets ไม่สำเร็จ','error');
    renderAll(); if(showToast) toast(err.message || 'โหลดข้อมูลไม่สำเร็จ');
  }finally{ isLoading=false; }
}

async function updateOrderStatus(orderNo,status){
  const prior=getOrders().find(o=>o.orderNo===orderNo);
  if(!prior) throw new Error('ไม่พบออเดอร์');
  if(PAID_STATUSES.has(status)&&!PAID_STATUSES.has(prior.status)&&status!=='paid') throw new Error('กรุณายืนยันชำระเงินก่อนเปลี่ยนเป็นสถานะนี้');
  if(status==='paid'&&!PAID_STATUSES.has(prior.status) && !confirm(`ยืนยันว่าได้รับเงิน ${money(prior.total)} ของ ${prior.orderNo} แล้วใช่หรือไม่?`)) return false;
  if(remoteEnabled()){
    const updated=await api().updateStatus(adminToken,orderNo,status);
    const i=remoteOrders.findIndex(o=>o.orderNo===orderNo); if(i>=0) remoteOrders[i]=updated;
  }else{
    const all=getOrders(), i=all.findIndex(o=>o.orderNo===orderNo); if(i<0) throw new Error('ไม่พบออเดอร์');
    all[i].status=status; if(status==='paid'&&!all[i].verifiedAt) all[i].verifiedAt=new Date().toISOString();
    if(status==='shipped'&&!all[i].shippedAt)all[i].shippedAt=new Date().toISOString();
    if(!PAID_STATUSES.has(status)) all[i].verifiedAt=null;
    saveLocalOrders(all);
  }
  return true;
}

function bindRowActions(){
  $$('[data-select-order]').forEach(input=>input.onchange=()=>{
    if(input.checked)selectedOrderNos.add(input.dataset.selectOrder);
    else selectedOrderNos.delete(input.dataset.selectOrder);
    $$('[data-select-order]').filter(i=>i.dataset.selectOrder===input.dataset.selectOrder).forEach(i=>i.checked=input.checked);
    updateSelectionUI();
  });
  $$('[data-admin-status]').forEach(sel=>sel.onchange=async()=>{
    const old=sel.dataset.oldValue || '';
    sel.disabled=true;
    try{ const changed=await updateOrderStatus(sel.dataset.adminStatus,sel.value); if(changed)toast('อัปเดตสถานะแล้ว'); renderAll(); }
    catch(err){ toast(err.message || 'อัปเดตสถานะไม่สำเร็จ'); if(old) sel.value=old; }
    finally{ sel.disabled=false; }
  });
  $$('[data-admin-status]').forEach(sel=>{sel.dataset.oldValue=sel.value;});
  $$('[data-slip]').forEach(btn=>btn.onclick=()=>openSlip(btn.dataset.slip));
  $$('[data-detail]').forEach(btn=>btn.onclick=()=>openDetail(btn.dataset.detail));
  $$('[data-print-label]').forEach(btn=>btn.onclick=()=>openParcelLabel(btn.dataset.printLabel));
  $$('[data-confirm-pay]').forEach(btn=>btn.onclick=()=>confirmPayment(btn.dataset.confirmPay));
  $$('[data-reject-pay]').forEach(btn=>btn.onclick=()=>rejectPayment(btn.dataset.rejectPay));
}

async function confirmPayment(orderNo){
  const o=getOrders().find(x=>x.orderNo===orderNo); if(!o) return;
  if(!hasSlip(o)) return toast('ออเดอร์นี้ยังไม่มีสลิป');
  if(!confirm(`ยืนยันว่าได้รับเงิน ${money(o.total)} สำหรับ ${o.orderNo} แล้วใช่หรือไม่?`)) return;
  try{
    if(remoteEnabled()){
      const updated=await api().confirmPayment(adminToken,orderNo); const i=remoteOrders.findIndex(x=>x.orderNo===orderNo); if(i>=0) remoteOrders[i]=updated;
    }else{
      const all=getOrders(),i=all.findIndex(x=>x.orderNo===orderNo); all[i]={...all[i],status:'paid',verifiedAt:new Date().toISOString(),verifiedManually:true,rejectedAt:null}; saveLocalOrders(all);
    }
    toast('ยืนยันการชำระเงินแล้ว'); renderAll();
  }catch(err){ toast(err.message || 'ยืนยันการชำระเงินไม่สำเร็จ'); }
}
async function rejectPayment(orderNo){
  const o=getOrders().find(x=>x.orderNo===orderNo); if(!o) return;
  if(!confirm(`ปฏิเสธสลิปของ ${o.orderNo} ใช่หรือไม่?`)) return;
  try{
    if(remoteEnabled()){
      const updated=await api().rejectPayment(adminToken,orderNo); const i=remoteOrders.findIndex(x=>x.orderNo===orderNo); if(i>=0) remoteOrders[i]=updated;
    }else{
      const all=getOrders(),i=all.findIndex(x=>x.orderNo===orderNo); all[i]={...all[i],status:'payment_rejected',rejectedAt:new Date().toISOString(),verifiedAt:null,verifiedManually:false}; saveLocalOrders(all);
    }
    toast('ปฏิเสธสลิปแล้ว'); renderAll();
  }catch(err){ toast(err.message || 'ปฏิเสธสลิปไม่สำเร็จ'); }
}

function openSlip(orderNo){
  const o=getOrders().find(x=>x.orderNo===orderNo); const src=o?.slipUrl || o?.slipData;
  if(!src)return toast('ไม่พบสลิป');
  $('#slipDialogTitle').textContent=o.orderNo; $('#slipDialogImage').src=src; $('#slipDialog').showModal();
}
async function saveShipping(orderNo){
  const trackingNo=$('#shippingTracking')?.value.trim().toUpperCase().replace(/\s+/g,'') || '';
  const adminNote=$('#shippingNote')?.value.trim() || '';
  if(trackingNo && !/^[A-Z0-9]{10,30}$/.test(trackingNo))return toast('กรุณาตรวจสอบเลขพัสดุ (ตัวอักษร/ตัวเลข 10–30 ตัว)');
  const button=$('#shippingForm button[type="submit"]'); if(button)button.disabled=true;
  try{
    let updated;
    if(remoteEnabled())updated=await api().saveShipping(adminToken,orderNo,trackingNo,adminNote);
    else{
      const all=getOrders(),i=all.findIndex(o=>o.orderNo===orderNo);
      if(i<0)throw new Error('ไม่พบออเดอร์');
      updated={...all[i],trackingNo,adminNote,updatedAt:new Date().toISOString()};
      if(all[i].trackingNo!==trackingNo){updated.lastTrackStatus='';updated.lastTrackAt=null;}
      all[i]=updated;saveLocalOrders(all);
    }
    if(remoteEnabled()){const i=remoteOrders.findIndex(o=>o.orderNo===orderNo);if(i>=0)remoteOrders[i]=updated;}
    renderAll();openDetailContentRefresh(updated);toast('บันทึกข้อมูลการจัดส่งแล้ว');
  }catch(err){toast(err.message||'บันทึกไม่สำเร็จ');}
  finally{if(button && button.isConnected)button.disabled=false;}
}
function openDetailContentRefresh(o){
  if($('#orderDialog').open){$('#orderDialog').close();openDetail(o.orderNo);}
}
async function trackShipment(orderNo){
  const o=getOrders().find(x=>x.orderNo===orderNo);if(!o?.trackingNo)return toast('กรุณาบันทึกเลขพัสดุก่อน');
  const node=$('#trackingHistory'),btn=$('#trackParcelBtn');if(!node)return;
  if(btn)btn.disabled=true;node.textContent='กำลังตรวจสอบสถานะ...';
  try{
    if(!remoteEnabled())throw new Error('โหมดทดสอบในเบราว์เซอร์ยังไม่รองรับการดึง API กรุณาใช้ลิงก์เว็บไซต์ไปรษณีย์ไทย');
    const result=await api().trackShipment(adminToken,orderNo);
    const events=result.events||[];
    node.innerHTML=events.length?events.map(event=>`<div class="tracking-event"><b>${esc(event.description||'อัปเดตสถานะ')}</b><small>${esc(event.location||'-')} • ${esc(event.date||'-')}</small></div>`).join(''):`<p class="shipping-hint">${esc(result.message||'ยังไม่มีสถานะพัสดุ')}</p>`;
    if(events.length){const i=remoteOrders.findIndex(x=>x.orderNo===orderNo);if(i>=0){remoteOrders[i].lastTrackStatus=events[0].description;remoteOrders[i].lastTrackAt=new Date().toISOString();renderAll();}}
  }catch(err){node.textContent=err.message||'ไม่สามารถดึงสถานะพัสดุได้';}
  finally{if(btn)btn.disabled=false;}
}
function openDetail(orderNo){
  const o=getOrders().find(x=>x.orderNo===orderNo); if(!o)return;
  const c=o.customer||{};
  $('#dialogTitle').textContent=o.orderNo;
  $('#dialogBody').innerHTML=`
    <section class="detail-section"><h3>ข้อมูลลูกค้า</h3><div class="order-kv"><span>ชื่อ</span><b>${esc(c.name||'-')}</b></div><div class="order-kv"><span>โทรศัพท์</span><b>${esc(c.phone||'-')}</b></div>${c.email?`<div class="order-kv"><span>อีเมล</span><b>${esc(c.email)}</b></div>`:''}<div class="order-kv"><span>ช่องทางที่สั่ง</span><b>${esc(sourceLabel(o.orderSource))}</b></div><div class="order-kv"><span>วิธีรับสินค้า</span><b>${o.shipping==='shipping'?'จัดส่งสินค้า':'รับด้วยตัวเอง'}</b></div>${o.shipping==='shipping'?`<div class="order-kv"><span>ที่อยู่</span><b>${esc(customerAddress(o)||'-')}</b></div>`:''}</section>
    <section class="detail-section"><h3>รายการสินค้า</h3><div class="detail-items">${(o.items||[]).map(i=>`<div class="detail-item"><span>${esc(i.name||'เสื้อที่ระลึก')} / ${esc(i.size||'-')} × ${Number(i.qty||1)}</span><b>${money(i.lineTotal ?? Number(i.price||0)*Number(i.qty||1))}</b></div>`).join('')||'<span class="muted">ไม่มีรายการสินค้า</span>'}</div><div class="order-kv"><span>ค่าจัดส่ง</span><b>${money(o.shippingFee)}</b></div><div class="order-kv"><span>ยอดรวม</span><b class="detail-total">${money(o.total)}</b></div></section>
    <section class="detail-section"><h3>การชำระเงิน</h3><div class="order-kv"><span>สถานะ</span><b>${statusLabel(o.status)}</b></div><div class="order-kv"><span>เวลาที่ส่งสลิป</span><b>${formatDate(o.paidAt)}</b></div>${o.verifiedAt?`<div class="order-kv"><span>ยืนยันการชำระเงิน</span><b>${formatDate(o.verifiedAt)}</b></div>`:''}</section>
    ${o.shipping==='shipping'?`<section class="detail-section"><h3>จัดส่งและติดตามพัสดุ</h3><form id="shippingForm" class="shipping-form"><label>เลขพัสดุไปรษณีย์ไทย<input id="shippingTracking" autocomplete="off" value="${esc(o.trackingNo||'')}" maxlength="30" placeholder="เช่น EF582568151TH" aria-label="เลขพัสดุไปรษณีย์ไทย"></label><label>หมายเหตุภายใน (ไม่แสดงแก่ลูกค้า)<textarea id="shippingNote" maxlength="500" placeholder="รายละเอียดสำหรับแอดมิน">${esc(o.adminNote||'')}</textarea></label><div class="shipping-actions"><button type="submit" class="btn primary">บันทึกเลขพัสดุ / หมายเหตุ</button><button id="trackParcelBtn" type="button" class="btn ghost" ${!o.trackingNo?'disabled':''}>ตรวจสถานะล่าสุด</button><a class="btn ghost" target="_blank" rel="noopener noreferrer" href="${o.trackingNo?`https://track.thailandpost.co.th/?trackNumber=${encodeURIComponent(o.trackingNo)}`:'https://track.thailandpost.co.th/'}">เปิดเว็บไปรษณีย์ไทย</a></div><p class="shipping-hint">บันทึกเลขพัสดุไม่ได้เปลี่ยนสถานะออเดอร์โดยอัตโนมัติ หลังส่งสินค้าจริงให้เลือก “จัดส่งแล้ว” ในตาราง</p>${o.lastTrackAt?`<p class="shipping-hint">ตรวจสอบล่าสุด: ${formatDate(o.lastTrackAt)} — ${esc(o.lastTrackStatus||'-')}</p>`:''}<div id="trackingHistory" class="tracking-history" aria-live="polite"></div></form></section>`:`<section class="detail-section"><h3>รับสินค้าหน้างาน</h3><p class="shipping-hint">รายการนี้ไม่ต้องบันทึกเลขพัสดุ</p></section>`}
    <div class="detail-print"><button type="button" id="detailLabelBtn" class="btn primary">พิมพ์ใบแปะหน้าซอง</button></div>`;
  $('#shippingForm')?.addEventListener('submit',e=>{e.preventDefault();saveShipping(orderNo);});
  $('#trackParcelBtn')?.addEventListener('click',()=>trackShipment(orderNo));
  $('#detailLabelBtn')?.addEventListener('click',()=>openParcelLabel(orderNo));
  $('#orderDialog').showModal();
}

// One physical A4 sheet per print page; no printer-driver "multiple pages per sheet" setting.
// Shipping: 2 columns × 4 rows, 50 mm × 50 mm. Pickup: 5 × 5, 38 mm × 44 mm.
const LABEL_PAGE_CAPACITY = {shipping:8,pickup:25};
function labelOrderValid(o){
  if(!selectableForPrinting(o))return 'ยังไม่ได้ยืนยันชำระเงิน หรือออเดอร์ถูกยกเลิก';
  if(!String(o.customer?.name||'').trim() || !String(o.customer?.phone||'').trim())return 'ชื่อหรือเบอร์โทรไม่ครบ';
  if(o.shipping==='shipping' && (!String(o.customer?.address||'').trim() || !/^\d{5}$/.test(String(o.customer?.postalCode||''))))return 'ที่อยู่หรือรหัสไปรษณีย์ไม่ครบ';
  return '';
}
function parcelLabelHtml(o){
  const c=o.customer||{};
  const isShipping=o.shipping==='shipping';
  const address=[c.address,c.subdistrict?`ต./แขวง ${c.subdistrict}`:'',c.district?`อ./เขต ${c.district}`:'',c.province?`จ. ${c.province}`:''].filter(Boolean).join(' ');
  const dense=isShipping && address.length>105;
  return `<article class="parcel-label ${isShipping?'parcel-label-shipping':'parcel-label-pickup'} ${dense?'parcel-label-dense':''}">
    <header class="parcel-brand"><strong>ปึงเฒ่ากง <span>เสื้อที่ระลึก</span></strong><small>${esc(o.orderNo)}</small></header>
    <div class="parcel-name">${esc(c.name||'-')}</div>
    <div class="parcel-phone">${esc(c.phone||'-')}</div>
    ${isShipping?`<div class="parcel-address"><div class="parcel-address-main">${esc(address)}</div><strong class="parcel-postal">${esc(c.postalCode)}</strong></div>`:''}
    <footer class="parcel-footer"><span>${esc(labelSizeSummary(o))}</span><b>รวม ${totalShirts([o])} ตัว</b></footer>
  </article>`;
}
function printParcelOrders(inputOrders, kind){
  if(!inputOrders.length)return toast('ไม่มีออเดอร์ประเภทนี้ที่เลือกไว้');
  const bad=inputOrders.find(o=>labelOrderValid(o));
  if(bad)return toast(`ออเดอร์ ${bad.orderNo}: ${labelOrderValid(bad)}`);
  const perPage=LABEL_PAGE_CAPACITY[kind];
  const pages=[];
  for(let i=0;i<inputOrders.length;i+=perPage){
    const subset=inputOrders.slice(i,i+perPage);
    pages.push(`<section class="parcel-print-page parcel-print-page-${kind}" aria-label="A4 หน้า ${pages.length+1}">${subset.map(parcelLabelHtml).join('')}</section>`);
  }
  currentLabelKind=kind;
  $('#parcelPrintArea').innerHTML=pages.join('');
  $('#labelPageDetails').textContent=`กระดาษ A4 • ${inputOrders.length} ใบ • ${pages.length} หน้า • ${kind==='shipping'?'จัดส่ง 5 × 5 ซม. (8 ใบ/หน้า)':'รับหน้างาน 38 × 44 มม. (25 ใบ/หน้า)'} • พิมพ์ขนาดจริง 100%`;
  if($('#orderDialog').open)$('#orderDialog').close();
  if($('#labelDialog').open)$('#labelDialog').close();
  $('#labelDialog').showModal();
}
function openParcelLabel(orderNo){
  const order=getOrders().find(o=>o.orderNo===orderNo);
  if(!order)return toast('ไม่พบคำสั่งซื้อ');
  printParcelOrders([order],order.shipping==='shipping'?'shipping':'pickup');
}
function printSelectedLabels(kind){
  const selected=getOrders().filter(o=>selectedOrderNos.has(o.orderNo) && (kind==='shipping'?o.shipping==='shipping':o.shipping!=='shipping'));
  printParcelOrders(selected,kind);
}

const MANUAL_SIZES = SIZE_ORDER;
function priceForSize(size){return ['6XL','7XL'].includes(size)?250:200;}
function createSizeRow(size='M',qty=1){
  const row=document.createElement('div');row.className='manual-size-row';
  row.innerHTML=`<label>ไซส์<select name="size">${MANUAL_SIZES.map(s=>`<option value="${s}" ${s===size?'selected':''}>${s}</option>`).join('')}</select></label><label>จำนวน<input name="qty" type="number" min="1" max="99" step="1" value="${qty}" required></label><button class="btn ghost manual-remove-size" type="button" aria-label="ลบไซส์">ลบ</button>`;
  row.querySelector('.manual-remove-size').onclick=()=>{row.remove();updateManualTotal();};
  row.querySelectorAll('select,input').forEach(input=>input.addEventListener('input',updateManualTotal));
  return row;
}
function updateManualTotal(){
  const rows=$$('#manualSizeRows .manual-size-row');
  const subtotal=rows.reduce((sum,row)=>sum+priceForSize(row.querySelector('[name="size"]').value)*Math.max(0,Number(row.querySelector('[name="qty"]').value||0)),0);
  const fee=Number($('#manualShippingFee').value||0);
  $('#manualOrderTotal').textContent=money(subtotal+fee);
}
function updateManualShipping(){
  const shipping=$('#manualShipping').value==='shipping';
  $('#manualAddressFields').hidden=!shipping;
  $$('#manualAddressFields textarea, #manualAddressFields input').forEach(el=>el.required=shipping);
  $('#manualShippingFee').value=shipping?'50':'0';updateManualTotal();
}
function openManualOrder(){
  if(remoteEnabled()&&!adminToken)return toast('กรุณาเชื่อมต่อบัญชีหลังบ้านก่อนเพิ่มออเดอร์');
  $('#manualOrderForm').reset();$('#manualSizeRows').replaceChildren(createSizeRow('M',1));
  updateManualShipping();$('#manualOrderDialog').showModal();
}
function makeManualOrderNo(){
  const d=new Date();const date=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0'),String(d.getHours()).padStart(2,'0'),String(d.getMinutes()).padStart(2,'0'),String(d.getSeconds()).padStart(2,'0')].join('');
  const random=globalThis.crypto?.getRandomValues ? [...crypto.getRandomValues(new Uint8Array(4))].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase() : Math.random().toString(36).slice(2,12).toUpperCase();
  return `PTK${date}${random}`;
}
async function saveManualOrder(e){
  e.preventDefault();const form=$('#manualOrderForm'),fd=new FormData(form);
  const rows=$$('#manualSizeRows .manual-size-row');
  if(!rows.length)return toast('กรุณาเพิ่มไซส์เสื้ออย่างน้อย 1 รายการ');
  const items=rows.map(row=>({size:row.querySelector('[name="size"]').value,qty:Number(row.querySelector('[name="qty"]').value)}));
  if(items.some(i=>!Number.isInteger(i.qty)||i.qty<1||i.qty>99))return toast('จำนวนเสื้อต่อรายการต้องเป็น 1–99 ตัว');
  const customer={name:String(fd.get('name')||'').trim(),phone:String(fd.get('phone')||'').trim(),address:String(fd.get('address')||'').trim(),subdistrict:String(fd.get('subdistrict')||'').trim(),district:String(fd.get('district')||'').trim(),province:String(fd.get('province')||'').trim(),postalCode:String(fd.get('postalCode')||'').trim()};
  const shipping=fd.get('shipping')==='shipping'?'shipping':'pickup';
  if(shipping==='shipping'&&(!customer.address||!customer.subdistrict||!customer.district||!customer.province||!/^[0-9]{5}$/.test(customer.postalCode)))return toast('กรุณากรอกที่อยู่จัดส่งให้ครบทุกช่อง');
  const shippingFee=Number(fd.get('shippingFee'));
  if(!Number.isFinite(shippingFee)||shippingFee<0||shippingFee>100000)return toast('ค่าจัดส่งไม่ถูกต้อง');
  const order={orderNo:makeManualOrderNo(),customer,shipping,items,shippingFee,status:fd.get('status'),orderSource:fd.get('orderSource'),adminNote:String(fd.get('adminNote')||'').trim()};
  const saveBtn=$('#saveManualOrderBtn');saveBtn.disabled=true;saveBtn.textContent='กำลังบันทึก...';
  try{
    let saved;
    if(remoteEnabled()){
      saved=await api().createAdminOrder(adminToken,order);
      if(!saved?.orderNo)throw new Error('ยังตรวจสอบการบันทึกไม่สำเร็จ');
      remoteOrders.unshift(saved);
    }else{
      const now=new Date().toISOString(),expanded=items.map(i=>({...i,name:'เสื้อที่ระลึก',price:priceForSize(i.size),lineTotal:priceForSize(i.size)*i.qty}));
      const subtotal=expanded.reduce((sum,i)=>sum+i.lineTotal,0);
      saved={...order,items:expanded,subtotal,shippingFee:shipping==='shipping'?shippingFee:0,total:subtotal+(shipping==='shipping'?shippingFee:0),createdAt:now,updatedAt:now,verifiedAt:order.status==='paid'?now:null,paidAt:order.status==='paid'?now:null};
      const existing=getOrders();existing.unshift(saved);if(!saveLocalOrders(existing))throw new Error('บันทึกข้อมูลในเบราว์เซอร์ไม่สำเร็จ');
    }
    $('#manualOrderDialog').close();filterStatus='all';$('#statusFilter').value='all';searchText='';$('#searchInput').value='';renderAll();toast(`เพิ่มออเดอร์ ${saved.orderNo} แล้ว`);
  }catch(err){toast(err.message||'เพิ่มออเดอร์ไม่สำเร็จ กรุณาตรวจสอบก่อนลองใหม่');}
  finally{saveBtn.disabled=false;saveBtn.textContent='บันทึกออเดอร์';}
}

function openOrderSummary(){
  // Order roll-up is the confirmed-sales list for the whole shop, independent of the active status tab.
  const sourceOrders=getOrders();
  const orders=summaryEligibleOrders(sourceOrders);
  if(!orders.length) return toast('ไม่มีออเดอร์ที่ชำระเงินแล้วในรายการที่กรอง');
  const excludedCount=sourceOrders.length-orders.length;
  const totals=summarySizeTotals(orders);
  $('#summaryGeneratedAt').textContent=`พิมพ์เมื่อ ${formatDate(new Date())} • เฉพาะชำระเงินแล้วและจัดส่งแล้ว${excludedCount?` • ไม่นับ ${excludedCount} ออเดอร์`:''}`;
  $('#summarySizeTotals').innerHTML=`<div class="summary-total-title">รวมเสื้อ ${totalShirts(orders).toLocaleString('th-TH')} ตัว / ${orders.length.toLocaleString('th-TH')} ออเดอร์</div><div class="summary-size-chips">${totals.map(([s,q])=>`<span><b>${esc(s)}</b> ${Number(q).toLocaleString('th-TH')} ตัว</span>`).join('')}</div>`;
  $('#summaryOrderLines').innerHTML=orders.map((o,i)=>`<div class="summary-order-line"><span class="summary-order-no">${i+1}.</span><div><b>${esc(displayCustomerName(o.customer?.name))}</b><span>${esc(groupedSizeSummary(o))}</span><em>${esc(paymentLineLabel(o))}</em><strong>${esc(receiveLineLabel(o))}</strong></div></div>`).join('');
  $('#summaryFooter').textContent=`รวม ${orders.length.toLocaleString('th-TH')} ออเดอร์ • เสื้อ ${totalShirts(orders).toLocaleString('th-TH')} ตัว • เฉพาะชำระเงินแล้ว`;
  currentSummaryText=orders.map(compactOrderLine).join('\n');
  $('#summaryDialog').showModal();
}
async function copyOrderSummary(){
  if(!currentSummaryText) return toast('ไม่มีรายการให้คัดลอก');
  try{ await navigator.clipboard.writeText(currentSummaryText); toast('คัดลอกรายการแล้ว'); }
  catch{ const ta=document.createElement('textarea'); ta.value=currentSummaryText; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('คัดลอกรายการแล้ว'); }
}
function printOrderSummary(){ document.body.classList.add('printing-order-summary'); setTimeout(()=>window.print(),50); }
window.addEventListener('afterprint',()=>document.body.classList.remove('printing-order-summary'));

function safeCsvCell(v){
  const raw=String(v??'');
  return '"'+(/^[\t\r\n ]*[=+@-]/.test(raw)?"'"+raw:raw).replace(/"/g,'""')+'"';
}
function downloadCsv(rows,prefix){
  const csv='\uFEFF'+rows.map(r=>r.map(safeCsvCell).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`${prefix}-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportShipping(){
  const orders=summaryEligibleOrders(filteredOrders()).filter(o=>o.shipping==='shipping');
  if(!orders.length)return toast('ไม่มีออเดอร์จัดส่งสำหรับส่งออก');
  const rows=[['เลขออเดอร์','วันสั่งซื้อ','ชื่อผู้รับ','เบอร์โทร','ที่อยู่จัดส่ง','รายการและไซส์','จำนวนเสื้อ','ยอดเงิน','สถานะ','เลขพัสดุ','สถานะพัสดุ','ตรวจสอบพัสดุล่าสุด','หมายเหตุภายใน']];
  orders.forEach(o=>rows.push([o.orderNo,formatDate(o.createdAt),o.customer?.name||'',o.customer?.phone||'',customerAddress(o),orderItemsSummary(o),totalShirts([o]),o.total,statusLabel(o.status),o.trackingNo||'',o.lastTrackStatus||'',formatDate(o.lastTrackAt),o.adminNote||'']));
  downloadCsv(rows,'ptk-shipping');
}
function exportCSV(){
  const orders=filteredOrders(); if(!orders.length)return toast('ไม่มีข้อมูลสำหรับส่งออก');
  const rows=[['เลขคำสั่งซื้อ','วันที่','ชื่อลูกค้า','เบอร์โทร','รายการ','ยอดรวม','วิธีรับ','สถานะ','เวลายืนยันชำระ']];
  orders.forEach(o=>rows.push([o.orderNo,formatDate(o.createdAt),o.customer?.name||'',o.customer?.phone||'',orderItemsSummary(o),Number(o.total||0),o.shipping==='shipping'?'จัดส่ง':'รับเอง',statusLabel(o.status),formatDate(o.verifiedAt)]));
  downloadCsv(rows,'ptk-orders');
}

$('#refreshBtn').onclick=()=>refreshOrders(true);
$('#summaryBtn').onclick=openOrderSummary;
$('#copySummaryBtn').onclick=copyOrderSummary;
$('#printSummaryBtn').onclick=printOrderSummary;
$('#exportBtn').onclick=exportCSV;
$('#shippingExportBtn').onclick=exportShipping;
$('#newOrderBtn').onclick=openManualOrder;
$('#addManualSize').onclick=()=>{$('#manualSizeRows').append(createSizeRow());updateManualTotal();};
$('#manualShipping').onchange=updateManualShipping;
$('#manualShippingFee').oninput=updateManualTotal;
$('#manualOrderForm').onsubmit=saveManualOrder;
$('#closeManualOrder').onclick=()=>$('#manualOrderDialog').close();
$('#closeLabelDialog').onclick=()=>$('#labelDialog').close();
$('#printLabelBtn').onclick=()=>{
  document.body.classList.add('printing-parcel-label');
  // CSS @page explicitly forces A4; all content is already laid out as whole A4 sheets.
  window.print();
};
$('#selectVisibleOrders').onchange=e=>{
  filteredOrders().filter(selectableForPrinting).forEach(o=>{
    if(e.target.checked)selectedOrderNos.add(o.orderNo);
    else selectedOrderNos.delete(o.orderNo);
  });
  renderAll();
};
$('#clearSelectedOrders').onclick=()=>{selectedOrderNos.clear();renderAll();};
$('#printSelectedShipping').onclick=()=>printSelectedLabels('shipping');
$('#printSelectedPickup').onclick=()=>printSelectedLabels('pickup');
$('#searchInput').oninput=e=>{searchText=e.target.value;renderAll();};
$('#statusFilter').onchange=e=>{filterStatus=e.target.value;renderAll();};
$('#closeDialog').onclick=()=>$('#orderDialog').close();
$('#closeSlipDialog').onclick=()=>$('#slipDialog').close();
$('#closeSummaryDialog').onclick=()=>$('#summaryDialog').close();
$('#orderDialog').addEventListener('click',e=>{if(e.target===$('#orderDialog'))$('#orderDialog').close();});
$('#slipDialog').addEventListener('click',e=>{if(e.target===$('#slipDialog'))$('#slipDialog').close();});
$('#summaryDialog').addEventListener('click',e=>{if(e.target===$('#summaryDialog'))$('#summaryDialog').close();});
$('#labelDialog').addEventListener('click',e=>{if(e.target===$('#labelDialog'))$('#labelDialog').close();});
$('#manualOrderDialog').addEventListener('click',e=>{if(e.target===$('#manualOrderDialog'))$('#manualOrderDialog').close();});
window.addEventListener('afterprint',()=>document.body.classList.remove('printing-parcel-label'));
$('#connectAdminBtn').onclick=()=>{
  const token=$('#adminTokenInput').value.trim();
  if(!token) return toast('กรุณากรอกรหัสหลังบ้าน');
  adminToken=token; sessionStorage.setItem('ptk-admin-token',token); $('#adminTokenInput').value=''; refreshOrders();
};
$('#adminTokenInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#connectAdminBtn').click();});
$('#forgetAdminBtn').onclick=()=>{adminToken='';sessionStorage.removeItem('ptk-admin-token');remoteOrders=[];refreshOrders();};

renderAll();
refreshOrders();
