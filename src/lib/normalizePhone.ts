// src/lib/normalizePhone.ts

// ตัวอย่างง่าย ๆ สำหรับไทย: แปลง 0xxxxxxxxx -> +66xxxxxxxxx
export function normalizePhone(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(/[^\d+]/g, ""); // เก็บแค่ตัวเลขกับ +

  // ถ้ามี + แล้ว ปล่อยเลย
  if (s.startsWith("+")) return s;

  // ถ้าเริ่มด้วย 0 และยาว 10 หลัก -> +66
  if (s.startsWith("0") && s.length >= 9) {
    return "+66" + s.slice(1);
  }

  // อย่างอื่นก็คืนเลขเฉย ๆ
  return s;
}
