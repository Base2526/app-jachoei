import { gql } from "@apollo/client";

export const PHONE_ACTION_ITEM_FRAGMENT = gql`
  fragment PhoneActionItemFields on PhoneCenterItem {
    phone
    phone_normalized
    my_blocked
    my_blocked_at
    my_reported
    my_reported_at
    in_history
    last_history_at
    report_count
    last_report_at
    risk_level
    updated_at
    post_count
    latest_post_id
    post_ids
    filters
  }
`;

export const Q_GET_PHONE_INFO = gql`
  query GetPhoneInfo($phone: String!) {
    getPhoneInfo(phone: $phone) {
      phone
      report_count
      last_report_at
      risk_level
      tags
      updated_at
      is_deleted
      post_ids
      ctx
    }
  }
`;

export const M_BLOCK_PHONE_ACTION = gql`
  mutation BlockPhoneAction($phoneNumber: String!) {
    blockNumber(phoneNumber: $phoneNumber) {
      ok
      item {
        ...PhoneActionItemFields
      }
    }
  }
  ${PHONE_ACTION_ITEM_FRAGMENT}
`;

export const M_UNBLOCK_PHONE_ACTION = gql`
  mutation UnblockPhoneAction($phoneNumber: String!) {
    unblockNumber(phoneNumber: $phoneNumber) {
      ok
      item {
        ...PhoneActionItemFields
      }
    }
  }
  ${PHONE_ACTION_ITEM_FRAGMENT}
`;

export const M_REPORT_PHONE_ACTION = gql`
  mutation ReportPhoneAction($phone: String!, $category: ScamPhoneReportCategory, $note: String) {
    reportPhone(phone: $phone, category: $category, note: $note) {
      ok
      item {
        ...PhoneActionItemFields
      }
    }
  }
  ${PHONE_ACTION_ITEM_FRAGMENT}
`;