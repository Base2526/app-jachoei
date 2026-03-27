import { gql } from "@apollo/client";
import notifee from "@notifee/react-native";

import { client } from "../apollo/client";

const Q_MY_UNREAD_CHAT_COUNT = gql`
  query MyUnreadChatCount {
    myUnreadChatCount
  }
`;

export async function refreshUnreadChatBadge(): Promise<number> {
  try {
    const res = await client.query<{ myUnreadChatCount: number }>({
      query: Q_MY_UNREAD_CHAT_COUNT,
      fetchPolicy: "network-only",
    });

    const total = Math.max(0, Number(res.data?.myUnreadChatCount || 0));

    try {
      await notifee.setBadgeCount(total);
    } catch {
      // ignore (badge support varies on Android)
    }

    return total;
  } catch {
    return 0;
  }
}
