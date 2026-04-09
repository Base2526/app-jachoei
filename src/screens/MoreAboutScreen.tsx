import React from "react";
import { Text, View } from "react-native";

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
        <View style={moreCommonStyles.chipsWrap}>
          <View style={moreCommonStyles.chip}>
            <Text style={moreCommonStyles.chipText}>{t("more.about_checks_phone")}</Text>
          </View>
          <View style={moreCommonStyles.chip}>
            <Text style={moreCommonStyles.chipText}>{t("more.about_checks_bank")}</Text>
          </View>
          <View style={moreCommonStyles.chip}>
            <Text style={moreCommonStyles.chipText}>{t("more.about_checks_link")}</Text>
          </View>
          <View style={moreCommonStyles.chip}>
            <Text style={moreCommonStyles.chipText}>{t("more.about_checks_page")}</Text>
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