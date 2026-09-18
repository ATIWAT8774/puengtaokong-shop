const CONFIG = {
  storeName: 'ศาลเจ้าปึงเฒ่ากง',
  storeTagline: 'เสื้อที่ระลึก • ชายทะเลบางสะพาน',
  supportPhone: '08X-XXX-XXXX',
  bank: {
    name: 'พร้อมเพย์',
    accountName: 'นายอธิวัฒน์ ทิมทอง',
    accountNumber: '092-440-6151'
  },
  payment: {
    promptPayId: '0924406151',
    promptPayName: 'นายอธิวัฒน์ ทิมทอง'
  },
  shippingFee: 50,
  pickupLabel: 'รับด้วยตัวเอง',
  pickupDetail: 'รับได้ที่ศาลเจ้าปึงเฒ่ากง / จุดรับที่กำหนด (ฟรี)',
  shippingLabel: 'จัดส่งสินค้า',
  shippingDetail: 'จัดส่งทางไปรษณีย์ / ขนส่งเอกชน',
  product: {
    id: 'memorial-shirt-001',
    name: 'เสื้อที่ระลึก ศาลเจ้าปึงเฒ่ากง',
    subtitle: 'ชายทะเลบางสะพาน',
    price: 200,
    sizes: ['XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL'],
    description: 'เสื้อที่ระลึกโทนชมพู–ขาว ลายเจ้าแม่กวนอิม ด้านหลังเป็นลวดลายศาลเจ้าและบรรยากาศชายทะเลบางสะพาน',
    images: ['./assets/shirt-front.webp','./assets/shirt-back.webp','./assets/size-guide.webp'],
    imageLabels: ['ด้านหน้า','ด้านหลัง','ตารางไซส์']
  }
};

const THAI_ADDRESS_SOURCES = [
  'https://cdn.jsdelivr.net/gh/thailand-geography-data/thailand-geography-json@main/src/geography.json',
  'https://raw.githubusercontent.com/thailand-geography-data/thailand-geography-json/main/src/geography.json'
];
let thaiAddressIndex = null;
let thaiAddressPromise = null;

function normalizeThaiAddressRows(data){
  const rows = [];
  if(!Array.isArray(data)) return rows;
  // Flat geography.json: provinceNameTh / districtNameTh / subdistrictNameTh / postalCode
  if(data.length && ('provinceNameTh' in data[0] || 'province' in data[0])){
    for(const x of data){
      const province = String(x.provinceNameTh ?? x.province ?? '').trim();
      const district = String(x.districtNameTh ?? x.district ?? '').trim();
      const subdistrict = String(x.subdistrictNameTh ?? x.subdistrict ?? '').trim();
      const postalCode = String(x.postalCode ?? x.zip_code ?? x.zipcode ?? '').trim();
      if(province && district && subdistrict) rows.push({province,district,subdistrict,postalCode});
    }
    return rows;
  }
  // Nested datasets such as province_with_district_and_sub_district.json
  for(const p of data){
    const province = String(p.name_th ?? p.provinceNameTh ?? p.name ?? '').trim();
    const districts = p.districts ?? p.amphure ?? p.amphures ?? [];
    for(const d of districts){
      const district = String(d.name_th ?? d.districtNameTh ?? d.name ?? '').trim();
      const subs = d.sub_districts ?? d.subdistricts ?? d.tambon ?? d.tambons ?? [];
      for(const sd of subs){
        const subdistrict = String(sd.name_th ?? sd.subdistrictNameTh ?? sd.name ?? '').trim();
        const postalCode = String(sd.zip_code ?? sd.postalCode ?? sd.zipcode ?? '').trim();
        if(province && district && subdistrict) rows.push({province,district,subdistrict,postalCode});
      }
    }
  }
  return rows;
}
function buildThaiAddressIndex(rows){
  const provinces = new Map();
  for(const r of rows){
    if(!provinces.has(r.province)) provinces.set(r.province,new Map());
    const districts = provinces.get(r.province);
    if(!districts.has(r.district)) districts.set(r.district,new Map());
    const subs = districts.get(r.district);
    if(!subs.has(r.subdistrict)) subs.set(r.subdistrict,new Set());
    if(r.postalCode) subs.get(r.subdistrict).add(r.postalCode);
  }
  return provinces;
}
async function loadThaiAddressIndex(){
  if(thaiAddressIndex) return thaiAddressIndex;
  if(thaiAddressPromise) return thaiAddressPromise;
  thaiAddressPromise = (async()=>{
    let lastError;
    for(const url of THAI_ADDRESS_SOURCES){
      try{
        const res = await fetch(url,{cache:'force-cache'});
        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rows = normalizeThaiAddressRows(json);
        if(rows.length < 7000) throw new Error('ฐานข้อมูลที่อยู่ไม่ครบ');
        thaiAddressIndex = buildThaiAddressIndex(rows);
        return thaiAddressIndex;
      }catch(err){ lastError=err; }
    }
    throw lastError || new Error('โหลดฐานข้อมูลที่อยู่ไม่สำเร็จ');
  })();
  try { return await thaiAddressPromise; }
  catch(err){ thaiAddressPromise=null; throw err; }
}
function sortedThai(values){
  return [...values].sort((a,b)=>String(a).localeCompare(String(b),'th'));
}
function setSelectOptions(select, placeholder, values){
  select.innerHTML = `<option value="">${esc(placeholder)}</option>` + values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
}
async function initThaiAddressSelectors(){
  const provinceEl = document.querySelector('[data-address-province]');
  const districtEl = document.querySelector('[data-address-district]');
  const subdistrictEl = document.querySelector('[data-address-subdistrict]');
  const postalEl = document.querySelector('[data-address-postal]');
  const statusEl = document.querySelector('[data-address-status]');
  if(!provinceEl || !districtEl || !subdistrictEl || !postalEl) return;
  try{
    const index = await loadThaiAddressIndex();
    // The form may have been re-rendered while data was loading.
    if(!document.body.contains(provinceEl)) return;
    setSelectOptions(provinceEl,'เลือกจังหวัด',sortedThai(index.keys()));
    provinceEl.disabled=false;
    if(statusEl) statusEl.textContent='เลือกจังหวัด → อำเภอ/เขต → ตำบล/แขวง ระบบจะใส่รหัสไปรษณีย์ให้อัตโนมัติ';
    provinceEl.onchange=()=>{
      const districts=index.get(provinceEl.value);
      setSelectOptions(districtEl,'เลือกอำเภอ / เขต',districts ? sortedThai(districts.keys()) : []);
      districtEl.disabled=!districts;
      setSelectOptions(subdistrictEl,'เลือกตำบล / แขวง',[]);
      subdistrictEl.disabled=true;
      postalEl.value='';
    };
    districtEl.onchange=()=>{
      const districts=index.get(provinceEl.value);
      const subs=districts?.get(districtEl.value);
      setSelectOptions(subdistrictEl,'เลือกตำบล / แขวง',subs ? sortedThai(subs.keys()) : []);
      subdistrictEl.disabled=!subs;
      postalEl.value='';
    };
    subdistrictEl.onchange=()=>{
      const codes=index.get(provinceEl.value)?.get(districtEl.value)?.get(subdistrictEl.value);
      postalEl.value=codes?.size ? sortedThai(codes)[0] : '';
    };
  }catch(err){
    if(!document.body.contains(provinceEl)) return;
    // Keep checkout usable even if the public address dataset cannot be reached.
    setSelectOptions(provinceEl,'เลือกจังหวัด',THAI_PROVINCES);
    provinceEl.disabled=false;
    districtEl.outerHTML='<input name="district" required placeholder="กรอกอำเภอ / เขต">';
    subdistrictEl.outerHTML='<input name="subdistrict" required placeholder="กรอกตำบล / แขวง">';
    postalEl.readOnly=false;
    postalEl.placeholder='กรอกรหัสไปรษณีย์ 5 หลัก';
    if(statusEl) statusEl.textContent='โหลดฐานข้อมูลที่อยู่อัตโนมัติไม่สำเร็จ กรุณากรอกอำเภอ ตำบล และรหัสไปรษณีย์ด้วยตนเอง';
  }
}

