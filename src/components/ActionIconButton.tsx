import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

export type ActionIconVariant = "neutral" | "warning" | "accent" | "success";

export type ActionIconButtonProps = {
  icon: string;
  variant: ActionIconVariant;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  accessibilityLabel: string;
};

export function ActionIconButton(props: ActionIconButtonProps) {
  const { icon, variant, onPress, disabled, busy, label, accessibilityLabel } = props;

  const variantStyles = {
    neutral: { bg: "#161f31", border: "#2a3448", icon: "#e5e7eb", spinner: "#e5e7eb" },
    accent: { bg: "rgba(59, 130, 246, 0.14)", border: "rgba(59, 130, 246, 0.24)", icon: "#60a5fa", spinner: "#60a5fa" },
    warning: { bg: "rgba(245, 158, 11, 0.14)", border: "rgba(245, 158, 11, 0.22)", icon: "#f59e0b", spinner: "#f59e0b" },
    success: { bg: "rgba(34, 197, 94, 0.14)", border: "rgba(34, 197, 94, 0.22)", icon: "#4ade80", spinner: "#4ade80" },
  };

  const colors = variantStyles[variant];

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={(event) => {
          event?.stopPropagation?.();
          onPress();
        }}
        disabled={disabled || busy}
        hitSlop={8}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.bg, borderColor: colors.border },
          (disabled || busy) && styles.buttonDisabled,
          pressed && !(disabled || busy) && styles.buttonPressed,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.spinner} />
        ) : (
          <Ionicons name={icon as any} size={20} color={colors.icon} />
        )}
      </Pressable>
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 6,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  label: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
});
