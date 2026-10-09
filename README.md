# Chiang Rai iOS-style LINE Mini App

โปรเจกต์ Vite + TypeScript สำหรับเทศบาลนครเชียงราย พร้อม LIFF, Supabase, Leaflet, iOS UI และ Vercel.

## ฟังก์ชันที่พร้อมใช้

- LIFF login และดึงชื่อ/รูปโปรไฟล์ LINE (โหลด LIFF SDK จาก CDN ทางการ)
- โหมด Demo อัตโนมัติเมื่อยังไม่มีคีย์
- หน้า Dashboard, บริการ, แผนที่, ตั้งค่า
- แบบฟอร์มแจ้งปัญหา 3 ขั้นตอน
- ระบุตำแหน่งด้วย Geolocation
- แนบและอัปโหลดรูปภาพไป Supabase Storage
- บันทึกคำร้องลง Supabase หรือ localStorage ในโหมด Demo
- ดึงรายการบริการ ข่าว กิจกรรม และจุดคำร้องแบบไม่เปิดเผยข้อมูลส่วนบุคคลจาก Supabase
- ตัวกรองประเภทข้อมูลอยู่บนหน้าแผนที่และประชาชนเลือกเปิด/ปิดได้
- บริการสุขภาพและขอข้อมูลข่าวสารเป็นหน้าข้อมูลบริการ/ช่องทางติดต่อ ไม่รวมกับแบบฟอร์มแจ้งปัญหา
- iOS safe area, glass effect, switches, tap feedback, swipe carousel และ dark mode

## 1) รันในเครื่อง

```bash
npm install
cp .env.example .env
npm run dev
```

เปิด `http://localhost:5173`


## 2) ตั้งค่า Supabase

1. สร้าง Supabase project
2. เปิด SQL Editor แล้วรันไฟล์ `supabase/schema.sql`
3. ไปที่ Project Settings > API
4. คัดลอก Project URL และ anon/publishable key ลง `.env`

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

> คำร้องและรูปประกอบไม่เปิดให้ client เขียนฐานข้อมูลหรือ Storage โดยตรง การเขียนทั้งหมดต้องผ่าน Edge Function ด้านล่าง

### เปิดใช้ Edge Functions สำหรับคำร้อง (จำเป็นใน production)

เวอร์ชันนี้ไม่อนุญาตให้ client insert คำร้องหรือ upload รูปโดยตรงแล้ว คำร้องใหม่และหน้าติดตามสถานะจะเรียก `create-complaint` และ `my-complaints` ซึ่งตรวจ LINE access token และ LINE Channel ID ก่อนเข้าถึงข้อมูล

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase secrets set LINE_CHANNEL_ID=YOUR_LINE_LOGIN_CHANNEL_ID
supabase secrets set ALLOWED_ORIGINS=https://YOUR_PRODUCTION_DOMAIN
supabase functions deploy create-complaint
supabase functions deploy my-complaints
```

- `LINE_CHANNEL_ID` คือ Channel ID ของ LINE Login channel ที่ออก LIFF app นี้ ไม่ใช่ LIFF ID
- `ALLOWED_ORIGINS` ใส่ได้หลาย origin โดยคั่นด้วย comma เช่น production และ preview ที่อนุญาต
- Supabase จัดเตรียม `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ให้ Edge Function อัตโนมัติ ห้ามนำ service-role key ไปใส่ในตัวแปร `VITE_*`
- `verify_jwt = false` ใน `supabase/config.toml` เป็นค่าที่ตั้งใจไว้ เพราะ `Authorization` ใช้ส่ง LINE access token ไม่ใช่ Supabase JWT ตัว Function จะตรวจ token กับ LINE เองทุกคำขอ
- Migration จะปิด anonymous complaint insert, เปลี่ยน `complaint-images` เป็น private และลบ public upload/read policies

## 3) ตั้งค่า LINE LIFF

1. สร้าง LINE Login channel ใน LINE Developers Console
2. เพิ่ม LIFF app และกำหนด Endpoint URL เป็น URL ของ Vercel
3. เลือก scope `profile` และ `openid`
4. ใส่ LIFF ID ใน `.env`

```env
VITE_LIFF_ID=1234567890-AbCdEfGh
```

ระหว่างทดสอบ local ให้เพิ่ม URL ที่เข้าถึงผ่าน HTTPS เป็น Endpoint/LIFF URL เช่น Vercel Preview หรือ tunnel ที่เชื่อถือได้.

