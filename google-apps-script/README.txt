เชื่อม Google Sheets + Google Drive (ไม่ต้อง npm)

1) ไปที่ https://script.google.com แล้วสร้าง New project
2) เปิด Code.gs ลบโค้ดเดิม แล้ววางโค้ดจากไฟล์ Code.gs นี้ทั้งหมด
3) เลือกฟังก์ชัน setupProject แล้วกด Run 1 ครั้ง และอนุญาตสิทธิ์ Google Sheets / Drive
4) เปิด Execution log จะเห็น JSON ที่มี:
   - spreadsheetUrl = Google Sheet ที่ระบบสร้างให้
   - slipFolderUrl = โฟลเดอร์เก็บสลิป
   - adminToken = รหัสเข้าหลังบ้าน
5) Deploy > New deployment > Web app
   Execute as: Me
   Who has access: Anyone
   แล้วกด Deploy
6) คัดลอก Web app URL ที่ลงท้าย /exec
7) เปิดไฟล์ config.js ของเว็บไซต์ แล้วใส่ URL:

window.PTK_APP_CONFIG = {
  sheetWebAppUrl: 'https://script.google.com/macros/s/......../exec'
};

8) อัปโหลดเว็บไซต์ขึ้น Hosting / GitHub Pages / Netlify ตามปกติ
9) เปิด admin.html แล้วกรอก adminToken ที่ได้จากข้อ 4

ข้อมูลที่เก็บใน Google Sheet:
- เลขออเดอร์ / วันที่
- ชื่อ / เบอร์โทร / ที่อยู่
- ไซส์และจำนวน
- ยอดเงิน / ค่าจัดส่ง
- สถานะการชำระและจัดส่ง
- ลิงก์สลิป

รูปสลิปเก็บใน Google Drive ไม่ได้ยัดรูป Base64 ลงเซลล์ จึงไม่ติดข้อจำกัดความยาวของเซลล์