const THAI_PROVINCES = ['กรุงเทพมหานคร','กระบี่','กาญจนบุรี','กาฬสินธุ์','กำแพงเพชร','ขอนแก่น','จันทบุรี','ฉะเชิงเทรา','ชลบุรี','ชัยนาท','ชัยภูมิ','ชุมพร','เชียงราย','เชียงใหม่','ตรัง','ตราด','ตาก','นครนายก','นครปฐม','นครพนม','นครราชสีมา','นครศรีธรรมราช','นครสวรรค์','นนทบุรี','นราธิวาส','น่าน','บึงกาฬ','บุรีรัมย์','ปทุมธานี','ประจวบคีรีขันธ์','ปราจีนบุรี','ปัตตานี','พระนครศรีอยุธยา','พะเยา','พังงา','พัทลุง','พิจิตร','พิษณุโลก','เพชรบุรี','เพชรบูรณ์','แพร่','ภูเก็ต','มหาสารคาม','มุกดาหาร','แม่ฮ่องสอน','ยโสธร','ยะลา','ร้อยเอ็ด','ระนอง','ระยอง','ราชบุรี','ลพบุรี','ลำปาง','ลำพูน','เลย','ศรีสะเกษ','สกลนคร','สงขลา','สตูล','สมุทรปราการ','สมุทรสงคราม','สมุทรสาคร','สระแก้ว','สระบุรี','สิงห์บุรี','สุโขทัย','สุพรรณบุรี','สุราษฎร์ธานี','สุรินทร์','หนองคาย','หนองบัวลำภู','อ่างทอง','อำนาจเจริญ','อุดรธานี','อุตรดิตถ์','อุทัยธานี','อุบลราชธานี'];

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = n => Number(n || 0).toLocaleString('th-TH') + ' บาท';
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const icon = (name, cls='') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

