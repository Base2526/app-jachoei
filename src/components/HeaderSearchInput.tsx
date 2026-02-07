import React from "react";
import { TextInput, View, StyleSheet, TouchableOpacity } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

type Props = {
  value: string;
  onChangeText: (v: string) => void;
  onClear?: () => void;

  onFocus?: () => void;
  onPressHistory?: () => void;
  showHistoryIcon?: boolean;

  // ถ้าอยากทำ submit จากคีย์บอร์ด
  onSubmit?: () => void;
};

export const HeaderSearchInput: React.FC<Props> = ({
  value,
  onChangeText,
  onClear,
  onFocus,
  onPressHistory,
  showHistoryIcon = true,
  onSubmit,
}) => {
  return (
    <View style={styles.container}>
      <Ionicons name="search-outline" size={16} color="#888" />

      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        placeholder="ค้นหาเบอร์ / ข้อความ"
        placeholderTextColor="#666"
        autoFocus
        style={styles.input}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
      />

      {!!value && (
        <TouchableOpacity onPress={onClear} hitSlop={10} style={{ marginRight: 6 }}>
          <Ionicons name="close-circle" size={18} color="#888" />
        </TouchableOpacity>
      )}

      {showHistoryIcon && (
        <TouchableOpacity onPress={onPressHistory} hitSlop={10}>
          <Ionicons name="time-outline" size={18} color="#aaa" />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  // ⭐ กล่อง input จะ “ชิดซ้าย” เท่าที่ header จะให้ได้
  container: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1d1d25",
    borderRadius: 10,
    paddingHorizontal: 8,
    height: 36,
  },
  input: {
    flex: 1,
    color: "#fff",
    paddingHorizontal: 8,
    paddingVertical: 0,
    fontSize: 15,
  },
});
