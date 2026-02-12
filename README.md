# Jachoei Mobile (Android / iOS)

Jachoei Mobile คือแอปมือถือของ **Jachoei (จ่าเฉย)** สำหรับใช้งานบน **Android** และ **iOS** พัฒนาโดย **React Native + TypeScript** เชื่อมต่อกับระบบหลังบ้านผ่าน **GraphQL (Apollo Client)**

> Repository นี้เป็นฝั่ง Mobile App เท่านั้น (Frontend Mobile)

---

## ✨ Features (ภาพรวม)

- 📌 **Feed / Home**
  - ดูโพสต์แบบแบ่งหน้า (pagination)
  - เปิดดูรายละเอียดโพสต์ (PostView)
  - กด **Bookmark** / ยกเลิก Bookmark
  - แชร์โพสต์
  - เปิดลิงก์ Facebook ของโพสต์ (ถ้ามี)
  - ปุ่ม **Chat** (แสดงเฉพาะโพสต์ที่ผู้สร้าง ≠ ผู้ใช้งานปัจจุบัน)

- 🔎 **Check Phone**
  - ตรวจสอบเบอร์ / ข้อมูลที่เกี่ยวข้อง (ตามฟีเจอร์ในระบบ)

- 🚫 **Blocked Numbers / Blocked Logs**
  - ดูรายการเบอร์ที่บล็อก
  - ดูประวัติการบล็อก

- 💬 **Chat**
  - ระบบแชทแบบเรียลไทม์ด้วย GraphQL Subscriptions
  - ส่งข้อความ + แนบรูป (สูงสุด 4 รูป/ข้อความ)
  - Reply ข้อความ
  - Read receipts / mark read
  - ลบข้อความ (ตามสิทธิ์/เงื่อนไข API)

- 👤 **Profile**
  - ดูโปรไฟล์ผู้ใช้งาน / ผู้โพสต์

- 🔐 **Auth**
  - Login/Sign in และเรียกข้อมูล `me`

---

## 🧱 Tech Stack

- **React Native** + **TypeScript**
- **React Navigation**
  - Stack + Bottom Tabs
- **Apollo Client (GraphQL)**
  - Query / Mutation / Subscription
- **Zustand**
  - Global chat state (เช่น currentChat / unread sync)
- **react-native-image-picker**
  - เลือกรูปจากเครื่องเพื่อแนบในแชท
- **Ionicons**
  - ไอคอน UI

---

## 📁 Project Structure (โดยประมาณ)

```txt
src/
  apollo/
    client.ts
  auth/
    AuthProvider.tsx
  components/
    ThumbGrid.tsx
    SendMessageSection.tsx
    comments/
      CommentsSection.tsx
  navigation/
    types.ts
    ...
  screens/
    HomeScreen.tsx
    PostViewScreen.tsx
    ChatScreen.tsx
    ProfileScreen.tsx
    ...
  store/
    globalChatStore.ts
  config/
    env.ts

⚙️ Requirements

Node.js (แนะนำ LTS)

Yarn หรือ npm

React Native CLI Environment

Android Studio (สำหรับ Android)

Xcode (สำหรับ iOS)

CocoaPods (สำหรับ iOS)

อ้างอิงการตั้งค่า React Native CLI ได้จากเอกสารทางการ:

https://reactnative.dev/docs/environment-setup

🔧 Setup
1) Install dependencies
yarn
# หรือ
npm install

2) iOS pods
cd ios
pod install
cd ..

🔐 Environment Variables

โปรเจกต์ใช้ค่า ENV จาก src/config/env.ts

ตัวอย่างฟิลด์ที่ใช้งานทั่วไป:

ENV.apiBase : base URL ของ API (Backend)

ENV.webBase : base URL ของเว็บ (ใช้สร้างลิงก์แชร์)

ปรับค่าให้ตรงกับ environment ของคุณ (dev/staging/prod)

ตัวอย่าง (แนวทาง):

// src/config/env.ts
export const ENV = {
  apiBase: "https://api.your-domain.com",
  webBase: "https://jachoei.com",
};

▶️ Running
Android
yarn android
# หรือ
npx react-native run-android

iOS
yarn ios
# หรือ
npx react-native run-ios

🧪 Development Notes
Bookmark Sync (Home ↔ PostView)

Bookmark สามารถกดได้ทั้งบนหน้า Home และหน้า PostView

เมื่อกลับมาหน้า Home จะมีการ refresh เพื่อให้สถานะ bookmark ตรงกับ server (กันเคสกด bookmark ใน PostView แล้วกลับมา Home ไม่อัปเดต)

Chat

หน้า Chat ใช้ GraphQL Subscriptions เพื่อรับข้อความใหม่แบบเรียลไทม์

ส่งรูปได้สูงสุด 4 รูปต่อข้อความผ่าน SendMessageSection

🧭 Navigation Types

ไฟล์ src/navigation/types.ts เป็นแหล่ง type หลักของ route params เช่น:

PostView: { id: string; currentUserId?: string }

Chat: { to: string }

Profile: { id: string }

แนะนำให้แก้ type ตรงนี้ให้ครบก่อนแก้หน้าจอ เพื่อกัน TypeScript error

🧰 Scripts (ตัวอย่าง)
yarn start
yarn android
yarn ios
yarn lint


(ขึ้นอยู่กับ config ของ repo)

🤝 Contributing

Fork / สร้าง branch ใหม่

ทำงานและทดสอบบน Android/iOS

เปิด Pull Request พร้อมรายละเอียดการเปลี่ยนแปลง + screenshot ถ้ามี

📝 License
MIT License

Copyright (c) 2026 Jachoei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.