const BANGKOK_TZ = 'Asia/Bangkok';
function bangkokParts(value = new Date()){
  const d = value instanceof Date ? value : new Date(value);
  if(Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone:BANGKOK_TZ, day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(d).reduce((o,x)=>(o[x.type]=x.value,o),{});
  return parts;
}
function formatThaiDateTime(value){
  const x = bangkokParts(value);
  if(!x) return '-';
  return `${x.day}/${x.month}/${Number(x.year)+543} ${x.hour}:${x.minute}`;
}
function currentThaiDateBE(){
  const x=bangkokParts(new Date());
  return `${x.day}/${x.month}/${Number(x.year)+543}`;
}
function currentThaiTime24(){
  const x=bangkokParts(new Date());
  return `${x.hour}:${x.minute}`;
}
function parseThaiTransferDateTime(dateText,timeText){
  const dm=String(dateText||'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!dm) throw new Error('กรุณากรอกวันที่แบบ วัน/เดือน/ปี พ.ศ. เช่น 19/09/2569');
  let day=Number(dm[1]), month=Number(dm[2]), buddhistYear=Number(dm[3]);
  if(buddhistYear < 2400 || buddhistYear > 2800) throw new Error('กรุณาระบุปีเป็น พ.ศ. 4 หลัก');
  const year=buddhistYear-543;
  const tm=String(timeText||'').trim().match(/^(\d{1,2}):(\d{2})$/);
  if(!tm) throw new Error('กรุณากรอกเวลาแบบ 24 ชั่วโมง เช่น 16:30');
  const hour=Number(tm[1]), minute=Number(tm[2]);
  if(hour<0 || hour>23 || minute<0 || minute>59) throw new Error('เวลาไม่ถูกต้อง กรุณาใช้รูปแบบ 00:00–23:59');
  const check=new Date(Date.UTC(year,month-1,day));
  if(check.getUTCFullYear()!==year || check.getUTCMonth()!==month-1 || check.getUTCDate()!==day) throw new Error('วันที่โอนเงินไม่ถูกต้อง');
  const yyyy=String(year).padStart(4,'0'), mm=String(month).padStart(2,'0'), dd=String(day).padStart(2,'0');
  const hh=String(hour).padStart(2,'0'), mi=String(minute).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00+07:00`;
}


function emv(id, value){
  value = String(value);
  return id + String(value.length).padStart(2,'0') + value;
}
function crc16ccitt(text){
  let crc = 0xFFFF;
  for(let i=0;i<text.length;i++){
    crc ^= text.charCodeAt(i) << 8;
    for(let j=0;j<8;j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
    crc &= 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}
function normalizePromptPayId(raw){
  const digits = String(raw || '').replace(/\D/g,'');
  if(/^0\d{9}$/.test(digits)) return {tag:'01', value:'0066' + digits.slice(1), display:digits.replace(/(\d{3})(\d{3})(\d{4})/,'$1-$2-$3')};
  if(/^\d{13}$/.test(digits)) return {tag:'02', value:digits, display:digits.replace(/(\d)(\d{4})(\d{5})(\d{2})(\d)/,'$1-$2-$3-$4-$5')};
  if(/^\d{15}$/.test(digits)) return {tag:'03', value:digits, display:digits};
  throw new Error('เลขพร้อมเพย์ต้องเป็นเบอร์มือถือไทย 10 หลัก หรือเลข 13 หลัก');
}
function buildPromptPayPayload(promptPayId, amount){
  const target = normalizePromptPayId(promptPayId);
  const numericAmount = Number(amount);
  if(!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('ยอดชำระไม่ถูกต้อง');
  const merchantInfo = emv('00','A000000677010111') + emv(target.tag,target.value);
  const body = emv('00','01') + emv('01','12') + emv('29',merchantInfo) + emv('53','764') + emv('54',numericAmount.toFixed(2)) + emv('58','TH') + '6304';
  return {payload: body + crc16ccitt(body), display: target.display};
}
function qrSvg(payload){
  if(typeof PTKQRCode !== 'function' || !window.PTKQRErrorCorrectLevel) throw new Error('โหลดตัวสร้าง QR ไม่สำเร็จ');
  const qr = new PTKQRCode(-1, PTKQRErrorCorrectLevel.M);
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  const size = count + quiet * 2;
  let path = '';
  for(let r=0;r<count;r++){
    for(let c=0;c<count;c++) if(qr.isDark(r,c)) path += `M${c+quiet} ${r+quiet}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" aria-hidden="true"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#111"/></svg>`;
}
function renderPaymentQR(amount){
  const qrEl = $('#paymentQr'), errEl = $('#paymentQrError'), displayEl = $('#promptPayDisplay'), amountEl = $('#qrAmount'), downloadBtn = $('#downloadQrBtn');
  if(!qrEl) return;
  amountEl.textContent = Number(amount || 0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' บาท';
  qrEl.innerHTML = '';
  errEl.hidden = true;
  downloadBtn.disabled = true;
  try{
    const result = buildPromptPayPayload(state.config.payment?.promptPayId, amount);
    qrEl.innerHTML = qrSvg(result.payload);
    displayEl.textContent = result.display;
    qrEl.dataset.payload = result.payload;
    downloadBtn.disabled = false;
  }catch(err){
    displayEl.textContent = 'ยังไม่ได้ตั้งค่า';
    errEl.textContent = err.message + ' — ใส่เลขพร้อมเพย์ใน CONFIG.payment.promptPayId ที่ไฟล์ app.js';
    errEl.hidden = false;
    qrEl.innerHTML = `<div class="muted" style="padding:18px;text-align:center">ยังไม่สามารถสร้าง QR ได้</div>`;
  }
}
function downloadPaymentQR(){
  const svg = $('#paymentQr svg');
  if(!svg) return toast('ยังไม่มี QR สำหรับบันทึก');
  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], {type:'image/svg+xml;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `promptpay-${Number(cartSubtotal() + (state.shipping==='shipping' ? state.config.shippingFee : 0)).toFixed(2)}.svg`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function readJSON(key, fallback){
  try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
  catch { return fallback; }
}
function writeJSON(key, value){
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
function getOrders(){ return readJSON('ptk-orders', []); }
function saveOrders(orders){ return writeJSON('ptk-orders', orders); }
function sheetApi(){ return window.PTKSheetAPI; }
function remoteEnabled(){ return !!sheetApi()?.isConfigured?.(); }
function setBusy(btn, busy, busyText='กำลังบันทึก...'){
  if(!btn) return;
  if(busy){ btn.dataset.oldHtml=btn.innerHTML; btn.disabled=true; btn.textContent=busyText; }
  else { btn.disabled=false; if(btn.dataset.oldHtml){ btn.innerHTML=btn.dataset.oldHtml; delete btn.dataset.oldHtml; } }
}

const state = {
  config: CONFIG,
  cart: readJSON('ptk-cart', []),
  size: 'M', qty: 1, shipping: 'pickup', customer: null,
  currentOrder: null, slipData: null, lastRoute: 'home'
};

function toast(msg){
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}
function saveCart(){ writeJSON('ptk-cart', state.cart); renderCartBadge(); }
function renderCartBadge(){
  const n = state.cart.reduce((s,i) => s + i.qty, 0);
  $('#cartBadge').textContent = n;
  $('#cartBadge').style.display = n ? 'grid' : 'none';
}
function route(name, push=true){
  if (!$(`#${name}View`)) name = 'home';
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `${name}View`));
  $$('[data-route]').forEach(b => b.classList.toggle('active', b.dataset.route === name));
  if (push) location.hash = name;
  state.lastRoute = name;
  window.scrollTo({top:0,behavior:'smooth'});
  if(name === 'cart') renderCart();
  if(name === 'checkout') renderCheckout();
  if(name === 'track') prefillTrack();
}
window.addEventListener('hashchange', () => route((location.hash || '#home').slice(1), false));
document.addEventListener('click', e => {
  const r = e.target.closest('[data-route]');
  if(r){ e.preventDefault(); route(r.dataset.route); }
  const b = e.target.closest('[data-back]');
  if(b){ e.preventDefault(); history.length > 1 ? history.back() : route('home'); }
});

