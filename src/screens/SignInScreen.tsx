// SignInScreen.tsx
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";

import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { useAuth } from "../auth/AuthProvider";

type Props = {
  onSignIn?: (payload: { email: string; password: string }) => Promise<void> | void;
  onApplePress?: () => Promise<void> | void;
  onGooglePress?: () => Promise<void> | void;
  onEmailLinkPress?: () => void; // optional: forgot password / sign up
};

export default function SignInScreen({
  onSignIn,
  onApplePress,
  onGooglePress,
  onEmailLinkPress,
}: Props) {
  const navigation = useNavigation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>("");

  const auth = useAuth();

  const canSubmit = useMemo(() => {
    const e = email.trim();
    return e.length > 3 && password.length >= 6 && !submitting;
  }, [email, password, submitting]);

  const validate = () => {
    const e = email.trim();
    if (!e.includes("@")) return "Email ไม่ถูกต้อง";
    if (password.length < 6) return "Password ต้องอย่างน้อย 6 ตัวอักษร";
    return "";
  };

  const handleSignIn = async () => {
    setError("");
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }

    try {
      setSubmitting(true);

      // ถ้าไม่ได้ส่ง onSignIn มา จะทำ demo เฉย ๆ
      if (!onSignIn) {
        await new Promise((r) => setTimeout(r, 900));
        Alert.alert("Signed in", `Welcome ${email.trim()}`);
        return;
      }

      await onSignIn({ email: email.trim(), password });
    } catch (e: any) {
      setError(e?.message || "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApple = async () => {
    try {
      setError("");
      setSubmitting(true);
      if (onApplePress) await onApplePress();
      else Alert.alert("Apple Sign In", "TODO: connect Apple auth");
    } catch (e: any) {
      setError(e?.message || "Apple sign-in failed");
    } finally {
      setSubmitting(false);
    }
  };

//   const handleGoogle = async () => {
//     try {
//       setError("");
//       setSubmitting(true);
//       if (onGooglePress) await onGooglePress();
//       else Alert.alert("Google Sign In", "TODO: connect Google auth");
//     } catch (e: any) {
//       setError(e?.message || "Google sign-in failed");
//     } finally {
//       setSubmitting(false);
//     }
//   };

    const handleGoogle = async () => {
        try {
            setError("");
            setSubmitting(true);

            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

            // เปิดหน้าล็อกอิน
            const userInfo = await GoogleSignin.signIn();

            // เอา token (แนะนำใช้ idToken ส่งไป backend)
            const tokens = await GoogleSignin.getTokens(); // { idToken, accessToken } :contentReference[oaicite:3]{index=3}
            const idToken = userInfo?.idToken || tokens?.idToken;
            const accessToken = tokens?.accessToken;

            const credential = idToken || accessToken;
            if (!credential) {
            throw new Error("Google login failed: missing token");
            }

            // ยิงเข้า mutation ของคุณ: loginWithSocial(input:{provider, accessToken})
            await auth.loginWithSocial({
            provider: "google",
            accessToken: credential, // ส่ง idToken ก่อน ถ้าไม่มีค่อย fallback accessToken
            });

            // ปิด modal
            navigation.goBack();
        } catch (e: any) {
            setError(e?.message || "Google sign-in failed");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
            <View style={styles.card}>
            <View style={styles.brandRow}>
                <View style={styles.logo}>
                <Text style={styles.logoText}>J</Text>
                </View>
                <Pressable
                accessibilityRole="button"
                style={styles.closeBtn}
                onPress={() => {
                    navigation.goBack();
                }}
                >
                <Text style={styles.closeText}>✕</Text>
                </Pressable>
            </View>

            <Text style={styles.title}>Jachoei</Text>
            <Text style={styles.subTitle}>Sign in to continue</Text>

            {/* <Pressable
                style={[styles.socialBtn, styles.appleBtn]}
                onPress={handleApple}
                disabled={submitting}
            >
                <Text style={[styles.socialText, styles.appleText]}>
                Continue with Apple
                </Text>
            </Pressable> */}

            <Pressable
                style={[styles.socialBtn, styles.googleBtn]}
                onPress={handleGoogle}
                disabled={submitting}
            >
                <Text style={[styles.socialText, styles.googleText]}>
                Continue with Google
                </Text>
            </Pressable>

            <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>or sign in with email</Text>
                <View style={styles.divider} />
            </View>

            <Text style={styles.label}>Email</Text>
            <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.input}
                editable={!submitting}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor="rgba(255,255,255,0.35)"
                secureTextEntry
                style={styles.input}
                editable={!submitting}
            />

            {!!error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable
                style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
                onPress={handleSignIn}
                disabled={!canSubmit}
            >
                {submitting ? (
                <ActivityIndicator />
                ) : (
                <Text style={styles.primaryText}>Sign In</Text>
                )}
            </Pressable>

            <Pressable
                style={styles.linkRow}
                onPress={() => (onEmailLinkPress ? onEmailLinkPress() : Alert.alert("TODO"))}
            >
                <Text style={styles.linkText}>Forgot password?</Text>
                <Text style={styles.linkText}>Create account</Text>
            </Pressable>

            <View style={styles.footerRow}>
                <Text style={styles.footerText}>Privacy policy</Text>
                <Text style={styles.footerText}>Terms of service</Text>
            </View>
            </View>
        </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b0b0b" },
  container: { flex: 1, padding: 18, justifyContent: "center" },

  card: {
    backgroundColor: "#111111",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  brandRow: { flexDirection: "row", justifyContent: "center", alignItems: "center" },

  logo: {
    width: 76,
    height: 76,
    borderRadius: 20,
    backgroundColor: "#00e5ff",
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { fontSize: 38, fontWeight: "900", color: "#071014" },

  closeBtn: {
    position: "absolute",
    right: 0,
    top: 0,
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "#1b1b1b",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: "white", fontSize: 16 },

  title: {
    color: "white",
    fontSize: 38,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 12,
  },
  subTitle: {
    color: "rgba(255,255,255,0.65)",
    textAlign: "center",
    marginTop: 6,
    marginBottom: 14,
  },

  socialBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    borderWidth: 1,
  },
  socialText: { fontSize: 16, fontWeight: "700" },

  appleBtn: { backgroundColor: "#ffffff", borderColor: "#ffffff" },
  appleText: { color: "#000000" },

  googleBtn: { backgroundColor: "#1d1d1d", borderColor: "rgba(255,255,255,0.12)" },
  googleText: { color: "#ffffff" },

  dividerRow: { flexDirection: "row", alignItems: "center", marginTop: 16 },
  divider: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.10)" },
  dividerText: {
    color: "rgba(255,255,255,0.55)",
    paddingHorizontal: 10,
    fontSize: 12,
  },

  label: { color: "rgba(255,255,255,0.75)", marginTop: 14, marginBottom: 6 },
  input: {
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 14,
    color: "white",
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  errorText: { color: "#ff6b6b", marginTop: 10 },

  primaryBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: "#00e5ff",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryText: { color: "#071014", fontWeight: "900", fontSize: 16 },

  linkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
  },
  linkText: { color: "rgba(255,255,255,0.75)", textDecorationLine: "underline" },

  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 },
  footerText: { color: "rgba(255,255,255,0.45)", fontSize: 12 },
});
