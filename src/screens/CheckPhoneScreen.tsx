import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";

import { client } from "../apollo/client";
import { checkScamPhoneWithFallback } from "../lib/syncScamPhones";

type CheckResult = {
  found: boolean;
  risk: number;
  reportCount: number;
};

export const CheckPhoneScreen: React.FC = () => {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  const onCheck = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await checkScamPhoneWithFallback(client, phone);
      setResult(res);
    } catch (e) {
      console.warn("[CheckPhone] error =", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>เช็กเบอร์ Scam</Text>

      <TextInput
        style={styles.input}
        placeholder="กรอกเบอร์โทร"
        placeholderTextColor="#777"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
      />

      <Pressable
        style={[
          styles.button,
          (loading || !phone.trim()) && styles.buttonDisabled,
        ]}
        onPress={onCheck}
        disabled={loading || !phone.trim()}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>ตรวจสอบ</Text>
        )}
      </Pressable>

      {result && (
        <View style={{ marginTop: 16 }}>
          {result.found ? (
            <>
              <Text style={styles.text}>พบในระบบ</Text>
              <Text style={styles.text}>Risk: {result.risk}</Text>
              <Text style={styles.text}>
                จำนวนรายงาน: {result.reportCount} ครั้ง
              </Text>
            </>
          ) : (
            <Text style={styles.text}>ไม่พบข้อมูลเบอร์นี้</Text>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#111" },
  title: { fontSize: 20, fontWeight: "600", color: "#fff", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#444",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#fff",
  },
  button: {
    marginTop: 12,
    backgroundColor: "#1e90ff",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "600" },
  text: { color: "#fff", marginTop: 4 },
});
