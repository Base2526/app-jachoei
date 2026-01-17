import React, { useState } from "react";
import { View, Text, Button, Alert } from "react-native";
import { ensureCallScreeningRole } from "../native/CallBlocker";

export function CallBlockSettingsScreen() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const onPress = async () => {
    const ok = await ensureCallScreeningRole();
    setEnabled(ok);
    if (!ok) {
      Alert.alert(
        "ยังไม่ได้เปิดสิทธิ์ Call Screening",
        "ให้เข้า Dialog แล้วเลือกแอปนี้เป็นแอปสำหรับกรองสาย (Call Screening App)"
      );
    }
  };

  return (
    <View style={{ padding: 16 }}>
      <Text style={{ marginBottom: 8 }}>
        {enabled === null
          ? "ยังไม่ได้ตรวจสอบสถานะ"
          : enabled
          ? "Call screening เปิดใช้งานแล้ว ✅"
          : "Call screening ยังไม่เปิดใช้งาน ❌"}
      </Text>
      <Button title="เปิดใช้งานการบล็อกสาย" onPress={onPress} />
    </View>
  );
}
