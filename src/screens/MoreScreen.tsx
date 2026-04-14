import React, { useMemo } from "react";
import { Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

import type { TabsParamList } from "../navigation/types";
import { useI18n } from "../i18n";
import { openCallerIdAndSpamSettings } from "../native/CallBlocker";
import { useCallScreeningStatus } from "../hooks/useCallScreeningStatus";
import {
  MoreActionRow,
  MoreButton,
  MoreButtonRow,
  MoreCard,
  MoreIntroCard,
  MoreScrollView,
  MoreSectionHeader,
  useAppDeviceInfo,
} from "./MoreCommon";

type MoreTabNavigation = BottomTabNavigationProp<TabsParamList, "More">;

export const MoreScreen: React.FC = () => {
  const navigation = useNavigation<MoreTabNavigation>();
  const { t } = useI18n();
  const deviceInfo = useAppDeviceInfo();
  const { uiStatus, refreshing, refreshStatus } = useCallScreeningStatus();

  const aboutVersion = useMemo(() => {
    if (!deviceInfo?.appVersion) return t("more.about_desc");
    return t("more.app_version_short", { version: deviceInfo.appVersion });
  }, [deviceInfo?.appVersion, t]);

  const openRootScreen = (screen: "MoreHelp" | "MorePrivacy" | "MoreAbout") => {
    const parent = navigation.getParent();
    if (parent) {
      parent.navigate(screen as never);
      return;
    }

    navigation.navigate(screen as never);
  };

  const statusTitle =
    uiStatus === "enabled"
      ? t("more.caller_spam_status_enabled")
      : uiStatus === "unsupported"
        ? t("more.caller_spam_status_unsupported")
        : uiStatus === "checking"
          ? t("more.caller_spam_status_checking")
          : t("more.caller_spam_status_not_enabled");

  const statusToneIcon =
    uiStatus === "enabled"
      ? "checkmark-circle-outline"
      : uiStatus === "unsupported"
        ? "remove-circle-outline"
        : uiStatus === "checking"
          ? "sync-outline"
          : "alert-circle-outline";

  const handleOpenSettings = async () => {
    try {
      await openCallerIdAndSpamSettings();
    } catch {
      // best-effort only
    }
  };

  return (
    <MoreScrollView>
      <MoreIntroCard
        eyebrow={t("more.intro_badge")}
        title={t("more.intro_title")}
        description={t("more.intro_description")}
      />

      <MoreSectionHeader
        title={t("more.tools_title")}
        description={t("more.tools_description")}
      />

      <MoreSectionHeader
        title={t("more.caller_spam_title")}
        description={t("more.caller_spam_desc")}
      />
      <MoreCard>
        <MoreActionRow
          icon={statusToneIcon}
          title={t("more.caller_spam_title")}
          description={t("more.caller_spam_desc")}
          disabled
          rightLabel={statusTitle}
        />
        {uiStatus === "not_enabled" ? (
          <MoreButtonRow>
            <MoreButton
              label={t("more.open_settings")}
              onPress={handleOpenSettings}
              tone="primary"
            />
            <MoreButton
              label={t("more.check_again")}
              onPress={() => {
                void refreshStatus();
              }}
            />
          </MoreButtonRow>
        ) : null}
        {uiStatus === "enabled" ? (
          <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16 }}>
            <Text style={{ color: "#34c759", fontSize: 13, fontWeight: "700" }}>
              {t("more.caller_spam_enabled_hint")}
            </Text>
          </View>
        ) : null}
      </MoreCard>

      <MoreCard>
        <MoreActionRow
          icon="call-outline"
          title={t("more.tool_phone_title")}
          description={t("more.tool_phone_desc")}
          onPress={() =>
            navigation.navigate("CheckPhone", { initialLookupType: "PHONE" })
          }
        />
        <MoreActionRow
          icon="card-outline"
          title={t("more.tool_bank_title")}
          description={t("more.tool_bank_desc")}
          onPress={() =>
            navigation.navigate("CheckPhone", { initialLookupType: "BANK" })
          }
        />
        <MoreActionRow
          icon="globe-outline"
          title={t("more.tool_link_title")}
          description={t("more.tool_link_desc")}
          disabled
          rightLabel={t("more.coming_soon")}
        />
        <MoreActionRow
          icon="flag-outline"
          title={t("more.tool_page_title")}
          description={t("more.tool_page_desc")}
          disabled
          rightLabel={t("more.coming_soon")}
        />
      </MoreCard>

      <MoreSectionHeader
        title={t("more.support_title")}
        description={t("more.support_description")}
      />
      <MoreCard>
        <MoreActionRow
          icon="help-circle-outline"
          title={t("more.help_title")}
          description={t("more.help_desc")}
          onPress={() => openRootScreen("MoreHelp")}
        />
        <MoreActionRow
          icon="lock-closed-outline"
          title={t("more.privacy_title")}
          description={t("more.privacy_desc")}
          onPress={() => openRootScreen("MorePrivacy")}
        />
        <MoreActionRow
          icon="information-circle-outline"
          title={t("more.about_title")}
          description={aboutVersion}
          onPress={() => openRootScreen("MoreAbout")}
        />
      </MoreCard>

      <MoreIntroCard
        title={t("more.learn_more_title")}
        description={t("more.learn_more_desc")}
      />
    </MoreScrollView>
  );
};