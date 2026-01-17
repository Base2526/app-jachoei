// import {useEffect} from "react";
// import {
//   StatusBar,
//   ActivityIndicator,
//   View,
//   Text,
// } from "react-native";
// import {
//   SafeAreaProvider,
//   SafeAreaView,
// } from "react-native-safe-area-context";
// import { ApolloProvider } from "@apollo/client/react";

// import { client } from "./src/apollo/client";
// import { useInitScamSync } from "./src/hooks/useInitScamSync";
// import CheckPhoneScreen from "./src/screens/CheckPhoneScreen";

// function Root() {
//   const { ready } = useInitScamSync();

//   if (!ready) {
//     return (
//       <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
//         <ActivityIndicator />
//         <Text style={{ marginTop: 8 }}>กำลังเตรียมฐานข้อมูลบนเครื่อง...</Text>
//       </View>
//     );
//   }

//   return (
//     <SafeAreaView style={{ flex: 1 }}>
//       <StatusBar barStyle="dark-content" />
//       <CheckPhoneScreen />
//     </SafeAreaView>
//   );
// }

// export default function App() {
//   return (
//     <ApolloProvider client={client}>
//       <SafeAreaProvider>
//         <Root />
//       </SafeAreaProvider>
//     </ApolloProvider>
//   );
// }

import {useEffect} from "react";

import {
  StatusBar,
  ActivityIndicator,
  View,
  Text,
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ScamProtectTabs } from "./src/screens/ScamProtectTabs";
import { ApolloProvider } from "@apollo/client/react";

import { client } from "./src/apollo/client";

import { useInitScamSync } from "./src/hooks/useInitScamSync";

const Stack = createNativeStackNavigator();

import { PermissionsAndroid } from "react-native";

export async function ensureSmsPermissions() {
  const res = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    PermissionsAndroid.PERMISSIONS.READ_SMS,
  ]);

  console.log("[PERM] sms =", res);
}

function Root() {
  const { ready } = useInitScamSync();

  useEffect(() => {
    ensureSmsPermissions();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>กำลังเตรียมฐานข้อมูลบนเครื่อง...</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator>
      <Stack.Screen
        name="ScamProtect"
        component={ScamProtectTabs}
        options={{ title: "Scam Protect" }}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  
  return (
    <ApolloProvider client={client}>
      <NavigationContainer>
        <Root />
      </NavigationContainer>
    </ApolloProvider>
  );
}
