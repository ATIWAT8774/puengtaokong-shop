const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const moneyNumber = n => Number(n || 0).toLocaleString('th-TH', {minimumFractionDigits:0,maximumFractionDigits:2});
const money = n => moneyNumber(n) + ' บาท';
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const STORAGE_KEY = 'ptk-orders';
const PAID_STATUSES = new Set(['paid','packing','shipped','ready_pickup','completed']);
const SIZE_ORDER = ['XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','7XL'];
let searchText = '';
let filterStatus = 'all';
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
function hasSlip(o){ return !!(o.slipUrl || o.slipData); }

function filteredOrders(){
  const q=searchText.trim().toLowerCase();
  return getOrders().slice().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).filter(o=>{
    if(filterStatus!=='all' && o.status!==filterStatus) return false;
    if(!q) return true;
    const hay=[o.orderNo,o.customer?.name,o.customer?.phone,o.customer?.email].filter(Boolean).join(' ').toLowerCase();
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
}

function statusSelect(o, cls='admin-status-select'){
  const waiting=o.status==='payment_review';
  const statuses=['payment_review','payment_rejected','paid','packing','shipped','ready_pickup','completed','cancelled'];
  return `<select class="${cls}" data-admin-status="${esc(o.orderNo)}" ${waiting?'disabled title="กรุณาตรวจสลิปก่อน"':''}>${statuses.map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}</select>`;
}
function verifyActions(o){
  if(o.status!=='payment_review' || !hasSlip(o)) return '';
  return `<div class="admin-pay-actions"><button class="btn mini confirm-pay" data-confirm-pay="${esc(o.orderNo)}"><svg class="icon"><use href="#i-check"></use></svg>ยืนยันชำระ</button><button class="btn mini reject-pay" data-reject-pay="${esc(o.orderNo)}">ปฏิเสธ</button></div>`;
}
function slipAction(o){ return hasSlip(o)?`<button class="btn mini ghost" data-slip="${esc(o.orderNo)}"><svg class="icon"><use href="#i-image"></use></svg>ดูสลิป</button>`:'<span class="muted">ยังไม่มีสลิป</span>'; }
function verifiedText(o){ return o.verifiedAt?`<small class="verified-time">ยืนยัน ${formatDate(o.verifiedAt)}</small>`:''; }

function renderDesktop(orders){
  $('#adminOrders').innerHTML=orders.map(o=>`<tr>
    <td><button class="link-btn" data-detail="${esc(o.orderNo)}"><b>${esc(o.orderNo)}</b></button><br><small>${formatDate(o.createdAt)}</small></td>
    <td>${esc(o.customer?.name||'-')}<br><small>${esc(o.customer?.phone||'-')}</small></td>
    <td>${esc(orderItemsSummary(o))}</td>
    <td><b>${money(o.total)}</b></td>
    <td>${o.shipping==='shipping'?'จัดส่ง':'รับเอง'}</td>
    <td><span class="status-badge ${o.status==='payment_rejected'?'status-rejected':''}">${statusLabel(o.status)}</span>${verifiedText(o)}<div class="admin-status-followup">${statusSelect(o,'admin-status-select')}</div></td>
    <td><div class="admin-slip-cell">${slipAction(o)}${verifyActions(o)}</div></td>
  </tr>`).join('');
}

function renderMobile(orders){
  $('#mobileOrders').innerHTML=orders.map(o=>`<article class="order-card">
    <div class="order-card-head"><div><strong>${esc(o.orderNo)}</strong><small>${formatDate(o.createdAt)}</small></div><span class="status-badge ${o.status==='payment_rejected'?'status-rejected':''}">${statusLabel(o.status)}</span></div>
    <div class="order-card-grid">
      <div class="order-card-kv"><span>ลูกค้า</span><b>${esc(o.customer?.name||'-')}</b></div>
      <div class="order-card-kv"><span>โทรศัพท์</span><b>${esc(o.customer?.phone||'-')}</b></div>
      <div class="order-card-kv"><span>ยอดรวม</span><b>${money(o.total)}</b></div>
      <div class="order-card-kv"><span>วิธีรับ</span><b>${o.shipping==='shipping'?'จัดส่ง':'รับเอง'}</b></div>
      <div class="order-card-kv" style="grid-column:1/-1"><span>รายการ</span><b>${esc(orderItemsSummary(o))}</b></div>
    </div>
    ${verifiedText(o)}
    <div style="margin-top:8px">${statusSelect(o)}</div>
    <div class="order-card-actions"><button class="btn ghost" data-detail="${esc(o.orderNo)}">ดูรายละเอียด</button>${hasSlip(o)?`<button class="btn ghost" data-slip="${esc(o.orderNo)}"><svg class="icon"><use href="#i-image"></use></svg>ดูสลิป</button>`:''}${o.status==='payment_review'&&hasSlip(o)?`<button class="btn confirm-pay full-row" data-confirm-pay="${esc(o.orderNo)}"><svg class="icon"><use href="#i-check"></use></svg>ยืนยันชำระเงิน</button><button class="btn reject-pay full-row" data-reject-pay="${esc(o.orderNo)}">ปฏิเสธสลิป</button>`:''}</div>
  </article>`).join('');
}

function renderAll(){
  renderStats();
  const orders=filteredOrders();
  renderDesktop(orders); renderMobile(orders);
  $('#emptyState').hidden=orders.length!==0;
  bindRowActions();
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
  if(remoteEnabled()){
    const updated=await api().updateStatus(adminToken,orderNo,status);
    const i=remoteOrders.findIndex(o=>o.orderNo===orderNo); if(i>=0) remoteOrders[i]=updated;
  }else{
    const all=getOrders(), i=all.findIndex(o=>o.orderNo===orderNo); if(i<0) throw new Error('ไม่พบออเดอร์');
    all[i].status=status; if(status==='paid'&&!all[i].verifiedAt) all[i].verifiedAt=new Date().toISOString();
    saveLocalOrders(all);
  }
}

function bindRowActions(){
  $$('[data-admin-status]').forEach(sel=>sel.onchange=async()=>{
    const old=sel.dataset.oldValue || '';
    sel.disabled=true;
    try{ await updateOrderStatus(sel.dataset.adminStatus,sel.value); toast('อัปเดตสถานะแล้ว'); renderAll(); }
    catch(err){ toast(err.message || 'อัปเดตสถานะไม่สำเร็จ'); if(old) sel.value=old; }
    finally{ sel.disabled=false; }
  });
  $$('[data-admin-status]').forEach(sel=>{sel.dataset.oldValue=sel.value;});
  $$('[data-slip]').forEach(btn=>btn.onclick=()=>openSlip(btn.dataset.slip));
  $$('[data-detail]').forEach(btn=>btn.onclick=()=>openDetail(btn.dataset.detail));
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
function openDetail(orderNo){
  const o=getOrders().find(x=>x.orderNo===orderNo); if(!o)return;
  const c=o.customer||{};
  $('#dialogTitle').textContent=o.orderNo;
  $('#dialogBody').innerHTML=`
    <section class="detail-section"><h3>ข้อมูลลูกค้า</h3><div class="order-kv"><span>ชื่อ</span><b>${esc(c.name||'-')}</b></div><div class="order-kv"><span>โทรศัพท์</span><b>${esc(c.phone||'-')}</b></div>${c.email?`<div class="order-kv"><span>อีเมล</span><b>${esc(c.email)}</b></div>`:''}<div class="order-kv"><span>วิธีรับสินค้า</span><b>${o.shipping==='shipping'?'จัดส่งสินค้า':'รับด้วยตัวเอง'}</b></div>${o.shipping==='shipping'?`<div class="order-kv"><span>ที่อยู่</span><b>${esc(customerAddress(o)||'-')}</b></div>`:''}</section>
    <section class="detail-section"><h3>รายการสินค้า</h3><div class="detail-items">${(o.items||[]).map(i=>`<div class="detail-item"><span>${esc(i.name||'เสื้อที่ระลึก')} / ${esc(i.size||'-')} × ${Number(i.qty||1)}</span><b>${money(i.lineTotal ?? Number(i.price||0)*Number(i.qty||1))}</b></div>`).join('')||'<span class="muted">ไม่มีรายการสินค้า</span>'}</div><div class="order-kv"><span>ค่าจัดส่ง</span><b>${money(o.shippingFee)}</b></div><div class="order-kv"><span>ยอดรวม</span><b class="detail-total">${money(o.total)}</b></div></section>
    <section class="detail-section"><h3>การชำระเงิน</h3><div class="order-kv"><span>สถานะ</span><b>${statusLabel(o.status)}</b></div><div class="order-kv"><span>เวลาที่ลูกค้าแจ้งโอน</span><b>${formatDate(o.paidAt)}</b></div>${o.verifiedAt?`<div class="order-kv"><span>ยืนยันการชำระเงิน</span><b>${formatDate(o.verifiedAt)}</b></div>`:''}</section>`;
  $('#orderDialog').showModal();
}

function openOrderSummary(){
  const orders=filteredOrders();
  if(!orders.length) return toast('ไม่มีออเดอร์สำหรับรวมรายการ');
  const totals=summarySizeTotals(orders);
  $('#summaryGeneratedAt').textContent=`พิมพ์เมื่อ ${formatDate(new Date())}`;
  $('#summarySizeTotals').innerHTML=`<div class="summary-total-title">รวมเสื้อ ${totalShirts(orders).toLocaleString('th-TH')} ตัว / ${orders.length.toLocaleString('th-TH')} ออเดอร์</div><div class="summary-size-chips">${totals.map(([s,q])=>`<span><b>${esc(s)}</b> ${Number(q).toLocaleString('th-TH')} ตัว</span>`).join('')}</div>`;
  $('#summaryOrderLines').innerHTML=orders.map((o,i)=>`<div class="summary-order-line"><span class="summary-order-no">${i+1}.</span><div><b>${esc(displayCustomerName(o.customer?.name))}</b><span>${esc(groupedSizeSummary(o))}</span><em>${esc(paymentLineLabel(o))}</em><strong>${esc(receiveLineLabel(o))}</strong></div></div>`).join('');
  $('#summaryFooter').textContent=`รวม ${orders.length.toLocaleString('th-TH')} ออเดอร์ • เสื้อ ${totalShirts(orders).toLocaleString('th-TH')} ตัว`;
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

function exportCSV(){
  const orders=filteredOrders(); if(!orders.length)return toast('ไม่มีข้อมูลสำหรับส่งออก');
  const rows=[['เลขคำสั่งซื้อ','วันที่','ชื่อลูกค้า','เบอร์โทร','รายการ','ยอดรวม','วิธีรับ','สถานะ','เวลายืนยันชำระ']];
  orders.forEach(o=>rows.push([o.orderNo,formatDate(o.createdAt),o.customer?.name||'',o.customer?.phone||'',orderItemsSummary(o),Number(o.total||0),o.shipping==='shipping'?'จัดส่ง':'รับเอง',statusLabel(o.status),formatDate(o.verifiedAt)]));
  const csv='\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}), url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url;a.download=`ptk-orders-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

$('#refreshBtn').onclick=()=>refreshOrders(true);
$('#summaryBtn').onclick=openOrderSummary;
$('#copySummaryBtn').onclick=copyOrderSummary;
$('#printSummaryBtn').onclick=printOrderSummary;
$('#exportBtn').onclick=exportCSV;
$('#searchInput').oninput=e=>{searchText=e.target.value;renderAll();};
$('#statusFilter').onchange=e=>{filterStatus=e.target.value;renderAll();};
$('#closeDialog').onclick=()=>$('#orderDialog').close();
$('#closeSlipDialog').onclick=()=>$('#slipDialog').close();
$('#closeSummaryDialog').onclick=()=>$('#summaryDialog').close();
$('#orderDialog').addEventListener('click',e=>{if(e.target===$('#orderDialog'))$('#orderDialog').close();});
$('#slipDialog').addEventListener('click',e=>{if(e.target===$('#slipDialog'))$('#slipDialog').close();});
$('#summaryDialog').addEventListener('click',e=>{if(e.target===$('#summaryDialog'))$('#summaryDialog').close();});
$('#connectAdminBtn').onclick=()=>{
  const token=$('#adminTokenInput').value.trim();
  if(!token) return toast('กรุณากรอกรหัสหลังบ้าน');
  adminToken=token; sessionStorage.setItem('ptk-admin-token',token); $('#adminTokenInput').value=''; refreshOrders();
};
$('#adminTokenInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#connectAdminBtn').click();});
$('#forgetAdminBtn').onclick=()=>{adminToken='';sessionStorage.removeItem('ptk-admin-token');remoteOrders=[];refreshOrders();};

renderAll();
refreshOrders();
