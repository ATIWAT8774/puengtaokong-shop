const PTK = {
  spreadsheetName: 'PTK Orders - ศาลเจ้าปึงเฒ่ากง',
  sheetName: 'Orders',
  slipFolderName: 'PTK Payment Slips',
  headers: [
    'orderNo','createdAt','updatedAt','name','phone','shipping','address',
    'itemsSummary','subtotal','shippingFee','total','status','paidAt','verifiedAt',
    'rejectedAt','slipFileId','slipUrl','customerJSON','itemsJSON'
  ],
  statuses: ['pending_payment','payment_review','payment_rejected','paid','packing','shipped','ready_pickup','completed','cancelled']
};

/**
 * รันฟังก์ชันนี้ 1 ครั้งจาก Apps Script Editor ก่อน Deploy
 * ระบบจะสร้าง Google Sheet, โฟลเดอร์เก็บสลิป และรหัสหลังบ้านให้อัตโนมัติ
 */
function setupProject() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty('SPREADSHEET_ID');
  let spreadsheet;
  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create(PTK.spreadsheetName);
    spreadsheetId = spreadsheet.getId();
    props.setProperty('SPREADSHEET_ID', spreadsheetId);
  }

  let folderId = props.getProperty('SLIP_FOLDER_ID');
  let folder;
  if (folderId) {
    folder = DriveApp.getFolderById(folderId);
  } else {
    folder = DriveApp.createFolder(PTK.slipFolderName);
    folderId = folder.getId();
    props.setProperty('SLIP_FOLDER_ID', folderId);
  }

  let adminToken = props.getProperty('ADMIN_TOKEN');
  if (!adminToken) {
    adminToken = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty('ADMIN_TOKEN', adminToken);
  }

  ensureOrdersSheet_();
  const result = {
    spreadsheetUrl: spreadsheet.getUrl(),
    slipFolderUrl: folder.getUrl(),
    adminToken: adminToken
  };
  console.log(JSON.stringify(result, null, 2));
  Logger.log(JSON.stringify(result));
  return result;
}

/** ใช้เมื่อมี Google Sheet อยู่แล้ว */
function useExistingSpreadsheet(spreadsheetId) {
  SpreadsheetApp.openById(spreadsheetId); // validate
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheetId);
  ensureOrdersSheet_();
  return SpreadsheetApp.openById(spreadsheetId).getUrl();
}

/** เปลี่ยนรหัสหลังบ้านได้จากตรงนี้ */
function setAdminToken(newToken) {
  newToken = String(newToken || '').trim();
  if (newToken.length < 6) throw new Error('รหัสหลังบ้านควรมีอย่างน้อย 6 ตัวอักษร');
  PropertiesService.getScriptProperties().setProperty('ADMIN_TOKEN', newToken);
  return 'ADMIN_TOKEN updated';
}

function doGet(e) {
  const body = parseRequest_(e, true);
  const result = handleRequest_(body);
  const callback = cleanCallback_((e && e.parameter && e.parameter.callback) || '');
  return callback ? javascript_(callback, result) : json_(result);
}

function doPost(e) {
  const body = parseRequest_(e, false);
  return json_(handleRequest_(body));
}

function parseRequest_(e, isGet) {
  try {
    // New browser-safe transport: action + payload form/query fields.
    const p = (e && e.parameter) || {};
    if (p.action) {
      let payload = {};
      if (p.payload) payload = JSON.parse(p.payload);
      return Object.assign({action:String(p.action || '')}, payload || {});
    }
    // Backward compatibility with the previous raw JSON POST transport.
    if (!isGet && e && e.postData && e.postData.contents) {
      return JSON.parse(e.postData.contents || '{}');
    }
    return {action:'ping'};
  } catch (err) {
    return {action:'__parse_error__', __parseError:String(err && err.message || err)};
  }
}

