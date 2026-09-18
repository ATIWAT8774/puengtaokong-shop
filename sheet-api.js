(() => {
  const cfg = () => window.PTK_APP_CONFIG || {};
  const apiUrl = () => String(cfg().sheetWebAppUrl || '').trim();
  const isConfigured = () => /^https:\/\/script\.google\.com\/macros\/s\//i.test(apiUrl()) && /\/exec(?:\?|$)/i.test(apiUrl());

  function makeError(message, code) {
    const err = new Error(message);
    if (code) err.code = code;
    return err;
  }

  // JSONP is intentionally used for responses because this shop can be opened
  // directly as file:// and Google Apps Script ContentService does not provide
  // normal CORS headers that fetch() can reliably read in that mode.
  function jsonp(action, payload = {}, timeoutMs = 25000) {
    if (!isConfigured()) return Promise.reject(makeError('ยังไม่ได้ตั้งค่า Google Apps Script Web app URL ใน config.js', 'NOT_CONFIGURED'));
    return new Promise((resolve, reject) => {
      const callback = `__ptk_jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      let done = false;
      const timer = setTimeout(() => finish(makeError('Google Sheets ตอบกลับช้าเกินไป กรุณาลองใหม่', 'TIMEOUT')), timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[callback]; } catch (_) { window[callback] = undefined; }
        script.remove();
      }
      function finish(err, value) {
        if (done) return;
        done = true;
        cleanup();
        err ? reject(err) : resolve(value);
      }
      window[callback] = result => {
        if (!result || result.ok !== true) return finish(makeError(result?.error || 'Google Sheets ทำรายการไม่สำเร็จ', 'API_ERROR'));
        finish(null, result.data);
      };
      script.onerror = () => finish(makeError('เปิด Google Apps Script ไม่สำเร็จ กรุณาตรวจสอบว่า Web app อนุญาต Anyone และใช้ deployment ล่าสุด', 'SCRIPT_LOAD_ERROR'));
      const u = new URL(apiUrl());
      u.searchParams.set('action', action);
      u.searchParams.set('payload', JSON.stringify(payload || {}));
      u.searchParams.set('callback', callback);
      u.searchParams.set('_', String(Date.now()));
      script.src = u.toString();
      script.async = true;
      document.head.appendChild(script);
    });
  }

  // Cross-origin HTML form POST works even when index.html is opened directly
  // from the device. The response goes to a hidden iframe; data is then read
  // back with JSONP/polling.
  function formPost(action, payload = {}) {
    if (!isConfigured()) return Promise.reject(makeError('ยังไม่ได้ตั้งค่า Google Apps Script Web app URL ใน config.js', 'NOT_CONFIGURED'));
    return new Promise((resolve, reject) => {
      const id = `ptk_post_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const iframe = document.createElement('iframe');
      iframe.name = id;
      iframe.style.display = 'none';
      iframe.setAttribute('aria-hidden', 'true');
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = apiUrl();
      form.target = id;
      form.style.display = 'none';
      form.acceptCharset = 'UTF-8';
      const fields = { action, payload: JSON.stringify(payload || {}) };
      Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden'; input.name = name; input.value = value;
        form.appendChild(input);
      });
      let submitted = false;
      const cleanup = () => setTimeout(() => { form.remove(); iframe.remove(); }, 3000);
      iframe.addEventListener('load', () => {
        if (!submitted) return;
        cleanup();
        resolve(true);
      }, {once:false});
      iframe.addEventListener('error', () => {
        cleanup();
        reject(makeError('ส่งข้อมูลไป Google Apps Script ไม่สำเร็จ', 'POST_ERROR'));
      }, {once:true});
      document.body.append(iframe, form);
      try {
        submitted = true;
        form.submit();
        // Some browsers do not expose the cross-origin iframe load reliably.
        // Resolve shortly after submit; the caller confirms with JSONP polling.
        setTimeout(() => { cleanup(); resolve(true); }, 1200);
      } catch (e) {
        cleanup(); reject(makeError('ส่งข้อมูลไป Google Apps Script ไม่สำเร็จ', 'POST_ERROR'));
      }
    });
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function poll(fn, accept, {attempts=24, delay=900} = {}) {
    let lastErr;
    for (let i=0; i<attempts; i++) {
      try {
        const value = await fn();
        if (accept(value)) return value;
      } catch (e) { lastErr = e; }
      await sleep(delay);
    }
    if (lastErr) throw lastErr;
    throw makeError('ส่งข้อมูลแล้ว แต่ยังยืนยันการบันทึกจาก Google Sheets ไม่ได้ กรุณากดลองใหม่', 'POLL_TIMEOUT');
  }

  async function createOrder(order) {
    await formPost('createOrder', {order});
    return poll(
      () => jsonp('getOrder', {orderNo: order.orderNo, phone: order.customer?.phone}, 15000),
      o => !!o?.orderNo,
      {attempts: 30, delay: 1000}
    );
  }

  async function uploadSlip(data) {
    await formPost('uploadSlip', data);
    return poll(
      () => jsonp('getOrder', {orderNo: data.orderNo, phone: data.phone}, 15000),
      o => !!o?.orderNo && ['payment_review','paid','packing','shipped','ready_pickup','completed'].includes(o.status) && !!o.slipUrl,
      {attempts: 35, delay: 1200}
    );
  }

  window.PTKSheetAPI = {
    isConfigured,
    ping: () => jsonp('ping'),
    createOrder,
    uploadSlip,
    getOrder: (orderNo, phone) => jsonp('getOrder', {orderNo, phone}),
    searchOrders: query => jsonp('searchOrders', {query}, 25000),
    listOrders: adminToken => jsonp('listOrders', {adminToken}, 30000),
    updateStatus: (adminToken, orderNo, status) => jsonp('updateStatus', {adminToken, orderNo, status}, 30000),
    confirmPayment: (adminToken, orderNo) => jsonp('confirmPayment', {adminToken, orderNo}, 30000),
    rejectPayment: (adminToken, orderNo) => jsonp('rejectPayment', {adminToken, orderNo}, 30000)
  };
})();
