import React from "react";
import { ActivityIndicator, TextInput, View, StyleSheet, TouchableOpacity } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

export const HEADER_SEARCH_INPUT_METRICS = {
  height: 42,
  borderRadius: 12,
  paddingHorizontal: 12,
  inputPaddingHorizontal: 10,
  iconSize: 17,
  iconButtonSize: 26,
  iconButtonRadius: 10,
  clearGap: 6,
  loaderGap: 6,
  fontSize: 14,
} as const;

type Props = {
  value: string;
  onChangeText: (v: string) => void;
  onClear?: () => void;

  onFocus?: () => void;
  onBlur?: () => void;
  onPressHistory?: () => void;
  showHistoryIcon?: boolean;
  historyActive?: boolean;
  loading?: boolean;
  placeholder?: string;
  autoFocus?: boolean;

  // ถ้าอยากทำ submit จากคีย์บอร์ด
  onSubmit?: () => void;
};

export const HeaderSearchInput: React.FC<Props> = ({
  value,
  onChangeText,
  onClear,
  onFocus,
  onBlur,
  onPressHistory,
  showHistoryIcon = true,
  historyActive = false,
  loading = false,
  placeholder,
  autoFocus = true,
  onSubmit,
}) => {
  return (
    <View style={styles.container}>
      <Ionicons name="search-outline" size={HEADER_SEARCH_INPUT_METRICS.iconSize} color="#94a3b8" />

      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder || "ค้นหาเบอร์ / ข้อความ"}
        placeholderTextColor="#666"
        autoFocus={autoFocus}
        style={styles.input}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
      />

      {!!value && (
        <TouchableOpacity onPress={onClear} hitSlop={10} style={styles.clearButton}>
          <Ionicons name="close-circle" size={HEADER_SEARCH_INPUT_METRICS.iconSize} color="#94a3b8" />
        </TouchableOpacity>
      )}

      {showHistoryIcon && (
        <TouchableOpacity onPress={onPressHistory} hitSlop={10} style={[styles.iconButton, historyActive && styles.iconButtonActive]}>
          <Ionicons
            name="time-outline"
            size={HEADER_SEARCH_INPUT_METRICS.iconSize}
            color={historyActive ? "#111" : "#cbd5e1"}
          />
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="small" />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  // ⭐ กล่อง input จะ “ชิดซ้าย” เท่าที่ header จะให้ได้
  container: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#141c2a",
    borderRadius: HEADER_SEARCH_INPUT_METRICS.borderRadius,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: HEADER_SEARCH_INPUT_METRICS.paddingHorizontal,
    height: HEADER_SEARCH_INPUT_METRICS.height,
  },
  input: {
    flex: 1,
    color: "#fff",
    paddingHorizontal: HEADER_SEARCH_INPUT_METRICS.inputPaddingHorizontal,
    paddingVertical: 0,
    fontSize: HEADER_SEARCH_INPUT_METRICS.fontSize,
  },
  clearButton: { marginRight: HEADER_SEARCH_INPUT_METRICS.clearGap },
  iconButton: {
    width: HEADER_SEARCH_INPUT_METRICS.iconButtonSize,
    height: HEADER_SEARCH_INPUT_METRICS.iconButtonSize,
    borderRadius: HEADER_SEARCH_INPUT_METRICS.iconButtonRadius,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonActive: { backgroundColor: "#E2E8F0" },
  loaderWrap: { marginLeft: HEADER_SEARCH_INPUT_METRICS.loaderGap },
});
