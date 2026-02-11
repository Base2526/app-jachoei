// src/graphql/globalSearch.gql.ts
import { gql } from "@apollo/client";

export const Q_GLOBAL_SEARCH = gql`
  query GlobalSearch($q: String!) {
    globalSearch(q: $q) {
      posts {
        id
        entity_id
        title
        snippet
        created_at
      }
      phones {
        id
        entity_id
        phone
        report_count
        last_report_at
        ids
      }
      bank_accounts {
        id
        entity_id
        bank_name
        account_no_masked
        report_count
        last_report_at
        ids
      }
    }
  }
`;
