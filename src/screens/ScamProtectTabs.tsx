// src/screens/ScamProtectTabs.tsx
import React from "react";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { CheckPhoneScreen } from "./CheckPhoneScreen";
import { BlockedNumbersScreen } from "./BlockedNumbersScreen";
import { SmsSettingsScreen } from "./SmsSettingsScreen";
import { CallBlockSettingsScreen } from "./CallBlockSettingsScreen";
import { BlockedLogsScreen } from "./BlockedLogsScreen";

const Tab = createMaterialTopTabNavigator();

export const ScamProtectTabs: React.FC = () => {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: { backgroundColor: "#111" },
        tabBarActiveTintColor: "#fff",
        tabBarInactiveTintColor: "#888",
        tabBarIndicatorStyle: { backgroundColor: "#1e90ff" },
        tabBarLabelStyle: { fontSize: 14, fontWeight: "600" },
      }}
    >
      <Tab.Screen
        name="CheckPhone"
        component={CheckPhoneScreen}
        options={{ title: "เช็กเบอร์" }}
      />

      <Tab.Screen
        name="BlockedNumbers"
        component={BlockedNumbersScreen}
        options={{ title: "เบอร์ที่บล็อก" }}
      />

      <Tab.Screen
        name="SmsSettingsScreen"
        component={SmsSettingsScreen}
        options={{ title: "SMS" }}
      />

      <Tab.Screen
        name="CallBlockSettingsScreen"
        component={CallBlockSettingsScreen}
        options={{ title: "Call" }}
      />

       <Tab.Screen
        name="BlockedLogs"
        component={BlockedLogsScreen}
        options={{ title: "Blocked Activity" }}
      />
    </Tab.Navigator>
  );
};