## 4) Deploy Vercel

- Push โปรเจกต์ขึ้น GitHub แล้ว Import ใน Vercel
- Framework Preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- เพิ่ม Environment Variables ที่ใช้จริงของโปรเจกต์
- Deploy แล้วนำ Production URL ไปใส่เป็น LIFF Endpoint URL

หรือ CLI:

```bash
npm i -g vercel
vercel
vercel --prod
```

## โครงสร้างข้อมูล

- `services`: เมนูที่ผู้ดูแลเปิด/ปิดได้
- `news`: ข่าวและกิจกรรม
- `complaints`: คำร้องพร้อมพิกัดและสถานะ
- Storage bucket `complaint-images`: รูปประกอบคำร้อง

## 5) ผู้ดูแลระบบ (จัดการเลเยอร์บนแผนที่)

หน้าประชาชนไม่มี Developer Mode หรือเมนูผู้ดูแล ทางเข้าจัดการเลเยอร์/หมุดแยกไว้ที่ route `#/staff` และต้องเข้าสู่ระบบก่อนจึงจะแก้ไขได้ ส่วนตัวกรองประเภทข้อมูลเป็นฟังก์ชันสาธารณะบนหน้าแผนที่

1. สร้างรหัสผ่านที่ต้องการ แล้วแปลงเป็น SHA-256 hash:
   ```bash
   node -e "console.log(require('crypto').createHash('sha256').update('รหัสผ่านของคุณ').digest('hex'))"
   ```
2. นำค่า hash ที่ได้ไปใส่ใน `.env` เป็น `VITE_ADMIN_PASSWORD_HASH`
3. หากยังไม่ตั้งค่านี้ หน้าเข้าสู่ระบบผู้ดูแลจะทำงานเป็น "โหมดทดลอง" คือกดเข้าสู่ระบบได้โดยไม่ต้องใส่รหัสผ่านจริง เพื่อให้ทดสอบ UI ได้

> **สำคัญ:** นี่คือการกันแบบฝั่ง client เท่านั้น (เหมาะสำหรับกันผู้ใช้ทั่วไปไม่ให้แก้ไขเลเยอร์ส่วนตัวที่เก็บใน localStorage ของอุปกรณ์นั้น ๆ) ไม่ใช่ระบบยืนยันตัวตนที่แท้จริง เพราะค่า hash ถูกฝังอยู่ใน JS bundle ที่ส่งถึงทุกคน ผู้ที่มีความรู้ด้านเทคนิคสามารถข้ามการตรวจสอบใน devtools ได้ หากต้องการปกป้องข้อมูลจริงในฐานข้อมูล (Supabase) ต้องบังคับสิทธิ์ที่ฝั่งเซิร์ฟเวอร์ด้วย Supabase Auth หรือ Edge Function เสมอ เช่นเดียวกับที่ระบุไว้ด้านล่างสำหรับคำร้อง

## ขอบเขตเวอร์ชันนี้

- เน้นบริการประชาชน ข้อมูลติดต่อ กระบวนการแจ้งปัญหา และแผนที่ข้อมูลที่มีเจ้าของข้อมูลชัดเจน
- เลื่อน AI chatbot, RAG และ Dashboard Smart City ขนาดใหญ่ออกไป จนกว่าจะมีข้อมูลจริง ผู้รับผิดชอบ แหล่งความรู้ และรอบการดูแลข้อมูลที่ต่อเนื่อง

## หมายเหตุด้านความปลอดภัย

LIFF profile ใน UI ใช้เพื่อการแสดงผลเท่านั้น ฝั่งฐานข้อมูลใช้ Edge Function ตรวจอายุ token, Channel ID และ LINE profile อีกครั้ง จำกัดรูปไม่เกิน 10 MB พร้อมตรวจ file signature และจำกัดผู้ใช้ไม่เกิน 3 คำร้องต่อ 10 นาที ส่วนสิทธิ์เจ้าหน้าที่ยังต้องใช้ Supabase Auth หรือระบบ backend แยกต่างหาก.


## CDN ที่ใช้

LIFF SDK, Supabase JS และ Leaflet โหลดจาก CDN ใน `index.html` เพื่อลดปัญหา bundle และทำให้เปลี่ยนค่าคอนฟิกได้ง่าย โดย Vite ใช้สำหรับพัฒนาและ build source TypeScript.
