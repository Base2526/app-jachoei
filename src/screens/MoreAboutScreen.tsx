import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

import { useI18n } from "../i18n";
import {
  MoreCard,
  MoreIntroCard,
  MoreMetaRow,
  MoreScrollView,
  MoreSectionHeader,
  moreCommonStyles,
  useAppDeviceInfo,
} from "./MoreCommon";

export const MoreAboutScreen: React.FC = () => {
  const { t } = useI18n();
  const deviceInfo = useAppDeviceInfo();

  return (
    <MoreScrollView>
      <MoreIntroCard
        title={t("more.about_intro_title")}
        description={t("more.about_intro_desc")}
      />

      <MoreCard>
        <MoreMetaRow
          label={t("more.about_mission_title")}
          value={t("more.about_mission_body")}
        />
      </MoreCard>

      <MoreSectionHeader title={t("more.about_checks_title")} />
      <MoreCard>
        <View style={styles.checksContainer}>
          <Text style={styles.checksSubtitle}>
            รองรับการตรวจสอบข้อมูลสำคัญ 4 ประเภท
          </Text>
          <View style={styles.featureGrid}>
            <View style={styles.featureChip}>
              <View style={styles.featureIconWrap}>
                <Ionicons name="call" size={18} color="#3b82f6" />
              </View>
              <Text style={styles.featureLabel}>{t("more.about_checks_phone")}</Text>
            </View>
            <View style={styles.featureChip}>
              <View style={styles.featureIconWrap}>
                <Ionicons name="card" size={18} color="#10b981" />
              </View>
              <Text style={styles.featureLabel}>{t("more.about_checks_bank")}</Text>
            </View>
            <View style={styles.featureChip}>
              <View style={styles.featureIconWrap}>
                <Ionicons name="link" size={18} color="#f59e0b" />
              </View>
              <Text style={styles.featureLabel}>{t("more.about_checks_link")}</Text>
            </View>
            <View style={styles.featureChip}>
              <View style={styles.featureIconWrap}>
                <Ionicons name="flag" size={18} color="#8b5cf6" />
              </View>
              <Text style={styles.featureLabel}>{t("more.about_checks_page")}</Text>
            </View>
          </View>
        </View>
      </MoreCard>

      <MoreSectionHeader title={t("more.about_app_info_title")} />
      <MoreCard>
        <MoreMetaRow
          label={t("more.about_app_name_label")}
          value={t("more.about_app_name_value")}
        />
        <MoreMetaRow
          label={t("more.about_version_label")}
          value={deviceInfo?.appVersion ?? null}
          loading={!deviceInfo}
        />
        <MoreMetaRow
          label={t("more.about_build_label")}
          value={deviceInfo?.buildNumber ?? null}
          loading={!deviceInfo}
        />
        <MoreMetaRow
          label={t("more.about_platform_label")}
          value={deviceInfo?.platform ?? null}
          loading={!deviceInfo}
        />
      </MoreCard>
    </MoreScrollView>
  );
};

const styles = StyleSheet.create({
  checksContainer: {
    padding: 16,
  },
  checksSubtitle: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
    textAlign: "center",
  },
  featureGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  featureChip: {
    width: "48%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#171a24",
    borderWidth: 1,
    borderColor: "#2a3144",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 14,
    minHeight: 56,
  },
  featureIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  featureLabel: {
    flex: 1,
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
});