function handleRequest_(body) {
  try {
    body = body || {};
    if (body.action === '__parse_error__') throw new Error('อ่านข้อมูลคำขอไม่สำเร็จ: ' + body.__parseError);
    const action = String(body.action || 'ping');
    if (action === 'ping') return {ok:true, data:{connected:true, service:'PTK Google Sheets API', time:new Date().toISOString()}};
    if (action === 'createOrder') return {ok:true, data:createOrder_(body.order)};
    if (action === 'uploadSlip') return {ok:true, data:uploadSlip_(body)};
    if (action === 'getOrder') return {ok:true, data:getOrderPublic_(body.orderNo, body.phone)};
    if (action === 'searchOrders') return {ok:true, data:searchOrdersPublic_(body.query)};
    if (action === 'listOrders') { requireAdmin_(body.adminToken); return {ok:true, data:listOrders_()}; }
    if (action === 'updateStatus') { requireAdmin_(body.adminToken); return {ok:true, data:updateStatus_(body.orderNo, body.status)}; }
    if (action === 'confirmPayment') { requireAdmin_(body.adminToken); return {ok:true, data:confirmPayment_(body.orderNo)}; }
    if (action === 'rejectPayment') { requireAdmin_(body.adminToken); return {ok:true, data:rejectPayment_(body.orderNo)}; }
    throw new Error('ไม่รู้จักคำสั่ง API');
  } catch (err) {
    return {ok:false, error:String(err && err.message || err)};
  }
}

function cleanCallback_(v) {
  v = String(v || '').trim();
  return /^[A-Za-z_$][0-9A-Za-z_$\.]{0,120}$/.test(v) ? v : '';
}

function javascript_(callback, obj) {
  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(obj) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function props_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SPREADSHEET_ID')) throw new Error('ยังไม่ได้รัน setupProject()');
  return props;
}

function ensureOrdersSheet_() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  let sheet = ss.getSheetByName(PTK.sheetName);
  if (!sheet) sheet = ss.insertSheet(PTK.sheetName);
  if (sheet.getMaxColumns() < PTK.headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), PTK.headers.length - sheet.getMaxColumns());
  const current = sheet.getRange(1,1,1,PTK.headers.length).getValues()[0];
  if (current.join('|') !== PTK.headers.join('|')) {
    sheet.getRange(1,1,1,PTK.headers.length).setValues([PTK.headers]);
  }
  sheet.setFrozenRows(1);
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.getRange('E:E').setNumberFormat('@');
  sheet.getRange(1,1,1,PTK.headers.length).setFontWeight('bold').setBackground('#fff1f5');
  return sheet;
}

function sheet_() { props_(); return ensureOrdersSheet_(); }
function folder_() {
  const props = props_();
  const id = props.getProperty('SLIP_FOLDER_ID');
  if (!id) throw new Error('ยังไม่มีโฟลเดอร์เก็บสลิป กรุณารัน setupProject() อีกครั้ง');
  return DriveApp.getFolderById(id);
}
function requireAdmin_(token) {
  const expected = props_().getProperty('ADMIN_TOKEN');
  if (!expected || String(token || '') !== expected) throw new Error('รหัสหลังบ้านไม่ถูกต้อง');
}
function clean_(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 5000); }
function phone_(v) { return clean_(v, 30).replace(/[^0-9+ -]/g, ''); }
function num_(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function findRow_(orderNo) {
  const sheet = sheet_();
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const values = sheet.getRange(2,1,last-1,1).getDisplayValues();
  const target = clean_(orderNo, 80).toUpperCase();
  for (let i=0;i<values.length;i++) if (String(values[i][0]).toUpperCase() === target) return i + 2;
  return -1;
}


function isSpecialSize_(size) {
  const m = String(size || '').toUpperCase().replace(/\s+/g,'').match(/^(\d+)XL$/);
  return !!m && Number(m[1]) >= 6;
}
function unitPriceForSize_(size) {
  return 200 + (isSpecialSize_(size) ? 50 : 0);
}
function validShirtSize_(size) {
  return ['XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','7XL'].indexOf(String(size || '').toUpperCase().replace(/\s+/g,'')) >= 0;
}

function createOrder_(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('ข้อมูลคำสั่งซื้อไม่ถูกต้อง');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    let orderNo = clean_(raw.orderNo,80).toUpperCase();
    if (!/^PTK[0-9A-Z-]{8,}$/.test(orderNo)) orderNo = makeOrderNo_();
    if (findRow_(orderNo) > 0) orderNo = makeOrderNo_();
    const customerRaw = raw.customer || {};
    const customer = {
      name: clean_(customerRaw.name,150),
      phone: phone_(customerRaw.phone),
      address: clean_(customerRaw.address,500),
      province: clean_(customerRaw.province,100),
      district: clean_(customerRaw.district,100),
      subdistrict: clean_(customerRaw.subdistrict,100),
      postalCode: clean_(customerRaw.postalCode,20)
    };
    if (!customer.name || !customer.phone) throw new Error('กรุณาระบุชื่อและเบอร์โทร');
    const items = Array.isArray(raw.items) ? raw.items.slice(0,50).map(i => {
      const size = clean_(i.size,30).toUpperCase().replace(/\s+/g,'');
      if (!validShirtSize_(size)) throw new Error('พบไซส์เสื้อที่ไม่รองรับ: ' + size);
      const qty = Math.max(1, Math.min(99, Math.round(num_(i.qty) || 1)));
      const price = unitPriceForSize_(size);
      return {
        id: clean_(i.id,100), name: clean_(i.name,200), size,
        qty, price, image: clean_(i.image,500), lineTotal: price * qty
      };
    }) : [];
    if (!items.length) throw new Error('ไม่มีสินค้าในคำสั่งซื้อ');
    const subtotal = items.reduce((s,i)=>s+i.lineTotal,0);
    const shipping = raw.shipping === 'shipping' ? 'shipping' : 'pickup';
    const shippingFee = shipping === 'shipping' ? 50 : 0;
    const now = new Date().toISOString();
    const order = {
      orderNo, createdAt: now, updatedAt: now, customer, shipping, items,
      subtotal, shippingFee, total: subtotal + shippingFee,
      status:'pending_payment', paidAt:null, verifiedAt:null, rejectedAt:null,
      slipFileId:'', slipUrl:''
    };
    sheet_().appendRow(orderToRow_(order));
    return order;
  } finally { lock.releaseLock(); }
}

