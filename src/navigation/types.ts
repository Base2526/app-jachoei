export type TabsParamList = {
  HomeScreen: undefined;
  CheckPhone: undefined;
  BlockedNumbers: undefined;
  BlockedLogs: undefined;
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
};
