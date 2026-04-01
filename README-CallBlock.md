ได้เลย อันนี้ผมสรุปให้แบบ **เอาไปใช้คุยทีม / ทำ spec / ใส่ Jira ได้เลย** (ครบ + ใช้งานจริงได้)

---

# 🚀 Feature Summary: Call Block + Spam Detection System

## 🎯 Core Objective

ระบบต้องสามารถ:

* block สายที่ user เลือก
* แจ้งเตือนสายที่เป็น spam (จาก community)
* เก็บ history log
* ทำงานได้แม้ offline

---

# 🧩 1. Core Features (Must Have)

## 1.1 📞 Incoming Call Screening

* ตรวจสอบสายเรียกเข้าแบบ real-time
* เปรียบเทียบกับ:

  * user blocked list
  * community spam list
* ไม่ต้องรอ network (ใช้ cache)

---

## 1.2 🔒 User Block System

* user สามารถ:

  * block เบอร์
  * unblock เบอร์
* เมื่อ block:

  * ❌ block สายทันที
  * ✅ log event
* เมื่อ unblock:

  * ❌ ไม่ block แล้ว
  * ⚠️ แต่ยังเตือนถ้าเป็น spam

---

## 1.3 🚨 Community Spam Detection

* ดึงข้อมูลจาก backend (report จาก user คนอื่น)
* behavior:

  * ❌ ไม่ block
  * ⚠️ แสดง warning

ตัวอย่าง:

> “⚠️ เบอร์นี้ถูกรายงานว่าเป็น scam (12 reports)”

---

## 1.4 🧾 Call History Log

ต้องเก็บทุก event:

* blocked call
* spam warning
* allowed call

ข้อมูล:

```json
{
  "phoneNumber": "...",
  "normalizedNumber": "...",
  "type": "blocked_call | spam_warning | allowed",
  "source": "self | community | none",
  "action": "blocked | allowed",
  "timestamp": "...",
  "matchedBy": "self_block | community_spam | none"
}
```

---

## 1.5 📱 Block / Unblock UI

* ปุ่ม block/unblock ใน:

  * call log
  * search
* แสดงสถานะ:

  * Blocked
  * Spam warning
  * Normal

---

## 1.6 📊 Spam Metadata

สำหรับแต่ละเบอร์:

* reportCount
* riskLevel (low / medium / high)
* categories (scam, telemarketing, etc.)
* lastReportedAt

---

# ⚙️ 2. System Behavior Rules

## 2.1 Decision Priority

```text
1. user block → block call
2. community spam → show warning
3. else → allow
```

---

## 2.2 Unblock Logic

```text
if user unblock:
  → remove block
  → if spam → warning only
  → else → normal
```

---

## 2.3 Number Matching

ต้อง normalize ก่อนทุกครั้ง:

* +66 / 066 / 66
* มี space / dash / ()

---

# 🧠 3. Data & Storage

## 3.1 Local Storage (สำคัญมาก)

เก็บ:

* blocked numbers
* spam cache
* recent logs

เพื่อ:

* ทำงาน offline
* response เร็ว

---

## 3.2 Backend APIs

ต้องมี:

* reportSpam(phoneNumber)
* getSpamNumbers()
* getUserBlockedNumbers(userId)
* saveCallLog()
* markSpam / unmarkSpam

---

## 3.3 Data Separation

แยกชัด:

* user_blocked_numbers
* community_spam_numbers
* call_history_logs

---

# 📲 4. Android Integration

## 4.1 Call Detection

ใช้:

* CallScreeningService (หลัก)
* fallback BroadcastReceiver (ถ้าจำเป็น)

---

## 4.2 Behavior

* block call → reject
* spam → show overlay / notification

---

## 4.3 Permissions

* READ_PHONE_STATE
* CALL_SCREENING (implicit via service)
* optional: READ_CONTACTS

---

# 🛡️ 5. Safety & UX

## 5.1 Contact Handling

* ไม่ควรแก้ contact อัตโนมัติ
* ให้ user confirm ก่อน

---

## 5.2 Unknown Number Policy

ต้อง define:

* unknown
* private
* no caller ID

---

## 5.3 Mute / Action Control (optional but recommended)

เพิ่ม setting:

* allow
* warn
* block

---

# 🔄 6. Sync & Performance

## 6.1 Offline-first

* match จาก local ก่อน
* sync backend ภายหลัง

---

## 6.2 Cache Strategy

* spam list (partial)
* blocked list (full)

---

## 6.3 Deduplication

กัน log ซ้ำ:

* same number
* same timestamp window

---

# 🧪 7. QA / Test Cases

ต้องเทส:

* block แล้วสายโดน reject
* unblock แล้วสายเข้าได้
* spam → warning only
* offline ยัง match ได้
* duplicate log ไม่เกิด
* normalize number ถูกต้อง
* background / app killed ยังทำงาน

---

# 🧠 สรุปสั้นสุด (เอาไป pitch ได้)

ระบบนี้มี 3 layer:

1. **User control (Block)**
   → block จริง

2. **Community intelligence (Spam)**
   → เตือนอย่างเดียว

3. **History + Data**
   → เก็บทุก event วิเคราะห์ได้

---

# 🔥 ถ้าอยากเพิ่มขั้น advance (แนะนำ)

* AI spam scoring
* auto-block high-risk
* crowd trust system
* call screen UI (เหมือน Google Pixel)

---

ถ้าคุณต้องการต่อ ผมช่วยได้:

* 🔥 DB schema จริง
* 🔥 Android Kotlin code (block call จริง)
* 🔥 React Native bridge
* 🔥 Copilot prompt full system (ระดับ production)