function hydrateConfig(){
  const c = state.config, p = c.product;
  $('#heroPrice').textContent = p.price;
  $('#homeProductName').textContent = p.name;
  $('#homeProductSubtitle').textContent = p.subtitle;
  $('#homeProductPrice').textContent = p.price;
  $('#homeProductDescription').textContent = p.description;
  $('#homeProductImg').src = p.images[0];
  $('#bankAccountName').textContent = c.bank.accountName;
  $('#bankAccountNumber').textContent = c.bank.accountNumber;
  document.title = `${c.storeName} | ${p.name}`;
}
function renderProduct(){
  const p = state.config.product;
  $('#productName').textContent = p.name;
  $('#productSubtitle').textContent = p.subtitle;
  $('#productPrice').textContent = p.price;
  $('#productDescription').textContent = p.description;
  setProductImage(p.images[0], 0);
  $('#thumbs').innerHTML = p.images.map((src,i) => `<button class="thumb ${i===0?'active':''}" data-img="${src}" data-img-index="${i}" aria-label="ดูภาพ${esc(p.imageLabels?.[i] || `สินค้า ${i+1}`)}"><img src="${src}" alt="${esc(p.imageLabels?.[i] || `ภาพสินค้า ${i+1}`)}" loading="lazy"></button>`).join('');
  $('#sizeGrid').innerHTML = p.sizes.map(s => `<button class="size-btn ${s===state.size?'selected':''}" data-size="${s}">${s}</button>`).join('');
  $$('[data-size]').forEach(b => b.onclick = () => { state.size = b.dataset.size; renderProduct(); });
  $$('[data-img]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.imgIndex || 0);
    setProductImage(b.dataset.img, i);
    $$('.thumb').forEach(x => x.classList.toggle('active', x === b));
  });
  $('#qtyValue').textContent = state.qty;
}
function setProductImage(src, index=0){
  const img = $('#productMainImg');
  img.src = src;
  img.alt = state.config.product.imageLabels?.[index] || 'ภาพสินค้า';
  img.classList.toggle('fit-contain', index === 2);
}
$('#qtyMinus').onclick = () => { state.qty = Math.max(1, state.qty-1); $('#qtyValue').textContent = state.qty; };
$('#qtyPlus').onclick = () => { state.qty = Math.min(20, state.qty+1); $('#qtyValue').textContent = state.qty; };
$('#addToCart').onclick = () => {
  const p = state.config.product;
  const found = state.cart.find(i => i.productId===p.id && i.size===state.size);
  if(found) found.qty = Math.min(99, found.qty + state.qty);
  else state.cart.push({productId:p.id,name:p.name,size:state.size,qty:state.qty,price:p.price,image:p.images[0]});
  saveCart(); toast('เพิ่มสินค้าลงตะกร้าแล้ว'); route('cart');
};
function cartSubtotal(){ return state.cart.reduce((s,i) => s + i.price*i.qty, 0); }
function renderCart(){
  const wrap = $('#cartItems');
  if(!state.cart.length){
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">${icon('cart','icon-xl')}</div><h2>ตะกร้ายังว่าง</h2><p>เลือกสินค้าและไซส์ก่อนนะ</p><button class="btn primary" data-route="product">${icon('shirt')}เลือกสินค้า</button></div>`;
    $('#checkoutBtn').disabled = true;
  } else {
    wrap.innerHTML = '<h2>สินค้าในตะกร้า</h2>' + state.cart.map((i,idx) => `<div class="cart-item"><img src="${i.image}" alt="${esc(i.name)}"><div><h3>${esc(i.name)}</h3><div class="muted">ขนาด ${esc(i.size)}</div><div class="item-actions"><div class="qty"><button data-dec="${idx}">−</button><span>${i.qty}</span><button data-inc="${idx}">+</button></div><button class="link-btn" data-remove="${idx}">ลบ</button></div></div><div><b style="color:var(--brand)">${money(i.price*i.qty)}</b></div></div>`).join('');
    $('#checkoutBtn').disabled = false;
    $$('[data-inc]').forEach(b => b.onclick = () => { state.cart[+b.dataset.inc].qty++; saveCart(); renderCart(); });
    $$('[data-dec]').forEach(b => b.onclick = () => { const i=state.cart[+b.dataset.dec]; i.qty--; if(i.qty<=0) state.cart.splice(+b.dataset.dec,1); saveCart(); renderCart(); });
    $$('[data-remove]').forEach(b => b.onclick = () => { state.cart.splice(+b.dataset.remove,1); saveCart(); renderCart(); });
  }
  const sub = cartSubtotal();
  $('#cartSubtotal').textContent = money(sub);
  $('#cartTotal').textContent = money(sub);
}
$('#checkoutBtn').onclick = () => state.cart.length ? route('checkout') : toast('กรุณาเลือกสินค้าก่อน');

