export type TabsParamList = {
  HomeScreen: undefined;
  CheckPhone: { initialLookupType?: "PHONE" | "BANK" } | undefined;
  BlockedNumbers: undefined;
  BlockedLogs: undefined;
  More: undefined;
};

export type RootStackParamList = {
  // Stack root
  ScamProtect: undefined;

  // Modals / stack screens
  SignIn: undefined;
  BlockedLogsSearch: undefined;

  PostView: { id: string; currentUserId?: string };
  Profile: { id: string };
  Chat: { to?: string; chatId?: string } | undefined;

  Setting: undefined;
  Diagnostics: undefined;
  PostForm: { id?: string } | undefined;

  Notifications: undefined;
  MoreHelp: undefined;
  MorePrivacy: undefined;
  MoreAbout: undefined;
};