function uploadSlip_(body) {
  const orderNo = clean_(body.orderNo,80).toUpperCase();
  const phone = phone_(body.phone);
  const paidAt = clean_(body.paidAt,60);
  const dataUrl = clean_(body.slipData, 12 * 1024 * 1024);
  const row = findRow_(orderNo);
  if (row < 2) throw new Error('ไม่พบคำสั่งซื้อ');
  const order = rowToOrder_(sheet_().getRange(row,1,1,PTK.headers.length).getValues()[0]);
  if (phone_(order.customer.phone) !== phone) throw new Error('เบอร์โทรไม่ตรงกับคำสั่งซื้อ');
  const match = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
  if (!match) throw new Error('ไฟล์สลิปไม่ถูกต้อง');
  const mime = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('สลิปมีขนาดใหญ่เกิน 8 MB');

  if (order.slipFileId) {
    try { DriveApp.getFileById(order.slipFileId).setTrashed(true); } catch (_) {}
  }
  const blob = Utilities.newBlob(bytes, 'image/' + mime, orderNo + '-slip.' + (mime === 'jpeg' ? 'jpg' : mime));
  const file = folder_().createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (_) {}
  const fileId = file.getId();
  const slipUrl = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w1600';
  order.status = 'payment_review';
  order.paidAt = paidAt || new Date().toISOString();
  order.rejectedAt = null;
  order.verifiedAt = null;
  order.slipFileId = fileId;
  order.slipUrl = slipUrl;
  order.updatedAt = new Date().toISOString();
  writeOrderRow_(row, order);
  return order;
}

function getOrderPublic_(orderNo, phone) {
  const row = findRow_(orderNo);
  if (row < 2) throw new Error('ไม่พบคำสั่งซื้อ');
  const order = rowToOrder_(sheet_().getRange(row,1,1,PTK.headers.length).getValues()[0]);
  if (phone_(order.customer.phone) !== phone_(phone)) throw new Error('ไม่พบคำสั่งซื้อ');
  // ไม่ส่ง file id ออกหน้าร้าน
  delete order.slipFileId;
  return order;
}

function publicOrderView_(order) {
  return {
    orderNo: order.orderNo,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    customer: {name: String((order.customer && order.customer.name) || '')},
    shipping: order.shipping,
    items: (order.items || []).map(function(i){ return {size:String(i.size || ''), qty:Number(i.qty || 0), name:String(i.name || '')}; }),
    total: Number(order.total || 0),
    status: order.status,
    verifiedAt: order.verifiedAt || null
  };
}

function searchOrdersPublic_(query) {
  const q = clean_(query, 120).toLowerCase();
  if (!q) return [];
  const sheet = sheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const orders = sheet.getRange(2,1,last-1,PTK.headers.length).getValues()
    .map(rowToOrder_)
    .filter(function(o){
      if (!o || !o.orderNo) return false;
      const no = String(o.orderNo || '').toLowerCase();
      const name = String((o.customer && o.customer.name) || '').toLowerCase();
      return no.indexOf(q) !== -1 || name.indexOf(q) !== -1;
    })
    .sort(function(a,b){ return new Date(b.createdAt) - new Date(a.createdAt); })
    .slice(0,20);
  return orders.map(publicOrderView_);
}

