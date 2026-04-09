import React from "react";

import { useI18n } from "../i18n";
import {
  MoreCard,
  MoreInfoRow,
  MoreIntroCard,
  MoreScrollView,
} from "./MoreCommon";

export const MorePrivacyScreen: React.FC = () => {
  const { t } = useI18n();

  return (
    <MoreScrollView>
      <MoreIntroCard
        title={t("more.privacy_intro_title")}
        description={t("more.privacy_intro_desc")}
      />

      <MoreCard>
        <MoreInfoRow
          icon="document-text-outline"
          title={t("more.privacy_submit_title")}
          description={t("more.privacy_submit_body")}
        />
        <MoreInfoRow
          icon="bar-chart-outline"
          title={t("more.privacy_reports_title")}
          description={t("more.privacy_reports_body")}
        />
        <MoreInfoRow
          icon="key-outline"
          title={t("more.privacy_permissions_title")}
          description={t("more.privacy_permissions_body")}
        />
        <MoreInfoRow
          icon="settings-outline"
          title={t("more.privacy_control_title")}
          description={t("more.privacy_control_body")}
        />
      </MoreCard>
    </MoreScrollView>
  );
};