function renderShipping(){
  const c = state.config;
  $('#shippingChoices').innerHTML = [
    ['pickup',c.pickupLabel,c.pickupDetail,'ฟรี'],
    ['shipping',c.shippingLabel,c.shippingDetail,`+${money(c.shippingFee)}`]
  ].map(([v,t,d,p]) => `<label class="ship-card ${state.shipping===v?'selected':''}"><input type="radio" name="shipping" value="${v}" ${state.shipping===v?'checked':''}><div><b>${t}</b><small>${d}</small><div style="color:var(--brand);font-weight:800;margin-top:4px">${p}</div></div></label>`).join('');
  $$('input[name="shipping"]').forEach(r => r.onchange = () => { state.shipping=r.value; renderCheckout(); });
}
function addressHTML(){
  if(state.shipping !== 'shipping') return `<div class="notice with-icon field full">${icon('pin','notice-icon')}<span>ระบบจะใช้จุดรับสินค้าตามประกาศของร้าน กรุณารอแจ้งวันและเวลารับสินค้าผ่านช่องทางที่ร้านกำหนด</span></div>`;
  return `<div class="field full"><label>ที่อยู่จัดส่ง <span class="required">*</span></label><textarea name="address" required placeholder="บ้านเลขที่ หมู่ ซอย ถนน"></textarea></div>
  <div class="field"><label>จังหวัด <span class="required">*</span></label><select name="province" data-address-province required disabled><option value="">กำลังโหลดจังหวัด...</option></select></div>
  <div class="field"><label>อำเภอ / เขต <span class="required">*</span></label><select name="district" data-address-district required disabled><option value="">เลือกจังหวัดก่อน</option></select></div>
  <div class="field"><label>ตำบล / แขวง <span class="required">*</span></label><select name="subdistrict" data-address-subdistrict required disabled><option value="">เลือกอำเภอ / เขตก่อน</option></select></div>
  <div class="field"><label>รหัสไปรษณีย์ <span class="required">*</span></label><input name="postalCode" data-address-postal inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required readonly placeholder="เลือกตำบล / แขวง"></div>
  <div class="address-helper field full" data-address-status>กำลังโหลดฐานข้อมูลที่อยู่ประเทศไทย...</div>`;
}
function renderCheckout(){
  renderShipping();
  $('#addressFields').innerHTML = addressHTML();
  $('#checkoutItems').innerHTML = state.cart.map(i => `<div class="summary-row"><span>${esc(i.name)} (${esc(i.size)}) × ${i.qty}</span><b>${money(i.price*i.qty)}</b></div>`).join('');
  const sub = cartSubtotal(), ship = state.shipping==='shipping' ? state.config.shippingFee : 0;
  $('#checkoutSubtotal').textContent = money(sub);
  $('#checkoutShipping').textContent = money(ship);
  $('#checkoutTotal').textContent = money(sub+ship);
  if(state.shipping === 'shipping') initThaiAddressSelectors();
}
function setupForms(){
  $('#checkoutForm').addEventListener('submit', e => {
    e.preventDefault();
    if(!state.cart.length) return route('cart');
    const fd = new FormData(e.currentTarget);
    state.customer = {
      name: fd.get('name').trim(), phone: fd.get('phone').trim(), shipping: state.shipping,
      address: fd.get('address')?.trim() || '', province: fd.get('province') || '',
      district: fd.get('district')?.trim() || '', subdistrict: fd.get('subdistrict')?.trim() || '',
      postalCode: fd.get('postalCode')?.trim() || ''
    };
    const total = cartSubtotal() + (state.shipping==='shipping' ? state.config.shippingFee : 0);
    $('#paymentTotal').textContent = money(total);
    renderPaymentQR(total);
    route('payment');
  });
  $('#trackForm').addEventListener('submit', async e => {
    e.preventDefault();
    const query = $('#trackQuery').value.trim();
    const out = $('#trackResult');
    const submit=e.currentTarget.querySelector('button[type="submit"],button:not([type])');
    if(!query) return toast('กรุณากรอกเลขออเดอร์หรือชื่อผู้จอง');
    setBusy(submit,true,'กำลังค้นหา...');
    try{
      let results=[];
      if(remoteEnabled()) results = await sheetApi().searchOrders(query);
      else {
        const q=query.toLocaleLowerCase('th-TH');
        results=getOrders().filter(x =>
          String(x.orderNo||'').toLocaleLowerCase('th-TH').includes(q) ||
          String(x.customer?.name||'').toLocaleLowerCase('th-TH').includes(q)
        ).slice(0,20);
      }
      renderTrackSearchResults(Array.isArray(results)?results:[]);
    }catch(err){
      out.innerHTML = `<div class="notice">${esc(err.message || 'ค้นหาคำสั่งซื้อไม่สำเร็จ')}</div>`;
    }finally{ setBusy(submit,false); }
  });
}
function makeOrderNo(){
  const d = new Date();
  const y = d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  const rand = String(Math.floor(Math.random()*1000000)).padStart(6,'0');
  return `PTK${y}${m}${day}${rand}`;
}
$('#downloadQrBtn').onclick = downloadPaymentQR;
$('#createOrderBtn').onclick = async () => {
  if(!state.customer) return route('checkout');
  try { buildPromptPayPayload(state.config.payment?.promptPayId, cartSubtotal() + (state.shipping==='shipping' ? state.config.shippingFee : 0)); }
  catch(err){ return toast('กรุณาตั้งค่าเลขพร้อมเพย์ให้ถูกต้องก่อนเปิดรับชำระเงิน'); }
  const btn=$('#createOrderBtn');
  setBusy(btn,true,'กำลังสร้างออเดอร์...');
  const shippingFee = state.shipping==='shipping' ? state.config.shippingFee : 0;
  const items = state.cart.map(i => ({...i,lineTotal:i.price*i.qty}));
  const order = {
    orderNo: makeOrderNo(), createdAt: new Date().toISOString(), customer: {...state.customer},
    shipping: state.shipping, items, subtotal: cartSubtotal(), shippingFee,
    total: cartSubtotal()+shippingFee, status:'pending_payment', paidAt:null, slipData:null
  };
  try{
    if(remoteEnabled()){
      state.currentOrder = await sheetApi().createOrder(order);
    }else{
      const orders = getOrders(); orders.unshift(order); saveOrders(orders); state.currentOrder = order;
    }
    writeJSON('ptk-last-order',{orderNo:state.currentOrder.orderNo,phone:state.customer.phone});
    route('slip');
  }catch(err){ toast(err.message || 'สร้างคำสั่งซื้อไม่สำเร็จ'); }
  finally{ setBusy(btn,false); }
};