function listOrders_() {
  const sheet = sheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2,1,last-1,PTK.headers.length).getValues().map(rowToOrder_).filter(o=>o.orderNo).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
}

function updateStatus_(orderNo, status) {
  status = clean_(status,50);
  if (PTK.statuses.indexOf(status) < 0) throw new Error('สถานะไม่ถูกต้อง');
  const row = findRow_(orderNo); if (row < 2) throw new Error('ไม่พบคำสั่งซื้อ');
  const order = rowToOrder_(sheet_().getRange(row,1,1,PTK.headers.length).getValues()[0]);
  order.status = status;
  order.updatedAt = new Date().toISOString();
  if (status === 'paid' && !order.verifiedAt) order.verifiedAt = new Date().toISOString();
  if (status === 'payment_rejected') { order.rejectedAt = new Date().toISOString(); order.verifiedAt = null; }
  writeOrderRow_(row, order);
  return order;
}
function confirmPayment_(orderNo) {
  const row = findRow_(orderNo); if (row < 2) throw new Error('ไม่พบคำสั่งซื้อ');
  const order = rowToOrder_(sheet_().getRange(row,1,1,PTK.headers.length).getValues()[0]);
  if (!order.slipUrl) throw new Error('ออเดอร์นี้ยังไม่มีสลิป');
  order.status = 'paid'; order.verifiedAt = new Date().toISOString(); order.rejectedAt = null; order.updatedAt = new Date().toISOString();
  writeOrderRow_(row, order); return order;
}
function rejectPayment_(orderNo) {
  const row = findRow_(orderNo); if (row < 2) throw new Error('ไม่พบคำสั่งซื้อ');
  const order = rowToOrder_(sheet_().getRange(row,1,1,PTK.headers.length).getValues()[0]);
  order.status = 'payment_rejected'; order.rejectedAt = new Date().toISOString(); order.verifiedAt = null; order.updatedAt = new Date().toISOString();
  writeOrderRow_(row, order); return order;
}

function orderToRow_(o) {
  const c = o.customer || {};
  const address = [c.address,c.subdistrict,c.district,c.province,c.postalCode].filter(Boolean).join(' ');
  const itemsSummary = (o.items||[]).map(i => (i.size||'-') + ' /' + (i.qty||1)).join('  ');
  return [
    o.orderNo||'', o.createdAt||'', o.updatedAt||'', c.name||'', c.phone||'', o.shipping||'', address,
    itemsSummary, num_(o.subtotal), num_(o.shippingFee), num_(o.total), o.status||'', o.paidAt||'', o.verifiedAt||'',
    o.rejectedAt||'', o.slipFileId||'', o.slipUrl||'', JSON.stringify(c), JSON.stringify(o.items||[])
  ];
}
function rowToOrder_(r) {
  let customer = {}; let items = [];
  try { customer = JSON.parse(r[17] || '{}'); } catch (_) {}
  try { items = JSON.parse(r[18] || '[]'); } catch (_) {}
  if (!customer.name) customer.name = r[3] || '';
  if (!customer.phone) customer.phone = r[4] || '';
  return {
    orderNo:String(r[0]||''), createdAt:iso_(r[1]), updatedAt:iso_(r[2]), customer,
    shipping:String(r[5]||'pickup'), items, subtotal:num_(r[8]), shippingFee:num_(r[9]), total:num_(r[10]),
    status:String(r[11]||'pending_payment'), paidAt:isoOrNull_(r[12]), verifiedAt:isoOrNull_(r[13]), rejectedAt:isoOrNull_(r[14]),
    slipFileId:String(r[15]||''), slipUrl:String(r[16]||'')
  };
}
function writeOrderRow_(row, order) { sheet_().getRange(row,1,1,PTK.headers.length).setValues([orderToRow_(order)]); }
function iso_(v) { if (!v) return ''; if (v instanceof Date) return v.toISOString(); return String(v); }
function isoOrNull_(v) { const s=iso_(v); return s || null; }
function makeOrderNo_() {
  const d = new Date();
  const tz = Session.getScriptTimeZone() || 'Asia/Bangkok';
  return 'PTK' + Utilities.formatDate(d,tz,'yyyyMMddHHmmss') + Math.floor(100+Math.random()*900);
}
