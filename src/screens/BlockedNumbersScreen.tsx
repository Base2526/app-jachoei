// src/screens/BlockedNumbersScreen.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  Alert,
} from "react-native";
import {
  addBlockedNumber,
  removeBlockedNumber,
  listBlockedNumbers,
} from "../native/CallBlocker";

export const BlockedNumbersScreen: React.FC = () => {
  const [phoneInput, setPhoneInput] = useState("");
  const [numbers, setNumbers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const loadNumbers = async () => {
    try {
      setLoading(true);
      const list = await listBlockedNumbers();

      console.log("[BlockedNumbers] list: ", list);
      setNumbers(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn("[BlockedNumbers] load error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNumbers();
  }, []);

  const handleAdd = async () => {
    const trimmed = phoneInput.trim();
    if (!trimmed) return;
    try {
      setLoading(true);
      await addBlockedNumber(trimmed);
      setPhoneInput("");
      await loadNumbers();
    } catch (e) {
      console.warn("[BlockedNumbers] add error:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (phone: string) => {
    Alert.alert(
      "ยืนยันลบ",
      `ต้องการเอาเบอร์ ${phone} ออกจากรายการบล็อกหรือไม่?`,
      [
        { text: "ยกเลิก", style: "cancel" },
        {
          text: "ลบ",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              await removeBlockedNumber(phone);
              await loadNumbers();
            } catch (e) {
              console.warn("[BlockedNumbers] remove error:", e);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>เบอร์ที่ถูกบล็อก</Text>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="กรอกเบอร์ที่จะบล็อก"
          keyboardType="phone-pad"
          value={phoneInput}
          onChangeText={setPhoneInput}
        />
        <Pressable
          style={[styles.addButton, (loading || !phoneInput.trim()) && styles.buttonDisabled]}
          onPress={handleAdd}
          disabled={loading || !phoneInput.trim()}
        >
          <Text style={styles.addButtonText}>เพิ่ม</Text>
        </Pressable>
      </View>

      <FlatList
        data={numbers}
        keyExtractor={(item) => item}
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>ยังไม่มีเบอร์ที่ถูกบล็อก</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.itemRow}>
            <Text style={styles.itemText}>{item}</Text>
            <Pressable
              style={styles.removeButton}
              onPress={() => handleRemove(item)}
            >
              <Text style={styles.removeButtonText}>ลบ</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#111" },
  title: { fontSize: 20, fontWeight: "600", color: "#fff", marginBottom: 12 },
  inputRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#444",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#fff",
  },
  addButton: {
    backgroundColor: "#1e90ff",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  addButtonText: { color: "#fff", fontWeight: "600" },
  buttonDisabled: { opacity: 0.5 },
  list: { flex: 1 },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  itemText: { color: "#fff", fontSize: 16 },
  removeButton: {
    backgroundColor: "#aa3333",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  removeButtonText: { color: "#fff", fontSize: 14 },
  emptyText: { color: "#777", marginTop: 20 },
});