const drop = $('#dropzone'), input = $('#slipInput');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); const f=e.dataTransfer.files[0]; if(f) handleSlip(f); });
input.addEventListener('change', () => input.files[0] && handleSlip(input.files[0]));
async function handleSlip(file){
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast('รองรับเฉพาะ JPG, PNG, WEBP');
  if(file.size > 8*1024*1024) return toast('ไฟล์ใหญ่เกิน 8 MB');
  try {
    state.slipData = await compressImage(file);
    $('#slipPreview').src = state.slipData;
    $('#slipPreview').hidden = false;
    toast('แนบสลิปแล้ว');
  } catch { toast('อ่านรูปสลิปไม่สำเร็จ'); }
}
function compressImage(file){
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const max = 1000;
        const scale = Math.min(1, max/Math.max(img.width,img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width*scale));
        canvas.height = Math.max(1, Math.round(img.height*scale));
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL('image/jpeg',0.68));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
$('#submitSlipBtn').onclick = async () => {
  if(!state.currentOrder) return toast('ไม่พบคำสั่งซื้อ');
  if(!state.slipData) return toast('กรุณาแนบรูปสลิป');
  const paidDate=$('#paidDate').value, paidTime=$('#paidTime').value;
  if(!paidDate || !paidTime) return toast('กรุณาระบุวันที่และเวลาโอน');
  let paidAt;
  try { paidAt=parseThaiTransferDateTime(paidDate,paidTime); }
  catch(err){ return toast(err.message || 'วันที่หรือเวลาไม่ถูกต้อง'); }
  const btn=$('#submitSlipBtn');
  setBusy(btn,true,'กำลังส่งสลิป...');
  try{
    if(remoteEnabled()){
      state.currentOrder = await sheetApi().uploadSlip({
        orderNo:state.currentOrder.orderNo,
        phone:state.currentOrder.customer.phone,
        paidAt,
        slipData:state.slipData
      });
    }else{
      const orders=getOrders();
      const i=orders.findIndex(o=>o.orderNo===state.currentOrder.orderNo);
      if(i<0) throw new Error('ไม่พบคำสั่งซื้อ');
      orders[i] = {...orders[i],status:'payment_review',paidAt,slipData:state.slipData,rejectedAt:null,verifiedAt:null,verifiedManually:false};
      if(!saveOrders(orders)){
        orders[i].slipData = null;
        saveOrders(orders);
        toast('พื้นที่เบราว์เซอร์เต็ม ระบบบันทึกออเดอร์ได้แต่ไม่เก็บรูปสลิป');
      }
      state.currentOrder = orders[i];
    }
    state.slipData=null;
    state.cart=[]; saveCart();
    $('#successOrderNo').textContent=state.currentOrder.orderNo;
    $('#successTotal').textContent=money(state.currentOrder.total);
    route('success');
  }catch(err){ toast(err.message || 'ส่งสลิปไม่สำเร็จ กรุณาลองใหม่'); }
  finally{ setBusy(btn,false); }
};

