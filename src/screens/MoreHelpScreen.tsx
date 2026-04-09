import React from "react";
import { useNavigation } from "@react-navigation/native";

import { useI18n } from "../i18n";
import {
  MoreActionRow,
  MoreCard,
  MoreInfoRow,
  MoreIntroCard,
  MoreScrollView,
  MoreSectionHeader,
} from "./MoreCommon";

export const MoreHelpScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useI18n();

  return (
    <MoreScrollView>
      <MoreIntroCard
        title={t("more.help_intro_title")}
        description={t("more.help_intro_desc")}
      />

      <MoreCard>
        <MoreInfoRow
          icon="search-outline"
          title={t("more.help_phone_title")}
          description={t("more.help_phone_body")}
        />
        <MoreInfoRow
          icon="megaphone-outline"
          title={t("more.help_report_title")}
          description={t("more.help_report_body")}
        />
        <MoreInfoRow
          icon="shield-checkmark-outline"
          title={t("more.help_blocked_title")}
          description={t("more.help_blocked_body")}
        />
        <MoreInfoRow
          icon="layers-outline"
          title={t("more.help_local_vs_community_title")}
          description={t("more.help_local_vs_community_body")}
        />
        <MoreInfoRow
          icon="warning-outline"
          title={t("more.help_urgent_title")}
          description={t("more.help_urgent_body")}
        />
      </MoreCard>

      <MoreSectionHeader
        title={t("more.help_quick_actions_title")}
        description={t("more.help_quick_actions_desc")}
      />
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
      </MoreCard>
    </MoreScrollView>
  );
};