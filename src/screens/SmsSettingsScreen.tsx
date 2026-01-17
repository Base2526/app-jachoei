import React, { useState } from "react";
import { View, Text, Button, Alert } from "react-native";
import { ensureDefaultSmsApp } from "../native/SmsRole";

export const SmsSettingsScreen = () => {
  const [isDefault, setIsDefault] = useState<boolean | null>(null);

  const check = async () => {
    const ok = await ensureDefaultSmsApp();
    setIsDefault(ok);
    if (!ok) {
      Alert.alert(
        "ไม่ได้ตั้งเป็นแอป SMS หลัก",
        "ถ้าไม่ตั้งเป็นแอป SMS หลัก บางฟีเจอร์บล็อก SMS อาจทำงานได้ไม่สมบูรณ์"
      );
    }
  };

  return (
    <View style={{ padding: 16 }}>
      <Text style={{ marginBottom: 16 }}>
        {isDefault === null
          ? "ยังไม่ได้ตรวจสอบสถานะ"
          : isDefault
          ? "แอปนี้ถูกตั้งเป็น SMS app หลักแล้ว ✅"
          : "ยังไม่ใช่ SMS app หลัก ❌"}
      </Text>

      <Button title="ตั้งเป็นแอป SMS หลัก" onPress={check} />
    </View>
  );
};