function prefillTrack(){
  const last=readJSON('ptk-last-order',null);
  const input=$('#trackQuery');
  if(last && input && !input.value) input.value=last.orderNo||'';
}
function statusLabel(s){ return ({pending_payment:'รอชำระเงิน',payment_review:'รอตรวจสอบสลิป',payment_rejected:'สลิปไม่ผ่านการตรวจสอบ',paid:'ยืนยันชำระเงินแล้ว',packing:'กำลังจัดสินค้า',shipped:'จัดส่งแล้ว',ready_pickup:'พร้อมรับสินค้า',completed:'สำเร็จ',cancelled:'ยกเลิก'}[s]||s); }
function orderItemsSummary(o){
  const items=Array.isArray(o.items)?o.items:[];
  return items.map(i=>`${esc(i.size)} × ${Number(i.qty||0)}`).join(' • ') || '-';
}
function trackResultCardMarkup(o){
  const stages=o.shipping==='shipping'?['paid','packing','shipped']:['paid','packing','ready_pickup'];
  let index=stages.includes(o.status)?stages.indexOf(o.status):o.status==='completed'?3:-1;
  const review=o.status==='payment_review';
  const rejected=o.status==='payment_rejected';
  return `<div class="panel track-result-card" style="box-shadow:none">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
      <div><b style="font-size:18px">${esc(o.orderNo)}</b><div class="muted">${esc(o.customer?.name||'-')} • ${formatThaiDateTime(o.createdAt)}</div></div>
      <span class="status-badge ${rejected?'status-rejected':''}">${statusLabel(o.status)}</span>
    </div>
    <div class="timeline">
      <div class="time-node ${index>=0?'done':review?'current':''}">${icon('check','timeline-icon')}<b>${review?'รอตรวจสลิป':'ชำระเงินแล้ว'}</b></div>
      <div class="time-node ${index>=1?'done':index===0?'current':''}">${icon('package','timeline-icon')}<b>จัดสินค้า</b></div>
      <div class="time-node ${index>=2?'done':index===1?'current':''}">${icon(o.shipping==='shipping'?'truck':'store','timeline-icon')}<b>${o.shipping==='shipping'?'ส่งสินค้า':'รับสินค้า'}</b></div>
    </div>
    <div class="order-kv"><span>รายการ</span><b>${orderItemsSummary(o)}</b></div>
    <div class="order-kv"><span>วิธีรับสินค้า</span><b>${o.shipping==='shipping'?'จัดส่ง':'รับหน้างาน'}</b></div>
    <div class="order-kv"><span>ยอดรวม</span><b>${money(o.total)}</b></div>
    <div class="order-kv"><span>สถานะล่าสุด</span><b>${statusLabel(o.status)}</b></div>
    ${o.verifiedAt?`<div class="order-kv"><span>ยืนยันการชำระเงินเมื่อ</span><b>${formatThaiDateTime(o.verifiedAt)}</b></div>`:''}
  </div>`;
}
function renderTrackSearchResults(results){
  const out=$('#trackResult');
  if(!results.length){
    out.innerHTML='<div class="notice">ไม่พบคำสั่งซื้อจากเลขออเดอร์หรือชื่อผู้จองที่ค้นหา</div>';
    return;
  }
  out.innerHTML=`<div class="track-result-head"><b>พบ ${results.length} รายการ</b><span class="muted">ค้นหาได้จากเลขออเดอร์หรือชื่อผู้จอง</span></div><div class="track-results">${results.map(trackResultCardMarkup).join('')}</div>`;
}
function renderTrackResult(o){
  const stages=o.shipping==='shipping'?['paid','packing','shipped']:['paid','packing','ready_pickup'];
  let index=stages.includes(o.status)?stages.indexOf(o.status):o.status==='completed'?3:-1;
  const review = o.status==='payment_review';
  const rejected = o.status==='payment_rejected';
  const paymentNote = review
    ? '<div class="notice with-icon" style="margin-top:14px"><svg class="icon notice-icon"><use href="#i-info"></use></svg><span>เจ้าหน้าที่กำลังตรวจสอบสลิป หากยอดและบัญชีผู้รับถูกต้องจะกดยืนยันการชำระเงินให้</span></div>'
    : rejected
      ? '<div class="notice payment-reject-note" style="margin-top:14px"><b>สลิปยังไม่ได้รับการยืนยัน</b><br><span>กรุณาตรวจสอบยอดเงินและแนบสลิปใหม่อีกครั้ง</span></div>'
      : '';
  const reupload = rejected ? '<button class="btn primary" id="reuploadSlipBtn"><svg class="icon"><use href="#i-image"></use></svg>แนบสลิปใหม่</button>' : '';
  const receiptLabel = ['paid','packing','shipped','ready_pickup','completed'].includes(o.status) ? 'ดูใบเสร็จ' : 'ดูสรุปคำสั่งซื้อ';
  $('#trackResult').innerHTML=`<div class="panel" style="box-shadow:none"><div style="display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap"><div><b style="font-size:20px">${esc(o.orderNo)}</b><div class="muted">สั่งเมื่อ ${formatThaiDateTime(o.createdAt)}</div></div><span class="status-badge ${rejected?'status-rejected':''}">${statusLabel(o.status)}</span></div>${paymentNote}<div class="timeline"><div class="time-node ${index>=0?'done':review?'current':''}">${icon('check','timeline-icon')}<b>${review?'รอตรวจสลิป':'ชำระเงินแล้ว'}</b></div><div class="time-node ${index>=1?'done':index===0?'current':''}">${icon('package','timeline-icon')}<b>จัดสินค้า</b></div><div class="time-node ${index>=2?'done':index===1?'current':''}">${icon(o.shipping==='shipping'?'truck':'store','timeline-icon')}<b>${o.shipping==='shipping'?'ส่งสินค้า':'รับสินค้า'}</b></div></div><div class="order-kv"><span>ชื่อผู้สั่ง</span><b>${esc(o.customer.name)}</b></div><div class="order-kv"><span>วิธีรับสินค้า</span><b>${o.shipping==='shipping'?'จัดส่ง':'รับด้วยตัวเอง'}</b></div><div class="order-kv"><span>ยอดรวม</span><b>${money(o.total)}</b></div><div class="order-kv"><span>สถานะล่าสุด</span><b>${statusLabel(o.status)}</b></div>${o.verifiedAt?`<div class="order-kv"><span>ยืนยันการชำระเงินเมื่อ</span><b>${formatThaiDateTime(o.verifiedAt)}</b></div>`:''}<div class="cta-row" style="margin-top:16px">${reupload}<button class="btn ghost" id="trackReceiptBtn">${icon('receipt')}${receiptLabel}</button></div></div>`;
  $('#trackReceiptBtn').onclick=()=>renderReceipt(o);
  const reBtn=$('#reuploadSlipBtn');
  if(reBtn) reBtn.onclick=()=>{
    state.currentOrder=o;
    state.slipData=null;
    $('#slipPreview').hidden=true;
    route('slip');
  };
}
$('#viewReceiptBtn').onclick=()=>renderReceipt(state.currentOrder);
function renderReceipt(o){
  if(!o) return;
  const c=state.config;
  const isPaid=['paid','packing','shipped','ready_pickup','completed'].includes(o.status);
  $('#receipt').innerHTML=`<div class="receipt-head"><div><img class="receipt-logo" src="./assets/logo.png" alt="${esc(c.storeName)}"><p class="muted">${isPaid?'ใบเสร็จรับเงิน':'สรุปคำสั่งซื้อ / รอตรวจสอบการชำระเงิน'}</p></div><div style="text-align:right"><b>${esc(o.orderNo)}</b><div class="muted">${formatThaiDateTime(o.createdAt)}</div></div></div><div class="order-kv"><span>ผู้สั่งซื้อ</span><b>${esc(o.customer.name)}</b></div><div class="order-kv"><span>เบอร์โทร</span><b>${esc(o.customer.phone)}</b></div><div class="order-kv"><span>วิธีรับสินค้า</span><b>${o.shipping==='shipping'?'จัดส่งสินค้า':'รับด้วยตัวเอง'}</b></div>${o.shipping==='shipping'?`<div class="order-kv"><span>ที่อยู่</span><b>${esc(`${o.customer.address} ${o.customer.subdistrict} ${o.customer.district} ${o.customer.province} ${o.customer.postalCode}`)}</b></div>`:''}<table><thead><tr><th>รายการ</th><th>จำนวน</th><th>ราคา</th></tr></thead><tbody>${o.items.map(i=>`<tr><td>${esc(i.name)} / ${esc(i.size)}</td><td>${i.qty}</td><td>${money(i.lineTotal)}</td></tr>`).join('')}<tr><td colspan="2">ค่าจัดส่ง</td><td>${money(o.shippingFee)}</td></tr><tr><td colspan="2"><b>รวมทั้งสิ้น</b></td><td><b style="color:var(--brand)">${money(o.total)}</b></td></tr></tbody></table><div class="bank-box"><b>สถานะ: ${statusLabel(o.status)}</b><br><span class="muted">กรุณาเก็บเลขคำสั่งซื้อไว้สำหรับติดตามสถานะ</span></div>`;
  route('receipt');
}

function init(){
  hydrateConfig(); renderProduct(); renderCartBadge(); setupForms();
  $('#paidDate').value=currentThaiDateBE();
  $('#paidTime').value=currentThaiTime24();
  route((location.hash||'#home').slice(1),false);
}
init();
