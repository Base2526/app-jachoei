/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

import messaging from "@react-native-firebase/messaging";
import notifee, { EventType } from "@notifee/react-native";
import { extractChatIdFromData, persistPendingChatId } from "./src/notifications/background";

console.log("index");

// Background: data-only / mixed payload handling
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
	const chatId = extractChatIdFromData(remoteMessage?.data);
	if (chatId) {
		await persistPendingChatId(chatId);
	}
});

// Background: user taps a Notifee-displayed notification
notifee.onBackgroundEvent(async ({ type, detail }) => {
	if (type !== EventType.PRESS) return;
	const chatId = extractChatIdFromData(detail?.notification?.data);
	if (chatId) {
		await persistPendingChatId(chatId);
	}
});

AppRegistry.registerComponent(appName, () => App);
